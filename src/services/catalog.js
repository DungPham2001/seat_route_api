/**
 * Read-only data for signed-in customers: operator profile (31, 32), provinces with trips (28, 219), offices by
 * province (16, 36), shuttle zones (37), banks, FAQ and content pages (2, 107, 109), useful route info (33).
 */
const models = require('../models');
const { notFound } = require('../lib/errors');
const { iso } = require('../lib/util');
const settings = require('./settings');
const { BANKS } = require('../lib/banks');

const { Province, Office, Route, ShuttleZone, Trip, Review, FaqItem, Announcement } = models;

const presentOffice = (o) => ({ id: o._id, provinceId: o.provinceId, name: o.name, address: o.address, phone: o.phone || '', openText: o.openText || '', directionNote: o.directionNote || '', isActive: o.isActive });

/** Average stars and completed trips, computed from real data (32). */
async function operatorRating() {
  const [r, trips] = await Promise.all([
    Review.aggregate([{ $match: { status: 'visible' } }, { $group: { _id: null, avg: { $avg: '$stars' }, n: { $sum: 1 } } }]),
    Trip.countDocuments({ status: 'completed' }),
  ]);
  return { rating: r[0] ? Math.round(r[0].avg * 10) / 10 : null, reviewCount: r[0]?.n || 0, completedTrips: trips };
}

async function officesByProvince(filter = { isActive: true }) {
  const [provinces, offices] = await Promise.all([Province.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean(), Office.find(filter).sort({ sortOrder: 1, name: 1 }).lean()]);
  return provinces.map((p) => ({ provinceId: p._id, provinceName: p.name, offices: offices.filter((o) => o.provinceId === p._id).map(presentOffice) })).filter((g) => g.offices.length);
}

/** GET /v1/operator (31). */
async function operator() {
  const all = await settings.all();
  return {
    profile: { ...all.operator },
    ...(await operatorRating()),
    offices: await officesByProvince(),
    rules: all.rules.items,
    cancelPolicy: { tiers: all.cancelPolicy.tiers, cancelFee: all.cancelPolicy.cancelFee, changeAllowedHoursBefore: all.cancelPolicy.changeAllowedHoursBefore, changeFee: all.cancelPolicy.changeFee, note: all.cancelPolicy.note },
    childRule: all.child,
    shuttleRule: all.shuttle,
    parcel: { enabled: all.parcel.enabled, compensationText: all.parcel.compensationText, claimDays: all.parcel.claimDays },
  };
}

/** Routes with an upcoming trip on sale. */
async function liveRoutes() {
  const ids = await Trip.distinct('routeId', { status: 'scheduled', departAt: { $gt: new Date() }, salesClosed: false });
  return Route.find({ _id: { $in: ids }, status: 'active' }).lean();
}

/**
 * GET /v1/provinces?hasTrips=true&side=from|to&fromProvinceId= (28, 219): with `hasTrips`, only provinces that are
 * the start (side=from) or the end (side=to, optionally reachable from fromProvinceId) of a route with trips on sale.
 */
async function provinces(query) {
  let ids = null;
  if (query.hasTrips === 'true') {
    const routes = await liveRoutes();
    const side = query.side === 'to' ? 'to' : query.side === 'from' ? 'from' : null;
    const pick = routes.filter((r) => !query.fromProvinceId || r.fromProvinceId === query.fromProvinceId);
    ids = new Set(side === 'from' ? pick.map((r) => r.fromProvinceId) : side === 'to' ? pick.map((r) => r.toProvinceId) : pick.flatMap((r) => [r.fromProvinceId, r.toProvinceId]));
  }
  const rows = await Province.find({ isActive: true, ...(ids ? { _id: { $in: [...ids] } } : {}) }).sort({ sortOrder: 1, name: 1 }).lean();
  return { items: rows.map((p) => ({ id: p._id, name: p.name, nameNoAccent: p.nameNoAccent, sortOrder: p.sortOrder })) };
}

/** GET /v1/routes/available — pairs from/to that have trips on sale (suggestions on the route picker, 28). */
async function availableRoutes() {
  const routes = await liveRoutes();
  const pv = new Map((await Province.find({ _id: { $in: routes.flatMap((r) => [r.fromProvinceId, r.toProvinceId]) } }).lean()).map((p) => [p._id, p.name]));
  return { items: routes.map((r) => ({ routeId: r._id, name: r.name, fromProvinceId: r.fromProvinceId, fromProvinceName: pv.get(r.fromProvinceId) || '', toProvinceId: r.toProvinceId, toProvinceName: pv.get(r.toProvinceId) || '', durationMinutes: r.durationMinutes, parcelEnabled: !!r.parcelEnabled })) };
}

/** GET /v1/provinces/:id/offices?routeId&side (36). */
async function provinceOffices(provinceId, query) {
  const rows = await Office.find({ provinceId, isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
  if (!query.routeId) return { items: rows.map(presentOffice) };
  const route = await Route.findById(query.routeId).lean();
  if (!route) throw notFound();
  const side = query.side === 'drop' ? 'drop' : query.side === 'pickup' ? 'pickup' : null;
  const stops = route.offices.filter((o) => !side || o.side === side);
  return {
    items: rows.filter((o) => stops.some((s) => s.officeId === o._id)).map((o) => {
      const s = stops.find((x) => x.officeId === o._id);
      return { ...presentOffice(o), side: s.side, offsetMinutes: s.offsetMinutes };
    }),
  };
}

/** GET /v1/offices — all open offices grouped by province (16). */
async function allOffices() {
  return { groups: await officesByProvince() };
}

/** GET /v1/offices/:id/shuttle-zones?direction=pickup|drop (37). */
async function shuttleZones(officeId, query) {
  const office = await Office.findById(officeId).lean();
  if (!office) throw notFound();
  const filter = { officeId, isActive: true };
  if (query.direction === 'pickup') filter.pickupEnabled = true;
  if (query.direction === 'drop') filter.dropEnabled = true;
  const rows = await ShuttleZone.find(filter).sort({ name: 1 }).lean();
  const rule = await settings.get('shuttle');
  return {
    office: presentOffice(office),
    rule: { registerHoursBefore: rule.registerHoursBefore, feeRefundable: rule.feeRefundable, note: rule.note },
    items: rows.map((z) => ({ id: z._id, name: z.name, pickupEnabled: z.pickupEnabled, dropEnabled: z.dropEnabled, fee: z.fee, leadMinutes: z.leadMinutes, dropMinutes: z.dropMinutes, note: z.note || '' })),
  };
}

const banks = () => ({ items: BANKS });

async function faq(lang) {
  const rows = await FaqItem.find({ language: lang, isActive: true }).sort({ category: 1, sortOrder: 1 }).lean();
  return { items: rows.map((f) => ({ id: f._id, category: f.category, question: f.question, answer: f.answer })) };
}

const CONTENT_KEYS = { terms: 'terms', privacy: 'privacy', help: 'help', about: 'about' };

/** GET /v1/content/:key (terms | privacy | help | about) in the request language, falls back to the other one. */
async function content(key, lang) {
  if (!CONTENT_KEYS[key]) throw notFound();
  const c = await settings.get('content');
  const vi = c[`${key}Vi`];
  const en = c[`${key}En`];
  return { key, language: lang, text: (lang === 'en' ? en || vi : vi || en) || '', updatedAt: c.updatedAt };
}

/** Published announcements running now (15, 238). */
async function announcements({ limit = 10 } = {}) {
  const now = new Date();
  const rows = await Announcement.find({ isPublished: true, $and: [{ $or: [{ startAt: null }, { startAt: { $lte: now } }] }, { $or: [{ endAt: null }, { endAt: { $gte: now } }] }] }).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((a) => ({ id: a._id, title: a.title, body: a.body, kind: a.kind, routeId: a.routeId, startAt: iso(a.startAt), endAt: iso(a.endAt), createdAt: iso(a.createdAt) }));
}

/** GET /v1/routes/:id/info (33): offices, rules, useful notes shown before the trip. */
async function routeInfo(id) {
  const route = await Route.findById(id).lean();
  if (!route) throw notFound();
  const ex = await require('./routes').expand(route, null);
  const rules = await settings.get('rules');
  const stats = (await require('./routes').durationStats([id])).get(id) || null;
  return { ...ex, rules: rules.items, actualDuration: stats, announcements: (await announcements({ limit: 20 })).filter((a) => !a.routeId || a.routeId === id) };
}

module.exports = { operator, operatorRating, provinces, availableRoutes, provinceOffices, allOffices, shuttleZones, banks, faq, content, announcements, routeInfo, presentOffice, officesByProvince };
