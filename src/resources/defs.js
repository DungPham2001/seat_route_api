/**
 * Catalog tables and saved customer data, declared once (see engine.js). `path` is where the CRUD router is
 * mounted under /v1; `role` is who may use it (admin = /manage and /admin, customer = /me/...).
 */
const mongoose = require('mongoose');
const { defineResource } = require('./engine');
const { invalid, conflict } = require('../lib/errors');
const { noAccent } = require('../lib/util');

// Services are required when called (not at load time): they depend on the models built here.
const svc = (p) => require(p); // eslint-disable-line global-require

const R = {};
const add = (key, def) => {
  R[key] = { ...defineResource(def), path: def.path, role: def.role };
};

// ---------- geography & offices (207, 213, 219) ----------

add('provinces', {
  model: 'Province', collection: 'provinces', path: '/admin/provinces', role: 'admin',
  fields: {
    name: { type: 'string', required: true, max: 80 },
    nameNoAccent: { type: 'string', readOnly: true },
    sortOrder: { type: 'int', def: 0, max: 10000 },
    isActive: { type: 'bool', def: true },
  },
  search: ['name'], filters: ['isActive'], sort: { sortOrder: 1, name: 1 }, pageSize: 200,
  unique: [['name']],
  validate: async (d, ctx) => {
    if (d.name !== undefined) d.nameNoAccent = noAccent(d.name || ctx.existing?.name);
  },
  dependents: [
    { model: 'Office', field: 'provinceId', label: 'offices' },
    { model: 'Route', field: 'fromProvinceId', label: 'routes' },
    { model: 'Route', field: 'toProvinceId', label: 'routes' },
  ],
});

add('offices', {
  model: 'Office', collection: 'offices', path: '/manage/offices', role: 'admin',
  fields: {
    provinceId: { type: 'ref', ref: 'Province', required: true },
    name: { type: 'string', required: true, max: 100 },
    address: { type: 'string', required: true, max: 300 },
    phone: { type: 'phone', normalize: false },
    openText: { type: 'string', max: 200 },
    directionNote: { type: 'text', max: 1000 },
    isActive: { type: 'bool', def: true },
    sortOrder: { type: 'int', def: 0, max: 10000 },
  },
  search: ['name', 'address'], filters: ['provinceId', 'isActive'], sort: { sortOrder: 1, name: 1 }, pageSize: 200,
  dependents: [
    { model: 'ShuttleZone', field: 'officeId', label: 'shuttleZones' },
    { model: 'Route', field: 'offices.officeId', label: 'routes' },
    { model: 'Booking', field: 'pickupOfficeId', label: 'bookings' },
    { model: 'Booking', field: 'dropOfficeId', label: 'bookings' },
    { model: 'Parcel', field: 'fromOfficeId', label: 'parcels' },
    { model: 'Parcel', field: 'toOfficeId', label: 'parcels' },
  ],
  // Closing an office never changes old bookings silently: the admin and the customers are told (spec 207/212).
  afterWrite: async (doc, before, ctx) => {
    if (before && before.isActive && doc.isActive === false) await svc('../services/notify').officeClosed(doc, ctx.auth);
  },
});

add('shuttleZones', {
  model: 'ShuttleZone', collection: 'shuttle_zones', path: '/manage/shuttle-zones', role: 'admin',
  fields: {
    officeId: { type: 'ref', ref: 'Office', required: true },
    name: { type: 'string', required: true, max: 100 },
    pickupEnabled: { type: 'bool', def: true },
    dropEnabled: { type: 'bool', def: true },
    fee: { type: 'money', def: 0 },
    leadMinutes: { type: 'int', def: 30, max: 600 },
    dropMinutes: { type: 'int', def: 30, max: 600 },
    isActive: { type: 'bool', def: true },
    note: { type: 'string', max: 300 },
  },
  search: ['name'], filters: ['officeId', 'isActive'], sort: { name: 1 }, pageSize: 200,
});

// ---------- vehicles & seat layouts (185-193) ----------

const seatFields = {
  id: { type: 'string', required: true, max: 10, pattern: /^[A-Za-z0-9_-]+$/ },
  label: { type: 'string', required: true, max: 10 },
  row: { type: 'int', required: true, max: 30 },
  col: { type: 'int', required: true, max: 10 },
  seatClass: { type: 'string', def: 'standard', max: 30 },
  isSellable: { type: 'bool', def: true },
};

add('seatLayouts', {
  model: 'SeatLayout', collection: 'seat_layouts', path: '/manage/seat-layouts', role: 'admin',
  fields: {
    name: { type: 'string', required: true, max: 80 },
    rows: { type: 'int', required: true, min: 1, max: 30 },
    cols: { type: 'int', required: true, min: 1, max: 10 },
    seats: { type: 'objects', required: true, of: seatFields, maxItems: 80 },
    note: { type: 'string', max: 300 },
  },
  search: ['name'], sort: { name: 1 },
  validate: async (d, ctx) => {
    const rows = d.rows ?? ctx.existing?.rows;
    const cols = d.cols ?? ctx.existing?.cols;
    const seats = d.seats ?? ctx.existing?.seats ?? [];
    const bad = [];
    const ids = new Set();
    const cells = new Set();
    seats.forEach((s, i) => {
      if (!s) return;
      if (ids.has(s.id)) bad.push({ field: `seats[${i}].id`, code: 'duplicate' });
      if (cells.has(`${s.row}:${s.col}`)) bad.push({ field: `seats[${i}].col`, code: 'duplicate' });
      if (s.row >= rows) bad.push({ field: `seats[${i}].row`, code: 'out_of_range' });
      if (s.col >= cols) bad.push({ field: `seats[${i}].col`, code: 'out_of_range' });
      ids.add(s.id);
      cells.add(`${s.row}:${s.col}`);
    });
    if (!seats.some((s) => s?.isSellable)) bad.push({ field: 'seats', code: 'required' });
    if (bad.length) throw invalid(bad);
  },
  dependents: [{ model: 'Vehicle', field: 'layoutId', label: 'vehicles' }],
});

add('vehicles', {
  model: 'Vehicle', collection: 'vehicles', path: '/manage/vehicles', role: 'admin',
  fields: {
    plateNo: { type: 'string', required: true, max: 20 },
    kindLabel: { type: 'string', required: true, max: 80 },
    layoutId: { type: 'ref', ref: 'SeatLayout', required: true },
    seatCount: { type: 'int', readOnly: true },
    year: { type: 'int', min: 1980, max: 2100 },
    colorText: { type: 'string', max: 40 },
    status: { type: 'enum', values: ['active', 'maintenance', 'retired'], def: 'active' },
    defaultDriverId: { type: 'ref', ref: 'StaffMember' },
    amenities: { type: 'strings', max: 40, maxItems: 20 },
    docDates: {
      type: 'objects', maxItems: 10,
      of: { kind: { type: 'enum', values: ['registration', 'insurance', 'other'], required: true }, label: { type: 'string', max: 80 }, expiresOn: { type: 'date', required: true } },
    },
    parcelMaxKg: { type: 'number', max: 5000 },
    parcelMaxPieces: { type: 'int', max: 1000 },
    note: { type: 'text', max: 1000 },
  },
  search: ['plateNo', 'kindLabel'], filters: ['status', 'layoutId'], sort: { plateNo: 1 },
  unique: [['plateNo']],
  validate: async (d) => {
    if (d.layoutId) {
      const layout = await mongoose.model('SeatLayout').findById(d.layoutId).lean();
      d.seatCount = (layout?.seats || []).filter((s) => s.isSellable).length;
    }
  },
  dependents: [{ model: 'Trip', field: 'vehicleId', label: 'trips' }],
});

add('maintenance', {
  model: 'MaintenanceLog', collection: 'maintenance_logs', path: '/manage/maintenance', role: 'admin',
  fields: {
    vehicleId: { type: 'ref', ref: 'Vehicle', required: true },
    date: { type: 'date', required: true },
    description: { type: 'string', required: true, max: 300 },
    cost: { type: 'money', def: 0 },
    nextDueOn: { type: 'date' },
    note: { type: 'text', max: 1000 },
  },
  search: ['description'], filters: ['vehicleId'], dateField: 'date', sort: { date: -1 },
});

// ---------- staff & drivers: profiles only, no accounts (194-202) ----------

add('staff', {
  model: 'StaffMember', collection: 'staff', path: '/admin/staff', role: 'admin',
  fields: {
    kind: { type: 'enum', values: ['limo_driver', 'shuttle_driver', 'office_staff'], required: true },
    name: { type: 'string', required: true, max: 80 },
    phone: { type: 'phone', normalize: false },
    positionText: { type: 'string', max: 80 },
    officeId: { type: 'ref', ref: 'Office' },
    joinedOn: { type: 'date' },
    licenseClassText: { type: 'string', max: 20 },
    licenseExpiresOn: { type: 'date' },
    status: { type: 'enum', values: ['active', 'left'], def: 'active' },
    payPerTrip: { type: 'money', def: 0 },
    note: { type: 'text', max: 1000 },
  },
  search: ['name', 'phone'], filters: ['kind', 'status', 'officeId'], sort: { name: 1 },
  dependents: [
    { model: 'Trip', field: 'driverId', label: 'trips' },
    { model: 'Vehicle', field: 'defaultDriverId', label: 'vehicles' },
  ],
  beforeDelete: async (doc) => {
    await mongoose.model('StaffSchedule').deleteMany({ staffId: doc._id });
  },
});

add('staffSchedules', {
  model: 'StaffSchedule', collection: 'staff_schedules', path: '/admin/staff-schedules', role: 'admin',
  fields: {
    staffId: { type: 'ref', ref: 'StaffMember', required: true },
    date: { type: 'date', required: true },
    kind: { type: 'enum', values: ['work', 'off'], required: true },
    shift: { type: 'enum', values: ['morning', 'afternoon', 'night', 'full'], def: 'full' },
    officeId: { type: 'ref', ref: 'Office' },
    note: { type: 'string', max: 300 },
  },
  filters: ['staffId', 'kind', 'shift', 'officeId'], dateField: 'date', sort: { date: 1 }, pageSize: 200,
  unique: [['staffId', 'date', 'shift']],
});

// ---------- routes (210-219) ----------

add('routes', {
  model: 'Route', collection: 'routes', path: '/manage/routes', role: 'admin',
  fields: {
    name: { type: 'string', max: 120 },
    fromProvinceId: { type: 'ref', ref: 'Province', required: true },
    toProvinceId: { type: 'ref', ref: 'Province', required: true },
    durationMinutes: { type: 'int', required: true, min: 10, max: 2880 },
    status: { type: 'enum', values: ['active', 'paused'], def: 'active' },
    basePrice: { type: 'money', def: 0 },
    stops: { type: 'objects', maxItems: 30, of: { name: { type: 'string', required: true, max: 100 }, sortOrder: { type: 'int', def: 0 }, offsetMinutes: { type: 'int', def: 0, max: 2880 } } },
    offices: {
      type: 'objects', maxItems: 40,
      of: {
        officeId: { type: 'ref', ref: 'Office', required: true },
        side: { type: 'enum', values: ['pickup', 'drop'], required: true },
        offsetMinutes: { type: 'int', required: true, max: 2880 },
        sortOrder: { type: 'int', def: 0 },
      },
    },
    shuttleEnabled: { type: 'bool', def: true },
    parcelEnabled: { type: 'bool', def: false },
    usefulInfo: { type: 'text', max: 3000 },
    note: { type: 'text', max: 1000 },
  },
  search: ['name'], filters: ['status', 'fromProvinceId', 'toProvinceId'], sort: { name: 1 },
  validate: (d, ctx) => svc('../services/routes').validateRoute(d, ctx),
  dependents: [
    { model: 'Trip', field: 'routeId', label: 'trips' },
    { model: 'TripSeries', field: 'routeId', label: 'series' },
    { model: 'ParcelRate', field: 'routeId', label: 'parcelRates' },
  ],
});

// ---------- promotions & pricing (227-229) ----------

add('promotions', {
  model: 'Promotion', collection: 'promotions', path: '/admin/promotions', role: 'admin',
  fields: {
    code: { type: 'string', required: true, max: 20, pattern: /^[A-Za-z0-9_-]{3,20}$/ },
    title: { type: 'string', max: 120 },
    description: { type: 'text', max: 1000 },
    kind: { type: 'enum', values: ['percent', 'amount'], required: true },
    value: { type: 'int', required: true, min: 1, max: 100_000_000 },
    maxDiscount: { type: 'money' },
    minAmount: { type: 'money', def: 0 },
    startAt: { type: 'datetime' },
    endAt: { type: 'datetime' },
    usageLimit: { type: 'int', min: 1 },
    perUserLimit: { type: 'int', def: 1, min: 1 },
    usedCount: { type: 'int', readOnly: true, def: 0 },
    audience: { type: 'enum', values: ['public', 'wallet'], def: 'public' },
    routeId: { type: 'ref', ref: 'Route' },
    isActive: { type: 'bool', def: true },
  },
  search: ['code', 'title'], filters: ['isActive', 'audience'], sort: { createdAt: -1 },
  unique: [['code']],
  validate: async (d, ctx) => {
    if (d.code) d.code = d.code.toUpperCase();
    const kind = d.kind ?? ctx.existing?.kind;
    const value = d.value ?? ctx.existing?.value;
    if (kind === 'percent' && value > 100) throw invalid([{ field: 'value', code: 'out_of_range' }]);
    const s = d.startAt ?? ctx.existing?.startAt;
    const e = d.endAt ?? ctx.existing?.endAt;
    if (s && e && new Date(e) <= new Date(s)) throw invalid([{ field: 'endAt', code: 'out_of_range' }]);
    if (!ctx.existing) d.usedCount = 0;
  },
  dependents: [{ model: 'Booking', field: 'promotionId', label: 'bookings' }],
  beforeDelete: async (doc) => {
    await mongoose.model('Voucher').deleteMany({ promotionId: doc._id, status: 'active' });
  },
});

add('seasonalPrices', {
  model: 'SeasonalPrice', collection: 'seasonal_prices', path: '/admin/seasonal-prices', role: 'admin',
  fields: {
    name: { type: 'string', required: true, max: 100 },
    routeId: { type: 'ref', ref: 'Route' },
    fromDate: { type: 'date', required: true },
    toDate: { type: 'date', required: true },
    adjustKind: { type: 'enum', values: ['percent', 'amount'], required: true },
    adjustValue: { type: 'int', required: true, min: -10_000_000, max: 10_000_000 },
    isActive: { type: 'bool', def: true },
  },
  search: ['name'], filters: ['routeId', 'isActive'], sort: { fromDate: -1 },
  validate: async (d, ctx) => {
    const from = d.fromDate ?? ctx.existing?.fromDate;
    const to = d.toDate ?? ctx.existing?.toDate;
    if (from && to && to < from) throw invalid([{ field: 'toDate', code: 'out_of_range' }]);
  },
});

// ---------- content (237, 238) ----------

add('announcements', {
  model: 'Announcement', collection: 'announcements', path: '/admin/announcements', role: 'admin',
  fields: {
    title: { type: 'string', required: true, max: 150 },
    body: { type: 'text', required: true, max: 5000 },
    kind: { type: 'enum', values: ['news', 'schedule', 'holiday', 'info', 'promo'], def: 'news' },
    routeId: { type: 'ref', ref: 'Route' },
    startAt: { type: 'datetime' },
    endAt: { type: 'datetime' },
    isPublished: { type: 'bool', def: true },
    notify: { type: 'bool', def: true },
  },
  search: ['title'], filters: ['kind', 'isPublished'], sort: { createdAt: -1 },
  afterWrite: async (doc, before) => {
    if (doc.isPublished && doc.notify && (!before || !before.isPublished)) await svc('../services/notify').announcement(doc);
  },
});

add('faq', {
  model: 'FaqItem', collection: 'faq_items', path: '/admin/faq', role: 'admin',
  fields: {
    language: { type: 'enum', values: ['vi', 'en'], required: true },
    category: { type: 'enum', values: ['booking', 'payment', 'parcel', 'account', 'other'], def: 'other' },
    question: { type: 'string', required: true, max: 300 },
    answer: { type: 'text', required: true, max: 5000 },
    sortOrder: { type: 'int', def: 0 },
    isActive: { type: 'bool', def: true },
  },
  search: ['question'], filters: ['language', 'category', 'isActive'], sort: { sortOrder: 1 }, pageSize: 200,
});

add('checklistItems', {
  model: 'ChecklistItem', collection: 'checklist_items', path: '/admin/checklist-items', role: 'admin',
  fields: {
    title: { type: 'string', required: true, max: 200 },
    sortOrder: { type: 'int', def: 0 },
    isActive: { type: 'bool', def: true },
  },
  filters: ['isActive'], sort: { sortOrder: 1 }, pageSize: 200,
});

// ---------- parcels (220-224) ----------

add('parcelCategories', {
  model: 'ParcelCategory', collection: 'parcel_categories', path: '/admin/parcel-categories', role: 'admin',
  fields: {
    name: { type: 'string', required: true, max: 100 },
    isProhibited: { type: 'bool', def: false },
    note: { type: 'text', max: 1000 },
    packingNote: { type: 'text', max: 1000 },
    sortOrder: { type: 'int', def: 0 },
  },
  search: ['name'], filters: ['isProhibited'], sort: { isProhibited: 1, sortOrder: 1, name: 1 }, pageSize: 200,
  dependents: [{ model: 'Parcel', field: 'categoryId', label: 'parcels' }],
});

add('parcelRates', {
  model: 'ParcelRate', collection: 'parcel_rates', path: '/admin/parcel-rates', role: 'admin',
  fields: {
    routeId: { type: 'ref', ref: 'Route', required: true },
    sizeClass: { type: 'enum', values: ['small', 'medium', 'large'], required: true },
    maxWeightKg: { type: 'number', required: true, min: 0.1, max: 5000 },
    price: { type: 'money', required: true },
    extraPerKg: { type: 'money', def: 0 },
    declaredValuePercent: { type: 'number', def: 0, max: 100 },
  },
  filters: ['routeId', 'sizeClass'], sort: { routeId: 1, sizeClass: 1, maxWeightKg: 1 }, pageSize: 200,
  unique: [['routeId', 'sizeClass', 'maxWeightKg']],
});

// ---------- guests booked by the admin (135, 136) ----------

add('guests', {
  model: 'GuestContact', collection: 'guest_contacts', path: '/admin/guests', role: 'admin',
  fields: {
    name: { type: 'string', required: true, max: 80 },
    phone: { type: 'phone', required: true },
    note: { type: 'text', max: 1000 },
    linkedAccountId: { type: 'string', readOnly: true },
  },
  search: ['name', 'phone'], filters: ['phone', 'linkedAccountId'], sort: { createdAt: -1 },
  unique: [['phone']],
  dependents: [
    { model: 'Booking', field: 'guestContactId', label: 'bookings' },
    { model: 'Parcel', field: 'guestContactId', label: 'parcels' },
  ],
});

// ---------- trip expenses (241) ----------

add('tripExpenses', {
  model: 'TripExpense', collection: 'trip_expenses', path: '/manage/trips/:tripId/expenses', role: 'admin',
  parent: { param: 'tripId', field: 'tripId', model: 'Trip' },
  fields: {
    category: { type: 'enum', values: ['fuel', 'toll', 'food', 'driver_pay', 'parking', 'repair', 'other'], required: true },
    amount: { type: 'money', required: true },
    note: { type: 'string', max: 300 },
  },
  filters: ['category'], sort: { createdAt: 1 },
});

// ---------- saved data in the customer's Profile (83, 84, 86, 87) ----------

add('passengers', {
  model: 'SavedPassenger', collection: 'saved_passengers', path: '/me/passengers', role: 'customer', owner: 'accountId',
  fields: {
    name: { type: 'string', required: true, max: 80 },
    phone: { type: 'phone', normalize: false },
    note: { type: 'string', max: 300 },
    isChild: { type: 'bool', def: false },
  },
  search: ['name', 'phone'], sort: { name: 1 },
});

add('addresses', {
  model: 'SavedAddress', collection: 'saved_addresses', path: '/me/addresses', role: 'customer', owner: 'accountId',
  fields: {
    label: { type: 'string', required: true, max: 40 },
    zoneId: { type: 'ref', ref: 'ShuttleZone' },
    addressText: { type: 'string', required: true, max: 300 },
    noteText: { type: 'string', max: 300 },
  },
  search: ['label', 'addressText'], sort: { createdAt: 1 },
});

add('receivers', {
  model: 'SavedReceiver', collection: 'saved_receivers', path: '/me/receivers', role: 'customer', owner: 'accountId',
  fields: {
    name: { type: 'string', required: true, max: 80 },
    phone: { type: 'phone', required: true, normalize: false },
    addressText: { type: 'string', max: 300 },
    note: { type: 'string', max: 300 },
  },
  search: ['name', 'phone'], sort: { name: 1 },
});

add('favorites', {
  model: 'Favorite', collection: 'favorites', path: '/me/favorites', role: 'customer', owner: 'accountId',
  fields: {
    kind: { type: 'enum', values: ['route', 'office'], required: true },
    fromProvinceId: { type: 'ref', ref: 'Province' },
    toProvinceId: { type: 'ref', ref: 'Province' },
    officeId: { type: 'ref', ref: 'Office' },
    label: { type: 'string', max: 80 },
  },
  filters: ['kind'], sort: { createdAt: 1 },
  validate: async (d, ctx) => {
    const kind = d.kind ?? ctx.existing?.kind;
    if (kind === 'route' && !(d.fromProvinceId ?? ctx.existing?.fromProvinceId)) throw invalid([{ field: 'fromProvinceId', code: 'required' }]);
    if (kind === 'route' && !(d.toProvinceId ?? ctx.existing?.toProvinceId)) throw invalid([{ field: 'toProvinceId', code: 'required' }]);
    if (kind === 'office' && !(d.officeId ?? ctx.existing?.officeId)) throw invalid([{ field: 'officeId', code: 'required' }]);
    if (!ctx.existing) {
      const n = await mongoose.model('Favorite').countDocuments({ accountId: ctx.auth.accountId });
      if (n >= 50) throw conflict('limit_reached');
    }
  },
});

const models = Object.fromEntries(Object.values(R).map((r) => [r.def.model, r.model]));

module.exports = { resources: R, models };
