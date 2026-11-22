/**
 * Sample data (vehicles, routes, trips, orders, accounts) for an empty database:
 *   MONGODB_URI=".../seatroute_test" npm run seed:demo
 * Creates (once): an operator profile, bank info, provinces Hà Nội / Thái Bình, 
 * a 9-seat layout, 2 vehicles, 2 drivers, the route Hà Nội -> Thái Bình and its reverse, daily recurring trips,
 * parcel rates and categories, FAQ, plus an admin and two customers whose random passwords are printed once,
 * and sample orders in every state (pending, approved + paid, approved but not paid yet, rejected, cancel requested,
 * cancelled, a counter booking, parcels). Payment happens at the counter: there are no receipt photos.
 * Runs through the real API (in-process), so every rule applies.
 */
process.env.RATE_LIMIT = 'off';
const mongoose = require('mongoose');
const request = require('supertest');
const config = require('../src/config');
const app = require('../src/app');
const models = require('../src/models');
const { uuid, noAccent } = require('../src/lib/util');
const password = require('../src/lib/password');
const { tempPassword } = require('../src/services/accounts');
const T = require('../src/lib/time');

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'quantri@nhaxevietnam.vn';

async function call(method, path, token, body) {
  const r = request(app)[method](`/v1/${path}`).set('Accept-Language', 'vi');
  if (token) r.set('Authorization', `Bearer ${token}`);
  const res = await r.send(body || {});
  if (res.status >= 300) throw new Error(`${method.toUpperCase()} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function main() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  if (await models.Route.exists({})) {
    console.log('Routes already exist: nothing seeded (use an empty test database).');
    return mongoose.disconnect();
  }
  for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();

  const adminPass = tempPassword();
  const now = new Date();
  await models.Account.deleteOne({ email: ADMIN_EMAIL });
  const adminId = uuid();
  config.defaultOperatorId = adminId; // passenger-side calls of this run belong to the seeded nhà xe
  await models.Account.create({ _id: adminId, operatorId: adminId, email: ADMIN_EMAIL, passwordHash: await password.hash(adminPass), displayName: 'Nguyễn Văn Hùng', role: 'admin', status: 'active', search: noAccent(`nguyen van hung ${ADMIN_EMAIL}`), createdAt: now, updatedAt: now });
  const A = (await call('post', 'auth/login', null, { email: ADMIN_EMAIL, password: adminPass, deviceName: 'seed' })).tokens.accessToken;

  await call('put', 'admin/operator', A, { name: 'Nhà xe Việt Nam Limousine', description: 'Limousine 9 chỗ Hà Nội - Thái Bình, xuất bến đúng giờ.', phone: '0347218023', address: '1 Phạm Hùng, Hà Nội', openText: '05:00 - 21:00 hằng ngày', representativeName: 'Nguyễn Văn Hùng', licenseNoText: '0412/GPKDVT-SGTVT' });
  await call('put', 'admin/cancel-policy', A, { tiers: [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 6, refundPercent: 70 }, { hoursBefore: 2, refundPercent: 50 }, { hoursBefore: 0, refundPercent: 0 }], cancelFee: 10000 });
  await call('put', 'admin/settings/rules', A, { items: [{ kind: 'luggage', text: 'Mỗi khách 1 vali 20kg và 1 túi xách.' }, { kind: 'pets', text: 'Không mang thú cưng.' }, { kind: 'children', text: 'Trẻ dưới 5 tuổi ngồi cùng người lớn không tính vé.' }] });

  const provinces = await models.Province.find({}).lean();
  const find = (n) => provinces.find((p) => p.name === n);
  // provinces are shared by every operator (db:init); the sample route needs these two
  const province = async (name, sortOrder) => (find(name) || (await models.Province.create({ _id: uuid(), name, nameNoAccent: noAccent(name), sortOrder, isActive: true, search: noAccent(name), createdAt: now, updatedAt: now })))._id;
  const hnId = await province('Hà Nội', 1);
  const tbId = await province('Thái Bình', 2);
  const tpl = (await call('get', 'manage/seat-layouts/templates', A)).items.find((x) => x.key === '9');
  const layout = await call('post', 'manage/seat-layouts', A, { name: tpl.name, rows: tpl.rows, cols: tpl.cols, seats: tpl.seats });
  const d1 = await call('post', 'admin/staff', A, { kind: 'limo_driver', name: 'Trần Văn Lái', phone: '0912000111', licenseClassText: 'D', licenseExpiresOn: '2030-06-30', positionText: 'Tài xế chính', joinedOn: '2022-03-01' });
  const d2 = await call('post', 'admin/staff', A, { kind: 'limo_driver', name: 'Lê Văn Xe', phone: '0912000222', licenseClassText: 'D', licenseExpiresOn: '2029-12-31', positionText: 'Tài xế', joinedOn: '2023-07-15' });
  await call('post', 'admin/staff', A, { kind: 'office_staff', name: 'Phạm Thị Quầy', phone: '0912000333', positionText: 'Nhân viên điều hành', joinedOn: '2022-01-10' });
  const v1 = await call('post', 'manage/vehicles', A, { type: 'limo', plateNo: '29B-000.01', name: 'Dcar Limousine', kindLabel: 'Limousine 9 chỗ', frontSurcharge: 30000, vipSurcharge: 60000, layoutId: layout.id, year: 2024, colorText: 'Đen', amenities: ['wifi', 'sạc', 'nước'], defaultDriverId: d1.id, parcelMaxKg: 100, parcelMaxPieces: 20, docDates: [{ kind: 'registration', expiresOn: '2027-05-01' }, { kind: 'insurance', expiresOn: '2027-01-15' }] });
  const v2 = await call('post', 'manage/vehicles', A, { type: 'limo', plateNo: '29B-000.02', name: 'Dcar Limousine', kindLabel: 'Limousine 9 chỗ', frontSurcharge: 30000, vipSurcharge: 60000, layoutId: layout.id, year: 2023, colorText: 'Trắng', amenities: ['wifi', 'sạc'], defaultDriverId: d2.id, parcelMaxKg: 100, parcelMaxPieces: 20 });
  await call('post', 'manage/vehicles', A, { type: 'shuttle', plateNo: '29B-000.99', name: 'Ford Transit', kindLabel: 'Xe trung chuyển 16 chỗ', capacity: 16, year: 2022, colorText: 'Trắng', amenities: ['điều hòa'], docDates: [{ kind: 'registration', expiresOn: '2027-03-20' }, { kind: 'insurance', expiresOn: '2027-02-10' }] });
  const route = await call('post', 'manage/routes', A, {
    fromProvinceId: hnId, toProvinceId: tbId, durationMinutes: 150, basePrice: 250000, parcelEnabled: true,
    usefulInfo: 'Có mặt tại điểm đón trước giờ xe chạy 10 phút. Xe dừng nghỉ 10 phút tại trạm dừng Phủ Lý.',
    stops: [{ name: 'Trạm dừng Phủ Lý', sortOrder: 0, offsetMinutes: 70 }],
  });
  const back = await call('post', `manage/routes/${route.id}/duplicate`, A, { reverse: true });
  await call('patch', `manage/routes/${back.id}`, A, { status: 'active' });
  const start = T.today();
  for (const [r, v, d, times] of [[route, v1, d1, ['06:00', '13:00']], [back, v2, d2, ['09:30', '17:00']]]) {
    for (const time of times) await call('post', 'manage/series', A, { name: `${r.name} ${time}`, routeId: r.id, vehicleId: v.id, driverId: d.id, weekdays: [0, 1, 2, 3, 4, 5, 6], departTime: time, startDate: start, basePrice: 250000 });
  }
  for (const rid of [route.id, back.id]) {
    for (const [size, max, price] of [['small', 5, 30000], ['medium', 15, 50000], ['large', 30, 80000]]) await call('post', 'admin/parcel-rates', A, { routeId: rid, sizeClass: size, maxWeightKg: max, price, extraPerKg: 5000, declaredValuePercent: 1 });
  }
  for (const [name, isProhibited] of [['Quần áo, đồ dùng', false], ['Thực phẩm khô', false], ['Giấy tờ', false], ['Chất cháy nổ', true], ['Hàng cấm theo pháp luật', true]]) await call('post', 'admin/parcel-categories', A, { name, isProhibited, ...(isProhibited ? { note: 'Nhà xe không nhận loại hàng này.' } : { packingNote: 'Đóng gói kín, ghi rõ tên người nhận.' }) });
  await call('post', 'admin/checklist-items', A, { title: 'Kiểm tra xe, lốp, phanh' });
  await call('post', 'admin/checklist-items', A, { title: 'Đối chiếu danh sách khách với tài xế' });
  for (const [q, a] of [['Thanh toán thế nào?', 'Sau khi nhà xe duyệt đơn, bạn thanh toán trực tiếp tại quầy (tiền mặt hoặc chuyển khoản) trước giờ xe chạy.'], ['Vì sao đơn chưa được duyệt?', 'Đơn giữ ghế ngay khi tạo và chờ nhà xe duyệt; bạn sẽ nhận thông báo khi có kết quả.']]) {
    await call('post', 'admin/faq', A, { language: 'vi', category: 'payment', question: q, answer: a });
  }
  await call('post', 'admin/promotions', A, { code: 'TET2027', title: 'Giảm 50.000đ dịp Tết', kind: 'amount', value: 50000, minAmount: 200000, perUserLimit: 1, usageLimit: 200, maxDiscount: 50000, startAt: new Date().toISOString(), endAt: new Date(Date.now() + 60 * 86400000).toISOString() });
  for (const text of ['Chất cháy nổ, vũ khí', 'Chất ma túy, hàng cấm theo pháp luật', 'Động vật sống']) await call('post', 'admin/prohibited-items', A, { text });
  await call('post', 'admin/announcements', A, { title: 'Chào mừng', body: 'Nhà xe Việt Nam mở bán vé trên ứng dụng.', kind: 'news', notify: false });

  await sampleOrders({ A, route, back, start });
  await moreTrips({ A, layout, hnId, start });

  console.log('Data created. Account (shown once):');
  console.log(`  admin:      ${ADMIN_EMAIL} / ${adminPass}`);
  return mongoose.disconnect();
}

// ---------- sample orders: every state the screens need ----------

/** More named trips (from -> to, no routes or offices to set up) with door-to-door counter bookings. */
async function moreTrips({ A, layout, hnId, start }) {
  const d3 = await call('post', 'admin/staff', A, { kind: 'limo_driver', name: 'Nguyễn Văn Tuấn', phone: '0912000444', licenseClassText: 'D', licenseExpiresOn: '2031-01-31', positionText: 'Tài xế', joinedOn: '2024-02-01' });
  const d4 = await call('post', 'admin/staff', A, { kind: 'limo_driver', name: 'Hoàng Đức Minh', phone: '0912000555', licenseClassText: 'D', licenseExpiresOn: '2030-09-30', positionText: 'Tài xế', joinedOn: '2024-05-20' });
  const car = (plateNo, color, d) => call('post', 'manage/vehicles', A, { type: 'limo', plateNo, name: 'Limousine VIP', kindLabel: 'Limousine 9 chỗ', frontSurcharge: 30000, vipSurcharge: 60000, layoutId: layout.id, year: 2024, colorText: color, amenities: ['wifi', 'sạc', 'nước'], defaultDriverId: d.id, parcelMaxKg: 100, parcelMaxPieces: 20, docDates: [{ kind: 'registration', expiresOn: '2027-08-01' }, { kind: 'insurance', expiresOn: '2027-06-15' }] });
  const [v1, v2, d1, d2] = [await car('29B-000.03', 'Xám', d3), await car('29B-000.04', 'Xanh', d4), d3, d4];
  const pid = async (name) => (await models.Province.findOne({ name }).lean())?._id;
  const hp = await pid('Hải Phòng');
  const nb = await pid('Ninh Bình');
  const plans = [
    { name: 'Hà Nội - Hải Phòng sáng', from: hnId, to: hp, time: '07:00', minutes: 120, price: 180000, v: v1, d: d1, day: 1 },
    { name: 'Hà Nội - Hải Phòng chiều', from: hnId, to: hp, time: '15:30', minutes: 120, price: 180000, v: v2, d: d2, day: 1 },
    { name: 'Hải Phòng - Hà Nội tối', from: hp, to: hnId, time: '18:00', minutes: 120, price: 180000, v: v1, d: d1, day: 2 },
    { name: 'Hà Nội - Ninh Bình', from: hnId, to: nb, time: '08:00', minutes: 100, price: 150000, v: v2, d: d2, day: 3 },
    { name: 'Ninh Bình - Hà Nội', from: nb, to: hnId, time: '16:00', minutes: 100, price: 150000, v: v2, d: d2, day: 3 },
  ];
  const guests = [['Nguyễn Văn Nam', '0981000111'], ['Trần Thu Hà', '0981000222'], ['Lê Quang Huy', '0981000333'], ['Phạm Minh Châu', '0981000444'], ['Đỗ Thanh Tùng', '0981000555']];
  const places = [['25 Trần Duy Hưng, Cầu Giấy, Hà Nội', '12 Lạch Tray, Ngô Quyền, Hải Phòng'], ['99 Nguyễn Trãi, Thanh Xuân, Hà Nội', '45 Điện Biên Phủ, Hồng Bàng, Hải Phòng'], ['3 Cầu Giấy, Hà Nội', '8 Hoàng Diệu, Hải Phòng'], ['70 Kim Mã, Ba Đình, Hà Nội', '15 Trần Hưng Đạo, TP Ninh Bình'], ['21 Hoa Lư, TP Ninh Bình', '6 Phạm Hùng, Nam Từ Liêm, Hà Nội']];
  for (const [i, p] of plans.entries()) {
    const date = T.addDays(start, p.day);
    const trip = await call('post', 'manage/trips', A, { name: p.name, fromProvinceId: p.from, toProvinceId: p.to, durationMinutes: p.minutes, date, departTime: p.time, vehicleId: p.v.id, driverId: p.d.id, basePrice: p.price });
    const [g, pl] = [guests[i], places[i]];
    await call('post', 'manage/bookings', A, { tripId: trip.id, pickup: { address: pl[0], note: 'Gọi trước khi đến' }, drop: { address: pl[1] }, seats: [{ seatId: 'D1', passengerName: g[0] }, { seatId: 'D2', passengerName: g[0] }], guest: { name: g[0], phone: g[1] }, payMethod: i % 2 ? 'transfer' : 'cash' });
    // the second passenger of each trip has not paid yet: shows up under "Chờ thu tiền"
    const h2 = guests[(i + 1) % guests.length];
    await call('post', 'manage/bookings', A, { tripId: trip.id, pickup: { address: pl[1], note: '' }, drop: { address: pl[0] }, seats: [{ seatId: 'A1', passengerName: h2[0] }], guest: { name: h2[0], phone: h2[1] }, ...(i % 2 ? { payMethod: 'cash' } : {}) });
  }
  console.log('More trips: 5 named trips (Hải Phòng, Ninh Bình) with door-to-door bookings.');
}

async function sampleOrders({ A, route, back, start }) {
  const day = (n) => T.addDays(start, n);
  const tripAt = async (date, routeId, time) => (await call('get', `manage/trips?from=${date}&to=${date}`, A)).items.find((t) => (t.route?.id || t.routeId) === routeId && t.departTime === time);
  const t1 = await tripAt(day(1), route.id, '06:00');
  const t2 = await tripAt(day(2), route.id, '13:00');
  const t3 = await tripAt(day(3), back.id, '09:30');
  const t4 = await tripAt(day(4), route.id, '06:00');
  if (!t1 || !t2 || !t3 || !t4) throw new Error('recurring trips were not generated');

  // The owner books for passengers who phone or walk in: paid on the spot, or "book now, collect later".
  const book = (trip, seats, who, from, to, extra = {}) => call('post', 'manage/bookings', A, {
    tripId: trip.id, pickup: { address: from, note: extra.note || '' }, drop: { address: to }, seats: seats.map((id) => ({ seatId: id, passengerName: who[0] })), guest: { name: who[0], phone: who[1] }, ...extra.body,
  });
  await book(t1, ['A1', 'A2'], ['Nguyễn Minh Quân', '0909000111'], '12 Cầu Giấy, Hà Nội', '5 Lý Bôn, TP Thái Bình', { note: 'Gọi trước 10 phút', body: { payMethod: 'cash' } });
  await book(t1, ['B2'], ['Bà Lan', '0988777666'], '88 Giải Phóng, Hoàng Mai, Hà Nội', 'Thị trấn Diêm Điền, Thái Thụy', { body: { payMethod: 'cash' } });
  await book(t2, ['B1'], ['Trần Thị Bình', '0909000222'], '9 Lý Bôn, TP Thái Bình', '20 Phạm Hùng, Nam Từ Liêm, Hà Nội', { body: { payMethod: 'transfer' } });
  // Not paid yet ("Chờ thu tiền")
  await book(t2, ['C1', 'C2'], ['Lê Thị Hương', '0912111222'], '45 Nguyễn Chí Thanh, Đống Đa, Hà Nội', '102 Quang Trung, TP Thái Bình');
  await book(t3, ['A1'], ['Phạm Quốc Việt', '0912333444'], '9 Lý Bôn, TP Thái Bình', '20 Phạm Hùng, Nam Từ Liêm, Hà Nội');
  // Cancelled by the owner (never paid: no refund).
  const gone = await book(t4, ['D2'], ['Đặng Văn Long', '0912555666'], '3 Tây Sơn, Đống Đa, Hà Nội', '8 Trần Phú, TP Thái Bình');
  await call('post', `manage/bookings/${gone.id}/cancel`, A, { reason: 'Khách đổi lịch' });

  // Parcels taken at the counter: the fee is paid on the spot.
  const parcel = (sender, receiver, text, kg, payMethod) => call('post', 'manage/parcels', A, {
    routeId: route.id, date: day(1), descriptionText: text, weightKg: kg, sizeClass: 'small', sender, receiver, payMethod,
  });
  await parcel({ name: 'Nguyễn Minh Quân', phone: '0909000111' }, { name: 'Nguyễn Thị Hoa', phone: '0977000111', addressText: '14 Trần Hưng Đạo, TP Thái Bình' }, 'Quần áo, đồ dùng', 3, 'cash');
  await parcel({ name: 'Trần Thị Bình', phone: '0909000222' }, { name: 'Lê Văn Hùng', phone: '0977000222', addressText: '2 Lê Lợi, TP Thái Bình' }, 'Giấy tờ', 1, 'transfer');
  console.log('Sample orders: paid (cash / transfer) x3, not paid yet x2, cancelled, 2 parcels.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
