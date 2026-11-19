process.env.NODE_ENV = 'test';
const fs = require('fs');
// Offline machines: reuse a locally installed mongod instead of downloading one.
if (!process.env.MONGOMS_SYSTEM_BINARY && fs.existsSync('/opt/homebrew/bin/mongod')) {
  process.env.MONGOMS_SYSTEM_BINARY = '/opt/homebrew/bin/mongod';
  process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || '9.0.4';
}

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
}

const bearer = (token) => (token ? { Authorization: `Bearer ${token}` } : {});
const api = {
  get: (p, token) => request(app).get(`/v1/${p}`).set(bearer(token)),
  post: (p, body, token) => request(app).post(`/v1/${p}`).set(bearer(token)).send(body || {}),
  put: (p, body, token) => request(app).put(`/v1/${p}`).set(bearer(token)).send(body || {}),
  patch: (p, body, token) => request(app).patch(`/v1/${p}`).set(bearer(token)).send(body || {}),
  del: (p, body, token) => request(app).delete(`/v1/${p}`).set(bearer(token)).send(body || {}),
};

const PASSWORD = 'matkhau123';

const expectOk = (res, status = 200) => {
  if (res.status !== status) throw new Error(`${res.req?.method} ${res.req?.path} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

/** Default admin as created by db:init (mustChangePassword), then signed in and password changed. */
async function adminToken() {
  const email = 'admin@seatroute.test';
  await models.Account.create({
    _id: uuid(), email, passwordHash: await password.hash('TamThoi123'), displayName: 'Admin', role: 'admin', preferredLanguage: 'vi',
    status: 'active', mustChangePassword: true, search: 'admin', createdAt: new Date(), updatedAt: new Date(),
  });
  const login = expectOk(await api.post('auth/login', { email, password: 'TamThoi123', deviceName: 'Admin phone' }));
  expectOk(await api.post('auth/change-password', { oldPassword: 'TamThoi123', newPassword: PASSWORD }, login.tokens.accessToken));
  return { token: login.tokens.accessToken, login };
}

async function customer(email = 'khach@example.com', name = 'Nguyễn Văn An', phone = '0901234567') {
  const res = expectOk(await api.post('auth/register', { email, password: PASSWORD, displayName: name, phone, acceptTerms: true, deviceName: 'Pixel 8' }), 201);
  return { token: res.tokens.accessToken, body: res };
}

/**
 * Builds a small operator through the admin API: bank, 2 provinces, 2 offices each, shuttle zone, 9-seat layout,
 * vehicle, driver, route Hà Nội -> Thái Bình, one trip tomorrow 07:30 at 250 000đ.
 */
async function world(admin) {
  expectOk(await api.put('admin/operator', { name: 'Nhà xe Test', phone: '0241234567', address: 'Hà Nội' }, admin));
  expectOk(await api.put('admin/bank-info', { bankCode: 'VCB', accountNo: '0123456789', holderName: 'Cong ty Test' }, admin));
  const hn = expectOk(await api.post('admin/provinces', { name: 'Hà Nội', sortOrder: 1 }, admin), 201);
  const tb = expectOk(await api.post('admin/provinces', { name: 'Thái Bình', sortOrder: 2 }, admin), 201);
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
  const date = T.addDays(T.today(), 1);
  const trip = expectOk(await api.post('manage/trips', { routeId: route.id, date, departTime: '07:30', vehicleId: vehicle.id, basePrice: 250000 }, admin), 201);
  return { hn, tb, o1, o2, o3, zone, layout, driver, vehicle, route, trip, date };
}

/** A small valid-looking JPEG: SOI, APP0 (JFIF), APP1 (Exif with a fake GPS string), SOS, data, EOI. */
function jpeg(seed = 1) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary')]);
  const exif = Buffer.from('Exif\0\0GPS 21.0285 105.8542');
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, exif.length + 2]), exif]);
  const data = Buffer.alloc(3000, seed);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, app1, Buffer.from([0xff, 0xda, 0x00, 0x02]), data, Buffer.from([0xff, 0xd9])]);
}

module.exports = { start, stop, reset, api, app, request, models, PASSWORD, expectOk, adminToken, customer, world, jpeg, noAccent };
