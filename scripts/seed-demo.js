/**
 * Demo data for the app developers and for the Google Play reviewer test accounts (use a TEST database):
 *   MONGODB_URI=".../seatroute_test" npm run seed:demo
 * Creates (once): an operator profile, bank info, provinces Hà Nội / Thái Bình, 4 offices, shuttle zones,
 * a 9-seat layout, 2 vehicles, 2 drivers, the route Hà Nội -> Thái Bình and its reverse, daily recurring trips,
 * parcel rates and categories, FAQ, a promo code, plus a demo admin and a demo customer whose random passwords are
 * printed once. Runs through the real API (in-process), so every rule applies.
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

const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL || 'demo-admin@seatroute.test';
const CUSTOMER_EMAIL = process.env.DEMO_CUSTOMER_EMAIL || 'demo-khach@seatroute.test';

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
  await models.Account.create({ _id: uuid(), email: ADMIN_EMAIL, passwordHash: await password.hash(adminPass), displayName: 'Quản trị Demo', role: 'admin', status: 'active', mustChangePassword: false, search: noAccent(`quan tri demo ${ADMIN_EMAIL}`), createdAt: now, updatedAt: now });
  const A = (await call('post', 'auth/login', null, { email: ADMIN_EMAIL, password: adminPass, deviceName: 'seed' })).tokens.accessToken;

  await call('put', 'admin/operator', A, { name: 'Nhà xe Demo Limousine', description: 'Limousine 9 chỗ Hà Nội - Thái Bình, xuất bến đúng giờ.', phone: '0241234567', address: '1 Phạm Hùng, Hà Nội', openText: '05:00 - 21:00 hằng ngày', representativeName: 'Nguyễn Văn Demo', licenseNoText: 'GP-DEMO-001' });
  await call('put', 'admin/bank-info', A, { bankCode: 'VCB', accountNo: '0011223344', holderName: 'NHA XE DEMO' });
  await call('put', 'admin/cancel-policy', A, { tiers: [{ hoursBefore: 24, refundPercent: 90 }, { hoursBefore: 4, refundPercent: 50 }, { hoursBefore: 0, refundPercent: 0 }], cancelFee: 10000, changeAllowedHoursBefore: 4 });
  await call('put', 'admin/settings/rules', A, { items: [{ kind: 'luggage', text: 'Mỗi khách 1 vali 20kg và 1 túi xách.' }, { kind: 'pets', text: 'Không mang thú cưng.' }, { kind: 'children', text: 'Trẻ dưới 5 tuổi ngồi cùng người lớn không tính vé.' }] });
  await call('put', 'admin/settings/seatClasses', A, { items: [{ code: 'standard', name: 'Ghế thường', surcharge: 0 }, { code: 'front', name: 'Hàng đầu', surcharge: 20000 }, { code: 'vip', name: 'Ghế VIP', surcharge: 30000 }] });

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
  const v1 = await call('post', 'manage/vehicles', A, { plateNo: '29B-000.01', kindLabel: 'Limousine 9 chỗ', layoutId: layout.id, year: 2024, colorText: 'Đen', amenities: ['wifi', 'sạc', 'nước'], defaultDriverId: d1.id, parcelMaxKg: 100, parcelMaxPieces: 20, docDates: [{ kind: 'registration', expiresOn: '2027-05-01' }, { kind: 'insurance', expiresOn: '2027-01-15' }] });
  const v2 = await call('post', 'manage/vehicles', A, { plateNo: '29B-000.02', kindLabel: 'Limousine 9 chỗ', layoutId: layout.id, year: 2023, colorText: 'Trắng', amenities: ['wifi', 'sạc'], defaultDriverId: d2.id, parcelMaxKg: 100, parcelMaxPieces: 20 });
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
    for (const time of times) await call('post', 'manage/series', A, { routeId: r.id, vehicleId: v.id, driverId: d.id, weekdays: [0, 1, 2, 3, 4, 5, 6], departTime: time, startDate: start, basePrice: 250000, prices: [{ seatClass: 'vip', price: 270000 }] });
  }
  for (const rid of [route.id, back.id]) {
    for (const [size, max, price] of [['small', 5, 40000], ['small', 10, 60000], ['medium', 20, 90000], ['large', 40, 150000]]) await call('post', 'admin/parcel-rates', A, { routeId: rid, sizeClass: size, maxWeightKg: max, price, extraPerKg: 5000, declaredValuePercent: 1 });
  }
  for (const [name, isProhibited] of [['Quần áo, đồ dùng', false], ['Thực phẩm khô', false], ['Giấy tờ', false], ['Chất cháy nổ', true], ['Hàng cấm theo pháp luật', true]]) await call('post', 'admin/parcel-categories', A, { name, isProhibited });
  await call('post', 'admin/checklist-items', A, { title: 'Kiểm tra xe, lốp, phanh' });
  await call('post', 'admin/checklist-items', A, { title: 'Đối chiếu danh sách khách với tài xế' });
  for (const [q, a] of [['Chuyển khoản thế nào?', 'Sau khi tạo đơn, quét mã QR hoặc chuyển đúng số tài khoản, số tiền và nội dung là mã đơn, rồi gửi ảnh chuyển khoản trong app.'], ['Vì sao nên gửi ảnh sớm?', 'Ghế thuộc về người gửi ảnh chuyển khoản thành công sớm nhất.']]) {
    await call('post', 'admin/faq', A, { language: 'vi', category: 'payment', question: q, answer: a });
  }
  await call('post', 'admin/promotions', A, { code: 'CHAOBAN', title: 'Giảm 10% chuyến đầu', kind: 'percent', value: 10, maxDiscount: 30000, perUserLimit: 1 });
  await call('post', 'admin/announcements', A, { title: 'Chào mừng', body: 'Nhà xe Demo mở bán vé trên ứng dụng.', kind: 'news', notify: false });

  const customerPass = tempPassword();
  await models.Account.deleteOne({ email: CUSTOMER_EMAIL });
  await call('post', 'auth/register', null, { email: CUSTOMER_EMAIL, password: customerPass, displayName: 'Khách Demo', phone: '0909000111', acceptTerms: true });

  console.log('Demo data created. Test accounts (shown once):');
  console.log(`  admin:    ${ADMIN_EMAIL} / ${adminPass}`);
  console.log(`  customer: ${CUSTOMER_EMAIL} / ${customerPass}`);
  return mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
