/** What admins did with reports, complaints, accounts, guests (feature 239). Not a system log. */
const { AdminAction } = require('../models');
const { uuid, iso } = require('../lib/util');
const { paging, page } = require('../resources/engine');

async function log(auth, targetType, targetId, action, note = '') {
  await AdminAction.create({ _id: uuid(), adminAccountId: auth?.accountId || null, targetType, targetId, action, note: String(note || '').slice(0, 1000), at: new Date() });
}

async function list(query) {
  const filter = {};
  for (const k of ['targetType', 'targetId', 'action', 'adminAccountId']) if (query[k]) filter[k] = String(query[k]);
  const p = paging(query, 50);
  const [rows, total] = await Promise.all([
    AdminAction.find(filter).sort({ at: -1 }).skip(p.skip).limit(p.limit + 1).lean(),
    AdminAction.countDocuments(filter),
  ]);
  const { Account } = require('../models');
  const admins = new Map((await Account.find({ _id: { $in: [...new Set(rows.map((r) => r.adminAccountId))] } }).select('displayName').lean()).map((a) => [a._id, a.displayName]));
  return page(rows.map((r) => ({ id: r._id, adminAccountId: r.adminAccountId, adminName: admins.get(r.adminAccountId) || null, targetType: r.targetType, targetId: r.targetId, action: r.action, note: r.note, at: iso(r.at) })), p, total);
}

module.exports = { log, list };
