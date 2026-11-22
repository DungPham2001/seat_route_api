/**
 * Admin-only routes (Phần B): every route here checks role = admin on the server (not only hidden buttons).
 * /manage/* = daily operations (trips, bookings, proofs, parcels, reports), /admin/* = configuration.
 */
const express = require('express');
const { asyncHandler } = require('../lib/errors');
const { requireAdmin } = require('../middleware/auth');
const { resources } = require('../resources/defs');
const accounts = require('../services/accounts');
const settings = require('../services/settings');
const trips = require('../services/trips');
const bookings = require('../services/bookings');
const parcels = require('../services/parcels');
const social = require('../services/social');
const loyalty = require('../services/loyalty');
const dashboard = require('../services/dashboard');
const reports = require('../services/reports');
const admin = require('../services/admin');
const audit = require('../services/audit');
const routesSvc = require('../services/routes');
const layouts = require('../services/layouts');
const { Route, TripSeries } = require('../models');

const r = express.Router();
const h = asyncHandler;
const A = requireAdmin;
const noContent = (fn) => h(async (req, res) => {
  await fn(req, res);
  res.status(204).end();
});
const json = (fn, status = 200) => h(async (req, res) => res.status(status).json(await fn(req, res)));

// Everything under these prefixes is admin-only, whatever the method.
r.use(['/manage', '/admin'], A);

// ---------- overview & inbox (118-156) ----------
r.get('/manage/dashboard', json((req) => dashboard.dashboard(req.query)));
r.get('/manage/inbox/counts', json(() => dashboard.inboxCounts()));
r.get('/manage/inbox', json((req) => dashboard.inbox(req.auth, req.query)));
r.get('/manage/calendar', json((req) => dashboard.calendar(req.query)));

// ---------- bookings (130-138, 147-151, 169) ----------
r.get('/manage/bookings', json((req) => bookings.list(req.auth, req.query)));
r.post('/manage/bookings/approve', json((req) => bookings.approveMany(req.auth, req.body)));
r.post('/manage/bookings/:id/approve', json((req) => bookings.approve(req.auth, req.params.id, req.body)));
r.post('/manage/bookings/:id/reject', json((req) => bookings.reject(req.auth, req.params.id, req.body)));
r.post('/manage/bookings/:id/collect', json((req) => bookings.collect(req.auth, req.params.id, req.body)));
r.post('/manage/bookings/:id/approve-cancel', json((req) => bookings.decideCancel(req.auth, req.params.id, req.body, true)));
r.post('/manage/bookings/:id/reject-cancel', json((req) => bookings.decideCancel(req.auth, req.params.id, req.body, false)));
r.post('/manage/bookings/:id/reseat', json((req) => bookings.assignSeats(req.auth, req.params.id, { assignments: req.body?.assignments || req.body?.seats, reason: req.body?.reason })));
r.post('/manage/bookings', json((req) => bookings.adminCreate(req.auth, req.body), 201));
r.post('/bookings/:id/assign-seats', A, json((req) => bookings.assignSeats(req.auth, req.params.id, req.body)));
r.post('/bookings/:id/refund', A, json((req) => bookings.refundBooking(req.auth, req.params.id, req.body)));
r.post('/manage/bookings/:id/assign-seats', json((req) => bookings.assignSeats(req.auth, req.params.id, req.body)));
r.post('/manage/bookings/:id/move', json(async (req) => {
  const b = await bookings.load(req.params.id);
  const to = await trips.loadTrip(req.body?.tripId);
  await bookings.moveToTrip(req.auth, b, to, { seats: req.body?.seats || null, reason: req.body?.reason || '' });
  return bookings.presentOne(await bookings.load(req.params.id), { admin: true });
}));
r.post('/manage/bookings/:id/cancel', json((req) => bookings.adminCancel(req.auth, req.params.id, req.body)));
r.post('/manage/bookings/:id/notes', json((req) => bookings.addNote(req.auth, req.params.id, req.body), 201));
r.post('/manage/bookings/:id/refund', json((req) => bookings.refundBooking(req.auth, req.params.id, req.body)));
r.get('/manage/requests', json((req) => bookings.listRequests(req.auth, req.query)));
r.post('/manage/requests/:id/approve', json((req) => bookings.decideRequest(req.auth, req.params.id, req.body, true)));
r.post('/manage/requests/:id/reject', json((req) => bookings.decideRequest(req.auth, req.params.id, req.body, false)));
r.get('/manage/refunds', json((req) => bookings.listRefunds(req.auth, req.query)));
r.post('/manage/refunds/:id/record', json((req) => bookings.recordRefund(req.auth, req.params.id, req.body)));
r.patch('/manage/shuttle-requests/:id', json((req) => bookings.adminShuttle(req.auth, req.params.id, req.body)));

// ---------- trips (157-184, 199-201) ----------
r.get('/manage/trips', json((req) => trips.adminList(req.query)));
r.post('/manage/trips', json((req) => trips.create(req.auth, req.body), 201));
r.get('/manage/trips/merge-suggestions', json((req) => trips.mergeSuggestions(req.query)));
r.get('/manage/trips/:id', json((req) => trips.adminDetail(req.params.id)));
r.patch('/manage/trips/:id', json((req) => trips.update(req.auth, req.params.id, req.body)));
r.delete('/manage/trips/:id', noContent((req) => trips.remove(req.auth, req.params.id)));
r.put('/manage/trips/:id/driver', json((req) => trips.setDriver(req.auth, req.params.id, req.body)));
r.put('/manage/trips/:id/vehicle', json((req) => trips.setVehicle(req.auth, req.params.id, req.body)));
r.post('/manage/trips/:id/status', json((req) => trips.setStatus(req.auth, req.params.id, req.body)));
r.post('/manage/trips/:id/cancel', json((req) => trips.cancel(req.auth, req.params.id, req.body)));
r.post('/manage/trips/:id/move-passengers', json((req) => trips.movePassengers(req.auth, req.params.id, req.body)));
r.get('/manage/trips/:id/seats', json((req) => trips.seatMap(req.params.id, req.auth)));
r.post('/manage/trips/:id/seats/:seatId/lock', json((req) => trips.lockSeat(req.auth, req.params.id, req.params.seatId, req.body, true)));
r.post('/manage/trips/:id/seats/:seatId/unlock', json((req) => trips.lockSeat(req.auth, req.params.id, req.params.seatId, req.body, false)));
r.get('/manage/trips/:id/driver-suggestions', json((req) => trips.driverSuggestions(req.params.id)));
r.get('/manage/trips/:id/manifest', json((req) => bookings.manifest(req.params.id)));
r.post('/manage/trips/:id/boarding', json((req) => bookings.boarding(req.auth, req.params.id, req.body)));
r.get('/manage/trips/:id/shuttle', json((req) => bookings.shuttleList(req.params.id)));
r.put('/manage/trips/:id/shuttle-duties', json((req) => bookings.setShuttleDuties(req.auth, req.params.id, req.body)));
r.get('/manage/trips/:id/logs', json((req) => admin.listLogs(req.params.id)));
r.post('/manage/trips/:id/logs', json((req) => admin.addLog(req.auth, req.params.id, req.body), 201));
r.post('/manage/trips/:id/notify', json((req) => admin.broadcast(req.auth, req.params.id, req.body)));
r.get('/manage/trips/:id/driver-text', json((req) => admin.driverText(req.params.id, req.query.lang === 'en' ? 'en' : 'vi')));
r.put('/manage/trips/:id/checklist', json((req) => admin.resetChecklist(req.auth, req.params.id)));
r.patch('/manage/trips/:id/checklist/:itemId', json((req) => admin.checkItem(req.auth, req.params.id, req.params.itemId, req.body)));
r.get('/manage/trips/:id/parcels', json((req) => parcels.tripParcels(req.params.id)));
r.get('/manage/trips/:id/waitlist', json((req) => social.tripWaitlist(req.params.id)));
r.put('/manage/trips/:id/parcel-capacity', json((req) => trips.update(req.auth, req.params.id, { parcelCapacity: req.body })));
r.put('/admin/parcel-capacity/:tripId', json((req) => trips.update(req.auth, req.params.tripId, { parcelCapacity: req.body })));
r.patch('/manage/waitlist/:id', json((req) => social.updateWaitlist(req.auth, req.params.id, req.body)));

r.get('/manage/series', json((req) => trips.listSeries(req.query)));
r.post('/manage/series', json((req) => trips.createSeries(req.auth, req.body), 201));
r.get('/manage/series/:id', json((req) => trips.getSeries(req.params.id)));
r.patch('/manage/series/:id', json((req) => trips.updateSeries(req.auth, req.params.id, req.body)));
r.delete('/manage/series/:id', json((req) => trips.deleteSeries(req.auth, req.params.id)));
r.post('/manage/series/:id/exceptions', json((req) => trips.addException(req.auth, req.params.id, req.body)));
r.post('/manage/series/:id/generate', json(async (req) => {
  await trips.getSeries(req.params.id); // 404 when missing
  return trips.generateSeries(await TripSeries.findById(req.params.id).lean(), req.auth);
}));

// ---------- parcels (139, 152, 181-183) ----------
r.get('/manage/parcels', json((req) => parcels.list(req.auth, req.query)));
r.post('/manage/parcels', json((req) => parcels.adminCreate(req.auth, req.body), 201));
r.post('/manage/parcels/:id/accept', json((req) => parcels.accept(req.auth, req.params.id, req.body)));
r.post('/manage/parcels/:id/reject', json((req) => parcels.reject(req.auth, req.params.id, req.body)));
r.post('/manage/parcels/:id/status', json((req) => parcels.setStatus(req.auth, req.params.id, req.body)));
r.post('/manage/parcels/:id/handover', json((req) => parcels.handover(req.auth, req.params.id, req.body)));
r.post('/manage/parcels/:id/unclaimed', json((req) => parcels.markUnclaimed(req.auth, req.params.id)));
r.post('/manage/parcels/:id/issue', json((req) => parcels.recordIssue(req.auth, req.params.id, req.body)));
r.put('/manage/parcels/:id/trip', json((req) => parcels.moveTrip(req.auth, req.params.id, req.body)));
r.post('/manage/parcels/:id/cancel', json((req) => parcels.cancel(req.auth, req.params.id, req.body)));
r.post('/manage/parcels/:id/handover-code', json((req) => parcels.regenerateCode(req.auth, req.params.id)));
r.get('/manage/parcels/:id/share-text', json(async (req) => ({ text: await parcels.shareText(req.auth, req.params.id, { handoverCode: req.query.handoverCode || null, lang: req.query.lang === 'en' ? 'en' : 'vi' }) })));

// ---------- reviews, reports, complaints, chat, contact (232-239) ----------
r.get('/manage/reviews', json((req) => social.adminReviews(req.query)));
r.post('/manage/reviews/:id/reply', json((req) => social.replyReview(req.auth, req.params.id, req.body)));
r.post('/manage/reviews/:id/hide', json((req) => social.setReviewStatus(req.auth, req.params.id, 'hidden', req.body?.note)));
r.post('/manage/reviews/:id/show', json((req) => social.setReviewStatus(req.auth, req.params.id, 'visible', req.body?.note)));
r.get('/manage/messages', json((req) => social.adminInbox(req.query)));
r.get('/admin/reports', json((req) => social.adminReports(req.query)));
r.post('/admin/reports/:id/resolve', json((req) => social.resolveReport(req.auth, req.params.id, req.body)));
r.get('/admin/complaints', json((req) => social.listComplaints(req.auth, req.query)));
r.get('/admin/contact-messages', json((req) => social.listContacts(req.auth, req.query)));
r.post('/admin/contact-messages/:id/reply', json((req) => social.replyContact(req.auth, req.params.id, req.body)));
r.get('/admin/actions', json((req) => audit.list(req.query)));

// ---------- reports & export (240-253, 263) ----------
const REPORTS = { reconciliation: reports.reconciliation, profit: reports.profit, occupancy: reports.occupancy, revenue: reports.revenue, top: reports.top, rates: reports.rates, parcels: reports.parcels, comps: reports.comps, shuttle: reports.shuttle, forecast: reports.forecast };
r.get('/manage/revenue', json((req) => reports.revenueSummary(req.query)));
r.get('/manage/reports/:kind', json((req) => {
  const fn = REPORTS[req.params.kind];
  if (!fn) throw require('../lib/errors').notFound();
  return fn(req.query);
}));
r.get('/manage/export', h(async (req, res) => {
  const out = await reports.exportCsv(req.query);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.filename}"` });
  res.send(out.csv);
}));

// ---------- settings (203-209, 214, 220-231, 237, 255) ----------
r.get('/admin/settings', json(() => settings.all()));
r.get('/admin/settings/:key', json(async (req) => {
  if (!settings.KEYS.includes(req.params.key)) throw require('../lib/errors').notFound();
  return settings.get(req.params.key);
}));
r.put('/admin/settings/:key', json((req) => settings.update(req.params.key, req.body, req.auth.accountId)));
r.patch('/admin/settings/:key', json((req) => settings.update(req.params.key, req.body, req.auth.accountId)));
// Aliases from the spec.
r.put('/admin/operator', json((req) => settings.update('operator', req.body, req.auth.accountId)));
r.put('/admin/cancel-policy', json((req) => settings.update('cancelPolicy', req.body, req.auth.accountId)));
// ---------- admins (256, 260) ----------
r.get('/admin/admins', json((req) => accounts.listAdmins(req.auth)));
r.post('/admin/admins', json((req) => accounts.createAdmin(req.auth, req.body), 201));
r.post('/admin/admins/:id/revoke', noContent((req) => accounts.revokeAdmin(req.auth, req.params.id)));
r.delete('/admin/admins/:id', noContent((req) => accounts.revokeAdmin(req.auth, req.params.id)));
r.post('/admin/admins/:id/reset-password', json((req) => accounts.resetAdminPassword(req.auth, req.params.id)));

// ---------- customers (225, 226): /manage/customers is the main path, /admin/customers an alias ----------
for (const base of ['/manage/customers', '/admin/customers']) {
  r.get(base, json((req) => admin.listCustomers(req.query)));
  r.post(base, json((req) => admin.createCustomer(req.auth, req.body), 201));
  r.get(`${base}/:id`, json((req) => admin.getCustomer(req.params.id)));
  r.patch(`${base}/:id`, json((req) => admin.updateCustomer(req.auth, req.params.id, req.body)));
  r.delete(`${base}/:id`, noContent((req) => admin.deleteCustomer(req.auth, req.params.id)));
  r.post(`${base}/:id/reset-password`, json((req) => admin.resetCustomerPassword(req.auth, req.params.id, req.body)));
  r.post(`${base}/:id/lock`, json((req) => admin.suspend(req.auth, req.params.id, req.body, true)));
  r.post(`${base}/:id/unlock`, json((req) => admin.suspend(req.auth, req.params.id, req.body, false)));
}
r.post('/admin/accounts/:id/suspend', json((req) => admin.suspend(req.auth, req.params.id, req.body, true)));
r.post('/admin/accounts/:id/unsuspend', json((req) => admin.suspend(req.auth, req.params.id, req.body, false)));

// ---------- tools (116, 257, 258) ----------
r.get('/admin/search', json((req) => admin.search(req.query)));
r.post('/admin/import/:type', json((req) => admin.importCsv(req.auth, req.params.type, req.body)));
r.get('/admin/onboarding', json((req) => admin.onboarding(req.auth)));
r.post('/admin/onboarding/:key', json((req) => admin.markOnboarding(req.auth, req.params.key, req.body?.done !== false)));

// ---------- custom actions on catalog tables (before their CRUD routers) ----------
r.get('/manage/seat-layouts/templates', (_req, res) => res.json(layouts.templates()));
r.post('/manage/routes/:id/duplicate', json((req) => routesSvc.duplicate(req.auth, req.params.id, req.body), 201));
r.get('/manage/routes/stats', json(async () => {
  const rows = await Route.find({}).lean();
  const stats = await routesSvc.durationStats(rows.map((x) => x._id));
  return { items: rows.map((x) => ({ routeId: x._id, name: x.name, plannedMinutes: x.durationMinutes, ...(stats.get(x._id) || { avgActualMinutes: null, avgDepartDelayMinutes: null, sampleTrips: 0 }) })) };
}));
r.post('/admin/promotions/:id/grant', json((req) => loyalty.grant(req.auth, req.params.id, req.body)));
r.get('/admin/guests/lookup', json((req) => bookings.lookupPhone(req.query)));
r.post('/admin/guests/:id/link', json((req) => bookings.linkGuest(req.auth, req.params.id, req.body)));

// ---------- CRUD of catalog tables ----------
for (const res of Object.values(resources)) {
  if (res.role === 'admin') r.use(res.path, A, res.router());
}
r.use('/manage/zones', A, resources.shuttleZones.router()); // alias of /manage/shuttle-zones
for (const [path, key] of [['/manage/staff', 'staff'], ['/manage/promotions', 'promotions'], ['/manage/guests', 'guests']]) r.use(path, A, resources[key].router()); // aliases used by the app document
r.get('/manage/search', json((req) => admin.search(req.query)));
r.get('/manage/bookings/export.csv', h(async (req, res) => {
  const out = await reports.exportCsv({ ...req.query, type: 'bookings' });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.filename}"` });
  res.send(out.csv);
}));

module.exports = r;
