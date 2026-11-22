/**
 * Admin tools: customers (225, 226), global search (257), CSV import (258), start-up checklist (116),
 * trip operations: logs (177, 178), notice to a whole trip (179), text for the driver (180), checklist (184).
 */
const models = require('../models');
const { Checker } = require('../lib/validate');
const { notFound, invalid, conflict } = require('../lib/errors');
const password = require('../lib/password');
const { uuid, iso, noAccent, normalizePhone } = require('../lib/util');
const T = require('../lib/time');
const tenant = require('../lib/tenant');
const tokens = require('./tokens');
const notify = require('./notify');
const audit = require('./audit');
const settings = require('./settings');
const { paging, page } = require('../resources/engine');

const { Account, Booking, Parcel, Trip, TripLog, Office, Route, Province, GuestContact, StaffMember, Vehicle, SeatLayout, Setting } = models;

// ---------- customers ----------

/** Customers of this operator: the ones it created, plus everyone who booked or sent a parcel with it. */
async function customerScope() {
  const op = tenant.current();
  if (!op) return { role: 'customer' };
  const [a, b, c] = await Promise.all([Booking.distinct('customerAccountId'), Parcel.distinct('senderAccountId'), models.ContactMessage.distinct('accountId')]);
  const ids = [...new Set([...a, ...b, ...c].filter(Boolean))];
  return { role: 'customer', $or: [{ operatorId: op }, { _id: { $in: ids } }] };
}

async function customerStats(ids) {
  const rows = await Booking.aggregate([
    { $match: { customerAccountId: { $in: ids } } },
    { $group: {
      _id: '$customerAccountId', bookings: { $sum: 1 },
      completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
      spent: { $sum: { $subtract: [{ $ifNull: ['$paidAmount', 0] }, { $ifNull: ['$refundedAmount', 0] }] } },
      first: { $min: '$createdAt' }, last: { $max: '$createdAt' },
    } },
  ]);
  return new Map(rows.map((r) => [r._id, r]));
}

const presentCustomer = (a, s) => ({
  id: a._id, email: a.email, displayName: a.displayName, phone: a.phone, status: a.status, suspendReason: a.suspendReason, adminNote: a.adminNote || '',
  locked: a.status === 'suspended', lockReason: a.suspendReason || null,
  bookings: s?.bookings || 0, completedTrips: s?.completed || 0, totalSpent: s?.spent || 0, kind: (s?.bookings || 0) > 1 ? 'returning' : 'new',
  firstBookingAt: iso(s?.first), lastBookingAt: iso(s?.last), lastLoginAt: iso(a.lastLoginAt), createdAt: iso(a.createdAt),
});

/** GET /admin/customers?q&status&kind=new|returning */
async function listCustomers(query) {
  const filter = await customerScope();
  if (query.status) filter.status = String(query.status);
  if (query.q) filter.search = { $regex: noAccent(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
  const p = paging(query, 30);
  const [rows, total] = await Promise.all([Account.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit + 1).lean(), Account.countDocuments(filter)]);
  const stats = await customerStats(rows.map((a) => a._id));
  let items = rows.map((a) => presentCustomer(a, stats.get(a._id)));
  if (query.kind) items = items.filter((x) => x.kind === query.kind);
  return page(items, p, total);
}

async function getCustomer(id) {
  const a = await Account.findOne({ _id: id, ...(await customerScope()) }).lean();
  if (!a) throw notFound();
  const stats = await customerStats([id]);
  const recent = await Booking.find({ customerAccountId: id }).sort({ createdAt: -1 }).limit(20).lean();
  const parcels = await Parcel.find({ senderAccountId: id }).sort({ createdAt: -1 }).limit(10).lean();
  const history = await models.AdminAction.find({ targetType: 'account', targetId: id }).sort({ at: -1 }).limit(20).lean();
  return {
    ...presentCustomer(a, stats.get(id)),
    loyalty: await require('./loyalty').summary(id),
    recentBookings: await require('./bookings').presentMany(recent, { admin: true }),
    recentParcels: (await require('./parcels').presentMany(parcels, { admin: true })).map((x) => ({ id: x.id, code: x.code, status: x.status, fee: x.fee, createdAt: x.createdAt })),
    adminHistory: history.map((h) => ({ action: h.action, note: h.note, at: iso(h.at), adminAccountId: h.adminAccountId })),
  };
}

/** POST /manage/customers — the admin creates a customer (same rules as sign-up) with an initial password. */
async function createCustomer(auth, body) {
  const accounts = require('./accounts');
  const c = new Checker();
  const displayName = c.str(body, 'displayName', { required: true, max: 60 });
  const rawPhone = c.phone(body, 'phone', { required: true });
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) c.fail('phone', 'invalid_format');
  const email = c.email(body, 'email') || null;
  const plain = c.password(body, 'password');
  c.done();
  if (email && (await Account.exists({ email }))) throw conflict('email_taken');
  await accounts.assertPhoneFree(phone);
  const now = new Date();
  const doc = {
    _id: uuid(), email, passwordHash: await password.hash(plain), displayName, phone, role: 'customer', operatorId: tenant.current(), preferredLanguage: 'vi', status: 'active',
    avatarColor: accounts.COLORS[Math.floor(Math.random() * accounts.COLORS.length)], referralCode: await accounts.newReferralCode(), termsAcceptedAt: now, passwordChangedAt: now, createdAt: now, updatedAt: now,
  };
  doc.search = accounts.searchOf(doc);
  try { await Account.create(doc); } catch (err) { if (err.code === 11000) throw accounts.dupError(err); throw err; }
  await require('./loyalty').welcomeVoucher(doc._id).catch(() => {});
  await audit.log(auth, 'account', doc._id, 'customer_created', phone);
  return getCustomer(doc._id);
}

/** PATCH /manage/customers/:id — name, phone, email, note; `password` resets it (empty = keep). Signs the customer out on a reset. */
async function updateCustomer(auth, id, body) {
  const accounts = require('./accounts');
  const a = await Account.findOne({ _id: id, ...(await customerScope()) }).lean();
  if (!a) throw notFound();
  const c = new Checker();
  const set = {};
  if (body?.displayName !== undefined) set.displayName = c.str(body, 'displayName', { required: true, max: 60 });
  if (body?.phone !== undefined) {
    const raw = c.phone(body, 'phone', { required: true });
    set.phone = raw ? normalizePhone(raw) : null;
    if (raw && !set.phone) c.fail('phone', 'invalid_format');
  }
  if (body?.email !== undefined) set.email = c.email(body, 'email') || null;
  if (body?.adminNote !== undefined) set.adminNote = c.str(body, 'adminNote', { max: 2000 }) || '';
  const plain = typeof body?.password === 'string' && body.password !== '' ? c.password(body, 'password') : null;
  c.done();
  if (set.email && set.email !== a.email && (await Account.exists({ email: set.email, _id: { $ne: id } }))) throw conflict('email_taken');
  if (set.phone && set.phone !== a.phone) await accounts.assertPhoneFree(set.phone, id);
  if (plain) Object.assign(set, { passwordHash: await password.hash(plain), passwordChangedAt: new Date() });
  set.search = accounts.searchOf({ ...a, ...set });
  set.updatedAt = new Date();
  try { await Account.updateOne({ _id: id }, { $set: set }); } catch (err) { if (err.code === 11000) throw accounts.dupError(err); throw err; }
  if (plain) await tokens.revoke({ accountId: id }, 'password_reset_by_admin');
  await audit.log(auth, 'account', id, plain ? 'customer_password_reset' : 'customer_updated', '');
  return getCustomer(id);
}

/** POST /manage/customers/:id/reset-password { password? } — a temporary password when none is given (shown once). */
async function resetCustomerPassword(auth, id, body) {
  const accounts = require('./accounts');
  const a = await Account.findOne({ _id: id, ...(await customerScope()) }).lean();
  if (!a) throw notFound();
  const c = new Checker();
  const given = typeof body?.password === 'string' && body.password !== '' ? c.password(body, 'password') : null;
  c.done();
  const plain = given || accounts.tempPassword();
  await Account.updateOne({ _id: id }, { $set: { passwordHash: await password.hash(plain), passwordChangedAt: new Date(), updatedAt: new Date() } });
  await tokens.revoke({ accountId: id }, 'password_reset_by_admin');
  await models.ContactMessage.updateMany({ accountId: id, subject: 'password_reset', status: 'open' }, { $set: { status: 'closed', repliedBy: auth.accountId, repliedAt: new Date() } });
  await audit.log(auth, 'account', id, 'customer_password_reset', '');
  return given ? { status: 'ok' } : { temporaryPassword: plain };
}

/** DELETE /manage/customers/:id — only when the customer has no booking or parcel at all (otherwise lock the account). */
async function deleteCustomer(auth, id) {
  const a = await Account.findOne({ _id: id, ...(await customerScope()) }).lean();
  if (!a) throw notFound();
  const [bookings, parcels] = await Promise.all([Booking.countDocuments({ customerAccountId: id }), Parcel.countDocuments({ senderAccountId: id })]);
  if (bookings || parcels) throw conflict('in_use', { bookings, parcels, hint: 'lock_instead' });
  await require('./privacy').purgeCustomer(a, { force: true });
  await audit.log(auth, 'account', id, 'customer_deleted', a.phone || a.email || '');
}

/** Suspend / unsuspend a customer (226) with a reason; sessions are revoked at once. */
async function setSuspended(auth, id, { suspended, reason }) {
  const a = await Account.findOne({ _id: id, ...(await customerScope()) }).lean();
  if (!a) throw notFound();
  await Account.updateOne({ _id: id }, { $set: { status: suspended ? 'suspended' : 'active', suspendReason: suspended ? reason : null, updatedAt: new Date() } });
  if (suspended) await tokens.revoke({ accountId: id }, 'suspended');
  await audit.log(auth, 'account', id, suspended ? 'suspended' : 'unsuspended', reason || '');
}

async function suspend(auth, id, body, suspended) {
  const c = new Checker();
  const reason = c.str(body, 'reason', { required: suspended, max: 500 }) || '';
  c.done();
  await setSuspended(auth, id, { suspended, reason });
  return getCustomer(id);
}

// ---------- search (257) ----------

async function search(query) {
  const q = noAccent(query.q || '');
  if (q.length < 2) return { bookings: [], customers: [], trips: [], parcels: [], guests: [] };
  const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
  const [bookings, customers, parcels, guests, routes] = await Promise.all([
    Booking.find({ search: rx }).sort({ createdAt: -1 }).limit(10).lean(),
    (async () => Account.find({ ...(await customerScope()), search: rx }).limit(10).lean())(),
    Parcel.find({ search: rx }).sort({ createdAt: -1 }).limit(10).lean(),
    GuestContact.find({ search: rx }).limit(10).lean(),
    Route.find({ search: rx }).select('_id').lean(),
  ]);
  const trips = routes.length ? await Trip.find({ routeId: { $in: routes.map((r) => r._id) }, departAt: { $gte: T.addMinutes(new Date(), -1440) } }).sort({ departAt: 1 }).limit(10).lean() : [];
  return {
    bookings: (await require('./bookings').presentMany(bookings, { admin: true })).map((b) => ({ id: b.id, code: b.code, status: b.status, trip: b.trip, passengers: b.seats.map((s) => s.passengerName), customer: b.customer?.displayName || b.guest?.name || '' })),
    customers: customers.map((a) => ({ id: a._id, displayName: a.displayName, email: a.email, phone: a.phone, status: a.status })),
    trips: (await require('./trips').presentMany(trips, { admin: true })).map((t) => ({ id: t.id, route: t.route?.name, departAt: t.departAt, status: t.status, seats: t.seats })),
    parcels: parcels.map((x) => ({ id: x._id, code: x.code, status: x.status, receiverName: x.receiverName, senderName: x.senderName })),
    guests: guests.map((g) => ({ id: g._id, name: g.name, phone: g.phone, linkedAccountId: g.linkedAccountId })),
  };
}

// ---------- CSV import (258) ----------

/** Minimal RFC 4180 parser; accepts `,` or `;` (Excel VN often uses `;`). */
function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const firstLine = s.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x.trim()));
  if (!clean.length) return { header: [], records: [] };
  const header = clean[0].map((h) => h.trim());
  return { header, records: clean.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

const IMPORT = {
  routes: {
    columns: ['name', 'fromProvince', 'toProvince', 'durationMinutes', 'basePrice'],
    async map(r, ctx) {
      return { name: r.name || undefined, fromProvinceId: ctx.province(r.fromProvince), toProvinceId: ctx.province(r.toProvince), durationMinutes: Number(r.durationMinutes) || undefined, basePrice: r.basePrice ? Number(r.basePrice) : 0, offices: [], stops: [] };
    },
  },
  vehicles: {
    columns: ['plateNo', 'kindLabel', 'layout', 'year', 'colorText', 'note'],
    async map(r, ctx) {
      return { plateNo: r.plateNo, kindLabel: r.kindLabel, layoutId: ctx.layout(r.layout), year: r.year ? Number(r.year) : undefined, colorText: r.colorText || undefined, note: r.note || undefined };
    },
  },
  staff: {
    columns: ['kind', 'name', 'phone', 'positionText', 'office', 'joinedOn', 'licenseClassText', 'licenseExpiresOn', 'payPerTrip'],
    async map(r, ctx) {
      return {
        kind: r.kind, name: r.name, phone: r.phone || undefined, positionText: r.positionText || undefined, officeId: r.office ? ctx.office(r.office) : undefined,
        joinedOn: r.joinedOn || undefined, licenseClassText: r.licenseClassText || undefined, licenseExpiresOn: r.licenseExpiresOn || undefined, payPerTrip: r.payPerTrip ? Number(r.payPerTrip) : undefined,
      };
    },
  },
};

/** POST /admin/import/:type { csv, dryRun = true } — preview with per-line errors; commit only when every line is valid. */
async function importCsv(auth, type, body) {
  const spec = IMPORT[type];
  if (!spec) throw notFound();
  const c = new Checker();
  const csv = c.str(body, 'csv', { required: true, max: 2_000_000, trim: false });
  const dryRun = c.bool(body, 'dryRun', { def: true });
  c.done();
  const { header, records } = parseCsv(csv);
  const missing = spec.columns.filter((k) => ['fromProvince', 'toProvince', 'durationMinutes', 'plateNo', 'kindLabel', 'layout', 'kind', 'name'].includes(k) && !header.includes(k));
  if (missing.length) throw invalid(missing.map((k) => ({ field: `csv.${k}`, code: 'required' })));
  if (records.length > 500) throw invalid([{ field: 'csv', code: 'too_long' }]);
  const [provinces, layouts, offices] = await Promise.all([Province.find({}).lean(), SeatLayout.find({}).lean(), Office.find({}).lean()]);
  const find = (list, v, key = 'name') => list.find((x) => x._id === v || noAccent(x[key]) === noAccent(v))?._id || `missing:${v}`;
  const ctx = { province: (v) => find(provinces, v), layout: (v) => find(layouts, v), office: (v) => find(offices, v) };
  const res = require('../resources/defs').resources[type === 'staff' ? 'staff' : type];
  const results = [];
  for (let i = 0; i < records.length; i += 1) {
    const data = await spec.map(records[i], ctx);
    const out = { line: i + 2, data: records[i], errors: [] };
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string' && v.startsWith('missing:')) out.errors.push({ field: k, code: 'not_found' });
    if (!out.errors.length) {
      try {
        await res.insert(data, auth, { dryRun: true });
      } catch (err) {
        out.errors = err.extra?.fields || [{ field: 'row', code: err.code || 'invalid' }];
      }
    }
    results.push(out);
  }
  const invalidRows = results.filter((r) => r.errors.length).length;
  let created = 0;
  if (!dryRun && !invalidRows) {
    for (const r of records) {
      await res.insert(await spec.map(r, ctx), auth);
      created += 1;
    }
  }
  return { type, columns: spec.columns, dryRun, total: records.length, valid: records.length - invalidRows, invalid: invalidRows, created, rows: results };
}

// ---------- start-up checklist (116) ----------

async function onboarding(auth) {
  const all = await settings.all();
  const [offices, vehicles, drivers, routes, trips] = await Promise.all([
    Office.countDocuments({}), Vehicle.countDocuments({}), StaffMember.countDocuments({ kind: 'limo_driver' }), Route.countDocuments({}), Trip.countDocuments({}),
  ]);
  const marks = new Set(auth.account.onboardingMarks || []);
  const steps = [
    { key: 'operator_profile', done: !!all.operator.name && !!all.operator.phone },
    { key: 'offices', done: offices > 0 },
    { key: 'vehicles', done: vehicles > 0 },
    { key: 'drivers', done: drivers > 0 },
    { key: 'routes', done: routes > 0 },
    { key: 'first_trip', done: trips > 0 },
    { key: 'cancel_policy', done: marks.has('cancel_policy') || !!(await Setting.exists({ _id: tenant.current() ? `${tenant.current()}:cancelPolicy` : 'cancelPolicy' })) },
  ].map((s) => ({ ...s, done: s.done || marks.has(s.key) }));
  return { steps, completed: steps.filter((s) => s.done).length, total: steps.length };
}

async function markOnboarding(auth, key, done) {
  await Account.updateOne({ _id: auth.accountId }, done ? { $addToSet: { onboardingMarks: key } } : { $pull: { onboardingMarks: key } });
  return onboarding({ ...auth, account: await Account.findById(auth.accountId).lean() });
}

// ---------- trip operations ----------

/**
 * POST /manage/trips/:id/logs { kind: depart|arrive|delay|incident|note, atTime?, text?, delayMinutes?, visibleToCustomer? }
 * depart -> trip running + actual departure; arrive -> actual arrival (trip completed with `complete: true`);
 * delay / incident -> shown in the booking and sent to every passenger (78, 177, 178).
 */
async function addLog(auth, tripId, body) {
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw notFound();
  const c = new Checker();
  const kind = c.oneOf(body, 'kind', ['depart', 'arrive', 'delay', 'incident', 'note'], { required: true });
  const atTime = c.datetime(body, 'atTime') || new Date();
  const text = c.str(body, 'text', { required: ['delay', 'incident'].includes(kind), max: 1000 }) || '';
  const delayMinutes = c.int(body, 'delayMinutes', { max: 1440 });
  const visible = c.bool(body, 'visibleToCustomer', { def: kind !== 'note' });
  const complete = c.bool(body, 'complete', { def: true });
  c.done();
  const doc = { _id: uuid(), tripId, kind, atTime, text, delayMinutes: delayMinutes ?? null, visibleToCustomer: visible, byAccountId: auth.accountId, createdAt: new Date() };
  await TripLog.create(doc);
  const trips = require('./trips');
  if (kind === 'depart') {
    await Trip.updateOne({ _id: tripId }, { $set: { actualDepartAt: atTime, updatedAt: new Date() } });
    if (trip.status === 'scheduled') await trips.setStatus(auth, tripId, { status: 'running' });
    await Trip.updateOne({ _id: tripId }, { $set: { actualDepartAt: atTime } });
  }
  if (kind === 'arrive') {
    await Trip.updateOne({ _id: tripId }, { $set: { actualArriveAt: atTime, updatedAt: new Date() } });
    if (complete && ['scheduled', 'running'].includes(trip.status)) await trips.setStatus(auth, tripId, { status: 'completed' });
    await Trip.updateOne({ _id: tripId }, { $set: { actualArriveAt: atTime } });
  }
  if ((kind === 'delay' || kind === 'incident') && visible) await notify.forTrip(tripId, kind === 'delay' ? 'trip_delay' : 'trip_incident', { text });
  return trips.presentLog(doc);
}

async function listLogs(tripId) {
  const rows = await TripLog.find({ tripId }).sort({ atTime: -1 }).lean();
  return { items: rows.map(require('./trips').presentLog) };
}

/** POST /manage/trips/:id/notify { text } (179): free text to every passenger of the trip. */
async function broadcast(auth, tripId, body) {
  const c = new Checker();
  const text = c.str(body, 'text', { required: true, max: 1000 });
  c.done();
  if (!(await Trip.exists({ _id: tripId }))) throw notFound();
  const sent = await notify.forTrip(tripId, 'trip_notice', { text });
  await TripLog.create({ _id: uuid(), tripId, kind: 'notice', atTime: new Date(), text, visibleToCustomer: true, byAccountId: auth.accountId, createdAt: new Date() });
  return { sent };
}

/** GET /manage/trips/:id/driver-text?lang (180): passengers, shuttle and parcels as plain text for Zalo. */
async function driverText(tripId, lang = 'vi') {
  const bookings = require('./bookings');
  const [trip, manifest, shuttle, parcels] = await Promise.all([
    Trip.findById(tripId).lean(), bookings.manifest(tripId), bookings.shuttleList(tripId), require('./parcels').tripParcels(tripId),
  ]);
  const route = await Route.findById(trip.routeId).lean();
  const vehicle = trip.vehicleId ? await Vehicle.findById(trip.vehicleId).lean() : null;
  const driver = trip.driverId ? await StaffMember.findById(trip.driverId).lean() : null;
  const en = lang === 'en';
  const l = T.toLocal(trip.departAt);
  const lines = [
    `${route?.name || ''} - ${l.time} ${l.date}`,
    `${en ? 'Vehicle' : 'Xe'}: ${vehicle?.plateNo || '-'}  ${en ? 'Driver' : 'Tài xế'}: ${driver?.name || '-'}`,
    '',
    `${en ? 'PASSENGERS' : 'HÀNH KHÁCH'} (${manifest.total})`,
    ...manifest.items.map((p) => `${p.seatLabel}. ${p.passengerName} - ${p.passengerPhone || ''} - ${en ? 'board at' : 'lên'} ${p.pickupOffice} → ${p.dropOffice}${p.note ? ` (${p.note})` : ''}`),
  ];
  const sh = (title, groups) => {
    if (!groups.length) return;
    lines.push('', title);
    for (const g of groups) {
      lines.push(`- ${g.officeName} / ${g.zoneName}`);
      for (const it of g.items) lines.push(`  ${it.plannedTime} ${it.passengerName} ${it.passengerPhone} - ${it.addressText} (${it.seatCount} ${en ? 'seats' : 'ghế'})${it.noteText ? ` - ${it.noteText}` : ''}`);
    }
  };
  sh(en ? 'SHUTTLE PICKUP' : 'TRUNG CHUYỂN ĐÓN', shuttle.pickup);
  sh(en ? 'SHUTTLE DROP-OFF' : 'TRUNG CHUYỂN TRẢ', shuttle.drop);
  if (parcels.items.length) {
    lines.push('', `${en ? 'PARCELS' : 'HÀNG GỬI'} (${parcels.totalPieces} ${en ? 'pcs' : 'kiện'}, ${parcels.totalKg} kg)`);
    for (const p of parcels.items) lines.push(`${p.code}: ${p.pieceCount} ${en ? 'pcs' : 'kiện'} ${p.actualWeightKg ?? p.weightKg}kg ${p.fromOffice.name} → ${p.toOffice.name}, ${en ? 'to' : 'nhận'}: ${p.receiver.name} ${p.receiver.phone}`);
  }
  return { text: lines.join('\n') };
}

/** PATCH /manage/trips/:id/checklist/:itemId { isDone } (184). */
async function checkItem(auth, tripId, itemId, body) {
  const c = new Checker();
  const isDone = c.bool(body, 'isDone', { required: true });
  c.done();
  const r = await Trip.updateOne({ _id: tripId, 'checklist.itemId': itemId }, { $set: { 'checklist.$.isDone': isDone, 'checklist.$.doneBy': isDone ? auth.accountId : null, 'checklist.$.doneAt': isDone ? new Date().toISOString() : null } });
  if (!r.matchedCount) throw notFound();
  return { checklist: (await Trip.findById(tripId).lean()).checklist };
}

/** PUT /manage/trips/:id/checklist — reload the trip checklist from the current template. */
async function resetChecklist(auth, tripId) {
  const items = (await models.ChecklistItem.find({ isActive: true }).sort({ sortOrder: 1 }).lean()).map((i) => ({ itemId: i._id, title: i.title, isDone: false, doneBy: null, doneAt: null }));
  const r = await Trip.updateOne({ _id: tripId }, { $set: { checklist: items } });
  if (!r.matchedCount) throw notFound();
  return { checklist: items };
}

module.exports = {
  customerScope, createCustomer, updateCustomer, resetCustomerPassword, deleteCustomer,
  listCustomers, getCustomer, setSuspended, suspend, search, parseCsv, importCsv, onboarding, markOnboarding,
  addLog, listLogs, broadcast, driverText, checkItem, resetChecklist,
};
