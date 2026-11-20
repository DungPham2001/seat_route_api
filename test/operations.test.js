const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const T = require('../src/lib/time');

before(h.start);
after(h.stop);
beforeEach(h.reset);

test('parcel: quote, accept with capacity, fee collected when received at the counter, milestones, handover code', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  h.expectOk(await h.api.post('admin/parcel-rates', { routeId: w.route.id, sizeClass: 'small', maxWeightKg: 5, price: 40000, extraPerKg: 5000, declaredValuePercent: 1 }, admin), 201);
  const banned = h.expectOk(await h.api.post('admin/parcel-categories', { name: 'Chất cháy nổ', isProhibited: true }, admin), 201);
  h.expectOk(await h.api.put(`manage/trips/${w.trip.id}/parcel-capacity`, { maxKg: 10, maxPieces: 5 }, admin));
  const c = await h.customer();
  const cfg = h.expectOk(await h.api.get('parcels/config', c.token));
  assert.equal(cfg.prohibited[0].name, 'Chất cháy nổ');
  assert.equal(cfg.routes[0].fromOffices.length, 2);
  const body = { routeId: w.route.id, date: w.date, fromOfficeId: w.o1.id, toOfficeId: w.o3.id, descriptionText: 'Hộp bánh', weightKg: 7, sizeClass: 'small', declaredValue: 500000, receiver: { name: 'Chị Hoa', phone: '0977000111' } };
  const q = h.expectOk(await h.api.post('parcels/quote', body, c.token));
  assert.equal(q.estimate.total, 40000 + 2 * 5000 + 5000);
  assert.equal((await h.api.post('parcels', { ...body, categoryId: banned.id, commitAccepted: true }, c.token)).body.code, 'parcel_prohibited');
  assert.equal((await h.api.post('parcels', body, c.token)).body.fields[0].code, 'commitment_required');
  const p = h.expectOk(await h.api.post('parcels', { ...body, commitAccepted: true }, c.token), 201);
  assert.match(p.handoverCode, /^\d{6}$/);
  assert.equal(p.status, 'pending');

  // Too heavy for the trip after weighing -> capacity_exceeded; normal weight -> accepted.
  assert.equal((await h.api.post(`manage/parcels/${p.id}/accept`, { tripId: w.trip.id, actualWeightKg: 12, feeAdjustReason: 'Cân thực tế' }, admin)).body.code, 'capacity_exceeded');
  const acc = h.expectOk(await h.api.post(`manage/parcels/${p.id}/accept`, { tripId: w.trip.id }, admin));
  assert.equal(acc.status, 'accepted');
  assert.equal(acc.fee, 55000);
  assert.equal(acc.paid, false);
  assert.equal(h.expectOk(await h.api.get('manage/dashboard', admin)).revenue.today.parcel, 0);
  // The sender pays at the counter: marking the goods received records the fee (revenue from that moment).
  const rcv = h.expectOk(await h.api.post(`manage/parcels/${p.id}/status`, { status: 'received', payMethod: 'cash' }, admin));
  assert.equal(rcv.paid, true);
  assert.equal(rcv.payMethod, 'cash');
  for (const s of ['loaded', 'arrived']) h.expectOk(await h.api.post(`manage/parcels/${p.id}/status`, { status: s }, admin));
  const wrong = await h.api.post(`manage/parcels/${p.id}/handover`, { code: '000000' === p.handoverCode ? '111111' : '000000' }, admin);
  assert.equal(wrong.body.code, 'handover_invalid');
  assert.equal(wrong.body.attemptsLeft, 4);
  const done = h.expectOk(await h.api.post(`manage/parcels/${p.id}/handover`, { code: p.handoverCode }, admin));
  assert.equal(done.status, 'delivered');
  assert.equal(done.timeline.every((x) => x.done), true);
  const tp = h.expectOk(await h.api.get(`manage/trips/${w.trip.id}/parcels`, admin));
  assert.equal(tp.load.kg, 7);
  const dash = h.expectOk(await h.api.get('manage/dashboard', admin));
  assert.equal(dash.revenue.today.parcel, 55000);
});

test('recurring series, overlap check with force, admin moves a booking, cancelling a trip refunds', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const series = h.expectOk(await h.api.post('manage/series', { routeId: w.route.id, vehicleId: w.vehicle.id, weekdays: [0, 1, 2, 3, 4, 5, 6], departTime: '14:00', startDate: T.today(), endDate: T.addDays(T.today(), 6), basePrice: 270000 }, admin), 201);
  assert.ok(series.createdTrips >= 6);
  // Same vehicle at 08:00 on the test day overlaps the 07:30 trip (150 min + 60 rest).
  const clash = await h.api.post('manage/trips', { routeId: w.route.id, date: w.date, departTime: '08:00', vehicleId: w.vehicle.id }, admin);
  assert.equal(clash.body.code, 'schedule_conflict');
  assert.equal(clash.body.conflicts[0].kind, 'vehicle');
  h.expectOk(await h.api.post('manage/trips', { routeId: w.route.id, date: w.date, departTime: '08:00', vehicleId: w.vehicle.id, force: true, overrideReason: 'Xe dự phòng' }, admin), 201);
  const list = h.expectOk(await h.api.get(`manage/trips?from=${w.date}&to=${w.date}`, admin));
  assert.ok(list.items.some((t) => t.warnings.includes('vehicle_conflict')));
  const ex = h.expectOk(await h.api.post(`manage/series/${series.id}/exceptions`, { date: T.addDays(T.today(), 4), type: 'skip', note: 'Nghỉ' }, admin));
  assert.equal(ex.exceptions.length, 1);

  const c = await h.customer();
  const b = h.expectOk(await h.api.post('bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, seats: ['D1'] }, c.token), 201);
  h.expectOk(await h.api.post(`manage/bookings/${b.id}/approve`, {}, admin));
  h.expectOk(await h.api.post(`manage/bookings/${b.id}/collect`, { method: 'cash' }, admin));
  const target = h.expectOk(await h.api.get(`trips?fromProvinceId=${w.hn.id}&toProvinceId=${w.tb.id}&date=${w.date}`, c.token)).items.find((t) => t.departTime === '14:00');
  h.expectOk(await h.api.post(`manage/bookings/${b.id}/move`, { tripId: target.id, reason: 'Đi chiều' }, admin));
  const moved = h.expectOk(await h.api.get(`bookings/${b.id}`, c.token));
  assert.equal(moved.trip.id, target.id);
  assert.equal(moved.trip.departTime, '14:00');
  assert.equal(moved.seats[0].label, 'D1');
  const map = h.expectOk(await h.api.get(`trips/${target.id}/seats`, c.token)).seats.find((s) => s.seatId === 'D1');
  assert.equal(map.state, 'sold');
  assert.equal(map.isMine, true);
  const hist = h.expectOk(await h.api.get(`bookings/${b.id}/history`, c.token));
  assert.ok(hist.items.some((e) => e.kind === 'trip_changed'));

  // Cancel the old trip: nothing left on it; cancel the new one: refund pending for the passenger.
  const res = h.expectOk(await h.api.post(`manage/trips/${target.id}/cancel`, { reason: 'Xe hỏng' }, admin));
  assert.equal(res.cancelledBookings, 1);
  const refunds = h.expectOk(await h.api.get('me/refunds', c.token));
  assert.equal(refunds.items[0].amount, 250000); // trip cancelled: full refund of what was paid
  const n = h.expectOk(await h.api.get('notifications?category=trip', c.token));
  assert.ok(n.items.some((x) => x.kind === 'trip_cancelled'));
});

test('privacy: blocked while a trip is active; deletion erases personal data', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const c = await h.customer();
  h.expectOk(await h.api.post(`me/favorite-routes/${w.route.id}`, {}, c.token), 201);
  const b = h.expectOk(await h.api.post('bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, seats: ['A1'] }, c.token), 201);
  const data = h.expectOk(await h.api.get('me/data', c.token));
  assert.equal(data.counts.bookings, 1);
  const blocked = await h.api.del('me', { password: h.PASSWORD }, c.token);
  assert.equal(blocked.body.code, 'has_active_orders');
  h.expectOk(await h.api.post(`manage/bookings/${b.id}/reject`, { reason: 'Hết xe' }, admin));
  assert.equal((await h.api.del('me', { password: h.PASSWORD }, c.token)).status, 204);
  const left = await h.models.Booking.findById(b.id).lean();
  assert.equal(left.customerAccountId, null);
  assert.equal(left.seats[0].passengerName, '');
  assert.equal(await h.models.FavoriteRoute.countDocuments(), 0);
  assert.equal((await h.api.post('auth/login', { email: 'khach@example.com', password: h.PASSWORD })).status, 401);
});

test('catalog CRUD rules, CSV import preview, search, settings validation', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const del = await h.api.del(`admin/provinces/${w.hn.id}`, {}, admin);
  assert.equal(del.body.code, 'has_dependents');
  const wrong = await h.api.post('manage/routes', { fromProvinceId: w.hn.id, toProvinceId: w.tb.id, durationMinutes: 100, offices: [{ officeId: w.o3.id, side: 'pickup', offsetMinutes: 0 }] }, admin);
  assert.equal(wrong.body.fields[0].code, 'wrong_province');
  const rev = h.expectOk(await h.api.post(`manage/routes/${w.route.id}/duplicate`, { reverse: true }, admin), 201);
  assert.equal(rev.name, 'Thái Bình → Hà Nội');
  assert.equal(rev.offices.find((o) => o.side === 'pickup').officeId, w.o3.id);
  const csv = 'kind;name;phone;licenseExpiresOn\nlimo_driver;Tài xế Cường;0912333444;2031-05-01\nbad_kind;X;;\n';
  const pv = h.expectOk(await h.api.post('admin/import/staff', { csv }, admin));
  assert.equal(pv.valid, 1);
  assert.equal(pv.invalid, 1);
  assert.equal(pv.rows[1].errors[0].field, 'kind');
  const commit = await h.api.post('admin/import/staff', { csv: csv.split('\n').slice(0, 2).join('\n'), dryRun: false }, admin);
  assert.equal(commit.body.created, 1);
  const s = h.expectOk(await h.api.get('admin/search?q=thai binh', admin));
  assert.ok(s.trips.length >= 1);
  assert.equal((await h.api.put('admin/settings/system', { bookingLeadHours: 500 }, admin)).body.fields[0].code, 'out_of_range');
  assert.equal(h.expectOk(await h.api.put('admin/settings/system', { bookingLeadHours: 3 }, admin)).bookingLeadHours, 3);
  assert.equal(h.expectOk(await h.api.get('cancel-policy', admin)).cancelFee, 10000);
  assert.equal(h.expectOk(await h.api.get('cancel-policy', admin)).tiers[0].refundPercent, 100);
  const ob = h.expectOk(await h.api.get('admin/onboarding', admin));
  assert.equal(ob.steps.find((x) => x.key === 'first_trip').done, true);
  const inbox = h.expectOk(await h.api.get('manage/inbox/counts', admin));
  assert.equal(inbox.total, 0);
  const cal = h.expectOk(await h.api.get('manage/calendar', admin));
  assert.equal(cal.days.length, 7);
});

test('trip repeats on weekdays for 4 weeks (skipping clashes); vehicles: shuttle has no layout and cannot run a trip; layout rules', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const wd = T.weekday(T.addDays(T.today(), 5));
  const rep = h.expectOk(await h.api.post('manage/trips', { routeId: w.route.id, date: T.addDays(T.today(), 5), departTime: '10:00', vehicleId: w.vehicle.id, basePrice: 250000, repeatWeekdays: [wd] }, admin), 201);
  assert.equal(rep.repeatedTrips, 4);
  const list = h.expectOk(await h.api.get(`manage/trips?from=${T.addDays(T.today(), 5)}&to=${T.addDays(T.today(), 40)}`, admin));
  assert.equal(list.items.filter((t) => t.departTime === '10:00').length, 5);

  const shuttle = h.expectOk(await h.api.post('manage/vehicles', { type: 'shuttle', plateNo: '29b-999.99', capacity: 16 }, admin), 201);
  assert.equal(shuttle.seatCount, 16);
  assert.equal(shuttle.plateNo, '29B-999.99');
  assert.equal(shuttle.layoutId, null);
  const bad = await h.api.post('manage/trips', { routeId: w.route.id, date: T.addDays(T.today(), 3), departTime: '09:00', vehicleId: shuttle.id }, admin);
  assert.equal(bad.status, 400);
  assert.equal((await h.api.post('manage/vehicles', { type: 'limo', plateNo: '29B-111.11' }, admin)).body.fields[0].field, 'layoutId');
  assert.equal(w.vehicle.frontSurcharge, 30000);
  assert.equal(w.vehicle.seatCount, 10); // 9 seats for sale + the driver's place

  const cells = [{ id: 'A1', label: 'A1', row: 0, col: 0, seatClass: 'standard', isSellable: true }, { id: 'A2', label: 'A2', row: 0, col: 1 }];
  const driverCell = await h.api.post('manage/seat-layouts', { name: 'Sai', rows: 3, cols: 3, seats: cells }, admin);
  assert.ok(driverCell.body.fields.some((f) => f.code === 'driver_cell'));
  const tooSmall = await h.api.post('manage/seat-layouts', { name: 'Nhỏ', rows: 3, cols: 3, seats: [{ id: 'A1', label: 'A1', row: 0, col: 1 }] }, admin);
  assert.ok(tooSmall.body.fields.some((f) => f.code === 'too_few_seats'));
  assert.equal((await h.api.post('manage/seat-layouts', { name: 'Lớn', rows: 9, cols: 3, seats: [] }, admin)).status, 400);

  // a vehicle can take over a trip only with the same layout
  const tpl = h.expectOk(await h.api.get('manage/seat-layouts/templates', admin)).items.find((t) => t.key === '11');
  const l11 = h.expectOk(await h.api.post('manage/seat-layouts', { name: tpl.name, rows: tpl.rows, cols: tpl.cols, seats: tpl.seats }, admin), 201);
  const v11 = h.expectOk(await h.api.post('manage/vehicles', { type: 'limo', plateNo: '29B-222.22', layoutId: l11.id }, admin), 201);
  assert.equal((await h.api.put(`manage/trips/${w.trip.id}/vehicle`, { vehicleId: v11.id }, admin)).body.code, 'seats_mismatch');
  const v9 = h.expectOk(await h.api.post('manage/vehicles', { type: 'limo', plateNo: '29B-333.33', layoutId: w.layout.id }, admin), 201);
  assert.equal(h.expectOk(await h.api.put(`manage/trips/${w.trip.id}/vehicle`, { vehicleId: v9.id }, admin)).vehicleId, v9.id);
});
