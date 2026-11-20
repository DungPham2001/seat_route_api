/**
 * Sample data (offices, vehicles, trips, orders, accounts) for an empty database:
 *   MONGODB_URI=".../seatroute_test" npm run seed:demo
 * Creates (once): an operator profile, bank info, provinces Hà Nội / Thái Bình, 4 offices, shuttle zones,
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

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'quantri@seatroute.vn';
const CUSTOMER_EMAIL = process.env.SEED_CUSTOMER_EMAIL || 'minhquan.nguyen@seatroute.vn';
const CUSTOMER2_EMAIL = process.env.SEED_CUSTOMER2_EMAIL || 'thibinh.tran@seatroute.vn';

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
  await models.Account.create({ _id: uuid(), email: ADMIN_EMAIL, passwordHash: await password.hash(adminPass), displayName: 'Nguyễn Văn Hùng', role: 'admin', status: 'active', search: noAccent(`nguyen van hung ${ADMIN_EMAIL}`), createdAt: now, updatedAt: now });
  const A = (await call('post', 'auth/login', null, { email: ADMIN_EMAIL, password: adminPass, deviceName: 'seed' })).tokens.accessToken;

  await call('put', 'admin/operator', A, { name: 'Nhà xe SeatRoute Limousine', description: 'Limousine 9 chỗ Hà Nội - Thái Bình, xuất bến đúng giờ.', phone: '0347218023', address: '1 Phạm Hùng, Hà Nội', openText: '05:00 - 21:00 hằng ngày', representativeName: 'Nguyễn Văn Hùng', licenseNoText: '0412/GPKDVT-SGTVT' });
  await call('put', 'admin/cancel-policy', A, { tiers: [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 6, refundPercent: 70 }, { hoursBefore: 2, refundPercent: 50 }, { hoursBefore: 0, refundPercent: 0 }], cancelFee: 10000 });
  await call('put', 'admin/settings/rules', A, { items: [{ kind: 'luggage', text: 'Mỗi khách 1 vali 20kg và 1 túi xách.' }, { kind: 'pets', text: 'Không mang thú cưng.' }, { kind: 'children', text: 'Trẻ dưới 5 tuổi ngồi cùng người lớn không tính vé.' }] });

  const provinces = await models.Province.find({}).lean();
  const find = (n) => provinces.find((p) => p.name === n);
  const hn = find('Hà Nội') || (await call('post', 'admin/provinces', A, { name: 'Hà Nội', sortOrder: 1 }));
  const tb = find('Thái Bình') || (await call('post', 'admin/provinces', A, { name: 'Thái Bình', sortOrder: 2 }));
  const hnId = hn._id || hn.id;
  const tbId = tb._id || tb.id;
  const o = {
    md: await call('post', 'manage/offices', A, { provinceId: hnId, name: 'VP Mỹ Đình', address: '20 Phạm Hùng, Nam Từ Liêm', phone: '0241111111', openText: '05:00 - 21:00' }),
    gb: await call('post', 'manage/offices', A, { provinceId: hnId, name: 'VP Giáp Bát', address: '897 Giải Phóng, Hoàng Mai', phone: '0242222222', openText: '05:00 - 21:00' }),
    tb: await call('post', 'manage/offices', A, { provinceId: tbId, name: 'VP TP Thái Bình', address: '15 Lý Bôn, TP Thái Bình', phone: '0227333333', openText: '05:00 - 21:00' }),
    th: await call('post', 'manage/offices', A, { provinceId: tbId, name: 'VP Thái Thụy', address: 'Thị trấn Diêm Điền', phone: '0227444444', openText: '05:30 - 19:00' }),
  };
  for (const [office, zones] of [[o.md, [['Cầu Giấy', 30000], ['Nam Từ Liêm', 0]]], [o.gb, [['Hai Bà Trưng', 30000], ['Hoàng Mai', 0]]], [o.tb, [['Nội thành TP Thái Bình', 0]]]]) {
    for (const [name, fee] of zones) await call('post', 'manage/shuttle-zones', A, { officeId: office.id, name, fee, leadMinutes: 40, dropMinutes: 30 });
  }
  const tpl = (await call('get', 'manage/seat-layouts/templates', A)).items.find((x) => x.key === '9');
  const layout = await call('post', 'manage/seat-layouts', A, { name: tpl.name, rows: tpl.rows, cols: tpl.cols, seats: tpl.seats });
  const d1 = await call('post', 'admin/staff', A, { kind: 'limo_driver', name: 'Trần Văn Lái', phone: '0912000111', licenseClassText: 'D', licenseExpiresOn: '2030-06-30' });
  const d2 = await call('post', 'admin/staff', A, { kind: 'limo_driver', name: 'Lê Văn Xe', phone: '0912000222', licenseClassText: 'D', licenseExpiresOn: '2029-12-31' });
  await call('post', 'admin/staff', A, { kind: 'office_staff', name: 'Phạm Thị Quầy', phone: '0912000333', officeId: o.md.id });
  const v1 = await call('post', 'manage/vehicles', A, { type: 'limo', plateNo: '29B-000.01', name: 'Dcar Limousine', kindLabel: 'Limousine 9 chỗ', frontSurcharge: 30000, vipSurcharge: 60000, layoutId: layout.id, year: 2024, colorText: 'Đen', amenities: ['wifi', 'sạc', 'nước'], defaultDriverId: d1.id, parcelMaxKg: 100, parcelMaxPieces: 20, docDates: [{ kind: 'registration', expiresOn: '2027-05-01' }, { kind: 'insurance', expiresOn: '2027-01-15' }] });
  const v2 = await call('post', 'manage/vehicles', A, { type: 'limo', plateNo: '29B-000.02', name: 'Dcar Limousine', kindLabel: 'Limousine 9 chỗ', frontSurcharge: 30000, vipSurcharge: 60000, layoutId: layout.id, year: 2023, colorText: 'Trắng', amenities: ['wifi', 'sạc'], defaultDriverId: d2.id, parcelMaxKg: 100, parcelMaxPieces: 20 });
  await call('post', 'manage/vehicles', A, { type: 'shuttle', plateNo: '29B-000.99', name: 'Ford Transit', kindLabel: 'Xe trung chuyển 16 chỗ', capacity: 16 });
  const route = await call('post', 'manage/routes', A, {
    fromProvinceId: hnId, toProvinceId: tbId, durationMinutes: 150, basePrice: 250000, parcelEnabled: true,
    usefulInfo: 'Có mặt tại văn phòng trước giờ xe tới 10 phút. Xe dừng nghỉ 10 phút tại trạm dừng Phủ Lý.',
    offices: [{ officeId: o.md.id, side: 'pickup', offsetMinutes: 0, sortOrder: 0 }, { officeId: o.gb.id, side: 'pickup', offsetMinutes: 30, sortOrder: 1 }, { officeId: o.tb.id, side: 'drop', offsetMinutes: 140, sortOrder: 0 }, { officeId: o.th.id, side: 'drop', offsetMinutes: 170, sortOrder: 1 }],
    stops: [{ name: 'Trạm dừng Phủ Lý', sortOrder: 0, offsetMinutes: 70 }],
  });
  const back = await call('post', `manage/routes/${route.id}/duplicate`, A, { reverse: true });
  await call('patch', `manage/routes/${back.id}`, A, { status: 'active' });
  const start = T.today();
  for (const [r, v, d, times] of [[route, v1, d1, ['06:00', '13:00']], [back, v2, d2, ['09:30', '17:00']]]) {
    for (const time of times) await call('post', 'manage/series', A, { routeId: r.id, vehicleId: v.id, driverId: d.id, weekdays: [0, 1, 2, 3, 4, 5, 6], departTime: time, startDate: start, basePrice: 250000 });
  }
  for (const rid of [route.id, back.id]) {
    for (const [size, max, price] of [['small', 5, 30000], ['medium', 15, 50000], ['large', 30, 80000]]) await call('post', 'admin/parcel-rates', A, { routeId: rid, sizeClass: size, maxWeightKg: max, price, extraPerKg: 5000, declaredValuePercent: 1 });
  }
  for (const [name, isProhibited] of [['Quần áo, đồ dùng', false], ['Thực phẩm khô', false], ['Giấy tờ', false], ['Chất cháy nổ', true], ['Hàng cấm theo pháp luật', true]]) await call('post', 'admin/parcel-categories', A, { name, isProhibited });
  await call('post', 'admin/checklist-items', A, { title: 'Kiểm tra xe, lốp, phanh' });
  await call('post', 'admin/checklist-items', A, { title: 'Đối chiếu danh sách khách với tài xế' });
  for (const [q, a] of [['Chuyển khoản thế nào?', 'Sau khi tạo đơn, quét mã QR hoặc chuyển đúng số tài khoản, số tiền và nội dung là mã đơn, rồi gửi ảnh chuyển khoản trong app.'], ['Vì sao nên gửi ảnh sớm?', 'Ghế thuộc về người gửi ảnh chuyển khoản thành công sớm nhất.']]) {
    await call('post', 'admin/faq', A, { language: 'vi', category: 'payment', question: q, answer: a });
  }
  await call('post', 'admin/promotions', A, { code: 'TET2027', title: 'Giảm 50.000đ dịp Tết', kind: 'amount', value: 50000, minAmount: 200000, perUserLimit: 1 });
  for (const text of ['Chất cháy nổ, vũ khí', 'Chất ma túy, hàng cấm theo pháp luật', 'Động vật sống']) await call('post', 'admin/prohibited-items', A, { text });
  await call('post', 'admin/announcements', A, { title: 'Chào mừng', body: 'Nhà xe SeatRoute mở bán vé trên ứng dụng.', kind: 'news', notify: false });

  const customerPass = tempPassword();
  await models.Account.deleteOne({ email: CUSTOMER_EMAIL });
  const C = (await call('post', 'auth/register', null, { email: CUSTOMER_EMAIL, password: customerPass, displayName: 'Nguyễn Minh Quân', phone: '0909000111', acceptTerms: true })).tokens.accessToken;
  const customer2Pass = tempPassword();
  await models.Account.deleteOne({ email: CUSTOMER2_EMAIL });
  const C2 = (await call('post', 'auth/register', null, { email: CUSTOMER2_EMAIL, password: customer2Pass, displayName: 'Trần Thị Bình', phone: '0909000222', acceptTerms: true })).tokens.accessToken;

  await sampleOrders({ A, C, C2, route, back, o, start });

  console.log('Data created. Accounts (shown once):');
  console.log(`  admin:      ${ADMIN_EMAIL} / ${adminPass}`);
  console.log(`  customer:   ${CUSTOMER_EMAIL} / ${customerPass}   (SĐT 0909000111)`);
  console.log(`  customer 2: ${CUSTOMER2_EMAIL} / ${customer2Pass}   (SĐT 0909000222)`);
  return mongoose.disconnect();
}

// ---------- sample orders: every state the screens need ----------

async function sampleOrders({ A, C, C2, route, back, o, start }) {
  const day = (n) => T.addDays(start, n);
  const tripAt = async (date, routeId, time) => (await call('get', `manage/trips?from=${date}&to=${date}`, A)).items.find((t) => (t.route?.id || t.routeId) === routeId && t.departTime === time);
  const book = (token, trip, seats, extra = {}) => call('post', 'bookings', token, { tripId: trip.id, pickupOfficeId: extra.pickup || o.md.id, dropOfficeId: extra.drop || o.tb.id, seats, ...(extra.body || {}) });

  const t1 = await tripAt(day(1), route.id, '06:00');
  const t2 = await tripAt(day(2), route.id, '13:00');
  const t3 = await tripAt(day(3), back.id, '09:30');
  const t4 = await tripAt(day(4), route.id, '06:00');
  if (!t1 || !t2 || !t3 || !t4) throw new Error('recurring trips were not generated');

  // 1. Approved and paid at the counter (revenue counted), with a chat.
  const b1 = await book(C, t1, ['A1', 'A2']);
  await call('post', `manage/bookings/${b1.id}/approve`, A, { note: 'Đã duyệt' });
  await call('post', `manage/bookings/${b1.id}/collect`, A, { method: 'cash' });
  await call('post', `bookings/${b1.id}/messages`, C, { text: 'Cho em gửi thêm 1 vali nhỏ được không ạ?' });
  await call('post', `bookings/${b1.id}/messages`, A, { text: 'Được ạ, anh/chị mang ra văn phòng trước giờ xe chạy 10 phút.' });
  // 2. Approved but not paid yet (queue "Chờ thu tiền").
  const b2 = await book(C, t2, ['B1']);
  await call('post', `manage/bookings/${b2.id}/approve`, A, {});
  // 3. Pending: waiting for the admin (queue "Cần xác nhận").
  await book(C, t2, ['C1', 'C2']);
  await book(C2, t3, ['A1'], { pickup: o.tb.id, drop: o.md.id });
  // 4. Rejected.
  const b4 = await book(C2, t4, ['B2']);
  await call('post', `manage/bookings/${b4.id}/reject`, A, { reason: 'Chuyến đã đủ khách đoàn' });
  // 5. Paid, then the customer asks to cancel (cancel_requested).
  const b5 = await book(C2, t4, ['D1']);
  await call('post', `manage/bookings/${b5.id}/approve`, A, {});
  await call('post', `manage/bookings/${b5.id}/collect`, A, { method: 'transfer' });
  await call('post', `bookings/${b5.id}/cancel`, C2, { note: 'Em bận việc đột xuất' });
  // 6. Cancelled by the customer while still pending.
  const b6 = await book(C, t4, ['D2']);
  await call('post', `bookings/${b6.id}/cancel`, C, {});
  // 7. Counter booking paid in cash (source counter).
  await call('post', 'manage/bookings', A, { tripId: t1.id, pickupOfficeId: o.gb.id, dropOfficeId: o.th.id, seats: [{ seatId: 'B2', passengerName: 'Bà Lan' }], guest: { name: 'Bà Lan', phone: '0988777666' }, payMethod: 'cash' });

  // Parcels: one waiting for acceptance, one accepted and received at the counter (fee collected).
  const parcel = (token, receiver, extra = {}) => call('post', 'parcels', token, {
    routeId: route.id, date: day(1), fromOfficeId: o.md.id, toOfficeId: o.tb.id, descriptionText: extra.text || 'Quần áo, đồ dùng', weightKg: extra.kg || 3, sizeClass: 'small', receiver, commitAccepted: true,
  });
  await parcel(C, { name: 'Nguyễn Thị Hoa', phone: '0977000111' });
  const p2 = await parcel(C2, { name: 'Lê Văn Hùng', phone: '0977000222' }, { text: 'Giấy tờ', kg: 1 });
  await call('post', `manage/parcels/${p2.id}/accept`, A, { tripId: t1.id });
  await call('post', `manage/parcels/${p2.id}/status`, A, { status: 'received', payMethod: 'cash' });
  console.log('Sample orders: pending x3, approved + paid, approved unpaid, rejected, cancel requested, cancelled, counter booking, 2 parcels.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
