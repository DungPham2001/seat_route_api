/**
 * Bookings (34-56, 70-80, 130-138, 143-151, 169-176): "first receipt wins".
 *
 * - Creating a booking does NOT hold seats. Several bookings may contain the same seat.
 * - A seat is claimed when the server has stored a valid receipt photo: a conditional update
 *   `trip_seats {_id: trip:seat, state: 'free'} -> 'claimed'` per seat (atomic, so of two parallel receipts only one
 *   wins, by server time). Seats that lose become `claimState = 'lost'`; the receipt is kept (seat_lost).
 * - Admin approves -> seats 'sold', booking 'confirmed'. Admin rejects -> seats back to 'free'.
 * - Admin bookings (cash, direct transfer, free) claim seats as 'sold' at once and never take a claimed seat.
 *
 * Status: awaiting_payment -> pending_review (seats held) -> confirmed -> completed
 *         side branches: info_requested, rejected (seats released), seat_lost, expired, cancelled.
 */
const models = require('../models');
const { Checker } = require('../lib/validate');
const { AppError, notFound, forbidden, conflict, invalid } = require('../lib/errors');
const { uuid, iso, humanCode, noAccent, normalizePhone, sha256 } = require('../lib/util');
const { withTx } = require('../lib/tx');
const T = require('../lib/time');
const settings = require('./settings');
const pricing = require('./pricing');
const routesSvc = require('./routes');
const notify = require('./notify');
const { bankByCode } = require('../lib/banks');
const { buildPayload } = require('../lib/vietqr');
const { paging, page } = require('../resources/engine');

const { Booking, Trip, TripSeat, Route, Office, OrderEvent, OrderRequest, Refund, PaymentRecord, PaymentProof, Promotion, Voucher, LoyaltyEntry, Receipt, GuestContact, Account, FileObject } = models;

const UNPAID = ['awaiting_payment', 'rejected', 'expired'];
const HELD = ['pending_review', 'info_requested', 'seat_lost', 'confirmed'];
const OPEN = [...UNPAID, ...HELD];

// ---------- helpers ----------

async function newCode(prefix, Model) {
  for (let i = 0; i < 8; i += 1) {
    const code = `${prefix}${humanCode(6)}`;
    if (!(await Model.exists({ code }))) return code;
  }
  return `${prefix}${humanCode(10)}`;
}

const event = (b, auth, kind, { oldValue = null, newValue = null, note = '', internal = false } = {}) => OrderEvent.create({
  _id: uuid(), orderType: 'booking', orderId: b._id, at: new Date(), byAccountId: auth?.accountId || null, byRole: auth?.role || 'system', kind, oldValue, newValue, note, internal,
});

async function load(id) {
  const b = await Booking.findById(id).lean();
  if (!b) throw notFound();
  return b;
}

/** Owner or admin. Customers never read someone else's booking. */
async function loadFor(auth, id) {
  const b = await load(id);
  if (auth.role !== 'admin' && b.customerAccountId !== auth.accountId) throw notFound();
  return b;
}

const searchOf = (b, routeName) => noAccent([b.code, routeName, ...(b.seats || []).flatMap((s) => [s.passengerName, s.passengerPhone])].filter(Boolean).join(' '));

function readSeats(c, body, { admin = false } = {}) {
  const arr = c.arr(body, 'seats', { required: true, max: 16 }) || [];
  if (Array.isArray(body?.seats) && !arr.length) c.fail('seats', 'required');
  const seen = new Set();
  return arr.map((s, i) => {
    const f = (k) => `seats[${i}].${k}`;
    const seatId = c.str(s, 'seatId', { field: f('seatId'), required: true, max: 10 });
    if (seatId && seen.has(seatId)) c.fail(f('seatId'), 'duplicate');
    seen.add(seatId);
    return {
      seatId,
      passengerName: c.str(s, 'passengerName', { field: f('passengerName'), required: true, max: 80 }),
      passengerPhone: c.phone(s, 'passengerPhone', { field: f('passengerPhone'), required: !admin }) || '',
      note: c.str(s, 'note', { field: f('note'), max: 300 }) || '',
      isChild: c.bool(s, 'isChild', { field: f('isChild'), def: false }),
    };
  });
}

/** Seats of the request resolved against trip_seats. `mode`: 'select' (customer: must be free), 'any' (quote). */
async function resolveSeats(trip, seats, mode = 'select') {
  const docs = await TripSeat.find({ _id: { $in: seats.map((s) => `${trip._id}:${s.seatId}`) } }).lean();
  const byId = new Map(docs.map((d) => [d.seatId, d]));
  const missing = [];
  const taken = [];
  const out = seats.map((s, i) => {
    const d = byId.get(s.seatId);
    if (!d || !d.isSellable) missing.push({ field: `seats[${i}].seatId`, code: 'not_found' });
    else if (mode === 'select' && d.state !== 'free') taken.push(s.seatId);
    return { ...s, label: d?.label || s.seatId, seatClass: d?.seatClass || 'standard', state: d?.state };
  });
  if (missing.length) throw invalid(missing);
  if (taken.length) throw new AppError(409, 'seat_taken', { takenSeats: taken, freeSeats: await freeSeats(trip._id) });
  return out;
}

const freeSeats = async (tripId) => (await TripSeat.find({ tripId, state: 'free', isSellable: true }).sort({ row: 1, col: 1 }).lean()).map((s) => s.seatId);

function assertOffices(route, pickupOfficeId, dropOfficeId) {
  const bad = [];
  if (!routesSvc.officeStop(route, pickupOfficeId, 'pickup')) bad.push({ field: 'pickupOfficeId', code: 'office_not_on_route' });
  if (!routesSvc.officeStop(route, dropOfficeId, 'drop')) bad.push({ field: 'dropOfficeId', code: 'office_not_on_route' });
  if (bad.length) throw new AppError(409, 'office_not_on_route', { fields: bad });
}

async function assertOfficesOpen(pickupOfficeId, dropOfficeId) {
  const rows = await Office.find({ _id: { $in: [pickupOfficeId, dropOfficeId] } }).lean();
  const closed = rows.filter((o) => !o.isActive).map((o) => o._id);
  if (closed.length) throw new AppError(409, 'office_not_on_route', { fields: closed.map((id) => ({ field: id === pickupOfficeId ? 'pickupOfficeId' : 'dropOfficeId', code: 'office_closed' })) });
}

async function bankSnapshot() {
  const bank = await settings.get('bank');
  const b = bank.bankCode ? bankByCode(bank.bankCode) : null;
  if (!b || !bank.accountNo || !bank.holderName) return null;
  return { bankCode: b.code, bin: b.bin, bankShortName: b.shortName, bankName: b.name, accountNo: bank.accountNo, holderName: bank.holderName };
}

async function policySnapshot() {
  const [cp, sh] = await Promise.all([settings.get('cancelPolicy'), settings.get('shuttle')]);
  return { tiers: cp.tiers, cancelFee: cp.cancelFee, changeAllowedHoursBefore: cp.changeAllowedHoursBefore, changeFee: cp.changeFee, shuttleFeeRefundable: sh.feeRefundable, takenAt: iso(new Date()) };
}

// ---------- presenter ----------

async function presentMany(rows, { admin = false } = {}) {
  if (!rows.length) return [];
  const tripIds = [...new Set(rows.map((b) => b.tripId))];
  const trips = new Map((await Trip.find({ _id: { $in: tripIds } }).lean()).map((t) => [t._id, t]));
  const routes = new Map((await Route.find({ _id: { $in: [...new Set([...trips.values()].map((t) => t.routeId))] } }).lean()).map((r) => [r._id, r]));
  const officeIds = [...new Set(rows.flatMap((b) => [b.pickupOfficeId, b.dropOfficeId]))];
  const offices = new Map((await Office.find({ _id: { $in: officeIds } }).lean()).map((o) => [o._id, o]));
  const vehicles = new Map((await models.Vehicle.find({ _id: { $in: [...new Set([...trips.values()].map((t) => t.vehicleId).filter(Boolean))] } }).lean()).map((v) => [v._id, v]));
  const bookingIds = rows.map((b) => b._id);
  const [proofs, requests, logs] = await Promise.all([
    PaymentProof.find({ orderType: 'booking', orderId: { $in: bookingIds } }).sort({ uploadedAt: 1 }).lean(),
    OrderRequest.find({ orderId: { $in: bookingIds }, status: 'pending' }).lean(),
    models.TripLog.find({ tripId: { $in: tripIds }, visibleToCustomer: true, kind: { $in: ['delay', 'incident', 'notice', 'depart', 'arrive'] } }).sort({ atTime: -1 }).lean(),
  ]);
  const reviewed = new Set((await models.Review.find({ bookingId: { $in: bookingIds } }).select('bookingId').lean()).map((r) => r.bookingId));
  let accounts = new Map();
  let guests = new Map();
  if (admin) {
    accounts = new Map((await Account.find({ _id: { $in: rows.map((b) => b.customerAccountId).filter(Boolean) } }).lean()).map((a) => [a._id, a]));
    guests = new Map((await GuestContact.find({ _id: { $in: rows.map((b) => b.guestContactId).filter(Boolean) } }).lean()).map((g) => [g._id, g]));
  }
  const now = new Date();
  const [cp] = await Promise.all([settings.get('cancelPolicy')]);
  return rows.map((b) => {
    const trip = trips.get(b.tripId);
    const route = routes.get(trip?.routeId || b.routeId);
    const vehicle = trip?.vehicleId ? vehicles.get(trip.vehicleId) : null;
    const officeOut = (id, side) => {
      const o = offices.get(id);
      const stop = routesSvc.officeStop(route, id, side);
      const at = trip ? routesSvc.officeTime(trip.departAt, stop) : null;
      return o ? { id: o._id, name: o.name, address: o.address, phone: o.phone || '', directionNote: o.directionNote || '', isActive: o.isActive, arriveAt: iso(at), arriveTime: at ? T.toLocal(at).time : null } : { id, name: '', isActive: false };
    };
    const shuttleOut = (s) => (s ? { id: s.id, direction: s.direction, officeId: s.officeId, zoneId: s.zoneId, zoneName: s.zoneName, addressText: s.addressText, noteText: s.noteText, fee: s.fee, plannedAt: iso(s.plannedAt), plannedTime: s.plannedAt ? T.toLocal(s.plannedAt).time : null, status: s.status } : null);
    const myProofs = proofs.filter((p) => p.orderId === b._id);
    const pending = requests.find((r) => r.orderId === b._id) || null;
    const departed = trip ? now >= trip.departAt : false;
    const hoursLeft = trip ? (trip.departAt - now) / 3600000 : 0;
    const local = trip ? T.toLocal(trip.departAt) : null;
    const lost = (b.seats || []).filter((s) => s.claimState === 'lost');
    const out = {
      id: b._id,
      code: b.code,
      status: b.status,
      source: b.source,
      trip: trip ? {
        id: trip._id, departAt: iso(trip.departAt), date: local.date, departTime: local.time, tzOffset: local.offset,
        arriveAt: iso(T.addMinutes(trip.departAt, trip.durationMinutes)), status: trip.status,
        route: route ? { id: route._id, name: route.name } : null,
        vehicle: vehicle ? { kindLabel: vehicle.kindLabel, ...(b.status === 'confirmed' || admin ? { plateNo: vehicle.plateNo } : {}) } : null,
        updates: logs.filter((l) => l.tripId === trip._id).slice(0, 10).map((l) => ({ kind: l.kind, text: l.text, delayMinutes: l.delayMinutes, atTime: iso(l.atTime) })),
      } : null,
      pickupOffice: officeOut(b.pickupOfficeId, 'pickup'),
      dropOffice: officeOut(b.dropOfficeId, 'drop'),
      pickupShuttle: shuttleOut(b.pickupShuttle),
      dropShuttle: shuttleOut(b.dropShuttle),
      seats: (b.seats || []).map((s) => ({
        id: s.id, seatId: s.seatId, label: s.label, seatClass: s.seatClass, passengerName: s.passengerName, passengerPhone: s.passengerPhone, note: s.note,
        isChild: !!s.isChild, seatPrice: s.seatPrice, surcharge: s.surcharge, childDiscount: s.childDiscount || 0, netAmount: s.netAmount, claimState: s.claimState, boarding: s.boarding || 'none',
      })),
      lostSeats: lost.map((s) => s.label),
      amounts: b.amounts,
      totalAmount: b.totalAmount,
      paidAmount: b.paidAmount || 0,
      refundedAmount: b.refundedAmount || 0,
      promoCode: b.promoCode,
      pointsUsed: b.pointsUsed || 0,
      note: b.note || '',
      payDeadline: iso(b.payDeadline),
      payDeadlineSeconds: b.status === 'awaiting_payment' && b.payDeadline ? Math.max(0, Math.round((b.payDeadline - now) / 1000)) : null,
      proofSubmittedAt: iso(b.proofSubmittedAt),
      confirmedAt: iso(b.confirmedAt),
      completedAt: iso(b.completedAt),
      cancelledAt: iso(b.cancelledAt),
      cancelReason: b.cancelReason,
      proofs: myProofs.map((p) => ({ id: p.id || p._id, status: p.status, uploadedAt: iso(p.uploadedAt), reviewedAt: iso(p.reviewedAt), rejectReason: p.rejectReason, note: p.note || '' })),
      pendingRequest: pending ? { id: pending._id, type: pending.type, status: pending.status, createdAt: iso(pending.createdAt) } : null,
      notices: b.notices || [],
      reviewed: reviewed.has(b._id),
      actions: {
        uploadProof: ['awaiting_payment', 'rejected', 'expired', 'info_requested', 'pending_review'].includes(b.status) && !departed && b.source === 'app',
        cancel: UNPAID.includes(b.status),
        requestCancel: HELD.includes(b.status) && !departed && !pending,
        changeSeat: ['pending_review', 'confirmed'].includes(b.status) && !pending && hoursLeft >= (cp.changeAllowedHoursBefore || 0),
        changeTrip: ['pending_review', 'confirmed', 'seat_lost'].includes(b.status) && !pending && hoursLeft >= (cp.changeAllowedHoursBefore || 0),
        reselectSeats: b.status === 'seat_lost' && !departed,
        requestRefund: b.status === 'seat_lost' && !pending,
        editShuttle: OPEN.includes(b.status) && !departed,
        review: b.status === 'completed' && !reviewed.has(b._id),
        chat: b.status !== 'expired',
      },
      createdAt: iso(b.createdAt),
      updatedAt: iso(b.updatedAt),
    };
    if (admin) {
      const a = accounts.get(b.customerAccountId);
      const g = guests.get(b.guestContactId);
      Object.assign(out, {
        customer: a ? { id: a._id, displayName: a.displayName, phone: a.phone, email: a.email, refundAccount: a.refundAccount || null, emergencyContact: a.emergencyContact || null } : null,
        guest: g ? { id: g._id, name: g.name, phone: g.phone } : null,
        payMethod: b.payMethod, compReason: b.compReason, internalNotes: b.internalNotes || [], bankSnapshot: b.bankSnapshot, cancelPolicySnapshot: b.cancelPolicySnapshot,
        actions: { ...out.actions, uploadProof: false },
      });
    }
    return out;
  });
}

const presentOne = async (b, opts) => (await presentMany([b], opts))[0];

// ---------- quote & create ----------

async function readOrder(c, body, { admin = false } = {}) {
  const tripId = c.id(body, 'tripId', { required: true });
  const seats = readSeats(c, body, { admin });
  const pickupOfficeId = c.id(body, 'pickupOfficeId', { required: true });
  const dropOfficeId = c.id(body, 'dropOfficeId', { required: true });
  const pickupShuttle = pricing.readShuttle(c, body, 'pickupShuttle');
  const dropShuttle = pricing.readShuttle(c, body, 'dropShuttle');
  const promoCode = c.str(body, 'promoCode', { max: 20 }) || null;
  const usePoints = c.int(body, 'usePoints', { max: 1e7 }) || 0;
  const note = c.str(body, 'note', { max: 500 }) || '';
  return { tripId, seats, pickupOfficeId, dropOfficeId, pickupShuttle, dropShuttle, promoCode, usePoints, note };
}

async function prepare(input, { auth, admin = false, mode = 'select', override = null }) {
  const trip = await Trip.findById(input.tripId).lean();
  if (!trip) throw invalid([{ field: 'tripId', code: 'not_found' }]);
  const route = await Route.findById(trip.routeId).lean();
  if (!admin) {
    const st = require('./trips').saleStatus(trip, 1);
    if (st !== 'open' && st !== 'sold_out') throw conflict('trip_not_on_sale', { status: st });
  } else if (['cancelled', 'completed'].includes(trip.status) || trip.departAt < T.addMinutes(new Date(), -trip.durationMinutes)) throw conflict('trip_not_on_sale');
  assertOffices(route, input.pickupOfficeId, input.dropOfficeId);
  await assertOfficesOpen(input.pickupOfficeId, input.dropOfficeId);
  const seats = await resolveSeats(trip, input.seats, mode);
  const now = new Date();
  const pickupShuttle = input.pickupShuttle ? await pricing.shuttleFor('pickup', input.pickupShuttle, { trip, route, officeId: input.pickupOfficeId, now, enforceDeadline: !admin }) : null;
  const dropShuttle = input.dropShuttle ? await pricing.shuttleFor('drop', input.dropShuttle, { trip, route, officeId: input.dropOfficeId, now, enforceDeadline: !admin }) : null;
  const q = await pricing.quote({ trip, seats, pickupShuttle, dropShuttle, promoCode: input.promoCode, usePoints: input.usePoints, accountId: admin ? input.customerAccountId || null : auth?.accountId, override });
  return { trip, route, seats, pickupShuttle, dropShuttle, q };
}

/**
 * POST /v1/bookings/quote — price calculator (46) and order summary (40). Same engine as booking, nothing stored.
 * Seats may be given as `seats[{seatId, isChild}]` or as `seatCount` + `seatClass` (calculator without a seat map).
 */
async function quote(auth, body) {
  const c = new Checker();
  const tripId = c.id(body, 'tripId', { required: true });
  let seats;
  if (Array.isArray(body?.seats)) {
    seats = (c.arr(body, 'seats', { max: 16 }) || []).map((s, i) => ({ seatId: c.str(s, 'seatId', { field: `seats[${i}].seatId`, max: 10 }) || null, isChild: c.bool(s, 'isChild', { field: `seats[${i}].isChild`, def: false }), seatClass: c.str(s, 'seatClass', { field: `seats[${i}].seatClass`, max: 30 }) || null }));
  } else {
    const n = c.int(body, 'seatCount', { min: 1, max: 16 }) || 1;
    const children = c.int(body, 'childCount', { max: 16 }) || 0;
    const seatClass = c.str(body, 'seatClass', { max: 30 }) || 'standard';
    seats = Array.from({ length: n }, (_, i) => ({ seatId: null, seatClass, isChild: i < children }));
  }
  const pickupOfficeId = c.id(body, 'pickupOfficeId');
  const dropOfficeId = c.id(body, 'dropOfficeId');
  const pickupShuttle = pricing.readShuttle(c, body, 'pickupShuttle');
  const dropShuttle = pricing.readShuttle(c, body, 'dropShuttle');
  const promoCode = c.str(body, 'promoCode', { max: 20 }) || null;
  const usePoints = c.int(body, 'usePoints', { max: 1e7 }) || 0;
  c.done();
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw invalid([{ field: 'tripId', code: 'not_found' }]);
  const route = await Route.findById(trip.routeId).lean();
  const ids = seats.filter((s) => s.seatId).map((s) => `${tripId}:${s.seatId}`);
  const docs = new Map((await TripSeat.find({ _id: { $in: ids } }).lean()).map((d) => [d.seatId, d]));
  const resolved = seats.map((s, i) => {
    const d = s.seatId ? docs.get(s.seatId) : null;
    if (s.seatId && !d) throw invalid([{ field: `seats[${i}].seatId`, code: 'not_found' }]);
    return { seatId: s.seatId, label: d?.label || null, seatClass: d?.seatClass || s.seatClass || 'standard', isChild: s.isChild, state: d?.state || null };
  });
  const sp = pickupShuttle && pickupOfficeId ? await pricing.shuttleFor('pickup', pickupShuttle, { trip, route, officeId: pickupOfficeId, enforceDeadline: false }) : null;
  const sd = dropShuttle && dropOfficeId ? await pricing.shuttleFor('drop', dropShuttle, { trip, route, officeId: dropOfficeId, enforceDeadline: false }) : null;
  const q = await pricing.quote({ trip, seats: resolved, pickupShuttle: sp, dropShuttle: sd, promoCode, usePoints, accountId: auth.role === 'customer' ? auth.accountId : null });
  return {
    tripId, lines: q.lines.map((l, i) => ({ ...l, state: resolved[i].state })), amounts: q.amounts, promo: q.promo, pointsUsed: q.pointsUsed,
    pickupShuttle: sp ? { zoneName: sp.zoneName, fee: sp.fee, plannedAt: iso(sp.plannedAt), plannedTime: T.toLocal(sp.plannedAt).time } : null,
    dropShuttle: sd ? { zoneName: sd.zoneName, fee: sd.fee, plannedAt: iso(sd.plannedAt), plannedTime: T.toLocal(sd.plannedAt).time } : null,
  };
}

/** Uses the promo count and the voucher, and books points, inside the creation transaction (41, 92, 227). */
async function consumeDiscounts(doc, q, session) {
  if (q.promo) {
    const ok = await Promotion.findOneAndUpdate(
      { _id: q.promo.id, $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
      { $inc: { usedCount: 1 } },
      { session, new: true },
    );
    if (!ok) throw new AppError(409, 'promo_used_up', { fields: [{ field: 'promoCode', code: 'promo_used_up' }] });
    if (q.voucherId) await Voucher.updateOne({ _id: q.voucherId }, { $set: { status: 'used', usedAt: new Date(), orderId: doc._id } }, { session });
  }
  if (q.pointsUsed > 0) {
    await LoyaltyEntry.create([{ _id: uuid(), accountId: doc.customerAccountId, points: -q.pointsUsed, reason: 'redeem', refType: 'booking', refId: doc._id, at: new Date() }], { session });
  }
}

/** Gives back the promo use, the voucher and the redeemed points (expired / cancelled booking). */
async function releaseDiscounts(b) {
  if (b.promotionId) {
    await Promotion.updateOne({ _id: b.promotionId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    if (b.voucherId) await Voucher.updateOne({ _id: b.voucherId, orderId: b._id }, { $set: { status: 'active', usedAt: null, orderId: null } });
  }
  if (b.pointsUsed > 0) await LoyaltyEntry.create({ _id: uuid(), accountId: b.customerAccountId, points: b.pointsUsed, reason: 'redeem_refund', refType: 'booking', refId: b._id, at: new Date() });
  if (b.pointsAwarded > 0) {
    await LoyaltyEntry.create({ _id: uuid(), accountId: b.customerAccountId, points: -b.pointsAwarded, reason: 'cancel_reversal', refType: 'booking', refId: b._id, at: new Date() });
    await notify.push(b.customerAccountId, 'order', 'points_reverted', { refType: 'booking', refId: b._id, params: { code: b.code, points: b.pointsAwarded } });
  }
}

function bookingSeats(seats, q, holdState) {
  return seats.map((s, i) => ({
    id: uuid(), seatId: s.seatId, label: s.label, seatClass: s.seatClass, passengerName: s.passengerName, passengerPhone: s.passengerPhone ? normalizePhone(s.passengerPhone) || s.passengerPhone : '',
    note: s.note || '', isChild: !!s.isChild, seatPrice: q.lines[i].seatPrice, surcharge: q.lines[i].surcharge, childDiscount: q.lines[i].childDiscount, netAmount: q.lines[i].netAmount,
    claimState: holdState, boarding: 'none',
  }));
}

/** POST /v1/bookings (customer). Does not hold seats. Idempotent with Idempotency-Key. */
async function create(auth, body, { idempotencyKey } = {}) {
  const key = typeof idempotencyKey === 'string' && idempotencyKey ? `booking|${auth.accountId}|${sha256(idempotencyKey.slice(0, 100))}` : null;
  if (key) {
    const r = await Receipt.findById(key).lean();
    if (r) return { status: 200, body: await presentOne(await load(r.result.bookingId)) };
  }
  const c = new Checker();
  const input = await readOrder(c, body);
  c.done();
  const bank = await bankSnapshot();
  if (!bank) throw conflict('bank_not_configured');
  const { trip, route, seats, pickupShuttle, dropShuttle, q } = await prepare(input, { auth });
  const sys = await settings.get('system');
  const now = new Date();
  const doc = {
    _id: uuid(), code: await newCode('SR', Booking), tripId: trip._id, routeId: trip.routeId, departAt: trip.departAt, customerAccountId: auth.accountId, guestContactId: null,
    source: 'app', status: 'awaiting_payment', seats: bookingSeats(seats, q, 'selecting'), pickupOfficeId: input.pickupOfficeId, dropOfficeId: input.dropOfficeId,
    pickupShuttle, dropShuttle, amounts: q.amounts, totalAmount: q.amounts.totalAmount, promoCode: q.promo?.code || null, promotionId: q.promo?.id || null, voucherId: q.voucherId,
    pointsUsed: q.pointsUsed, note: input.note, internalNotes: [], payDeadline: T.addMinutes(now, sys.payDeadlineMinutes), payMethod: 'proof',
    bankSnapshot: bank, cancelPolicySnapshot: await policySnapshot(), notices: [], createdBy: auth.accountId, createdAt: now, updatedAt: now,
  };
  doc.search = searchOf(doc, route.name);
  await withTx(async (session) => {
    await Booking.create([doc], { session });
    await consumeDiscounts(doc, q, session);
    if (key) await Receipt.create([{ _id: key, result: { bookingId: doc._id }, expireAt: new Date(Date.now() + 86400000) }], { session });
  });
  await event(doc, auth, 'created', { newValue: { seats: doc.seats.map((s) => s.label), total: doc.totalAmount } });
  return { status: 201, body: await presentOne(doc) };
}

// ---------- read ----------

const TABS = {
  to_pay: (now) => ({ $or: [{ status: { $in: ['awaiting_payment', 'rejected', 'info_requested', 'seat_lost'] } }, { status: 'expired', departAt: { $gt: now } }] }),
  upcoming: (now) => ({ status: { $in: ['pending_review', 'confirmed'] }, departAt: { $gt: T.addMinutes(now, -720) } }),
  past: (now) => ({ $or: [{ status: 'completed' }, { status: 'confirmed', departAt: { $lte: T.addMinutes(now, -720) } }] }),
  cancelled: (now) => ({ $or: [{ status: 'cancelled' }, { status: 'expired', departAt: { $lte: now } }] }),
};

let lastExpire = 0;
/** Closes bookings past their receipt deadline (156). Lazy (throttled) + daily job. Promo uses are returned. */
async function expireOverdue({ force = false } = {}) {
  if (!force && Date.now() - lastExpire < 30000) return 0;
  lastExpire = Date.now();
  const rows = await Booking.find({ status: 'awaiting_payment', payDeadline: { $lte: new Date() } }).limit(500).lean();
  let n = 0;
  for (const b of rows) {
    const r = await Booking.updateOne({ _id: b._id, status: 'awaiting_payment' }, { $set: { status: 'expired', updatedAt: new Date() } });
    if (!r.modifiedCount) continue;
    n += 1;
    await releaseDiscounts({ ...b, pointsAwarded: 0 });
    await event(b, null, 'expired', { oldValue: 'awaiting_payment', newValue: 'expired' });
    await notify.push(b.customerAccountId, 'order', 'booking_expired', { refType: 'booking', refId: b._id, params: { code: b.code } });
  }
  return n;
}

async function list(auth, query) {
  await expireOverdue();
  const now = new Date();
  const filter = auth.role === 'admin' ? {} : { customerAccountId: auth.accountId };
  if (query.tab && TABS[query.tab]) Object.assign(filter, TABS[query.tab](now));
  if (query.status) filter.status = { $in: String(query.status).split(',') };
  if (auth.role === 'admin') {
    for (const k of ['tripId', 'source', 'customerAccountId', 'guestContactId', 'routeId']) if (query[k]) filter[k] = String(query[k]);
    if (T.isDate(query.from) || T.isDate(query.to)) {
      filter.departAt = {};
      if (T.isDate(query.from)) filter.departAt.$gte = T.dayRange(query.from)[0];
      if (T.isDate(query.to)) filter.departAt.$lt = T.dayRange(query.to)[1];
    }
  }
  if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
    filter.departAt = { $gte: T.localToUtc(`${query.month}-01`), $lt: T.localToUtc(T.addDays(`${query.month}-28`, 4).slice(0, 7) + '-01') };
  }
  if (query.q) filter.search = { $regex: noAccent(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
  const p = paging(query, 20);
  const sort = query.tab === 'past' || query.tab === 'cancelled' ? { departAt: -1 } : query.tab === 'upcoming' ? { departAt: 1 } : { createdAt: -1 };
  const [rows, total] = await Promise.all([Booking.find(filter).sort(sort).skip(p.skip).limit(p.limit + 1).lean(), Booking.countDocuments(filter)]);
  const items = await presentMany(rows.slice(0, p.limit), { admin: auth.role === 'admin' });
  return page(rows.length > p.limit ? [...items, null] : items, p, total);
}

async function get(auth, id) {
  await expireOverdue();
  return presentOne(await loadFor(auth, id), { admin: auth.role === 'admin' });
}

/** GET /v1/bookings/:id/payment-info (48, 49): transfer details + VietQR payload from the booking's bank snapshot. */
async function paymentInfo(auth, id) {
  const b = await loadFor(auth, id);
  const bank = b.bankSnapshot || (await bankSnapshot());
  if (!bank) throw conflict('bank_not_configured');
  const amount = b.totalAmount;
  return {
    orderType: 'booking', orderId: b._id, code: b.code, status: b.status,
    bank: { code: bank.bankCode, bin: bank.bin, shortName: bank.bankShortName, name: bank.bankName },
    accountNo: bank.accountNo, holderName: bank.holderName, amount, transferContent: b.code,
    qrPayload: buildPayload({ bin: bank.bin, accountNo: bank.accountNo, amount, content: b.code }),
    payDeadline: iso(b.payDeadline), payDeadlineSeconds: b.payDeadline ? Math.max(0, Math.round((b.payDeadline - new Date()) / 1000)) : null,
    rule: 'first_receipt_wins',
  };
}

async function history(auth, id) {
  const b = await loadFor(auth, id);
  const filter = { orderType: 'booking', orderId: b._id };
  if (auth.role !== 'admin') filter.internal = false;
  const rows = await OrderEvent.find(filter).sort({ at: 1 }).lean();
  const names = auth.role === 'admin' ? new Map((await Account.find({ _id: { $in: rows.map((r) => r.byAccountId).filter(Boolean) } }).select('displayName').lean()).map((a) => [a._id, a.displayName])) : new Map();
  return { items: rows.map((e) => ({ id: e._id, at: iso(e.at), kind: e.kind, byRole: e.byRole, ...(auth.role === 'admin' ? { byAccountId: e.byAccountId, byName: names.get(e.byAccountId) || null, internal: e.internal } : {}), oldValue: e.oldValue, newValue: e.newValue, note: e.note })) };
}

// ---------- seat claims ----------

// Always scoped to the booking's (old) trip: after a trip change the booking holds seats on the new trip too.
const releaseFilter = (b) => ({ tripId: b.tripId, bookingId: b._id, state: { $in: ['claimed', 'sold'] } });

async function releaseSeats(b, bookingSeatIds = null) {
  const f = releaseFilter(b);
  if (bookingSeatIds) f.bookingSeatId = { $in: bookingSeatIds };
  const freed = await TripSeat.find(f).select('_id').lean();
  await TripSeat.updateMany(f, { $set: { state: 'free', bookingId: null, bookingSeatId: null, claimedAt: null } });
  if (freed.length) await require('./social').waitlistSeatFreed(b.tripId);
  return freed.length;
}

/**
 * Tries to claim every seat of the booking that is not held yet (one conditional update per seat).
 * Returns { held: [labels], lost: [labels] } and the new seats array.
 */
async function claimSeats(b, { state = 'claimed', session = null } = {}) {
  const now = new Date();
  const held = [];
  const lost = [];
  const seats = [];
  for (const s of b.seats) {
    if (s.claimState === 'held') {
      seats.push(s);
      continue;
    }
    const r = await TripSeat.updateOne(
      { _id: `${b.tripId}:${s.seatId}`, state: 'free', isSellable: true },
      { $set: { state, bookingId: b._id, bookingSeatId: s.id, claimedAt: now } },
      { session },
    );
    if (r.modifiedCount) {
      held.push(s.label);
      seats.push({ ...s, claimState: 'held' });
    } else {
      lost.push(s.label);
      seats.push({ ...s, claimState: 'lost' });
    }
  }
  return { held, lost, seats };
}

/** Called by proofs.upload once the photo is stored. Decides by the time the request is processed (652). */
async function onProofStored(b, auth) {
  const now = new Date();
  if (['pending_review', 'info_requested', 'seat_lost'].includes(b.status)) {
    // Extra photo for a booking that already holds its seats.
    const set = { updatedAt: now };
    if (b.status === 'info_requested') set.status = 'pending_review';
    await Booking.updateOne({ _id: b._id }, { $set: set });
    await event(b, auth, 'proof_added', { oldValue: b.status, newValue: set.status || b.status });
    return { lostSeats: [] };
  }
  if (!['awaiting_payment', 'rejected', 'expired'].includes(b.status)) throw conflict('invalid_status');
  const result = await withTx(async (session) => {
    const fresh = await Booking.findById(b._id).session(session).lean();
    if (!['awaiting_payment', 'rejected', 'expired'].includes(fresh.status)) return { held: [], lost: [], seats: fresh.seats, skipped: true };
    const r = await claimSeats(fresh, { session });
    const status = r.lost.length ? 'seat_lost' : 'pending_review';
    await Booking.updateOne({ _id: b._id }, { $set: { status, seats: r.seats, proofSubmittedAt: fresh.proofSubmittedAt || now, updatedAt: now } }, { session });
    return { ...r, status };
  });
  if (result.skipped) return { lostSeats: [] };
  await event(b, auth, result.lost.length ? 'seat_lost' : 'seats_held', { oldValue: b.status, newValue: result.status, note: result.lost.join(', ') });
  if (result.lost.length) await notify.push(b.customerAccountId, 'order', 'seat_lost', { refType: 'booking', refId: b._id, params: { code: b.code, seats: result.lost.join(', ') } });
  return { lostSeats: result.lost };
}

/** POST /v1/bookings/:id/reselect-seats { seats: [{ bookingSeatId, seatId }] } — after losing a seat (55). */
async function reselectSeats(auth, id, body) {
  const b = await loadFor(auth, id);
  if (b.status !== 'seat_lost') throw conflict('invalid_status');
  const c = new Checker();
  const arr = c.arr(body, 'seats', { required: true, max: 16 }) || [];
  const changes = arr.map((x, i) => ({ bookingSeatId: c.id(x, 'bookingSeatId', { field: `seats[${i}].bookingSeatId`, required: true }), seatId: c.str(x, 'seatId', { field: `seats[${i}].seatId`, required: true, max: 10 }) }));
  c.done();
  return reassign(auth, b, changes, { onlyLost: true, reason: '' });
}

/**
 * Moves seats of a booking to other free seats of the same trip (customer after a lost seat, admin 169/170,
 * approved seat change). New seats are claimed with the booking's state; old held seats are released.
 */
async function reassign(auth, b, changes, { onlyLost = false, reason = '' } = {}) {
  const byId = new Map(b.seats.map((s) => [s.id, s]));
  const bad = [];
  changes.forEach((ch, i) => {
    const s = byId.get(ch.bookingSeatId);
    if (!s) bad.push({ field: `seats[${i}].bookingSeatId`, code: 'not_found' });
    else if (onlyLost && s.claimState !== 'lost') bad.push({ field: `seats[${i}].bookingSeatId`, code: 'not_lost' });
  });
  if (bad.length) throw invalid(bad);
  const state = b.status === 'confirmed' || b.status === 'completed' ? 'sold' : 'claimed';
  const now = new Date();
  const taken = [];
  const claimed = [];
  for (const ch of changes) {
    const r = await TripSeat.updateOne({ _id: `${b.tripId}:${ch.seatId}`, state: 'free', isSellable: true }, { $set: { state, bookingId: b._id, bookingSeatId: ch.bookingSeatId, claimedAt: now } });
    if (r.modifiedCount) claimed.push(ch);
    else taken.push(ch.seatId);
  }
  if (taken.length) {
    // all or nothing: give back what we just took
    for (const ch of claimed) await TripSeat.updateOne({ _id: `${b.tripId}:${ch.seatId}`, bookingId: b._id, bookingSeatId: ch.bookingSeatId }, { $set: { state: 'free', bookingId: null, bookingSeatId: null, claimedAt: null } });
    throw new AppError(409, 'seat_taken', { takenSeats: taken, freeSeats: await freeSeats(b.tripId) });
  }
  const docs = new Map((await TripSeat.find({ _id: { $in: changes.map((ch) => `${b.tripId}:${ch.seatId}`) } }).lean()).map((d) => [d.seatId, d]));
  const oldLabels = [];
  const newLabels = [];
  const seats = b.seats.map((s) => {
    const ch = changes.find((x) => x.bookingSeatId === s.id);
    if (!ch) return s;
    oldLabels.push(s.label);
    const d = docs.get(ch.seatId);
    newLabels.push(d.label);
    return { ...s, seatId: ch.seatId, label: d.label, seatClass: d.seatClass, claimState: 'held' };
  });
  // Release the old seats that this booking held (not the ones it lost).
  for (const ch of changes) {
    const old = byId.get(ch.bookingSeatId);
    if (old.claimState === 'held' && old.seatId !== ch.seatId) {
      await TripSeat.updateOne({ _id: `${b.tripId}:${old.seatId}`, bookingId: b._id, bookingSeatId: old.id }, { $set: { state: 'free', bookingId: null, bookingSeatId: null, claimedAt: null } });
    }
  }
  const status = b.status === 'seat_lost' && seats.every((s) => s.claimState === 'held') ? 'pending_review' : b.status;
  const route = await Route.findById(b.routeId).select('name').lean();
  await Booking.updateOne({ _id: b._id }, { $set: { seats, status, search: searchOf({ ...b, seats }, route?.name), updatedAt: now } });
  await event(b, auth, 'seat_changed', { oldValue: oldLabels, newValue: newLabels, note: reason });
  if (auth.role === 'admin') await notify.push(b.customerAccountId, 'order', 'seat_changed', { refType: 'booking', refId: b._id, params: { code: b.code, old: oldLabels.join(', '), new: newLabels.join(', '), reason } });
  await require('./social').waitlistSeatFreed(b.tripId);
  return presentOne(await load(b._id), { admin: auth.role === 'admin' });
}

/** POST /v1/bookings/:id/assign-seats { assignments: [{ bookingSeatId, seatId }], reason } — admin (169, 170). */
async function assignSeats(auth, id, body) {
  const b = await load(id);
  if (!OPEN.includes(b.status)) throw conflict('invalid_status');
  const c = new Checker();
  const arr = c.arr(body, 'assignments', { required: true, max: 16 }) || [];
  const changes = arr.map((x, i) => ({ bookingSeatId: c.id(x, 'bookingSeatId', { field: `assignments[${i}].bookingSeatId`, required: true }), seatId: c.str(x, 'seatId', { field: `assignments[${i}].seatId`, required: true, max: 10 }) }));
  const reason = c.str(body, 'reason', { max: 300 }) || '';
  c.done();
  if (UNPAID.includes(b.status)) {
    // Not holding anything yet: just change the selection.
    const docs = new Map((await TripSeat.find({ _id: { $in: changes.map((ch) => `${b.tripId}:${ch.seatId}`) } }).lean()).map((d) => [d.seatId, d]));
    const seats = b.seats.map((s) => {
      const ch = changes.find((x) => x.bookingSeatId === s.id);
      const d = ch && docs.get(ch.seatId);
      return d ? { ...s, seatId: d.seatId, label: d.label, seatClass: d.seatClass } : s;
    });
    await Booking.updateOne({ _id: id }, { $set: { seats, updatedAt: new Date() } });
    await event(b, auth, 'seat_changed', { oldValue: b.seats.map((s) => s.label), newValue: seats.map((s) => s.label), note: reason });
    return presentOne(await load(id), { admin: true });
  }
  return reassign(auth, b, changes, { reason });
}

/** Moves a booking to another trip of the same route, keeping seat ids when free (165, approved trip change). */
async function moveToTrip(auth, b, toTrip, { seats: wanted = null, reason = '' } = {}) {
  if (toTrip.routeId !== b.routeId) throw invalid([{ field: 'tripId', code: 'different_route' }]);
  if (['cancelled', 'completed'].includes(toTrip.status)) throw conflict('trip_not_on_sale');
  const free = await TripSeat.find({ tripId: toTrip._id, state: 'free', isSellable: true }).sort({ row: 1, col: 1 }).lean();
  const pool = new Map(free.map((s) => [s.seatId, s]));
  const plan = [];
  for (const s of b.seats) {
    const want = wanted?.find((w) => w.bookingSeatId === s.id)?.seatId;
    let target = want ? pool.get(want) : pool.get(s.seatId);
    if (!target && !want) target = [...pool.values()].find((x) => x.seatClass === s.seatClass) || [...pool.values()][0];
    if (!target) throw new AppError(409, 'seat_taken', { missing: s.label, freeSeats: free.map((x) => x.seatId) });
    pool.delete(target.seatId);
    plan.push({ seat: s, target });
  }
  const state = b.status === 'confirmed' ? 'sold' : 'claimed';
  const holds = HELD.includes(b.status);
  const now = new Date();
  const got = [];
  if (holds) {
    for (const p of plan) {
      const r = await TripSeat.updateOne({ _id: p.target._id, state: 'free' }, { $set: { state, bookingId: b._id, bookingSeatId: p.seat.id, claimedAt: now } });
      if (!r.modifiedCount) {
        for (const g of got) await TripSeat.updateOne({ _id: g.target._id, bookingId: b._id }, { $set: { state: 'free', bookingId: null, bookingSeatId: null, claimedAt: null } });
        throw new AppError(409, 'seat_taken', { takenSeats: [p.target.seatId] });
      }
      got.push(p);
    }
    await releaseSeats({ ...b, tripId: b.tripId });
  }
  const route = await Route.findById(toTrip.routeId).lean();
  const shift = toTrip.departAt - b.departAt;
  const moveShuttle = (sh) => (sh ? { ...sh, plannedAt: new Date(new Date(sh.plannedAt).getTime() + shift), updatedAt: now } : null);
  const seats = plan.map((p) => ({ ...p.seat, seatId: p.target.seatId, label: p.target.label, seatClass: p.target.seatClass, claimState: holds ? 'held' : p.seat.claimState === 'lost' ? 'selecting' : p.seat.claimState, boarding: 'none' }));
  const status = b.status === 'seat_lost' ? 'pending_review' : b.status;
  await Booking.updateOne({ _id: b._id }, { $set: { tripId: toTrip._id, departAt: toTrip.departAt, seats, status, pickupShuttle: moveShuttle(b.pickupShuttle), dropShuttle: moveShuttle(b.dropShuttle), search: searchOf({ ...b, seats }, route?.name), updatedAt: now } });
  await PaymentProof.updateMany({ orderType: 'booking', orderId: b._id }, { $set: { tripId: toTrip._id, departAt: toTrip.departAt } });
  await event(b, auth, 'trip_changed', { oldValue: { tripId: b.tripId, departAt: iso(b.departAt), seats: b.seats.map((s) => s.label) }, newValue: { tripId: toTrip._id, departAt: iso(toTrip.departAt), seats: seats.map((s) => s.label) }, note: reason });
  const l = T.toLocal(toTrip.departAt);
  await notify.push(b.customerAccountId, 'order', 'booking_moved', { refType: 'booking', refId: b._id, params: { code: b.code, date: l.date, time: l.time } });
  return load(b._id);
}

// ---------- cancel & refunds ----------

/** Refund preview by the cancellation time vs departure, with the policy saved in the booking (72, 73, 642). */
function refundPreview(b, trip, now = new Date()) {
  const policy = b.cancelPolicySnapshot || { tiers: [], cancelFee: 0, shuttleFeeRefundable: true };
  const paid = b.paidAmount > 0 ? b.paidAmount : ['pending_review', 'info_requested', 'seat_lost'].includes(b.status) ? b.totalAmount : 0;
  const hoursBefore = Math.max(0, (trip.departAt - now) / 3600000);
  const tiers = [...(policy.tiers || [])].sort((x, y) => y.hoursBefore - x.hoursBefore);
  const tier = tiers.find((t) => hoursBefore >= t.hoursBefore) || null;
  const percent = tier ? tier.refundPercent : 0;
  const shuttleFees = Math.min(paid, b.amounts?.shuttleAmount || 0);
  const shuttleRefund = policy.shuttleFeeRefundable ? shuttleFees : 0;
  const base = Math.max(0, paid - shuttleFees);
  const fee = paid > 0 ? policy.cancelFee || 0 : 0;
  const refundAmount = Math.max(0, Math.round((base * percent) / 100) + shuttleRefund - fee);
  return { paidAmount: paid, hoursBefore: Math.round(hoursBefore * 10) / 10, tier, refundPercent: percent, shuttleRefund, cancelFee: fee, refundAmount, policy: policy.tiers };
}

async function cancelPreview(auth, id) {
  const b = await loadFor(auth, id);
  const trip = await Trip.findById(b.tripId).lean();
  return { bookingId: b._id, status: b.status, immediate: UNPAID.includes(b.status), ...refundPreview(b, trip) };
}

/**
 * Cancels a booking: releases seats and shuttles, gives back promo/points, creates a pending refund when money
 * was paid. Used by customers (unpaid bookings), approved cancel requests, admin cancel and trip cancellation.
 */
async function cancelBooking(auth, b, { reason = 'customer', note = '', refundAmount = null, fullRefund = false, silent = false } = {}) {
  if (['cancelled', 'completed'].includes(b.status)) throw conflict('invalid_status');
  const trip = await Trip.findById(b.tripId).lean();
  const preview = refundPreview(b, trip);
  const amount = refundAmount ?? (fullRefund ? preview.paidAmount : preview.refundAmount);
  const now = new Date();
  const r = await Booking.updateOne(
    { _id: b._id, status: b.status },
    { $set: { status: 'cancelled', cancelledAt: now, cancelReason: reason, updatedAt: now, ...(b.pickupShuttle ? { 'pickupShuttle.status': 'cancelled' } : {}), ...(b.dropShuttle ? { 'dropShuttle.status': 'cancelled' } : {}) } },
  );
  if (!r.modifiedCount) throw conflict('invalid_status');
  await releaseSeats(b);
  await releaseDiscounts(b);
  await OrderRequest.updateMany({ orderId: b._id, status: 'pending', type: { $ne: 'cancel' } }, { $set: { status: 'withdrawn', decidedAt: now } });
  const sys = await settings.get('system');
  const proofs = await PaymentProof.find({ orderType: 'booking', orderId: b._id }).select('fileId').lean();
  await FileObject.updateMany({ _id: { $in: proofs.map((p) => p.fileId) }, deleteAfter: null }, { $set: { deleteAfter: T.addMinutes(now, sys.proofRetentionDays * 1440) } });
  if (amount > 0) {
    const account = b.customerAccountId ? await Account.findById(b.customerAccountId).select('refundAccount').lean() : null;
    await Refund.create({ _id: uuid(), orderType: 'booking', orderId: b._id, orderCode: b.code, accountId: b.customerAccountId, amount, reason, status: 'pending', refundAccount: account?.refundAccount || null, tripId: b.tripId, routeId: b.routeId, note, createdAt: now });
  }
  await event(b, auth, 'cancelled', { oldValue: b.status, newValue: 'cancelled', note: [reason, note].filter(Boolean).join(': ') });
  if (!silent || amount > 0) {
    await notify.push(b.customerAccountId, 'order', amount > 0 ? 'refund_pending' : 'booking_cancelled', { refType: 'booking', refId: b._id, params: { code: b.code, amount, note } });
  }
  return { refundAmount: amount, preview };
}

/**
 * POST /v1/bookings/:id/cancel { note } (customer). Unpaid bookings are cancelled right away; bookings with a receipt
 * or a confirmed payment create a cancel request with the computed refund, for the admin to approve (148).
 */
async function requestCancel(auth, id, body) {
  const b = await loadFor(auth, id);
  const c = new Checker();
  const note = c.str(body, 'note', { max: 500 }) || '';
  c.done();
  if (UNPAID.includes(b.status)) {
    await cancelBooking(auth, b, { reason: 'customer', note });
    return { status: 'cancelled', booking: await presentOne(await load(id)) };
  }
  if (!HELD.includes(b.status)) throw conflict('cancel_not_allowed');
  const trip = await Trip.findById(b.tripId).lean();
  if (new Date() >= trip.departAt) throw conflict('cancel_not_allowed');
  const req = await openRequest(auth, b, 'cancel', { note, refundPreview: refundPreview(b, trip) });
  return { status: 'requested', request: req, booking: await presentOne(await load(id)) };
}

async function openRequest(auth, b, type, { payload = {}, priceDiff = 0, refundPreview: rp = null, note = '' }) {
  if (await OrderRequest.exists({ orderId: b._id, status: 'pending' })) throw conflict('pending_request_exists');
  const doc = { _id: uuid(), orderType: 'booking', orderId: b._id, orderCode: b.code, accountId: b.customerAccountId, type, status: 'pending', payload, priceDiff, refundPreview: rp, note, tripId: b.tripId, departAt: b.departAt, createdAt: new Date() };
  await OrderRequest.create(doc);
  await event(b, auth, `${type}_requested`, { newValue: { ...payload, priceDiff, refund: rp?.refundAmount }, note });
  return presentRequest(doc);
}

const presentRequest = (r) => ({
  id: r._id, orderType: r.orderType, orderId: r.orderId, orderCode: r.orderCode, accountId: r.accountId, type: r.type, status: r.status, payload: r.payload,
  priceDiff: r.priceDiff, refundPreview: r.refundPreview, note: r.note, decisionNote: r.decisionNote, decidedAt: iso(r.decidedAt), createdAt: iso(r.createdAt),
  tripId: r.tripId, departAt: iso(r.departAt),
});

/**
 * POST /v1/bookings/:id/requests { type: change_seat|change_trip|refund, seats?, tripId?, note } (74, 75, 55).
 * - change_seat: seats [{ bookingSeatId, seatId }] of the same trip (checked free now, claimed on approval)
 * - change_trip: tripId (same route) + optional seats [{ bookingSeatId, seatId }]; price difference shown
 * - refund: only after losing a seat (seat_lost)
 */
async function createRequest(auth, id, body) {
  const b = await loadFor(auth, id);
  const c = new Checker();
  const type = c.oneOf(body, 'type', ['change_seat', 'change_trip', 'refund', 'cancel'], { required: true });
  const note = c.str(body, 'note', { max: 500 }) || '';
  const arr = c.arr(body, 'seats', { max: 16 });
  const seats = Array.isArray(arr) ? arr.map((x, i) => ({ bookingSeatId: c.id(x, 'bookingSeatId', { field: `seats[${i}].bookingSeatId`, required: true }), seatId: c.str(x, 'seatId', { field: `seats[${i}].seatId`, required: true, max: 10 }) })) : null;
  const tripId = type === 'change_trip' ? c.id(body, 'tripId', { required: true }) : null;
  c.done();
  if (type === 'cancel') return requestCancel(auth, id, body);
  const trip = await Trip.findById(b.tripId).lean();
  const cp = b.cancelPolicySnapshot || (await settings.get('cancelPolicy'));
  const hoursLeft = (trip.departAt - new Date()) / 3600000;
  if (type === 'refund') {
    if (b.status !== 'seat_lost') throw conflict('invalid_status');
    const lostAmount = b.seats.filter((s) => s.claimState === 'lost').reduce((t, s) => t + (s.netAmount || 0), 0);
    const allLost = b.seats.every((s) => s.claimState === 'lost');
    return { request: await openRequest(auth, b, 'refund', { payload: { seats: b.seats.filter((s) => s.claimState === 'lost').map((s) => s.id) }, refundPreview: { refundAmount: allLost ? b.totalAmount : lostAmount, refundPercent: 100 }, note }) };
  }
  if (!['pending_review', 'confirmed', 'seat_lost'].includes(b.status) || (type === 'change_seat' && b.status === 'seat_lost')) throw conflict('invalid_status');
  if (hoursLeft < (cp.changeAllowedHoursBefore || 0)) throw conflict('change_not_allowed');
  if (type === 'change_seat') {
    if (!seats?.length) throw invalid([{ field: 'seats', code: 'required' }]);
    const docs = await TripSeat.find({ _id: { $in: seats.map((s) => `${b.tripId}:${s.seatId}`) } }).lean();
    const notFree = seats.filter((s) => docs.find((d) => d.seatId === s.seatId)?.state !== 'free').map((s) => s.seatId);
    if (notFree.length) throw new AppError(409, 'seat_taken', { takenSeats: notFree, freeSeats: await freeSeats(b.tripId) });
    return { request: await openRequest(auth, b, 'change_seat', { payload: { seats }, note }) };
  }
  const to = await Trip.findById(tripId).lean();
  if (!to || to.routeId !== b.routeId) throw invalid([{ field: 'tripId', code: 'different_route' }]);
  const seatClasses = await settings.get('seatClasses');
  const seasonal = await pricing.seasonalFor(to);
  const newAmount = b.seats.reduce((t, s) => {
    const p = pricing.classPrice(to, s.seatClass, seatClasses.items, seasonal);
    return t + p.seatPrice + p.surcharge - (s.childDiscount || 0);
  }, 0);
  const oldAmount = b.seats.reduce((t, s) => t + s.seatPrice + s.surcharge - (s.childDiscount || 0), 0);
  const priceDiff = newAmount - oldAmount + (cp.changeFee || 0);
  return { request: await openRequest(auth, b, 'change_trip', { payload: { tripId, seats }, priceDiff, note }) };
}

/** Admin decision on a request (148, 150, 151, 147). */
async function decideRequest(auth, id, body, approve) {
  const req = await OrderRequest.findById(id).lean();
  if (!req) throw notFound();
  if (req.status !== 'pending') throw conflict('invalid_status');
  const c = new Checker();
  const note = c.str(body, 'note', { max: 500 }) || '';
  const refundAmount = c.money(body, 'refundAmount');
  c.done();
  const b = await load(req.orderId);
  let result = {};
  if (approve) {
    if (req.type === 'cancel') {
      result = await cancelBooking(auth, b, { reason: 'customer', note, refundAmount: refundAmount ?? req.refundPreview?.refundAmount ?? null });
    } else if (req.type === 'change_seat') {
      await reassign(auth, b, req.payload.seats, { reason: note });
    } else if (req.type === 'change_trip') {
      const to = await Trip.findById(req.payload.tripId).lean();
      if (!to) throw notFound();
      await moveToTrip(auth, b, to, { seats: req.payload.seats, reason: note });
      if (req.priceDiff < 0 && b.paidAmount > 0) {
        await Refund.create({ _id: uuid(), orderType: 'booking', orderId: b._id, orderCode: b.code, accountId: b.customerAccountId, amount: -req.priceDiff, reason: 'change_diff', status: 'pending', tripId: req.payload.tripId, routeId: b.routeId, note, createdAt: new Date() });
      }
    } else if (req.type === 'refund') {
      const lostIds = new Set(req.payload.seats || []);
      const remaining = b.seats.filter((s) => !lostIds.has(s.id));
      const amount = refundAmount ?? req.refundPreview?.refundAmount ?? 0;
      if (!remaining.length) {
        result = await cancelBooking(auth, b, { reason: 'seat_lost', note, refundAmount: amount });
      } else {
        const lostAmount = b.seats.filter((s) => lostIds.has(s.id)).reduce((t, s) => t + (s.netAmount || 0), 0);
        await Booking.updateOne({ _id: b._id }, { $set: { seats: remaining, status: 'pending_review', totalAmount: b.totalAmount - lostAmount, 'amounts.totalAmount': b.totalAmount - lostAmount, updatedAt: new Date() } });
        await Refund.create({ _id: uuid(), orderType: 'booking', orderId: b._id, orderCode: b.code, accountId: b.customerAccountId, amount, reason: 'seat_lost', status: 'pending', tripId: b.tripId, routeId: b.routeId, note, createdAt: new Date() });
        await event(b, auth, 'seats_removed', { oldValue: b.seats.filter((s) => lostIds.has(s.id)).map((s) => s.label), note });
        result = { refundAmount: amount };
      }
    }
  }
  await OrderRequest.updateOne({ _id: id }, { $set: { status: approve ? 'approved' : 'rejected', decidedBy: auth.accountId, decidedAt: new Date(), decisionNote: note } });
  await event(b, auth, approve ? 'request_approved' : 'request_rejected', { newValue: req.type, note });
  await notify.push(b.customerAccountId, 'order', approve ? 'request_approved' : 'request_rejected', { refType: 'booking', refId: b._id, params: { code: b.code, type: req.type, note } });
  return { request: presentRequest(await OrderRequest.findById(id).lean()), booking: await presentOne(await load(b._id), { admin: true }), ...result };
}

async function listRequests(auth, query) {
  const filter = auth.role === 'admin' ? {} : { accountId: auth.accountId };
  if (query.status) filter.status = String(query.status);
  if (query.type) filter.type = { $in: String(query.type).split(',') };
  if (query.bookingId) filter.orderId = String(query.bookingId);
  const p = paging(query, 30);
  const [rows, total] = await Promise.all([OrderRequest.find(filter).sort({ createdAt: auth.role === 'admin' ? 1 : -1 }).skip(p.skip).limit(p.limit + 1).lean(), OrderRequest.countDocuments(filter)]);
  return page(rows.map(presentRequest), p, total);
}

async function withdrawRequest(auth, id) {
  const r = await OrderRequest.findOneAndUpdate({ _id: id, accountId: auth.accountId, status: 'pending' }, { $set: { status: 'withdrawn', decidedAt: new Date() } }, { new: true }).lean();
  if (!r) throw notFound();
  return presentRequest(r);
}

/** Admin cancel (138, 164): POST /manage/bookings/:id/cancel { reason, refundAmount?, note }. */
async function adminCancel(auth, id, body) {
  const b = await load(id);
  const c = new Checker();
  const reason = c.str(body, 'reason', { max: 100 }) || 'admin';
  const note = c.str(body, 'note', { max: 500 }) || '';
  const refundAmount = c.money(body, 'refundAmount');
  c.done();
  const r = await cancelBooking(auth, b, { reason, note, refundAmount: refundAmount ?? null });
  return { ...r, booking: await presentOne(await load(id), { admin: true }) };
}

// ---------- refunds (149) ----------

const presentRefund = (r) => ({
  id: r._id, orderType: r.orderType, orderId: r.orderId, orderCode: r.orderCode, accountId: r.accountId, amount: r.amount, reason: r.reason, status: r.status,
  refundAccount: r.refundAccount, note: r.note, recordedBy: r.recordedBy, recordedAt: iso(r.recordedAt), createdAt: iso(r.createdAt),
});

async function listRefunds(auth, query) {
  const filter = auth.role === 'admin' ? {} : { accountId: auth.accountId };
  if (query.status) filter.status = String(query.status);
  if (query.orderType) filter.orderType = String(query.orderType);
  const p = paging(query, 30);
  const [rows, total] = await Promise.all([Refund.find(filter).sort({ createdAt: auth.role === 'admin' ? 1 : -1 }).skip(p.skip).limit(p.limit + 1).lean(), Refund.countDocuments(filter)]);
  // Latest refund account of the customer (the one saved in Profile), for the admin doing the transfer.
  if (auth.role === 'admin') {
    const accs = new Map((await Account.find({ _id: { $in: rows.map((r) => r.accountId).filter(Boolean) } }).select('refundAccount displayName phone').lean()).map((a) => [a._id, a]));
    return page(rows.map((r) => ({ ...presentRefund(r), refundAccount: r.refundAccount || accs.get(r.accountId)?.refundAccount || null, customer: accs.get(r.accountId) ? { displayName: accs.get(r.accountId).displayName, phone: accs.get(r.accountId).phone } : null })), p, total);
  }
  return page(rows.map(presentRefund), p, total);
}

/** POST /manage/refunds/:id/record { amount?, note? } — the admin says the money was transferred back. */
async function recordRefund(auth, id, body) {
  const c = new Checker();
  const amount = c.money(body, 'amount');
  const note = c.str(body, 'note', { max: 500 });
  c.done();
  const r = await Refund.findOneAndUpdate({ _id: id, status: 'pending' }, { $set: { status: 'recorded', recordedBy: auth.accountId, recordedAt: new Date(), ...(amount !== undefined ? { amount } : {}), ...(note ? { note } : {}) } }, { new: true }).lean();
  if (!r) throw notFound();
  await afterRefund(auth, r);
  return presentRefund(r);
}

async function afterRefund(auth, r) {
  const Model = r.orderType === 'booking' ? Booking : models.Parcel;
  await Model.updateOne({ _id: r.orderId }, { $inc: { refundedAmount: r.amount }, $set: { updatedAt: new Date() } });
  await OrderEvent.create({ _id: uuid(), orderType: r.orderType, orderId: r.orderId, byAccountId: auth.accountId, byRole: 'admin', kind: 'refund_recorded', newValue: r.amount, note: r.note || '' });
  await notify.push(r.accountId, r.orderType === 'booking' ? 'order' : 'parcel', 'refund_recorded', { refType: r.orderType, refId: r.orderId, params: { code: r.orderCode, amount: r.amount } });
}

/** POST /v1/bookings/:id/refund { amount, note } (admin): records a refund directly (spec endpoint). */
async function refundBooking(auth, id, body) {
  const b = await load(id);
  const c = new Checker();
  const amount = c.money(body, 'amount', { required: true });
  const note = c.str(body, 'note', { max: 500 }) || '';
  c.done();
  const pending = await Refund.findOne({ orderType: 'booking', orderId: id, status: 'pending' }).lean();
  if (pending) return recordRefund(auth, pending._id, { amount, note });
  const account = b.customerAccountId ? await Account.findById(b.customerAccountId).select('refundAccount').lean() : null;
  const r = { _id: uuid(), orderType: 'booking', orderId: id, orderCode: b.code, accountId: b.customerAccountId, amount, reason: 'manual', status: 'recorded', refundAccount: account?.refundAccount || null, tripId: b.tripId, routeId: b.routeId, note, recordedBy: auth.accountId, recordedAt: new Date(), createdAt: new Date() };
  await Refund.create(r);
  await afterRefund(auth, r);
  return presentRefund(r);
}

// ---------- shuttle (76, 174, 215) ----------

/** PATCH /v1/bookings/:id/shuttle { pickupShuttle?, dropShuttle? } — before the deadline; fee changes only before paying. */
async function updateShuttle(auth, id, body) {
  const b = await loadFor(auth, id);
  if (!OPEN.includes(b.status)) throw conflict('invalid_status');
  const trip = await Trip.findById(b.tripId).lean();
  const route = await Route.findById(trip.routeId).lean();
  const rules = await settings.get('shuttle');
  const admin = auth.role === 'admin';
  if (!admin && new Date() > T.addMinutes(trip.departAt, -rules.registerHoursBefore * 60)) throw conflict('shuttle_deadline_passed');
  const c = new Checker();
  const set = {};
  for (const [key, dir, officeId] of [['pickupShuttle', 'pickup', b.pickupOfficeId], ['dropShuttle', 'drop', b.dropOfficeId]]) {
    if (body?.[key] === undefined) continue;
    const input = pricing.readShuttle(c, body, key);
    c.done();
    const current = b[key];
    if (!input) {
      set[key] = null;
      continue;
    }
    const sameZone = current && current.zoneId === input.zoneId;
    set[key] = sameZone ? { ...current, addressText: input.addressText, noteText: input.noteText, updatedAt: new Date() } : await pricing.shuttleFor(dir, { ...input, id: current?.id }, { trip, route, officeId, enforceDeadline: !admin });
  }
  c.done();
  const feeOf = (k) => (k in set ? set[k]?.fee || 0 : b[k]?.fee || 0);
  const newShuttle = feeOf('pickupShuttle') + feeOf('dropShuttle');
  if (newShuttle !== (b.amounts?.shuttleAmount || 0)) {
    if (!admin && !UNPAID.includes(b.status)) throw conflict('invalid_status', { hint: 'contact_operator' });
    const amounts = { ...b.amounts, shuttleAmount: newShuttle };
    amounts.subtotal = amounts.seatsAmount + amounts.surchargeAmount - amounts.childDiscount + newShuttle;
    amounts.totalAmount = Math.max(0, amounts.subtotal - amounts.discountAmount);
    set.amounts = amounts;
    set.totalAmount = amounts.totalAmount;
  }
  set.updatedAt = new Date();
  await Booking.updateOne({ _id: id }, { $set: set });
  await event(b, auth, 'shuttle_changed', { oldValue: { pickup: b.pickupShuttle?.addressText || null, drop: b.dropShuttle?.addressText || null }, newValue: { pickup: (set.pickupShuttle ?? b.pickupShuttle)?.addressText || null, drop: (set.dropShuttle ?? b.dropShuttle)?.addressText || null } });
  return presentOne(await load(id), { admin });
}

/** PATCH /manage/shuttle-requests/:id { status?, zoneId?, addressText?, noteText?, plannedAt? } (174, 215). */
async function adminShuttle(auth, shuttleId, body) {
  const b = await Booking.findOne({ $or: [{ 'pickupShuttle.id': shuttleId }, { 'dropShuttle.id': shuttleId }] }).lean();
  if (!b) throw notFound();
  const key = b.pickupShuttle?.id === shuttleId ? 'pickupShuttle' : 'dropShuttle';
  const c = new Checker();
  const status = c.oneOf(body, 'status', ['pending', 'done', 'absent', 'cancelled']);
  const addressText = c.str(body, 'addressText', { max: 300 });
  const noteText = c.str(body, 'noteText', { max: 300 });
  const zoneId = c.id(body, 'zoneId');
  const plannedAt = c.datetime(body, 'plannedAt');
  c.done();
  let sh = { ...b[key] };
  if (zoneId && zoneId !== sh.zoneId) {
    const trip = await Trip.findById(b.tripId).lean();
    const route = await Route.findById(trip.routeId).lean();
    sh = await pricing.shuttleFor(sh.direction, { id: sh.id, zoneId, addressText: addressText || sh.addressText, noteText: noteText ?? sh.noteText }, { trip, route, officeId: sh.officeId, enforceDeadline: false });
    sh.fee = b[key].fee; // fee stays as booked; the admin settles differences outside
  }
  if (status) sh.status = status;
  if (addressText) sh.addressText = addressText;
  if (noteText !== undefined) sh.noteText = noteText || '';
  if (plannedAt) sh.plannedAt = plannedAt;
  sh.updatedAt = new Date();
  await Booking.updateOne({ _id: b._id }, { $set: { [key]: sh, updatedAt: new Date() } });
  await event(b, auth, 'shuttle_updated', { oldValue: { status: b[key].status, addressText: b[key].addressText, plannedAt: iso(b[key].plannedAt) }, newValue: { status: sh.status, addressText: sh.addressText, plannedAt: iso(sh.plannedAt) } });
  if (zoneId || addressText || plannedAt) await notify.push(b.customerAccountId, 'trip', 'shuttle_changed', { refType: 'booking', refId: b._id, params: { code: b.code, direction: sh.direction, note: plannedAt ? T.toLocal(plannedAt).time : '' } });
  return presentOne(await load(b._id), { admin: true });
}

// ---------- admin bookings for guests (130-138) ----------

async function upsertGuest(auth, guest) {
  const phone = normalizePhone(guest.phone) || guest.phone;
  const existing = await GuestContact.findOne({ phone }).lean();
  if (existing) {
    if (guest.name && guest.name !== existing.name) await GuestContact.updateOne({ _id: existing._id }, { $set: { name: guest.name, updatedAt: new Date() } });
    return existing._id;
  }
  const now = new Date();
  const doc = { _id: uuid(), name: guest.name, phone, note: guest.note || '', linkedAccountId: null, search: noAccent(`${guest.name} ${phone}`), createdBy: auth.accountId, createdAt: now, updatedAt: now };
  await GuestContact.create(doc);
  return doc._id;
}

/**
 * POST /manage/bookings — seats are taken as 'sold' at once, all or nothing. A seat already claimed by a receipt
 * is never taken: 409 seat_taken + free seats (134). payMethod: cash | transfer | free (free needs compReason).
 * `specialPrice` (per seat, 133) also needs compReason.
 */
async function adminCreate(auth, body) {
  const c = new Checker();
  const input = await readOrder(c, body, { admin: true });
  const g = c.obj(body, 'guest');
  const customerAccountId = c.id(body, 'customerAccountId');
  const guest = g ? { name: c.str(g, 'name', { field: 'guest.name', required: true, max: 80 }), phone: c.phone(g, 'phone', { field: 'guest.phone', required: true }), note: c.str(g, 'note', { field: 'guest.note', max: 300 }) || '' } : null;
  if (!guest && !customerAccountId) c.fail('guest', 'required');
  const payMethod = c.oneOf(body, 'payMethod', ['cash', 'transfer', 'free'], { required: true });
  const specialPrice = c.money(body, 'specialPrice');
  const compReason = c.str(body, 'compReason', { max: 300 }) || null;
  if ((payMethod === 'free' || specialPrice !== undefined) && !compReason) c.fail('compReason', 'required');
  const paymentNote = c.str(body, 'paymentNote', { max: 300 }) || '';
  c.done();
  if (customerAccountId && !(await Account.exists({ _id: customerAccountId, role: 'customer' }))) throw invalid([{ field: 'customerAccountId', code: 'not_found' }]);
  input.customerAccountId = customerAccountId || null;
  const override = payMethod === 'free' ? { seatPrice: 0 } : specialPrice !== undefined ? { seatPrice: specialPrice } : null;
  const prep = await prepare(input, { auth, admin: true, mode: 'any', override });
  const listPrice = override ? (await pricing.quote({ trip: prep.trip, seats: prep.seats, pickupShuttle: prep.pickupShuttle, dropShuttle: prep.dropShuttle })).amounts.totalAmount : prep.q.amounts.totalAmount;
  const now = new Date();
  const doc = {
    _id: uuid(), code: await newCode('SR', Booking), tripId: prep.trip._id, routeId: prep.trip.routeId, departAt: prep.trip.departAt,
    customerAccountId: input.customerAccountId, guestContactId: guest ? await upsertGuest(auth, guest) : null, source: 'admin', status: 'confirmed',
    seats: bookingSeats(prep.seats, prep.q, 'held'), pickupOfficeId: input.pickupOfficeId, dropOfficeId: input.dropOfficeId,
    pickupShuttle: prep.pickupShuttle, dropShuttle: prep.dropShuttle, amounts: prep.q.amounts, totalAmount: prep.q.amounts.totalAmount,
    promoCode: prep.q.promo?.code || null, promotionId: prep.q.promo?.id || null, voucherId: prep.q.voucherId, pointsUsed: prep.q.pointsUsed, note: input.note, internalNotes: [],
    payDeadline: null, proofSubmittedAt: null, confirmedAt: now, payMethod, compReason, paidAmount: prep.q.amounts.totalAmount, bankSnapshot: null,
    cancelPolicySnapshot: await policySnapshot(), notices: [], createdBy: auth.accountId, createdAt: now, updatedAt: now,
  };
  doc.search = searchOf(doc, prep.route.name);
  // Claim all seats as sold, all or nothing.
  const got = [];
  for (const s of doc.seats) {
    const r = await TripSeat.updateOne({ _id: `${doc.tripId}:${s.seatId}`, state: 'free', isSellable: true }, { $set: { state: 'sold', bookingId: doc._id, bookingSeatId: s.id, claimedAt: now } });
    if (!r.modifiedCount) {
      for (const g2 of got) await TripSeat.updateOne({ _id: `${doc.tripId}:${g2.seatId}`, bookingId: doc._id }, { $set: { state: 'free', bookingId: null, bookingSeatId: null, claimedAt: null } });
      const seat = await TripSeat.findById(`${doc.tripId}:${s.seatId}`).lean();
      throw new AppError(409, 'seat_taken', { takenSeats: [s.seatId], takenState: seat?.state, freeSeats: await freeSeats(doc.tripId) });
    }
    got.push(s);
  }
  try {
    await withTx(async (session) => {
      await Booking.create([doc], { session });
      await consumeDiscounts(doc, prep.q, session);
      await PaymentRecord.create([{
        _id: uuid(), orderType: 'booking', orderId: doc._id, source: 'admin', method: payMethod, amount: payMethod === 'free' ? 0 : doc.totalAmount,
        compValue: override ? Math.max(0, listPrice - doc.totalAmount) : 0, reason: compReason, note: paymentNote,
        tripId: doc.tripId, routeId: doc.routeId, vehicleId: prep.trip.vehicleId, departAt: doc.departAt, recordedBy: auth.accountId, recordedAt: now,
      }], { session });
    });
  } catch (err) {
    await releaseSeats(doc);
    throw err;
  }
  await event(doc, auth, 'created_by_admin', { newValue: { seats: doc.seats.map((s) => s.label), payMethod, total: doc.totalAmount }, note: compReason || '' });
  const out = await presentOne(doc, { admin: true });
  return { ...out, shareText: await shareText(auth, doc._id, 'vi') };
}

/** POST /manage/bookings/:id/notes { text } (154). */
async function addNote(auth, id, body) {
  const b = await load(id);
  const c = new Checker();
  const text = c.str(body, 'text', { required: true, max: 1000 });
  c.done();
  const note = { id: uuid(), text, byAccountId: auth.accountId, byName: auth.account.displayName, at: new Date().toISOString() };
  await Booking.updateOne({ _id: id }, { $push: { internalNotes: note }, $set: { updatedAt: new Date() } });
  await event(b, auth, 'note', { note: text, internal: true });
  return note;
}

/** Ticket / trip info as plain text for Zalo (79, 137). No receipt, no email. */
async function shareText(auth, id, lang = 'vi') {
  const b = await loadFor(auth, id);
  const [view] = await presentMany([b]);
  const op = await settings.get('operator');
  const en = lang === 'en';
  const lines = [
    `${op.name || 'SeatRoute'}${op.phone ? ` - ${op.phone}` : ''}`,
    `${en ? 'Booking code' : 'Mã đặt chỗ'}: ${b.code}`,
    `${en ? 'Trip' : 'Chuyến'}: ${view.trip?.route?.name || ''}`,
    `${en ? 'Departure' : 'Khởi hành'}: ${view.trip?.departTime} ${view.trip?.date}`,
    `${en ? 'Seats' : 'Ghế'}: ${b.seats.map((s) => `${s.label} (${s.passengerName})`).join(', ')}`,
    `${en ? 'Pickup office' : 'Lên xe'}: ${view.pickupOffice.name}${view.pickupOffice.arriveTime ? ` - ${view.pickupOffice.arriveTime}` : ''}, ${view.pickupOffice.address || ''}`,
    `${en ? 'Drop-off office' : 'Xuống xe'}: ${view.dropOffice.name}${view.dropOffice.arriveTime ? ` - ${view.dropOffice.arriveTime}` : ''}`,
  ];
  if (view.pickupShuttle) lines.push(`${en ? 'Shuttle pickup' : 'Xe trung chuyển đón'}: ${view.pickupShuttle.plannedTime} - ${view.pickupShuttle.addressText}`);
  if (view.dropShuttle) lines.push(`${en ? 'Shuttle drop-off' : 'Xe trung chuyển trả'}: ${view.dropShuttle.plannedTime} - ${view.dropShuttle.addressText}`);
  lines.push(`${en ? 'Status' : 'Trạng thái'}: ${b.status}`);
  return lines.join('\n');
}

/** GET /v1/bookings/:id/rebook — prefill for "book again" (12, 90). */
async function rebook(auth, id) {
  const b = await loadFor(auth, id);
  const route = await Route.findById(b.routeId).lean();
  return {
    fromProvinceId: route?.fromProvinceId || null, toProvinceId: route?.toProvinceId || null, routeId: b.routeId,
    pickupOfficeId: b.pickupOfficeId, dropOfficeId: b.dropOfficeId, seatCount: b.seats.length,
    passengers: b.seats.map((s) => ({ passengerName: s.passengerName, passengerPhone: s.passengerPhone, isChild: !!s.isChild, note: s.note })),
    pickupShuttle: b.pickupShuttle ? { zoneId: b.pickupShuttle.zoneId, addressText: b.pickupShuttle.addressText, noteText: b.pickupShuttle.noteText } : null,
    dropShuttle: b.dropShuttle ? { zoneId: b.dropShuttle.zoneId, addressText: b.dropShuttle.addressText, noteText: b.dropShuttle.noteText } : null,
  };
}

// ---------- boarding & completion (175, 176) ----------

/** POST /manage/trips/:id/boarding { marks: [{ bookingSeatId, state: boarded|absent|none }] } */
async function boarding(auth, tripId, body) {
  const c = new Checker();
  const arr = c.arr(body, 'marks', { required: true, max: 100 }) || [];
  const marks = arr.map((m, i) => ({ bookingSeatId: c.id(m, 'bookingSeatId', { field: `marks[${i}].bookingSeatId`, required: true }), state: c.oneOf(m, 'state', ['boarded', 'absent', 'none'], { field: `marks[${i}].state`, required: true }) }));
  c.done();
  const now = new Date();
  let updated = 0;
  for (const m of marks) {
    const r = await Booking.updateOne(
      { tripId, 'seats.id': m.bookingSeatId },
      { $set: { 'seats.$.boarding': m.state, 'seats.$.boardedAt': m.state === 'none' ? null : now, 'seats.$.boardedBy': auth.accountId, updatedAt: now } },
    );
    if (r.modifiedCount) {
      updated += 1;
      const b = await Booking.findOne({ 'seats.id': m.bookingSeatId }).select('_id').lean();
      await event({ _id: b._id }, auth, m.state === 'absent' ? 'no_show' : 'boarding', { newValue: { bookingSeatId: m.bookingSeatId, state: m.state }, internal: true });
    }
  }
  return { updated };
}

/** Trip completed: confirmed bookings -> completed (+ points, referral reward); unpaid ones expire; proofs get their deletion date. */
async function completeTrip(auth, trip) {
  const now = new Date();
  const rows = await Booking.find({ tripId: trip._id, status: 'confirmed' }).lean();
  const loyalty = require('./loyalty');
  for (const b of rows) {
    await Booking.updateOne({ _id: b._id, status: 'confirmed' }, { $set: { status: 'completed', completedAt: now, updatedAt: now } });
    await event(b, auth, 'completed');
    if (b.customerAccountId) await loyalty.onTripCompleted(b);
  }
  await Booking.updateMany({ tripId: trip._id, status: { $in: ['awaiting_payment', 'rejected'] } }, { $set: { status: 'expired', updatedAt: now } });
  const sys = await settings.get('system');
  const proofs = await PaymentProof.find({ tripId: trip._id }).select('fileId').lean();
  await FileObject.updateMany({ _id: { $in: proofs.map((p) => p.fileId) } }, { $set: { deleteAfter: T.addMinutes(now, sys.proofRetentionDays * 1440) } });
  return rows.length;
}

/** GET /manage/trips/:id/manifest (173): no email, no receipts. */
async function manifest(tripId) {
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw notFound();
  const rows = await Booking.find({ tripId, status: { $in: [...HELD, 'completed'] } }).sort({ createdAt: 1 }).lean();
  const offices = new Map((await Office.find({ _id: { $in: [...new Set(rows.flatMap((b) => [b.pickupOfficeId, b.dropOfficeId]))] } }).lean()).map((o) => [o._id, o]));
  const accounts = new Map((await Account.find({ _id: { $in: rows.map((b) => b.customerAccountId).filter(Boolean) } }).select('emergencyContact').lean()).map((a) => [a._id, a]));
  const items = [];
  for (const b of rows) {
    for (const s of b.seats) {
      if (s.claimState === 'lost') continue;
      items.push({
        bookingId: b._id, bookingCode: b.code, bookingStatus: b.status, source: b.source, bookingSeatId: s.id, seatId: s.seatId, seatLabel: s.label,
        passengerName: s.passengerName, passengerPhone: s.passengerPhone, isChild: !!s.isChild, note: [s.note, b.note].filter(Boolean).join(' | '),
        pickupOffice: offices.get(b.pickupOfficeId)?.name || '', dropOffice: offices.get(b.dropOfficeId)?.name || '',
        pickupShuttle: !!b.pickupShuttle && b.pickupShuttle.status !== 'cancelled', dropShuttle: !!b.dropShuttle && b.dropShuttle.status !== 'cancelled',
        boarding: s.boarding || 'none', emergencyContact: accounts.get(b.customerAccountId)?.emergencyContact || null,
      });
    }
  }
  items.sort((a, b) => a.seatLabel.localeCompare(b.seatLabel, 'vi', { numeric: true }));
  return { tripId, total: items.length, boarded: items.filter((i) => i.boarding === 'boarded').length, absent: items.filter((i) => i.boarding === 'absent').length, items };
}

/** GET /manage/trips/:id/shuttle (174): grouped by direction, office and zone. */
async function shuttleList(tripId) {
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw notFound();
  const rows = await Booking.find({ tripId, status: { $in: [...HELD, 'completed'] }, $or: [{ pickupShuttle: { $ne: null } }, { dropShuttle: { $ne: null } }] }).lean();
  const offices = new Map((await Office.find({}).select('name').lean()).map((o) => [o._id, o.name]));
  const groups = { pickup: new Map(), drop: new Map() };
  for (const b of rows) {
    for (const key of ['pickupShuttle', 'dropShuttle']) {
      const s = b[key];
      if (!s || s.status === 'cancelled') continue;
      const g = groups[s.direction];
      const k = `${s.officeId}|${s.zoneId}`;
      if (!g.has(k)) g.set(k, { officeId: s.officeId, officeName: offices.get(s.officeId) || '', zoneId: s.zoneId, zoneName: s.zoneName, items: [] });
      g.get(k).items.push({
        shuttleId: s.id, bookingId: b._id, bookingCode: b.code, passengerName: b.seats[0]?.passengerName || '', passengerPhone: b.seats[0]?.passengerPhone || '',
        seatCount: b.seats.filter((x) => x.claimState !== 'lost').length, addressText: s.addressText, noteText: s.noteText, plannedAt: iso(s.plannedAt), plannedTime: T.toLocal(s.plannedAt).time, status: s.status,
      });
    }
  }
  const out = (m) => [...m.values()].map((g) => ({ ...g, items: g.items.sort((a, b) => a.plannedAt.localeCompare(b.plannedAt)) }));
  return { tripId, duties: trip.shuttleDuties || [], pickup: out(groups.pickup), drop: out(groups.drop) };
}

/** PUT /manage/trips/:id/shuttle-duties { duties: [{ officeId, direction, dutyText }] } — who drives the shuttle (text). */
async function setShuttleDuties(auth, tripId, body) {
  const c = new Checker();
  const arr = c.arr(body, 'duties', { required: true, max: 40 }) || [];
  const duties = arr.map((d, i) => ({
    officeId: c.id(d, 'officeId', { field: `duties[${i}].officeId`, required: true }),
    direction: c.oneOf(d, 'direction', ['pickup', 'drop'], { field: `duties[${i}].direction`, required: true }),
    dutyText: c.str(d, 'dutyText', { field: `duties[${i}].dutyText`, required: true, max: 300 }),
  }));
  c.done();
  const r = await Trip.updateOne({ _id: tripId }, { $set: { shuttleDuties: duties, updatedAt: new Date() } });
  if (!r.matchedCount) throw notFound();
  return { duties };
}

/** POST /admin/guests/:id/link { accountId } (136): bookings & parcels of the guest move into the account. */
async function linkGuest(auth, guestId, body) {
  const c = new Checker();
  const accountId = c.id(body, 'accountId', { required: true });
  c.done();
  const guest = await GuestContact.findById(guestId).lean();
  if (!guest) throw notFound();
  const account = await Account.findOne({ _id: accountId, role: 'customer' }).lean();
  if (!account) throw invalid([{ field: 'accountId', code: 'not_found' }]);
  const bookings = await Booking.find({ guestContactId: guestId, customerAccountId: null }).lean();
  await Booking.updateMany({ guestContactId: guestId, customerAccountId: null }, { $set: { customerAccountId: accountId, updatedAt: new Date() } });
  const parcels = await models.Parcel.updateMany({ guestContactId: guestId, senderAccountId: null }, { $set: { senderAccountId: accountId, updatedAt: new Date() } });
  await GuestContact.updateOne({ _id: guestId }, { $set: { linkedAccountId: accountId, updatedAt: new Date() } });
  for (const b of bookings) {
    await event(b, auth, 'linked_to_account', { newValue: accountId, internal: true });
    await notify.push(accountId, 'order', 'booking_linked', { refType: 'booking', refId: b._id, params: { code: b.code } });
  }
  await require('./audit').log(auth, 'guest', guestId, 'linked', `${account.email}: ${bookings.length} bookings, ${parcels.modifiedCount || 0} parcels`);
  return { linkedBookings: bookings.length, linkedParcels: parcels.modifiedCount || 0 };
}

/** GET /admin/guests/lookup?phone= — suggestion while typing a phone at the counter (135). */
async function lookupPhone(query) {
  const phone = normalizePhone(String(query.phone || ''));
  if (!phone) return { guest: null, accounts: [] };
  const [guest, accounts] = await Promise.all([GuestContact.findOne({ phone }).lean(), Account.find({ phone, role: 'customer' }).limit(5).lean()]);
  const bookings = guest ? await Booking.find({ guestContactId: guest._id }).sort({ createdAt: -1 }).limit(10).lean() : [];
  return {
    guest: guest ? { id: guest._id, name: guest.name, phone: guest.phone, note: guest.note, linkedAccountId: guest.linkedAccountId, recentBookings: bookings.map((b) => ({ id: b._id, code: b.code, status: b.status, departAt: iso(b.departAt) })) } : null,
    accounts: accounts.map((a) => ({ id: a._id, displayName: a.displayName, email: a.email, phone: a.phone })),
  };
}

module.exports = {
  UNPAID, HELD, OPEN, newCode, load, loadFor, presentMany, presentOne, quote, create, list, get, paymentInfo, history, expireOverdue,
  onProofStored, reselectSeats, assignSeats, reassign, moveToTrip, refundPreview, cancelPreview, cancelBooking, requestCancel, createRequest,
  decideRequest, listRequests, withdrawRequest, presentRequest, adminCancel, listRefunds, recordRefund, refundBooking, presentRefund, afterRefund,
  updateShuttle, adminShuttle, adminCreate, addNote, shareText, rebook, boarding, completeTrip, manifest, shuttleList, setShuttleDuties,
  linkGuest, lookupPhone, releaseSeats, event, bankSnapshot, policySnapshot, upsertGuest,
};
