/** Calls (almost) every endpoint once for each role: no 5xx anywhere, and the documented status codes. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);

test('every endpoint answers without a server error', async () => {
  const { token: A } = await h.adminToken();
  const w = await h.world(A);
  const c = await h.customer();
  const C = c.token;
  h.expectOk(await h.api.post('admin/parcel-rates', { routeId: w.route.id, sizeClass: 'small', maxWeightKg: 10, price: 40000 }, A), 201);
  const b = h.expectOk(await h.api.post('bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, pickup: { address: '12 Cầu Giấy, Hà Nội' }, drop: { address: '5 Lý Bôn, Thái Bình' }, seats: ['A1'] }, C), 201);
  const p = h.expectOk(await h.api.post('parcels', { routeId: w.route.id, date: w.date, fromOfficeId: w.o1.id, toOfficeId: w.o3.id, descriptionText: 'Áo', weightKg: 2, sizeClass: 'small', receiver: { name: 'Hoa', phone: '0977000111' }, commitAccepted: true }, C), 201);
  const msg = h.expectOk(await h.api.post(`bookings/${b.id}/messages`, { text: 'Cho em gửi thêm vali' }, C), 201);
  h.expectOk(await h.api.post(`bookings/${b.id}/messages`, { text: 'Được ạ' }, A), 201);
  h.expectOk(await h.api.post('reports', { targetType: 'message', targetId: msg.id, reason: 'spam' }, C), 201);
  const complaint = h.expectOk(await h.api.post('complaints', { orderType: 'booking', orderId: b.id, text: 'Chờ lâu' }, C), 201);
  h.expectOk(await h.api.post('contact', { subject: 'Hỏi', text: 'Có xe 5h không?' }, C), 201);
  h.expectOk(await h.api.post(`trips/${w.trip.id}/waitlist`, { seatCount: 2 }, C), 201);
  h.expectOk(await h.api.post('admin/prohibited-items', { text: 'Vũ khí' }, A), 201);
  const promo = h.expectOk(await h.api.post('admin/promotions', { code: 'tet2027', kind: 'percent', value: 10, maxDiscount: 50000 }, A), 201);
  assert.equal(promo.code, 'TET2027');
  h.expectOk(await h.api.post(`admin/promotions/${promo.id}/grant`, { accountIds: [c.body.account.id] }, A));
  h.expectOk(await h.api.post('admin/announcements', { title: 'Nghỉ Tết', body: 'Lịch chạy Tết', kind: 'holiday' }, A), 201);
  h.expectOk(await h.api.post('admin/faq', { language: 'vi', question: 'Chuyển khoản thế nào?', answer: 'Quét QR' }, A), 201);
  h.expectOk(await h.api.post('admin/checklist-items', { title: 'Kiểm tra lốp' }, A), 201);
  h.expectOk(await h.api.put('admin/settings/content', { termsVi: 'Điều khoản...' }, A));
  h.expectOk(await h.api.post(`manage/trips/${w.trip.id}/expenses`, { category: 'fuel', amount: 500000 }, A), 201);
  h.expectOk(await h.api.post('manage/maintenance', { vehicleId: w.vehicle.id, date: '2026-11-01', description: 'Thay dầu', cost: 800000, nextDueOn: '2026-11-20' }, A), 201);
  h.expectOk(await h.api.post('admin/staff-schedules', { staffId: w.driver.id, date: w.date, kind: 'work', shift: 'morning' }, A), 201);
  h.expectOk(await h.api.post('admin/seasonal-prices', { name: 'Tết', fromDate: '2027-02-01', toDate: '2027-02-10', adjustKind: 'percent', adjustValue: 20 }, A), 201);

  const customerGets = [
    'me', 'home', 'devices', 'me/devices', 'notifications', 'notifications/unread-count', 'operator', 'cancel-policy', 'provinces', `provinces/${w.hn.id}/offices?routeId=${w.route.id}&side=pickup`,
    'offices', `offices/${w.o1.id}/shuttle-zones?direction=pickup`, 'routes/available', `routes/${w.route.id}/info`, 'faq', 'content/terms', 'announcements', 'reviews',
    `trips/${w.trip.id}`, `trips/${w.trip.id}/seats`, `trips/${w.trip.id}/alternatives`, 'bookings?tab=pending', 'bookings?tab=upcoming', `bookings/${b.id}`, `bookings/${b.id}/history`,
    `bookings/${b.id}/share-text`, `bookings/${b.id}/messages`, `bookings/${b.id}/cancel-preview`, `bookings/${b.id}/rebook`,
    'parcels?tab=active', 'parcels/config', `parcels/${p.id}`, `parcels/${p.id}/cancel-preview`, `parcels/${p.id}/share-text`,
    `complaints/${complaint.id}`, 'me/favorite-routes', 'me/recent-routes',
    'me/loyalty', 'me/vouchers', 'me/referral', 'me/stats', 'me/requests', 'me/refunds', 'me/waitlist', 'me/reviews', 'me/complaints', 'me/contact', 'me/data', 'me/export',
  ];
  for (const path of customerGets) {
    const res = await h.api.get(path, C);
    assert.ok(res.status < 300, `customer GET ${path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  const vouchers = h.expectOk(await h.api.get('me/vouchers', C));
  assert.ok(vouchers.wallet.some((v) => v.promotion.code === 'TET2027'));
  assert.ok(vouchers.wallet.some((v) => v.promotion.code === 'CHAOBAN'));
  const nf = h.expectOk(await h.api.get('notifications', C));
  assert.ok(nf.items.some((n) => n.kind === 'announcement' && n.title === 'Nghỉ Tết'));

  const adminGets = [
    'manage/dashboard?range=7d&chart=30', 'manage/inbox/counts', 'manage/revenue?days=30', 'manage/bookings?payment=unpaid', 'manage/customers', ...['booking', 'cancel', 'collect', 'refund', 'parcel', 'report', 'complaint', 'message', 'contact'].map((t) => `manage/inbox?type=${t}`),
    'manage/calendar', 'manage/bookings', 'manage/requests', 'manage/refunds', `manage/trips?from=${w.date}&to=${w.date}`, 'manage/trips/merge-suggestions',
    `manage/trips/${w.trip.id}`, `manage/trips/${w.trip.id}/seats`, `manage/trips/${w.trip.id}/driver-suggestions`, `manage/trips/${w.trip.id}/manifest`, `manage/trips/${w.trip.id}/shuttle`,
    `manage/trips/${w.trip.id}/logs`, `manage/trips/${w.trip.id}/driver-text`, `manage/trips/${w.trip.id}/parcels`, `manage/trips/${w.trip.id}/waitlist`, `manage/trips/${w.trip.id}/expenses`,
    'manage/series', 'manage/parcels', `manage/parcels/${p.id}/share-text`, 'manage/reviews', 'manage/messages', 'admin/reports', 'admin/complaints', 'admin/contact-messages', 'admin/actions',
    ...['reconciliation', 'profit?groupBy=route', 'profit?groupBy=vehicle', 'occupancy?groupBy=hour', 'revenue?groupBy=month', 'top', 'rates', 'parcels', 'comps', 'shuttle', 'forecast'].map((k) => `manage/reports/${k}`),
    'manage/export?type=trips', 'manage/export?type=reconciliation', 'manage/export?type=parcels', 'admin/settings', 'admin/settings/loyalty', 'admin/admins',
    'admin/customers', `admin/customers/${c.body.account.id}`, 'admin/search?q=an', 'admin/onboarding', 'admin/guests/lookup?phone=0901234567',
    'manage/seat-layouts/templates', 'manage/routes/stats', 'admin/provinces', 'manage/offices', 'manage/shuttle-zones', 'manage/seat-layouts', 'manage/vehicles', 'manage/maintenance',
    'admin/staff', 'admin/staff-schedules', 'manage/routes', 'admin/promotions', 'admin/seasonal-prices', 'admin/announcements', 'admin/faq', 'admin/checklist-items',
    'admin/parcel-categories', 'admin/prohibited-items', 'admin/parcel-rates', 'admin/guests', `complaints/${complaint.id}`, `bookings/${b.id}`, `parcels/${p.id}`, `trips/${w.trip.id}/seats`,
  ];
  for (const path of adminGets) {
    const res = await h.api.get(path, A);
    assert.ok(res.status < 300, `admin GET ${path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  const counts = h.expectOk(await h.api.get('manage/inbox/counts', A));
  assert.deepEqual([counts.bookings, counts.parcels, counts.reports, counts.complaints, counts.contacts, counts.messages], [1, 1, 1, 1, 1, 0]);
  const dash = h.expectOk(await h.api.get('manage/dashboard', A));
  assert.ok(dash.alerts.some((x) => x.kind === 'maintenance_due'));

  // A few writes not covered elsewhere.
  h.expectOk(await h.api.post(`manage/bookings/${b.id}/approve`, {}, A));
  h.expectOk(await h.api.post(`manage/bookings/${b.id}/collect`, { method: 'cash' }, A));
  assert.equal(h.expectOk(await h.api.get(`bookings/${b.id}`, C)).paid, true);
  h.expectOk(await h.api.post(`manage/bookings/${b.id}/notes`, { text: 'Khách quen' }, A), 201);
  h.expectOk(await h.api.post(`manage/trips/${w.trip.id}/seats/D3/lock`, { reason: 'Ghế hỏng' }, A));
  assert.equal(h.expectOk(await h.api.get(`trips/${w.trip.id}/seats`, C)).seats.find((s) => s.seatId === 'D3').state, 'locked');
  h.expectOk(await h.api.post(`manage/trips/${w.trip.id}/notify`, { text: 'Có mặt trước 15 phút' }, A));
  h.expectOk(await h.api.put(`manage/trips/${w.trip.id}/checklist`, {}, A));
  const cl = h.expectOk(await h.api.get(`manage/trips/${w.trip.id}`, A)).checklist;
  h.expectOk(await h.api.patch(`manage/trips/${w.trip.id}/checklist/${cl[0].itemId}`, { isDone: true }, A));
  h.expectOk(await h.api.put(`manage/trips/${w.trip.id}/driver`, { driverId: w.driver.id }, A));
  h.expectOk(await h.api.patch(`manage/trips/${w.trip.id}`, { departTime: '07:45' }, A));
  assert.ok(h.expectOk(await h.api.get('notifications?category=trip', C)).items.some((n) => n.kind === 'trip_time_changed'));
  h.expectOk(await h.api.patch(`manage/offices/${w.o2.id}`, { isActive: false }, A));
  h.expectOk(await h.api.post(`complaints/${complaint.id}/replies`, { text: 'Đã xử lý', status: 'resolved' }, A));
  h.expectOk(await h.api.post(`admin/reports/${(await h.api.get('admin/reports', A)).body.items[0].id}/resolve`, { action: 'hide_content', resolution: 'Spam' }, A));
  h.expectOk(await h.api.post(`admin/accounts/${c.body.account.id}/suspend`, { reason: 'Thử' }, A));
  assert.equal((await h.api.get('me', C)).body.code, 'session_revoked');
  h.expectOk(await h.api.post(`admin/accounts/${c.body.account.id}/unsuspend`, {}, A));
  h.expectOk(await h.api.post(`manage/parcels/${p.id}/reject`, { reason: 'Đầy hàng' }, A));
  const jobs = h.expectOk(await h.api.get('jobs/run'));
  assert.equal(jobs.ok, true);
  assert.equal((await h.api.get('health')).body.status, 'ok');
  assert.equal((await h.request(h.app).get('/privacy?lang=en')).status, 200);
  assert.equal((await h.request(h.app).get('/account/delete')).status, 200);
});
