const mongoose = require('mongoose');

const noTransactions = (err) => err?.code === 20 || /replica set|Transaction numbers are only allowed/i.test(err?.message || '');

/**
 * Runs `fn(session)` in one MongoDB transaction (the callback may be retried on transient errors, so keep it
 * free of side effects outside the DB). On a standalone mongod without transactions it falls back to `fn(null)`.
 */
async function withTx(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    try {
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } catch (err) {
      if (noTransactions(err)) return await fn(null);
      throw err;
    }
  } finally {
    await session.endSession();
  }
}

module.exports = { withTx };
