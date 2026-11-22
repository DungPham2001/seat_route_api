/** Customer-only routes (Phần A). Admin tokens get 403 forbidden here. */
const express = require('express');
const { asyncHandler } = require('../lib/errors');
const { requireCustomer } = require('../middleware/auth');
const bookings = require('../services/bookings');
const parcels = require('../services/parcels');
const social = require('../services/social');
const loyalty = require('../services/loyalty');
const privacy = require('../services/privacy');
const { home } = require('../services/home');

const r = express.Router();
const h = asyncHandler;
const C = requireCustomer;
const noContent = (fn) => h(async (req, res) => {
  await fn(req, res);
  res.status(204).end();
});

r.get('/home', C, h(async (req, res) => res.json(await home(req.auth))));

// ---------- bookings ----------
r.post('/bookings', C, h(async (req, res) => {
  const out = await bookings.create(req.auth, req.body, { idempotencyKey: req.get('idempotency-key') });
  res.status(out.status).json(out.body);
}));
r.get('/bookings/:id/cancel-preview', C, h(async (req, res) => res.json(await bookings.cancelPreview(req.auth, req.params.id))));
r.post('/bookings/:id/cancel', C, h(async (req, res) => res.json(await bookings.requestCancel(req.auth, req.params.id, req.body))));
r.get('/bookings/:id/rebook', C, h(async (req, res) => res.json(await bookings.rebook(req.auth, req.params.id))));
r.post('/trips/:id/waitlist', C, h(async (req, res) => res.status(201).json(await social.joinWaitlist(req.auth, req.params.id, req.body))));

// ---------- parcels ----------
r.post('/parcels', C, h(async (req, res) => {
  const out = await parcels.create(req.auth, req.body, { idempotencyKey: req.get('idempotency-key') });
  res.status(out.status).json(out.body);
}));
r.get('/parcels/:id/cancel-preview', C, h(async (req, res) => res.json(await parcels.getCancelPreview(req.auth, req.params.id))));
r.post('/parcels/:id/cancel', C, h(async (req, res) => res.json(await parcels.cancel(req.auth, req.params.id, req.body))));
r.post('/parcels/:id/handover-code', C, h(async (req, res) => res.json(await parcels.regenerateCode(req.auth, req.params.id))));
r.get('/parcels/:id/share-text', C, h(async (req, res) => res.json({ text: await parcels.shareText(req.auth, req.params.id, { handoverCode: req.query.handoverCode || null, lang: req.query.lang === 'en' ? 'en' : req.lang }) })));
r.post('/parcels/:id/issue', C, h(async (req, res) => res.status(201).json(await parcels.reportIssue(req.auth, req.params.id, req.body))));

// ---------- reviews, complaints, contact ----------
r.post('/reviews', C, h(async (req, res) => res.status(201).json(await social.createReview(req.auth, req.body))));
r.patch('/reviews/:id', C, h(async (req, res) => res.json(await social.updateReview(req.auth, req.params.id, req.body))));
r.delete('/reviews/:id', C, noContent(async (req) => social.deleteReview(req.auth, req.params.id)));
r.post('/complaints', C, h(async (req, res) => res.status(201).json(await social.createComplaint(req.auth, req.body))));
r.post('/contact', C, h(async (req, res) => res.status(201).json(await social.createContact(req.auth, req.body))));

// ---------- Profile ----------
// Favourite routes and the routes taken recently ("Đặt nhanh"). Nothing else is stored for the customer.
r.get('/me/favorite-routes', C, h(async (req, res) => res.json(await social.favoriteRoutes(req.auth))));
r.post('/me/favorite-routes/:routeId', C, h(async (req, res) => res.status(201).json(await social.addFavoriteRoute(req.auth, req.params.routeId))));
r.delete('/me/favorite-routes/:routeId', C, noContent(async (req) => social.removeFavoriteRoute(req.auth, req.params.routeId)));
r.get('/me/recent-routes', C, h(async (req, res) => res.json(await social.recentRoutes(req.auth))));
r.get('/me/loyalty', C, h(async (req, res) => res.json(await loyalty.detail(req.auth, req.query))));
r.get('/me/vouchers', C, h(async (req, res) => res.json(await loyalty.vouchers(req.auth))));
r.post('/me/vouchers', C, h(async (req, res) => res.status(201).json(await loyalty.saveVoucher(req.auth, req.body))));
r.get('/me/referral', C, h(async (req, res) => res.json(await loyalty.referral(req.auth, req.lang))));
r.get('/me/stats', C, h(async (req, res) => res.json(await loyalty.stats(req.auth))));
r.get('/me/requests', C, h(async (req, res) => res.json(await bookings.listRequests(req.auth, req.query))));
r.delete('/me/requests/:id', C, h(async (req, res) => res.json(await bookings.withdrawRequest(req.auth, req.params.id))));
r.get('/me/refunds', C, h(async (req, res) => res.json(await bookings.listRefunds(req.auth, req.query))));
r.get('/me/waitlist', C, h(async (req, res) => res.json(await social.myWaitlist(req.auth))));
r.delete('/me/waitlist/:id', C, noContent(async (req) => social.cancelWaitlist(req.auth, req.params.id)));
r.get('/me/reviews', C, h(async (req, res) => res.json(await social.myReviews(req.auth))));
r.get('/me/complaints', C, h(async (req, res) => res.json(await social.listComplaints(req.auth, req.query))));
r.get('/me/contact', C, h(async (req, res) => res.json(await social.listContacts(req.auth, req.query))));
r.get('/me/data', C, h(async (req, res) => res.json(await privacy.myData(req.auth))));
r.get('/me/export', C, h(async (req, res) => {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nhaxe-bookings.csv"' });
  res.send(await privacy.exportMine(req.auth));
}));

module.exports = r;
