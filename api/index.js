/**
 * Vercel entry point: every request is rewritten here (see vercel.json).
 * The MongoDB connection is cached across invocations so warm functions reuse it.
 */
const mongoose = require('mongoose');
const config = require('../src/config');
const app = require('../src/app');

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false); // indexes are created once with `npm run db:init`, not on every cold start
mongoose.set('bufferCommands', false);

let connecting = null;

async function connect() {
  if (mongoose.connection.readyState === 1) return;
  if (!connecting) {
    connecting = mongoose
      // family 4: skip IPv6 attempts, a known cause of multi-second connects on serverless hosts
      .connect(config.mongoUri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000, family: 4 })
      .catch((err) => {
        connecting = null; // allow the next request to retry
        throw err;
      });
  }
  await connecting;
}

module.exports = async (req, res) => {
  const t0 = process.hrtime.bigint();
  const ms = (from) => Number(process.hrtime.bigint() - from) / 1e6;
  const cold = mongoose.connection.readyState !== 1;
  try {
    await connect();
  } catch (err) {
    console.error('database connection failed', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Retry-After', '30');
    return res.end(JSON.stringify({ code: 'service_unavailable', message: 'Máy chủ đang bận, vui lòng thử lại sau ít phút' }));
  }
  // Server-Timing: how long the DB connect took (cold = new connection) and the whole request, for diagnosing slow calls.
  const dbMs = ms(t0).toFixed(1);
  const writeHead = res.writeHead;
  res.writeHead = function patched(...args) {
    if (!res.headersSent) res.setHeader('Server-Timing', `db;dur=${dbMs};desc="${cold ? 'connect' : 'reuse'}", total;dur=${ms(t0).toFixed(1)}`);
    return writeHead.apply(this, args);
  };
  return app(req, res);
};
