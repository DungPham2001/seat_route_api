/**
 * Transfer receipt photos (47-55, 62, 140-146, 152).
 * - The server checks the file by its content (JPEG / PNG / WEBP magic bytes), the size limit from settings,
 *   strips JPEG metadata (EXIF, GPS, XMP, comments), hashes it (SHA-256) and stores it privately.
 * - Same hash already used on another order -> duplicate warning for the admin (never a verdict).
 * - Admins view the photo through a signed link valid a few minutes (`GET /v1/files/:id?exp&sig`).
 * - Upload is idempotent with Idempotency-Key (a retry after a network drop does not create a second photo).
 */
const crypto = require('crypto');
const config = require('../config');
const models = require('../models');
const { AppError, notFound, conflict, invalid, forbidden } = require('../lib/errors');
const { Checker } = require('../lib/validate');
const { uuid, sha256, iso } = require('../lib/util');
const { withTx } = require('../lib/tx');
const attempts = require('../lib/attempts');
const settings = require('./settings');
const notify = require('./notify');
const T = require('../lib/time');
const { paging, page } = require('../resources/engine');

const { PaymentProof, FileObject, Booking, Parcel, Receipt, TripSeat, PaymentRecord, Trip, OrderEvent, Account } = models;

// ---------- image checks ----------

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** Removes APP1 (EXIF/XMP, GPS), APP13 (IPTC) and COM segments from a JPEG; keeps the image data untouched. */
function stripJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const parts = [buf.slice(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf; // not a marker: leave the file as is
    const marker = buf[i + 1];
    if (marker === 0xda) { // start of scan: the rest is image data
      parts.push(buf.slice(i));
      return Buffer.concat(parts);
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.slice(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return buf;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) parts.push(buf.slice(i, i + 2 + len));
    i += 2 + len;
  }
  return buf;
}

/** Reads the uploaded file: multipart field `file` (multer) or JSON `{ image: base64 }`. */
function readUpload(req) {
  if (req.file?.buffer) return req.file.buffer;
  const b64 = typeof req.body?.image === 'string' ? req.body.image.replace(/^data:[^;]+;base64,/, '') : null;
  if (b64) return Buffer.from(b64, 'base64');
  throw invalid([{ field: 'file', code: 'required' }]);
}

// ---------- signed links ----------

const sign = (id, exp) => crypto.createHmac('sha256', `${config.jwt.secret}|files`).update(`${id}.${exp}`).digest('base64url');

function signedUrl(fileId) {
  const exp = Math.floor(Date.now() / 1000) + config.fileLinkSec;
  return { url: `${config.publicBaseUrl}/v1/files/${fileId}?exp=${exp}&sig=${sign(fileId, exp)}`, expiresAt: iso(new Date(exp * 1000)) };
}

/** GET /v1/files/:id?exp&sig — no bearer token (an image view cannot send one), the signature is the access. */
async function serveFile(id, query) {
  const exp = parseInt(query.exp, 10);
  if (!exp || exp < Date.now() / 1000 || typeof query.sig !== 'string') throw forbidden('forbidden');
  const expected = sign(id, exp);
  if (query.sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(query.sig), Buffer.from(expected))) throw forbidden('forbidden');
  const f = await FileObject.findById(id).lean();
  if (!f || f.deletedAt || !f.data) throw notFound();
  // .lean() returns a BSON Binary, not a Buffer.
  const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data.buffer);
  return { ...f, data };
}

// ---------- presenters ----------

async function presentProofs(rows, { admin = false } = {}) {
  const dupes = admin ? await duplicatesOf(rows) : new Map();
  return rows.map((p) => ({
    id: p._id, orderType: p.orderType, orderId: p.orderId, orderCode: p.orderCode, status: p.status, amount: p.amount, note: p.note || '',
    mime: p.mime, sizeBytes: p.sizeBytes, uploadedAt: iso(p.uploadedAt), reviewedAt: iso(p.reviewedAt), rejectReason: p.rejectReason,
    ...(admin ? { accountId: p.accountId, reviewedBy: p.reviewedBy, tripId: p.tripId, departAt: iso(p.departAt), waitingMinutes: p.status === 'pending' ? Math.round((Date.now() - p.uploadedAt) / 60000) : null, duplicateOf: dupes.get(p._id) || [] } : {}),
  }));
}

/** Other orders that used a photo with the same hash (146). */
async function duplicatesOf(rows) {
  const hashes = [...new Set(rows.map((p) => p.contentHash))];
  const all = await PaymentProof.find({ contentHash: { $in: hashes } }).select('contentHash orderType orderId orderCode accountId uploadedAt').lean();
  const map = new Map();
  for (const p of rows) {
    map.set(p._id, all.filter((x) => x.contentHash === p.contentHash && x.orderId !== p.orderId).map((x) => ({ proofId: x._id, orderType: x.orderType, orderId: x.orderId, orderCode: x.orderCode, uploadedAt: iso(x.uploadedAt), sameCustomer: x.accountId === p.accountId })));
  }
  return map;
}

// ---------- upload ----------

async function loadOrder(orderType, id) {
  const Model = orderType === 'booking' ? Booking : Parcel;
  const o = await Model.findById(id).lean();
  if (!o) throw notFound();
  return o;
}

const ownerOf = (orderType, o) => (orderType === 'booking' ? o.customerAccountId : o.senderAccountId);

/**
 * POST /v1/bookings/:id/proofs and /v1/parcels/:id/proofs (multipart `file`, optional `note`).
 * Returns { proof, order, lostSeats } — `lostSeats` not empty = the seat was taken by an earlier receipt (55).
 */
async function upload(auth, orderType, id, req) {
  const order = await loadOrder(orderType, id);
  if (ownerOf(orderType, order) !== auth.accountId) throw notFound();
  const idem = req.get('idempotency-key');
  const key = idem ? `proof|${id}|${sha256(idem.slice(0, 100))}` : null;
  if (key) {
    const r = await Receipt.findById(key).lean();
    if (r) return replay(auth, orderType, id, r.result);
  }
  if (orderType === 'booking') {
    if (!['awaiting_payment', 'rejected', 'expired', 'info_requested', 'pending_review', 'seat_lost'].includes(order.status)) throw conflict('invalid_status');
    const trip = await Trip.findById(order.tripId).lean();
    if (new Date() >= trip.departAt || ['cancelled', 'completed'].includes(trip.status)) throw conflict('invalid_status');
  } else if (!(order.status === 'accepted' || order.status === 'received') || order.payStatus === 'paid') throw conflict('invalid_status');

  const n = await attempts.bump(`upload|${auth.accountId}`, 3600);
  if (n > config.uploadsPerHour) throw new AppError(429, 'upload_limit', { retryAfter: 3600 });

  const sys = await settings.get('system');
  let buf = readUpload(req);
  if (buf.length > sys.maxProofBytes) throw new AppError(413, 'proof_too_large', { maxBytes: sys.maxProofBytes });
  const mime = sniff(buf);
  if (!mime || buf.length < 1024) throw new AppError(400, 'proof_invalid_file', { fields: [{ field: 'file', code: 'proof_invalid_file' }] });
  if (mime === 'image/jpeg') buf = stripJpeg(buf);
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const now = new Date();
  const fileId = uuid();
  const proof = {
    _id: uuid(), orderType, orderId: id, orderCode: order.code, accountId: auth.accountId, fileId, contentHash: hash, mime, sizeBytes: buf.length,
    amount: orderType === 'booking' ? order.totalAmount : order.fee, note, status: 'pending', uploadedAt: now,
    tripId: order.tripId || null, departAt: order.departAt || null,
  };
  await withTx(async (session) => {
    await FileObject.create([{ _id: fileId, ownerAccountId: auth.accountId, kind: 'proof', mime, sizeBytes: buf.length, sha256: hash, data: buf, deleteAfter: null, createdAt: now }], { session });
    await PaymentProof.create([proof], { session });
    if (key) await Receipt.create([{ _id: key, result: { proofId: proof._id }, expireAt: new Date(Date.now() + 7 * 86400000) }], { session });
  });
  let lostSeats = [];
  if (orderType === 'booking') ({ lostSeats } = await require('./bookings').onProofStored(order, auth));
  else await require('./parcels').onProofStored(order, auth);
  return replay(auth, orderType, id, { proofId: proof._id, lostSeats });
}

async function replay(auth, orderType, id, result) {
  const proof = await PaymentProof.findById(result.proofId).lean();
  const [p] = await presentProofs([proof]);
  const order = orderType === 'booking'
    ? await require('./bookings').presentOne(await Booking.findById(id).lean())
    : await require('./parcels').presentOne(await Parcel.findById(id).lean());
  const lostSeats = orderType === 'booking' ? order.lostSeats : [];
  return { proof: p, [orderType]: order, lostSeats, seatLost: lostSeats.length > 0 };
}

// ---------- read ----------

/** GET /v1/proofs/:id → metadata + signed image URL (owner or admin). */
async function get(auth, id) {
  const p = await PaymentProof.findById(id).lean();
  if (!p) throw notFound();
  if (auth.role !== 'admin' && p.accountId !== auth.accountId) throw notFound();
  const f = await FileObject.findById(p.fileId).select('deletedAt').lean();
  const [out] = await presentProofs([p], { admin: auth.role === 'admin' });
  return { ...out, image: f && !f.deletedAt ? signedUrl(p.fileId) : null, imageDeleted: !f || !!f.deletedAt };
}

/** GET /manage/proofs?status=pending&orderType&tripId — queue ordered by upload time, oldest first (140, 152). */
async function queue(query) {
  const filter = { status: query.status || 'pending' };
  if (query.orderType) filter.orderType = String(query.orderType);
  if (query.tripId) filter.tripId = String(query.tripId);
  if (T.isDate(query.date)) {
    const [s, e] = T.dayRange(query.date);
    filter.departAt = { $gte: s, $lt: e };
  }
  const p = paging(query, 30);
  const [rows, total] = await Promise.all([
    PaymentProof.find(filter).sort({ uploadedAt: filter.status === 'pending' ? 1 : -1 }).skip(p.skip).limit(p.limit + 1).lean(),
    PaymentProof.countDocuments(filter),
  ]);
  const items = await presentProofs(rows.slice(0, p.limit), { admin: true });
  const sys = await settings.get('system');
  // Order summary next to each photo: amount, code, seats, trip time (142).
  const bookings = new Map((await Booking.find({ _id: { $in: rows.filter((r) => r.orderType === 'booking').map((r) => r.orderId) } }).lean()).map((b) => [b._id, b]));
  const parcels = new Map((await Parcel.find({ _id: { $in: rows.filter((r) => r.orderType === 'parcel').map((r) => r.orderId) } }).lean()).map((x) => [x._id, x]));
  const accounts = new Map((await Account.find({ _id: { $in: rows.map((r) => r.accountId).filter(Boolean) } }).select('displayName phone').lean()).map((a) => [a._id, a]));
  for (const it of items) {
    const o = it.orderType === 'booking' ? bookings.get(it.orderId) : parcels.get(it.orderId);
    it.deadlineAt = iso(T.addMinutes(new Date(it.uploadedAt), sys.reviewDeadlineMinutes));
    it.overdue = it.status === 'pending' && new Date() > new Date(it.deadlineAt);
    it.customer = accounts.get(it.accountId) ? { displayName: accounts.get(it.accountId).displayName, phone: accounts.get(it.accountId).phone } : null;
    it.order = o ? (it.orderType === 'booking'
      ? { code: o.code, status: o.status, totalAmount: o.totalAmount, seats: o.seats.map((s) => ({ label: s.label, claimState: s.claimState })), departAt: iso(o.departAt) }
      : { code: o.code, status: o.status, payStatus: o.payStatus, fee: o.fee, departAt: iso(o.departAt) }) : null;
    it.image = signedUrl(rows.find((r) => r._id === it.id).fileId);
  }
  return page(rows.length > p.limit ? [...items, null] : items, p, total);
}

// ---------- review ----------

async function loadPending(id) {
  const p = await PaymentProof.findById(id).lean();
  if (!p) throw notFound();
  if (p.status !== 'pending') throw conflict('invalid_status');
  return p;
}

/** POST /v1/proofs/:id/approve (143). Booking: held seats -> sold, booking confirmed. Parcel: fee paid. */
async function approve(auth, id, body = {}) {
  const p = await loadPending(id);
  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : '';
  const now = new Date();
  if (p.orderType === 'booking') {
    const b = await Booking.findById(p.orderId).lean();
    if (!['pending_review', 'info_requested'].includes(b.status)) throw conflict('invalid_status', { bookingStatus: b.status });
    const trip = await Trip.findById(b.tripId).lean();
    await withTx(async (session) => {
      await TripSeat.updateMany({ bookingId: b._id, state: 'claimed' }, { $set: { state: 'sold' } }, { session });
      await Booking.updateOne({ _id: b._id }, { $set: { status: 'confirmed', confirmedAt: now, paidAmount: b.totalAmount, updatedAt: now } }, { session });
      await PaymentProof.updateMany({ orderType: 'booking', orderId: b._id, status: 'pending' }, { $set: { status: 'approved', reviewedBy: auth.accountId, reviewedAt: now } }, { session });
      await PaymentRecord.create([{ _id: uuid(), orderType: 'booking', orderId: b._id, source: b.source, method: 'proof', amount: b.totalAmount, note, tripId: b.tripId, routeId: b.routeId, vehicleId: trip?.vehicleId, departAt: b.departAt, recordedBy: auth.accountId, recordedAt: now }], { session });
    });
    await require('./bookings').event(b, auth, 'confirmed', { oldValue: b.status, newValue: 'confirmed', note });
    await notify.push(b.customerAccountId, 'order', 'booking_confirmed', { refType: 'booking', refId: b._id, params: { code: b.code } });
  } else {
    await require('./parcels').approvePayment(auth, p, note);
  }
  return get(auth, id);
}

/** POST /manage/proofs/approve { ids: [...] } — after ticking each one (144). Returns per-id result. */
async function approveMany(auth, body) {
  const c = new Checker();
  const ids = c.arr(body, 'ids', { required: true, max: 50 }) || [];
  c.done();
  const results = [];
  for (const id of ids.map(String)) {
    try {
      await approve(auth, id, {});
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, code: err.code || 'error' });
    }
  }
  return { results, approved: results.filter((r) => r.ok).length };
}

/** POST /v1/proofs/:id/reject { reason } (143): seats released for the next receipt; the customer may upload again. */
async function reject(auth, id, body) {
  const c = new Checker();
  const reason = c.str(body, 'reason', { required: true, max: 500 });
  c.done();
  const p = await loadPending(id);
  const now = new Date();
  await PaymentProof.updateOne({ _id: id }, { $set: { status: 'rejected', reviewedBy: auth.accountId, reviewedAt: now, rejectReason: reason } });
  const stillPending = await PaymentProof.countDocuments({ orderType: p.orderType, orderId: p.orderId, status: 'pending' });
  if (p.orderType === 'booking') {
    const b = await Booking.findById(p.orderId).lean();
    if (!stillPending && ['pending_review', 'info_requested', 'seat_lost'].includes(b.status)) {
      await require('./bookings').releaseSeats(b);
      const seats = b.seats.map((s) => ({ ...s, claimState: 'selecting' }));
      await Booking.updateOne({ _id: b._id }, { $set: { status: 'rejected', seats, updatedAt: now } });
    }
    await require('./bookings').event(b, auth, 'proof_rejected', { oldValue: b.status, newValue: stillPending ? b.status : 'rejected', note: reason });
    await notify.push(b.customerAccountId, 'order', 'proof_rejected', { refType: 'booking', refId: b._id, params: { code: b.code, reason } });
  } else {
    await require('./parcels').rejectPayment(auth, p, reason, stillPending);
  }
  return get(auth, id);
}

/** POST /v1/proofs/:id/request-info { note } (145): blurry photo, missing info. Seats stay held. */
async function requestInfo(auth, id, body) {
  const c = new Checker();
  const note = c.str(body, 'note', { required: true, max: 500 });
  c.done();
  const p = await loadPending(id);
  if (p.orderType === 'booking') {
    const b = await Booking.findById(p.orderId).lean();
    if (b.status === 'pending_review') await Booking.updateOne({ _id: b._id }, { $set: { status: 'info_requested', updatedAt: new Date() } });
    await require('./bookings').event(b, auth, 'info_requested', { note });
    await notify.push(b.customerAccountId, 'order', 'proof_info_requested', { refType: 'booking', refId: b._id, params: { code: b.code, note } });
  } else {
    const x = await Parcel.findById(p.orderId).lean();
    await OrderEvent.create({ _id: uuid(), orderType: 'parcel', orderId: x._id, byAccountId: auth.accountId, byRole: 'admin', kind: 'info_requested', note });
    await notify.push(x.senderAccountId, 'parcel', 'proof_info_requested', { refType: 'parcel', refId: x._id, params: { code: x.code, note } });
  }
  return get(auth, id);
}

/** Daily job: photos past their retention date are deleted for real (bytes removed, metadata kept). */
async function purgeExpiredFiles() {
  const r = await FileObject.updateMany({ deleteAfter: { $ne: null, $lte: new Date() }, deletedAt: null }, { $set: { data: null, deletedAt: new Date() } });
  return r.modifiedCount || 0;
}

module.exports = { upload, get, queue, approve, approveMany, reject, requestInfo, serveFile, signedUrl, purgeExpiredFiles, sniff, stripJpeg, presentProofs };
