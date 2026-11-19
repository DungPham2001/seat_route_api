/** Customer-only routes (Phần A). Admin tokens get 403 forbidden here. */
const express = require('express');
const { asyncHandler } = require('../lib/errors');
const { requireCustomer } = require('../middleware/auth');
const { uploadOne } = require('../middleware/upload');
const { resources } = require('../resources/defs');
const accounts = require('../services/accounts');
const bookings = require('../services/bookings');
const proofs = require('../services/proofs');
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
r.get('/bookings/:id/payment-info', C, h(async (req, res) => res.json(await bookings.paymentInfo(req.auth, req.params.id))));
r.post('/bookings/:id/proofs', C, uploadOne, h(async (req, res) => res.status(201).json(await proofs.upload(req.auth, 'booking', req.params.id, req))));
r.post('/bookings/:id/reselect-seats', C, h(async (req, res) => res.json(await bookings.reselectSeats(req.auth, req.params.id, req.body))));
r.get('/bookings/:id/cancel-preview', C, h(async (req, res) => res.json(await bookings.cancelPreview(req.auth, req.params.id))));
r.post('/bookings/:id/cancel', C, h(async (req, res) => res.json(await bookings.requestCancel(req.auth, req.params.id, req.body))));
r.post('/bookings/:id/requests', C, h(async (req, res) => res.status(201).json(await bookings.createRequest(req.auth, req.params.id, req.body))));
r.get('/bookings/:id/rebook', C, h(async (req, res) => res.json(await bookings.rebook(req.auth, req.params.id))));
r.post('/trips/:id/waitlist', C, h(async (req, res) => res.status(201).json(await social.joinWaitlist(req.auth, req.params.id, req.body))));

// ---------- parcels ----------
r.post('/parcels', C, h(async (req, res) => {
  const out = await parcels.create(req.auth, req.body, { idempotencyKey: req.get('idempotency-key') });
  res.status(out.status).json(out.body);
}));
r.get('/parcels/:id/payment-info', C, h(async (req, res) => res.json(await parcels.paymentInfo(req.auth, req.params.id))));
r.post('/parcels/:id/proofs', C, uploadOne, h(async (req, res) => res.status(201).json(await proofs.upload(req.auth, 'parcel', req.params.id, req))));
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
for (const key of ['passengers', 'addresses', 'receivers', 'favorites']) {
  const res = resources[key];
  r.use(res.path, C, res.router());
}
for (const [path, key] of [['/me/preferences', 'preferences'], ['/me/refund-account', 'refundAccount'], ['/me/emergency', 'emergencyContact']]) {
  r.get(path, C, (req, res) => res.json(accounts.getSingle(req.auth, key)));
  r.put(path, C, h(async (req, res) => res.json(await accounts.putSingle(req.auth, key, req.body))));
  if (key !== 'preferences') r.delete(path, C, noContent(async (req) => accounts.deleteSingle(req.auth, key)));
}
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
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="seatroute-bookings.csv"' });
  res.send(await privacy.exportMine(req.auth));
}));

module.exports = r;
