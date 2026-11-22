/**
 * Admin overview (118-129), "to confirm" inbox (122, 140-156) and confirmation calendar (141).
 * Revenue = money collected at the counter and recorded in the app (cash, direct transfer; free seats excluded)
 * minus refunds recorded, by the day it was recorded, in the operator's timezone. An approved booking that was not
 * collected yet is not revenue (it shows as "waiting for payment"). The inbox counts and the dashboard card
 * come from the same function so the two never disagree.
 */
const models = require('../models');
const T = require('../lib/time');
const { iso } = require('../lib/util');
const settings = require('./settings');

const { PaymentRecord, Refund, Booking, Parcel, Trip, Vehicle, StaffMember, StaffSchedule, OrderRequest, Report, Complaint, Message, ContactMessage, Route } = models;

async function revenueBetween(start, end, extra = {}) {
  const [inc, out] = await Promise.all([
    PaymentRecord.aggregate([{ $match: { recordedAt: { $gte: start, $lt: end }, method: { $ne: 'free' }, ...extra } }, { $group: { _id: '$orderType', amount: { $sum: '$amount' }, orders: { $sum: 1 } } }]),
    Refund.aggregate([{ $match: { status: 'recorded', recordedAt: { $gte: start, $lt: end }, ...(extra.orderType ? { orderType: extra.orderType } : {}) } }, { $group: { _id: '$orderType', amount: { $sum: '$amount' } } }]),
  ]);
  const by = (arr, t) => arr.find((x) => x._id === t)?.amount || 0;
  const booking = by(inc, 'booking') - by(out, 'booking');
  const parcel = by(inc, 'parcel') - by(out, 'parcel');
  return { amount: booking + parcel, booking, parcel, refunds: by(out, 'booking') + by(out, 'parcel'), orders: inc.reduce((s, x) => s + x.orders, 0) };
}

const pct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

function rangeOf(query) {
  const today = T.today();
  const preset = query.range || 'today';
  let from = today;
  let to = today;
  if (preset === '7d') from = T.addDays(today, -6);
  else if (preset === 'month') from = T.monthStart(today);
  else if (preset === '30d') from = T.addDays(today, -29);
  else if (preset === 'custom' && T.isDate(query.from) && T.isDate(query.to)) {
    from = query.from;
    to = query.to;
  }
  return { preset, from, to, start: T.localToUtc(from), end: T.localToUtc(T.addDays(to, 1)) };
}

async function card(fromDate, toDate) {
  const days = Math.round((T.localToUtc(toDate) - T.localToUtc(fromDate)) / 86400000) + 1;
  const cur = await revenueBetween(T.localToUtc(fromDate), T.localToUtc(T.addDays(toDate, 1)));
  const prev = await revenueBetween(T.localToUtc(T.addDays(fromDate, -days)), T.localToUtc(fromDate));
  return { from: fromDate, to: toDate, amount: cur.amount, booking: cur.booking, parcel: cur.parcel, orders: cur.orders, previous: prev.amount, changePercent: pct(cur.amount, prev.amount) };
}

/** Daily revenue + order count (119). */
async function chart(days) {
  const today = T.today();
  const from = T.addDays(today, -(days - 1));
  const start = T.localToUtc(from);
  const tz = config().timezone;
  const [inc, out] = await Promise.all([
    PaymentRecord.aggregate([{ $match: { recordedAt: { $gte: start }, method: { $ne: 'free' } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$recordedAt', timezone: tz } }, amount: { $sum: '$amount' }, orders: { $sum: 1 } } }]),
    Refund.aggregate([{ $match: { status: 'recorded', recordedAt: { $gte: start } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$recordedAt', timezone: tz } }, amount: { $sum: '$amount' } } }]),
  ]);
  const out2 = [];
  for (let d = from; d <= today; d = T.addDays(d, 1)) {
    const i = inc.find((x) => x._id === d);
    const o = out.find((x) => x._id === d);
    out2.push({ date: d, amount: (i?.amount || 0) - (o?.amount || 0), orders: i?.orders || 0 });
  }
  return out2;
}
const config = () => require('../config');

/** Bookings approved but not paid at the counter yet: count and total (the "Chờ thu tiền" card). */
async function unpaidSummary() {
  const now = new Date();
  const rows = await Booking.aggregate([
    { $match: require('./bookings').UNPAID },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totalAmount' }, soon: { $sum: { $cond: [{ $lte: ['$departAt', T.addMinutes(now, 1440)] }, 1, 0] } }, soonAmount: { $sum: { $cond: [{ $lte: ['$departAt', T.addMinutes(now, 1440)] }, '$totalAmount', 0] } } } },
  ]);
  return { count: rows[0]?.count || 0, amount: rows[0]?.amount || 0, tripsWithin24h: rows[0]?.soon || 0, amountWithin24h: rows[0]?.soonAmount || 0 };
}

/** Counts of everything waiting for the admin (122, 140). Same numbers as the inbox lists. */
async function inboxCounts() {
  const [bookings, cancel, refunds, parcels, reports, complaints, messages, contacts, unpaid, oldest] = await Promise.all([
    Booking.countDocuments({ status: 'pending' }),
    OrderRequest.countDocuments({ status: 'pending', type: 'cancel' }),
    Refund.countDocuments({ status: 'pending' }),
    Parcel.countDocuments({ status: 'pending' }),
    Report.countDocuments({ status: 'open' }),
    Complaint.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    Message.distinct('bookingId', { senderRole: 'customer', readAt: null }).then((x) => x.length),
    ContactMessage.countDocuments({ status: 'open' }),
    unpaidSummary(),
    Booking.findOne({ status: 'pending' }).sort({ createdAt: 1 }).lean(),
  ]);
  return {
    bookings, cancelRequests: cancel, toCollect: unpaid.count, toCollectAmount: unpaid.amount, refunds, parcels, reports, complaints, messages, contacts,
    total: bookings + cancel + unpaid.count + refunds + parcels + reports + complaints + messages + contacts,
    oldestBookingWaitingMinutes: oldest ? Math.round((Date.now() - oldest.createdAt) / 60000) : null,
  };
}

async function alerts() {
  const today = T.today();
  const week = T.addDays(today, 7);
  const month = T.addDays(today, 30);
  const [vehicles, maint, drivers, soonTrips] = await Promise.all([
    Vehicle.find({ status: { $ne: 'retired' }, 'docDates.expiresOn': { $lte: week } }).lean(),
    models.MaintenanceLog.find({ nextDueOn: { $ne: null, $lte: week } }).lean(),
    StaffMember.find({ kind: 'limo_driver', status: 'active', licenseExpiresOn: { $ne: null, $lte: month } }).lean(),
    Trip.find({ status: 'scheduled', departAt: { $gt: new Date(), $lte: T.addMinutes(new Date(), 1440) } }).lean(),
  ]);
  const unpaid = await unpaidSummary();
  const out = [];
  for (const v of vehicles) for (const d of v.docDates || []) if (d.expiresOn <= week) out.push({ kind: 'vehicle_doc', severity: d.expiresOn < today ? 'high' : 'medium', vehicleId: v._id, plateNo: v.plateNo, docKind: d.kind, expiresOn: d.expiresOn });
  const vm = new Map((await Vehicle.find({ _id: { $in: maint.map((m) => m.vehicleId) } }).select('plateNo').lean()).map((v) => [v._id, v.plateNo]));
  // Only the latest log of each vehicle matters for the next due date.
  const latest = new Map();
  for (const m of maint) if (!latest.has(m.vehicleId) || latest.get(m.vehicleId).date < m.date) latest.set(m.vehicleId, m);
  for (const m of latest.values()) out.push({ kind: 'maintenance_due', severity: m.nextDueOn < today ? 'high' : 'medium', vehicleId: m.vehicleId, plateNo: vm.get(m.vehicleId) || '', dueOn: m.nextDueOn });
  for (const d of drivers) out.push({ kind: 'license_expiring', severity: d.licenseExpiresOn < today ? 'high' : 'medium', staffId: d._id, name: d.name, expiresOn: d.licenseExpiresOn });
  if (unpaid.tripsWithin24h) out.push({ kind: 'unpaid_soon', severity: 'high', count: unpaid.tripsWithin24h, amount: unpaid.amountWithin24h });
  const sys = await settings.get('system');
  const items = await require('./trips').presentMany(soonTrips, { admin: true });
  for (const t of items) {
    if (t.fillPercent <= (sys.lowFillPercent || 30)) out.push({ kind: 'low_fill', severity: 'low', tripId: t.id, route: t.route?.name, departAt: t.departAt, fillPercent: t.fillPercent });
    if (t.needsVehicle || t.needsDriver) out.push({ kind: 'trip_unassigned', severity: 'high', tripId: t.id, route: t.route?.name, departAt: t.departAt, needsVehicle: t.needsVehicle, needsDriver: t.needsDriver });
  }
  return out;
}

/** GET /manage/dashboard?range=today|7d|month|30d|custom&from&to&chart=7|30 */
async function dashboard(query) {
  const r = rangeOf(query);
  const today = T.today();
  const [dToday, d7, dMonth, dRange] = await Promise.all([card(today, today), card(T.addDays(today, -6), today), card(T.monthStart(today), today), card(r.from, r.to)]);
  const [vehicleRows, staffRows, offToday, inbox] = await Promise.all([
    Vehicle.find({}).lean(), StaffMember.find({ status: 'active' }).lean(), StaffSchedule.distinct('staffId', { date: today, kind: 'off' }), inboxCounts(),
  ]);
  const week = T.addDays(today, 30);
  const [ts, te] = T.dayRange(today);
  const todayTrips = await Trip.find({ departAt: { $gte: ts, $lt: te }, status: { $ne: 'cancelled' } }).lean();
  const tripItems = await require('./trips').presentMany(todayTrips, { admin: true });
  const seatsTotal = tripItems.reduce((s, t) => s + t.seats.total, 0);
  const seatsUsed = tripItems.reduce((s, t) => s + t.seats.sold + t.seats.pending, 0);
  const [parcelsToday, parcelsPending, parcelsWaiting, parcelRevenue] = await Promise.all([
    Parcel.countDocuments({ createdAt: { $gte: ts, $lt: te } }), Parcel.countDocuments({ status: 'pending' }), Parcel.countDocuments({ status: 'arrived' }), revenueBetween(r.start, r.end, { orderType: 'parcel' }),
  ]);
  const recent = await Booking.find({}).sort({ createdAt: -1 }).limit(5).lean();
  const waiting = await Booking.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(5).lean();
  const top = await topRoutesAndHours(r.start, r.end);
  return {
    range: { preset: r.preset, from: r.from, to: r.to },
    revenue: { today: dToday, last7Days: d7, thisMonth: dMonth, range: dRange },
    chart: await chart(query.chart === '30' ? 30 : 7),
    vehicles: {
      total: vehicleRows.length, active: vehicleRows.filter((v) => v.status === 'active').length, maintenance: vehicleRows.filter((v) => v.status === 'maintenance').length,
      retired: vehicleRows.filter((v) => v.status === 'retired').length, docsExpiringSoon: vehicleRows.filter((v) => (v.docDates || []).some((d) => d.expiresOn <= week)).length,
    },
    staff: {
      total: staffRows.length,
      byKind: { limo_driver: staffRows.filter((s) => s.kind === 'limo_driver').length, shuttle_driver: staffRows.filter((s) => s.kind === 'shuttle_driver').length, office_staff: staffRows.filter((s) => s.kind === 'office_staff').length },
      offToday: offToday.length,
    },
    inbox,
    parcels: { createdToday: parcelsToday, pending: parcelsPending, waitingPickupAtOffice: parcelsWaiting, revenueInRange: parcelRevenue.amount },
    tripsToday: {
      count: tripItems.length, passengers: seatsUsed, fillPercent: seatsTotal ? Math.round((seatsUsed / seatsTotal) * 100) : 0,
      unassigned: tripItems.filter((t) => t.needsVehicle || t.needsDriver).length,
      items: tripItems.map((t) => ({ id: t.id, route: t.route?.name, departTime: t.departTime, status: t.status, tripStatus: t.tripStatus, seats: t.seats, fillPercent: t.fillPercent, needsVehicle: t.needsVehicle, needsDriver: t.needsDriver })),
    },
    recentBookings: (await require('./bookings').presentMany(recent, { admin: true })).map((b) => ({
      id: b.id, code: b.code, status: b.status, source: b.source, totalAmount: b.totalAmount, paid: b.paid, createdAt: b.createdAt,
      customer: b.customer ? { displayName: b.customer.displayName, phone: b.customer.phone } : b.guest ? { displayName: b.guest.name, phone: b.guest.phone } : null,
      passengers: (b.seats || []).map((x) => ({ name: x.passengerName || '', seat: x.label })),
      routeName: b.trip?.route?.name || '', departAt: b.trip?.departAt || null, trip: b.trip,
    })),
    toCollect: await unpaidSummary(),
    longestWaiting: waiting.map((b) => ({ bookingId: b._id, code: b.code, amount: b.totalAmount, createdAt: iso(b.createdAt), waitingMinutes: Math.round((Date.now() - b.createdAt) / 60000) })),
    topRoutes: top.routes,
    topHours: top.hours,
    alerts: await alerts(),
    updatedAt: iso(new Date()),
  };
}

/** Every departure hour that has a trip in the period, with its seats sold (0 when none), best-selling first. */
async function allHours(sold, start, end, tz) {
  const trips = await Trip.aggregate([
    { $match: { departAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } } },
    { $group: { _id: { $hour: { date: '$departAt', timezone: tz } } } },
  ]);
  const map = new Map(trips.map((t) => [t._id, 0]));
  for (const h of sold) map.set(h._id, h.seats);
  return [...map].map(([hour, seats]) => ({ hour, seats })).sort((a, b) => b.seats - a.seats || a.hour - b.hour);
}

/** Best-selling routes and departure hours by seats sold in a period (126, 245). */
async function topRoutesAndHours(start, end) {
  const tz = config().timezone;
  const rows = await Booking.aggregate([
    { $match: { status: { $in: ['confirmed', 'completed'] }, confirmedAt: { $gte: start, $lt: end } } },
    { $project: { routeId: 1, paidAmount: 1, seats: { $size: '$seats' }, hour: { $hour: { date: '$departAt', timezone: tz } } } },
    { $facet: {
      routes: [{ $group: { _id: '$routeId', seats: { $sum: '$seats' }, revenue: { $sum: '$paidAmount' }, bookings: { $sum: 1 } } }, { $sort: { seats: -1 } }, { $limit: 10 }],
      hours: [{ $group: { _id: '$hour', seats: { $sum: '$seats' } } }, { $sort: { seats: -1 } }],
    } },
  ]);
  const names = new Map((await Route.find({ _id: { $in: rows[0].routes.map((r) => r._id) } }).select('name').lean()).map((r) => [r._id, r.name]));
  return {
    routes: rows[0].routes.map((r) => ({ routeId: r._id, name: names.get(r._id) || '', seats: r.seats, bookings: r.bookings, revenue: r.revenue })),
    hours: await allHours(rows[0].hours, start, end, tz),
  };
}

/** GET /manage/calendar?from&to — per day: trips, bookings to approve, cancel requests, payments to collect, parcels (141). */
async function calendar(query) {
  const from = T.isDate(query.from) ? query.from : T.weekStart(T.today());
  const to = T.isDate(query.to) ? query.to : T.addDays(from, 6);
  const start = T.localToUtc(from);
  const end = T.localToUtc(T.addDays(to, 1));
  const tz = config().timezone;
  const day = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } });
  const [trips, pendingBookings, requests, toCollect, parcels] = await Promise.all([
    Trip.aggregate([{ $match: { departAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } } }, { $group: { _id: '$date', n: { $sum: 1 } } }]),
    Booking.aggregate([{ $match: { status: 'pending', departAt: { $gte: start, $lt: end } } }, { $group: { _id: day('$departAt'), n: { $sum: 1 } } }]),
    OrderRequest.aggregate([{ $match: { status: 'pending', departAt: { $gte: start, $lt: end } } }, { $group: { _id: day('$departAt'), n: { $sum: 1 } } }]),
    Booking.aggregate([{ $match: { ...require('./bookings').UNPAID, departAt: { $gte: start, $lt: end } } }, { $group: { _id: day('$departAt'), n: { $sum: 1 } } }]),
    Parcel.aggregate([{ $match: { status: 'pending', date: { $gte: from, $lte: to } } }, { $group: { _id: '$date', n: { $sum: 1 } } }]),
  ]);
  const get = (arr, d) => arr.find((x) => x._id === d)?.n || 0;
  const days = [];
  for (let d = from; d <= to; d = T.addDays(d, 1)) {
    const item = { date: d, trips: get(trips, d), bookings: get(pendingBookings, d), requests: get(requests, d), toCollect: get(toCollect, d), parcels: get(parcels, d) };
    item.toConfirm = item.bookings + item.requests + item.toCollect + item.parcels;
    days.push(item);
  }
  return { from, to, days };
}

/** GET /manage/inbox?type=... — one entry point for the "Cần xác nhận" tab. */
async function inbox(auth, query) {
  const type = query.type || 'booking';
  const bookings = require('./bookings');
  switch (type) {
    case 'booking': return bookings.list(auth, { ...query, status: 'pending' }); // oldest first, overdue flagged
    case 'cancel': return bookings.listRequests(auth, { ...query, status: 'pending', type: 'cancel' });
    case 'collect': return bookings.list(auth, { ...query, payment: 'unpaid' }); // earliest trip first
    case 'refund': return bookings.listRefunds(auth, { ...query, status: 'pending' });
    case 'parcel': return require('./parcels').list(auth, { ...query, status: 'pending' });
    case 'report': return require('./social').adminReports(query);
    case 'complaint': return require('./social').listComplaints(auth, { ...query, status: 'open,in_progress' });
    case 'message': return require('./social').adminInbox(query);
    case 'contact': return require('./social').listContacts(auth, { ...query, status: 'open' });
    default: return { items: [], nextCursor: null, total: 0 };
  }
}

module.exports = { dashboard, inboxCounts, unpaidSummary, calendar, inbox, revenueBetween, rangeOf, chart, topRoutesAndHours, alerts };

