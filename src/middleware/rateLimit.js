/**
 * Per-IP limits counted in MongoDB (works across serverless instances): reads/min, writes/min, and a stricter
 * bucket for unauthenticated auth endpoints (login, register, forgot, reset, refresh, web deletion).
 * Many violations in a day -> the IP is blocked for a few minutes. Fail-open if the counter store is down.
 */
const config = require('../config');
const { RateHit } = require('../models');
const { AppError } = require('../lib/errors');

const MIN = 60;
const DAY = 86400;
const AUTH_PATHS = new Set(['/auth/login', '/auth/register', '/auth/forgot', '/auth/reset', '/auth/refresh', '/account-deletion', '/account/delete']);

async function hit(ip, bucket, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const win = Math.floor(now / windowSec);
  const doc = await RateHit.findOneAndUpdate(
    { _id: `ip|${ip}|${bucket}|${win}` },
    { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date((win + 2) * windowSec * 1000) } },
    { upsert: true, new: true },
  ).lean();
  return { count: doc.count, retryAfter: (win + 1) * windowSec - now };
}

function limiter(req, res, next) {
  const r = config.rate;
  if (!r.enabled) return next();
  const ip = req.ip || 'unknown';
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  (async () => {
    const ban = await RateHit.findById(`ip|${ip}|ban`).lean();
    if (ban && ban.expireAt > new Date()) return { retryAfter: Math.ceil((ban.expireAt - Date.now()) / 1000) };
    const checks = [[write ? 'w' : 'r', MIN, write ? r.writePerMin : r.readPerMin]];
    if (AUTH_PATHS.has(req.path) && write) checks.push(['a', MIN, r.authPerMin]);
    for (const [bucket, win, max] of checks) {
      const h = await hit(ip, bucket, win);
      if (h.count > max) {
        const v = await hit(ip, 'v', DAY);
        if (v.count >= r.banAfterViolations) {
          await RateHit.updateOne({ _id: `ip|${ip}|ban` }, { $set: { count: v.count, expireAt: new Date(Date.now() + r.banMinutes * 60000) } }, { upsert: true });
        }
        return { retryAfter: h.retryAfter };
      }
    }
    return null;
  })().then((over) => {
    if (!over) return next();
    const retryAfter = Math.max(1, over.retryAfter);
    res.set('Retry-After', String(retryAfter));
    return next(new AppError(429, 'rate_limited', { retryAfter }));
  }, () => next());
}

module.exports = { limiter };
