/**
 * Privacy (110-112): "my data" summary, CSV export of my bookings, and real deletion of a customer account.
 *
 * Deletion removes the account, sessions, favourite routes, notifications, messages, reviews, reports, complaints,
 * loyalty, vouchers, waitlist and referrals. Bookings and parcels are kept only as anonymous financial lines (amounts, trip, seat
 * labels) because the operator must reconcile revenue; names, phones and addresses in them are erased.
 * Blocked while a trip is not completed or a refund is pending (112).
 */
const mongoose = require('mongoose');
const models = require('../models');
const { conflict } = require('../lib/errors');
const { withTx } = require('../lib/tx');
const { iso } = require('../lib/util');
const T = require('../lib/time');
const tenant = require('../lib/tenant');

const M = models;

/** A passenger's data can sit in several operators: privacy actions look at all of them. */
const assertDeletable = (accountId) => tenant.unscoped(() => checkDeletable(accountId));

async function checkDeletable(accountId) {
  const now = new Date();
  const [activeBookings, activeParcels, refunds] = await Promise.all([
    M.Booking.countDocuments({ customerAccountId: accountId, status: { $in: ['pending', 'confirmed', 'cancel_requested'] }, departAt: { $gt: T.addMinutes(now, -1440) } }),
    M.Parcel.countDocuments({ senderAccountId: accountId, status: { $in: ['pending', 'accepted', 'received', 'loaded', 'arrived', 'issue'] } }),
    M.Refund.countDocuments({ accountId, status: 'pending' }),
  ]);
  if (activeBookings || activeParcels || refunds) throw conflict('has_active_orders', { activeBookings, activeParcels, pendingRefunds: refunds });
}

const purgeCustomer = (account, opts) => tenant.unscoped(() => purge(account, opts));

async function purge(account, { force = false } = {}) {
  const id = account._id;
  if (!force) await assertDeletable(id);
  await withTx(async (session) => {
    const o = { session };
    await M.Booking.updateMany({ customerAccountId: id }, {
      $set: {
        note: '', search: '', 'seats.$[].passengerName': '', 'seats.$[].passengerPhone': '', internalNotes: [],
      },
    }, o);
    // Shuttle addresses are personal data too (only where a shuttle exists: a null field cannot take sub-fields).
    await M.Booking.updateMany({ customerAccountId: id, pickupShuttle: { $ne: null } }, { $set: { 'pickupShuttle.addressText': '', 'pickupShuttle.noteText': '' } }, o);
    await M.Booking.updateMany({ customerAccountId: id, pickup: { $ne: null } }, { $set: { 'pickup.address': '', 'pickup.note': '' } }, o);
    await M.Booking.updateMany({ customerAccountId: id, drop: { $ne: null } }, { $set: { 'drop.address': '', 'drop.note': '' } }, o);
    await M.Booking.updateMany({ customerAccountId: id, dropShuttle: { $ne: null } }, { $set: { 'dropShuttle.addressText': '', 'dropShuttle.noteText': '' } }, o);
    await M.Booking.updateMany({ customerAccountId: id }, { $set: { customerAccountId: null } }, o);
    await M.Parcel.updateMany({ senderAccountId: id }, { $set: { senderAccountId: null, senderName: '', senderPhone: '', receiverName: '', receiverPhone: '', receiverAddress: '', descriptionText: '', note: '', search: '', pickupShuttle: null, dropShuttle: null } }, o);
    await M.Refund.updateMany({ accountId: id }, { $set: { accountId: null } }, o);
    for (const Model of [M.Notification, M.LoyaltyEntry, M.Voucher, M.Waitlist, M.ContactMessage, M.Complaint, M.Review]) await Model.deleteMany({ accountId: id }, o);
    await M.FavoriteRoute.deleteMany({ accountId: id }, o);
    await M.Message.deleteMany({ senderAccountId: id }, o);
    await M.Report.deleteMany({ reporterAccountId: id }, o);
    await M.Referral.deleteMany({ $or: [{ referrerAccountId: id }, { referredAccountId: id }] }, o);
    await M.OrderRequest.updateMany({ accountId: id }, { $set: { accountId: null } }, o);
    await M.GuestContact.updateMany({ linkedAccountId: id }, { $set: { linkedAccountId: null } }, o);
    await M.Session.deleteMany({ accountId: id }, o);
    await M.PasswordReset.deleteMany({ accountId: id }, o);
    await M.Account.deleteOne({ _id: id }, o);
  });
}

/** Removes everything an operator owns (used when its last owner deletes the account). */
async function purgeOperator(operatorId) {
  await tenant.unscoped(async () => {
    for (const name of mongoose.modelNames()) {
      const Model = mongoose.model(name);
      if (Model.schema.path('operatorId') && !['Account'].includes(name)) await Model.deleteMany({ operatorId });
    }
    await M.Account.deleteMany({ operatorId });
  });
}

/** GET /v1/me/data (111): what the server keeps about me. */
async function myData(auth) {
  const id = auth.accountId;
  const count = (Model, f) => Model.countDocuments(f);
  const [bookings, parcels, reviews, messages, notifications] = await Promise.all([
    count(M.Booking, { customerAccountId: id }), count(M.Parcel, { senderAccountId: id }),
    count(M.Review, { accountId: id }), count(M.Message, { senderAccountId: id }), count(M.Notification, { accountId: id }),
  ]);
  const a = auth.account;
  return {
    account: { email: a.email, displayName: a.displayName, phone: a.phone, birthDate: a.birthDate, gender: a.gender, createdAt: iso(a.createdAt) },
    counts: { bookings, parcels, reviews, messages, notifications },
    deletion: { inApp: 'DELETE /v1/me', web: '/account/delete' },
  };
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** GET /v1/me/export (110): my bookings as CSV (UTF-8 with BOM, opens in Excel). */
async function exportMine(auth) {
  const rows = await M.Booking.find({ customerAccountId: auth.accountId }).sort({ departAt: -1 }).lean();
  const routes = new Map((await M.Route.find({ _id: { $in: [...new Set(rows.map((b) => b.routeId))] } }).select('name').lean()).map((r) => [r._id, r.name]));
  const offices = new Map((await M.Office.find({}).select('name').lean()).map((o) => [o._id, o.name]));
  return toCsv(
    ['code', 'route', 'departure', 'seats', 'passengers', 'pickupOffice', 'dropOffice', 'status', 'totalAmount', 'paidAmount', 'refundedAmount', 'createdAt'],
    rows.map((b) => {
      const l = T.toLocal(b.departAt);
      return [b.code, routes.get(b.routeId) || '', `${l.date} ${l.time}`, b.seats.map((s) => s.label).join(' '), b.seats.map((s) => s.passengerName).join(' | '), offices.get(b.pickupOfficeId) || '', offices.get(b.dropOfficeId) || '', b.status, b.totalAmount, b.paidAmount || 0, b.refundedAmount || 0, iso(b.createdAt)];
    }),
  );
}

module.exports = { purgeOperator, purgeCustomer, assertDeletable, myData, exportMine, toCsv };
