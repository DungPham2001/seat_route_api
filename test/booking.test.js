const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);
beforeEach(h.reset);

const seatsOf = async (tripId, token) => Object.fromEntries((await h.api.get(`trips/${tripId}/seats`, token)).body.seats.map((s) => [s.seatId, s]));
const upload = (id, token, seed, key) => {
  const r = h.request(h.app).post(`/v1/bookings/${id}/proofs`).set('Authorization', `Bearer ${token}`);
  if (key) r.set('Idempotency-Key', key);
  return r.attach('file', h.jpeg(seed), 'receipt.jpg');
};
const book = async (token, w, seatIds, extra = {}) => h.expectOk(await h.api.post('bookings', {
  tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id,
  seats: seatIds.map((seatId, i) => ({ seatId, passengerName: `Khách ${i + 1}`, passengerPhone: '0901000111' })), ...extra,
}, token), 201);

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
  assert.equal(t.tzOffset, '+07:00');
  assert.equal(t.status, 'open');
  assert.equal(t.seats.free, 9);
  assert.equal(t.pickupOffices.length, 2);
  assert.equal(t.pickupOffices[1].arriveTime, '08:00');
  assert.equal(t.minPrice, 250000);
  const d = h.expectOk(await h.api.get(`trips/${w.trip.id}`, c.token));
  assert.equal(d.operator.name, 'Nhà xe Test');
  assert.equal(d.seatRule, 'first_receipt_wins');
  const map = await seatsOf(w.trip.id, c.token);
  assert.equal(map.TX.state, 'unsellable');
  assert.equal(map.A1.state, 'free');
  assert.equal(map.A1.booking, undefined);
  const q = h.expectOk(await h.api.post('bookings/quote', { tripId: w.trip.id, seatCount: 3, pickupOfficeId: w.o1.id, pickupShuttle: { zoneId: w.zone.id, addressText: '10 Xuân Thủy' } }, c.token));
  assert.equal(q.amounts.totalAmount, 3 * 250000 + 30000);
  assert.equal(q.pickupShuttle.plannedTime, '06:50');
});

test('first receipt wins: parallel receipts for one seat, loser gets seat_lost, reject frees the seat', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const users = [];
  for (let i = 0; i < 8; i += 1) users.push(await h.customer(`k${i}@x.vn`, `Khách ${i}`, `090100010${i}`));
  const bookings = [];
  for (const u of users) bookings.push(await book(u.token, w, ['B1']));
  // Nobody holds the seat yet; 7 others are "choosing" it.
  const map0 = await seatsOf(w.trip.id, users[0].token);
  assert.equal(map0.B1.state, 'free');
  assert.equal(map0.B1.selectingCount, 7);

  const results = await Promise.all(bookings.map((b, i) => upload(b.id, users[i].token, i + 1)));
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body));
  const winners = results.filter((r) => !r.body.seatLost);
  assert.equal(winners.length, 1);
  assert.equal(results.filter((r) => r.body.seatLost).length, 7);
  const winIdx = results.indexOf(winners[0]);
  assert.equal(winners[0].body.booking.status, 'pending_review');
  const loser = results.find((r) => r.body.seatLost);
  assert.equal(loser.body.booking.status, 'seat_lost');
  assert.deepEqual(loser.body.lostSeats, ['B1']);
  assert.equal((await seatsOf(w.trip.id, users[0].token)).B1.state, 'claimed');

  // Admin sees the proof queue, oldest first, then rejects the winner: the seat is free again.
  const queue = h.expectOk(await h.api.get('manage/proofs', admin));
  assert.equal(queue.total, 8);
  assert.ok(queue.items[0].image.url.includes('/v1/files/'));
  const winProof = queue.items.find((p) => p.orderId === bookings[winIdx].id);
  const rej = await h.api.post(`proofs/${winProof.id}/reject`, { reason: 'Không thấy giao dịch' }, admin);
  assert.equal(rej.status, 200);
  assert.equal((await seatsOf(w.trip.id, admin)).B1.state, 'free');
  const after = h.expectOk(await h.api.get(`bookings/${bookings[winIdx].id}`, users[winIdx].token));
  assert.equal(after.status, 'rejected');
  assert.equal(after.actions.uploadProof, true);

  // A lost-seat customer picks another free seat: held at once (their receipt is already there).
  const loserIdx = results.indexOf(loser);
  const lb = h.expectOk(await h.api.get(`bookings/${bookings[loserIdx].id}`, users[loserIdx].token));
  const re = h.expectOk(await h.api.post(`bookings/${lb.id}/reselect-seats`, { seats: [{ bookingSeatId: lb.seats[0].id, seatId: 'C1' }] }, users[loserIdx].token));
  assert.equal(re.status, 'pending_review');
  assert.equal(re.seats[0].label, 'C1');

  // Approve -> confirmed, seat sold, revenue recorded.
  const p2 = (await h.api.get('manage/proofs', admin)).body.items.find((p) => p.orderId === lb.id);
  h.expectOk(await h.api.post(`proofs/${p2.id}/approve`, {}, admin));
  const conf = h.expectOk(await h.api.get(`bookings/${lb.id}`, users[loserIdx].token));
  assert.equal(conf.status, 'confirmed');
  assert.equal(conf.paidAmount, 250000);
  assert.equal((await seatsOf(w.trip.id, admin)).C1.state, 'sold');
  const dash = h.expectOk(await h.api.get('manage/dashboard', admin));
  assert.equal(dash.revenue.today.amount, 250000);
  const notes = h.expectOk(await h.api.get('notifications', users[loserIdx].token));
  assert.ok(notes.items.some((n) => n.kind === 'booking_confirmed'));
  assert.ok(notes.items.some((n) => n.kind === 'seat_lost' && n.text.includes('B1')));
});

test('payment info QR, idempotent upload, duplicate warning, EXIF stripped, signed file', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const a = await h.customer('a@x.vn');
  const b = await h.customer('b@x.vn', 'B', '0902000222');
  const ba = await book(a.token, w, ['A1', 'A2'], { note: 'Hành lý nhiều' });
  assert.equal(ba.status, 'awaiting_payment');
  assert.ok(ba.payDeadlineSeconds > 3000);
  const pi = h.expectOk(await h.api.get(`bookings/${ba.id}/payment-info`, a.token));
  assert.equal(pi.amount, 500000);
  assert.equal(pi.transferContent, ba.code);
  assert.ok(pi.qrPayload.startsWith('000201010212'));
  assert.ok(pi.qrPayload.includes('0006970436'));
  assert.equal((await h.api.get(`bookings/${ba.id}/payment-info`, b.token)).status, 404);

  const r1 = await upload(ba.id, a.token, 5, 'key-1');
  const r2 = await upload(ba.id, a.token, 5, 'key-1');
  assert.equal(r1.body.proof.id, r2.body.proof.id);
  const bb = await book(b.token, w, ['D1']);
  await upload(bb.id, b.token, 5); // same photo bytes on another order
  const q = h.expectOk(await h.api.get('manage/proofs', admin));
  const pb = q.items.find((p) => p.orderId === bb.id);
  assert.equal(pb.duplicateOf.length, 1);
  assert.equal(pb.duplicateOf[0].orderCode, ba.code);
  const proof = h.expectOk(await h.api.get(`proofs/${pb.id}`, admin));
  const path = proof.image.url.replace(/^.*\/v1\//, '/v1/');
  const file = await h.request(h.app).get(path);
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'image/jpeg');
  assert.equal(file.body.includes(Buffer.from('GPS 21.0285')), false);
  assert.equal((await h.request(h.app).get(path.replace(/sig=[^&]+/, 'sig=bad'))).status, 403);
  // Not an image
  const bad = await h.request(h.app).post(`/v1/bookings/${bb.id}/proofs`).set('Authorization', `Bearer ${b.token}`).attach('file', Buffer.alloc(5000, 7), 'x.jpg');
  assert.equal(bad.body.code, 'proof_invalid_file');
});

test('cancel: unpaid now, paid via request with policy refund; admin booking never takes a claimed seat', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  h.expectOk(await h.api.put('admin/cancel-policy', { tiers: [{ hoursBefore: 12, refundPercent: 80 }, { hoursBefore: 0, refundPercent: 0 }], cancelFee: 10000 }, admin));
  const c = await h.customer();
  const b1 = await book(c.token, w, ['A1']);
  const can = h.expectOk(await h.api.post(`bookings/${b1.id}/cancel`, {}, c.token));
  assert.equal(can.status, 'cancelled');

  const b2 = await book(c.token, w, ['B2']);
  await upload(b2.id, c.token, 9);
  const p = (await h.api.get('manage/proofs', admin)).body.items[0];
  h.expectOk(await h.api.post(`proofs/${p.id}/approve`, {}, admin));
  const pv = h.expectOk(await h.api.get(`bookings/${b2.id}/cancel-preview`, c.token));
  assert.equal(pv.refundPercent, 80);
  assert.equal(pv.refundAmount, 250000 * 0.8 - 10000);
  const req = h.expectOk(await h.api.post(`bookings/${b2.id}/cancel`, { note: 'Bận việc' }, c.token));
  assert.equal(req.status, 'requested');
  const reqs = h.expectOk(await h.api.get('manage/inbox?type=cancel', admin));
  assert.equal(reqs.items.length, 1);
  h.expectOk(await h.api.post(`manage/requests/${req.request.id}/approve`, {}, admin));
  assert.equal((await seatsOf(w.trip.id, admin)).B2.state, 'free');
  const refunds = h.expectOk(await h.api.get('manage/refunds?status=pending', admin));
  assert.equal(refunds.items[0].amount, 190000);
  h.expectOk(await h.api.post(`manage/refunds/${refunds.items[0].id}/record`, { note: 'CK hoàn' }, admin));
  const dash = h.expectOk(await h.api.get('manage/dashboard', admin));
  assert.equal(dash.revenue.today.amount, 250000 - 190000);

  // Admin booking at the counter: C1 is claimed by a customer's receipt -> refused, with free seats.
  const c2 = await h.customer('c2@x.vn', 'C2', '0903000333');
  const b3 = await book(c2.token, w, ['C1']);
  await upload(b3.id, c2.token, 11);
  const clash = await h.api.post('manage/bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, seats: [{ seatId: 'C1', passengerName: 'Bà Lan' }], guest: { name: 'Bà Lan', phone: '0988777666' }, payMethod: 'cash' }, admin);
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, 'seat_taken');
  assert.ok(clash.body.freeSeats.includes('C2'));
  const free = await h.api.post('manage/bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, seats: [{ seatId: 'C2', passengerName: 'Bà Lan' }], guest: { name: 'Bà Lan', phone: '0988777666' }, payMethod: 'free' }, admin);
  assert.equal(free.status, 400);
  assert.equal(free.body.fields[0].field, 'compReason');
  const ok = h.expectOk(await h.api.post('manage/bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, seats: [{ seatId: 'C2', passengerName: 'Bà Lan' }], guest: { name: 'Bà Lan', phone: '0988777666' }, payMethod: 'free', compReason: 'Người nhà' }, admin), 201);
  assert.equal(ok.status, 'confirmed');
  assert.equal(ok.totalAmount, 0);
  assert.match(ok.shareText, /Mã đặt chỗ/);
  assert.equal((await seatsOf(w.trip.id, admin)).C2.state, 'sold');
  const comps = h.expectOk(await h.api.get('manage/reports/comps', admin));
  assert.equal(comps.items[0].value, 250000);

  // Guest registers later and the admin links the booking.
  const lan = await h.customer('lan@x.vn', 'Lan', '0988777666');
  const lookup = h.expectOk(await h.api.get('admin/guests/lookup?phone=0988777666', admin));
  assert.equal(lookup.accounts.length, 1);
  h.expectOk(await h.api.post(`admin/guests/${lookup.guest.id}/link`, { accountId: lookup.accounts[0].id }, admin));
  assert.equal(h.expectOk(await h.api.get('bookings', lan.token)).total, 1);
});

test('trip operations: manifest, boarding, complete -> points, review, reports', async () => {
  const { token: admin } = await h.adminToken();
  const w = await h.world(admin);
  const c = await h.customer();
  const b = await book(c.token, w, ['A1'], { pickupShuttle: { zoneId: w.zone.id, addressText: '10 Xuân Thủy' } });
  assert.equal(b.totalAmount, 280000);
  await upload(b.id, c.token, 3);
  const p = (await h.api.get('manage/proofs', admin)).body.items[0];
  h.expectOk(await h.api.post(`proofs/${p.id}/approve`, {}, admin));
  const man = h.expectOk(await h.api.get(`manage/trips/${w.trip.id}/manifest`, admin));
  assert.equal(man.total, 1);
  assert.equal(man.items[0].email, undefined);
  const sh = h.expectOk(await h.api.get(`manage/trips/${w.trip.id}/shuttle`, admin));
  assert.equal(sh.pickup[0].items[0].addressText, '10 Xuân Thủy');
  h.expectOk(await h.api.post(`manage/trips/${w.trip.id}/boarding`, { marks: [{ bookingSeatId: man.items[0].bookingSeatId, state: 'boarded' }] }, admin));
  const txt = h.expectOk(await h.api.get(`manage/trips/${w.trip.id}/driver-text`, admin));
  assert.match(txt.text, /A1\. Khách 1/);
  h.expectOk(await h.api.post(`manage/trips/${w.trip.id}/logs`, { kind: 'delay', text: 'Tắc đường 15 phút', delayMinutes: 15 }, admin), 201);
  h.expectOk(await h.api.post(`manage/trips/${w.trip.id}/logs`, { kind: 'depart' }, admin), 201);
  h.expectOk(await h.api.post(`manage/trips/${w.trip.id}/logs`, { kind: 'arrive' }, admin), 201);
  const done = h.expectOk(await h.api.get(`bookings/${b.id}`, c.token));
  assert.equal(done.status, 'completed');
  assert.equal(done.trip.updates.some((u) => u.kind === 'delay'), true);
  const loyalty = h.expectOk(await h.api.get('me/loyalty', c.token));
  assert.equal(loyalty.points, 28);
  const rv = h.expectOk(await h.api.post('reviews', { bookingId: b.id, stars: 5, text: 'Xe sạch' }, c.token), 201);
  assert.equal((await h.api.post('reviews', { bookingId: b.id, stars: 4 }, c.token)).body.code, 'already_reviewed');
  const pub = h.expectOk(await h.api.get('reviews', c.token));
  assert.equal(pub.items[0].authorName, 'An N.');
  h.expectOk(await h.api.post(`manage/reviews/${rv.id}/reply`, { reply: 'Cảm ơn bạn' }, admin));
  for (const k of ['reconciliation', 'profit', 'occupancy', 'revenue', 'top', 'rates', 'parcels', 'comps', 'shuttle', 'forecast']) {
    assert.equal((await h.api.get(`manage/reports/${k}`, admin)).status, 200, k);
  }
  const csv = await h.request(h.app).get('/v1/manage/export?type=bookings').set('Authorization', `Bearer ${admin}`);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /code,route,departure/);
  const stats = h.expectOk(await h.api.get('me/stats', c.token));
  assert.equal(stats.completedTrips, 1);
  const home = h.expectOk(await h.api.get('home', c.token));
  assert.equal(home.greeting.displayName, 'Nguyễn Văn An');
});
