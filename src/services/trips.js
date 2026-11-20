/**
 * Trips, seats, recurring series (28-34, 44, 157-172, 199-201).
 * - A trip copies its seat layout into `trip_seats` (one row per seat, `_id = tripId:seatId`).
 * - Sale status is computed: open | not_open | sold_out | closed | running | completed | cancelled.
 * - Vehicle/driver overlap: same vehicle or driver and startA < endB && startB < endA, where
 *   end = departure + planned duration + minimum rest. Overrides need `force: true` + `overrideReason`.
 */
const models = require('../models');
const { Checker } = require('../lib/validate');
const { AppError, notFound, invalid, conflict } = require('../lib/errors');
const { uuid, iso } = require('../lib/util');
const T = require('../lib/time');
const settings = require('./settings');
const pricing = require('./pricing');
const routesSvc = require('./routes');
const notify = require('./notify');
const config = require('../config');

const { Trip, TripSeat, TripSeries, Route, Vehicle, SeatLayout, StaffMember, StaffSchedule, Booking, Parcel, OrderEvent, Review } = models;

const HOLDING = ['pending', 'confirmed', 'cancel_requested', 'completed']; // bookings that hold seats of the trip
const ACTIVE = ['pending', 'confirmed', 'cancel_requested', 'rejected']; // bookings that stop a trip from being deleted

// ---------- seat stats & status ----------

async function seatStats(tripIds) {
  const rows = await TripSeat.aggregate([
    { $match: { tripId: { $in: tripIds }, isSellable: true } },
    { $group: { _id: { t: '$tripId', s: '$state' }, n: { $sum: 1 }, classes: { $addToSet: '$seatClass' } } },
  ]);
  const map = new Map();
  for (const id of tripIds) map.set(id, { total: 0, free: 0, pending: 0, sold: 0, locked: 0, classes: [] });
  for (const r of rows) {
    const m = map.get(r._id.t);
    m[r._id.s] += r.n;
    m.total += r.n;
    m.classes = [...new Set([...m.classes, ...r.classes])];
  }
  return map;
}

function saleStatus(trip, free, now = new Date()) {
  if (['cancelled', 'completed', 'running'].includes(trip.status)) return trip.status;
  if (trip.salesClosed || (trip.salesCloseAt && now >= trip.salesCloseAt) || now >= trip.departAt) return 'closed';
  if (trip.salesOpenAt && now < trip.salesOpenAt) return 'not_open';
  if (free <= 0) return 'sold_out';
  return 'open';
}

// ---------- presenters ----------

async function lookups(trips) {
  const ids = (k) => [...new Set(trips.map((t) => t[k]).filter(Boolean))];
  const [routes, vehicles, drivers] = await Promise.all([
    Route.find({ _id: { $in: ids('routeId') } }).lean(),
    Vehicle.find({ _id: { $in: ids('vehicleId') } }).lean(),
    StaffMember.find({ _id: { $in: ids('driverId') } }).lean(),
  ]);
  return { routes: new Map(routes.map((r) => [r._id, r])), vehicles: new Map(vehicles.map((v) => [v._id, v])), drivers: new Map(drivers.map((d) => [d._id, d])) };
}

async function presentMany(trips, { admin = false, expandOffices = false } = {}) {
  if (!trips.length) return [];
  const [lk, stats] = await Promise.all([lookups(trips), seatStats(trips.map((t) => t._id))]);
  const seasonalCache = new Map();
  const out = [];
  for (const t of trips) {
    const route = lk.routes.get(t.routeId);
    const vehicle = lk.vehicles.get(t.vehicleId);
    const st = stats.get(t._id);
    const key = `${t.routeId}|${t.date}`;
    if (!seasonalCache.has(key)) seasonalCache.set(key, await pricing.seasonalFor(t));
    const seasonal = seasonalCache.get(key);
    const classes = st.classes.length ? st.classes : ['standard'];
    const l = T.toLocal(t.departAt);
    const arrive = T.addMinutes(t.departAt, t.durationMinutes || route?.durationMinutes || 0);
    const item = {
      id: t._id,
      routeId: t.routeId,
      route: route ? { id: route._id, name: route.name, fromProvinceId: route.fromProvinceId, toProvinceId: route.toProvinceId, durationMinutes: route.durationMinutes } : null,
      departAt: iso(t.departAt),
      date: l.date,
      departTime: l.time,
      tzOffset: l.offset,
      arriveAt: iso(arrive),
      arriveTime: T.toLocal(arrive).time,
      status: saleStatus(t, st.free),
      salesOpenAt: iso(t.salesOpenAt),
      salesCloseAt: iso(t.salesCloseAt),
      vehicle: vehicle ? { kindLabel: vehicle.kindLabel, seatCount: vehicle.seatCount, colorText: vehicle.colorText || '', amenities: vehicle.amenities || [] } : null,
      seats: { total: st.total, free: st.free },
      basePrice: t.basePrice,
      frontSurcharge: t.frontSurcharge || 0,
      vipSurcharge: t.vipSurcharge || 0,
      minPrice: pricing.minPrice(t, classes, null, seasonal),
      prices: classes.map((c) => {
        const p = pricing.classPrice(t, c, null, seasonal);
        return { seatClass: c, name: pricing.CLASS_NAMES[c] || c, seatPrice: p.seatPrice, surcharge: p.surcharge, total: p.seatPrice + p.surcharge };
      }),
      shuttleEnabled: route ? route.shuttleEnabled !== false : false,
      parcelEnabled: route ? !!route.parcelEnabled : false,
    };
    if (expandOffices && route) {
      const ex = await routesSvc.expand(route, t.departAt);
      Object.assign(item, { route: { ...item.route, from: ex.from, to: ex.to }, pickupOffices: ex.pickupOffices, dropOffices: ex.dropOffices, stops: ex.stops, usefulInfo: ex.usefulInfo });
    }
    if (admin) {
      const driver = lk.drivers.get(t.driverId);
      Object.assign(item, {
        tripStatus: t.status,
        salesClosed: !!t.salesClosed,
        vehicleId: t.vehicleId,
        vehicle: vehicle ? { id: vehicle._id, plateNo: vehicle.plateNo, kindLabel: vehicle.kindLabel, seatCount: vehicle.seatCount, status: vehicle.status } : null,
        driverId: t.driverId,
        driver: driver ? { id: driver._id, name: driver.name, phone: driver.phone || '' } : null,
        seats: { total: st.total, free: st.free, pending: st.pending, sold: st.sold, locked: st.locked },
        fillPercent: st.total ? Math.round(((st.sold + st.pending) / st.total) * 100) : 0,
        needsVehicle: !t.vehicleId,
        needsDriver: !t.driverId,
        prices: t.prices || [],
        seriesId: t.seriesId,
        parcelCapacity: t.parcelCapacity || null,
        parcelLoad: t.parcelLoad || { kg: 0, pieces: 0 },
        actualDepartAt: iso(t.actualDepartAt),
        actualArriveAt: iso(t.actualArriveAt),
        driverPay: t.driverPay || 0,
        cancelReason: t.cancelReason,
        overrideReason: t.overrideReason,
        note: t.note || '',
        checklistDone: (t.checklist || []).filter((x) => x.isDone).length,
        checklistTotal: (t.checklist || []).length,
        createdAt: iso(t.createdAt),
        updatedAt: iso(t.updatedAt),
      });
    }
    out.push(item);
  }
  return out;
}

async function loadTrip(id) {
  const t = await Trip.findById(id).lean();
  if (!t) throw notFound();
  return t;
}

// ---------- customer: search, detail, seats, alternatives ----------

async function search(query) {
  const c = new Checker();
  const fromProvinceId = c.id(query, 'fromProvinceId', { required: true });
  const toProvinceId = c.id(query, 'toProvinceId', { required: true });
  const date = c.date(query, 'date') || T.today();
  const seatsWanted = query.seats ? Math.max(1, parseInt(query.seats, 10) || 1) : 1;
  const timeFrom = c.time(query, 'timeFrom');
  const timeTo = c.time(query, 'timeTo');
  c.done();
  const routes = await Route.find({ fromProvinceId, toProvinceId, status: 'active' }).lean();
  if (!routes.length) return { date, items: [], facets: { vehicleKinds: [], amenities: [], pickupOffices: [], dropOffices: [] } };
  const [start, end] = T.dayRange(date);
  const raw = await Trip.find({ routeId: { $in: routes.map((r) => r._id) }, departAt: { $gte: start, $lt: end }, status: 'scheduled' }).sort({ departAt: 1 }).lean();
  let items = await presentMany(raw, { expandOffices: true });
  items = items.filter((t) => ['open', 'sold_out'].includes(t.status)); // closed (inside the lead window) and not yet open trips are hidden

  const facets = {
    vehicleKinds: [...new Set(items.map((t) => t.vehicle?.kindLabel).filter(Boolean))],
    amenities: [...new Set(items.flatMap((t) => t.vehicle?.amenities || []))],
    pickupOffices: dedupe(items.flatMap((t) => t.pickupOffices.map((o) => ({ id: o.officeId, name: o.name })))),
    dropOffices: dedupe(items.flatMap((t) => t.dropOffices.map((o) => ({ id: o.officeId, name: o.name })))),
    priceRange: items.length ? { min: Math.min(...items.map((t) => t.minPrice)), max: Math.max(...items.map((t) => t.minPrice)) } : null,
  };

  const q = query;
  if (q.pickupOfficeId) items = items.filter((t) => t.pickupOffices.some((o) => o.officeId === q.pickupOfficeId));
  if (q.dropOfficeId) items = items.filter((t) => t.dropOffices.some((o) => o.officeId === q.dropOfficeId));
  if (q.vehicleKind) items = items.filter((t) => t.vehicle?.kindLabel === q.vehicleKind);
  if (q.amenity) items = items.filter((t) => (t.vehicle?.amenities || []).includes(q.amenity));
  if (q.minPrice) items = items.filter((t) => t.minPrice >= Number(q.minPrice));
  if (q.maxPrice) items = items.filter((t) => t.minPrice <= Number(q.maxPrice));
  if (timeFrom) items = items.filter((t) => t.departTime >= timeFrom);
  if (timeTo) items = items.filter((t) => t.departTime <= timeTo);
  if (q.onlyAvailable !== 'false') items = items.filter((t) => t.seats.free >= seatsWanted || t.status !== 'open');
  if (q.onlyAvailable === 'true') items = items.filter((t) => t.status === 'open' && t.seats.free >= seatsWanted);
  const sorters = {
    time: (a, b) => a.departAt.localeCompare(b.departAt),
    '-time': (a, b) => b.departAt.localeCompare(a.departAt),
    price: (a, b) => a.minPrice - b.minPrice || a.departAt.localeCompare(b.departAt),
    '-price': (a, b) => b.minPrice - a.minPrice || a.departAt.localeCompare(b.departAt),
    seats: (a, b) => b.seats.free - a.seats.free,
  };
  items.sort(sorters[q.sort] || sorters.time);
  return { date, seats: seatsWanted, items, facets };
}

const dedupe = (arr) => [...new Map(arr.map((x) => [x.id, x])).values()];

async function detail(id, { admin = false } = {}) {
  const trip = await loadTrip(id);
  const [item] = await presentMany([trip], { admin, expandOffices: true });
  const all = await settings.all();
  const rating = await require('./catalog').operatorRating();
  return {
    ...item,
    operator: { name: all.operator.name, phone: all.operator.phone, ...rating },
    cancelPolicy: { tiers: all.cancelPolicy.tiers, cancelFee: all.cancelPolicy.cancelFee, changeAllowedHoursBefore: all.cancelPolicy.changeAllowedHoursBefore, changeFee: all.cancelPolicy.changeFee, note: all.cancelPolicy.note },
    rules: all.rules.items,
    shuttleRule: { registerHoursBefore: all.shuttle.registerHoursBefore, feeRefundable: all.shuttle.feeRefundable, note: all.shuttle.note, deadline: iso(T.addMinutes(trip.departAt, -all.shuttle.registerHoursBefore * 60)) },
    bookingRule: { leadHours: all.system.bookingLeadHours, maxSeats: all.system.maxSeatsPerBooking, daysAhead: all.system.bookDaysAhead },
  };
}

/** Seat map (34, 168). Customers see states only, never who booked. */
async function seatMap(id, auth) {
  const trip = await loadTrip(id);
  const admin = auth?.role === 'admin';
  const [seats, seasonal] = await Promise.all([TripSeat.find({ tripId: id }).lean(), pricing.seasonalFor(trip)]);
  let mine = new Set();
  let bookings = new Map();
  if (admin) {
    const ids = [...new Set(seats.map((s) => s.bookingId).filter(Boolean))];
    bookings = new Map((await Booking.find({ _id: { $in: ids } }).lean()).map((b) => [b._id, b]));
  } else if (auth) {
    const own = await Booking.find({ tripId: id, customerAccountId: auth.accountId, status: { $in: HOLDING } }).select('_id').lean();
    const ownIds = new Set(own.map((b) => b._id));
    mine = new Set(seats.filter((s) => s.bookingId && ownIds.has(s.bookingId)).map((s) => s.seatId));
  }
  const free = seats.filter((s) => s.isSellable && s.state === 'free').length;
  return {
    tripId: id,
    status: saleStatus(trip, free),
    layout: { rows: trip.layout?.rows || 0, cols: trip.layout?.cols || 0, name: trip.layout?.name || '' },
    seats: seats.sort((a, b) => a.row - b.row || a.col - b.col).map((s) => {
      const p = pricing.classPrice(trip, s.seatClass, null, seasonal);
      const out = {
        seatId: s.seatId, label: s.label, row: s.row, col: s.col, seatClass: s.seatClass,
        seatClassName: pricing.CLASS_NAMES[s.seatClass] || s.seatClass,
        seatPrice: p.seatPrice, surcharge: p.surcharge, total: p.seatPrice + p.surcharge,
        state: s.isSellable ? s.state : 'unsellable',
        isMine: mine.has(s.seatId),
      };
      if (admin) {
        const b = s.bookingId ? bookings.get(s.bookingId) : null;
        const bs = b ? (b.seats || []).find((x) => x.id === s.bookingSeatId) : null;
        Object.assign(out, {
          lockReason: s.lockReason, claimedAt: iso(s.claimedAt),
          booking: b ? { id: b._id, code: b.code, status: b.status, source: b.source, passengerName: bs?.passengerName || '', passengerPhone: bs?.passengerPhone || '' } : null,
        });
      }
      return out;
    }),
    counts: { free, pending: seats.filter((s) => s.state === 'pending').length, sold: seats.filter((s) => s.state === 'sold').length, locked: seats.filter((s) => s.isSellable && s.state === 'locked').length },
  };
}

/** Other trips on the same route, nearest in time, with enough free seats (44). */
async function alternatives(id, query = {}) {
  const trip = await loadTrip(id);
  const seatsWanted = Math.max(1, parseInt(query.seats, 10) || 1);
  const around = await Trip.find({
    routeId: trip.routeId, _id: { $ne: id }, status: 'scheduled',
    departAt: { $gt: new Date(), $gte: T.addMinutes(trip.departAt, -3 * 1440), $lte: T.addMinutes(trip.departAt, 3 * 1440) },
  }).lean();
  const items = (await presentMany(around)).filter((t) => t.status === 'open' && t.seats.free >= seatsWanted);
  items.sort((a, b) => Math.abs(new Date(a.departAt) - trip.departAt) - Math.abs(new Date(b.departAt) - trip.departAt));
  return { items: items.slice(0, 6) };
}

// ---------- admin: conflicts ----------

async function findConflicts({ tripId = null, vehicleId, driverId, departAt, durationMinutes }) {
  const sys = await settings.get('system');
  const rest = sys.driverRestMinutes || 0;
  const start = departAt;
  const end = T.addMinutes(departAt, durationMinutes + rest);
  const or = [];
  if (vehicleId) or.push({ vehicleId });
  if (driverId) or.push({ driverId });
  if (!or.length) return [];
  // Any trip that starts before our end and ends after our start (its end = its start + its duration + rest).
  const near = await Trip.find({
    _id: { $ne: tripId }, status: { $ne: 'cancelled' }, $or: or,
    departAt: { $lt: end, $gt: T.addMinutes(start, -(2880 + rest)) },
  }).lean();
  return near.filter((o) => T.addMinutes(o.departAt, (o.durationMinutes || 0) + rest) > start).map((o) => ({
    kind: o.vehicleId && o.vehicleId === vehicleId ? 'vehicle' : 'driver', tripId: o._id, departAt: iso(o.departAt),
  }));
}

async function checkDriver(driverId, date) {
  if (!driverId) return null;
  const d = await StaffMember.findById(driverId).lean();
  if (!d) throw invalid([{ field: 'driverId', code: 'not_found' }]);
  if (d.status !== 'active' || d.kind !== 'limo_driver') return 'driver_unavailable';
  const off = await StaffSchedule.exists({ staffId: driverId, date, kind: 'off' });
  return off ? 'driver_unavailable' : null;
}

async function assertSchedulable({ tripId, vehicleId, driverId, departAt, durationMinutes, date, force, overrideReason }) {
  if (vehicleId) {
    const v = await Vehicle.findById(vehicleId).lean();
    if (!v) throw invalid([{ field: 'vehicleId', code: 'not_found' }]);
    if (v.status !== 'active') throw conflict('vehicle_inactive');
    if (v.type !== 'limo') throw invalid([{ field: 'vehicleId', code: 'shuttle_not_assignable' }]);
  }
  const driverIssue = await checkDriver(driverId, date);
  const conflicts = await findConflicts({ tripId, vehicleId, driverId, departAt, durationMinutes });
  if ((conflicts.length || driverIssue) && !(force && overrideReason)) {
    throw new AppError(409, conflicts.length ? 'schedule_conflict' : driverIssue, { conflicts, hint: 'force_with_reason' });
  }
  return conflicts.length || driverIssue ? overrideReason : null;
}

// ---------- admin: create / update ----------

function readPrices(c, body) {
  const arr = c.arr(body, 'prices', { max: 20 });
  if (!Array.isArray(arr)) return undefined;
  return arr.map((p, i) => ({
    seatClass: c.str(p, 'seatClass', { field: `prices[${i}].seatClass`, required: true, max: 30 }),
    price: c.money(p, 'price', { field: `prices[${i}].price`, required: true }),
  }));
}

function readCapacity(c, body) {
  const o = c.obj(body, 'parcelCapacity');
  if (!o) return o === null ? null : undefined;
  return { maxKg: c.num(o, 'maxKg', { field: 'parcelCapacity.maxKg', required: true, max: 10000 }), maxPieces: c.int(o, 'maxPieces', { field: 'parcelCapacity.maxPieces', required: true, max: 10000 }) };
}

async function seatDocs(tripId, layout) {
  return (layout.seats || []).map((s) => ({
    _id: `${tripId}:${s.id}`, tripId, seatId: s.id, label: s.label, row: s.row, col: s.col, seatClass: s.seatClass || 'standard',
    isSellable: s.isSellable !== false, state: s.isSellable === false ? 'locked' : 'free', bookingId: null, bookingSeatId: null, claimedAt: null, lockReason: s.isSellable === false ? 'not_sellable' : null,
  }));
}

/** Builds and inserts a trip + its seats. Used by the admin form and by series generation. */
async function insertTrip(input, auth) {
  const route = input.route || (await Route.findById(input.routeId).lean());
  const vehicle = input.vehicleId ? await Vehicle.findById(input.vehicleId).lean() : null;
  if (vehicle && vehicle.type === 'shuttle') throw invalid([{ field: 'vehicleId', code: 'shuttle_not_assignable' }]);
  const layoutId = vehicle?.layoutId || input.layoutId;
  const layout = layoutId ? await SeatLayout.findById(layoutId).lean() : null;
  if (!layout) throw invalid([{ field: input.vehicleId ? 'vehicleId' : 'layoutId', code: 'layout_required' }]);
  const sys = await settings.get('system');
  const checklist = (await models.ChecklistItem.find({ isActive: true }).sort({ sortOrder: 1 }).lean()).map((i) => ({ itemId: i._id, title: i.title, isDone: false, doneBy: null, doneAt: null }));
  const departAt = T.localToUtc(input.date, input.departTime);
  const now = new Date();
  const capacity = input.parcelCapacity !== undefined ? input.parcelCapacity : vehicle?.parcelMaxKg ? { maxKg: vehicle.parcelMaxKg, maxPieces: vehicle.parcelMaxPieces || 0 } : null;
  const trip = {
    _id: uuid(), routeId: route._id, vehicleId: vehicle?._id || null, driverId: input.driverId || vehicle?.defaultDriverId || null,
    departAt, date: input.date, departTime: input.departTime, durationMinutes: route.durationMinutes, status: 'scheduled', salesClosed: false,
    salesOpenAt: input.salesOpenAt || T.addMinutes(departAt, -sys.bookDaysAhead * 1440),
    salesCloseAt: input.salesCloseAt || T.addMinutes(departAt, -sys.bookingLeadHours * 60),
    seriesId: input.seriesId || null, basePrice: input.basePrice ?? route.basePrice ?? 0, prices: input.prices || [],
    frontSurcharge: input.frontSurcharge ?? vehicle?.frontSurcharge ?? 0, vipSurcharge: input.vipSurcharge ?? vehicle?.vipSurcharge ?? 0,
    layout: { layoutId: layout._id, name: layout.name, rows: layout.rows, cols: layout.cols },
    seatCount: (layout.seats || []).filter((s) => s.isSellable !== false).length,
    parcelCapacity: capacity, parcelLoad: { kg: 0, pieces: 0 },
    driverPay: input.driverPay ?? 0, checklist, shuttleDuties: [], overrideReason: input.overrideReason || null, note: input.note || '',
    createdAt: now, updatedAt: now,
  };
  await Trip.create(trip);
  await TripSeat.insertMany(await seatDocs(trip._id, layout));
  if (auth) await OrderEvent.create({ _id: uuid(), orderType: 'trip', orderId: trip._id, byAccountId: auth.accountId, byRole: 'admin', kind: 'created', newValue: { departAt: iso(departAt) }, internal: true });
  return trip;
}

async function create(auth, body) {
  const c = new Checker();
  const routeId = c.id(body, 'routeId', { required: true });
  const date = c.date(body, 'date', { required: true });
  const departTime = c.time(body, 'departTime', { required: true });
  const vehicleId = c.id(body, 'vehicleId');
  const layoutId = c.id(body, 'layoutId');
  const driverId = c.id(body, 'driverId');
  const basePrice = c.money(body, 'basePrice');
  const frontSurcharge = c.money(body, 'frontSurcharge');
  const vipSurcharge = c.money(body, 'vipSurcharge');
  const prices = readPrices(c, body);
  const salesOpenAt = c.datetime(body, 'salesOpenAt');
  const salesCloseAt = c.datetime(body, 'salesCloseAt');
  const parcelCapacity = readCapacity(c, body);
  const driverPay = c.money(body, 'driverPay');
  const note = c.str(body, 'note', { max: 1000 });
  const force = c.bool(body, 'force', { def: false });
  const overrideReason = c.str(body, 'overrideReason', { max: 300 });
  const rawRepeat = c.arr(body, 'repeatWeekdays', { max: 7 });
  const repeat = Array.isArray(rawRepeat) ? [...new Set(rawRepeat.map((x, i) => c.int({ v: x }, 'v', { field: `repeatWeekdays[${i}]`, max: 6 })))].filter((x) => x !== undefined) : [];
  c.done();
  if (!vehicleId && !layoutId) throw invalid([{ field: 'vehicleId', code: 'required' }]);
  const route = await Route.findById(routeId).lean();
  if (!route) throw invalid([{ field: 'routeId', code: 'not_found' }]);
  const departAt = T.localToUtc(date, departTime);
  const reason = await assertSchedulable({ vehicleId, driverId, departAt, durationMinutes: route.durationMinutes, date, force, overrideReason });
  const base = { route, routeId, departTime, vehicleId, layoutId, driverId, basePrice, frontSurcharge, vipSurcharge, prices, parcelCapacity, driverPay, note };
  const trip = await insertTrip({ ...base, date, salesOpenAt, salesCloseAt, overrideReason: reason }, auth);
  // "Repeat on these weekdays": the same trip on the following 4 weeks; days where the vehicle or driver clash are skipped.
  let repeatedTrips = 0;
  const skipped = [];
  for (let d = T.addDays(date, 1); repeat.length && d <= T.addDays(date, 28); d = T.addDays(d, 1)) {
    if (!repeat.includes(T.weekday(d))) continue;
    try {
      await assertSchedulable({ vehicleId, driverId, departAt: T.localToUtc(d, departTime), durationMinutes: route.durationMinutes, date: d, force: false });
      await insertTrip({ ...base, date: d }, auth);
      repeatedTrips += 1;
    } catch {
      skipped.push(d);
    }
  }
  return { ...(await presentMany([trip], { admin: true }))[0], ...(repeat.length ? { repeatedTrips, skippedDates: skipped } : {}) };
}

/** PATCH /manage/trips/:id: time, prices (new bookings only, 161), sales window, capacity, driver pay, note, salesClosed. */
async function update(auth, id, body) {
  const trip = await loadTrip(id);
  if (['running', 'completed', 'cancelled'].includes(trip.status)) throw conflict('invalid_status');
  const c = new Checker();
  const set = {};
  const date = c.date(body, 'date');
  const departTime = c.time(body, 'departTime');
  const basePrice = c.money(body, 'basePrice');
  const frontSurcharge = c.money(body, 'frontSurcharge');
  const vipSurcharge = c.money(body, 'vipSurcharge');
  const prices = readPrices(c, body);
  const salesOpenAt = c.datetime(body, 'salesOpenAt');
  const salesCloseAt = c.datetime(body, 'salesCloseAt');
  const salesClosed = c.bool(body, 'salesClosed');
  const parcelCapacity = readCapacity(c, body);
  const driverPay = c.money(body, 'driverPay');
  const note = c.str(body, 'note', { max: 1000 });
  const force = c.bool(body, 'force', { def: false });
  const overrideReason = c.str(body, 'overrideReason', { max: 300 });
  c.done();
  let timeChanged = false;
  if (date || departTime) {
    const nd = date || trip.date;
    const nt = departTime || trip.departTime;
    const departAt = T.localToUtc(nd, nt);
    if (departAt.getTime() !== trip.departAt.getTime()) {
      await assertSchedulable({ tripId: id, vehicleId: trip.vehicleId, driverId: trip.driverId, departAt, durationMinutes: trip.durationMinutes, date: nd, force, overrideReason });
      const shift = departAt - trip.departAt;
      Object.assign(set, { date: nd, departTime: nt, departAt, salesCloseAt: new Date(trip.salesCloseAt.getTime() + shift), salesOpenAt: trip.salesOpenAt ? new Date(trip.salesOpenAt.getTime() + shift) : null });
      timeChanged = true;
    }
  }
  if (basePrice !== undefined) set.basePrice = basePrice;
  if (frontSurcharge !== undefined) set.frontSurcharge = frontSurcharge;
  if (vipSurcharge !== undefined) set.vipSurcharge = vipSurcharge;
  if (prices !== undefined) set.prices = prices;
  if (salesOpenAt !== undefined) set.salesOpenAt = salesOpenAt;
  if (salesCloseAt !== undefined) set.salesCloseAt = salesCloseAt;
  if (salesClosed !== undefined) set.salesClosed = salesClosed;
  if (parcelCapacity !== undefined) set.parcelCapacity = parcelCapacity;
  if (driverPay !== undefined) set.driverPay = driverPay;
  if (note !== undefined) set.note = note || '';
  set.updatedAt = new Date();
  await Trip.updateOne({ _id: id }, { $set: set });
  if (timeChanged) {
    await Booking.updateMany({ tripId: id }, { $set: { departAt: set.departAt } });
    await Parcel.updateMany({ tripId: id }, { $set: { departAt: set.departAt } });
    // Shuttle planned times move with the trip.
    const shift = set.departAt - trip.departAt;
    const rows = await Booking.find({ tripId: id, $or: [{ pickupShuttle: { $ne: null } }, { dropShuttle: { $ne: null } }] }).lean();
    for (const b of rows) {
      const u = {};
      if (b.pickupShuttle) u['pickupShuttle.plannedAt'] = new Date(new Date(b.pickupShuttle.plannedAt).getTime() + shift);
      if (b.dropShuttle) u['dropShuttle.plannedAt'] = new Date(new Date(b.dropShuttle.plannedAt).getTime() + shift);
      await Booking.updateOne({ _id: b._id }, { $set: u });
    }
    await OrderEvent.create({ _id: uuid(), orderType: 'trip', orderId: id, byAccountId: auth.accountId, byRole: 'admin', kind: 'time_changed', oldValue: iso(trip.departAt), newValue: iso(set.departAt), internal: true });
    await notify.forTrip(id, 'trip_time_changed', { time: set.departTime, date: set.date });
  }
  return (await presentMany([await loadTrip(id)], { admin: true }))[0];
}

/** PUT /manage/trips/:id/driver { driverId, force?, overrideReason? } (200). */
async function setDriver(auth, id, body) {
  const trip = await loadTrip(id);
  const c = new Checker();
  const driverId = c.id(body, 'driverId');
  const force = c.bool(body, 'force', { def: false });
  const overrideReason = c.str(body, 'overrideReason', { max: 300 });
  c.done();
  const reason = driverId ? await assertSchedulable({ tripId: id, driverId, departAt: trip.departAt, durationMinutes: trip.durationMinutes, date: trip.date, force, overrideReason }) : null;
  await Trip.updateOne({ _id: id }, { $set: { driverId: driverId || null, overrideReason: reason || trip.overrideReason, updatedAt: new Date() } });
  await OrderEvent.create({ _id: uuid(), orderType: 'trip', orderId: id, byAccountId: auth.accountId, byRole: 'admin', kind: 'driver_changed', oldValue: trip.driverId, newValue: driverId || null, note: reason || '', internal: true });
  return (await presentMany([await loadTrip(id)], { admin: true }))[0];
}

/**
 * PUT /manage/trips/:id/vehicle { vehicleId, force?, overrideReason? } (166). Only a vehicle with the same seat layout; seats held by
 * bookings must exist (same seat id) in the new layout; otherwise 409 seats_mismatch with the missing seats.
 */
async function setVehicle(auth, id, body) {
  const trip = await loadTrip(id);
  if (['running', 'completed', 'cancelled'].includes(trip.status)) throw conflict('invalid_status');
  const c = new Checker();
  const vehicleId = c.id(body, 'vehicleId', { required: true });
  const force = c.bool(body, 'force', { def: false });
  const overrideReason = c.str(body, 'overrideReason', { max: 300 });
  c.done();
  const reason = await assertSchedulable({ tripId: id, vehicleId, departAt: trip.departAt, durationMinutes: trip.durationMinutes, date: trip.date, force, overrideReason });
  const vehicle = await Vehicle.findById(vehicleId).lean();
  if (vehicle.type !== 'limo') throw invalid([{ field: 'vehicleId', code: 'shuttle_not_assignable' }]);
  const layout = await SeatLayout.findById(vehicle.layoutId).lean();
  // Only a vehicle with the same seat layout (label, row, column, class, sellable) can take over a trip.
  const sig = (x) => `${x.row}:${x.col}:${x.seatClass || 'standard'}:${x.isSellable !== false}`;
  const current = await TripSeat.find({ tripId: id }).lean();
  const have = new Map(current.map((x) => [x.seatId, x]));
  const mismatch = [];
  for (const st of layout?.seats || []) {
    const cur = have.get(st.id);
    if (!cur || cur.label !== st.label || sig(cur) !== sig(st)) mismatch.push(st.id);
  }
  for (const cur of current) if (!(layout?.seats || []).some((x) => x.id === cur.seatId)) mismatch.push(cur.seatId);
  if (mismatch.length) throw conflict('seats_mismatch', { missingSeats: [...new Set(mismatch)] });
  await Trip.updateOne({ _id: id }, {
    $set: {
      vehicleId, overrideReason: reason || trip.overrideReason, updatedAt: new Date(),
      ...(trip.parcelCapacity ? {} : vehicle.parcelMaxKg ? { parcelCapacity: { maxKg: vehicle.parcelMaxKg, maxPieces: vehicle.parcelMaxPieces || 0 } } : {}),
    },
  });
  await OrderEvent.create({ _id: uuid(), orderType: 'trip', orderId: id, byAccountId: auth.accountId, byRole: 'admin', kind: 'vehicle_changed', oldValue: trip.vehicleId, newValue: vehicleId, note: reason || '', internal: true });
  if (trip.vehicleId && trip.vehicleId !== vehicleId) {
    const rows = await Booking.find({ tripId: id, status: { $in: HOLDING }, customerAccountId: { $ne: null } }).lean();
    const p = await notify.tripParams(trip);
    for (const b of rows) await notify.push(b.customerAccountId, 'trip', 'vehicle_changed', { refType: 'booking', refId: b._id, params: { ...p, seats: b.seats.map((s) => s.label).join(', ') } });
  }
  return (await presentMany([await loadTrip(id)], { admin: true }))[0];
}

/** POST /manage/trips/:id/status { status: scheduled|running|completed } (163). */
async function setStatus(auth, id, body) {
  const trip = await loadTrip(id);
  const c = new Checker();
  const status = c.oneOf(body, 'status', ['scheduled', 'running', 'completed'], { required: true });
  c.done();
  const allowed = { scheduled: ['running'], running: ['scheduled', 'completed'], completed: [], cancelled: [] };
  if (trip.status === 'running' && status === 'scheduled') { /* allowed: undo a wrong departure */ }
  if (trip.status === status) return (await presentMany([trip], { admin: true }))[0];
  if (!allowed[trip.status].includes(status) && !(trip.status === 'scheduled' && status === 'completed')) throw conflict('invalid_status');
  const set = { status, updatedAt: new Date() };
  if (status === 'running' && !trip.actualDepartAt) set.actualDepartAt = new Date();
  if (status === 'completed') {
    set.completedAt = new Date();
    if (!trip.actualArriveAt) set.actualArriveAt = new Date();
  }
  await Trip.updateOne({ _id: id }, { $set: set });
  if (status === 'completed') await require('./bookings').completeTrip(auth, { ...trip, ...set });
  await OrderEvent.create({ _id: uuid(), orderType: 'trip', orderId: id, byAccountId: auth.accountId, byRole: 'admin', kind: 'status', oldValue: trip.status, newValue: status, internal: true });
  return (await presentMany([await loadTrip(id)], { admin: true }))[0];
}

/** POST /manage/trips/:id/cancel { reason, moveToTripId? } (164, 165). */
async function cancel(auth, id, body) {
  const trip = await loadTrip(id);
  if (['completed', 'cancelled'].includes(trip.status)) throw conflict('invalid_status');
  const c = new Checker();
  const reason = c.str(body, 'reason', { required: true, max: 500 });
  const moveToTripId = c.id(body, 'moveToTripId');
  c.done();
  const bookings = require('./bookings');
  let moved = 0;
  if (moveToTripId) moved = (await movePassengers(auth, id, { toTripId: moveToTripId, reason })).moved.length;
  await Trip.updateOne({ _id: id }, { $set: { status: 'cancelled', cancelReason: reason, salesClosed: true, updatedAt: new Date() } });
  await notify.forTrip(id, 'trip_cancelled', { reason });
  const rows = await Booking.find({ tripId: id, status: { $in: ACTIVE } }).lean();
  let cancelled = 0;
  for (const b of rows) {
    await bookings.cancelBooking(auth, b, { reason: 'trip_cancelled', note: reason, fullRefund: true, silent: true });
    cancelled += 1;
  }
  // Parcels on this trip go back to "accepted" without a trip, to be put on another trip.
  const parcels = await Parcel.find({ tripId: id, status: { $in: ['accepted', 'received'] } }).lean();
  for (const p of parcels) await require('./parcels').detachFromTrip(auth, p, reason);
  await TripSeat.updateMany({ tripId: id, state: { $in: ['free', 'pending', 'sold'] } }, { $set: { state: 'locked', lockReason: 'trip_cancelled' } });
  await OrderEvent.create({ _id: uuid(), orderType: 'trip', orderId: id, byAccountId: auth.accountId, byRole: 'admin', kind: 'cancelled', note: reason, internal: true });
  return { trip: (await presentMany([await loadTrip(id)], { admin: true }))[0], cancelledBookings: cancelled, movedBookings: moved, detachedParcels: parcels.length };
}

/** POST /manage/trips/:id/move-passengers { toTripId, bookingIds?, reason } (165). Keeps seat ids when free. */
async function movePassengers(auth, id, body) {
  const c = new Checker();
  const toTripId = c.id(body, 'toTripId', { required: true });
  const ids = c.arr(body, 'bookingIds', { max: 200 });
  const reason = c.str(body, 'reason', { max: 300 }) || '';
  c.done();
  const from = await loadTrip(id);
  const to = await loadTrip(toTripId);
  if (to.routeId !== from.routeId) throw invalid([{ field: 'toTripId', code: 'different_route' }]);
  const filter = { tripId: id, status: { $in: HOLDING.filter((s) => s !== 'completed') } };
  if (Array.isArray(ids)) filter._id = { $in: ids.map(String) };
  const rows = await Booking.find(filter).sort({ proofSubmittedAt: 1, createdAt: 1 }).lean();
  const bookings = require('./bookings');
  const moved = [];
  const failed = [];
  for (const b of rows) {
    try {
      await bookings.moveToTrip(auth, b, to, { reason });
      moved.push(b.code);
    } catch (err) {
      failed.push({ code: b.code, error: err.code || 'error', missing: err.extra?.missing });
    }
  }
  return { moved, failed };
}

// ---------- admin: lists ----------

async function adminList(query) {
  const filter = {};
  const from = T.isDate(query.from) ? query.from : T.today();
  const to = T.isDate(query.to) ? query.to : T.addDays(from, 6);
  filter.date = { $gte: from, $lte: to };
  for (const k of ['routeId', 'vehicleId', 'driverId', 'seriesId']) if (query[k]) filter[k] = String(query[k]);
  if (query.tripStatus) filter.status = String(query.tripStatus);
  if (query.needs === 'vehicle') filter.vehicleId = null;
  if (query.needs === 'driver') filter.driverId = null;
  const rows = await Trip.find(filter).sort({ departAt: 1 }).limit(1000).lean();
  const items = await presentMany(rows, { admin: true });
  // Overlap warnings inside the window (driver or vehicle used by two overlapping trips).
  const sys = await settings.get('system');
  const rest = sys.driverRestMinutes || 0;
  for (const it of items) it.warnings = [];
  const byKey = new Map();
  rows.forEach((t, i) => {
    for (const k of ['vehicleId', 'driverId']) if (t[k]) byKey.set(`${k}:${t[k]}`, [...(byKey.get(`${k}:${t[k]}`) || []), i]);
  });
  for (const [key, idx] of byKey) {
    for (let a = 0; a < idx.length; a += 1) {
      for (let b = a + 1; b < idx.length; b += 1) {
        const A = rows[idx[a]];
        const B = rows[idx[b]];
        if (A.status === 'cancelled' || B.status === 'cancelled') continue;
        const endA = T.addMinutes(A.departAt, A.durationMinutes + rest);
        const endB = T.addMinutes(B.departAt, B.durationMinutes + rest);
        if (A.departAt < endB && B.departAt < endA) {
          const w = key.startsWith('vehicle') ? 'vehicle_conflict' : 'driver_conflict';
          if (!items[idx[a]].warnings.includes(w)) items[idx[a]].warnings.push(w);
          if (!items[idx[b]].warnings.includes(w)) items[idx[b]].warnings.push(w);
        }
      }
    }
  }
  return { from, to, items };
}

async function adminDetail(id) {
  const base = await detail(id, { admin: true });
  const trip = await loadTrip(id);
  const [logs, expenses, bookingsCount, waitCount] = await Promise.all([
    models.TripLog.find({ tripId: id }).sort({ atTime: -1 }).lean(),
    models.TripExpense.find({ tripId: id }).lean(),
    Booking.aggregate([{ $match: { tripId: id } }, { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$paidAmount' } } }]),
    models.Waitlist.countDocuments({ tripId: id, status: 'waiting' }),
  ]);
  const offices = await models.Office.find({ _id: { $in: (trip.shuttleDuties || []).map((d) => d.officeId) } }).lean();
  return {
    ...base,
    checklist: trip.checklist || [],
    shuttleDuties: (trip.shuttleDuties || []).map((d) => ({ ...d, officeName: offices.find((o) => o._id === d.officeId)?.name || '' })),
    logs: logs.map(presentLog),
    expenses: { items: expenses.map((e) => ({ id: e._id, category: e.category, amount: e.amount, note: e.note })), total: expenses.reduce((s, e) => s + e.amount, 0) + (trip.driverPay || 0), driverPay: trip.driverPay || 0 },
    bookingsByStatus: Object.fromEntries(bookingsCount.map((r) => [r._id, r.n])),
    waitlistCount: waitCount,
  };
}

const presentLog = (l) => ({ id: l._id, kind: l.kind, atTime: iso(l.atTime), text: l.text, delayMinutes: l.delayMinutes, visibleToCustomer: l.visibleToCustomer, createdAt: iso(l.createdAt) });

// ---------- admin: seats ----------

/** POST /manage/trips/:id/seats/:seatId/lock { reason } and /unlock (171). */
async function lockSeat(auth, id, seatId, body, lock) {
  await loadTrip(id);
  const c = new Checker();
  const reason = lock ? c.str(body, 'reason', { required: true, max: 200 }) : null;
  c.done();
  const r = lock
    ? await TripSeat.updateOne({ _id: `${id}:${seatId}`, state: 'free', isSellable: true }, { $set: { state: 'locked', lockReason: reason } })
    : await TripSeat.updateOne({ _id: `${id}:${seatId}`, state: 'locked', isSellable: true, bookingId: null }, { $set: { state: 'free', lockReason: null } });
  if (!r.matchedCount) {
    if (!(await TripSeat.exists({ _id: `${id}:${seatId}` }))) throw notFound();
    throw conflict('seat_unavailable');
  }
  await OrderEvent.create({ _id: uuid(), orderType: 'trip', orderId: id, byAccountId: auth.accountId, byRole: 'admin', kind: lock ? 'seat_locked' : 'seat_unlocked', newValue: seatId, note: reason || '', internal: true });
  if (!lock) await require('./social').waitlistSeatFreed(id);
  return seatMap(id, auth);
}

// ---------- admin: suggestions ----------

/** GET /manage/trips/:id/driver-suggestions (201): free drivers first, familiar with the route, fewest hours this week. */
async function driverSuggestions(id) {
  const trip = await loadTrip(id);
  const drivers = await StaffMember.find({ kind: 'limo_driver', status: 'active' }).lean();
  const ws = T.weekStart(trip.date);
  const [weekTrips, routeTrips, offs] = await Promise.all([
    Trip.find({ driverId: { $in: drivers.map((d) => d._id) }, date: { $gte: ws, $lte: T.addDays(ws, 6) }, status: { $ne: 'cancelled' } }).lean(),
    Trip.aggregate([{ $match: { routeId: trip.routeId, driverId: { $in: drivers.map((d) => d._id) }, status: 'completed' } }, { $group: { _id: '$driverId', n: { $sum: 1 } } }]),
    StaffSchedule.find({ staffId: { $in: drivers.map((d) => d._id) }, date: trip.date, kind: 'off' }).lean(),
  ]);
  const fam = new Map(routeTrips.map((r) => [r._id, r.n]));
  const off = new Set(offs.map((o) => o.staffId));
  const out = [];
  for (const d of drivers) {
    const conflicts = await findConflicts({ tripId: id, driverId: d._id, departAt: trip.departAt, durationMinutes: trip.durationMinutes });
    const minutes = weekTrips.filter((t) => t.driverId === d._id).reduce((s, t) => s + (t.durationMinutes || 0), 0);
    out.push({
      driverId: d._id, name: d.name, phone: d.phone || '', available: !conflicts.length && !off.has(d._id), isOff: off.has(d._id),
      conflicts: conflicts.length, weekDrivingMinutes: minutes, tripsOnRoute: fam.get(d._id) || 0, licenseExpiresOn: d.licenseExpiresOn || null,
      isCurrent: trip.driverId === d._id,
    });
  }
  out.sort((a, b) => Number(b.available) - Number(a.available) || b.tripsOnRoute - a.tripsOnRoute || a.weekDrivingMinutes - b.weekDrivingMinutes);
  return { items: out };
}

/** GET /manage/trips/merge-suggestions?from&to (167): two low-fill trips on the same route within 2 hours. */
async function mergeSuggestions(query) {
  const from = T.isDate(query.from) ? query.from : T.today();
  const to = T.isDate(query.to) ? query.to : T.addDays(from, 3);
  const sys = await settings.get('system');
  const rows = await Trip.find({ date: { $gte: from, $lte: to }, status: 'scheduled', departAt: { $gt: new Date() } }).sort({ departAt: 1 }).lean();
  const items = await presentMany(rows, { admin: true });
  const low = items.filter((t) => t.fillPercent <= (sys.lowFillPercent || 30));
  const pairs = [];
  for (let i = 0; i < low.length; i += 1) {
    for (let j = i + 1; j < low.length; j += 1) {
      const a = low[i];
      const b = low[j];
      if (a.routeId !== b.routeId) continue;
      const gap = Math.abs(new Date(b.departAt) - new Date(a.departAt)) / 60000;
      if (gap > 120) continue;
      const usedA = a.seats.sold + a.seats.pending;
      const usedB = b.seats.sold + b.seats.pending;
      pairs.push({ tripA: a, tripB: b, gapMinutes: Math.round(gap), combinedPassengers: usedA + usedB, fitsInA: usedA + usedB <= a.seats.total, fitsInB: usedA + usedB <= b.seats.total });
    }
  }
  return { from, to, lowFillPercent: sys.lowFillPercent, items: pairs };
}

// ---------- series (159) ----------

function readSeries(c, body, partial) {
  const o = {};
  const req = !partial;
  const set = (k, v) => { if (v !== undefined) o[k] = v; };
  set('routeId', c.id(body, 'routeId', { required: req }));
  set('vehicleId', c.id(body, 'vehicleId'));
  set('driverId', c.id(body, 'driverId'));
  const wd = c.arr(body, 'weekdays', { required: req, max: 7 });
  if (Array.isArray(wd)) {
    o.weekdays = [...new Set(wd.map((x, i) => c.int({ v: x }, 'v', { field: `weekdays[${i}]`, max: 6 })))].filter((x) => x !== undefined).sort();
    if (!o.weekdays.length) c.fail('weekdays', 'required');
  }
  set('departTime', c.time(body, 'departTime', { required: req }));
  set('startDate', c.date(body, 'startDate', { required: req }));
  if (body?.endDate !== undefined) o.endDate = c.date(body, 'endDate') || null;
  set('basePrice', c.money(body, 'basePrice', { required: req }));
  set('prices', readPrices(c, body));
  set('isActive', c.bool(body, 'isActive'));
  if (body?.note !== undefined) o.note = c.str(body, 'note', { max: 500 }) || '';
  return o;
}

const presentSeries = (s) => ({
  id: s._id, routeId: s.routeId, vehicleId: s.vehicleId, driverId: s.driverId, weekdays: s.weekdays, departTime: s.departTime,
  startDate: s.startDate, endDate: s.endDate, basePrice: s.basePrice, prices: s.prices || [], exceptions: s.exceptions || [],
  generatedUntil: s.generatedUntil, isActive: s.isActive, note: s.note || '', createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
});

/** Creates the series' trips from today up to the window (SERIES_WINDOW_DAYS), never beyond. */
async function generateSeries(series, auth = null) {
  if (!series.isActive) return { created: 0 };
  const route = await Route.findById(series.routeId).lean();
  if (!route) return { created: 0 };
  const start = [series.startDate, T.today()].sort().pop();
  const windowEnd = T.addDays(T.today(), config.seriesWindowDays);
  const end = series.endDate && series.endDate < windowEnd ? series.endDate : windowEnd;
  const existing = new Set((await Trip.find({ seriesId: series._id, date: { $gte: start, $lte: end } }).select('date').lean()).map((t) => t.date));
  let created = 0;
  for (let d = start; d <= end; d = T.addDays(d, 1)) {
    if (!series.weekdays.includes(T.weekday(d)) || existing.has(d)) continue;
    const ex = (series.exceptions || []).find((e) => e.date === d);
    if (ex?.type === 'skip') continue;
    const departTime = ex?.type === 'retime' ? ex.newDepartTime : series.departTime;
    if (T.localToUtc(d, departTime) <= new Date()) continue;
    await insertTrip({ route, routeId: route._id, date: d, departTime, vehicleId: series.vehicleId, layoutId: null, driverId: series.driverId, basePrice: series.basePrice, prices: series.prices, seriesId: series._id }, auth);
    created += 1;
  }
  await TripSeries.updateOne({ _id: series._id }, { $set: { generatedUntil: end } });
  return { created, generatedUntil: end };
}

async function createSeries(auth, body) {
  const c = new Checker();
  const data = readSeries(c, body, false);
  c.done();
  const route = await Route.findById(data.routeId).lean();
  if (!route) throw invalid([{ field: 'routeId', code: 'not_found' }]);
  if (!data.vehicleId) throw invalid([{ field: 'vehicleId', code: 'required' }]);
  if (!(await Vehicle.exists({ _id: data.vehicleId }))) throw invalid([{ field: 'vehicleId', code: 'not_found' }]);
  if (data.driverId && !(await StaffMember.exists({ _id: data.driverId }))) throw invalid([{ field: 'driverId', code: 'not_found' }]);
  if (data.endDate && data.endDate < data.startDate) throw invalid([{ field: 'endDate', code: 'out_of_range' }]);
  const now = new Date();
  const s = { _id: uuid(), isActive: true, exceptions: [], prices: [], note: '', ...data, createdAt: now, updatedAt: now };
  await TripSeries.create(s);
  const gen = await generateSeries(s, auth);
  return { ...presentSeries({ ...s, generatedUntil: gen.generatedUntil }), createdTrips: gen.created };
}

/** Trips of the series in the future that have no booking (safe to change or delete). */
async function freeFutureTrips(seriesId) {
  const rows = await Trip.find({ seriesId, departAt: { $gt: new Date() }, status: 'scheduled' }).lean();
  const busy = new Set(await Booking.distinct('tripId', { tripId: { $in: rows.map((t) => t._id) }, status: { $nin: ['cancelled', 'rejected'] } }));
  const parcelBusy = new Set(await Parcel.distinct('tripId', { tripId: { $in: rows.map((t) => t._id) } }));
  return { free: rows.filter((t) => !busy.has(t._id) && !parcelBusy.has(t._id)), kept: rows.filter((t) => busy.has(t._id) || parcelBusy.has(t._id)) };
}

async function deleteTrips(trips) {
  const ids = trips.map((t) => t._id);
  await TripSeat.deleteMany({ tripId: { $in: ids } });
  await Trip.deleteMany({ _id: { $in: ids } });
}

/** PATCH /manage/series/:id — future trips without bookings are regenerated; trips with bookings are kept as they are. */
async function updateSeries(auth, id, body) {
  const s = await TripSeries.findById(id).lean();
  if (!s) throw notFound();
  const c = new Checker();
  const data = readSeries(c, body, true);
  c.done();
  const merged = { ...s, ...data, updatedAt: new Date() };
  await TripSeries.updateOne({ _id: id }, { $set: { ...data, updatedAt: merged.updatedAt, generatedUntil: null } });
  const { free, kept } = await freeFutureTrips(id);
  await deleteTrips(free);
  const gen = await generateSeries({ ...merged, generatedUntil: null }, auth);
  return { ...presentSeries({ ...merged, generatedUntil: gen.generatedUntil }), regeneratedTrips: gen.created, keptTripsWithBookings: kept.map((t) => ({ id: t._id, date: t.date, departTime: t.departTime })) };
}

async function deleteSeries(auth, id) {
  const s = await TripSeries.findById(id).lean();
  if (!s) throw notFound();
  const { free, kept } = await freeFutureTrips(id);
  await deleteTrips(free);
  await TripSeries.deleteOne({ _id: id });
  return { deletedTrips: free.length, keptTripsWithBookings: kept.map((t) => ({ id: t._id, date: t.date, departTime: t.departTime })) };
}

/** POST /manage/series/:id/exceptions { date, type: skip|retime, newDepartTime?, note? } — a one-off day off or time change. */
async function addException(auth, id, body) {
  const s = await TripSeries.findById(id).lean();
  if (!s) throw notFound();
  const c = new Checker();
  const date = c.date(body, 'date', { required: true });
  const type = c.oneOf(body, 'type', ['skip', 'retime'], { required: true });
  const newDepartTime = type === 'retime' ? c.time(body, 'newDepartTime', { required: true }) : null;
  const note = c.str(body, 'note', { max: 300 }) || '';
  c.done();
  const trip = await Trip.findOne({ seriesId: id, date }).lean();
  if (trip) {
    const hasOrders = await Booking.exists({ tripId: trip._id, status: { $nin: ['cancelled', 'rejected'] } });
    if (hasOrders) throw conflict('trip_has_bookings', { tripId: trip._id });
    if (type === 'skip') await deleteTrips([trip]);
    else await update(auth, trip._id, { departTime: newDepartTime, force: true, overrideReason: note || 'series exception' });
  }
  const exceptions = [...(s.exceptions || []).filter((e) => e.date !== date), { date, type, newDepartTime, note }].sort((a, b) => a.date.localeCompare(b.date));
  await TripSeries.updateOne({ _id: id }, { $set: { exceptions, updatedAt: new Date() } });
  return presentSeries({ ...s, exceptions });
}

async function listSeries(query) {
  const filter = {};
  if (query.routeId) filter.routeId = String(query.routeId);
  if (query.isActive) filter.isActive = query.isActive === 'true';
  return { items: (await TripSeries.find(filter).sort({ createdAt: -1 }).lean()).map(presentSeries) };
}

async function getSeries(id) {
  const s = await TripSeries.findById(id).lean();
  if (!s) throw notFound();
  return presentSeries(s);
}

/** Daily job: keep every active series generated up to the window. */
async function extendAllSeries() {
  const rows = await TripSeries.find({ isActive: true }).lean();
  let created = 0;
  for (const s of rows) created += (await generateSeries(s)).created;
  return { series: rows.length, created };
}

/** Trip delete: only when nothing was ever booked on it. */
async function remove(auth, id) {
  const trip = await loadTrip(id);
  if (await Booking.exists({ tripId: id, status: { $nin: ['cancelled', 'rejected'] } })) throw conflict('trip_has_bookings');
  if (await Parcel.exists({ tripId: id })) throw conflict('trip_has_bookings');
  await deleteTrips([trip]);
  await Review.deleteMany({ tripId: id });
}

module.exports = {
  HOLDING, ACTIVE, seatStats, saleStatus, presentMany, loadTrip, search, detail, seatMap, alternatives,
  findConflicts, create, update, setDriver, setVehicle, setStatus, cancel, movePassengers, adminList, adminDetail, presentLog,
  lockSeat, driverSuggestions, mergeSuggestions, createSeries, updateSeries, deleteSeries, addException, listSeries, getSeries,
  generateSeries, extendAllSeries, remove, insertTrip,
};

