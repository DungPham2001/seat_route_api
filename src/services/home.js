/**
 * GET /v1/home — everything the customer Home tab shows in one call (9-19): greeting, upcoming trip with
 * countdown, "to do now" cards, shortcuts, services, promotions, operator news, trips waiting for a review,
 * suggestions from habits, unread count, server time.
 */
const models = require('../models');
const settings = require('./settings');
const notify = require('./notify');
const bookings = require('./bookings');
const T = require('../lib/time');
const { iso } = require('../lib/util');

const { Booking, Parcel, Route, Province, Favorite, Trip, Review } = models;

async function home(auth) {
  await bookings.expireOverdue();
  await notify.ensureReminders(auth.accountId);
  const now = new Date();
  const me = auth.accountId;
  const [op, parcelCfg] = await Promise.all([settings.get('operator'), settings.get('parcel')]);

  const [upcomingRow, todoRows, recent, favorites, parcelRows, done] = await Promise.all([
    Booking.findOne({ customerAccountId: me, status: { $in: ['confirmed', 'pending_review', 'info_requested'] }, departAt: { $gt: now } }).sort({ departAt: 1 }).lean(),
    Booking.find({ customerAccountId: me, status: { $in: ['awaiting_payment', 'rejected', 'info_requested', 'seat_lost'] }, departAt: { $gt: now } }).sort({ createdAt: -1 }).limit(10).lean(),
    Booking.find({ customerAccountId: me }).sort({ createdAt: -1 }).limit(20).select('routeId pickupOfficeId dropOfficeId').lean(),
    Favorite.find({ accountId: me }).lean(),
    Parcel.find({ senderAccountId: me, status: { $in: ['pending', 'accepted', 'received', 'loaded', 'arrived'] } }).sort({ createdAt: -1 }).limit(5).lean(),
    Booking.find({ customerAccountId: me, status: 'completed', completedAt: { $gte: T.addMinutes(now, -30 * 1440) } }).sort({ completedAt: -1 }).limit(5).lean(),
  ]);

  const [upcoming] = upcomingRow ? await bookings.presentMany([upcomingRow]) : [null];
  const todo = [];
  for (const b of await bookings.presentMany(todoRows)) {
    const kind = { awaiting_payment: 'upload_proof', rejected: 'resubmit_proof', info_requested: 'info_requested', seat_lost: 'seat_lost' }[b.status];
    todo.push({ kind, bookingId: b.id, code: b.code, status: b.status, deadline: b.payDeadline, deadlineSeconds: b.payDeadlineSeconds, trip: b.trip, totalAmount: b.totalAmount, lostSeats: b.lostSeats });
  }
  const parcels = await require('./parcels').presentMany(parcelRows);
  for (const p of parcels) {
    if (p.actions.uploadProof) todo.push({ kind: 'parcel_payment', parcelId: p.id, code: p.code, fee: p.fee });
    if (p.unclaimed) todo.push({ kind: 'parcel_unclaimed', parcelId: p.id, code: p.code, office: p.toOffice.name });
  }

  // Shortcuts: last routes (distinct) and favourites (12).
  const routeIds = [...new Set(recent.map((b) => b.routeId))].slice(0, 5);
  const routes = await Route.find({ _id: { $in: routeIds } }).lean();
  const provIds = [...routes.flatMap((r) => [r.fromProvinceId, r.toProvinceId]), ...favorites.flatMap((f) => [f.fromProvinceId, f.toProvinceId]).filter(Boolean)];
  const pv = new Map((await Province.find({ _id: { $in: provIds } }).lean()).map((p) => [p._id, p.name]));
  const recentRoutes = routeIds.map((id) => routes.find((r) => r._id === id)).filter(Boolean).map((r) => {
    const last = recent.find((b) => b.routeId === r._id);
    return { fromProvinceId: r.fromProvinceId, fromProvinceName: pv.get(r.fromProvinceId) || '', toProvinceId: r.toProvinceId, toProvinceName: pv.get(r.toProvinceId) || '', pickupOfficeId: last?.pickupOfficeId, dropOfficeId: last?.dropOfficeId };
  });
  const favoriteRoutes = favorites.filter((f) => f.kind === 'route').map((f) => ({ id: f._id, label: f.label, fromProvinceId: f.fromProvinceId, fromProvinceName: pv.get(f.fromProvinceId) || '', toProvinceId: f.toProvinceId, toProvinceName: pv.get(f.toProvinceId) || '' }));

  // Suggestions (18): upcoming open trips on the routes the customer takes most, with many free seats.
  const counts = new Map();
  for (const b of recent) counts.set(b.routeId, (counts.get(b.routeId) || 0) + 1);
  const topRoutes = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  const soon = await Trip.find({ routeId: { $in: topRoutes }, status: 'scheduled', departAt: { $gt: now, $lte: T.addMinutes(now, 3 * 1440) } }).sort({ departAt: 1 }).limit(20).lean();
  const suggestions = (await require('./trips').presentMany(soon)).filter((t) => t.status === 'open').sort((a, b) => b.seats.free - a.seats.free).slice(0, 5);

  const reviewed = new Set((await Review.find({ bookingId: { $in: done.map((b) => b._id) } }).select('bookingId').lean()).map((r) => r.bookingId));
  const toReview = (await bookings.presentMany(done.filter((b) => !reviewed.has(b._id)))).map((b) => ({ bookingId: b.id, code: b.code, trip: b.trip }));

  return {
    greeting: { displayName: auth.account.displayName },
    operator: { name: op.name, phone: op.phone },
    upcomingTrip: upcoming ? { ...upcoming, countdownSeconds: Math.max(0, Math.round((new Date(upcoming.trip.departAt) - now) / 1000)) } : null,
    todo,
    shortcuts: { recentRoutes, favoriteRoutes, rebookBookingId: recent[0]?._id || null },
    services: [{ key: 'parcel', enabled: !!parcelCfg.enabled }],
    activeParcels: parcels.map((p) => ({ id: p.id, code: p.code, status: p.status, payStatus: p.payStatus, receiverName: p.receiver.name, toOffice: p.toOffice.name, trip: p.trip })),
    promotions: await require('./loyalty').activePromotions(),
    announcements: await require('./catalog').announcements({ limit: 5 }),
    toReview,
    suggestions,
    unread: await notify.unreadCounts(me),
    serverTime: iso(now),
  };
}

module.exports = { home };
