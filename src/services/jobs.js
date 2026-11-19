/**
 * Maintenance run by the cron (`GET /v1/jobs/run`, Vercel Cron daily; safe to call more often):
 * - close bookings past their receipt deadline (156), give promo uses back
 * - keep recurring trips generated up to the window (159)
 * - delete receipt photos past their retention date (111)
 * - remind senders of parcels nobody picked up (69)
 * - remove revoked sessions older than 30 days (expired ones go by TTL)
 */
const { Session } = require('../models');

async function run() {
  const bookings = await require('./bookings').expireOverdue({ force: true });
  const series = await require('./trips').extendAllSeries();
  const files = await require('./proofs').purgeExpiredFiles();
  const unclaimed = await require('./parcels').remindUnclaimed();
  const s = await Session.deleteMany({ revokedAt: { $lt: new Date(Date.now() - 30 * 86400000) } });
  return { ok: true, expiredBookings: bookings, series, deletedFiles: files, unclaimedReminders: unclaimed, revokedSessionsRemoved: s.deletedCount || 0 };
}

module.exports = { run };
