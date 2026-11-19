/**
 * User content and support: reviews (97, 98, 232), reports (100, 233), complaints (101, 234), chat inside a booking
 * (80, 235), "contact the operator" form (108, 236), waitlist (45, 96, 172).
 */
const models = require('../models');
const { Checker } = require('../lib/validate');
const { AppError, notFound, conflict } = require('../lib/errors');
const { uuid, iso } = require('../lib/util');
const notify = require('./notify');
const audit = require('./audit');
const { paging, page } = require('../resources/engine');

const { Review, Report, Complaint, Message, ContactMessage, Waitlist, Booking, Parcel, Account, Trip, TripSeat } = models;

/** "Phạm Văn Dũng" -> "Dũng P." for public reviews. */
const maskName = (n) => {
  const w = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return w.length === 1 ? w[0] : `${w[w.length - 1]} ${w[0][0]}.`;
};

// ---------- reviews ----------

const presentReview = (r, { admin = false, names = new Map(), mine = false } = {}) => ({
  id: r._id, bookingId: r.bookingId, tripId: r.tripId, routeId: r.routeId, stars: r.stars, text: r.text, reply: r.reply, repliedAt: iso(r.repliedAt),
  status: r.status, authorName: admin || mine ? names.get(r.accountId) || '' : maskName(names.get(r.accountId)), ...(admin ? { accountId: r.accountId } : {}),
  createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
});

const namesOf = async (ids) => new Map((await Account.find({ _id: { $in: [...new Set(ids.filter(Boolean))] } }).select('displayName').lean()).map((a) => [a._id, a.displayName]));

async function createReview(auth, body) {
  const c = new Checker();
  const bookingId = c.id(body, 'bookingId', { required: true });
  const stars = c.int(body, 'stars', { required: true, min: 1, max: 5 });
  const text = c.str(body, 'text', { max: 2000 }) || '';
  c.done();
  const b = await Booking.findOne({ _id: bookingId, customerAccountId: auth.accountId }).lean();
  if (!b) throw notFound();
  if (b.status !== 'completed') throw conflict('review_not_allowed');
  if (await Review.exists({ bookingId })) throw conflict('already_reviewed');
  const now = new Date();
  const doc = { _id: uuid(), bookingId, accountId: auth.accountId, tripId: b.tripId, routeId: b.routeId, stars, text, status: 'visible', createdAt: now, updatedAt: now };
  try {
    await Review.create(doc);
  } catch (err) {
    if (err.code === 11000) throw conflict('already_reviewed');
    throw err;
  }
  return presentReview(doc, { mine: true, names: await namesOf([auth.accountId]) });
}

async function updateReview(auth, id, body) {
  const r = await Review.findOne({ _id: id, accountId: auth.accountId }).lean();
  if (!r) throw notFound();
  const c = new Checker();
  const stars = c.int(body, 'stars', { min: 1, max: 5 });
  const text = c.str(body, 'text', { max: 2000 });
  c.done();
  const set = { updatedAt: new Date() };
  if (stars !== undefined) set.stars = stars;
  if (text !== undefined) set.text = text || '';
  await Review.updateOne({ _id: id }, { $set: set });
  return presentReview({ ...r, ...set }, { mine: true, names: await namesOf([auth.accountId]) });
}

async function deleteReview(auth, id) {
  const r = await Review.deleteOne({ _id: id, accountId: auth.accountId });
  if (!r.deletedCount) throw notFound();
  await Report.updateMany({ targetType: 'review', targetId: id, status: 'open' }, { $set: { status: 'resolved', resolution: 'content_deleted', resolvedAt: new Date() } });
}

/** GET /v1/me/reviews — written + completed trips waiting for a review (97, 17). */
async function myReviews(auth) {
  const [written, done] = await Promise.all([
    Review.find({ accountId: auth.accountId }).sort({ createdAt: -1 }).lean(),
    Booking.find({ customerAccountId: auth.accountId, status: 'completed' }).sort({ completedAt: -1 }).limit(50).lean(),
  ]);
  const reviewed = new Set(written.map((r) => r.bookingId));
  const pendingRows = done.filter((b) => !reviewed.has(b._id));
  const pending = await require('./bookings').presentMany(pendingRows);
  const names = await namesOf([auth.accountId]);
  return { written: written.map((r) => presentReview(r, { mine: true, names })), pending };
}

/** GET /v1/reviews?routeId — public reviews of the operator (30, 32). */
async function publicReviews(query) {
  const filter = { status: 'visible' };
  if (query.routeId) filter.routeId = String(query.routeId);
  const p = paging(query, 20);
  const [rows, total] = await Promise.all([Review.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit + 1).lean(), Review.countDocuments(filter)]);
  const names = await namesOf(rows.map((r) => r.accountId));
  return page(rows.map((r) => presentReview(r, { names })), p, total);
}

async function adminReviews(query) {
  const filter = {};
  if (query.status) filter.status = String(query.status);
  if (query.routeId) filter.routeId = String(query.routeId);
  if (query.replied === 'false') filter.reply = null;
  if (query.stars) filter.stars = Number(query.stars);
  const p = paging(query, 30);
  const [rows, total] = await Promise.all([Review.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit + 1).lean(), Review.countDocuments(filter)]);
  const names = await namesOf(rows.map((r) => r.accountId));
  return page(rows.map((r) => presentReview(r, { admin: true, names })), p, total);
}

async function replyReview(auth, id, body) {
  const c = new Checker();
  const reply = c.str(body, 'reply', { required: true, max: 2000 });
  c.done();
  const r = await Review.findOneAndUpdate({ _id: id }, { $set: { reply, repliedAt: new Date(), updatedAt: new Date() } }, { new: true }).lean();
  if (!r) throw notFound();
  const b = await Booking.findById(r.bookingId).select('code').lean();
  await notify.push(r.accountId, 'order', 'review_reply', { refType: 'review', refId: id, params: { code: b?.code || '' } });
  return presentReview(r, { admin: true, names: await namesOf([r.accountId]) });
}

async function setReviewStatus(auth, id, status, note = '') {
  const r = await Review.findOneAndUpdate({ _id: id }, { $set: { status, updatedAt: new Date() } }, { new: true }).lean();
  if (!r) throw notFound();
  await audit.log(auth, 'review', id, status === 'hidden' ? 'hidden' : 'shown', note);
  return presentReview(r, { admin: true, names: await namesOf([r.accountId]) });
}

// ---------- reports (100, 233) ----------

const REASONS = ['spam', 'offensive', 'false_info', 'personal_data', 'other'];

async function createReport(auth, body) {
  const c = new Checker();
  const targetType = c.oneOf(body, 'targetType', ['review', 'message'], { required: true });
  const targetId = c.id(body, 'targetId', { required: true });
  const reason = c.oneOf(body, 'reason', REASONS, { required: true });
  const text = c.str(body, 'text', { max: 1000 }) || '';
  c.done();
  if (targetType === 'review') {
    if (!(await Review.exists({ _id: targetId, status: 'visible' }))) throw notFound();
  } else {
    const m = await Message.findById(targetId).lean();
    if (!m) throw notFound();
    const b = await Booking.findById(m.bookingId).select('customerAccountId').lean();
    if (auth.role !== 'admin' && b?.customerAccountId !== auth.accountId) throw notFound();
  }
  const doc = { _id: uuid(), reporterAccountId: auth.accountId, targetType, targetId, reason, text, status: 'open', createdAt: new Date() };
  await Report.create(doc);
  return presentReport(doc);
}

const presentReport = (r, target = null) => ({
  id: r._id, reporterAccountId: r.reporterAccountId, targetType: r.targetType, targetId: r.targetId, reason: r.reason, text: r.text, status: r.status,
  action: r.action, resolution: r.resolution, resolvedAt: iso(r.resolvedAt), createdAt: iso(r.createdAt), ...(target ? { target } : {}),
});

async function adminReports(query) {
  const filter = { status: query.status || 'open' };
  const p = paging(query, 30);
  const [rows, total] = await Promise.all([Report.find(filter).sort({ createdAt: 1 }).skip(p.skip).limit(p.limit + 1).lean(), Report.countDocuments(filter)]);
  const reviews = new Map((await Review.find({ _id: { $in: rows.filter((r) => r.targetType === 'review').map((r) => r.targetId) } }).lean()).map((x) => [x._id, x]));
  const messages = new Map((await Message.find({ _id: { $in: rows.filter((r) => r.targetType === 'message').map((r) => r.targetId) } }).lean()).map((x) => [x._id, x]));
  const names = await namesOf([...reviews.values()].map((x) => x.accountId).concat([...messages.values()].map((x) => x.senderAccountId)));
  return page(rows.map((r) => {
    const t = r.targetType === 'review' ? reviews.get(r.targetId) : messages.get(r.targetId);
    const authorId = t ? t.accountId || t.senderAccountId : null;
    return presentReport(r, t ? { text: t.text, stars: t.stars, status: t.status, authorAccountId: authorId, authorName: names.get(authorId) || '', bookingId: t.bookingId } : null);
  }), p, total);
}

/** POST /admin/reports/:id/resolve { action: none|hide_content|warn|suspend_account, resolution } (233). */
async function resolveReport(auth, id, body) {
  const c = new Checker();
  const action = c.oneOf(body, 'action', ['none', 'hide_content', 'warn', 'suspend_account'], { required: true });
  const resolution = c.str(body, 'resolution', { required: true, max: 1000 });
  c.done();
  const r = await Report.findById(id).lean();
  if (!r) throw notFound();
  if (r.status !== 'open') throw conflict('invalid_status');
  const target = r.targetType === 'review' ? await Review.findById(r.targetId).lean() : await Message.findById(r.targetId).lean();
  const authorId = target ? target.accountId || target.senderAccountId : null;
  if (target && (action === 'hide_content' || action === 'suspend_account')) {
    if (r.targetType === 'review') await Review.updateOne({ _id: r.targetId }, { $set: { status: 'hidden', updatedAt: new Date() } });
    else await Message.updateOne({ _id: r.targetId }, { $set: { status: 'hidden' } });
    await notify.push(authorId, 'system', 'content_hidden', { params: { note: resolution } });
  }
  if (action === 'warn' && authorId) await notify.push(authorId, 'system', 'account_warning', { params: { note: resolution } });
  if (action === 'suspend_account' && authorId) await require('./admin').setSuspended(auth, authorId, { suspended: true, reason: resolution });
  await Report.updateMany({ targetType: r.targetType, targetId: r.targetId, status: 'open' }, { $set: { status: 'resolved', action, resolution, resolvedBy: auth.accountId, resolvedAt: new Date() } });
  await audit.log(auth, 'report', id, `resolved:${action}`, resolution);
  return presentReport(await Report.findById(id).lean());
}

// ---------- complaints (101, 68, 234) ----------

const presentComplaint = (x) => ({
  id: x._id, orderType: x.orderType, orderId: x.orderId, orderCode: x.orderCode, accountId: x.accountId, category: x.category, text: x.text, status: x.status,
  replies: (x.replies || []).map((r) => ({ byRole: r.byRole, text: r.text, at: r.at })), resolution: x.resolution, resolvedAt: iso(x.resolvedAt), createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt),
});

async function createComplaint(auth, input) {
  const c = new Checker();
  const orderType = c.oneOf(input, 'orderType', ['booking', 'parcel'], { required: true });
  const orderId = c.id(input, 'orderId', { required: true });
  const category = c.str(input, 'category', { max: 40 }) || 'other';
  const text = c.str(input, 'text', { required: true, max: 3000 });
  c.done();
  const order = orderType === 'booking' ? await Booking.findById(orderId).lean() : await Parcel.findById(orderId).lean();
  const owner = order ? (orderType === 'booking' ? order.customerAccountId : order.senderAccountId) : null;
  if (!order || owner !== auth.accountId) throw notFound();
  const now = new Date();
  const doc = { _id: uuid(), orderType, orderId, orderCode: order.code, accountId: auth.accountId, category, text, status: 'open', replies: [], createdAt: now, updatedAt: now };
  await Complaint.create(doc);
  await models.OrderEvent.create({ _id: uuid(), orderType, orderId, byAccountId: auth.accountId, byRole: 'customer', kind: 'complaint', note: category });
  return presentComplaint(doc);
}

async function listComplaints(auth, query) {
  const filter = auth.role === 'admin' ? {} : { accountId: auth.accountId };
  if (query.status) filter.status = { $in: String(query.status).split(',') };
  if (query.orderId) filter.orderId = String(query.orderId);
  const p = paging(query, 30);
  const [rows, total] = await Promise.all([Complaint.find(filter).sort({ createdAt: auth.role === 'admin' ? 1 : -1 }).skip(p.skip).limit(p.limit + 1).lean(), Complaint.countDocuments(filter)]);
  return page(rows.map(presentComplaint), p, total);
}

async function getComplaint(auth, id) {
  const x = await Complaint.findById(id).lean();
  if (!x || (auth.role !== 'admin' && x.accountId !== auth.accountId)) throw notFound();
  const out = presentComplaint(x);
  if (auth.role === 'admin') {
    // Admin sees the order, its receipts and its chat next to the complaint (234).
    if (x.orderType === 'booking') {
      out.booking = await require('./bookings').presentOne(await Booking.findById(x.orderId).lean(), { admin: true });
      out.messages = (await listMessages(auth, x.orderId)).items;
    } else out.parcel = await require('./parcels').presentOne(await Parcel.findById(x.orderId).lean(), { admin: true });
  }
  return out;
}

/** POST /v1/complaints/:id/replies { text } (customer adds info) and admin replies with optional status/resolution. */
async function replyComplaint(auth, id, body) {
  const x = await Complaint.findById(id).lean();
  if (!x || (auth.role !== 'admin' && x.accountId !== auth.accountId)) throw notFound();
  const c = new Checker();
  const text = c.str(body, 'text', { required: auth.role !== 'admin', max: 3000 });
  const status = auth.role === 'admin' ? c.oneOf(body, 'status', ['open', 'in_progress', 'resolved']) : undefined;
  const resolution = auth.role === 'admin' ? c.str(body, 'resolution', { max: 2000 }) : undefined;
  c.done();
  const set = { updatedAt: new Date() };
  if (status) set.status = status;
  if (status === 'resolved') Object.assign(set, { resolvedBy: auth.accountId, resolvedAt: new Date(), resolution: resolution || x.resolution || '' });
  else if (resolution) set.resolution = resolution;
  const upd = { $set: set };
  if (text) upd.$push = { replies: { byRole: auth.role, byAccountId: auth.accountId, text, at: new Date().toISOString() } };
  await Complaint.updateOne({ _id: id }, upd);
  if (auth.role === 'admin') {
    await audit.log(auth, 'complaint', id, status ? `status:${status}` : 'replied', text || resolution || '');
    await notify.push(x.accountId, x.orderType === 'booking' ? 'order' : 'parcel', 'complaint_update', { refType: 'complaint', refId: id, params: { code: x.orderCode, text: text || resolution || status } });
  }
  return presentComplaint(await Complaint.findById(id).lean());
}

// ---------- messages in a booking (80, 235) ----------

async function bookingFor(auth, bookingId) {
  const b = await Booking.findById(bookingId).lean();
  if (!b || (auth.role !== 'admin' && b.customerAccountId !== auth.accountId)) throw notFound();
  return b;
}

const presentMessage = (m, auth) => ({
  id: m._id, bookingId: m.bookingId, senderRole: m.senderRole, isMine: m.senderAccountId === auth.accountId, text: m.status === 'hidden' ? '' : m.text,
  status: m.status, readAt: iso(m.readAt), at: iso(m.at), ...(auth.role === 'admin' ? { senderAccountId: m.senderAccountId, hiddenText: m.status === 'hidden' ? m.text : undefined } : {}),
});

async function listMessages(auth, bookingId) {
  await bookingFor(auth, bookingId);
  const rows = await Message.find({ bookingId }).sort({ at: 1 }).limit(500).lean();
  const otherSide = auth.role === 'admin' ? 'customer' : 'admin';
  await Message.updateMany({ bookingId, senderRole: otherSide, readAt: null }, { $set: { readAt: new Date() } });
  return { items: rows.map((m) => presentMessage(m, auth)) };
}

async function sendMessage(auth, bookingId, body) {
  const b = await bookingFor(auth, bookingId);
  if (b.customerAccountId === null) throw conflict('invalid_status'); // guest booking: nobody to chat with
  const c = new Checker();
  const text = c.str(body, 'text', { required: true, max: 2000 });
  c.done();
  const n = await require('../lib/attempts').bump(`msg|${auth.accountId}`, 60);
  if (n > 20) throw new AppError(429, 'rate_limited', { retryAfter: 60 });
  const doc = { _id: uuid(), bookingId, senderAccountId: auth.accountId, senderRole: auth.role, text, status: 'visible', readAt: null, at: new Date() };
  await Message.create(doc);
  if (auth.role === 'admin') await notify.push(b.customerAccountId, 'order', 'message_new', { refType: 'booking', refId: bookingId, params: { code: b.code } });
  return presentMessage(doc, auth);
}

/** GET /manage/messages — bookings with unread customer messages (235). */
async function adminInbox(query) {
  const match = { senderRole: 'customer' };
  if (query.unread !== 'false') match.readAt = null;
  const rows = await Message.aggregate([{ $match: match }, { $sort: { at: -1 } }, { $group: { _id: '$bookingId', last: { $first: '$$ROOT' }, unread: { $sum: { $cond: [{ $eq: ['$readAt', null] }, 1, 0] } } } }, { $sort: { 'last.at': 1 } }, { $limit: 200 }]);
  const bookings = new Map((await Booking.find({ _id: { $in: rows.map((r) => r._id) } }).select('code customerAccountId departAt status').lean()).map((b) => [b._id, b]));
  const names = await namesOf([...bookings.values()].map((b) => b.customerAccountId));
  return { items: rows.map((r) => ({ bookingId: r._id, bookingCode: bookings.get(r._id)?.code, customerName: names.get(bookings.get(r._id)?.customerAccountId) || '', unread: r.unread, lastText: r.last.text, lastAt: iso(r.last.at) })) };
}

// ---------- contact form (108, 236) ----------

const presentContact = (m) => ({ id: m._id, accountId: m.accountId, subject: m.subject, text: m.text, status: m.status, reply: m.reply, repliedAt: iso(m.repliedAt), createdAt: iso(m.createdAt) });

async function createContact(auth, body) {
  const c = new Checker();
  const subject = c.str(body, 'subject', { max: 150 }) || '';
  const text = c.str(body, 'text', { required: true, max: 3000 });
  c.done();
  const n = await require('../lib/attempts').bump(`contact|${auth.accountId}`, 3600);
  if (n > 10) throw new AppError(429, 'rate_limited', { retryAfter: 3600 });
  const doc = { _id: uuid(), accountId: auth.accountId, subject, text, status: 'open', createdAt: new Date() };
  await ContactMessage.create(doc);
  return presentContact(doc);
}

async function listContacts(auth, query) {
  const filter = auth.role === 'admin' ? {} : { accountId: auth.accountId };
  if (query.status) filter.status = String(query.status);
  const p = paging(query, 30);
  const [rows, total] = await Promise.all([ContactMessage.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit + 1).lean(), ContactMessage.countDocuments(filter)]);
  const names = auth.role === 'admin' ? await namesOf(rows.map((r) => r.accountId)) : new Map();
  return page(rows.map((r) => ({ ...presentContact(r), ...(auth.role === 'admin' ? { customerName: names.get(r.accountId) || '' } : {}) })), p, total);
}

async function replyContact(auth, id, body) {
  const c = new Checker();
  const reply = c.str(body, 'reply', { max: 3000 });
  const status = c.oneOf(body, 'status', ['open', 'replied', 'closed']);
  c.done();
  const set = {};
  if (reply) Object.assign(set, { reply, repliedBy: auth.accountId, repliedAt: new Date(), status: status || 'replied' });
  else if (status) set.status = status;
  const m = await ContactMessage.findOneAndUpdate({ _id: id }, { $set: set }, { new: true }).lean();
  if (!m) throw notFound();
  if (reply) await notify.push(m.accountId, 'system', 'contact_reply', { refType: 'contact', refId: id, params: { text: reply } });
  return presentContact(m);
}

// ---------- waitlist ----------

const presentWait = (w, trip = null) => ({ id: w._id, tripId: w.tripId, accountId: w.accountId, seatCount: w.seatCount, note: w.note, status: w.status, createdAt: iso(w.createdAt), ...(trip ? { trip } : {}) });

async function joinWaitlist(auth, tripId, body) {
  const trip = await Trip.findById(tripId).lean();
  if (!trip || ['cancelled', 'completed'].includes(trip.status) || trip.departAt <= new Date()) throw notFound();
  const c = new Checker();
  const seatCount = c.int(body, 'seatCount', { min: 1, max: 16 }) || 1;
  const note = c.str(body, 'note', { max: 300 }) || '';
  c.done();
  if (await Waitlist.exists({ tripId, accountId: auth.accountId, status: 'waiting' })) throw conflict('waitlist_exists');
  const now = new Date();
  const doc = { _id: uuid(), tripId, accountId: auth.accountId, seatCount, note, status: 'waiting', createdAt: now, updatedAt: now };
  await Waitlist.create(doc);
  const position = await Waitlist.countDocuments({ tripId, status: 'waiting', createdAt: { $lte: now } });
  return { ...presentWait(doc), position };
}

async function myWaitlist(auth) {
  const rows = await Waitlist.find({ accountId: auth.accountId, status: { $in: ['waiting', 'contacted'] } }).sort({ createdAt: -1 }).lean();
  const trips = await require('./trips').presentMany(await Trip.find({ _id: { $in: rows.map((w) => w.tripId) } }).lean());
  const tm = new Map(trips.map((t) => [t.id, t]));
  return { items: rows.map((w) => presentWait(w, tm.get(w.tripId) || null)) };
}

async function cancelWaitlist(auth, id) {
  const r = await Waitlist.updateOne({ _id: id, accountId: auth.accountId, status: { $in: ['waiting', 'contacted'] } }, { $set: { status: 'cancelled', updatedAt: new Date() } });
  if (!r.matchedCount) throw notFound();
}

async function tripWaitlist(tripId) {
  const rows = await Waitlist.find({ tripId, status: { $in: ['waiting', 'contacted'] } }).sort({ createdAt: 1 }).lean();
  const accounts = new Map((await Account.find({ _id: { $in: rows.map((w) => w.accountId) } }).select('displayName phone').lean()).map((a) => [a._id, a]));
  const free = await TripSeat.countDocuments({ tripId, state: 'free', isSellable: true });
  return { freeSeats: free, items: rows.map((w, i) => ({ ...presentWait(w), position: i + 1, customer: accounts.get(w.accountId) ? { displayName: accounts.get(w.accountId).displayName, phone: accounts.get(w.accountId).phone } : null })) };
}

async function updateWaitlist(auth, id, body) {
  const c = new Checker();
  const status = c.oneOf(body, 'status', ['waiting', 'contacted', 'fulfilled', 'cancelled'], { required: true });
  c.done();
  const w = await Waitlist.findOneAndUpdate({ _id: id }, { $set: { status, updatedAt: new Date() } }, { new: true }).lean();
  if (!w) throw notFound();
  if (status === 'contacted') {
    const trip = await Trip.findById(w.tripId).lean();
    await notify.push(w.accountId, 'trip', 'waitlist_available', { refType: 'trip', refId: w.tripId, params: await notify.tripParams(trip) });
  }
  return presentWait(w);
}

/** A seat became free: the first person waiting is told once (the admin also sees the suggestion, 172). */
async function waitlistSeatFreed(tripId) {
  const first = await Waitlist.findOne({ tripId, status: 'waiting', notifiedAt: null }).sort({ createdAt: 1 }).lean();
  if (!first) return;
  const free = await TripSeat.countDocuments({ tripId, state: 'free', isSellable: true });
  if (free < first.seatCount) return;
  await Waitlist.updateOne({ _id: first._id }, { $set: { notifiedAt: new Date() } });
  const trip = await Trip.findById(tripId).lean();
  if (trip) await notify.push(first.accountId, 'trip', 'waitlist_available', { refType: 'trip', refId: tripId, params: await notify.tripParams(trip) });
}

module.exports = {
  maskName, createReview, updateReview, deleteReview, myReviews, publicReviews, adminReviews, replyReview, setReviewStatus,
  createReport, adminReports, resolveReport, createComplaint, listComplaints, getComplaint, replyComplaint,
  listMessages, sendMessage, adminInbox, createContact, listContacts, replyContact,
  joinWaitlist, myWaitlist, cancelWaitlist, tripWaitlist, updateWaitlist, waitlistSeatFreed,
};
