process.env.NODE_ENV = 'test';
const fs = require('fs');
// Tests never read the developer's .env (real SMTP, cron secret, Atlas URI): blank every key it defines,
// dotenv does not override variables that already exist.
try {
  for (const k of Object.keys(require('dotenv').parse(fs.readFileSync(require('path').join(__dirname, '..', '.env'))))) {
    if (!(k in process.env)) process.env[k] = '';
  }
} catch { /* no .env */ }
// Offline machines: reuse a locally installed mongod instead of downloading one.
if (!process.env.MONGOMS_SYSTEM_BINARY && fs.existsSync('/opt/homebrew/bin/mongod')) {
  process.env.MONGOMS_SYSTEM_BINARY = '/opt/homebrew/bin/mongod';
  process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || '9.0.4';
}

// The passenger endpoints are off by default (Wayra Fleet is operator-only); the older tests still exercise them.
process.env.CUSTOMERS_ENABLED = '1';
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const app = require('../src/app');
const models = require('../src/models');
const settings = require('../src/services/settings');
const { uuid, noAccent } = require('../src/lib/util');
const password = require('../src/lib/password');
const T = require('../src/lib/time');

let rs;

async function start() {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, configSettings: { electionTimeoutMillis: 10000 } } });
  mongoose.set('strictQuery', true);
  await mongoose.connect(rs.getUri());
  for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
}
async function stop() {
  await mongoose.disconnect();
  await rs.stop();
}
async function reset() {
  for (const c of await mongoose.connection.db.collections()) await c.deleteMany({});
  settings.clearCache();
  require('../src/middleware/tenant').clearCache();
}

const bearer = (token) => (token ? { Authorization: `Bearer ${token}` } : {});
const api = {
  get: (p, token) => request(app).get(`/v1/${p}`).set(bearer(token)),
  post: (p, body, token) => request(app).post(`/v1/${p}`).set(bearer(token)).send(body || {}),
  put: (p, body, token) => request(app).put(`/v1/${p}`).set(bearer(token)).send(body || {}),
  patch: (p, body, token) => request(app).patch(`/v1/${p}`).set(bearer(token)).send(body || {}),
  del: (p, body, token) => request(app).delete(`/v1/${p}`).set(bearer(token)).send(body || {}),
};

const PASSWORD = 'Matkhau123';

const expectOk = (res, status = 200) => {
  if (res.status !== status) throw new Error(`${res.req?.method} ${res.req?.path} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

/** An admin as created by db:init, signed in. */
async function adminToken() {
  const email = 'admin@seatroute.test';
  const id = uuid();
  await models.Account.create({
    _id: id, operatorId: id, email, passwordHash: await password.hash(PASSWORD), displayName: 'Admin', role: 'admin', preferredLanguage: 'vi',
    status: 'active', search: 'admin', createdAt: new Date(), updatedAt: new Date(),
  });
  const login = expectOk(await api.post('auth/login', { email, password: PASSWORD, deviceName: 'Admin phone' }));
  return { token: login.tokens.accessToken, login };
}

async function customer(email = 'khach@example.com', name = 'Nguyễn Văn An', phone = '0901234567') {
  const res = expectOk(await api.post('auth/register', { email, password: PASSWORD, displayName: name, phone, acceptTerms: true, accountType: 'customer', deviceName: 'Pixel 8' }), 201);
  return { token: res.tokens.accessToken, body: res };
}

/** Provinces are shared reference data (seeded by db:init), not created through the API. */
async function province(name, sortOrder) {
  const doc = await models.Province.findOne({ name }).lean() || (await models.Province.create({ _id: uuid(), name, nameNoAccent: noAccent(name), sortOrder, isActive: true, search: noAccent(name), createdAt: new Date(), updatedAt: new Date() })).toObject();
  return { ...doc, id: doc._id };
}

/**
 * Builds a small operator through the admin API: 2 provinces, 2 offices each, shuttle zone, 9-seat layout,
 * vehicle, driver, route Hà Nội -> Thái Bình, one trip tomorrow 07:30 at 250 000đ.
 */
async function world(admin) {
  expectOk(await api.put('admin/operator', { name: 'Nhà xe Test', phone: '0241234567', address: 'Hà Nội' }, admin));
  const hn = await province('Hà Nội', 1);
  const tb = await province('Thái Bình', 2);
  const o1 = expectOk(await api.post('manage/offices', { provinceId: hn.id, name: 'VP Mỹ Đình', address: '1 Mỹ Đình', phone: '0241111111' }, admin), 201);
  const o2 = expectOk(await api.post('manage/offices', { provinceId: hn.id, name: 'VP Giáp Bát', address: '2 Giải Phóng', phone: '0242222222' }, admin), 201);
  const o3 = expectOk(await api.post('manage/offices', { provinceId: tb.id, name: 'VP TP Thái Bình', address: '3 Lý Bôn', phone: '0227333333' }, admin), 201);
  const zone = expectOk(await api.post('manage/shuttle-zones', { officeId: o1.id, name: 'Cầu Giấy', fee: 30000, leadMinutes: 40 }, admin), 201);
  const tpl = expectOk(await api.get('manage/seat-layouts/templates', admin)).items.find((t) => t.key === '9');
  const layout = expectOk(await api.post('manage/seat-layouts', { name: tpl.name, rows: tpl.rows, cols: tpl.cols, seats: tpl.seats }, admin), 201);
  const driver = expectOk(await api.post('admin/staff', { kind: 'limo_driver', name: 'Tài xế Bình', phone: '0912000111', licenseClassText: 'D', licenseExpiresOn: '2030-01-01' }, admin), 201);
  const vehicle = expectOk(await api.post('manage/vehicles', { plateNo: '29B-123.45', kindLabel: 'Limousine 9 chỗ', layoutId: layout.id, amenities: ['wifi', 'nước'], defaultDriverId: driver.id }, admin), 201);
  const route = expectOk(await api.post('manage/routes', {
    fromProvinceId: hn.id, toProvinceId: tb.id, durationMinutes: 150, basePrice: 250000, parcelEnabled: true,
    offices: [{ officeId: o1.id, side: 'pickup', offsetMinutes: 0 }, { officeId: o2.id, side: 'pickup', offsetMinutes: 30 }, { officeId: o3.id, side: 'drop', offsetMinutes: 150 }],
  }, admin), 201);
  const date = T.addDays(T.today(), 2); // ≥ 2 days ahead: refund tiers do not depend on the hour the tests run
  const trip = expectOk(await api.post('manage/trips', { routeId: route.id, date, departTime: '07:30', vehicleId: vehicle.id, basePrice: 250000 }, admin), 201);
  return { hn, tb, o1, o2, o3, zone, layout, driver, vehicle, route, trip, date };
}

const addDays = (n) => T.addDays(T.today(), n);

module.exports = { province, addDays, start, stop, reset, api, app, request, models, PASSWORD, expectOk, adminToken, customer, world, noAccent };
