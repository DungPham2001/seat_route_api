/**
 * Sessions and tokens (features 8, 117), same scheme as RoomKeep:
 * - access token: JWT HS256, ~2h, claims sub (account), role, sid (session). Never trusted alone:
 *   every request re-reads the session and the account (current role / status).
 * - refresh token: "<sessionId>.<random>", only its sha256 is stored. Sliding idle expiry, absolute session cap (12h).
 * - rotation: every refresh returns a new pair; presenting the previous refresh token again revokes the session.
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { Session } = require('../models');
const { uuid, sha256, randomToken, iso } = require('../lib/util');
const { unauthorized } = require('../lib/errors');

const S = config.session;

function signAccess(account, session) {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.min(now + S.accessTtlSec, Math.floor(session.absoluteExpiresAt.getTime() / 1000));
  const token = jwt.sign(
    { sub: account._id, role: account.role, sid: session._id, iat: now, exp },
    config.jwt.secret,
    { algorithm: 'HS256', issuer: config.jwt.issuer, audience: config.jwt.audience },
  );
  return { token, expiresAt: new Date(exp * 1000) };
}

function bundle(account, session, refreshToken) {
  const access = signAccess(account, session);
  return {
    tokenType: 'Bearer',
    accessToken: access.token,
    accessTokenExpiresAt: iso(access.expiresAt),
    expiresIn: Math.max(0, Math.round((access.expiresAt - Date.now()) / 1000)),
    refreshToken,
    refreshTokenExpiresAt: iso(session.refreshExpiresAt),
    sessionExpiresAt: iso(session.absoluteExpiresAt),
    deviceId: session._id,
  };
}

const newRefresh = (sessionId) => `${sessionId}.${randomToken(32)}`;
const idleUntil = (absolute) => new Date(Math.min(Date.now() + S.refreshIdleSec * 1000, absolute.getTime()));

/** Creates a session for a fresh login/sign-up. One session per (account, clientDeviceId); oldest beyond the cap are revoked. */
async function openSession(account, { deviceName, clientDeviceId } = {}) {
  const now = new Date();
  if (clientDeviceId) {
    await Session.updateMany(
      { accountId: account._id, clientDeviceId, revokedAt: null },
      { $set: { revokedAt: now, revokeReason: 'replaced' } },
    );
  }
  const _id = uuid();
  const refreshToken = newRefresh(_id);
  const absoluteExpiresAt = new Date(now.getTime() + S.maxAgeSec * 1000);
  const session = await Session.create({
    _id,
    accountId: account._id,
    name: deviceName || '',
    clientDeviceId: clientDeviceId || null,
    refreshHash: sha256(refreshToken),
    refreshExpiresAt: idleUntil(absoluteExpiresAt),
    absoluteExpiresAt,
    createdAt: now,
    lastSeenAt: now,
    expireAt: new Date(absoluteExpiresAt.getTime() + 7 * 86400000),
  });

  const active = await Session.find({ accountId: account._id, revokedAt: null, absoluteExpiresAt: { $gt: now } })
    .sort({ lastSeenAt: -1 }).select('_id').lean();
  const extra = active.slice(S.maxPerAccount).map((s) => s._id);
  if (extra.length) await Session.updateMany({ _id: { $in: extra } }, { $set: { revokedAt: now, revokeReason: 'too_many_sessions' } });

  return bundle(account, session.toObject(), refreshToken);
}

/** Exchanges a refresh token for a new pair (rotation + reuse detection). */
async function refresh(refreshToken, loadAccount) {
  const raw = typeof refreshToken === 'string' ? refreshToken : '';
  const sessionId = raw.split('.')[0];
  if (!sessionId || !raw.includes('.')) throw unauthorized('refresh_invalid');
  const hash = sha256(raw);
  const now = new Date();

  const session = await Session.findById(sessionId).lean();
  if (!session || session.revokedAt) throw unauthorized(session?.revokeReason === 'refresh_reused' ? 'refresh_reused' : 'refresh_invalid');

  if (session.prevRefreshHash && hash === session.prevRefreshHash) {
    await Session.updateOne({ _id: sessionId }, { $set: { revokedAt: now, revokeReason: 'refresh_reused' } });
    throw unauthorized('refresh_reused');
  }
  if (hash !== session.refreshHash) throw unauthorized('refresh_invalid');
  if (session.absoluteExpiresAt <= now || session.refreshExpiresAt <= now) {
    await Session.updateOne({ _id: sessionId }, { $set: { revokedAt: now, revokeReason: 'expired' } });
    throw unauthorized('session_expired');
  }

  const account = await loadAccount(session.accountId);
  if (!account) throw unauthorized('refresh_invalid');

  const next = newRefresh(sessionId);
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, refreshHash: hash, revokedAt: null },
    { $set: { refreshHash: sha256(next), prevRefreshHash: hash, refreshExpiresAt: idleUntil(session.absoluteExpiresAt), lastSeenAt: now } },
    { new: true },
  ).lean();
  if (!updated) {
    // Lost a race with another refresh using the same token: that is a reuse.
    await Session.updateOne({ _id: sessionId }, { $set: { revokedAt: now, revokeReason: 'refresh_reused' } });
    throw unauthorized('refresh_reused');
  }
  return bundle(account, updated, next);
}

function verifyAccess(token) {
  try {
    return jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'], issuer: config.jwt.issuer, audience: config.jwt.audience });
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'token_expired' : 'token_invalid');
  }
}

/** Revokes sessions matching `filter` (logout, password change, device removal, account deletion). */
const revoke = (filter, reason) => Session.updateMany({ ...filter, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });

module.exports = { openSession, refresh, verifyAccess, revoke };
