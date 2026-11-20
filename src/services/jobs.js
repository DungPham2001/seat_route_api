/**
 * Maintenance run by the cron (`GET /v1/jobs/run`, Vercel Cron daily; safe to call more often):
 * - keep recurring trips generated up to the window (159)
 * - remind senders of parcels nobody picked up (69)
 * - remove revoked sessions older than 30 days (expired ones go by TTL)
 */
const { Session } = require('../models');

async function run() {
  const series = await require('./trips').extendAllSeries();
  const unclaimed = await require('./parcels').remindUnclaimed();
  const s = await Session.deleteMany({ revokedAt: { $lt: new Date(Date.now() - 30 * 86400000) } });
  return { ok: true, series, unclaimedReminders: unclaimed, revokedSessionsRemoved: s.deletedCount || 0 };
}

module.exports = { run };
