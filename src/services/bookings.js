/**
 * Bookings (34-56, 70-80, 130-138, 143-151, 169-176): the seat is held as soon as the booking is created.
 *
 * - Creating a booking holds every seat in one all-or-nothing step: `trip_seats {_id: trip:seat, state: 'free'} -> 'pending'`.
 *   If a seat is not free the whole request fails with 409 seat_conflict and nothing is created.
 * - Admin approves -> status confirmed, seats 'sold', points added. The customer pays AT THE COUNTER (nothing is paid in the app):
 *   the admin then records the collection (`collect`: cash or direct transfer). Revenue counts on that day, not on approval.
 *   Admin rejects (reason) -> status rejected (final), seats back to 'free'.
 * - Customer cancels a pending or a confirmed-but-unpaid booking -> cancelled at once, no refund. Cancels a booking that was
 *   already paid -> cancel_requested; the admin approves (seats freed, refund recorded by the cancellation tiers) or rejects.
 * - Counter bookings (cash, direct transfer, free) are confirmed and paid at once and take their seats as 'sold'.
 * - Bookings close `bookingLeadHours` (4) before departure, for customers and for the counter; customers book at most
 *   `bookDaysAhead` (7) days ahead and `maxSeatsPerBooking` (6) seats per booking.
 *
 * Status: pending -> confirmed -> completed; side branches: rejected, cancel_requested, cancelled.
 */
const models = require('../models');
const { Checker } = require('../lib/validate');
const { AppError, notFound, conflict, invalid } = require('../lib/errors');
const { uuid, iso, humanCode, noAccent, normalizePhone, sha256 } = require('../lib/util');
const { withTx } = require('../lib/tx');
const T = require('../lib/time');
const settings = require('./settings');
const pricing = require('./pricing');
const routesSvc = require('./routes');
const notify = require('./notify');
const { paging, page } = require('../resources/engine');

const { Booking, Trip, TripSeat, Route, Office, OrderEvent, OrderRequest, Refund, PaymentRecord, Promotion, Voucher, LoyaltyEntry, Receipt, GuestContact, Account } = models;

const HELD = ['pending', 'confirmed', 'cancel_requested']; // bookings that hold seats right now
const OPEN = HELD; // bookings that can still be changed

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

/**
 * Seats of the request. Each item is a seat id ("A1") or { seatId, passengerName?, passengerPhone? }.
 * Customer bookings use the account's name and phone for every seat; counter bookings may name each passenger.
 */
function readSeats(c, body, { max = 16 } = {}) {
  const arr = c.arr(body, 'seats', { required: true, max }) || [];
  if (Array.isArray(body?.seats) && !arr.length) c.fail('seats', 'required');
  const seen = new Set();
  return arr.map((s, i) => {
    const f = (k) => `seats[${i}].${k}`;
    const item = typeof s === 'string' ? { seatId: s } : s;
    const seatId = c.str(item, 'seatId', { field: f('seatId'), required: true, max: 10 });
    if (seatId && seen.has(seatId)) c.fail(f('seatId'), 'duplicate');
    seen.add(seatId);
    return {
      seatId,
      passengerName: c.str(item, 'passengerName', { field: f('passengerName'), max: 80 }) || '',
      passengerPhone: c.phone(item, 'passengerPhone', { field: f('passengerPhone') }) || '',
    };
  });
}

/** Seats of the request resolved against trip_seats. `mode`: 'select' (must be free, 409 seat_conflict) or 'any' (quote). */
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
  if (taken.length) throw new AppError(409, 'seat_conflict', { takenSeats: taken, freeSeats: await freeSeats(trip._id) });
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

async function policySnapshot() {
  const [cp, sh] = await Promise.all([settings.get('cancelPolicy'), settings.get('shuttle')]);
  return { tiers: cp.tiers, cancelFee: cp.cancelFee, changeAllowedHoursBefore: cp.changeAllowedHoursBefore, changeFee: cp.changeFee, shuttleFeeRefundable: sh.feeRefundable, takenAt: iso(new Date()) };
}

/**
 * Booking window (3.1): trips close `bookingLeadHours` before departure (customers AND counter), customers book at most
 * `bookDaysAhead` days ahead. Throws 422 booking_closed.
 */
async function assertBookable(trip, { admin }) {
  if (['cancelled', 'completed', 'running'].includes(trip.status)) throw conflict('trip_not_on_sale', { status: trip.status });
  const sys = await settings.get('system');
  const now = new Date();
  if (now >= T.addMinutes(trip.departAt, -sys.bookingLeadHours * 60)) throw new AppError(422, 'booking_closed', { leadHours: sys.bookingLeadHours });
  if (!admin) {
    if (trip.salesClosed) throw conflict('trip_not_on_sale', { status: 'closed' });
    if (trip.departAt > T.addMinutes(now, sys.bookDaysAhead * 1440)) throw new AppError(422, 'booking_closed', { daysAhead: sys.bookDaysAhead });
  }
  return sys;
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
  const [requests, logs, reviewedRows, sys] = await Promise.all([
    OrderRequest.find({ orderId: { $in: bookingIds }, status: 'pending' }).lean(),
    models.TripLog.find({ tripId: { $in: tripIds }, visibleToCustomer: true, kind: { $in: ['delay', 'incident', 'notice', 'depart', 'arrive'] } }).sort({ atTime: -1 }).lean(),
    models.Review.find({ bookingId: { $in: bookingIds } }).select('bookingId').lean(),
    settings.get('system'),
  ]);
  const reviewed = new Set(reviewedRows.map((r) => r.bookingId));
  let accounts = new Map();
  let guests = new Map();
  if (admin) {
    accounts = new Map((await Account.find({ _id: { $in: rows.map((b) => b.customerAccountId).filter(Boolean) } }).lean()).map((a) => [a._id, a]));
    guests = new Map((await GuestContact.find({ _id: { $in: rows.map((b) => b.guestContactId).filter(Boolean) } }).lean()).map((g) => [g._id, g]));
  }
  const now = new Date();
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
    const pending = requests.find((r) => r.orderId === b._id) || null;
    const departed = trip ? now >= trip.departAt : false;
    const local = trip ? T.toLocal(trip.departAt) : null;
    const out = {
      id: b._id,
      code: b.code,
      status: b.status,
      source: b.source,
      trip: trip ? {
        id: trip._id, departAt: iso(trip.departAt), date: local.date, departTime: local.time, tzOffset: local.offset,
        arriveAt: iso(T.addMinutes(trip.departAt, trip.durationMinutes)), status: trip.status,
        route: route ? { id: route._id, name: route.name } : null,
        vehicle: vehicle ? { kindLabel: vehicle.kindLabel, name: vehicle.name || '', ...(b.status === 'confirmed' || admin ? { plateNo: vehicle.plateNo } : {}) } : null,
        updates: logs.filter((l) => l.tripId === trip._id).slice(0, 10).map((l) => ({ kind: l.kind, text: l.text, delayMinutes: l.delayMinutes, atTime: iso(l.atTime) })),
      } : null,
      pickupOffice: officeOut(b.pickupOfficeId, 'pickup'),
      dropOffice: officeOut(b.dropOfficeId, 'drop'),
      pickupShuttle: shuttleOut(b.pickupShuttle),
      dropShuttle: shuttleOut(b.dropShuttle),
      seats: (b.seats || []).map((s) => ({
        id: s.id, seatId: s.seatId, label: s.label, seatClass: s.seatClass, passengerName: s.passengerName, passengerPhone: s.passengerPhone,
        seatPrice: s.seatPrice, surcharge: s.surcharge, netAmount: s.netAmount, boarding: s.boarding || 'none',
      })),
      amounts: b.amounts,
      totalAmount: b.totalAmount,
      paidAmount: b.paidAmount || 0,
      paid: !!b.paidAt,
      paidAt: iso(b.paidAt),
      payMethod: b.paidAt ? b.payMethod : null,
      refundedAmount: b.refundedAmount || 0,
      promoCode: b.promoCode,
      note: b.note || '',
      payAtCounter: ['pending', 'confirmed'].includes(b.status) && !b.paidAt,
      confirmedAt: iso(b.confirmedAt),
      completedAt: iso(b.completedAt),
      cancelledAt: iso(b.cancelledAt),
      cancelReason: b.cancelReason,
      pendingRequest: pending ? { id: pending._id, type: pending.type, status: pending.status, createdAt: iso(pending.createdAt) } : null,
      notices: b.notices || [],
      reviewed: reviewed.has(b._id),
      actions: {
        cancel: b.status === 'pending' || (b.status === 'confirmed' && !departed && !pending),
        cancelNeedsApproval: b.status === 'confirmed' && !!b.paidAt,
        editShuttle: ['pending', 'confirmed'].includes(b.status) && !departed,
        review: b.status === 'completed' && !reviewed.has(b._id),
        chat: true,
      },
      createdAt: iso(b.createdAt),
      updatedAt: iso(b.updatedAt),
    };
    if (admin) {
      const a = accounts.get(b.customerAccountId);
      const g = guests.get(b.guestContactId);
      const waiting = b.status === 'pending' ? Math.round((now - b.createdAt) / 60000) : null;
      Object.assign(out, {
        customer: a ? { id: a._id, displayName: a.displayName, phone: a.phone, email: a.email } : null,
        guest: g ? { id: g._id, name: g.name, phone: g.phone } : null,
        compReason: b.compReason, canCollect: b.status === 'confirmed' && !b.paidAt, internalNotes: b.internalNotes || [], cancelPolicySnapshot: b.cancelPolicySnapshot,
        waitingMinutes: waiting, overdue: waiting !== null && waiting > sys.reviewDeadlineMinutes,
      });
    }
    return out;
  });
}

const presentOne = async (b, opts) => (await presentMany([b], opts))[0];

// ---------- quote & create ----------

async function readOrder(c, body, { admin = false } = {}) {
  const tripId = c.id(body, 'tripId', { required: true });
  const seats = readSeats(c, body);
  const pickupOfficeId = c.id(body, 'pickupOfficeId', { required: true });
  const dropOfficeId = c.id(body, 'dropOfficeId', { required: true });
  const pickupShuttle = pricing.readShuttle(c, body, 'pickupShuttle');
  const dropShuttle = pricing.readShuttle(c, body, 'dropShuttle');
  const promoCode = c.str(body, 'promoCode', { max: 20 }) || null;
  const note = admin ? c.str(body, 'note', { max: 500 }) || '' : '';
  return { tripId, seats, pickupOfficeId, dropOfficeId, pickupShuttle, dropShuttle, promoCode, note };
}

async function prepare(input, { auth, admin = false, mode = 'select', override = null }) {
  const trip = await Trip.findById(input.tripId).lean();
  if (!trip) throw invalid([{ field: 'tripId', code: 'not_found' }]);
  const sys = await assertBookable(trip, { admin });
  if (!admin && input.seats.length > sys.maxSeatsPerBooking) throw invalid([{ field: 'seats', code: 'too_many_seats' }]);
  const route = await Route.findById(trip.routeId).lean();
  assertOffices(route, input.pickupOfficeId, input.dropOfficeId);
  await assertOfficesOpen(input.pickupOfficeId, input.dropOfficeId);
  const seats = await resolveSeats(trip, input.seats, mode);
  const now = new Date();
  const pickupShuttle = input.pickupShuttle ? await pricing.shuttleFor('pickup', input.pickupShuttle, { trip, route, officeId: input.pickupOfficeId, now, enforceDeadline: !admin }) : null;
  const dropShuttle = input.dropShuttle ? await pricing.shuttleFor('drop', input.dropShuttle, { trip, route, officeId: input.dropOfficeId, now, enforceDeadline: !admin }) : null;
  const q = await pricing.quote({ trip, seats, pickupShuttle, dropShuttle, promoCode: input.promoCode, accountId: admin ? input.customerAccountId || null : auth?.accountId, override });
  return { trip, route, seats, pickupShuttle, dropShuttle, q };
}

/**
 * POST /v1/bookings/quote — order summary (40): prices, surcharges, shuttle fees, promo code. Same engine as booking, nothing stored.
 * Seats may be given as `seats` (ids or { seatId }) or as `seatCount` + `seatClass`.
 */
async function quote(auth, body) {
  const c = new Checker();
  const tripId = c.id(body, 'tripId', { required: true });
  let seats;
  if (Array.isArray(body?.seats)) {
    seats = readSeats(c, body).map((s) => ({ seatId: s.seatId, seatClass: null }));
  } else {
    const n = c.int(body, 'seatCount', { min: 1, max: 16 }) || 1;
    const seatClass = c.str(body, 'seatClass', { max: 30 }) || 'standard';
    seats = Array.from({ length: n }, () => ({ seatId: null, seatClass }));
  }
  const pickupOfficeId = c.id(body, 'pickupOfficeId');
  const dropOfficeId = c.id(body, 'dropOfficeId');
  const pickupShuttle = pricing.readShuttle(c, body, 'pickupShuttle');
  const dropShuttle = pricing.readShuttle(c, body, 'dropShuttle');
  const promoCode = c.str(body, 'promoCode', { max: 20 }) || null;
  c.done();
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw invalid([{ field: 'tripId', code: 'not_found' }]);
  const route = await Route.findById(trip.routeId).lean();
  const ids = seats.filter((s) => s.seatId).map((s) => `${tripId}:${s.seatId}`);
  const docs = new Map((await TripSeat.find({ _id: { $in: ids } }).lean()).map((d) => [d.seatId, d]));
  const resolved = seats.map((s, i) => {
    const d = s.seatId ? docs.get(s.seatId) : null;
    if (s.seatId && !d) throw invalid([{ field: `seats[${i}].seatId`, code: 'not_found' }]);
    return { seatId: s.seatId, label: d?.label || null, seatClass: d?.seatClass || s.seatClass || 'standard', state: d?.state || null };
  });
  const sp = pickupShuttle && pickupOfficeId ? await pricing.shuttleFor('pickup', pickupShuttle, { trip, route, officeId: pickupOfficeId, enforceDeadline: false }) : null;
  const sd = dropShuttle && dropOfficeId ? await pricing.shuttleFor('drop', dropShuttle, { trip, route, officeId: dropOfficeId, enforceDeadline: false }) : null;
  const q = await pricing.quote({ trip, seats: resolved, pickupShuttle: sp, dropShuttle: sd, promoCode, accountId: auth.role === 'customer' ? auth.accountId : null });
  return {
    tripId, lines: q.lines.map((l, i) => ({ ...l, state: resolved[i].state })), amounts: q.amounts, promo: q.promo,
    pickupShuttle: sp ? { zoneName: sp.zoneName, fee: sp.fee, plannedAt: iso(sp.plannedAt), plannedTime: T.toLocal(sp.plannedAt).time } : null,
    dropShuttle: sd ? { zoneName: sd.zoneName, fee: sd.fee, plannedAt: iso(sd.plannedAt), plannedTime: T.toLocal(sd.plannedAt).time } : null,
  };
}

/** Uses the promo count and the voucher inside the creation transaction (41, 227). */
async function consumeDiscounts(doc, q, session) {
  if (!q.promo) return;
  const ok = await Promotion.findOneAndUpdate(
    { _id: q.promo.id, $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
    { $inc: { usedCount: 1 } },
    { session, new: true },
  );
  if (!ok) throw new AppError(409, 'promo_used_up', { fields: [{ field: 'promoCode', code: 'promo_used_up' }] });
  if (q.voucherId) await Voucher.updateOne({ _id: q.voucherId }, { $set: { status: 'used', usedAt: new Date(), orderId: doc._id } }, { session });
}

/** Gives back the promo use and the voucher, and takes back the points already given (rejected / cancelled booking). */
async function releaseDiscounts(b) {
  if (b.promotionId) {
    await Promotion.updateOne({ _id: b.promotionId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    if (b.voucherId) await Voucher.updateOne({ _id: b.voucherId, orderId: b._id }, { $set: { status: 'active', usedAt: null, orderId: null } });
  }
  if (b.pointsAwarded > 0) {
    await LoyaltyEntry.create({ _id: uuid(), accountId: b.customerAccountId, points: -b.pointsAwarded, reason: 'cancel_reversal', refType: 'booking', refId: b._id, at: new Date() });
    await notify.push(b.customerAccountId, 'order', 'points_reverted', { refType: 'booking', refId: b._id, params: { code: b.code, points: b.pointsAwarded } });
  }
}

function bookingSeats(seats, q, fallbackName, fallbackPhone) {
  return seats.map((s, i) => ({
    id: uuid(), seatId: s.seatId, label: s.label, seatClass: s.seatClass,
    passengerName: s.passengerName || fallbackName || '', passengerPhone: normalizePhone(s.passengerPhone || fallbackPhone || '') || s.passengerPhone || fallbackPhone || '',
    seatPrice: q.lines[i].seatPrice, surcharge: q.lines[i].surcharge, netAmount: q.lines[i].netAmount, boarding: 'none',
  }));
}

/** Takes the seats of a booking all or nothing (conditional update per seat). `state`: pending (customer) or sold (counter). */
async function holdSeats(doc, state) {
  const now = new Date();
  const got = [];
  for (const s of doc.seats) {
    const r = await TripSeat.updateOne({ _id: `${doc.tripId}:${s.seatId}`, state: 'free', isSellable: true }, { $set: { state, bookingId: doc._id, bookingSeatId: s.id, claimedAt: now } });
    if (!r.modifiedCount) {
      for (const g of got) await TripSeat.updateOne({ _id: `${doc.tripId}:${g.seatId}`, bookingId: doc._id }, { $set: { state: 'free', bookingId: null, bookingSeatId: null, claimedAt: null } });
      throw new AppError(409, 'seat_conflict', { takenSeats: [s.seatId], freeSeats: await freeSeats(doc.tripId) });
    }
    got.push(s);
  }
}

/** POST /v1/bookings (customer). Holds the seats at once. Idempotent with Idempotency-Key. */
async function create(auth, body, { idempotencyKey } = {}) {
  const key = typeof idempotencyKey === 'string' && idempotencyKey ? `booking|${auth.accountId}|${sha256(idempotencyKey.slice(0, 100))}` : null;
  if (key) {
    const r = await Receipt.findById(key).lean();
    if (r) return { status: 200, body: await presentOne(await load(r.result.bookingId)) };
  }
  const c = new Checker();
  const input = await readOrder(c, body);
  c.done();
  const { trip, route, seats, pickupShuttle, dropShuttle, q } = await prepare(input, { auth });
  const now = new Date();
  const doc = {
    _id: uuid(), code: await newCode('SR', Booking), tripId: trip._id, routeId: trip.routeId, departAt: trip.departAt, customerAccountId: auth.accountId, guestContactId: null,
    source: 'app', status: 'pending', seats: bookingSeats(seats, q, auth.account.displayName, auth.account.phone), pickupOfficeId: input.pickupOfficeId, dropOfficeId: input.dropOfficeId,
    pickupShuttle, dropShuttle, amounts: q.amounts, totalAmount: q.amounts.totalAmount, promoCode: q.promo?.code || null, promotionId: q.promo?.id || null, voucherId: q.voucherId,
    note: '', internalNotes: [], payMethod: null, cancelPolicySnapshot: await policySnapshot(), notices: [], createdBy: auth.accountId, createdAt: now, updatedAt: now,
  };
  doc.search = searchOf(doc, route.name);
  await holdSeats(doc, 'pending');
  try {
    await withTx(async (session) => {
      await Booking.create([doc], { session });
      await consumeDiscounts(doc, q, session);
      if (key) await Receipt.create([{ _id: key, result: { bookingId: doc._id }, expireAt: new Date(Date.now() + 86400000) }], { session });
    });
  } catch (err) {
    await releaseSeats(doc);
    throw err;
  }
  await event(doc, auth, 'created', { newValue: { seats: doc.seats.map((s) => s.label), total: doc.totalAmount } });
  return { status: 201, body: await presentOne(doc) };
}

// ---------- read ----------

const TABS = {
  pending: () => ({ status: 'pending' }),
  upcoming: (now) => ({ status: { $in: ['confirmed', 'cancel_requested'] }, departAt: { $gt: T.addMinutes(now, -720) } }),
  past: (now) => ({ $or: [{ status: 'completed' }, { status: { $in: ['confirmed', 'cancel_requested'] }, departAt: { $lte: T.addMinutes(now, -720) } }] }),
  cancelled: () => ({ status: { $in: ['cancelled', 'rejected'] } }),
};

async function list(auth, query) {
  const now = new Date();
  const filter = auth.role === 'admin' ? {} : { customerAccountId: auth.accountId };
  if (query.tab && TABS[query.tab]) Object.assign(filter, TABS[query.tab](now));
  if (query.status) filter.status = { $in: String(query.status).split(',') };
  if (auth.role === 'admin') {
    for (const k of ['tripId', 'source', 'customerAccountId', 'guestContactId', 'routeId']) if (query[k]) filter[k] = String(query[k]);
    if (query.payment === 'unpaid') Object.assign(filter, { status: 'confirmed', paidAt: null });
    if (query.payment === 'paid') filter.paidAt = { $ne: null };
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
  const oldestFirst = (auth.role === 'admin' && filter.status === 'pending') || (auth.role === 'admin' && query.status === 'pending');
  const sort = auth.role === 'admin' && query.payment === 'unpaid' ? { departAt: 1 } : oldestFirst ? { createdAt: 1 } : query.tab === 'past' || query.tab === 'cancelled' ? { departAt: -1 } : query.tab === 'upcoming' ? { departAt: 1 } : { createdAt: -1 };
  const [rows, total] = await Promise.all([Booking.find(filter).sort(sort).skip(p.skip).limit(p.limit + 1).lean(), Booking.countDocuments(filter)]);
  const items = await presentMany(rows.slice(0, p.limit), { admin: auth.role === 'admin' });
  return page(rows.length > p.limit ? [...items, null] : items, p, total);
}

async function get(auth, id) {
  return presentOne(await loadFor(auth, id), { admin: auth.role === 'admin' });
}

async function history(auth, id) {
  const b = await loadFor(auth, id);
  const filter = { orderType: 'booking', orderId: b._id };
  if (auth.role !== 'admin') filter.internal = false;
  const rows = await OrderEvent.find(filter).sort({ at: 1 }).lean();
  const names = auth.role === 'admin' ? new Map((await Account.find({ _id: { $in: rows.map((r) => r.byAccountId).filter(Boolean) } }).select('displayName').lean()).map((a) => [a._id, a.displayName])) : new Map();
  return { items: rows.map((e) => ({ id: e._id, at: iso(e.at), kind: e.kind, byRole: e.byRole, ...(auth.role === 'admin' ? { byAccountId: e.byAccountId, byName: names.get(e.byAccountId) || null, internal: e.internal } : {}), oldValue: e.oldValue, newValue: e.newValue, note: e.note })) };
}

// ---------- seats ----------

// Always scoped to the booking's (old) trip: after a trip change the booking holds seats on the new trip too.
const releaseFilter = (b) => ({ tripId: b.tripId, bookingId: b._id, state: { $in: ['pending', 'sold'] } });

async function releaseSeats(b, bookingSeatIds = null) {
  const f = releaseFilter(b);
  if (bookingSeatIds) f.bookingSeatId = { $in: bookingSeatIds };
  const freed = await TripSeat.find(f).select('_id').lean();
  await TripSeat.updateMany(f, { $set: { state: 'free', bookingId: null, bookingSeatId: null, claimedAt: null } });
  if (freed.length) await require('./social').waitlistSeatFreed(b.tripId);
  return freed.length;
}

const heldState = (status) => (status === 'pending' ? 'pending' : 'sold');

/**
 * Moves seats of a booking to other free seats of the same trip (admin 169/170). New seats are taken all or nothing
 * with the booking's state; the old ones are released.
 */
async function reassign(auth, b, changes, { reason = '' } = {}) {
  const byId = new Map(b.seats.map((s) => [s.id, s]));
  const bad = [];
  changes.forEach((ch, i) => {
    if (!byId.get(ch.bookingSeatId)) bad.push({ field: `seats[${i}].bookingSeatId`, code: 'not_found' });
  });
  if (bad.length) throw invalid(bad);
  const state = heldState(b.status);
  const now = new Date();
  const taken = [];
  const claimed = [];
  for (const ch of changes) {
    const r = await TripSeat.updateOne({ _id: `${b.tripId}:${ch.seatId}`, state: 'free', isSellable: true }, { $set: { state, bookingId: b._id, bookingSeatId: ch.bookingSeatId, claimedAt: now } });
    if (r.modifiedCount) claimed.push(ch);
    else taken.push(ch.seatId);
  }
  if (taken.length) {
    for (const ch of claimed) await TripSeat.updateOne({ _id: `${b.tripId}:${ch.seatId}`, bookingId: b._id, bookingSeatId: ch.bookingSeatId }, { $set: { state: 'free', bookingId: null, bookingSeatId: null, claimedAt: null } });
    throw new AppError(409, 'seat_conflict', { takenSeats: taken, freeSeats: await freeSeats(b.tripId) });
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
    return { ...s, seatId: ch.seatId, label: d.label, seatClass: d.seatClass };
  });
  for (const ch of changes) {
    const old = byId.get(ch.bookingSeatId);
    if (old.seatId !== ch.seatId) {
      await TripSeat.updateOne({ _id: `${b.tripId}:${old.seatId}`, bookingId: b._id, bookingSeatId: old.id }, { $set: { state: 'free', bookingId: null, bookingSeatId: null, claimedAt: null } });
    }
  }
  const route = await Route.findById(b.routeId).select('name').lean();
  await Booking.updateOne({ _id: b._id }, { $set: { seats, search: searchOf({ ...b, seats }, route?.name), updatedAt: now } });
  await event(b, auth, 'seat_changed', { oldValue: oldLabels, newValue: newLabels, note: reason });
  await notify.push(b.customerAccountId, 'order', 'seat_changed', { refType: 'booking', refId: b._id, params: { code: b.code, old: oldLabels.join(', '), new: newLabels.join(', '), reason } });
  await require('./social').waitlistSeatFreed(b.tripId);
  return presentOne(await load(b._id), { admin: true });
}

/** POST /manage/bookings/:id/assign-seats { assignments: [{ bookingSeatId, seatId }], reason } — admin (169, 170). */
async function assignSeats(auth, id, body) {
  const b = await load(id);
  if (!OPEN.includes(b.status)) throw conflict('invalid_status');
  const c = new Checker();
  const arr = c.arr(body, 'assignments', { required: true, max: 16 }) || [];
  const changes = arr.map((x, i) => ({ bookingSeatId: c.id(x, 'bookingSeatId', { field: `assignments[${i}].bookingSeatId`, required: true }), seatId: c.str(x, 'seatId', { field: `assignments[${i}].seatId`, required: true, max: 10 }) }));
  const reason = c.str(body, 'reason', { max: 300 }) || '';
  c.done();
  return reassign(auth, b, changes, { reason });
}

/** Moves a booking to another trip of the same route, keeping seat ids when free (165). */
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
    if (!target) throw new AppError(409, 'seat_conflict', { missing: s.label, freeSeats: free.map((x) => x.seatId) });
    pool.delete(target.seatId);
    plan.push({ seat: s, target });
  }
  const state = heldState(b.status);
  const now = new Date();
  const got = [];
  for (const p of plan) {
    const r = await TripSeat.updateOne({ _id: p.target._id, state: 'free' }, { $set: { state, bookingId: b._id, bookingSeatId: p.seat.id, claimedAt: now } });
    if (!r.modifiedCount) {
      for (const g of got) await TripSeat.updateOne({ _id: g.target._id, bookingId: b._id }, { $set: { state: 'free', bookingId: null, bookingSeatId: null, claimedAt: null } });
      throw new AppError(409, 'seat_conflict', { takenSeats: [p.target.seatId] });
    }
    got.push(p);
  }
  await releaseSeats({ ...b, tripId: b.tripId });
  const route = await Route.findById(toTrip.routeId).lean();
  const shift = toTrip.departAt - b.departAt;
  const moveShuttle = (sh) => (sh ? { ...sh, plannedAt: new Date(new Date(sh.plannedAt).getTime() + shift), updatedAt: now } : null);
  const seats = plan.map((p) => ({ ...p.seat, seatId: p.target.seatId, label: p.target.label, seatClass: p.target.seatClass, boarding: 'none' }));
  await Booking.updateOne({ _id: b._id }, { $set: { tripId: toTrip._id, departAt: toTrip.departAt, seats, pickupShuttle: moveShuttle(b.pickupShuttle), dropShuttle: moveShuttle(b.dropShuttle), search: searchOf({ ...b, seats }, route?.name), updatedAt: now } });
  await event(b, auth, 'trip_changed', { oldValue: { tripId: b.tripId, departAt: iso(b.departAt), seats: b.seats.map((s) => s.label) }, newValue: { tripId: toTrip._id, departAt: iso(toTrip.departAt), seats: seats.map((s) => s.label) }, note: reason });
  const l = T.toLocal(toTrip.departAt);
  await notify.push(b.customerAccountId, 'order', 'booking_moved', { refType: 'booking', refId: b._id, params: { code: b.code, date: l.date, time: l.time } });
  return load(b._id);
}

// ---------- approve / reject (the admin decides every customer booking) ----------

/** POST /manage/bookings/:id/approve { note? } — pending -> confirmed, seats sold, points added; the customer pays at the counter. */
async function approve(auth, id, body = {}) {
  const b = await load(id);
  if (b.status !== 'pending') throw conflict('invalid_status', { current: b.status });
  const c = new Checker();
  const note = c.str(body, 'note', { max: 500 }) || '';
  c.done();
  const now = new Date();
  const r = await Booking.updateOne({ _id: b._id, status: 'pending' }, { $set: { status: 'confirmed', confirmedAt: now, paidAmount: 0, paidAt: null, updatedAt: now } });
  if (!r.modifiedCount) throw conflict('invalid_status');
  await TripSeat.updateMany({ tripId: b.tripId, bookingId: b._id, state: 'pending' }, { $set: { state: 'sold' } });
  await event(b, auth, 'confirmed', { oldValue: 'pending', newValue: 'confirmed', note });
  if (b.customerAccountId) {
    await require('./loyalty').onBookingApproved({ ...b, status: 'confirmed' });
    await notify.push(b.customerAccountId, 'order', 'booking_confirmed', { refType: 'booking', refId: b._id, params: { code: b.code } });
  }
  return presentOne(await load(id), { admin: true });
}

/**
 * POST /manage/bookings/:id/collect { method: cash|transfer, note? } — the admin confirms the money was collected at the
 * counter. Revenue counts from this moment (the day of collection), not from the approval.
 */
async function collect(auth, id, body) {
  const b = await load(id);
  if (b.status !== 'confirmed' || b.paidAt) throw conflict('invalid_status', { current: b.status, paid: !!b.paidAt });
  const c = new Checker();
  const method = c.oneOf(body, 'method', ['cash', 'transfer'], { required: true });
  const note = c.str(body, 'note', { max: 300 }) || '';
  c.done();
  const now = new Date();
  const r = await Booking.updateOne({ _id: b._id, status: 'confirmed', paidAt: null }, { $set: { paidAt: now, paidAmount: b.totalAmount, payMethod: method, updatedAt: now } });
  if (!r.modifiedCount) throw conflict('invalid_status');
  const trip = await Trip.findById(b.tripId).select('vehicleId').lean();
  if (b.totalAmount > 0) {
    await PaymentRecord.create({
      _id: uuid(), orderType: 'booking', orderId: b._id, source: b.source, method, amount: b.totalAmount, note,
      tripId: b.tripId, routeId: b.routeId, vehicleId: trip?.vehicleId, departAt: b.departAt, recordedBy: auth.accountId, recordedAt: now,
    });
  }
  await event(b, auth, 'payment_collected', { newValue: { method, amount: b.totalAmount }, note });
  await notify.push(b.customerAccountId, 'order', 'payment_recorded', { refType: 'booking', refId: b._id, params: { code: b.code, amount: b.totalAmount } });
  return presentOne(await load(id), { admin: true });
}

/** POST /manage/bookings/approve { ids } — bulk approve after the confirmation screen (144). */
async function approveMany(auth, body) {
  const c = new Checker();
  const ids = c.arr(body, 'ids', { required: true, max: 100 }) || [];
  c.done();
  const results = [];
  for (const id of ids) {
    try {
      await approve(auth, String(id), {});
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, code: err.code || 'error' });
    }
  }
  return { results, approved: results.filter((x) => x.ok).length };
}

/** POST /manage/bookings/:id/reject { reason* } — pending -> rejected (final), seats go back to free. */
async function reject(auth, id, body) {
  const b = await load(id);
  if (b.status !== 'pending') throw conflict('invalid_status', { current: b.status });
  const c = new Checker();
  const reason = c.str(body, 'reason', { required: true, max: 300 });
  c.done();
  const now = new Date();
  const r = await Booking.updateOne({ _id: b._id, status: 'pending' }, { $set: { status: 'rejected', cancelReason: reason, updatedAt: now } });
  if (!r.modifiedCount) throw conflict('invalid_status');
  await releaseSeats(b);
  await releaseDiscounts({ ...b, pointsAwarded: 0 });
  await event(b, auth, 'rejected', { oldValue: 'pending', newValue: 'rejected', note: reason });
  await notify.push(b.customerAccountId, 'order', 'booking_rejected', { refType: 'booking', refId: b._id, params: { code: b.code, reason } });
  return presentOne(await load(id), { admin: true });
}

// ---------- cancel & refunds ----------

/**
 * Refund preview by the cancellation time vs departure, with the policy saved in the booking (72, 73):
 * refund = max(0, paid x tier% - cancelFee). Only confirmed bookings have anything to refund.
 */
function refundPreview(b, trip, now = new Date()) {
  const policy = b.cancelPolicySnapshot || { tiers: [], cancelFee: 0 };
  const paid = b.paidAmount > 0 ? b.paidAmount : 0;
  const hoursBefore = Math.max(0, (trip.departAt - now) / 3600000);
  const tiers = [...(policy.tiers || [])].sort((x, y) => y.hoursBefore - x.hoursBefore);
  const tier = tiers.find((t) => hoursBefore >= t.hoursBefore) || null;
  const percent = tier ? tier.refundPercent : 0;
  const fee = paid > 0 ? policy.cancelFee || 0 : 0;
  const refundAmount = Math.max(0, Math.round((paid * percent) / 100) - fee);
  return { paidAmount: paid, hoursBefore: Math.round(hoursBefore * 10) / 10, tier, refundPercent: percent, cancelFee: fee, refundAmount, policy: policy.tiers };
}

async function cancelPreview(auth, id) {
  const b = await loadFor(auth, id);
  const trip = await Trip.findById(b.tripId).lean();
  return { bookingId: b._id, status: b.status, immediate: b.status === 'pending' || (b.status === 'confirmed' && !b.paidAt), ...refundPreview(b, trip) };
}

/**
 * Cancels a booking: releases the seats and shuttles, gives back the promo and points, creates a pending refund when money
 * was paid. Used by customers (pending bookings), approved cancel requests, admin cancel and trip cancellation.
 */
async function cancelBooking(auth, b, { reason = 'customer', note = '', refundAmount = null, fullRefund = false, silent = false } = {}) {
  if (!HELD.includes(b.status)) throw conflict('invalid_status');
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
  await OrderRequest.updateMany({ orderId: b._id, status: 'pending' }, { $set: { status: 'withdrawn', decidedAt: now } });
  if (amount > 0) {
    await Refund.create({ _id: uuid(), orderType: 'booking', orderId: b._id, orderCode: b.code, accountId: b.customerAccountId, amount, reason, status: 'pending', tripId: b.tripId, routeId: b.routeId, note, createdAt: now });
  }
  await event(b, auth, 'cancelled', { oldValue: b.status, newValue: 'cancelled', note: [reason, note].filter(Boolean).join(': ') });
  if (!silent || amount > 0) {
    await notify.push(b.customerAccountId, 'order', amount > 0 ? 'refund_pending' : 'booking_cancelled', { refType: 'booking', refId: b._id, params: { code: b.code, amount, note } });
  }
  return { refundAmount: amount, preview };
}

/**
 * POST /v1/bookings/:id/cancel { note } (customer). A pending booking, or a confirmed one that was not paid yet, is cancelled right away (no refund); a paid
 * booking becomes cancel_requested and waits for the admin (148).
 */
async function requestCancel(auth, id, body) {
  const b = await loadFor(auth, id);
  const c = new Checker();
  const note = c.str(body, 'note', { max: 500 }) || '';
  c.done();
  const trip = await Trip.findById(b.tripId).lean();
  if (b.status === 'pending' || (b.status === 'confirmed' && !b.paidAt && new Date() < trip.departAt)) {
    await cancelBooking(auth, b, { reason: 'customer', note });
    return { status: 'cancelled', booking: await presentOne(await load(id)) };
  }
  if (b.status !== 'confirmed') throw conflict('cancel_not_allowed');
  if (new Date() >= trip.departAt) throw conflict('cancel_not_allowed');
  const req = await openRequest(auth, b, 'cancel', { note, refundPreview: refundPreview(b, trip) });
  await Booking.updateOne({ _id: b._id, status: 'confirmed' }, { $set: { status: 'cancel_requested', updatedAt: new Date() } });
  await notify.push(b.customerAccountId, 'order', 'cancel_requested', { refType: 'booking', refId: b._id, params: { code: b.code } });
  return { status: 'requested', request: req, booking: await presentOne(await load(id)) };
}

async function openRequest(auth, b, type, { payload = {}, refundPreview: rp = null, note = '' }) {
  if (await OrderRequest.exists({ orderId: b._id, status: 'pending' })) throw conflict('pending_request_exists');
  const doc = { _id: uuid(), orderType: 'booking', orderId: b._id, orderCode: b.code, accountId: b.customerAccountId, type, status: 'pending', payload, priceDiff: 0, refundPreview: rp, note, tripId: b.tripId, departAt: b.departAt, createdAt: new Date() };
  await OrderRequest.create(doc);
  await event(b, auth, `${type}_requested`, { newValue: { refund: rp?.refundAmount }, note });
  return presentRequest(doc);
}

const presentRequest = (r) => ({
  id: r._id, orderType: r.orderType, orderId: r.orderId, orderCode: r.orderCode, accountId: r.accountId, type: r.type, status: r.status,
  refundPreview: r.refundPreview, note: r.note, decisionNote: r.decisionNote, decidedAt: iso(r.decidedAt), createdAt: iso(r.createdAt),
  tripId: r.tripId, departAt: iso(r.departAt),
});

/** Admin decision on a cancel request (148). Approve -> cancelled + refund; reject -> the booking goes back to confirmed. */
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
    result = await cancelBooking(auth, b, { reason: 'customer', note, refundAmount: refundAmount ?? req.refundPreview?.refundAmount ?? null });
  } else {
    await Booking.updateOne({ _id: b._id, status: 'cancel_requested' }, { $set: { status: 'confirmed', updatedAt: new Date() } });
  }
  await OrderRequest.updateOne({ _id: id }, { $set: { status: approve ? 'approved' : 'rejected', decidedBy: auth.accountId, decidedAt: new Date(), decisionNote: note } });
  await event(b, auth, approve ? 'request_approved' : 'request_rejected', { newValue: req.type, note });
  await notify.push(b.customerAccountId, 'order', approve ? 'request_approved' : 'request_rejected', { refType: 'booking', refId: b._id, params: { code: b.code, type: req.type, note } });
  return { request: presentRequest(await OrderRequest.findById(id).lean()), booking: await presentOne(await load(b._id), { admin: true }), ...result };
}

/** POST /manage/bookings/:id/approve-cancel (or reject-cancel) — acts on the pending cancel request of the booking. */
async function decideCancel(auth, bookingId, body, approve) {
  const req = await OrderRequest.findOne({ orderId: bookingId, status: 'pending', type: 'cancel' }).lean();
  if (!req) throw conflict('invalid_status', { hint: 'no_cancel_request' });
  return decideRequest(auth, req._id, body, approve);
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

/** The customer takes the cancel request back: the booking returns to confirmed. */
async function withdrawRequest(auth, id) {
  const r = await OrderRequest.findOneAndUpdate({ _id: id, accountId: auth.accountId, status: 'pending' }, { $set: { status: 'withdrawn', decidedAt: new Date() } }, { new: true }).lean();
  if (!r) throw notFound();
  await Booking.updateOne({ _id: r.orderId, status: 'cancel_requested' }, { $set: { status: 'confirmed', updatedAt: new Date() } });
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
  note: r.note, recordedBy: r.recordedBy, recordedAt: iso(r.recordedAt), createdAt: iso(r.createdAt),
});

async function listRefunds(auth, query) {
  const filter = auth.role === 'admin' ? {} : { accountId: auth.accountId };
  if (query.status) filter.status = String(query.status);
  if (query.orderType) filter.orderType = String(query.orderType);
  const p = paging(query, 30);
  const [rows, total] = await Promise.all([Refund.find(filter).sort({ createdAt: auth.role === 'admin' ? 1 : -1 }).skip(p.skip).limit(p.limit + 1).lean(), Refund.countDocuments(filter)]);
  // The operator contacts the customer outside the app to refund: show who to call.
  if (auth.role === 'admin') {
    const accs = new Map((await Account.find({ _id: { $in: rows.map((r) => r.accountId).filter(Boolean) } }).select('displayName phone').lean()).map((a) => [a._id, a]));
    return page(rows.map((r) => ({ ...presentRefund(r), customer: accs.get(r.accountId) ? { displayName: accs.get(r.accountId).displayName, phone: accs.get(r.accountId).phone } : null })), p, total);
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
  const r = { _id: uuid(), orderType: 'booking', orderId: id, orderCode: b.code, accountId: b.customerAccountId, amount, reason: 'manual', status: 'recorded', tripId: b.tripId, routeId: b.routeId, note, recordedBy: auth.accountId, recordedAt: new Date(), createdAt: new Date() };
  await Refund.create(r);
  await afterRefund(auth, r);
  return presentRefund(r);
}

// ---------- shuttle (76, 174, 215) ----------

/** PATCH /v1/bookings/:id/shuttle { pickupShuttle?, dropShuttle? } — before the deadline; fee changes only while the booking is pending. */
async function updateShuttle(auth, id, body) {
  const b = await loadFor(auth, id);
  if (!['pending', 'confirmed'].includes(b.status)) throw conflict('invalid_status');
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
    if (!admin && b.status !== 'pending') throw conflict('invalid_status', { hint: 'contact_operator' });
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

// ---------- counter bookings (130-138) ----------

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
 * POST /manage/bookings — a booking made at the counter: confirmed at once, seats 'sold' all or nothing, source 'counter'.
 * Also closed `bookingLeadHours` before departure. payMethod: cash | transfer | free (free needs compReason and is not revenue).
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
  const customer = customerAccountId ? await Account.findOne({ _id: customerAccountId, role: 'customer' }).lean() : null;
  if (customerAccountId && !customer) throw invalid([{ field: 'customerAccountId', code: 'not_found' }]);
  input.customerAccountId = customerAccountId || null;
  const override = payMethod === 'free' ? { seatPrice: 0 } : specialPrice !== undefined ? { seatPrice: specialPrice } : null;
  const prep = await prepare(input, { auth, admin: true, mode: 'any', override });
  const listPrice = override ? (await pricing.quote({ trip: prep.trip, seats: prep.seats, pickupShuttle: prep.pickupShuttle, dropShuttle: prep.dropShuttle })).amounts.totalAmount : prep.q.amounts.totalAmount;
  const now = new Date();
  const name = guest?.name || customer?.displayName || '';
  const phone = guest?.phone || customer?.phone || '';
  const doc = {
    _id: uuid(), code: await newCode('SR', Booking), tripId: prep.trip._id, routeId: prep.trip.routeId, departAt: prep.trip.departAt,
    customerAccountId: input.customerAccountId, guestContactId: guest ? await upsertGuest(auth, guest) : null, source: 'counter', status: 'confirmed',
    seats: bookingSeats(prep.seats, prep.q, name, phone), pickupOfficeId: input.pickupOfficeId, dropOfficeId: input.dropOfficeId,
    pickupShuttle: prep.pickupShuttle, dropShuttle: prep.dropShuttle, amounts: prep.q.amounts, totalAmount: prep.q.amounts.totalAmount,
    promoCode: prep.q.promo?.code || null, promotionId: prep.q.promo?.id || null, voucherId: prep.q.voucherId, note: input.note, internalNotes: [],
    confirmedAt: now, payMethod, compReason, paidAmount: prep.q.amounts.totalAmount, paidAt: now, cancelPolicySnapshot: await policySnapshot(), notices: [], createdBy: auth.accountId, createdAt: now, updatedAt: now,
  };
  doc.search = searchOf(doc, prep.route.name);
  await holdSeats(doc, 'sold');
  try {
    await withTx(async (session) => {
      await Booking.create([doc], { session });
      await consumeDiscounts(doc, prep.q, session);
      await PaymentRecord.create([{
        _id: uuid(), orderType: 'booking', orderId: doc._id, source: 'counter', method: payMethod, amount: payMethod === 'free' ? 0 : doc.totalAmount,
        compValue: override ? Math.max(0, listPrice - doc.totalAmount) : 0, reason: compReason, note: paymentNote,
        tripId: doc.tripId, routeId: doc.routeId, vehicleId: prep.trip.vehicleId, departAt: doc.departAt, recordedBy: auth.accountId, recordedAt: now,
      }], { session });
    });
  } catch (err) {
    await releaseSeats(doc);
    throw err;
  }
  await event(doc, auth, 'created_by_admin', { newValue: { seats: doc.seats.map((s) => s.label), payMethod, total: doc.totalAmount }, note: compReason || '' });
  if (doc.customerAccountId && payMethod !== 'free') await require('./loyalty').onBookingApproved(doc);
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

/**
 * Trip completed: confirmed bookings -> completed (+ the referral reward on the first completed trip); bookings still
 * pending are closed as rejected and their seats freed.
 */
async function completeTrip(auth, trip) {
  const now = new Date();
  const rows = await Booking.find({ tripId: trip._id, status: { $in: ['confirmed', 'cancel_requested'] } }).lean();
  const loyalty = require('./loyalty');
  for (const b of rows) {
    await Booking.updateOne({ _id: b._id, status: b.status }, { $set: { status: 'completed', completedAt: now, updatedAt: now } });
    await event(b, auth, 'completed');
    if (b.customerAccountId) await loyalty.onTripCompleted(b);
  }
  const stale = await Booking.find({ tripId: trip._id, status: 'pending' }).lean();
  for (const b of stale) {
    await Booking.updateOne({ _id: b._id, status: 'pending' }, { $set: { status: 'rejected', cancelReason: 'trip_completed', updatedAt: now } });
    await releaseSeats(b);
    await releaseDiscounts({ ...b, pointsAwarded: 0 });
    await event(b, auth, 'rejected', { oldValue: 'pending', newValue: 'rejected', note: 'trip_completed' });
  }
  return rows.length;
}

/** GET /manage/trips/:id/manifest (173): no email. */
async function manifest(tripId) {
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw notFound();
  const rows = await Booking.find({ tripId, status: { $in: [...HELD, 'completed'] } }).sort({ createdAt: 1 }).lean();
  const offices = new Map((await Office.find({ _id: { $in: [...new Set(rows.flatMap((b) => [b.pickupOfficeId, b.dropOfficeId]))] } }).lean()).map((o) => [o._id, o]));
  const items = [];
  for (const b of rows) {
    for (const s of b.seats) {
      items.push({
        bookingId: b._id, bookingCode: b.code, bookingStatus: b.status, source: b.source, bookingSeatId: s.id, seatId: s.seatId, seatLabel: s.label,
        passengerName: s.passengerName, passengerPhone: s.passengerPhone, note: b.note || '',
        pickupOffice: offices.get(b.pickupOfficeId)?.name || '', dropOffice: offices.get(b.dropOfficeId)?.name || '',
        pickupShuttle: !!b.pickupShuttle && b.pickupShuttle.status !== 'cancelled', dropShuttle: !!b.dropShuttle && b.dropShuttle.status !== 'cancelled',
        boarding: s.boarding || 'none',
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
        seatCount: b.seats.length, addressText: s.addressText, noteText: s.noteText, plannedAt: iso(s.plannedAt), plannedTime: T.toLocal(s.plannedAt).time, status: s.status,
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
  HELD, OPEN, newCode, load, loadFor, presentMany, presentOne, quote, create, list, get, history,
  approve, approveMany, collect, reject, assignSeats, reassign, moveToTrip, refundPreview, cancelPreview, cancelBooking, requestCancel,
  decideRequest, decideCancel, listRequests, withdrawRequest, presentRequest, adminCancel, listRefunds, recordRefund, refundBooking, presentRefund, afterRefund,
  updateShuttle, adminShuttle, adminCreate, addNote, shareText, rebook, boarding, completeTrip, manifest, shuttleList, setShuttleDuties,
  linkGuest, lookupPhone, releaseSeats, event, policySnapshot, upsertGuest,
};
