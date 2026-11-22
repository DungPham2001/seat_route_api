const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const T = require('../src/lib/time');

before(h.start);
after(h.stop);
beforeEach(h.reset);

const seatsOf = async (tripId, token) => Object.fromEntries((await h.api.get(`trips/${tripId}/seats`, token)).body.seats.map((s) => [s.seatId, s]));
const body = (w, seatIds, extra = {}) => ({ tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, pickup: { address: '12 Cầu Giấy, Hà Nội' }, drop: { address: '5 Lý Bôn, Thái Bình' }, seats: seatIds, ...extra });
const book = async (token, w, seatIds, extra = {}) => h.expectOk(await h.api.post('bookings', body(w, seatIds, extra), token), 201);

test('search, trip detail, seat map, quote', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const c = await h.customer();
  const prov = h.expectOk(await h.api.get('provinces?hasTrips=true&side=from', c.token));
  assert.deepEqual(prov.items.map((p) => p.name), ['Hà Nội']);
  const s = h.expectOk(await h.api.get(`trips?fromProvinceId=${w.hn.id}&toProvinceId=${w.tb.id}&date=${w.date}&seats=2`, c.token));
  assert.equal(s.items.length, 1);
  const t = s.items[0];
  assert.equal(t.departTime, '07:30');
  assert.equal(t.status, 'open');
  assert.equal(t.seats.free, 9);
  assert.equal(t.minPrice, 250000);
  assert.equal(t.frontSurcharge, 30000);
  assert.equal(t.vipSurcharge, 60000);
  const d = h.expectOk(await h.api.get(`trips/${w.trip.id}`, c.token));
  assert.equal(d.bookingRule.anytime, true);
  assert.equal(d.bookingRule.maxSeats, 6);
  const map = await seatsOf(w.trip.id, c.token);
  assert.equal(map.TX.state, 'unsellable');
  assert.equal(map.A1.total, 280000); // front row: 250 000 + 30 000
  assert.equal(map.B1.total, 310000); // vip: 250 000 + 60 000
  assert.equal(map.D1.total, 250000);
  assert.equal(map.A1.booking, undefined);
  const q = h.expectOk(await h.api.post('bookings/quote', { tripId: w.trip.id, seats: ['A1', 'B1', 'D1'], pickupOfficeId: w.o1.id, pickupShuttle: { zoneId: w.zone.id, addressText: '10 Xuân Thủy' } }, c.token));
  assert.equal(q.amounts.totalAmount, 280000 + 310000 + 250000 + 30000);
  assert.equal(q.pickupShuttle.plannedTime, '06:50');
});

test('booking holds the seats at once; a taken seat fails the whole request; 8 parallel requests -> one wins', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const c = await h.customer();
  const b = await book(c.token, w, ['A1', 'D1']);
  assert.equal(b.status, 'pending');
  assert.equal(b.payAtCounter, true);
  assert.equal(b.totalAmount, 280000 + 250000);
  assert.equal(b.seats[0].passengerName, 'Nguyễn Văn An'); // name and phone come from the account
  assert.equal(b.seats[0].passengerPhone, '0901234567');
  let map = await seatsOf(w.trip.id, c.token);
  assert.equal(map.A1.state, 'pending');
  assert.equal(map.A1.isMine, true);

  const c2 = await h.customer('b@x.vn', 'B', '0902000222');
  const clash = await h.api.post('bookings', body(w, ['D2', 'A1']), c2.token);
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, 'seat_conflict');
  assert.deepEqual(clash.body.takenSeats, ['A1']);
  map = await seatsOf(w.trip.id, c2.token);
  assert.equal(map.D2.state, 'free'); // nothing is created or held when one seat is taken
  assert.equal(await h.models.Booking.countDocuments(), 1);

  const users = [];
  for (let i = 0; i < 8; i += 1) users.push(await h.customer(`k${i}@x.vn`, `Khách ${i}`, `090100010${i}`));
  const res = await Promise.all(users.map((u) => h.api.post('bookings', body(w, ['C1']), u.token)));
  assert.equal(res.filter((r) => r.status === 201).length, 1);
  assert.equal(res.filter((r) => r.status === 409).length, 7);
  assert.equal(await h.models.TripSeat.countDocuments({ tripId: w.trip.id, state: 'pending' }), 3);

  // Idempotency-Key: a retry returns the same booking.
  const key = { 'Idempotency-Key': 'abc-123' };
  const r2 = await h.request(h.app).post('/v1/bookings').set({ Authorization: `Bearer ${c2.token}`, ...key }).send(body(w, ['D3']));
  const r3 = await h.request(h.app).post('/v1/bookings').set({ Authorization: `Bearer ${c2.token}`, ...key }).send(body(w, ['D3']));
  assert.equal(r2.status, 201);
  assert.equal(r3.status, 200);
  assert.equal(r3.body.id, r2.body.id);
});

test('bookable at any time: no lead time, no days-ahead limit; the owner can still close sales; 6 seats', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const c = await h.customer();
  const place = { pickup: { address: '12 Cầu Giấy, Hà Nội' }, drop: { address: '5 Lý Bôn, Thái Bình' } };
  // A trip leaving in ~2 hours today is still bookable, for customers and for the counter.
  const soon = T.toLocal(T.addMinutes(new Date(), 120));
  const near = h.expectOk(await h.api.post('manage/trips', { routeId: w.route.id, date: soon.date, departTime: soon.time, layoutId: w.layout.id, basePrice: 250000 }, admin), 201);
  assert.equal(near.status, 'open');
  assert.equal((await h.api.post('bookings', { tripId: near.id, ...place, seats: ['D1'] }, c.token)).status, 201);
  h.expectOk(await h.api.post('manage/bookings', { tripId: near.id, ...place, seats: ['D2'], guest: { name: 'Bà Lan', phone: '0988777666' }, payMethod: 'cash' }, admin), 201);
  const tripsToday = h.expectOk(await h.api.get(`trips?fromProvinceId=${w.hn.id}&toProvinceId=${w.tb.id}&date=${soon.date}`, c.token));
  assert.equal(tripsToday.items.some((t) => t.id === near.id), true);

  // 40 days ahead is bookable too.
  const far = h.expectOk(await h.api.post('manage/trips', { routeId: w.route.id, date: T.addDays(T.today(), 40), departTime: '09:00', vehicleId: w.vehicle.id, basePrice: 250000 }, admin), 201);
  assert.equal((await h.api.post('bookings', { tripId: far.id, ...place, seats: ['D1'] }, c.token)).status, 201);

  // Only the owner closing sales stops customers.
  h.expectOk(await h.api.patch(`manage/trips/${far.id}`, { salesClosed: true }, admin));
  assert.equal((await h.api.post('bookings', { tripId: far.id, ...place, seats: ['D2'] }, c.token)).body.code, 'trip_not_on_sale');

  // More than 6 seats.
  const six = await h.api.post('bookings', body(w, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1']), c.token);
  assert.equal(six.status, 400);
  assert.equal(six.body.fields[0].code, 'too_many_seats');
  assert.equal((await h.api.post('bookings', body(w, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']), c.token)).status, 201);
});

test('admin approves: seats sold, points added, paid at the counter; collect records the money and the revenue', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const c = await h.customer();
  const b = await book(c.token, w, ['A1', 'D1']); // 530 000
  const queue = h.expectOk(await h.api.get('manage/bookings?status=pending', admin));
  assert.equal(queue.items[0].id, b.id);
  assert.equal(queue.items[0].customer.displayName, 'Nguyễn Văn An');
  assert.equal(h.expectOk(await h.api.get('manage/inbox/counts', admin)).bookings, 1);

  const ok = h.expectOk(await h.api.post(`manage/bookings/${b.id}/approve`, {}, admin));
  assert.equal(ok.status, 'confirmed');
  assert.equal(ok.paid, false);
  assert.equal(ok.canCollect, true);
  assert.equal((await seatsOf(w.trip.id, c.token)).A1.state, 'sold');
  assert.equal((await h.api.post(`manage/bookings/${b.id}/approve`, {}, admin)).body.code, 'invalid_status');
  assert.equal(h.expectOk(await h.api.get('me/loyalty', c.token)).points, 53);
  const nf = h.expectOk(await h.api.get('notifications', c.token));
  assert.ok(nf.items.some((n) => n.kind === 'booking_confirmed'));

  // Approved but not collected yet: waiting list, no revenue.
  assert.equal(h.expectOk(await h.api.get('manage/inbox/counts', admin)).toCollect, 1);
  assert.equal(h.expectOk(await h.api.get('manage/bookings?payment=unpaid', admin)).items.length, 1);
  assert.equal(h.expectOk(await h.api.get('manage/dashboard', admin)).revenue.today.amount, 0);
  const rec = h.expectOk(await h.api.get(`manage/reports/reconciliation?from=${w.date}&to=${w.date}`, admin));
  assert.equal(rec.totals.approvedUnpaid, 530000);

  assert.equal((await h.api.post(`manage/bookings/${b.id}/collect`, { method: 'bitcoin' }, admin)).status, 400);
  const paid = h.expectOk(await h.api.post(`manage/bookings/${b.id}/collect`, { method: 'cash' }, admin));
  assert.equal(paid.paid, true);
  assert.equal(paid.payMethod, 'cash');
  assert.ok(paid.paidAt);
  assert.equal((await h.api.post(`manage/bookings/${b.id}/collect`, { method: 'cash' }, admin)).body.code, 'invalid_status');
  assert.equal(h.expectOk(await h.api.get('manage/inbox/counts', admin)).toCollect, 0);
  assert.equal(h.expectOk(await h.api.get('manage/dashboard', admin)).revenue.today.amount, 530000);
  assert.ok(h.expectOk(await h.api.get('notifications', c.token)).items.some((n) => n.kind === 'payment_recorded'));

  const rev = h.expectOk(await h.api.get(`manage/revenue?days=7&from=${T.addDays(T.today(), -4)}`, admin));
  assert.equal(rev.total, 530000);
  assert.equal(rev.bySource.app, 530000);
  assert.equal(rev.bySource.counter, 0);
  assert.equal(rev.daily.length, 7);
  assert.equal(rev.previousDaily.length, 7);
  assert.equal(rev.bestDay.amount, 530000);
  assert.equal(rev.byWeekday.length, 7);
  assert.equal(rev.byRoute[0].amount, 530000);
});

test('admin rejects: reason required, seats freed, final status', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const c = await h.customer();
  const b = await book(c.token, w, ['A1']);
  assert.equal((await h.api.post(`manage/bookings/${b.id}/reject`, {}, admin)).status, 400);
  const rej = h.expectOk(await h.api.post(`manage/bookings/${b.id}/reject`, { reason: 'Xe đã được đoàn đặt' }, admin));
  assert.equal(rej.status, 'rejected');
  assert.equal(rej.cancelReason, 'Xe đã được đoàn đặt');
  assert.equal((await seatsOf(w.trip.id, c.token)).A1.state, 'free');
  assert.equal((await h.api.post(`manage/bookings/${b.id}/approve`, {}, admin)).body.code, 'invalid_status');
  assert.ok(h.expectOk(await h.api.get('notifications', c.token)).items.some((n) => n.kind === 'booking_rejected'));
  const again = await book(c.token, w, ['A1']); // the customer can book again
  assert.equal(again.status, 'pending');
  const tabs = h.expectOk(await h.api.get('bookings?tab=cancelled', c.token));
  assert.equal(tabs.items.length, 1); // rejected shows under cancelled
});

test('cancel: pending and unpaid-approved at once; paid goes through the admin with the refund tiers', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  h.expectOk(await h.api.put('admin/cancel-policy', { tiers: [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 6, refundPercent: 70 }, { hoursBefore: 0, refundPercent: 0 }], cancelFee: 10000 }, admin));
  const c = await h.customer();

  // 1. pending -> cancelled at once, seat freed, no refund
  const b1 = await book(c.token, w, ['A1']);
  const can1 = h.expectOk(await h.api.post(`bookings/${b1.id}/cancel`, {}, c.token));
  assert.equal(can1.status, 'cancelled');
  assert.equal((await seatsOf(w.trip.id, c.token)).A1.state, 'free');

  // 2. approved but not paid -> cancelled at once, nothing to refund
  const b2 = await book(c.token, w, ['B1']);
  h.expectOk(await h.api.post(`manage/bookings/${b2.id}/approve`, {}, admin));
  const can2 = h.expectOk(await h.api.post(`bookings/${b2.id}/cancel`, {}, c.token));
  assert.equal(can2.status, 'cancelled');
  assert.equal((await h.api.get('manage/refunds?status=pending', admin)).body.items.length, 0);

  // 3. approved and paid -> cancel_requested; preview 48h before: 100% - 10 000
  const b3 = await book(c.token, w, ['B2']); // 310 000
  h.expectOk(await h.api.post(`manage/bookings/${b3.id}/approve`, {}, admin));
  h.expectOk(await h.api.post(`manage/bookings/${b3.id}/collect`, { method: 'transfer' }, admin));
  const pv = h.expectOk(await h.api.get(`bookings/${b3.id}/cancel-preview`, c.token));
  assert.equal(pv.refundPercent, 100);
  assert.equal(pv.refundAmount, 300000);
  const req = h.expectOk(await h.api.post(`bookings/${b3.id}/cancel`, { note: 'Bận việc' }, c.token));
  assert.equal(req.status, 'requested');
  assert.equal(req.booking.status, 'cancel_requested');
  assert.equal((await seatsOf(w.trip.id, c.token)).B2.state, 'sold'); // still held until the admin decides
  assert.equal(h.expectOk(await h.api.get('manage/inbox?type=cancel', admin)).items.length, 1);

  // reject-cancel puts it back to confirmed
  h.expectOk(await h.api.post(`manage/bookings/${b3.id}/reject-cancel`, { note: 'Xin giữ chỗ' }, admin));
  assert.equal(h.expectOk(await h.api.get(`bookings/${b3.id}`, c.token)).status, 'confirmed');
  h.expectOk(await h.api.post(`bookings/${b3.id}/cancel`, {}, c.token));
  const done = h.expectOk(await h.api.post(`manage/bookings/${b3.id}/approve-cancel`, {}, admin));
  assert.equal(done.booking.status, 'cancelled');
  assert.equal((await seatsOf(w.trip.id, c.token)).B2.state, 'free');
  const refunds = h.expectOk(await h.api.get('manage/refunds?status=pending', admin));
  assert.equal(refunds.items[0].amount, 300000);
  assert.equal(h.expectOk(await h.api.get('manage/dashboard', admin)).revenue.today.amount, 310000); // refund not recorded yet
  h.expectOk(await h.api.post(`manage/refunds/${refunds.items[0].id}/record`, { note: 'Đã hoàn' }, admin));
  assert.equal(h.expectOk(await h.api.get('manage/dashboard', admin)).revenue.today.amount, 10000);
  assert.equal(h.expectOk(await h.api.get(`bookings/${b3.id}`, c.token)).refundedAmount, 300000);
  assert.equal(h.expectOk(await h.api.get('me/loyalty', c.token)).points, 0); // points of the cancelled bookings are taken back
});

test('counter booking: confirmed and paid at once, sold seats, free needs a reason and is not revenue', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const c = await h.customer();
  const mine = await book(c.token, w, ['C1']);
  const clash = await h.api.post('manage/bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, pickup: { address: '12 Cầu Giấy, Hà Nội' }, drop: { address: '5 Lý Bôn, Thái Bình' }, seats: ['C1', 'C2'], guest: { name: 'Bà Lan', phone: '0988777666' }, payMethod: 'cash' }, admin);
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, 'seat_conflict');
  assert.ok(clash.body.freeSeats.includes('C2'));
  const free = await h.api.post('manage/bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, pickup: { address: '12 Cầu Giấy, Hà Nội' }, drop: { address: '5 Lý Bôn, Thái Bình' }, seats: ['C2'], guest: { name: 'Bà Lan', phone: '0988777666' }, payMethod: 'free' }, admin);
  assert.equal(free.body.fields[0].field, 'compReason');
  const ok = h.expectOk(await h.api.post('manage/bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, pickup: { address: '12 Cầu Giấy, Hà Nội' }, drop: { address: '5 Lý Bôn, Thái Bình' }, seats: [{ seatId: 'C2', passengerName: 'Bà Lan' }], guest: { name: 'Bà Lan', phone: '0988777666' }, payMethod: 'free', compReason: 'Người nhà' }, admin), 201);
  assert.equal(ok.status, 'confirmed');
  assert.equal(ok.source, 'counter');
  assert.equal(ok.paid, true);
  assert.equal((await seatsOf(w.trip.id, c.token)).C2.state, 'sold');
  const cash = h.expectOk(await h.api.post('manage/bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, pickup: { address: '12 Cầu Giấy, Hà Nội' }, drop: { address: '5 Lý Bôn, Thái Bình' }, seats: ['D2'], guest: { name: 'Anh Tuấn', phone: '0988111222' }, payMethod: 'cash' }, admin), 201);
  assert.equal(cash.totalAmount, 250000);
  const dash = h.expectOk(await h.api.get('manage/dashboard', admin));
  assert.equal(dash.revenue.today.amount, 250000); // free seat is not revenue
  const rev = h.expectOk(await h.api.get('manage/revenue?days=7', admin));
  assert.equal(rev.bySource.counter, 250000);
  assert.equal(h.expectOk(await h.api.get('manage/bookings?q=Lan', admin)).items.length, 1);
  assert.equal(h.expectOk(await h.api.get(`bookings/${mine.id}`, admin)).status, 'pending'); // admin tokens read every booking
  const lookup = h.expectOk(await h.api.get('admin/guests/lookup?phone=0988777666', admin));
  assert.equal(lookup.guest.name, 'Bà Lan');
});

test('welcome voucher CHAOBAN gives 10% off; only the owner can read a booking', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const c = await h.customer();
  const wallet = h.expectOk(await h.api.get('me/vouchers', c.token)).wallet;
  assert.equal(wallet[0].promotion.code, 'CHAOBAN');
  const q = h.expectOk(await h.api.post('bookings/quote', { tripId: w.trip.id, seats: ['D1'], promoCode: 'CHAOBAN' }, c.token));
  assert.equal(q.amounts.totalAmount, 225000);
  const b = await book(c.token, w, ['D1'], { promoCode: 'CHAOBAN' });
  assert.equal(b.totalAmount, 225000);
  const c2 = await h.customer('b@x.vn', 'B', '0902000222');
  assert.equal((await h.api.get(`bookings/${b.id}`, c2.token)).status, 404);
  assert.equal((await h.api.post('bookings/quote', { tripId: w.trip.id, seats: ['D2'], promoCode: 'CHAOBAN' }, c2.token)).status, 200);
  // used up for the first customer, and given back when the booking is rejected
  assert.equal((await h.api.post('bookings/quote', { tripId: w.trip.id, seats: ['D3'], promoCode: 'CHAOBAN' }, c.token)).body.code, 'promo_invalid'); // the wallet code is used
  h.expectOk(await h.api.post(`manage/bookings/${b.id}/reject`, { reason: 'Hết xe' }, admin));
  assert.equal((await h.api.post('bookings/quote', { tripId: w.trip.id, seats: ['D3'], promoCode: 'CHAOBAN' }, c.token)).status, 200);
});

test('admin moves a booking: reseat and move to another trip keep the seat state', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const c = await h.customer();
  const b = await book(c.token, w, ['D1']);
  h.expectOk(await h.api.post(`manage/bookings/${b.id}/approve`, {}, admin));
  const moved = h.expectOk(await h.api.post(`manage/bookings/${b.id}/assign-seats`, { assignments: [{ bookingSeatId: b.seats[0].id, seatId: 'D3' }], reason: 'Khách muốn ghế bên phải' }, admin));
  assert.equal(moved.seats[0].label, 'D3');
  let map = await seatsOf(w.trip.id, c.token);
  assert.equal(map.D1.state, 'free');
  assert.equal(map.D3.state, 'sold');
  const t2 = h.expectOk(await h.api.post('manage/trips', { routeId: w.route.id, date: T.addDays(T.today(), 3), departTime: '09:00', vehicleId: w.vehicle.id, basePrice: 250000 }, admin), 201);
  const to = h.expectOk(await h.api.post(`manage/bookings/${b.id}/move`, { tripId: t2.id, reason: 'Đổi giờ' }, admin));
  assert.equal(to.trip.id, t2.id);
  map = await seatsOf(t2.id, c.token);
  assert.equal(map.D3.state, 'sold');
  assert.equal((await seatsOf(w.trip.id, c.token)).D3.state, 'free');
  assert.ok(h.expectOk(await h.api.get(`bookings/${b.id}/history`, c.token)).items.some((e) => e.kind === 'trip_changed'));
});
