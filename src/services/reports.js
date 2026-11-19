/**
 * Reconciliation and reports (240-253, 263). All figures are "as recorded in the app": the admin still checks
 * them against the bank statement. Periods use local dates (`from`, `to`, inclusive, yyyy-MM-dd).
 */
const config = require('../config');
const models = require('../models');
const T = require('../lib/time');
const { iso } = require('../lib/util');
const { toCsv } = require('./privacy');
const { revenueBetween, topRoutesAndHours } = require('./dashboard');

const { PaymentRecord, Refund, PaymentProof, Booking, Trip, TripSeat, TripExpense, Route, Vehicle, Parcel, OrderEvent, ShuttleZone } = models;

function period(query, defDays = 30) {
  const to = T.isDate(query.to) ? query.to : T.today();
  const from = T.isDate(query.from) ? query.from : T.addDays(to, -(defDays - 1));
  return { from, to, start: T.localToUtc(from), end: T.localToUtc(T.addDays(to, 1)) };
}

const nameMap = async (Model, ids, field = 'name') => new Map((await Model.find({ _id: { $in: [...new Set(ids.filter(Boolean))] } }).select(field).lean()).map((x) => [x._id, x[field]]));

/** Per-trip money for trips departing in the period. */
async function tripMoney(start, end, extraTripFilter = {}) {
  const trips = await Trip.find({ departAt: { $gte: start, $lt: end }, ...extraTripFilter }).lean();
  const ids = trips.map((t) => t._id);
  const [pay, ref, pend, exp] = await Promise.all([
    PaymentRecord.aggregate([{ $match: { tripId: { $in: ids } } }, { $group: { _id: { t: '$tripId', m: '$method', o: '$orderType' }, amount: { $sum: '$amount' }, comp: { $sum: '$compValue' }, n: { $sum: 1 } } }]),
    Refund.aggregate([{ $match: { tripId: { $in: ids } } }, { $group: { _id: { t: '$tripId', s: '$status' }, amount: { $sum: '$amount' } } }]),
    PaymentProof.aggregate([{ $match: { tripId: { $in: ids }, status: 'pending' } }, { $group: { _id: '$tripId', amount: { $sum: '$amount' }, n: { $sum: 1 } } }]),
    TripExpense.aggregate([{ $match: { tripId: { $in: ids } } }, { $group: { _id: '$tripId', amount: { $sum: '$amount' } } }]),
  ]);
  return trips.map((t) => {
    const p = pay.filter((x) => x._id.t === t._id);
    const sum = (f) => p.filter(f).reduce((s, x) => s + x.amount, 0);
    const byProof = sum((x) => x._id.m === 'proof');
    const byCash = sum((x) => x._id.m === 'cash');
    const byTransfer = sum((x) => x._id.m === 'transfer');
    const comps = p.filter((x) => x._id.m === 'free' || x.comp > 0).reduce((s, x) => s + x.comp, 0);
    const refunded = ref.filter((x) => x._id.t === t._id && x._id.s === 'recorded').reduce((s, x) => s + x.amount, 0);
    const refundPending = ref.filter((x) => x._id.t === t._id && x._id.s === 'pending').reduce((s, x) => s + x.amount, 0);
    const received = byProof + byCash + byTransfer;
    const expenses = (exp.find((x) => x._id === t._id)?.amount || 0) + (t.driverPay || 0);
    return {
      trip: t, received, byProof, byCash, byTransfer, parcelRevenue: sum((x) => x._id.o === 'parcel'), comps, refunded, refundPending,
      pendingProofAmount: pend.find((x) => x._id === t._id)?.amount || 0, pendingProofs: pend.find((x) => x._id === t._id)?.n || 0,
      net: received - refunded, expenses, grossProfit: received - refunded - expenses,
    };
  });
}

/** GET /manage/reports/reconciliation (240). */
async function reconciliation(query) {
  const p = period(query, 7);
  const rows = await tripMoney(p.start, p.end, query.routeId ? { routeId: String(query.routeId) } : {});
  const routes = await nameMap(Route, rows.map((r) => r.trip.routeId));
  const items = rows.map((r) => ({
    tripId: r.trip._id, route: routes.get(r.trip.routeId) || '', departAt: iso(r.trip.departAt), date: r.trip.date, departTime: r.trip.departTime, tripStatus: r.trip.status,
    received: r.received, byProof: r.byProof, byCash: r.byCash, byTransfer: r.byTransfer, parcelRevenue: r.parcelRevenue, refunded: r.refunded, refundPending: r.refundPending,
    pendingProofAmount: r.pendingProofAmount, pendingProofs: r.pendingProofs, comps: r.comps, net: r.net,
  }));
  const total = (k) => items.reduce((s, x) => s + x[k], 0);
  return { from: p.from, to: p.to, note: 'figures_recorded_in_app', items, totals: Object.fromEntries(['received', 'byProof', 'byCash', 'byTransfer', 'parcelRevenue', 'refunded', 'refundPending', 'pendingProofAmount', 'comps', 'net'].map((k) => [k, total(k)])) };
}

/** GET /manage/reports/profit?groupBy=trip|route|vehicle (241, 242, 253). */
async function profit(query) {
  const p = period(query);
  const rows = await tripMoney(p.start, p.end, { status: { $ne: 'cancelled' } });
  const seats = await seatCounts(rows.map((r) => r.trip._id));
  const groupBy = ['route', 'vehicle'].includes(query.groupBy) ? query.groupBy : 'trip';
  const key = (r) => (groupBy === 'route' ? r.trip.routeId : groupBy === 'vehicle' ? r.trip.vehicleId || 'none' : r.trip._id);
  const groups = new Map();
  for (const r of rows) {
    const k = key(r);
    const g = groups.get(k) || { key: k, trips: 0, revenue: 0, refunded: 0, expenses: 0, grossProfit: 0, seatsSold: 0, ticketRevenue: 0 };
    g.trips += 1;
    g.revenue += r.received;
    g.refunded += r.refunded;
    g.expenses += r.expenses;
    g.grossProfit += r.grossProfit;
    g.seatsSold += seats.get(r.trip._id)?.sold || 0;
    g.ticketRevenue += r.received - r.parcelRevenue;
    if (groupBy === 'trip') Object.assign(g, { tripId: r.trip._id, departAt: iso(r.trip.departAt), routeId: r.trip.routeId });
    groups.set(k, g);
  }
  const routes = await nameMap(Route, rows.map((r) => r.trip.routeId));
  const plates = await nameMap(Vehicle, rows.map((r) => r.trip.vehicleId), 'plateNo');
  const items = [...groups.values()].map((g) => {
    const avgTicket = g.seatsSold ? Math.round(g.ticketRevenue / g.seatsSold) : null;
    return {
      ...g,
      label: groupBy === 'route' ? routes.get(g.key) || '' : groupBy === 'vehicle' ? plates.get(g.key) || '' : `${routes.get(g.routeId) || ''} ${g.departAt}`,
      averageTicket: avgTicket,
      // 253: seats needed to cover the costs, an estimate only.
      breakEvenSeats: avgTicket ? Math.ceil(g.expenses / avgTicket) : null,
    };
  }).sort((a, b) => b.grossProfit - a.grossProfit);
  return { from: p.from, to: p.to, groupBy, note: 'estimate', items };
}

async function seatCounts(tripIds) {
  const rows = await TripSeat.aggregate([{ $match: { tripId: { $in: tripIds }, isSellable: true } }, { $group: { _id: { t: '$tripId', s: '$state' }, n: { $sum: 1 } } }]);
  const m = new Map();
  for (const r of rows) {
    const x = m.get(r._id.t) || { total: 0, sold: 0, claimed: 0 };
    x.total += r.n;
    if (r._id.s === 'sold') x.sold += r.n;
    if (r._id.s === 'claimed') x.claimed += r.n;
    m.set(r._id.t, x);
  }
  return m;
}

/** GET /manage/reports/occupancy?groupBy=trip|route|hour (243). */
async function occupancy(query) {
  const p = period(query);
  const trips = await Trip.find({ departAt: { $gte: p.start, $lt: p.end }, status: { $ne: 'cancelled' } }).lean();
  const seats = await seatCounts(trips.map((t) => t._id));
  const groupBy = ['route', 'hour'].includes(query.groupBy) ? query.groupBy : 'trip';
  const routes = await nameMap(Route, trips.map((t) => t.routeId));
  const groups = new Map();
  for (const t of trips) {
    const k = groupBy === 'route' ? t.routeId : groupBy === 'hour' ? t.departTime.slice(0, 2) : t._id;
    const s = seats.get(t._id) || { total: 0, sold: 0 };
    const g = groups.get(k) || { key: k, label: groupBy === 'route' ? routes.get(k) : groupBy === 'hour' ? `${k}:00` : `${routes.get(t.routeId)} ${t.date} ${t.departTime}`, trips: 0, seats: 0, sold: 0 };
    g.trips += 1;
    g.seats += s.total;
    g.sold += s.sold;
    groups.set(k, g);
  }
  const items = [...groups.values()].map((g) => ({ ...g, fillPercent: g.seats ? Math.round((g.sold / g.seats) * 100) : 0 })).sort((a, b) => (groupBy === 'hour' ? a.key.localeCompare(b.key) : b.fillPercent - a.fillPercent));
  return { from: p.from, to: p.to, groupBy, items };
}

/** GET /manage/reports/revenue?groupBy=day|week|month (244): by booking source (app / admin) and order type. */
async function revenue(query) {
  const p = period(query);
  const groupBy = ['week', 'month'].includes(query.groupBy) ? query.groupBy : 'day';
  const tz = config.timezone;
  const fmt = { $dateToString: { format: '%Y-%m-%d', date: '$recordedAt', timezone: tz } };
  const [inc, out] = await Promise.all([
    PaymentRecord.aggregate([{ $match: { recordedAt: { $gte: p.start, $lt: p.end }, method: { $ne: 'free' } } }, { $group: { _id: { d: fmt, s: '$source', o: '$orderType' }, amount: { $sum: '$amount' }, n: { $sum: 1 } } }]),
    Refund.aggregate([{ $match: { status: 'recorded', recordedAt: { $gte: p.start, $lt: p.end } } }, { $group: { _id: { d: fmt }, amount: { $sum: '$amount' } } }]),
  ]);
  const bucket = (d) => (groupBy === 'month' ? d.slice(0, 7) : groupBy === 'week' ? T.weekStart(d) : d);
  const m = new Map();
  for (const x of inc) {
    const k = bucket(x._id.d);
    const g = m.get(k) || { period: k, app: 0, admin: 0, booking: 0, parcel: 0, refunds: 0, orders: 0 };
    g[x._id.s === 'admin' ? 'admin' : 'app'] += x.amount;
    g[x._id.o] += x.amount;
    g.orders += x.n;
    m.set(k, g);
  }
  for (const x of out) {
    const k = bucket(x._id.d);
    const g = m.get(k) || { period: k, app: 0, admin: 0, booking: 0, parcel: 0, refunds: 0, orders: 0 };
    g.refunds += x.amount;
    m.set(k, g);
  }
  const items = [...m.values()].map((g) => ({ ...g, net: g.app + g.admin - g.refunds })).sort((a, b) => a.period.localeCompare(b.period));
  const totals = await revenueBetween(p.start, p.end);
  return { from: p.from, to: p.to, groupBy, items, totals };
}

/** GET /manage/reports/top (245). */
async function top(query) {
  const p = period(query);
  return { from: p.from, to: p.to, ...(await topRoutesAndHours(p.start, p.end)) };
}

/** GET /manage/reports/rates (246, 247): cancel rate, receipt rejection rate, lost-seat rate, average review time. */
async function rates(query) {
  const p = period(query);
  const [created, cancelled, reviewed, rejected, withProof, lost, times] = await Promise.all([
    Booking.countDocuments({ createdAt: { $gte: p.start, $lt: p.end }, source: 'app' }),
    Booking.countDocuments({ createdAt: { $gte: p.start, $lt: p.end }, status: 'cancelled' }),
    PaymentProof.countDocuments({ reviewedAt: { $gte: p.start, $lt: p.end } }),
    PaymentProof.countDocuments({ reviewedAt: { $gte: p.start, $lt: p.end }, status: 'rejected' }),
    Booking.countDocuments({ proofSubmittedAt: { $gte: p.start, $lt: p.end } }),
    OrderEvent.distinct('orderId', { orderType: 'booking', kind: 'seat_lost', at: { $gte: p.start, $lt: p.end } }).then((x) => x.length),
    PaymentProof.aggregate([{ $match: { reviewedAt: { $gte: p.start, $lt: p.end } } }, { $group: { _id: null, avg: { $avg: { $subtract: ['$reviewedAt', '$uploadedAt'] } }, max: { $max: { $subtract: ['$reviewedAt', '$uploadedAt'] } } } }]),
  ]);
  const r = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    from: p.from, to: p.to,
    cancelRate: { percent: r(cancelled, created), cancelled, created },
    proofRejectRate: { percent: r(rejected, reviewed), rejected, reviewed },
    seatLostRate: { percent: r(lost, withProof), lost, withProof },
    reviewTime: { averageMinutes: times[0] ? Math.round(times[0].avg / 60000) : null, maxMinutes: times[0] ? Math.round(times[0].max / 60000) : null, reviewed },
  };
}

/** GET /manage/reports/parcels (248): revenue and count by route and month, average load per trip. */
async function parcels(query) {
  const p = period(query, 90);
  const rows = await Parcel.aggregate([
    { $match: { createdAt: { $gte: p.start, $lt: p.end }, status: { $nin: ['cancelled', 'rejected', 'pending'] } } },
    { $group: { _id: { r: '$routeId', m: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: config.timezone } } }, n: { $sum: 1 }, fee: { $sum: '$paidAmount' }, kg: { $sum: { $ifNull: ['$actualWeightKg', '$weightKg'] } } } },
    { $sort: { '_id.m': 1 } },
  ]);
  const load = await Parcel.aggregate([
    { $match: { createdAt: { $gte: p.start, $lt: p.end }, tripId: { $ne: null }, status: { $nin: ['cancelled', 'rejected'] } } },
    { $group: { _id: '$tripId', kg: { $sum: { $ifNull: ['$actualWeightKg', '$weightKg'] } }, pieces: { $sum: '$pieceCount' } } },
    { $group: { _id: null, trips: { $sum: 1 }, avgKg: { $avg: '$kg' }, avgPieces: { $avg: '$pieces' } } },
  ]);
  const routes = await nameMap(Route, rows.map((x) => x._id.r));
  return {
    from: p.from, to: p.to,
    items: rows.map((x) => ({ routeId: x._id.r, route: routes.get(x._id.r) || '', month: x._id.m, parcels: x.n, revenue: x.fee, totalKg: Math.round(x.kg * 10) / 10 })),
    averageLoadPerTrip: load[0] ? { trips: load[0].trips, kg: Math.round(load[0].avgKg * 10) / 10, pieces: Math.round(load[0].avgPieces * 10) / 10 } : null,
  };
}

/** GET /manage/reports/comps (249): free seats and special prices by month and reason. */
async function comps(query) {
  const p = period(query, 180);
  const rows = await PaymentRecord.aggregate([
    { $match: { recordedAt: { $gte: p.start, $lt: p.end }, $or: [{ method: 'free' }, { compValue: { $gt: 0 } }] } },
    { $lookup: { from: 'bookings', localField: 'orderId', foreignField: '_id', as: 'b' } },
    { $project: { month: { $dateToString: { format: '%Y-%m', date: '$recordedAt', timezone: config.timezone } }, reason: '$reason', method: 1, compValue: 1, seats: { $size: { $ifNull: [{ $arrayElemAt: ['$b.seats', 0] }, []] } } } },
    { $group: { _id: { m: '$month', r: '$reason', k: '$method' }, bookings: { $sum: 1 }, seats: { $sum: '$seats' }, value: { $sum: '$compValue' } } },
    { $sort: { '_id.m': 1 } },
  ]);
  return { from: p.from, to: p.to, items: rows.map((x) => ({ month: x._id.m, reason: x._id.r || '', kind: x._id.k === 'free' ? 'free' : 'special_price', bookings: x.bookings, seats: x.seats, value: x.value })) };
}

/** GET /manage/reports/shuttle (250): shuttle rides and fees by zone. */
async function shuttle(query) {
  const p = period(query);
  const rows = await Booking.find({ status: { $in: ['confirmed', 'completed'] }, departAt: { $gte: p.start, $lt: p.end }, $or: [{ pickupShuttle: { $ne: null } }, { dropShuttle: { $ne: null } }] }).select('pickupShuttle dropShuttle').lean();
  const m = new Map();
  for (const b of rows) {
    for (const s of [b.pickupShuttle, b.dropShuttle]) {
      if (!s || s.status === 'cancelled') continue;
      const g = m.get(s.zoneId) || { zoneId: s.zoneId, zoneName: s.zoneName, pickups: 0, drops: 0, absent: 0, revenue: 0 };
      g[s.direction === 'pickup' ? 'pickups' : 'drops'] += 1;
      if (s.status === 'absent') g.absent += 1;
      g.revenue += s.fee || 0;
      m.set(s.zoneId, g);
    }
  }
  const zones = new Map((await ShuttleZone.find({ _id: { $in: [...m.keys()] } }).lean()).map((z) => [z._id, z]));
  const offices = await nameMap(models.Office, [...zones.values()].map((z) => z.officeId));
  return { from: p.from, to: p.to, items: [...m.values()].map((g) => ({ ...g, officeName: offices.get(zones.get(g.zoneId)?.officeId) || '' })).sort((a, b) => b.revenue - a.revenue) };
}

/**
 * GET /manage/reports/forecast?routeId (252): average seats sold per weekday over the last 8 weeks, and the next
 * 14 days with that estimate (+ active seasonal price periods as "holiday" hints). Not computed with < 4 weeks.
 */
async function forecast(query) {
  const today = T.today();
  const from = T.addDays(today, -56);
  const filter = { departAt: { $gte: T.localToUtc(from), $lt: T.localToUtc(today) }, status: { $ne: 'cancelled' } };
  if (query.routeId) filter.routeId = String(query.routeId);
  const trips = await Trip.find(filter).select('date routeId').lean();
  const first = trips.map((t) => t.date).sort()[0];
  const weeks = first ? Math.floor((T.localToUtc(today) - T.localToUtc(first)) / (7 * 86400000)) : 0;
  if (weeks < 4) return { enough: false, weeksOfData: weeks, minWeeks: 4, items: [] };
  const seats = await seatCounts(trips.map((t) => t._id));
  const byDay = new Map();
  for (const t of trips) {
    const s = seats.get(t._id)?.sold || 0;
    byDay.set(t.date, (byDay.get(t.date) || 0) + s);
  }
  const perWeekday = Array.from({ length: 7 }, () => []);
  for (const [d, n] of byDay) perWeekday[T.weekday(d)].push(n);
  const avg = perWeekday.map((a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0));
  const seasonal = await models.SeasonalPrice.find({ isActive: true, toDate: { $gte: today } }).lean();
  const items = [];
  for (let i = 1; i <= 14; i += 1) {
    const d = T.addDays(today, i);
    const season = seasonal.find((s) => s.fromDate <= d && s.toDate >= d && (!s.routeId || !query.routeId || s.routeId === query.routeId));
    items.push({ date: d, weekday: T.weekday(d), expectedSeats: avg[T.weekday(d)], holiday: season ? season.name : null });
  }
  return { enough: true, weeksOfData: weeks, note: 'estimate', weekdayAverage: avg, items };
}

// ---------- CSV exports (251, 263) ----------

async function exportCsv(query) {
  const p = period(query);
  const type = query.type || 'bookings';
  const routes = new Map((await Route.find({}).select('name').lean()).map((r) => [r._id, r.name]));
  if (type === 'trips') {
    const rows = await tripMoney(p.start, p.end);
    const seats = await seatCounts(rows.map((r) => r.trip._id));
    const plates = await nameMap(Vehicle, rows.map((r) => r.trip.vehicleId), 'plateNo');
    return {
      filename: `trips_${p.from}_${p.to}.csv`,
      csv: toCsv(['tripId', 'route', 'date', 'time', 'status', 'vehicle', 'seats', 'sold', 'received', 'refunded', 'expenses', 'grossProfit'],
        rows.map((r) => [r.trip._id, routes.get(r.trip.routeId) || '', r.trip.date, r.trip.departTime, r.trip.status, plates.get(r.trip.vehicleId) || '', seats.get(r.trip._id)?.total || 0, seats.get(r.trip._id)?.sold || 0, r.received, r.refunded, r.expenses, r.grossProfit])),
    };
  }
  if (type === 'reconciliation') {
    const r = await reconciliation(query);
    return {
      filename: `reconciliation_${p.from}_${p.to}.csv`,
      csv: toCsv(['tripId', 'route', 'date', 'time', 'byProof', 'byCash', 'byTransfer', 'parcel', 'refunded', 'refundPending', 'pendingProofs', 'comps', 'net'],
        r.items.map((x) => [x.tripId, x.route, x.date, x.departTime, x.byProof, x.byCash, x.byTransfer, x.parcelRevenue, x.refunded, x.refundPending, x.pendingProofAmount, x.comps, x.net])),
    };
  }
  if (type === 'parcels') {
    const rows = await Parcel.find({ createdAt: { $gte: p.start, $lt: p.end } }).sort({ createdAt: 1 }).lean();
    return {
      filename: `parcels_${p.from}_${p.to}.csv`,
      csv: toCsv(['code', 'route', 'date', 'status', 'payStatus', 'sender', 'senderPhone', 'receiver', 'receiverPhone', 'pieces', 'kg', 'fee', 'paid', 'refunded'],
        rows.map((x) => [x.code, routes.get(x.routeId) || '', x.date, x.status, x.payStatus, x.senderName, x.senderPhone, x.receiverName, x.receiverPhone, x.pieceCount, x.actualWeightKg ?? x.weightKg, x.fee, x.paidAmount, x.refundedAmount])),
    };
  }
  const rows = await Booking.find({ departAt: { $gte: p.start, $lt: p.end } }).sort({ departAt: 1 }).lean();
  return {
    filename: `bookings_${p.from}_${p.to}.csv`,
    csv: toCsv(['code', 'route', 'departure', 'status', 'source', 'payMethod', 'seats', 'passengers', 'phones', 'total', 'paid', 'refunded', 'compReason', 'createdAt'],
      rows.map((b) => {
        const l = T.toLocal(b.departAt);
        return [b.code, routes.get(b.routeId) || '', `${l.date} ${l.time}`, b.status, b.source, b.payMethod, b.seats.map((s) => s.label).join(' '), b.seats.map((s) => s.passengerName).join(' | '), b.seats.map((s) => s.passengerPhone).join(' | '), b.totalAmount, b.paidAmount, b.refundedAmount, b.compReason || '', iso(b.createdAt)];
      })),
  };
}

module.exports = { reconciliation, profit, occupancy, revenue, top, rates, parcels, comps, shuttle, forecast, exportCsv };
