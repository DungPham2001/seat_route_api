/**
 * Parcel delivery on limo trips (13, 57-69, 139, 152, 181-183, 220-224). No seat, no "first receipt wins".
 * Fee = weight tier price for the route and size + extra kg + declared value surcharge + pickup/drop shuttle fees,
 * computed once; the admin's final fee (after weighing) is stored with its breakdown when accepting.
 * Trip capacity is checked atomically when accepting (conditional $inc on trip.parcelLoad).
 * The pickup code is random, only its hash is stored, shown to the sender when created (or regenerated).
 *
 * status: pending -> accepted -> received -> loaded -> arrived -> delivered  (cancelled, rejected, issue)
 * Payment: the sender brings the goods to the counter and pays there; the admin marks `received` and the fee is
 * recorded as collected (cash or direct transfer). Revenue counts from `received`. Nothing is paid in the app.
 */
const crypto = require('crypto');
const models = require('../models');
const { Checker } = require('../lib/validate');
const { AppError, notFound, conflict, invalid } = require('../lib/errors');
const { uuid, iso, sha256, noAccent, normalizePhone } = require('../lib/util');
const T = require('../lib/time');
const settings = require('./settings');
const notify = require('./notify');
const routesSvc = require('./routes');
const { paging, page } = require('../resources/engine');

const { Parcel, ParcelRate, ParcelCategory, Route, Office, Trip, ShuttleZone, OrderEvent, PaymentRecord, Refund, Account, Receipt } = models;

const ACTIVE = ['pending', 'accepted', 'received', 'loaded', 'arrived', 'issue'];
const ON_TRIP = ['accepted', 'received', 'loaded', 'arrived', 'delivered', 'issue'];

const event = (p, auth, kind, { oldValue = null, newValue = null, note = '', internal = false } = {}) => OrderEvent.create({
  _id: uuid(), orderType: 'parcel', orderId: p._id, at: new Date(), byAccountId: auth?.accountId || null, byRole: auth?.role || 'system', kind, oldValue, newValue, note, internal,
});

const newHandoverCode = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');
const weightOf = (p) => p.actualWeightKg ?? p.weightKg;

async function load(id) {
  const p = await Parcel.findById(id).lean();
  if (!p) throw notFound();
  return p;
}
async function loadFor(auth, id) {
  const p = await load(id);
  if (auth.role !== 'admin' && p.senderAccountId !== auth.accountId) throw notFound();
  return p;
}

// ---------- config & quote ----------

/** GET /v1/parcels/config — categories, prohibited goods, limits, size classes, policy, routes that accept parcels (59). */
async function getConfig() {
  const [cfg, cats, routes] = await Promise.all([settings.get('parcel'), ParcelCategory.find({}).sort({ sortOrder: 1, name: 1 }).lean(), Route.find({ status: 'active', parcelEnabled: true }).lean()]);
  const offices = new Map((await Office.find({ isActive: true }).lean()).map((o) => [o._id, o]));
  return {
    enabled: cfg.enabled,
    limits: { maxWeightKgPerOrder: cfg.maxWeightKgPerOrder, acceptHoursBefore: cfg.acceptHoursBefore },
    sizeClasses: cfg.sizeClasses,
    policy: { cancelAfterReceivePercent: cfg.cancelAfterReceivePercent, maxCompensationMultiple: cfg.maxCompensationMultiple, claimDays: cfg.claimDays, compensationText: cfg.compensationText, note: cfg.note },
    categories: cats.filter((c) => !c.isProhibited).map((c) => ({ id: c._id, name: c.name, note: c.note || '', packingNote: c.packingNote || '' })),
    prohibited: cats.filter((c) => c.isProhibited).map((c) => ({ id: c._id, name: c.name, note: c.note || '' })),
    routes: routes.map((r) => ({
      id: r._id, name: r.name, fromProvinceId: r.fromProvinceId, toProvinceId: r.toProvinceId,
      fromOffices: r.offices.filter((o) => o.side === 'pickup' && offices.has(o.officeId)).map((o) => ({ id: o.officeId, name: offices.get(o.officeId).name, address: offices.get(o.officeId).address })),
      toOffices: r.offices.filter((o) => o.side === 'drop' && offices.has(o.officeId)).map((o) => ({ id: o.officeId, name: offices.get(o.officeId).name, address: offices.get(o.officeId).address })),
    })),
  };
}

function readItems(c, body) {
  return {
    routeId: c.id(body, 'routeId', { required: true }),
    date: c.date(body, 'date', { required: true }),
    fromOfficeId: c.id(body, 'fromOfficeId', { required: true }),
    toOfficeId: c.id(body, 'toOfficeId', { required: true }),
    categoryId: c.id(body, 'categoryId'),
    descriptionText: c.str(body, 'descriptionText', { required: true, max: 500 }),
    pieceCount: c.int(body, 'pieceCount', { min: 1, max: 100 }) || 1,
    weightKg: c.num(body, 'weightKg', { required: true, min: 0.1, max: 10000 }),
    sizeClass: c.oneOf(body, 'sizeClass', ['small', 'medium', 'large'], { required: true }),
    declaredValue: c.money(body, 'declaredValue') || 0,
    note: c.str(body, 'note', { max: 500 }) || '',
    pickupShuttle: readShuttle(c, body, 'pickupShuttle'),
    dropShuttle: readShuttle(c, body, 'dropShuttle'),
  };
}

function readShuttle(c, body, key) {
  const o = body?.[key] ? c.obj(body, key) : null;
  if (!o) return null;
  return { zoneId: c.id(o, 'zoneId', { field: `${key}.zoneId`, required: true }), addressText: c.str(o, 'addressText', { field: `${key}.addressText`, required: true, max: 300 }), noteText: c.str(o, 'noteText', { field: `${key}.noteText`, max: 300 }) || '' };
}

async function shuttleFee(input, officeId, direction, key) {
  if (!input) return null;
  const z = await ShuttleZone.findById(input.zoneId).lean();
  const ok = z && z.isActive && z.officeId === officeId && (direction === 'pickup' ? z.pickupEnabled : z.dropEnabled);
  if (!ok) throw new AppError(409, 'shuttle_unavailable', { fields: [{ field: `${key}.zoneId`, code: 'shuttle_unavailable' }] });
  return { ...input, direction, officeId, zoneName: z.name, fee: z.fee || 0, status: 'pending' };
}

/** Fee from the route's rate table (220). Returns the breakdown. */
async function computeFee({ routeId, sizeClass, weightKg, declaredValue, pickupShuttle, dropShuttle }) {
  const rates = await ParcelRate.find({ routeId, sizeClass }).sort({ maxWeightKg: 1 }).lean();
  if (!rates.length) throw new AppError(409, 'parcel_no_rate', { fields: [{ field: 'sizeClass', code: 'parcel_no_rate' }] });
  const tier = rates.find((r) => weightKg <= r.maxWeightKg);
  const top = rates[rates.length - 1];
  const base = tier ? tier.price : top.price;
  const extraKg = tier ? 0 : Math.ceil(weightKg - top.maxWeightKg);
  const extraAmount = extraKg * (top.extraPerKg || 0);
  const pct = (tier || top).declaredValuePercent || 0;
  const declaredSurcharge = Math.round(((declaredValue || 0) * pct) / 100);
  const pickupFee = pickupShuttle?.fee || 0;
  const dropFee = dropShuttle?.fee || 0;
  return { rateId: (tier || top)._id, weightKg, sizeClass, base, extraKg, extraAmount, declaredValue: declaredValue || 0, declaredValuePercent: pct, declaredSurcharge, pickupFee, dropFee, total: base + extraAmount + declaredSurcharge + pickupFee + dropFee };
}

async function validateItems(input) {
  const cfg = await settings.get('parcel');
  if (!cfg.enabled) throw conflict('parcel_disabled');
  const route = await Route.findById(input.routeId).lean();
  if (!route || route.status !== 'active' || !route.parcelEnabled) throw conflict('parcel_disabled');
  const bad = [];
  if (!routesSvc.officeStop(route, input.fromOfficeId, 'pickup')) bad.push({ field: 'fromOfficeId', code: 'office_not_on_route' });
  if (!routesSvc.officeStop(route, input.toOfficeId, 'drop')) bad.push({ field: 'toOfficeId', code: 'office_not_on_route' });
  if (bad.length) throw new AppError(409, 'office_not_on_route', { fields: bad });
  if (input.categoryId) {
    const cat = await ParcelCategory.findById(input.categoryId).lean();
    if (!cat) throw invalid([{ field: 'categoryId', code: 'not_found' }]);
    if (cat.isProhibited) throw new AppError(409, 'parcel_prohibited', { fields: [{ field: 'categoryId', code: 'parcel_prohibited' }] });
  }
  if (input.weightKg > cfg.maxWeightKgPerOrder) throw new AppError(409, 'parcel_too_heavy', { maxWeightKg: cfg.maxWeightKgPerOrder });
  const pickupShuttle = await shuttleFee(input.pickupShuttle, input.fromOfficeId, 'pickup', 'pickupShuttle');
  const dropShuttle = await shuttleFee(input.dropShuttle, input.toOfficeId, 'drop', 'dropShuttle');
  return { route, cfg, pickupShuttle, dropShuttle };
}

/** POST /v1/parcels/quote (58). */
async function quote(body) {
  const c = new Checker();
  const input = readItems(c, body);
  c.done();
  const { pickupShuttle, dropShuttle } = await validateItems(input);
  return { estimate: await computeFee({ ...input, pickupShuttle, dropShuttle }), note: 'fee_may_change_after_weighing' };
}

// ---------- presenter ----------

async function presentMany(rows, { admin = false } = {}) {
  if (!rows.length) return [];
  const officeIds = [...new Set(rows.flatMap((p) => [p.fromOfficeId, p.toOfficeId]))];
  const [offices, routes, trips, cats, events] = await Promise.all([
    Office.find({ _id: { $in: officeIds } }).lean(),
    Route.find({ _id: { $in: [...new Set(rows.map((p) => p.routeId))] } }).lean(),
    Trip.find({ _id: { $in: rows.map((p) => p.tripId).filter(Boolean) } }).lean(),
    ParcelCategory.find({ _id: { $in: rows.map((p) => p.categoryId).filter(Boolean) } }).lean(),
    OrderEvent.find({ orderType: 'parcel', orderId: { $in: rows.map((p) => p._id) }, ...(admin ? {} : { internal: false }) }).sort({ at: 1 }).lean(),
  ]);
  const om = new Map(offices.map((o) => [o._id, o]));
  const rm = new Map(routes.map((r) => [r._id, r]));
  const tm = new Map(trips.map((t) => [t._id, t]));
  const cm = new Map(cats.map((x) => [x._id, x]));
  const office = (id) => (om.get(id) ? { id, name: om.get(id).name, address: om.get(id).address, phone: om.get(id).phone || '' } : { id, name: '' });
  const MILESTONES = ['created', 'accepted', 'received', 'loaded', 'arrived', 'delivered'];
  return rows.map((p) => {
    const trip = p.tripId ? tm.get(p.tripId) : null;
    const ev = events.filter((e) => e.orderId === p._id);
    const at = (k) => ev.find((e) => e.kind === k)?.at || null;
    const out = {
      id: p._id, code: p.code, status: p.status, paid: (p.paidAmount || 0) > 0, payMethod: p.payMethod, source: p.source,
      sender: { name: p.senderName, phone: p.senderPhone },
      receiver: { name: p.receiverName, phone: p.receiverPhone, addressText: p.receiverAddress || '' },
      route: rm.get(p.routeId) ? { id: p.routeId, name: rm.get(p.routeId).name } : null,
      date: p.date,
      trip: trip ? { id: trip._id, departAt: iso(trip.departAt), date: T.toLocal(trip.departAt).date, departTime: T.toLocal(trip.departAt).time, status: trip.status } : null,
      fromOffice: office(p.fromOfficeId), toOffice: office(p.toOfficeId),
      category: p.categoryId && cm.get(p.categoryId) ? { id: p.categoryId, name: cm.get(p.categoryId).name } : null,
      descriptionText: p.descriptionText, pieceCount: p.pieceCount, weightKg: p.weightKg, actualWeightKg: p.actualWeightKg, sizeClass: p.sizeClass, declaredValue: p.declaredValue, note: p.note,
      pickupShuttle: p.pickupShuttle, dropShuttle: p.dropShuttle,
      estimate: p.estimate, fee: p.fee, feeBreakdown: p.feeBreakdown, feeAdjustReason: p.feeAdjustReason,
      paidAmount: p.paidAmount || 0, refundedAmount: p.refundedAmount || 0, rejectReason: p.rejectReason, cancelReason: p.cancelReason,
      unclaimed: !!p.unclaimed, arrivedAt: iso(p.arrivedAt), deliveredAt: iso(p.deliveredAt),
      timeline: MILESTONES.map((k) => ({ step: k, at: iso(k === 'created' ? p.createdAt : at(k)), done: k === 'created' || !!at(k) })),
      history: ev.map((e) => ({ kind: e.kind, at: iso(e.at), note: e.note, byRole: e.byRole })),
      handoverLocked: (p.handoverFailures || 0) >= 5,
      actions: {
        cancel: ['pending', 'accepted', 'received'].includes(p.status),
        regenerateCode: ACTIVE.includes(p.status),
        reportIssue: ON_TRIP.includes(p.status),
      },
      createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt),
    };
    if (admin) Object.assign(out, { senderAccountId: p.senderAccountId, guestContactId: p.guestContactId, handoverFailures: p.handoverFailures || 0, internalNotes: p.internalNotes || [] });
    return out;
  });
}
const presentOne = async (p, opts) => (await presentMany([p], opts))[0];

// ---------- customer ----------

/** POST /v1/parcels (57). Returns the parcel and `handoverCode` (shown once; regenerate if lost). */
async function create(auth, body, { idempotencyKey } = {}) {
  const key = idempotencyKey ? `parcel|${auth.accountId}|${sha256(String(idempotencyKey).slice(0, 100))}` : null;
  if (key) {
    const r = await Receipt.findById(key).lean();
    if (r) return { status: 200, body: { ...(await presentOne(await load(r.result.parcelId))), handoverCode: null } };
  }
  const c = new Checker();
  const input = readItems(c, body);
  const s = c.obj(body, 'sender');
  const r = c.obj(body, 'receiver', { required: true }) || {};
  const receiver = { name: c.str(r, 'name', { field: 'receiver.name', required: true, max: 80 }), phone: c.phone(r, 'phone', { field: 'receiver.phone', required: true }), addressText: c.str(r, 'addressText', { field: 'receiver.addressText', max: 300 }) || '' };
  const sender = { name: (s && c.str(s, 'name', { field: 'sender.name', max: 80 })) || auth.account.displayName, phone: (s && c.phone(s, 'phone', { field: 'sender.phone' })) || auth.account.phone || '' };
  if (body?.commitAccepted !== true) c.fail('commitAccepted', 'commitment_required');
  c.done();
  if (input.date < T.today()) throw invalid([{ field: 'date', code: 'out_of_range' }]);
  const { pickupShuttle, dropShuttle } = await validateItems(input);
  const estimate = await computeFee({ ...input, pickupShuttle, dropShuttle });
  const code = newHandoverCode();
  const now = new Date();
  const bookings = require('./bookings');
  const doc = {
    _id: uuid(), code: await bookings.newCode('GD', Parcel), senderAccountId: auth.accountId, guestContactId: null, source: 'app',
    senderName: sender.name, senderPhone: normalizePhone(sender.phone) || sender.phone, receiverName: receiver.name, receiverPhone: normalizePhone(receiver.phone) || receiver.phone, receiverAddress: receiver.addressText,
    ...input, pickupShuttle: pickupShuttle && { ...pickupShuttle, id: uuid() }, dropShuttle: dropShuttle && { ...dropShuttle, id: uuid() },
    estimate, fee: estimate.total, status: 'pending', handoverCodeHash: sha256(code), commitAccepted: true,
    policySnapshot: await settings.get('parcel'), createdBy: auth.accountId, createdAt: now, updatedAt: now,
  };
  doc.search = noAccent([doc.code, doc.receiverName, doc.receiverPhone, doc.senderName].join(' '));
  await Parcel.create(doc);
  if (key) await Receipt.create({ _id: key, result: { parcelId: doc._id }, expireAt: new Date(Date.now() + 86400000) });
  await event(doc, auth, 'created', { newValue: { fee: estimate.total } });
  return { status: 201, body: { ...(await presentOne(doc)), handoverCode: code } };
}

const TABS = { active: { status: { $in: ACTIVE } }, delivered: { status: 'delivered' }, cancelled: { status: { $in: ['cancelled', 'rejected'] } } };

async function list(auth, query) {
  const filter = auth.role === 'admin' ? {} : { senderAccountId: auth.accountId };
  if (query.tab && TABS[query.tab]) Object.assign(filter, TABS[query.tab]);
  if (query.status) filter.status = { $in: String(query.status).split(',') };
  if (query.paid === 'true') filter.paidAmount = { $gt: 0 };
  if (query.paid === 'false') filter.paidAmount = 0;
  if (auth.role === 'admin') {
    for (const k of ['tripId', 'routeId', 'fromOfficeId', 'toOfficeId', 'source']) if (query[k]) filter[k] = String(query[k]);
    if (T.isDate(query.date)) filter.date = query.date;
  }
  if (query.q) filter.search = { $regex: noAccent(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
  const p = paging(query, 20);
  const [rows, total] = await Promise.all([Parcel.find(filter).sort({ createdAt: auth.role === 'admin' && filter.status === 'pending' ? 1 : -1 }).skip(p.skip).limit(p.limit + 1).lean(), Parcel.countDocuments(filter)]);
  const items = await presentMany(rows.slice(0, p.limit), { admin: auth.role === 'admin' });
  return page(rows.length > p.limit ? [...items, null] : items, p, total);
}

const get = async (auth, id) => presentOne(await loadFor(auth, id), { admin: auth.role === 'admin' });

/** Refund for a cancelled parcel: full before the office received the goods, then the operator's percent (66). */
function cancelPreview(p) {
  const pct = p.status === 'received' ? (p.policySnapshot?.cancelAfterReceivePercent ?? 0) : 100;
  const paid = p.paidAmount || 0;
  return { allowed: ['pending', 'accepted', 'received'].includes(p.status), paidAmount: paid, refundPercent: pct, refundAmount: Math.round((paid * pct) / 100) };
}

async function getCancelPreview(auth, id) {
  return cancelPreview(await loadFor(auth, id));
}

async function cancel(auth, id, body) {
  const p = await loadFor(auth, id);
  const c = new Checker();
  const note = c.str(body, 'note', { max: 500 }) || '';
  const refundOverride = auth.role === 'admin' ? c.money(body, 'refundAmount') : undefined;
  c.done();
  const pv = cancelPreview(p);
  if (!pv.allowed) throw conflict('cancel_not_allowed');
  const now = new Date();
  const r = await Parcel.updateOne({ _id: id, status: p.status }, { $set: { status: 'cancelled', cancelReason: note || (auth.role === 'admin' ? 'admin' : 'customer'), updatedAt: now } });
  if (!r.modifiedCount) throw conflict('invalid_status');
  await releaseLoad(p);
  const amount = refundOverride ?? pv.refundAmount;
  if (amount > 0) await Refund.create({ _id: uuid(), orderType: 'parcel', orderId: id, orderCode: p.code, accountId: p.senderAccountId, amount, reason: 'parcel_cancel', status: 'pending', tripId: p.tripId, routeId: p.routeId, note, createdAt: now });
  await event(p, auth, 'cancelled', { oldValue: p.status, newValue: 'cancelled', note });
  if (auth.role === 'admin') await notify.push(p.senderAccountId, 'parcel', 'parcel_cancelled', { refType: 'parcel', refId: id, params: { code: p.code, note } });
  return { refundAmount: amount, parcel: await presentOne(await load(id), { admin: auth.role === 'admin' }) };
}

/** POST /v1/parcels/:id/handover-code — new pickup code (old one stops working), shown once. */
async function regenerateCode(auth, id) {
  const p = await loadFor(auth, id);
  if (!ACTIVE.includes(p.status)) throw conflict('invalid_status');
  const code = newHandoverCode();
  await Parcel.updateOne({ _id: id }, { $set: { handoverCodeHash: sha256(code), handoverFailures: 0, updatedAt: new Date() } });
  await event(p, auth, 'handover_code_regenerated', { internal: auth.role !== 'admin' ? false : true });
  return { handoverCode: code };
}

/** Plain text for the receiver (67): code, pickup code if given, office, expected time. */
async function shareText(auth, id, { handoverCode = null, lang = 'vi' } = {}) {
  const p = await loadFor(auth, id);
  const [v] = await presentMany([p]);
  const op = await settings.get('operator');
  const en = lang === 'en';
  const route = await Route.findById(p.routeId).lean();
  const stop = routesSvc.officeStop(route, p.toOfficeId, 'drop');
  const trip = p.tripId ? await Trip.findById(p.tripId).lean() : null;
  const eta = trip && stop ? T.toLocal(routesSvc.officeTime(trip.departAt, stop)) : null;
  return [
    `${op.name || 'SeatRoute'}${op.phone ? ` - ${op.phone}` : ''}`,
    `${en ? 'Parcel code' : 'Mã đơn gửi đồ'}: ${p.code}`,
    handoverCode ? `${en ? 'Pickup code' : 'Mã nhận hàng'}: ${handoverCode}` : null,
    `${en ? 'Receiver' : 'Người nhận'}: ${p.receiverName} - ${p.receiverPhone}`,
    `${en ? 'Pick up at' : 'Nhận tại'}: ${v.toOffice.name}, ${v.toOffice.address || ''}`,
    eta ? `${en ? 'Expected' : 'Dự kiến tới'}: ${eta.time} ${eta.date}` : null,
  ].filter(Boolean).join('\n');
}

/** POST /v1/parcels/:id/issue { kind: late|damaged|lost|other, text } -> complaint attached to the parcel (68). */
async function reportIssue(auth, id, body) {
  const p = await loadFor(auth, id);
  const c = new Checker();
  const kind = c.oneOf(body, 'kind', ['late', 'damaged', 'lost', 'other'], { required: true });
  const text = c.str(body, 'text', { required: true, max: 2000 });
  c.done();
  return require('./social').createComplaint(auth, { orderType: 'parcel', orderId: p._id, category: `parcel_${kind}`, text });
}

// ---------- payments ----------

async function markPaid(auth, p, { method, amount, note = '' }) {
  const now = new Date();
  await Parcel.updateOne({ _id: p._id }, { $set: { payMethod: method, paidAmount: amount, updatedAt: now } });
  const trip = p.tripId ? await Trip.findById(p.tripId).select('vehicleId').lean() : null;
  await PaymentRecord.create({ _id: uuid(), orderType: 'parcel', orderId: p._id, source: p.source, method, amount, note, tripId: p.tripId, routeId: p.routeId, vehicleId: trip?.vehicleId, departAt: p.departAt, recordedBy: auth.accountId, recordedAt: now });
  await event(p, auth, 'paid', { newValue: { method, amount }, note });
}

// ---------- capacity ----------

async function capacityOf(trip) {
  if (trip.parcelCapacity) return trip.parcelCapacity;
  const cfg = await settings.get('parcel');
  return { maxKg: cfg.defaultMaxKg, maxPieces: cfg.defaultMaxPieces };
}

/** Adds the parcel to the trip load only if it still fits (atomic). */
async function reserveLoad(trip, kg, pieces) {
  const cap = await capacityOf(trip);
  const r = await Trip.updateOne(
    { _id: trip._id, $expr: { $and: [{ $lte: [{ $add: [{ $ifNull: ['$parcelLoad.kg', 0] }, kg] }, cap.maxKg] }, { $lte: [{ $add: [{ $ifNull: ['$parcelLoad.pieces', 0] }, pieces] }, cap.maxPieces] }] } },
    { $inc: { 'parcelLoad.kg': kg, 'parcelLoad.pieces': pieces } },
  );
  if (!r.modifiedCount) {
    const t = await Trip.findById(trip._id).lean();
    throw new AppError(409, 'capacity_exceeded', { capacity: cap, load: t.parcelLoad });
  }
}

async function releaseLoad(p) {
  if (!p.tripId || !ON_TRIP.includes(p.status)) return;
  await Trip.updateOne({ _id: p.tripId }, { $inc: { 'parcelLoad.kg': -weightOf(p), 'parcelLoad.pieces': -p.pieceCount } });
}

async function tripFor(p, tripId) {
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw invalid([{ field: 'tripId', code: 'not_found' }]);
  if (trip.routeId !== p.routeId) throw invalid([{ field: 'tripId', code: 'different_route' }]);
  if (['cancelled', 'completed'].includes(trip.status)) throw conflict('trip_not_on_sale');
  return trip;
}

// ---------- admin ----------

/**
 * POST /manage/parcels/:id/accept { tripId, actualWeightKg?, fee?, feeAdjustReason? } (61, 152).
 * Final fee = recomputed with the actual weight, or `fee` set by the admin (reason required if it differs).
 */
async function accept(auth, id, body) {
  const p = await load(id);
  if (p.status !== 'pending') throw conflict('invalid_status');
  const c = new Checker();
  const tripId = c.id(body, 'tripId', { required: true });
  const actualWeightKg = c.num(body, 'actualWeightKg', { min: 0.1, max: 10000 });
  const fee = c.money(body, 'fee');
  const feeAdjustReason = c.str(body, 'feeAdjustReason', { max: 300 }) || null;
  c.done();
  const trip = await tripFor(p, tripId);
  const weight = actualWeightKg ?? p.weightKg;
  const breakdown = await computeFee({ routeId: p.routeId, sizeClass: p.sizeClass, weightKg: weight, declaredValue: p.declaredValue, pickupShuttle: p.pickupShuttle, dropShuttle: p.dropShuttle });
  const finalFee = fee ?? breakdown.total;
  // The customer must see why the final fee differs from the estimate (58).
  if (finalFee !== p.estimate?.total && !feeAdjustReason) throw invalid([{ field: 'feeAdjustReason', code: 'required' }]);
  await reserveLoad(trip, weight, p.pieceCount);
  const r = await Parcel.updateOne({ _id: id, status: 'pending' }, {
    $set: { status: 'accepted', tripId, departAt: trip.departAt, date: trip.date, actualWeightKg: actualWeightKg ?? null, fee: finalFee, feeBreakdown: { ...breakdown, finalFee }, feeAdjustReason, updatedAt: new Date() },
  });
  if (!r.modifiedCount) {
    await Trip.updateOne({ _id: tripId }, { $inc: { 'parcelLoad.kg': -weight, 'parcelLoad.pieces': -p.pieceCount } });
    throw conflict('invalid_status');
  }
  await event(p, auth, 'accepted', { newValue: { tripId, fee: finalFee }, note: feeAdjustReason || '' });
  const l = T.toLocal(trip.departAt);
  await notify.push(p.senderAccountId, 'parcel', 'parcel_accepted', { refType: 'parcel', refId: id, params: { code: p.code, fee: finalFee, date: l.date, time: l.time } });
  return presentOne(await load(id), { admin: true });
}

async function reject(auth, id, body) {
  const p = await load(id);
  if (p.status !== 'pending') throw conflict('invalid_status');
  const c = new Checker();
  const reason = c.str(body, 'reason', { required: true, max: 500 });
  c.done();
  await Parcel.updateOne({ _id: id }, { $set: { status: 'rejected', rejectReason: reason, updatedAt: new Date() } });
  await event(p, auth, 'rejected', { note: reason });
  await notify.push(p.senderAccountId, 'parcel', 'parcel_rejected', { refType: 'parcel', refId: id, params: { code: p.code, reason } });
  return presentOne(await load(id), { admin: true });
}

const NEXT = { received: ['accepted'], loaded: ['received'], arrived: ['loaded'] };

/**
 * POST /manage/parcels/:id/status { status: received|loaded|arrived, note?, actualWeightKg?, fee?, feeAdjustReason?, cashAmount? } (182).
 * `received` may record cash paid at the office (cashAmount). `loaded` needs the fee to be paid.
 */
async function setStatus(auth, id, body) {
  const p = await load(id);
  const c = new Checker();
  const status = c.oneOf(body, 'status', ['received', 'loaded', 'arrived'], { required: true });
  const note = c.str(body, 'note', { max: 300 }) || '';
  const actualWeightKg = c.num(body, 'actualWeightKg', { min: 0.1, max: 10000 });
  const fee = c.money(body, 'fee');
  const feeAdjustReason = c.str(body, 'feeAdjustReason', { max: 300 });
  const payMethod = c.oneOf(body, 'payMethod', ['cash', 'transfer']) || 'cash';
  c.done();
  if (!NEXT[status].includes(p.status)) throw conflict('invalid_status', { current: p.status });
  const set = { status, updatedAt: new Date() };
  if (status === 'received' && (actualWeightKg !== undefined || fee !== undefined)) {
    if ((p.paidAmount || 0) > 0) throw conflict('invalid_status', { hint: 'already_paid' });
    if (!feeAdjustReason) throw invalid([{ field: 'feeAdjustReason', code: 'required' }]);
    const weight = actualWeightKg ?? weightOf(p);
    const breakdown = await computeFee({ routeId: p.routeId, sizeClass: p.sizeClass, weightKg: weight, declaredValue: p.declaredValue, pickupShuttle: p.pickupShuttle, dropShuttle: p.dropShuttle });
    const delta = weight - weightOf(p);
    if (delta > 0) await reserveLoad(await Trip.findById(p.tripId).lean(), delta, 0);
    else if (delta < 0) await Trip.updateOne({ _id: p.tripId }, { $inc: { 'parcelLoad.kg': delta } });
    Object.assign(set, { actualWeightKg: weight, fee: fee ?? breakdown.total, feeBreakdown: { ...breakdown, finalFee: fee ?? breakdown.total }, feeAdjustReason });
    await notify.push(p.senderAccountId, 'parcel', 'parcel_fee_adjusted', { refType: 'parcel', refId: id, params: { code: p.code, fee: set.fee, reason: feeAdjustReason } });
  }
  if (status === 'arrived') set.arrivedAt = new Date();
  const r = await Parcel.updateOne({ _id: id, status: p.status }, { $set: set });
  if (!r.modifiedCount) throw conflict('invalid_status');
  await event(p, auth, status, { oldValue: p.status, newValue: status, note });
  // The sender pays the fee at the counter when the office takes the goods: that is the moment it counts as revenue.
  if (status === 'received' && !(p.paidAmount > 0)) await markPaid(auth, { ...p, ...set }, { method: payMethod, amount: set.fee ?? p.fee, note: 'paid at the counter' });
  const trip = p.tripId ? await Trip.findById(p.tripId).lean() : null;
  const office = await Office.findById(p.toOfficeId).lean();
  const l = trip ? T.toLocal(trip.departAt) : {};
  await notify.push(p.senderAccountId, 'parcel', `parcel_${status}`, { refType: 'parcel', refId: id, params: { code: p.code, date: l.date, time: l.time, office: office?.name || '' } });
  return presentOne(await load(id), { admin: true });
}

/** POST /manage/parcels/:id/handover { code } — the office types the receiver's code (63, 182). 5 wrong codes lock it. */
async function handover(auth, id, body) {
  const p = await load(id);
  if (p.status !== 'arrived') throw conflict('invalid_status');
  if ((p.handoverFailures || 0) >= 5) throw conflict('handover_locked');
  const c = new Checker();
  const code = c.str(body, 'code', { required: true, max: 10 });
  const receiverName = c.str(body, 'receiverName', { max: 80 });
  c.done();
  if (sha256(String(code).replace(/\D/g, '')) !== p.handoverCodeHash) {
    const after = await Parcel.findOneAndUpdate({ _id: id }, { $inc: { handoverFailures: 1 } }, { new: true }).lean();
    await event(p, auth, 'handover_failed', { internal: true });
    throw new AppError(400, after.handoverFailures >= 5 ? 'handover_locked' : 'handover_invalid', { attemptsLeft: Math.max(0, 5 - after.handoverFailures) });
  }
  const now = new Date();
  await Parcel.updateOne({ _id: id, status: 'arrived' }, { $set: { status: 'delivered', deliveredAt: now, unclaimed: false, updatedAt: now } });
  await event(p, auth, 'delivered', { note: receiverName || '' });
  await notify.push(p.senderAccountId, 'parcel', 'parcel_delivered', { refType: 'parcel', refId: id, params: { code: p.code } });
  return presentOne(await load(id), { admin: true });
}

/** POST /manage/parcels/:id/unclaimed — nobody came to pick it up (182). */
async function markUnclaimed(auth, id) {
  const p = await load(id);
  if (p.status !== 'arrived') throw conflict('invalid_status');
  await Parcel.updateOne({ _id: id }, { $set: { unclaimed: true, updatedAt: new Date() } });
  await event(p, auth, 'unclaimed');
  const office = await Office.findById(p.toOfficeId).lean();
  await notify.push(p.senderAccountId, 'parcel', 'parcel_unclaimed', { refType: 'parcel', refId: id, params: { code: p.code, office: office?.name || '' } });
  return presentOne(await load(id), { admin: true });
}

/** POST /manage/parcels/:id/issue { kind, note, compensationAmount? } (183). Compensation is only recorded. */
async function recordIssue(auth, id, body) {
  const p = await load(id);
  if (!ON_TRIP.includes(p.status)) throw conflict('invalid_status');
  const c = new Checker();
  const kind = c.oneOf(body, 'kind', ['damaged', 'lost', 'late', 'other'], { required: true });
  const note = c.str(body, 'note', { required: true, max: 1000 });
  const compensationAmount = c.money(body, 'compensationAmount');
  c.done();
  await Parcel.updateOne({ _id: id }, { $set: { status: 'issue', updatedAt: new Date() } });
  await event(p, auth, 'issue', { oldValue: p.status, newValue: kind, note });
  if (compensationAmount) {
    await Refund.create({ _id: uuid(), orderType: 'parcel', orderId: id, orderCode: p.code, accountId: p.senderAccountId, amount: compensationAmount, reason: 'compensation', status: 'pending', tripId: p.tripId, routeId: p.routeId, note, createdAt: new Date() });
  }
  await notify.push(p.senderAccountId, 'parcel', 'parcel_issue', { refType: 'parcel', refId: id, params: { code: p.code, note } });
  return presentOne(await load(id), { admin: true });
}

/** PUT /manage/parcels/:id/trip { tripId } — move to another trip of the route (capacity checked). */
async function moveTrip(auth, id, body) {
  const p = await load(id);
  if (!['accepted', 'received'].includes(p.status)) throw conflict('invalid_status');
  const c = new Checker();
  const tripId = c.id(body, 'tripId', { required: true });
  c.done();
  const trip = await tripFor(p, tripId);
  await reserveLoad(trip, weightOf(p), p.pieceCount);
  await releaseLoad(p);
  await Parcel.updateOne({ _id: id }, { $set: { tripId, departAt: trip.departAt, date: trip.date, updatedAt: new Date() } });
  await event(p, auth, 'trip_changed', { oldValue: p.tripId, newValue: tripId });
  return presentOne(await load(id), { admin: true });
}

/** Trip cancelled: the parcel waits for another trip. */
async function detachFromTrip(auth, p, reason) {
  await releaseLoad(p);
  await Parcel.updateOne({ _id: p._id }, { $set: { tripId: null, departAt: null, updatedAt: new Date() } });
  await event(p, auth, 'trip_cancelled', { note: reason });
  await notify.push(p.senderAccountId, 'parcel', 'parcel_issue', { refType: 'parcel', refId: p._id, params: { code: p.code, note: reason } });
}

/**
 * POST /manage/parcels — goods taken at the counter (139): weighed now, fee computed, paid cash or by transfer,
 * status `received` (and `paid`). Returns the pickup code + share text for the sender.
 */
async function adminCreate(auth, body) {
  const c = new Checker();
  const input = readItems(c, body);
  const s = c.obj(body, 'sender', { required: true }) || {};
  const r = c.obj(body, 'receiver', { required: true }) || {};
  const sender = { name: c.str(s, 'name', { field: 'sender.name', required: true, max: 80 }), phone: c.phone(s, 'phone', { field: 'sender.phone', required: true }) };
  const receiver = { name: c.str(r, 'name', { field: 'receiver.name', required: true, max: 80 }), phone: c.phone(r, 'phone', { field: 'receiver.phone', required: true }), addressText: c.str(r, 'addressText', { field: 'receiver.addressText', max: 300 }) || '' };
  const tripId = c.id(body, 'tripId');
  const payMethod = c.oneOf(body, 'payMethod', ['cash', 'transfer'], { required: true });
  const fee = c.money(body, 'fee');
  const feeAdjustReason = c.str(body, 'feeAdjustReason', { max: 300 }) || null;
  c.done();
  const { pickupShuttle, dropShuttle } = await validateItems(input);
  const breakdown = await computeFee({ ...input, pickupShuttle, dropShuttle });
  const finalFee = fee ?? breakdown.total;
  if (fee !== undefined && fee !== breakdown.total && !feeAdjustReason) throw invalid([{ field: 'feeAdjustReason', code: 'required' }]);
  const bookings = require('./bookings');
  const guestContactId = await bookings.upsertGuest(auth, sender);
  const account = await Account.findOne({ phone: normalizePhone(sender.phone), role: 'customer' }).select('_id').lean();
  let trip = null;
  if (tripId) {
    trip = await tripFor({ routeId: input.routeId }, tripId);
    await reserveLoad(trip, input.weightKg, input.pieceCount);
  }
  const code = newHandoverCode();
  const now = new Date();
  const doc = {
    _id: uuid(), code: await bookings.newCode('GD', Parcel), senderAccountId: account?._id || null, guestContactId, source: 'admin',
    senderName: sender.name, senderPhone: normalizePhone(sender.phone) || sender.phone, receiverName: receiver.name, receiverPhone: normalizePhone(receiver.phone) || receiver.phone, receiverAddress: receiver.addressText,
    ...input, tripId: trip?._id || null, departAt: trip?.departAt || null, date: trip?.date || input.date, actualWeightKg: input.weightKg,
    pickupShuttle: pickupShuttle && { ...pickupShuttle, id: uuid() }, dropShuttle: dropShuttle && { ...dropShuttle, id: uuid() },
    estimate: breakdown, fee: finalFee, feeBreakdown: { ...breakdown, finalFee }, feeAdjustReason, status: trip ? 'received' : 'pending',
    handoverCodeHash: sha256(code), commitAccepted: true, policySnapshot: await settings.get('parcel'), createdBy: auth.accountId, createdAt: now, updatedAt: now,
  };
  doc.search = noAccent([doc.code, doc.receiverName, doc.receiverPhone, doc.senderName, doc.senderPhone].join(' '));
  await Parcel.create(doc);
  await event(doc, auth, 'created_by_admin', { newValue: { fee: finalFee, payMethod } });
  if (trip) await event(doc, auth, 'received');
  await markPaid(auth, doc, { method: payMethod, amount: finalFee, note: 'counter' });
  return { ...(await presentOne(await load(doc._id), { admin: true })), handoverCode: code, shareText: await shareText(auth, doc._id, { handoverCode: code }) };
}

/** GET /manage/trips/:id/parcels (181): list + total weight and pieces vs the trip capacity. */
async function tripParcels(tripId) {
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw notFound();
  const rows = await Parcel.find({ tripId, status: { $in: ON_TRIP } }).sort({ createdAt: 1 }).lean();
  const items = await presentMany(rows, { admin: true });
  return { tripId, capacity: await capacityOf(trip), load: trip.parcelLoad || { kg: 0, pieces: 0 }, totalKg: rows.reduce((s, p) => s + weightOf(p), 0), totalPieces: rows.reduce((s, p) => s + p.pieceCount, 0), items };
}

/** Daily job + home: arrived parcels nobody picked up after N hours -> remind the sender (69). */
async function remindUnclaimed() {
  const cfg = await settings.get('parcel');
  const rows = await Parcel.find({ status: 'arrived', unclaimed: false, arrivedAt: { $lte: T.addMinutes(new Date(), -cfg.unclaimedHours * 60) } }).limit(500).lean();
  for (const p of rows) await markUnclaimed(null, p._id);
  return rows.length;
}

module.exports = {
  ACTIVE, getConfig, quote, computeFee, create, list, get, getCancelPreview, cancel, regenerateCode, shareText, reportIssue,
  accept, reject, setStatus, handover, markUnclaimed, recordIssue, moveTrip,
  detachFromTrip, adminCreate, tripParcels, remindUnclaimed, presentMany, presentOne, load,
};
