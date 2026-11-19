/**
 * Identity comes only from the access token. The session and the account are re-read on every request, so
 * logout, password change, device removal, suspension and admin revocation take effect immediately.
 *
 * - suspended account            -> 403 account_suspended
 * - mustChangePassword (default admin, admin with a temporary password) -> every endpoint except the few below
 *   answers 403 password_change_required, so the app can only show the change-password screen (feature 114).
 * - role check on every endpoint (customer / admin), never only hidden buttons in the app.
 */
const { Account, Session } = require('../models');
const { verifyAccess } = require('../services/tokens');
const { asyncHandler, unauthorized, forbidden } = require('../lib/errors');

const TOUCH_MS = 5 * 60 * 1000;
const ALLOWED_BEFORE_CHANGE = new Set(['/auth/change-password', '/auth/logout', '/me', '/devices']);

async function resolve(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  if (!m) throw unauthorized('unauthorized');
  const claims = verifyAccess(m[1]);
  const [session, account] = await Promise.all([
    Session.findById(claims.sid).lean(),
    Account.findById(claims.sub).lean(),
  ]);
  if (!session || session.revokedAt || session.accountId !== claims.sub || !account) throw unauthorized('session_revoked');
  if (session.absoluteExpiresAt <= new Date()) throw unauthorized('session_expired');
  if (account.status === 'suspended') throw forbidden('account_suspended');
  if (Date.now() - new Date(session.lastSeenAt).getTime() > TOUCH_MS) {
    Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return {
    accountId: account._id,
    account,
    role: account.role,
    sessionId: session._id,
    deviceName: session.name || '',
  };
}

const authenticate = asyncHandler(async (req, _res, next) => {
  req.auth = await resolve(req);
  if (req.auth.account.mustChangePassword && !ALLOWED_BEFORE_CHANGE.has(req.path)) throw forbidden('password_change_required');
  next();
});

/** Same as authenticate, but a missing token is fine (req.auth = null). */
const optionalAuth = asyncHandler(async (req, _res, next) => {
  req.auth = req.get('authorization') ? await resolve(req) : null;
  next();
});

const requireRole = (role) => (req, _res, next) => next(req.auth?.role === role ? undefined : forbidden('forbidden'));
const requireAdmin = requireRole('admin');
const requireCustomer = requireRole('customer');

module.exports = { authenticate, optionalAuth, requireAdmin, requireCustomer, requireRole };
