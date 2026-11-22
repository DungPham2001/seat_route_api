/**
 * MongoDB collections of the `seatroute` database. Multi-tenant: every operator-owned document carries `operatorId`
 * (added by lib/tenantPlugin.js from the request's operator).
 * Primary keys are UUID strings, money is whole dong (integers), instants are UTC Dates and local dates are
 * "yyyy-MM-dd" strings in the operator's timezone. Simple catalog tables (offices, vehicles, routes, staff...)
 * are declared in `src/resources/defs.js` and merged into this module's exports.
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;

const Mixed = Schema.Types.Mixed;

/** Collections shared by every operator: logins, sessions, idempotency keys, per-account notifications. */
const SHARED = new Set(['accounts', 'sessions', 'password_resets', 'receipts', 'rate_hits', 'notifications']);

const make = (name, collection, def, indexes = []) => {
  const s = new Schema(def, { collection, versionKey: false, minimize: false });
  for (const [spec, opts] of indexes) s.index(spec, opts);
  if (!SHARED.has(collection)) s.plugin(require('../lib/tenantPlugin'));
  return mongoose.model(name, s);
};
const stamps = { createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } };

// ---------- accounts & sessions ----------

/** One login. role: admin (an operator's owner/staff; `POST /auth/register` default) | customer (a passenger). */
const Account = make('Account', 'accounts', {
  _id: String,
  email: { type: String, default: null }, // optional; unique when present
  passwordHash: { type: String, required: true },
  displayName: { type: String, required: true },
  phone: { type: String, default: null }, // normalized 0xxxxxxxxx; required for customers, a sign-in identifier
  role: { type: String, enum: ['customer', 'admin'], required: true },
  operatorId: { type: String, default: null }, // admin: the operator (nhà xe) it owns; customer created by an operator: that operator
  preferredLanguage: { type: String, enum: ['vi', 'en'], default: 'vi' },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  suspendReason: { type: String, default: null },
  birthDate: { type: String, default: null },
  gender: { type: String, default: null },
  avatarColor: { type: String, default: null },
  referralCode: { type: String, default: null },
  adminNote: { type: String, default: '' },
  onboardingMarks: { type: [String], default: [] },
  search: { type: String, default: '' },
  termsAcceptedAt: Date,
  passwordChangedAt: Date,
  lastLoginAt: Date,
  ...stamps,
}, [
  [{ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } }],
  [{ referralCode: 1 }, { unique: true, partialFilterExpression: { referralCode: { $type: 'string' } } }],
  [{ role: 1, createdAt: -1 }, {}],
  [{ operatorId: 1, role: 1 }, {}],
  [{ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } }], // phone is a sign-in identifier
]);

/** A signed-in device. Holds the hash of the current refresh token and of the previous one. */
const Session = make('Session', 'sessions', {
  _id: String,
  accountId: { type: String, required: true },
  name: { type: String, default: '' },
  clientDeviceId: { type: String, default: null },
  refreshHash: { type: String, required: true },
  prevRefreshHash: { type: String, default: null },
  refreshExpiresAt: { type: Date, required: true },
  absoluteExpiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, default: null },
  expireAt: { type: Date, required: true },
}, [
  [{ accountId: 1, revokedAt: 1 }, {}],
  [{ expireAt: 1 }, { expireAfterSeconds: 0 }],
]);

const PasswordReset = make('PasswordReset', 'password_resets', {
  _id: String,
  accountId: { type: String, required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, [
  [{ codeHash: 1 }, { unique: true }],
  [{ accountId: 1 }, {}],
  [{ expiresAt: 1 }, { expireAfterSeconds: 86400 }],
]);

/** Idempotency receipts (`register|key`, `booking|account|key`, `proof|order|key`...). */
const Receipt = make('Receipt', 'receipts', {
  _id: String,
  result: Mixed,
  expireAt: { type: Date, required: true },
}, [[{ expireAt: 1 }, { expireAfterSeconds: 0 }]]);

const RateHit = make('RateHit', 'rate_hits', {
  _id: String,
  count: { type: Number, default: 0 },
  expireAt: Date,
}, [[{ expireAt: 1 }, { expireAfterSeconds: 0 }]]);

/** Singleton settings by key: operator, bank, cancelPolicy, rules, system, loyalty, referral, child, seatClasses... */
const Setting = make('Setting', 'settings', {
  _id: String,
  value: { type: Mixed, default: {} },
  updatedBy: { type: String, default: null },
  updatedAt: { type: Date, default: Date.now },
});

// ---------- trips & seats ----------

const TripSeries = make('TripSeries', 'trip_series', {
  _id: String,
  routeId: { type: String, required: true },
  vehicleId: { type: String, default: null },
  driverId: { type: String, default: null },
  weekdays: { type: [Number], default: [] }, // 0 = Sunday
  departTime: { type: String, required: true }, // HH:mm
  startDate: { type: String, required: true },
  endDate: { type: String, default: null },
  basePrice: { type: Number, required: true },
  prices: { type: Mixed, default: [] }, // [{ seatClass, price }]
  exceptions: { type: Mixed, default: [] }, // [{ date, type: skip|retime, newDepartTime, note }]
  generatedUntil: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  note: { type: String, default: '' },
  ...stamps,
}, [[{ isActive: 1 }, {}]]);

const Trip = make('Trip', 'trips', {
  _id: String,
  routeId: { type: String, required: true },
  vehicleId: { type: String, default: null },
  driverId: { type: String, default: null },
  departAt: { type: Date, required: true },
  date: { type: String, required: true }, // local yyyy-MM-dd
  departTime: { type: String, required: true }, // local HH:mm
  durationMinutes: { type: Number, default: 0 },
  status: { type: String, enum: ['scheduled', 'running', 'completed', 'cancelled'], default: 'scheduled' },
  salesClosed: { type: Boolean, default: false },
  salesOpenAt: { type: Date, default: null },
  salesCloseAt: { type: Date, default: null },
  seriesId: { type: String, default: null },
  basePrice: { type: Number, required: true },
  prices: { type: Mixed, default: [] },
  frontSurcharge: { type: Number, default: 0 }, // copied from the vehicle when the trip is created
  vipSurcharge: { type: Number, default: 0 },
  layout: { type: Mixed, default: null }, // { layoutId, name, rows, cols }
  seatCount: { type: Number, default: 0 },
  parcelCapacity: { type: Mixed, default: null }, // { maxKg, maxPieces }
  parcelLoad: { kg: { type: Number, default: 0 }, pieces: { type: Number, default: 0 } },
  actualDepartAt: { type: Date, default: null },
  actualArriveAt: { type: Date, default: null },
  driverPay: { type: Number, default: 0 },
  checklist: { type: Mixed, default: [] },
  shuttleDuties: { type: Mixed, default: [] },
  cancelReason: { type: String, default: null },
  overrideReason: { type: String, default: null },
  note: { type: String, default: '' },
  completedAt: { type: Date, default: null },
  ...stamps,
}, [
  [{ routeId: 1, departAt: 1 }, {}],
  [{ date: 1, departAt: 1 }, {}],
  [{ vehicleId: 1, departAt: 1 }, {}],
  [{ driverId: 1, departAt: 1 }, {}],
  [{ seriesId: 1, date: 1 }, {}],
]);

/** One row per (trip, seat): `_id = "<tripId>:<seatId>"` makes the pair unique. Holding a seat is a conditional update free -> pending. */
const TripSeat = make('TripSeat', 'trip_seats', {
  _id: String,
  tripId: { type: String, required: true },
  seatId: { type: String, required: true },
  label: { type: String, required: true },
  row: Number,
  col: Number,
  seatClass: { type: String, default: 'standard' },
  isSellable: { type: Boolean, default: true },
  state: { type: String, enum: ['free', 'pending', 'sold', 'locked'], default: 'free' },
  bookingId: { type: String, default: null },
  bookingSeatId: { type: String, default: null },
  claimedAt: { type: Date, default: null },
  lockReason: { type: String, default: null },
}, [[{ tripId: 1, state: 1 }, {}], [{ bookingId: 1 }, {}]]);

const TripLog = make('TripLog', 'trip_logs', {
  _id: String,
  tripId: { type: String, required: true },
  kind: { type: String, enum: ['depart', 'arrive', 'delay', 'incident', 'note', 'notice'], required: true },
  atTime: { type: Date, default: Date.now },
  text: { type: String, default: '' },
  delayMinutes: { type: Number, default: null },
  visibleToCustomer: { type: Boolean, default: true },
  byAccountId: String,
  createdAt: { type: Date, default: Date.now },
}, [[{ tripId: 1, atTime: -1 }, {}]]);

// ---------- orders (bookings, parcels) ----------

const Booking = make('Booking', 'bookings', {
  _id: String,
  code: { type: String, required: true },
  tripId: { type: String, required: true },
  routeId: { type: String, required: true },
  departAt: { type: Date, required: true },
  customerAccountId: { type: String, default: null },
  guestContactId: { type: String, default: null },
  source: { type: String, enum: ['app', 'counter'], default: 'app' },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'rejected', 'cancel_requested', 'cancelled'],
    required: true,
  },
  seats: { type: Mixed, default: [] },
  pickupOfficeId: { type: String, required: true },
  dropOfficeId: { type: String, required: true },
  pickupShuttle: { type: Mixed, default: null },
  dropShuttle: { type: Mixed, default: null },
  amounts: { type: Mixed, default: {} },
  totalAmount: { type: Number, default: 0 },
  promoCode: { type: String, default: null },
  promotionId: { type: String, default: null },
  voucherId: { type: String, default: null },
  note: { type: String, default: '' },
  internalNotes: { type: Mixed, default: [] },
  confirmedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null }, // when the money was collected at the counter (null = approved but not paid yet)
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  payMethod: { type: String, default: null }, // how it was collected: cash | transfer | free (set when paid)
  compReason: { type: String, default: null },
  paidAmount: { type: Number, default: 0 },
  refundedAmount: { type: Number, default: 0 },
  cancelPolicySnapshot: { type: Mixed, default: null },
  notices: { type: Mixed, default: [] }, // office changed / trip changed flags for the customer
  pointsAwarded: { type: Number, default: 0 },
  search: { type: String, default: '' },
  createdBy: String,
  ...stamps,
}, [
  [{ code: 1 }, { unique: true }],
  [{ customerAccountId: 1, createdAt: -1 }, {}],
  [{ tripId: 1, status: 1 }, {}],
  [{ status: 1, createdAt: 1 }, {}],
  [{ guestContactId: 1 }, {}],
  [{ departAt: 1 }, {}],
  [{ status: 1, paidAt: 1, departAt: 1 }, {}],
]);

const Parcel = make('Parcel', 'parcels', {
  _id: String,
  code: { type: String, required: true },
  senderAccountId: { type: String, default: null },
  guestContactId: { type: String, default: null },
  source: { type: String, enum: ['app', 'admin'], default: 'app' },
  senderName: String,
  senderPhone: String,
  receiverName: String,
  receiverPhone: String,
  receiverAddress: { type: String, default: '' },
  routeId: { type: String, required: true },
  date: { type: String, required: true },
  tripId: { type: String, default: null },
  departAt: { type: Date, default: null },
  fromOfficeId: { type: String, required: true },
  toOfficeId: { type: String, required: true },
  categoryId: { type: String, default: null },
  descriptionText: { type: String, default: '' },
  pieceCount: { type: Number, default: 1 },
  weightKg: { type: Number, default: 0 },
  actualWeightKg: { type: Number, default: null },
  sizeClass: { type: String, enum: ['small', 'medium', 'large'], default: 'small' },
  declaredValue: { type: Number, default: 0 },
  note: { type: String, default: '' },
  pickupShuttle: { type: Mixed, default: null },
  dropShuttle: { type: Mixed, default: null },
  estimate: { type: Mixed, default: null }, // fee breakdown at request time
  fee: { type: Number, default: 0 },
  feeBreakdown: { type: Mixed, default: null }, // final, set when the admin accepts
  feeAdjustReason: { type: String, default: null },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'received', 'loaded', 'arrived', 'delivered', 'cancelled', 'rejected', 'issue'],
    default: 'pending',
  },
  payMethod: { type: String, default: null }, // cash | transfer: the fee is paid at the office when the goods are received
  paidAmount: { type: Number, default: 0 },
  refundedAmount: { type: Number, default: 0 },
  rejectReason: { type: String, default: null },
  cancelReason: { type: String, default: null },
  handoverCodeHash: { type: String, default: null },
  handoverFailures: { type: Number, default: 0 },
  unclaimed: { type: Boolean, default: false },
  arrivedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  commitAccepted: { type: Boolean, default: false },
  policySnapshot: { type: Mixed, default: null },
  internalNotes: { type: Mixed, default: [] },
  search: { type: String, default: '' },
  createdBy: String,
  ...stamps,
}, [
  [{ code: 1 }, { unique: true }],
  [{ senderAccountId: 1, createdAt: -1 }, {}],
  [{ status: 1, createdAt: 1 }, {}],
  [{ tripId: 1 }, {}],
]);

/** Money received, recorded in the app: cash or direct transfer collected at the counter, or a free (comp) seat. */
const PaymentRecord = make('PaymentRecord', 'payment_records', {
  _id: String,
  orderType: { type: String, enum: ['booking', 'parcel'], required: true },
  orderId: { type: String, required: true },
  source: { type: String, default: 'app' },
  method: { type: String, enum: ['cash', 'transfer', 'free'], required: true },
  amount: { type: Number, default: 0 },
  compValue: { type: Number, default: 0 },
  reason: { type: String, default: null },
  note: { type: String, default: '' },
  tripId: String,
  routeId: String,
  vehicleId: String,
  departAt: Date,
  recordedBy: String,
  recordedAt: { type: Date, default: Date.now },
}, [[{ recordedAt: 1 }, {}], [{ orderType: 1, orderId: 1 }, {}], [{ tripId: 1 }, {}]]);

/** Refund to record: the operator transfers money outside the app, the app only records it. */
const Refund = make('Refund', 'refunds', {
  _id: String,
  orderType: { type: String, enum: ['booking', 'parcel'], required: true },
  orderId: { type: String, required: true },
  orderCode: String,
  accountId: { type: String, default: null },
  amount: { type: Number, required: true },
  reason: { type: String, default: 'cancel' },
  status: { type: String, enum: ['pending', 'recorded'], default: 'pending' },
  tripId: String,
  routeId: String,
  note: { type: String, default: '' },
  recordedBy: { type: String, default: null },
  recordedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, [[{ status: 1, createdAt: 1 }, {}], [{ orderType: 1, orderId: 1 }, {}], [{ accountId: 1 }, {}]]);

/** History of an order (BookingChange / ParcelEvent): who did what and when. */
const OrderEvent = make('OrderEvent', 'order_events', {
  _id: String,
  orderType: { type: String, required: true },
  orderId: { type: String, required: true },
  at: { type: Date, default: Date.now },
  byAccountId: { type: String, default: null },
  byRole: { type: String, default: null },
  kind: { type: String, required: true },
  oldValue: { type: Mixed, default: null },
  newValue: { type: Mixed, default: null },
  note: { type: String, default: '' },
  internal: { type: Boolean, default: false },
}, [[{ orderType: 1, orderId: 1, at: 1 }, {}]]);

/** Customer request on a confirmed booking: cancel (the admin approves it and records the refund). */
const OrderRequest = make('OrderRequest', 'order_requests', {
  _id: String,
  orderType: { type: String, default: 'booking' },
  orderId: { type: String, required: true },
  orderCode: String,
  accountId: { type: String, default: null },
  type: { type: String, enum: ['cancel'], required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'withdrawn'], default: 'pending' },
  payload: { type: Mixed, default: {} },
  priceDiff: { type: Number, default: 0 },
  refundPreview: { type: Mixed, default: null },
  note: { type: String, default: '' },
  decidedBy: { type: String, default: null },
  decidedAt: { type: Date, default: null },
  decisionNote: { type: String, default: '' },
  tripId: String,
  departAt: Date,
  createdAt: { type: Date, default: Date.now },
}, [[{ status: 1, type: 1, createdAt: 1 }, {}], [{ orderId: 1 }, {}], [{ accountId: 1, createdAt: -1 }, {}]]);

// ---------- customer side ----------

const Notification = make('Notification', 'notifications', {
  _id: String,
  accountId: { type: String, required: true },
  category: { type: String, enum: ['order', 'trip', 'parcel', 'promo', 'system'], required: true },
  kind: { type: String, required: true },
  refType: { type: String, default: null },
  refId: { type: String, default: null },
  params: { type: Mixed, default: {} },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, [[{ accountId: 1, createdAt: -1 }, {}], [{ accountId: 1, readAt: 1 }, {}]]);

/** Chat inside a booking between the customer and the admins (text only). */
const Message = make('Message', 'messages', {
  _id: String,
  bookingId: { type: String, required: true },
  senderAccountId: { type: String, required: true },
  senderRole: { type: String, required: true },
  text: { type: String, required: true },
  status: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
  readAt: { type: Date, default: null },
  at: { type: Date, default: Date.now },
}, [[{ bookingId: 1, at: 1 }, {}], [{ senderRole: 1, readAt: 1 }, {}]]);

const Review = make('Review', 'reviews', {
  _id: String,
  bookingId: { type: String, required: true },
  accountId: { type: String, required: true },
  tripId: String,
  routeId: String,
  stars: { type: Number, required: true },
  text: { type: String, default: '' },
  reply: { type: String, default: null },
  repliedAt: { type: Date, default: null },
  status: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
  ...stamps,
}, [[{ bookingId: 1 }, { unique: true }], [{ accountId: 1 }, {}], [{ status: 1, createdAt: -1 }, {}]]);

const Report = make('Report', 'reports', {
  _id: String,
  reporterAccountId: { type: String, required: true },
  targetType: { type: String, enum: ['review', 'message'], required: true },
  targetId: { type: String, required: true },
  reason: { type: String, required: true },
  text: { type: String, default: '' },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  action: { type: String, default: null },
  resolution: { type: String, default: null },
  resolvedBy: { type: String, default: null },
  resolvedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, [[{ status: 1, createdAt: 1 }, {}]]);

const Complaint = make('Complaint', 'complaints', {
  _id: String,
  orderType: { type: String, enum: ['booking', 'parcel'], required: true },
  orderId: { type: String, required: true },
  orderCode: String,
  accountId: { type: String, required: true },
  category: { type: String, default: 'other' },
  text: { type: String, required: true },
  status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
  replies: { type: Mixed, default: [] },
  resolution: { type: String, default: null },
  resolvedBy: { type: String, default: null },
  resolvedAt: { type: Date, default: null },
  ...stamps,
}, [[{ status: 1, createdAt: 1 }, {}], [{ accountId: 1, createdAt: -1 }, {}]]);

/** "Liên hệ nhà xe" form (feature 108) -> admin inbox (236). */
const ContactMessage = make('ContactMessage', 'contact_messages', {
  _id: String,
  accountId: { type: String, required: true },
  subject: { type: String, default: '' },
  text: { type: String, required: true },
  status: { type: String, enum: ['open', 'replied', 'closed'], default: 'open' },
  reply: { type: String, default: null },
  repliedBy: { type: String, default: null },
  repliedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, [[{ status: 1, createdAt: 1 }, {}], [{ accountId: 1 }, {}]]);

/** What admins did with reports, complaints and suspended accounts (not a system log). */
const AdminAction = make('AdminAction', 'admin_actions', {
  _id: String,
  adminAccountId: String,
  targetType: String,
  targetId: String,
  action: String,
  note: { type: String, default: '' },
  at: { type: Date, default: Date.now },
}, [[{ targetType: 1, targetId: 1, at: -1 }, {}], [{ at: -1 }, {}]]);

/** Append-only points ledger (balance = sum). Never converted to cash. */
const LoyaltyEntry = make('LoyaltyEntry', 'loyalty_entries', {
  _id: String,
  accountId: { type: String, required: true },
  points: { type: Number, required: true },
  reason: { type: String, required: true },
  refType: String,
  refId: String,
  at: { type: Date, default: Date.now },
}, [[{ accountId: 1, at: -1 }, {}]]);

const Voucher = make('Voucher', 'vouchers', {
  _id: String,
  accountId: { type: String, required: true },
  promotionId: { type: String, required: true },
  status: { type: String, enum: ['active', 'used'], default: 'active' },
  source: { type: String, default: 'admin' },
  orderId: { type: String, default: null },
  receivedAt: { type: Date, default: Date.now },
  usedAt: { type: Date, default: null },
}, [[{ accountId: 1, status: 1 }, {}], [{ accountId: 1, promotionId: 1 }, {}]]);

const Referral = make('Referral', 'referrals', {
  _id: String,
  referrerAccountId: { type: String, required: true },
  referredAccountId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'rewarded'], default: 'pending' },
  rewardedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, [[{ referredAccountId: 1 }, { unique: true }], [{ referrerAccountId: 1 }, {}]]);

const FavoriteRoute = make('FavoriteRoute', 'favorite_routes', {
  _id: String,
  accountId: { type: String, required: true },
  routeId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, [[{ accountId: 1, routeId: 1 }, { unique: true }]]);

const Waitlist = make('Waitlist', 'waitlist', {
  _id: String,
  tripId: { type: String, required: true },
  accountId: { type: String, required: true },
  seatCount: { type: Number, default: 1 },
  note: { type: String, default: '' },
  status: { type: String, enum: ['waiting', 'contacted', 'fulfilled', 'cancelled'], default: 'waiting' },
  notifiedAt: { type: Date, default: null },
  ...stamps,
}, [[{ tripId: 1, status: 1, createdAt: 1 }, {}], [{ accountId: 1, createdAt: -1 }, {}]]);

module.exports = {
  Account, Session, PasswordReset, Receipt, RateHit, Setting,
  TripSeries, Trip, TripSeat, TripLog,
  Booking, Parcel, PaymentRecord, Refund, OrderEvent, OrderRequest,
  Notification, Message, Review, Report, Complaint, ContactMessage, AdminAction,
  LoyaltyEntry, Voucher, Referral, Waitlist, FavoriteRoute,
};

// Catalog tables declared as resources (offices, vehicles, routes, staff, promotions...).
Object.assign(module.exports, require('../resources/defs').models);
