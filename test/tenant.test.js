const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);
beforeEach(h.reset);

const operator = (n) => h.api.post('auth/register', {
  phone: `09120000${n}0`, email: `chu${n}@nhaxe.vn`, password: h.PASSWORD, displayName: `Nhà xe ${n}`, companyName: `Nhà xe Số ${n}`, taxCode: `01000${n}`,
  acceptTerms: true, deviceName: 'Wayra',
});

test('register creates an operator: admin role, own empty data, starter settings', async () => {
  const res = h.expectOk(await operator(1), 201);
  assert.equal(res.account.role, 'admin');
  const t = res.tokens.accessToken;
  const op = h.expectOk(await h.api.get('operator', t));
  assert.equal(op.profile.name, 'Nhà xe Số 1');
  assert.equal(op.profile.taxCode, '010001');
  assert.equal(h.expectOk(await h.api.get('manage/vehicles', t)).items.length, 0);
  assert.equal(h.expectOk(await h.api.get('manage/seat-layouts', t)).items.length, 3); // the three templates
  assert.equal(h.expectOk(await h.api.get('manage/dashboard', t)).vehicles.total, 0);
  assert.equal((await h.api.post('auth/register', { phone: '0912000010', password: h.PASSWORD, displayName: 'Trùng', acceptTerms: true })).body.code, 'phone_taken');
});

test('two operators never see each other\'s data', async () => {
  const a = h.expectOk(await operator(1), 201).tokens.accessToken;
  const b = h.expectOk(await operator(2), 201).tokens.accessToken;
  const wa = await h.world(a);
  assert.equal(h.expectOk(await h.api.get('manage/vehicles', b)).items.length, 0);
  assert.equal(h.expectOk(await h.api.get('manage/routes', b)).items.length, 0);
  assert.equal(h.expectOk(await h.api.get('manage/offices', b)).items.length, 0);
  assert.equal((await h.api.get(`manage/trips/${wa.trip.id}`, b)).status, 404);
  assert.equal((await h.api.patch(`manage/vehicles/${wa.vehicle.id}`, { colorText: 'Đỏ' }, b)).status, 404);
  assert.equal((await h.api.del(`manage/routes/${wa.route.id}`, {}, b)).status, 404);
  assert.equal(h.expectOk(await h.api.get('admin/admins', b)).items.length, 1);
  // B can use the same plate and office name: unique per operator
  const wb = await h.world(b);
  assert.notEqual(wb.vehicle.id, wa.vehicle.id);
  assert.equal(h.expectOk(await h.api.get('manage/vehicles', a)).items.length, 1);
  // settings are separate
  h.expectOk(await h.api.put('admin/operator', { name: 'Chỉ nhà xe B', phone: '0241234567' }, b));
  assert.equal(h.expectOk(await h.api.get('operator', a)).profile.name, 'Nhà xe Test');
  assert.equal(h.expectOk(await h.api.get('operator', b)).profile.name, 'Chỉ nhà xe B');
});

test('dashboard recentBookings carries customer, passengers, route and departure', async () => {
  const a = h.expectOk(await operator(1), 201).tokens.accessToken;
  const w = await h.world(a);
  const guest = h.expectOk(await h.api.post('manage/bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, pickup: { address: '12 Cầu Giấy, Hà Nội' }, drop: { address: '5 Lý Bôn, Thái Bình' }, seats: [{ seatId: 'D1', passengerName: 'Bà Lan' }], guest: { name: 'Bà Lan', phone: '0988777666' }, payMethod: 'cash' }, a), 201);
  assert.equal(guest.guest.name, 'Bà Lan');
  const d = h.expectOk(await h.api.get('manage/dashboard', a));
  const r = d.recentBookings[0];
  assert.equal(r.routeName, 'Hà Nội → Thái Bình');
  assert.ok(r.departAt);
  assert.equal(r.customer.displayName, 'Bà Lan');
  assert.equal(r.passengers[0].name, 'Bà Lan');
  assert.equal(typeof r.trip, 'object');
  assert.equal(r.trip.route.name, 'Hà Nội → Thái Bình');
  const list = h.expectOk(await h.api.get('manage/bookings', a));
  assert.equal((list.items[0].customer || list.items[0].guest).phone, '0988777666');
});

test('a trip is just "from -> to" with a name; offices are not needed to book', async () => {
  const a = h.expectOk(await operator(1), 201).tokens.accessToken;
  const hn = await h.province('Hà Nội', 1);
  const tb = await h.province('Thái Bình', 2);
  const layout = h.expectOk(await h.api.get('manage/seat-layouts', a)).items.find((l) => l.name.includes('9'));
  const v = h.expectOk(await h.api.post('manage/vehicles', { plateNo: '29B-555.55', kindLabel: 'Limousine 9 chỗ', layoutId: layout.id }, a), 201);
  const date = h.addDays(2);
  const trip = h.expectOk(await h.api.post('manage/trips', { name: 'Sáng Hà Nội - Thái Bình', fromProvinceId: hn.id, toProvinceId: tb.id, durationMinutes: 150, date, departTime: '06:00', vehicleId: v.id, basePrice: 250000 }, a), 201);
  assert.equal(trip.name, 'Sáng Hà Nội - Thái Bình');
  assert.equal(trip.route.name, 'Hà Nội → Thái Bình');
  const again = h.expectOk(await h.api.post('manage/trips', { fromProvinceId: hn.id, toProvinceId: tb.id, date, departTime: '14:00', basePrice: 250000, layoutId: layout.id }, a), 201);
  assert.equal(again.name, 'Hà Nội → Thái Bình'); // no name: the route name
  assert.equal(again.routeId, trip.routeId); // same route reused
  h.expectOk(await h.api.patch(`manage/trips/${again.id}`, { name: 'Chiều' }, a));
  const b = h.expectOk(await h.api.post('manage/bookings', { tripId: trip.id, pickup: { address: '12 Cầu Giấy, Hà Nội', note: 'Cổng sau' }, drop: { address: '5 Lý Bôn, Thái Bình' }, seats: [{ seatId: 'D1', passengerName: 'Bà Lan' }], guest: { name: 'Bà Lan', phone: '0988777666' }, payMethod: 'cash' }, a), 201);
  assert.equal(b.pickupOffice, null);
  assert.equal(b.pickup.address, '12 Cầu Giấy, Hà Nội');
  assert.equal(b.drop.address, '5 Lý Bôn, Thái Bình');
  assert.equal((await h.api.post('manage/bookings', { tripId: trip.id, seats: ['D2'], guest: { name: 'X', phone: '0988777000' }, payMethod: 'cash' }, a)).body.fields[0].field, 'pickup.address');
  const moved = h.expectOk(await h.api.patch(`bookings/${b.id}/places`, { drop: { address: '7 Trần Hưng Đạo, Thái Bình' } }, a));
  assert.equal(moved.drop.address, '7 Trần Hưng Đạo, Thái Bình');
  assert.equal(moved.pickup.address, '12 Cầu Giấy, Hà Nội');
  const man = h.expectOk(await h.api.get(`manage/trips/${trip.id}/manifest`, a));
  assert.equal(man.items[0].pickup.address, '12 Cầu Giấy, Hà Nội');
  assert.equal(b.trip.name, 'Sáng Hà Nội - Thái Bình');
  assert.equal(h.expectOk(await h.api.get('manage/dashboard', a)).recentBookings[0].routeName, 'Sáng Hà Nội - Thái Bình');
});
