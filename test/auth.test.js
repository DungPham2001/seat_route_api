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
  assert.equal(login.body.mustChangePassword, false);
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
  const r = await h.api.post('auth/reset', { token: f.body.devToken.toLowerCase(), newPassword: 'moi12345' });
  assert.equal(r.status, 204);
  assert.equal((await h.api.get('me', c.token)).body.code, 'session_revoked');
  assert.equal((await h.api.post('auth/login', { email: 'khach@example.com', password: 'moi12345' })).status, 200);
  assert.equal((await h.api.post('auth/reset', { token: f.body.devToken, newPassword: 'moi12345' })).body.code, 'reset_invalid');
});

test('default admin must change password; roles are checked on the server', async () => {
  const { models } = h;
  const password = require('../src/lib/password');
  await models.Account.create({ _id: 'adm1', email: 'root@x.vn', passwordHash: await password.hash('TamThoi123'), displayName: 'Root', role: 'admin', status: 'active', mustChangePassword: true });
  const login = await h.api.post('auth/login', { email: 'root@x.vn', password: 'TamThoi123' });
  assert.equal(login.body.mustChangePassword, true);
  const t = login.body.tokens.accessToken;
  assert.equal((await h.api.get('manage/dashboard', t)).body.code, 'password_change_required');
  assert.equal((await h.api.get('me', t)).status, 200);
  const ch = await h.api.post('auth/change-password', { oldPassword: 'TamThoi123', newPassword: 'MatKhauMoi1' }, t);
  assert.equal(ch.status, 200);
  assert.equal(ch.body.account.mustChangePassword, false);
  assert.equal((await h.api.get('manage/dashboard', t)).status, 200);

  const c = await h.customer();
  for (const [m, p] of [['get', 'manage/dashboard'], ['get', 'admin/settings'], ['post', 'manage/trips'], ['get', 'manage/vehicles'], ['post', 'proofs/x/approve'], ['get', 'admin/customers']]) {
    const res = await h.api[m](p, m === 'get' ? c.token : {}, c.token);
    assert.equal(res.status, 403, `${m} ${p}`);
  }
  assert.equal((await h.api.get('home', t)).status, 403);
  assert.equal((await h.api.get('trips?fromProvinceId=a&toProvinceId=b')).status, 401);
});

test('admin management: temp password, last admin cannot leave', async () => {
  const { token } = await h.adminToken();
  const add = await h.api.post('admin/admins', { email: 'ops@x.vn', displayName: 'Ops' }, token);
  assert.equal(add.status, 201);
  assert.ok(add.body.temporaryPassword);
  const l2 = await h.api.post('auth/login', { email: 'ops@x.vn', password: add.body.temporaryPassword });
  assert.equal(l2.body.mustChangePassword, true);
  assert.equal((await h.api.post(`admin/admins/${add.body.account.id}/revoke`, {}, token)).status, 204);
  assert.equal((await h.api.get('me', l2.body.tokens.accessToken)).body.code, 'session_revoked');
  const del = await h.api.del('me', { password: h.PASSWORD }, token);
  assert.equal(del.status, 409);
  assert.equal(del.body.code, 'last_admin');
});
