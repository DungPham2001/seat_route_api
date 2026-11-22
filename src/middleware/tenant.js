/**
 * Sets the operator (nhà xe) of the request. An admin always works inside its own operator (`account.operatorId`).
 * A customer or an anonymous call works inside the operator named by the `X-Operator-Id` header, or the default
 * operator (DEFAULT_OPERATOR_ID, else the oldest one) — the passenger-side endpoints are kept for it.
 */
const config = require('../config');
const { Account } = require('../models');
const tenant = require('../lib/tenant');
const { asyncHandler } = require('../lib/errors');

const ownerOf = (a) => a.operatorId || a._id;

let cached = { id: null, at: 0 };
async function defaultOperatorId() {
  if (config.defaultOperatorId) return config.defaultOperatorId;
  if (cached.id && Date.now() - cached.at < 10000) return cached.id;
  const first = await Account.findOne({ role: 'admin' }).sort({ createdAt: 1 }).select('_id operatorId').lean();
  cached = { id: first ? ownerOf(first) : null, at: Date.now() };
  return cached.id;
}

async function operatorFor(req) {
  const a = req.auth?.account;
  if (a?.role === 'admin') return ownerOf(a);
  const hinted = req.get('x-operator-id');
  if (hinted && (await Account.exists({ role: 'admin', $or: [{ operatorId: hinted }, { _id: hinted, operatorId: null }] }))) return hinted;
  return defaultOperatorId();
}

const scopeToOperator = asyncHandler(async (req, _res, next) => {
  const op = await operatorFor(req);
  tenant.run(op, () => next());
});

const clearCache = () => { cached = { id: null, at: 0 }; };

module.exports = { clearCache, scopeToOperator, defaultOperatorId, ownerOf };
