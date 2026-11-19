/**
 * Failed-attempt counters (login, password confirmation, invite codes), stored in MongoDB so they hold across
 * serverless instances. Keys are hashed: no email ends up in the database of counters.
 */
const config = require('../config');
const { RateHit } = require('../models');
const { sha256 } = require('./util');
const { tooMany } = require('./errors');

const keyOf = (scope, id) => `fail|${scope}|${sha256(String(id).toLowerCase())}`;

async function assertNotLocked(scope, id, max = config.login.maxFailures) {
  const doc = await RateHit.findById(keyOf(scope, id)).lean();
  if (doc && doc.count >= max && doc.expireAt > new Date()) {
    throw tooMany(Math.max(1, Math.ceil((doc.expireAt - Date.now()) / 1000)));
  }
}

async function recordFailure(scope, id) {
  const _id = keyOf(scope, id);
  const now = Date.now();
  const doc = await RateHit.findOneAndUpdate(
    { _id },
    { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(now + config.login.lockSec * 1000) } },
    { upsert: true, new: true },
  ).lean();
  if (doc.expireAt <= new Date(now)) {
    // stale window not yet removed by the TTL monitor: restart it
    await RateHit.updateOne({ _id }, { $set: { count: 1, expireAt: new Date(now + config.login.lockSec * 1000) } });
  }
}

const clearFailures = (scope, id) => RateHit.deleteOne({ _id: keyOf(scope, id) });

/** Generic counter in a fixed window; returns the count after increment. */
async function bump(key, windowSec) {
  const win = Math.floor(Date.now() / 1000 / windowSec);
  const doc = await RateHit.findOneAndUpdate(
    { _id: `${key}|${win}` },
    { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date((win + 2) * windowSec * 1000) } },
    { upsert: true, new: true },
  ).lean();
  return doc.count;
}

module.exports = { assertNotLocked, recordFailure, clearFailures, bump, keyOf };
