/**
 * /v1 routes. Public: health, auth, web deletion (JSON), cron. Everything else needs a token;
 * customer-only routes are in customer.js, admin-only (/manage, /admin and review actions) in manage.js.
 */
const express = require('express');
const mongoose = require('mongoose');
const config = require('../config');
const { asyncHandler, AppError } = require('../lib/errors');
const { authenticate } = require('../middleware/auth');
const { scopeToOperator } = require('../middleware/tenant');
const tenant = require('../lib/tenant');
const { iso, safeEqual } = require('../lib/util');
const accounts = require('../services/accounts');
const notify = require('../services/notify');
const catalog = require('../services/catalog');
const trips = require('../services/trips');
const bookings = require('../services/bookings');
const settings = require('../services/settings');
const social = require('../services/social');
const parcels = require('../services/parcels');
const jobs = require('../services/jobs');

const { notFound } = require('../lib/errors');
const passengerOnly = (_req, _res, next) => next(config.customersEnabled ? undefined : notFound());
const r = express.Router();
r.use(scopeToOperator); // anonymous calls: the default operator (signed-in ones are re-scoped below)
const h = asyncHandler;
const noContent = (fn) => h(async (req, res) => {
  await fn(req, res);
  res.status(204).end();
});

// ---------- public ----------

r.get('/health', (_req, res) => {
  const up = mongoose.connection.readyState === 1;
  res.status(up ? 200 : 503).json({ status: up ? 'ok' : 'degraded', apiVersion: config.apiVersion, minAppVersion: config.minAppVersion, latestAppVersion: config.latestAppVersion, serverTime: iso(new Date()), timezone: config.timezone });
});

r.post('/auth/register', h(async (req, res) => {
  const out = await accounts.register(req.body, { lang: req.lang, idempotencyKey: req.get('idempotency-key') });
  res.status(out.status).json(out.body);
}));
r.post('/auth/login', h(async (req, res) => res.json(await accounts.login(req.body))));
r.post('/auth/refresh', h(async (req, res) => res.json(await accounts.refresh(req.body))));
r.post('/auth/logout', noContent(async (req, res) => {
  // Bearer is optional: an expired access token must not prevent logging out with the refresh token.
  let auth = null;
  if (req.get('authorization')) {
    await new Promise((resolve) => authenticate(req, res, () => resolve()));
    auth = req.auth || null;
  }
  await accounts.logout(req.body, auth);
}));
r.post('/auth/forgot', h(async (req, res) => res.status(202).json(await accounts.forgot(req.body, { lang: req.lang }))));
r.post('/auth/reset', noContent(async (req) => accounts.reset(req.body, { lang: req.lang })));
r.post('/account-deletion', noContent(async (req) => accounts.deleteByCredentials(req.body)));

r.get('/jobs/run', h(async (req, res) => {
  if (config.cronSecret) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
    if (!m || !safeEqual(m[1], config.cronSecret)) throw new AppError(401, 'unauthorized');
  }
  res.json(await tenant.unscoped(() => jobs.run()));
}));

// ---------- signed in (both roles) ----------

r.use(authenticate, scopeToOperator);

r.post('/auth/change-password', h(async (req, res) => res.json(await accounts.changePassword(req.auth, req.body, { lang: req.lang }))));
r.get('/me', h(async (req, res) => res.json(await accounts.profile(req.auth.account))));
r.patch('/me', h(async (req, res) => res.json(await accounts.updateMe(req.auth, req.body))));
r.delete('/me', noContent(async (req) => accounts.deleteAccount(req.auth.account, req.body?.password)));
for (const base of ['/devices', '/me/devices']) {
  r.get(base, h(async (req, res) => res.json(await accounts.listDevices(req.auth))));
  r.delete(`${base}/:id`, noContent(async (req) => accounts.removeDevice(req.auth, req.params.id)));
}

r.get('/notifications', h(async (req, res) => res.json(await notify.list(req.auth, req.query, req.lang))));
r.get('/notifications/unread-count', h(async (req, res) => res.json(await notify.unreadCounts(req.auth.accountId))));
r.post('/notifications/read', h(async (req, res) => res.json(await notify.markRead(req.auth, req.body))));
r.delete('/notifications/:id', noContent(async (req) => notify.remove(req.auth, req.params.id)));

r.get('/operator', h(async (_req, res) => res.json(await catalog.operator())));
r.get('/cancel-policy', h(async (_req, res) => {
  const [cp, rules] = await Promise.all([settings.get('cancelPolicy'), settings.get('rules')]);
  res.json({ tiers: cp.tiers, cancelFee: cp.cancelFee, changeAllowedHoursBefore: cp.changeAllowedHoursBefore, note: cp.note, rules: rules.items });
}));
r.get('/provinces', h(async (req, res) => res.json(await catalog.provinces(req.query))));
r.get('/provinces/:id/offices', h(async (req, res) => res.json(await catalog.provinceOffices(req.params.id, req.query))));
r.get('/offices', h(async (_req, res) => res.json(await catalog.allOffices())));
r.get('/offices/:id/shuttle-zones', h(async (req, res) => res.json(await catalog.shuttleZones(req.params.id, req.query))));
r.get('/routes/available', h(async (_req, res) => res.json(await catalog.availableRoutes())));
r.get('/routes/:id/info', h(async (req, res) => res.json(await catalog.routeInfo(req.params.id))));
r.get('/faq', h(async (req, res) => res.json(await catalog.faq(req.query.lang === 'en' || req.query.lang === 'vi' ? req.query.lang : req.lang))));
r.get('/content/:key', h(async (req, res) => res.json(await catalog.content(req.params.key, req.query.lang === 'en' || req.query.lang === 'vi' ? req.query.lang : req.lang))));
r.get('/announcements', h(async (_req, res) => res.json({ items: await catalog.announcements({ limit: 30 }) })));
r.get('/reviews', passengerOnly, h(async (req, res) => res.json(await social.publicReviews(req.query))));

r.get('/trips', passengerOnly, h(async (req, res) => res.json(await trips.search(req.query))));
r.get('/trips/:id', h(async (req, res) => res.json(await trips.detail(req.params.id, { admin: req.auth.role === 'admin' }))));
r.get('/trips/:id/seats', h(async (req, res) => res.json(await trips.seatMap(req.params.id, req.auth))));
r.get('/trips/:id/alternatives', passengerOnly, h(async (req, res) => res.json(await trips.alternatives(req.params.id, req.query))));

// Orders: customers see only their own; admins see all.
r.post('/bookings/quote', passengerOnly, h(async (req, res) => res.json(await bookings.quote(req.auth, req.body))));
r.get('/bookings', h(async (req, res) => res.json(await bookings.list(req.auth, req.query))));
r.get('/bookings/:id', h(async (req, res) => res.json(await bookings.get(req.auth, req.params.id))));
r.get('/bookings/:id/history', h(async (req, res) => res.json(await bookings.history(req.auth, req.params.id))));
r.get('/bookings/:id/share-text', h(async (req, res) => res.json({ text: await bookings.shareText(req.auth, req.params.id, req.query.lang === 'en' ? 'en' : req.lang) })));
r.get('/bookings/:id/messages', h(async (req, res) => res.json(await social.listMessages(req.auth, req.params.id))));
r.post('/bookings/:id/messages', h(async (req, res) => res.status(201).json(await social.sendMessage(req.auth, req.params.id, req.body))));
r.patch('/bookings/:id/places', h(async (req, res) => res.json(await bookings.updatePlaces(req.auth, req.params.id, req.body))));
r.patch('/bookings/:id/shuttle', h(async (req, res) => res.json(await bookings.updateShuttle(req.auth, req.params.id, req.body))));
r.get('/parcels', h(async (req, res) => res.json(await parcels.list(req.auth, req.query))));
r.get('/parcels/config', passengerOnly, h(async (_req, res) => res.json(await parcels.getConfig())));
r.post('/parcels/quote', passengerOnly, h(async (req, res) => res.json(await parcels.quote(req.body))));
r.get('/parcels/:id', h(async (req, res) => res.json(await parcels.get(req.auth, req.params.id))));
r.get('/complaints/:id', h(async (req, res) => res.json(await social.getComplaint(req.auth, req.params.id))));
r.post('/complaints/:id/replies', h(async (req, res) => res.json(await social.replyComplaint(req.auth, req.params.id, req.body))));
r.post('/reports', h(async (req, res) => res.status(201).json(await social.createReport(req.auth, req.body))));

// Passenger endpoints (customer.js and the search / quote / waitlist routes above) exist only while CUSTOMERS_ENABLED=1.
const passenger = express.Router();
passenger.use((_req, _res, next) => (config.customersEnabled ? next() : next('router')));
passenger.use(require('./customer'));
r.use(passenger);
r.use(require('./manage'));

module.exports = r;
