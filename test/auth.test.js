const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);
beforeEach(h.reset);

test('register, login, refresh rotation, reuse detection, logout', async () => {
  const reg = await h.api.post('auth/register', { email: 'An@Example.com', password: h.PASSWORD, displayName: 'An', phone: '+84 901 234 567', acceptTerms: true });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.account.email, 'an@example.com');
  assert.equal(reg.body.account.phone, '0901234567');
  assert.equal(reg.body.account.role, 'customer');
  assert.ok(reg.body.account.referralCode);
  assert.ok(reg.body.member);

  const dup = await h.api.post('auth/register', { email: 'an@example.com', password: h.PASSWORD, displayName: 'An', phone: '0901234567', acceptTerms: true });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'email_taken');

  const weak = await h.api.post('auth/register', { email: 'b@example.com', password: 'abc', displayName: 'B', phone: '0901234567' });
  assert.equal(weak.status, 400);
  assert.deepEqual(weak.body.fields.map((f) => f.code).sort(), ['terms_required', 'weak_password']);

  const login = await h.api.post('auth/login', { email: 'an@example.com', password: h.PASSWORD });
  assert.equal(login.status, 200);
  const r1 = await h.api.post('auth/refresh', { refreshToken: login.body.tokens.refreshToken });
  assert.equal(r1.status, 200);
  const reuse = await h.api.post('auth/refresh', { refreshToken: login.body.tokens.refreshToken });
  assert.equal(reuse.body.code, 'refresh_reused');
  const after = await h.api.get('me', r1.body.tokens.accessToken);
  assert.equal(after.body.code, 'session_revoked');

  const bad = await h.api.post('auth/login', { email: 'an@example.com', password: 'sai123456' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, 'invalid_credentials');
});

test('forgot / reset password signs out every device', async () => {
  const c = await h.customer();
  const f = await h.api.post('auth/forgot', { email: 'khach@example.com' });
  assert.equal(f.status, 202);
  assert.match(f.body.devToken, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const unknown = await h.api.post('auth/forgot', { email: 'nobody@example.com' });
  assert.equal(unknown.status, 202);
  assert.equal(unknown.body.devToken, undefined);
  const r = await h.api.post('auth/reset', { token: f.body.devToken.toLowerCase(), newPassword: 'MoiMatkhau9' });
  assert.equal(r.status, 204);
  assert.equal((await h.api.get('me', c.token)).body.code, 'session_revoked');
  assert.equal((await h.api.post('auth/login', { email: 'khach@example.com', password: 'MoiMatkhau9' })).status, 200);
  assert.equal((await h.api.post('auth/reset', { token: f.body.devToken, newPassword: 'MoiMatkhau9' })).body.code, 'reset_invalid');
});

test('no forced password change; roles are checked on the server', async () => {
  const { token: admin, login } = await h.adminToken();
  assert.equal(login.mustChangePassword, undefined);
  assert.equal((await h.api.get('manage/dashboard', admin)).status, 200);
  const c = await h.customer();
  for (const [m, p] of [['get', 'manage/dashboard'], ['get', 'admin/settings'], ['post', 'manage/trips'], ['get', 'manage/vehicles'], ['post', 'manage/bookings/x/approve'], ['get', 'admin/customers'], ['get', 'manage/revenue'], ['post', 'manage/customers']]) {
    const res = await h.api[m](p, m === 'get' ? c.token : {}, c.token);
    assert.equal(res.status, 403, `${m} ${p}`);
  }
  assert.equal((await h.api.get('home', admin)).status, 403);
  assert.equal((await h.api.get('trips?fromProvinceId=a&toProvinceId=b')).status, 401);
});

test('register: email is optional, phone is required, password needs upper + lower + digit', async () => {
  const noEmail = await h.api.post('auth/register', { password: h.PASSWORD, displayName: 'Chỉ SĐT', phone: '0912345678', acceptTerms: true });
  assert.equal(noEmail.status, 201);
  assert.equal(noEmail.body.account.email, null);
  assert.equal((await h.api.post('auth/login', { login: '0912345678', password: h.PASSWORD })).status, 200);
  assert.equal((await h.api.post('auth/register', { email: 'x@x.vn', password: h.PASSWORD, displayName: 'X', acceptTerms: true })).body.fields[0].field, 'phone');
  for (const bad of ['matkhau123', 'MATKHAU123', 'Matkhauabc', 'Mk1']) {
    const r = await h.api.post('auth/register', { email: `${bad}@x.vn`, password: bad, displayName: 'X', phone: '0933000111', acceptTerms: true });
    assert.equal(r.body.fields[0].code, 'weak_password', bad);
  }
  // two accounts without an email do not collide on the empty email
  assert.equal((await h.api.post('auth/register', { password: h.PASSWORD, displayName: 'Hai', phone: '0912345679', acceptTerms: true })).status, 201);
});

test('forgot password: a phone-only account leaves a message for the admin, who sets a temporary password', async () => {
  const { token: admin } = await h.adminToken();
  const reg = h.expectOk(await h.api.post('auth/register', { password: h.PASSWORD, displayName: 'Chỉ SĐT', phone: '0912345678', acceptTerms: true }), 201);
  const f = await h.api.post('auth/forgot', { login: '0912345678' });
  assert.equal(f.status, 202);
  assert.equal(f.body.devToken, undefined); // no email to send a code to
  const inbox = h.expectOk(await h.api.get('manage/inbox?type=contact', admin));
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].subject, 'password_reset');
  const reset = h.expectOk(await h.api.post(`manage/customers/${reg.account.id}/reset-password`, {}, admin));
  assert.ok(reset.temporaryPassword);
  assert.equal((await h.api.get('me', reg.tokens.accessToken)).body.code, 'session_revoked');
  assert.equal((await h.api.post('auth/login', { login: '0912345678', password: reset.temporaryPassword })).status, 200);
  assert.equal(h.expectOk(await h.api.get('manage/inbox?type=contact', admin)).items.length, 0);
});

test('admin manages customers: create, edit, reset, lock, delete only when unused', async () => {
  const { token: admin } = await h.adminToken();
  const created = h.expectOk(await h.api.post('manage/customers', { displayName: 'Khách Quầy', phone: '0911000222', password: 'Quay12345' }, admin), 201);
  assert.equal(created.phone, '0911000222');
  assert.equal(created.email, null);
  assert.equal((await h.api.post('manage/customers', { displayName: 'Trùng', phone: '0911000222', password: 'Quay12345' }, admin)).body.code, 'phone_taken');
  assert.equal((await h.api.post('manage/customers', { displayName: 'Yếu', phone: '0911000333', password: 'abc' }, admin)).body.fields[0].code, 'weak_password');
  const login = h.expectOk(await h.api.post('auth/login', { login: '0911000222', password: 'Quay12345' }));
  assert.equal(h.expectOk(await h.api.get('me/vouchers', login.tokens.accessToken)).wallet[0].promotion.code, 'CHAOBAN'); // welcome code
  const edited = h.expectOk(await h.api.patch(`manage/customers/${created.id}`, { displayName: 'Khách Quầy 2', email: 'quay@x.vn', password: 'Moi123456' }, admin));
  assert.equal(edited.displayName, 'Khách Quầy 2');
  assert.equal((await h.api.get('me', login.tokens.accessToken)).body.code, 'session_revoked');
  const locked = h.expectOk(await h.api.post(`manage/customers/${created.id}/lock`, { reason: 'Quấy rối' }, admin));
  assert.equal(locked.locked, true);
  assert.equal((await h.api.post('auth/login', { login: 'quay@x.vn', password: 'Moi123456' })).body.code, 'account_suspended');
  h.expectOk(await h.api.post(`manage/customers/${created.id}/unlock`, {}, admin));
  assert.equal((await h.api.post('auth/login', { login: 'quay@x.vn', password: 'Moi123456' })).status, 200);

  // a customer with a booking cannot be deleted, only locked
  const w = await h.world(admin);
  h.expectOk(await h.api.post('manage/bookings', { tripId: w.trip.id, pickupOfficeId: w.o1.id, dropOfficeId: w.o3.id, seats: ['D1'], customerAccountId: created.id, payMethod: 'cash' }, admin), 201);
  const blocked = await h.api.del(`manage/customers/${created.id}`, {}, admin);
  assert.equal(blocked.body.code, 'in_use');
  const other = h.expectOk(await h.api.post('manage/customers', { displayName: 'Chưa dùng', phone: '0911000444', password: 'Chua123456' }, admin), 201);
  assert.equal((await h.api.del(`manage/customers/${other.id}`, {}, admin)).status, 204);
  assert.equal((await h.api.get(`manage/customers/${other.id}`, admin)).status, 404);
});

test('admin management: temp password, last admin cannot leave', async () => {
  const { token } = await h.adminToken();
  const add = await h.api.post('admin/admins', { email: 'ops@x.vn', displayName: 'Ops' }, token);
  assert.equal(add.status, 201);
  assert.ok(add.body.temporaryPassword);
  const l2 = await h.api.post('auth/login', { email: 'ops@x.vn', password: add.body.temporaryPassword });
  assert.equal(l2.status, 200);
  assert.equal((await h.api.post(`admin/admins/${add.body.account.id}/revoke`, {}, token)).status, 204);
  assert.equal((await h.api.get('me', l2.body.tokens.accessToken)).body.code, 'session_revoked');
  const del = await h.api.del('me', { password: h.PASSWORD }, token);
  assert.equal(del.status, 409);
  assert.equal(del.body.code, 'last_admin');
});

test('sign in with email or phone number; one phone per account', async () => {
  await h.customer('an@example.com', 'An', '0901234567');
  for (const login of ['an@example.com', 'AN@example.com', '0901234567', '+84 901 234 567', '84901234567']) {
    const res = await h.api.post('auth/login', { login, password: h.PASSWORD });
    assert.equal(res.status, 200, login);
    assert.equal(res.body.account.email, 'an@example.com');
  }
  assert.equal((await h.api.post('auth/login', { email: '0901234567', password: h.PASSWORD })).status, 200); // old field name still works
  assert.equal((await h.api.post('auth/login', { login: '0901234567', password: 'sai123456' })).body.code, 'invalid_credentials');
  assert.equal((await h.api.post('auth/login', { login: '0999999999', password: h.PASSWORD })).body.code, 'invalid_credentials');
  const badFormat = await h.api.post('auth/login', { login: 'abc', password: h.PASSWORD });
  assert.equal(badFormat.status, 400);
  assert.equal(badFormat.body.fields[0].field, 'login');

  const dup = await h.api.post('auth/register', { email: 'other@example.com', password: h.PASSWORD, displayName: 'B', phone: '+84901234567', acceptTerms: true });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'phone_taken');
  const b = await h.customer('b@example.com', 'B', '0902000222');
  assert.equal((await h.api.patch('me', { phone: '0901 234 567' }, b.token)).body.code, 'phone_taken');
  assert.equal(h.expectOk(await h.api.patch('me', { phone: '0903000333' }, b.token)).account.phone, '0903000333');

  const forgot = h.expectOk(await h.api.post('auth/forgot', { login: '0903000333' }), 202);
  assert.ok(forgot.devToken);
  h.expectOk(await h.api.post('auth/reset', { token: forgot.devToken, newPassword: 'MatKhauMoi9' }), 204);
  assert.equal((await h.api.post('auth/login', { login: '0903000333', password: 'MatKhauMoi9' })).status, 200);
});
