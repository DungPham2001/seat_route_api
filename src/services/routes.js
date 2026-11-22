/**
 * Routes (210-218): a route has a direction (Hà Nội -> Thái Bình and back are two routes), pickup offices in the
 * departure province and drop offices in the arrival province, each with an offset (minutes after departure).
 */
const { Route, Office, Province, Trip } = require('../models');
const { invalid, notFound } = require('../lib/errors');
const { uuid, noAccent, iso } = require('../lib/util');
const { addMinutes, toLocal } = require('../lib/time');

/** Resource validation hook (defs.js). */
async function validateRoute(d, ctx) {
  const from = d.fromProvinceId ?? ctx.existing?.fromProvinceId;
  const to = d.toProvinceId ?? ctx.existing?.toProvinceId;
  if (from && to && from === to) throw invalid([{ field: 'toProvinceId', code: 'same_as_from' }]);
  const offices = d.offices ?? ctx.existing?.offices ?? [];
  if (d.offices || d.fromProvinceId || d.toProvinceId) {
    const docs = await Office.find({ _id: { $in: offices.map((o) => o.officeId) } }).lean();
    const byId = new Map(docs.map((o) => [o._id, o]));
    const bad = [];
    const seen = new Set();
    offices.forEach((o, i) => {
      const office = byId.get(o.officeId);
      if (!office) return;
      if (o.side === 'pickup' && office.provinceId !== from) bad.push({ field: `offices[${i}].officeId`, code: 'wrong_province' });
      if (o.side === 'drop' && office.provinceId !== to) bad.push({ field: `offices[${i}].officeId`, code: 'wrong_province' });
      const k = `${o.side}:${o.officeId}`;
      if (seen.has(k)) bad.push({ field: `offices[${i}].officeId`, code: 'duplicate' });
      seen.add(k);
    });
    if (bad.length) throw invalid(bad);
  }
  if (d.name === null && ctx.existing) delete d.name; // empty name in a patch keeps the current one
  if (!d.name && !ctx.existing?.name) {
    // Default name "Hà Nội → Thái Bình" when the admin leaves it empty.
    const [pf, pt] = await Promise.all([Province.findById(from).lean(), Province.findById(to).lean()]);
    d.name = `${pf?.name || ''} → ${pt?.name || ''}`;
  }
  if (d.offices) d.offices.sort((a, b) => (a.side === b.side ? a.sortOrder - b.sortOrder || a.offsetMinutes - b.offsetMinutes : a.side === 'pickup' ? -1 : 1));
  if (d.stops) d.stops.sort((a, b) => a.sortOrder - b.sortOrder || a.offsetMinutes - b.offsetMinutes);
}

/** The route between two provinces, created on the fly (no offices, no stops) when a trip is made from "from -> to". */
async function ensure(auth, { fromProvinceId, toProvinceId, durationMinutes, basePrice }) {
  if (fromProvinceId === toProvinceId) throw invalid([{ field: 'toProvinceId', code: 'same_as_from' }]);
  const [pf, pt] = await Promise.all([Province.findById(fromProvinceId).lean(), Province.findById(toProvinceId).lean()]);
  const bad = [];
  if (!pf) bad.push({ field: 'fromProvinceId', code: 'not_found' });
  if (!pt) bad.push({ field: 'toProvinceId', code: 'not_found' });
  if (bad.length) throw invalid(bad);
  const found = await Route.findOne({ fromProvinceId, toProvinceId }).lean();
  if (found) return found;
  const now = new Date();
  const doc = {
    _id: uuid(), name: `${pf.name} → ${pt.name}`, fromProvinceId, toProvinceId, durationMinutes: durationMinutes || 180, status: 'active', basePrice: basePrice || 0,
    stops: [], offices: [], shuttleEnabled: false, parcelEnabled: true, usefulInfo: '', note: '', search: noAccent(`${pf.name} ${pt.name}`),
    createdBy: auth?.accountId || null, createdAt: now, updatedAt: now,
  };
  await Route.create(doc);
  return doc;
}

/** POST /manage/routes/:id/duplicate { reverse } (216). Reverse swaps provinces and pickup/drop offices. */
async function duplicate(auth, id, body) {
  const r = await Route.findById(id).lean();
  if (!r) throw notFound();
  const reverse = body?.reverse === true;
  const now = new Date();
  const doc = { ...r, _id: uuid(), createdAt: now, updatedAt: now, createdBy: auth.accountId, status: 'paused' };
  if (reverse) {
    const [pf, pt] = await Promise.all([Province.findById(r.toProvinceId).lean(), Province.findById(r.fromProvinceId).lean()]);
    doc.fromProvinceId = r.toProvinceId;
    doc.toProvinceId = r.fromProvinceId;
    doc.name = `${pf?.name || ''} → ${pt?.name || ''}`;
    // Drop offices become pickup offices; offsets mirrored on the trip duration.
    const pick = r.offices.filter((o) => o.side === 'drop').map((o, i) => ({ ...o, side: 'pickup', offsetMinutes: Math.max(0, r.durationMinutes - o.offsetMinutes), sortOrder: i }));
    const drop = r.offices.filter((o) => o.side === 'pickup').map((o, i) => ({ ...o, side: 'drop', offsetMinutes: Math.max(0, r.durationMinutes - o.offsetMinutes), sortOrder: i }));
    pick.sort((a, b) => a.offsetMinutes - b.offsetMinutes);
    drop.sort((a, b) => a.offsetMinutes - b.offsetMinutes);
    doc.offices = [...pick.map((o, i) => ({ ...o, sortOrder: i })), ...drop.map((o, i) => ({ ...o, sortOrder: i }))];
    doc.stops = [...(r.stops || [])].reverse().map((s, i) => ({ ...s, sortOrder: i, offsetMinutes: Math.max(0, r.durationMinutes - s.offsetMinutes) }));
  } else {
    doc.name = `${r.name} (bản sao)`;
  }
  doc.search = noAccent(doc.name);
  await Route.create(doc);
  return require('../resources/defs').resources.routes.present(doc);
}

/** Office of a route + the local time the bus reaches it for a given departure. */
function officeStop(route, officeId, side) {
  return (route?.offices || []).find((o) => o.officeId === officeId && o.side === side) || null;
}
const officeTime = (departAt, stop) => (stop ? addMinutes(departAt, stop.offsetMinutes || 0) : null);

/** Route with province names and office details, for trip pages. */
async function expand(route, departAt) {
  const ids = (route.offices || []).map((o) => o.officeId);
  const [offices, provinces] = await Promise.all([
    Office.find({ _id: { $in: ids } }).lean(),
    Province.find({ _id: { $in: [route.fromProvinceId, route.toProvinceId] } }).lean(),
  ]);
  const ob = new Map(offices.map((o) => [o._id, o]));
  const pb = new Map(provinces.map((p) => [p._id, p]));
  const stopOut = (o) => {
    const office = ob.get(o.officeId);
    const at = departAt ? officeTime(departAt, o) : null;
    return {
      officeId: o.officeId, name: office?.name || '', address: office?.address || '', phone: office?.phone || '', openText: office?.openText || '',
      directionNote: office?.directionNote || '', isActive: office ? office.isActive : false, offsetMinutes: o.offsetMinutes, sortOrder: o.sortOrder,
      arriveAt: iso(at), arriveTime: at ? toLocal(at).time : null,
    };
  };
  return {
    id: route._id,
    name: route.name,
    from: { id: route.fromProvinceId, name: pb.get(route.fromProvinceId)?.name || '' },
    to: { id: route.toProvinceId, name: pb.get(route.toProvinceId)?.name || '' },
    durationMinutes: route.durationMinutes,
    shuttleEnabled: route.shuttleEnabled !== false,
    parcelEnabled: !!route.parcelEnabled,
    usefulInfo: route.usefulInfo || '',
    stops: (route.stops || []).map((s) => ({ name: s.name, offsetMinutes: s.offsetMinutes, arriveTime: departAt ? toLocal(addMinutes(departAt, s.offsetMinutes)).time : null })),
    pickupOffices: (route.offices || []).filter((o) => o.side === 'pickup' && ob.get(o.officeId)?.isActive !== false).map(stopOut),
    dropOffices: (route.offices || []).filter((o) => o.side === 'drop' && ob.get(o.officeId)?.isActive !== false).map(stopOut),
  };
}

/** Actual vs planned duration per route (218), from recorded departure/arrival times. */
async function durationStats(routeIds) {
  const rows = await Trip.aggregate([
    { $match: { routeId: { $in: routeIds }, actualDepartAt: { $ne: null }, actualArriveAt: { $ne: null } } },
    { $project: { routeId: 1, m: { $divide: [{ $subtract: ['$actualArriveAt', '$actualDepartAt'] }, 60000] }, delay: { $divide: [{ $subtract: ['$actualDepartAt', '$departAt'] }, 60000] } } },
    { $group: { _id: '$routeId', avgMinutes: { $avg: '$m' }, avgDepartDelay: { $avg: '$delay' }, trips: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, { avgActualMinutes: Math.round(r.avgMinutes), avgDepartDelayMinutes: Math.round(r.avgDepartDelay), sampleTrips: r.trips }]));
}

module.exports = { ensure, validateRoute, duplicate, officeStop, officeTime, expand, durationStats };
