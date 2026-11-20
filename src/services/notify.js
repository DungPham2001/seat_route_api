/**
 * In-app notification center (features 20-26, 179, 238). No push service: the app reloads on open and when
 * coming back from the background. Notifications are stored as kind + params and rendered per language.
 */
const { Notification, Booking, Account, Trip } = require('../models');
const { renderNotification } = require('../i18n');
const { uuid, iso } = require('../lib/util');
const { toLocal, addMinutes } = require('../lib/time');
const { paging, page } = require('../resources/engine');
const { notFound } = require('../lib/errors');

const PARAM_WORDS = {
  vi: { cancel: 'hủy', change_seat: 'đổi ghế', change_trip: 'đổi chuyến', refund: 'hoàn tiền', pickup: 'đón', drop: 'trả' },
  en: { cancel: 'cancel', change_seat: 'seat change', change_trip: 'trip change', refund: 'refund', pickup: 'pickup', drop: 'drop-off' },
};

const ACTIVE = ['pending', 'confirmed', 'cancel_requested'];

async function push(accountId, category, kind, { refType = null, refId = null, params = {} } = {}) {
  if (!accountId) return null;
  const doc = { _id: uuid(), accountId, category, kind, refType, refId, params, readAt: null, createdAt: new Date() };
  await Notification.create(doc);
  return doc;
}

async function pushMany(accountIds, category, kind, opts = {}) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  const now = new Date();
  const docs = ids.map((accountId) => ({ _id: uuid(), accountId, category, kind, refType: opts.refType || null, refId: opts.refId || null, params: opts.params || {}, readAt: null, createdAt: now }));
  for (let i = 0; i < docs.length; i += 500) await Notification.insertMany(docs.slice(i, i + 500), { ordered: false });
  return docs.length;
}

/** Params that describe a trip: route name, local date and time. */
async function tripParams(trip) {
  const { Route } = require('../models');
  const route = trip.routeId ? await Route.findById(trip.routeId).select('name').lean() : null;
  const l = toLocal(trip.departAt);
  return { route: route?.name || '', date: l.date, time: l.time };
}

/** Notifies every customer with an active booking on the trip (179, 22, 164). */
async function forTrip(tripId, kind, params = {}, { statuses = ACTIVE } = {}) {
  const trip = await Trip.findById(tripId).lean();
  if (!trip) return 0;
  const rows = await Booking.find({ tripId, status: { $in: statuses }, customerAccountId: { $ne: null } }).select('customerAccountId').lean();
  return pushMany(rows.map((b) => b.customerAccountId), 'trip', kind, { refType: 'trip', refId: tripId, params: { ...(await tripParams(trip)), ...params } });
}

/** An office was closed: upcoming bookings using it get a notice (never changed silently). */
async function officeClosed(office) {
  const rows = await Booking.find({
    status: { $in: ACTIVE }, departAt: { $gt: new Date() }, $or: [{ pickupOfficeId: office._id }, { dropOfficeId: office._id }],
  }).select('_id code customerAccountId').lean();
  for (const b of rows) {
    await Booking.updateOne({ _id: b._id }, { $push: { notices: { kind: 'office_closed', officeId: office._id, at: new Date() } } });
    await push(b.customerAccountId, 'trip', 'office_closed', { refType: 'booking', refId: b._id, params: { office: office.name, code: b.code } });
  }
}

/** Announcement / promo fan-out to every active customer (the app hides the groups the customer turned off). */
async function announcement(doc) {
  const promo = doc.kind === 'promo';
  const rows = await Account.find({ role: 'customer', status: 'active' }).select('_id').lean();
  return pushMany(rows.map((a) => a._id), promo ? 'promo' : 'system', 'announcement', { refType: 'announcement', refId: doc._id, params: { title: doc.title, body: doc.body } });
}

/** "Upcoming trip" reminder shown when the app opens (22): once per booking, within 24h of departure. */
async function ensureReminders(accountId) {
  const now = new Date();
  const rows = await Booking.find({ customerAccountId: accountId, status: 'confirmed', departAt: { $gt: now, $lte: addMinutes(now, 24 * 60) } }).lean();
  if (!rows.length) return;
  const done = new Set((await Notification.find({ accountId, kind: 'trip_reminder', refId: { $in: rows.map((b) => b._id) } }).select('refId').lean()).map((n) => n.refId));
  const { Office, Route } = require('../models');
  for (const b of rows) {
    if (done.has(b._id)) continue;
    const [trip, office] = await Promise.all([Trip.findById(b.tripId).lean(), Office.findById(b.pickupOfficeId).lean()]);
    if (!trip) continue;
    const route = await Route.findById(trip.routeId).lean();
    const off = (route?.offices || []).find((o) => o.officeId === b.pickupOfficeId && o.side === 'pickup');
    const l = toLocal(trip.departAt);
    await push(accountId, 'trip', 'trip_reminder', {
      refType: 'booking', refId: b._id,
      params: { route: route?.name || '', date: l.date, time: l.time, office: office?.name || '', officeTime: toLocal(addMinutes(trip.departAt, off?.offsetMinutes || 0)).time },
    });
  }
}

function present(n, lang) {
  const words = PARAM_WORDS[lang] || PARAM_WORDS.vi;
  const params = { ...n.params };
  for (const k of ['type', 'direction']) if (params[k] && words[params[k]]) params[k] = words[params[k]];
  const { title, text } = renderNotification(n.kind, params, lang);
  return { id: n._id, category: n.category, kind: n.kind, title, text, refType: n.refType, refId: n.refId, params: n.params, isRead: !!n.readAt, readAt: iso(n.readAt), createdAt: iso(n.createdAt) };
}

async function list(auth, query, lang) {
  if (auth.role === 'customer') await ensureReminders(auth.accountId);
  const filter = { accountId: auth.accountId };
  if (query.category) filter.category = query.category;
  if (query.unread === 'true') filter.readAt = null;
  const p = paging(query, 30);
  const [rows, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit + 1).lean(),
    Notification.countDocuments(filter),
    unreadCounts(auth.accountId),
  ]);
  return { ...page(rows.map((n) => present(n, lang)), p, total), unread };
}

async function unreadCounts(accountId) {
  const rows = await Notification.aggregate([{ $match: { accountId, readAt: null } }, { $group: { _id: '$category', n: { $sum: 1 } } }]);
  const byCategory = { order: 0, trip: 0, parcel: 0, promo: 0, system: 0 };
  for (const r of rows) byCategory[r._id] = r.n;
  return { total: rows.reduce((s, r) => s + r.n, 0), byCategory };
}

async function markRead(auth, body) {
  const filter = { accountId: auth.accountId, readAt: null };
  if (Array.isArray(body?.ids) && body.ids.length) filter._id = { $in: body.ids.map(String).slice(0, 500) };
  else if (body?.category) filter.category = String(body.category);
  else if (body?.all !== true) return { updated: 0, unread: await unreadCounts(auth.accountId) };
  const r = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return { updated: r.modifiedCount || 0, unread: await unreadCounts(auth.accountId) };
}

async function remove(auth, id) {
  const r = await Notification.deleteOne({ _id: id, accountId: auth.accountId });
  if (!r.deletedCount) throw notFound();
}

module.exports = { push, pushMany, forTrip, tripParams, officeClosed, announcement, ensureReminders, list, unreadCounts, markRead, remove, present };
