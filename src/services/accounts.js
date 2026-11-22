/**
 * Accounts, sessions, password flows (features 4-8, 82, 105, 106, 112, 114, 117, 254, 256, 259, 260).
 * Same token and reset-code scheme as RoomKeep. Customers sign up themselves; admins exist only on the server
 * (scripts/create-admin.js) or are added by another admin, always with a temporary password to change.
 */
const config = require('../config');
const models = require('../models');
const tenant = require('../lib/tenant');
const { withTx } = require('../lib/tx');
const { Checker } = require('../lib/validate');
const { AppError, unauthorized, forbidden, conflict, notFound, invalid } = require('../lib/errors');
const { uuid, sha256, humanCode, normalizeCode, iso, normalizePhone, noAccent, randomToken } = require('../lib/util');
const password = require('../lib/password');
const attempts = require('../lib/attempts');
const mailer = require('../lib/mailer');
const tokens = require('./tokens');
const settings = require('./settings');

const { Account, Session, PasswordReset, Receipt, Referral } = models;
const LANGS = ['vi', 'en'];
const COLORS = ['#1E4F8A', '#2E7D32', '#AD1457', '#6A1B9A', '#EF6C00', '#00838F', '#5D4037', '#C62828'];

// ---------- presenters ----------

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();

function presentAccount(a) {
  return {
    id: a._id,
    email: a.email,
    displayName: a.displayName,
    phone: a.phone || null,
    role: a.role,
    status: a.status,
    preferredLanguage: a.preferredLanguage,
    birthDate: a.birthDate || null,
    gender: a.gender || null,
    avatarColor: a.avatarColor || COLORS[0],
    initials: initials(a.displayName),
    referralCode: a.role === 'customer' ? a.referralCode || null : null,
    createdAt: iso(a.createdAt),
  };
}

async function profile(account) {
  const out = { account: presentAccount(account) };
  if (account.role === 'customer') out.member = await require('./loyalty').summary(account._id);
  return out;
}

const loadAccount = (id) => Account.findById(id).lean();
const searchOf = (a) => noAccent([a.displayName, a.email, a.phone].filter(Boolean).join(' '));

const deviceOf = (c, body) => ({
  deviceName: c.str(body, 'deviceName', { max: 80 }) || '',
  clientDeviceId: c.str(body, 'deviceId', { max: 100 }) || null,
});

async function newReferralCode() {
  for (let i = 0; i < 6; i += 1) {
    const code = humanCode(6);
    if (!(await Account.exists({ referralCode: code }))) return code;
  }
  return humanCode(8);
}

// ---------- register / login ----------

/**
 * POST /v1/auth/register. By default it signs up a new operator (nhà xe): an `admin` account that owns its own,
 * empty set of vehicles, routes, trips and orders (`operatorId` = its own id). `accountType: "customer"` signs up
 * a passenger instead. Idempotent by `idempotencyKey` / Idempotency-Key.
 */
async function register(body, { lang, idempotencyKey: headerKey }) {
  const c = new Checker();
  const email = c.email(body, 'email') || null; // optional: a customer can sign up with just a phone number
  const plain = c.password(body, 'password');
  const displayName = c.str(body, 'displayName', { required: true, max: 60 });
  const rawPhone = c.phone(body, 'phone', { required: true });
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) c.fail('phone', 'invalid_format');
  const preferredLanguage = c.oneOf(body, 'preferredLanguage', LANGS, { def: lang });
  if (body?.acceptTerms !== true) c.fail('acceptTerms', 'terms_required');
  const accountType = c.oneOf(body, 'accountType', ['operator', 'customer'], { def: 'operator' });
  const isOperator = accountType === 'operator';
  const referralCode = isOperator ? null : c.str(body, 'referralCode', { max: 20 });
  const extra = isOperator ? { companyName: c.str(body, 'companyName', { max: 120 }), address: c.str(body, 'address', { max: 300 }), taxCode: c.str(body, 'taxCode', { max: 30 }) } : {};
  const device = deviceOf(c, body);
  const idemKey = c.str(body, 'idempotencyKey', { max: 100 }) || (typeof headerKey === 'string' ? headerKey.slice(0, 100) : null);
  c.done();

  if (idemKey) {
    const receipt = await Receipt.findById(`register|${sha256(idemKey)}`).lean();
    if (receipt) {
      const account = await loadAccount(receipt.result.accountId);
      if (!account || (account.email || null) !== email || !(await password.verify(plain, account.passwordHash))) throw conflict('phone_taken');
      return { status: 200, body: { ...(await profile(account)), tokens: await tokens.openSession(account, device) } };
    }
  }
  if (email && (await Account.exists({ email }))) throw conflict('email_taken');
  await assertPhoneFree(phone);

  let referrer = null;
  if (referralCode) {
    referrer = await Account.findOne({ referralCode: normalizeCode(referralCode), role: 'customer' }).lean();
    if (!referrer) throw invalid([{ field: 'referralCode', code: 'not_found' }]);
  }
  const passwordHash = await password.hash(plain);
  const now = new Date();
  const doc = {
    _id: uuid(), email, passwordHash, displayName, phone, role: isOperator ? 'admin' : 'customer', preferredLanguage, status: 'active',
    avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)], referralCode: isOperator ? null : await newReferralCode(),
    termsAcceptedAt: now, passwordChangedAt: now, createdAt: now, updatedAt: now,
  };
  if (isOperator) doc.operatorId = doc._id;
  doc.search = searchOf(doc);
  try {
    await withTx(async (session) => {
      await Account.create([doc], { session });
      if (referrer) {
        const rule = await settings.get('referral');
        const used = await Referral.countDocuments({ referrerAccountId: referrer._id }).session(session);
        if (rule.enabled && used < rule.maxPerReferrer) {
          await Referral.create([{ _id: uuid(), referrerAccountId: referrer._id, referredAccountId: doc._id }], { session });
        }
      }
      if (idemKey) await Receipt.create([{ _id: `register|${sha256(idemKey)}`, result: { accountId: doc._id }, expireAt: new Date(Date.now() + 86400000) }], { session });
    });
  } catch (err) {
    if (err.code === 11000) throw dupError(err);
    throw err;
  }
  if (isOperator) await tenant.run(doc._id, () => require('./provision').operator(doc, extra)).catch(() => {});
  else await require('./loyalty').welcomeVoucher(doc._id).catch(() => {}); // CHAOBAN (10%) in the new wallet
  return { status: 201, body: { ...(await profile(doc)), tokens: await tokens.openSession(doc, device) } };
}

/**
 * Sign-in identifier: email or phone number, in `login` (or the older `email` field).
 * Contains "@" -> email (case-insensitive), otherwise a Vietnamese phone number normalized to 0xxxxxxxxx.
 */
function readLogin(c, body) {
  const key = body?.login !== undefined ? 'login' : 'email';
  const raw = c.str(body, key, { required: true, max: 254 });
  if (typeof raw !== 'string') return null;
  if (raw.includes('@')) return c.email({ [key]: raw }, key);
  const phone = normalizePhone(raw);
  if (!phone) return c.fail(key, 'invalid_format');
  return phone;
}
const loginFilter = (id) => (id.includes('@') ? { email: id } : { phone: id });

/** Phone numbers are a sign-in identifier, so one number belongs to one account. */
async function assertPhoneFree(phone, exceptId) {
  if (phone && (await Account.exists({ phone, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }))) throw conflict('phone_taken');
}
const dupError = (err) => conflict(err.keyPattern?.phone || /phone/.test(err.message || '') ? 'phone_taken' : 'email_taken');

async function checkCredentials(id, plain) {
  const account = await Account.findOne(loginFilter(id)).lean();
  const lockKey = account ? account._id : `login:${id}`;
  await attempts.assertNotLocked('login', lockKey);
  if (!(await password.verify(plain, account?.passwordHash))) {
    await attempts.recordFailure('login', lockKey);
    throw unauthorized('invalid_credentials');
  }
  await attempts.clearFailures('login', lockKey);
  return account;
}

/** POST /v1/auth/login { login (email or phone), password, deviceName, deviceId } — same screen for customers and admins. */
async function login(body) {
  const c = new Checker();
  const id = readLogin(c, body);
  const plain = c.secret(body, 'password');
  const device = deviceOf(c, body);
  c.done();
  const account = await checkCredentials(id, plain);
  if (account.status === 'suspended') throw new AppError(403, 'account_suspended', { reason: account.suspendReason || null });
  Account.updateOne({ _id: account._id }, { $set: { lastLoginAt: new Date() } }).catch(() => {});
  const t = await tokens.openSession(account, device);
  return { ...(await profile(account)), tokens: t };
}

async function refresh(body) {
  const c = new Checker();
  const rt = c.str(body, 'refreshToken', { required: true, max: 200, trim: false });
  c.done();
  return {
    tokens: await tokens.refresh(rt, async (id) => {
      const a = await loadAccount(id);
      return a && a.status !== 'suspended' ? a : null;
    }),
  };
}

async function logout(body, auth) {
  const rt = typeof body?.refreshToken === 'string' ? body.refreshToken : '';
  if (rt.includes('.')) {
    const [sid] = rt.split('.');
    await Session.updateOne({ _id: sid, refreshHash: sha256(rt), revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: 'logout' } });
  }
  if (auth?.sessionId) await tokens.revoke({ _id: auth.sessionId }, 'logout');
}

// ---------- password ----------

/**
 * POST /v1/auth/forgot { login (email or phone) } — always 202 (does not reveal whether the account exists).
 * An account with an email gets the reset code by email; an account with only a phone number creates a message in the
 * admin's contact inbox ("call back to verify, then give a temporary password").
 */
async function forgot(body, { lang }) {
  const c = new Checker();
  const id = readLogin(c, body);
  c.done();
  const out = { status: 'accepted' };
  const n = await attempts.bump(`forgot|${sha256(id)}`, 3600);
  if (n > 3) return out;
  const account = await Account.findOne(loginFilter(id)).lean();
  if (!account) return out;
  if (!account.email) {
    await tenant.run(account.operatorId || (await require('../middleware/tenant').defaultOperatorId()), () => models.ContactMessage.create({ _id: uuid(), accountId: account._id, subject: 'password_reset', text: `Yêu cầu cấp lại mật khẩu cho SĐT ${account.phone}. Hãy gọi lại để xác minh và cấp mật khẩu tạm.`, status: 'open', createdAt: new Date() }));
    return out;
  }
  const code = humanCode(8);
  await PasswordReset.updateMany({ accountId: account._id, usedAt: null }, { $set: { usedAt: new Date() } });
  await PasswordReset.create({ _id: uuid(), accountId: account._id, codeHash: sha256(code), expiresAt: new Date(Date.now() + config.resetCodeSec * 1000) });
  const sent = await mailer.sendResetCode(account.email, code, lang || account.preferredLanguage, account.displayName);
  if (!sent && !mailer.enabled() && config.env !== 'production') out.devToken = mailer.pretty(code);
  return out;
}

/** POST /v1/auth/reset { token, newPassword } — signs out every device. */
async function reset(body, { lang } = {}) {
  const c = new Checker();
  const code = c.str(body, 'token', { required: true, max: 20 });
  const plain = c.password(body, 'newPassword');
  c.done();
  const now = new Date();
  const r = await PasswordReset.findOneAndUpdate(
    { codeHash: sha256(normalizeCode(code)), usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: true },
  ).lean();
  if (!r) throw new AppError(400, 'reset_invalid');
  const passwordHash = await password.hash(plain);
  const account = await Account.findOneAndUpdate(
    { _id: r.accountId },
    { $set: { passwordHash, passwordChangedAt: now } },
    { new: true },
  ).lean();
  await tokens.revoke({ accountId: r.accountId }, 'password_reset');
  if (account) {
    await Promise.all([attempts.clearFailures('login', account._id), attempts.clearFailures('confirm', account._id)]);
    await mailer.sendPasswordChanged(account, { via: 'reset', lang });
  }
}

async function confirmPassword(account, plain, field = 'password') {
  await attempts.assertNotLocked('confirm', account._id);
  if (!(await password.verify(plain, account.passwordHash))) {
    await attempts.recordFailure('confirm', account._id);
    throw new AppError(403, 'wrong_password', { fields: [{ field, code: 'wrong_password' }] });
  }
  await attempts.clearFailures('confirm', account._id);
}

/** POST /v1/auth/change-password — other devices are signed out. */
async function changePassword(auth, body, { lang } = {}) {
  const c = new Checker();
  const oldPassword = c.secret(body, 'oldPassword');
  const plain = c.password(body, 'newPassword');
  c.done();
  await confirmPassword(auth.account, oldPassword, 'oldPassword');
  if (oldPassword === plain) throw invalid([{ field: 'newPassword', code: 'same_as_old' }]);
  const now = new Date();
  await Account.updateOne({ _id: auth.accountId }, { $set: { passwordHash: await password.hash(plain), passwordChangedAt: now } });
  const r = await tokens.revoke({ accountId: auth.accountId, _id: { $ne: auth.sessionId } }, 'password_changed');
  await mailer.sendPasswordChanged(auth.account, { via: 'change', deviceName: auth.deviceName, lang });
  return { status: 'ok', revokedSessions: r.modifiedCount || 0, account: presentAccount(await loadAccount(auth.accountId)) };
}

// ---------- me ----------

/** PATCH /v1/me — displayName, phone, birthDate, gender, avatarColor, preferredLanguage, email (needs password). */
async function updateMe(auth, body) {
  const c = new Checker();
  const set = {};
  const displayName = c.str(body, 'displayName', { max: 60 });
  if (body?.displayName !== undefined && !displayName) c.fail('displayName', 'required');
  if (displayName) set.displayName = displayName;
  if (body?.phone !== undefined) {
    const raw = c.phone(body, 'phone');
    const phone = raw ? normalizePhone(raw) : null;
    if (raw && !phone) c.fail('phone', 'invalid_format');
    if (!raw && auth.role === 'customer') c.fail('phone', 'required');
    set.phone = phone;
  }
  if (body?.birthDate !== undefined) set.birthDate = c.date(body, 'birthDate') || null;
  if (body?.gender !== undefined) set.gender = c.oneOf(body, 'gender', ['male', 'female', 'other']) || null;
  if (body?.avatarColor !== undefined) set.avatarColor = c.str(body, 'avatarColor', { pattern: /^#[0-9A-Fa-f]{6}$/, max: 7 }) || null;
  const lang = c.oneOf(body, 'preferredLanguage', LANGS);
  if (lang) set.preferredLanguage = lang;
  const email = c.email(body, 'email');
  c.done();
  if (email && email !== auth.account.email) {
    if (typeof body.password !== 'string' || !body.password) throw invalid([{ field: 'password', code: 'required' }]);
    await confirmPassword(auth.account, body.password);
    if (await Account.exists({ email, _id: { $ne: auth.accountId } })) throw conflict('email_taken');
    set.email = email;
  }
  if (set.phone && set.phone !== auth.account.phone) await assertPhoneFree(set.phone, auth.accountId);
  const merged = { ...auth.account, ...set };
  set.search = searchOf(merged);
  try {
    await Account.updateOne({ _id: auth.accountId }, { $set: { ...set, updatedAt: new Date() } });
  } catch (err) {
    if (err.code === 11000) throw dupError(err);
    throw err;
  }
  return profile(await loadAccount(auth.accountId));
}

// ---------- deletion (112, 260) ----------

async function deleteAccount(account, plain) {
  await confirmPassword(account, plain);
  if (account.role === 'admin') {
    const op = account.operatorId || account._id;
    const others = await Account.countDocuments({ role: 'admin', operatorId: op, _id: { $ne: account._id } });
    await Session.deleteMany({ accountId: account._id });
    await PasswordReset.deleteMany({ accountId: account._id });
    await Account.deleteOne({ _id: account._id });
    if (!others) await require('./privacy').purgeOperator(op); // the owner leaves: the whole nhà xe goes with the account
    return;
  }
  await require('./privacy').purgeCustomer(account);
}

async function deleteByCredentials(body) {
  const c = new Checker();
  const id = readLogin(c, body);
  const plain = c.secret(body, 'password');
  c.done();
  const account = await checkCredentials(id, plain);
  await deleteAccount(account, plain);
}

// ---------- devices ----------

async function listDevices(auth) {
  const rows = await Session.find({ accountId: auth.accountId, revokedAt: null, absoluteExpiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).lean();
  return {
    devices: rows.map((s) => ({ id: s._id, name: s.name || '', createdAt: iso(s.createdAt), lastSeenAt: iso(s.lastSeenAt), expiresAt: iso(s.absoluteExpiresAt), isCurrent: s._id === auth.sessionId })),
  };
}

async function removeDevice(auth, id) {
  const r = await tokens.revoke({ _id: id, accountId: auth.accountId }, 'removed');
  if (!r.matchedCount) throw notFound();
}

// ---------- admins (256) ----------

const tempPassword = () => `Tp${randomToken(9).replace(/[-_]/g, 'x')}7a`; // always upper + lower + digit

const myOperator = (auth) => auth.account.operatorId || auth.accountId;

async function listAdmins(auth) {
  const rows = await Account.find({ role: 'admin', $or: [{ operatorId: myOperator(auth) }, { _id: myOperator(auth) }] }).sort({ createdAt: 1 }).lean();
  return { items: rows.map((a) => ({ ...presentAccount(a), lastLoginAt: iso(a.lastLoginAt) })) };
}

async function createAdmin(auth, body) {
  const c = new Checker();
  const email = c.email(body, 'email', { required: true });
  const displayName = c.str(body, 'displayName', { required: true, max: 60 });
  const raw = c.phone(body, 'phone');
  const adminPhone = raw ? normalizePhone(raw) : null;
  if (raw && !adminPhone) c.fail('phone', 'invalid_format');
  c.done();
  if (await Account.exists({ email })) throw conflict('email_taken');
  await assertPhoneFree(adminPhone);
  const plain = tempPassword();
  const now = new Date();
  const doc = {
    _id: uuid(), email, passwordHash: await password.hash(plain), displayName, phone: adminPhone, role: 'admin', operatorId: myOperator(auth),
    preferredLanguage: 'vi', status: 'active', passwordChangedAt: now, createdAt: now, updatedAt: now,
  };
  doc.search = searchOf(doc);
  await Account.create(doc);
  await require('./audit').log(auth, 'account', doc._id, 'admin_added', email);
  return { account: presentAccount(doc), temporaryPassword: plain };
}

async function revokeAdmin(auth, id) {
  const target = await Account.findOne({ _id: id, role: 'admin', operatorId: myOperator(auth) }).lean();
  if (!target) throw notFound();
  if (target._id === auth.accountId) throw forbidden('forbidden');
  const others = await Account.countDocuments({ role: 'admin', operatorId: myOperator(auth), _id: { $ne: target._id }, status: 'active' });
  if (!others) throw conflict('last_admin');
  await Session.deleteMany({ accountId: target._id });
  await Account.deleteOne({ _id: target._id });
  await require('./audit').log(auth, 'account', target._id, 'admin_revoked', target.email);
}

async function resetAdminPassword(auth, id) {
  const target = await Account.findOne({ _id: id, role: 'admin', operatorId: myOperator(auth) }).lean();
  if (!target) throw notFound();
  const plain = tempPassword();
  await Account.updateOne({ _id: id }, { $set: { passwordHash: await password.hash(plain), passwordChangedAt: new Date(), updatedAt: new Date() } });
  await tokens.revoke({ accountId: id }, 'password_reset');
  await require('./audit').log(auth, 'account', id, 'admin_password_reset', target.email);
  return { temporaryPassword: plain };
}

module.exports = {
  presentAccount, profile, register, login, refresh, logout, forgot, reset, changePassword, confirmPassword, updateMe,
  deleteAccount, deleteByCredentials, listDevices, removeDevice,
  listAdmins, createAdmin, revokeAdmin, resetAdminPassword, tempPassword, searchOf, newReferralCode, COLORS, assertPhoneFree, dupError,
};
