/**
 * One-off migration to the multi-operator model (Wayra Fleet). Run it once, BEFORE `npm run db:init`:
 *   MONGODB_URI="mongodb+srv://..." node scripts/migrate-tenant.js <owner-email> --yes
 * - the account <owner-email> becomes the owner of the existing data: every document of the operator-owned
 *   collections gets operatorId = that account's id, and the settings documents are renamed "<id>:<key>"
 * - every other admin without an operator becomes the owner of its own (empty) nhà xe
 * - customers keep working; they are not tied to an operator until they book
 * Safe to re-run (documents that already have an operatorId are left alone).
 */
const mongoose = require('mongoose');
const config = require('../src/config');

const SHARED = new Set(['accounts', 'sessions', 'password_resets', 'receipts', 'rate_hits', 'notifications', 'provinces']);
const NONE = { $in: [null, undefined] };

async function main() {
  const [email] = process.argv.slice(2);
  if (!email || !email.includes('@') || !process.argv.includes('--yes')) {
    console.error('usage: node scripts/migrate-tenant.js <owner-email> --yes');
    process.exit(1);
  }
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  const owner = await db.collection('accounts').findOne({ email: email.toLowerCase(), role: 'admin' });
  if (!owner) throw new Error(`no admin account with email ${email}`);
  console.log(`database: ${db.databaseName}\nowner of the existing data: ${owner.email} (${owner._id})`);

  for (const a of await db.collection('accounts').find({ role: 'admin', operatorId: NONE }).toArray()) {
    await db.collection('accounts').updateOne({ _id: a._id }, { $set: { operatorId: a._id } });
    console.log(`  admin ${a.email}: own nhà xe (operatorId = its id)`);
  }
  if (!owner.operatorId) await db.collection('accounts').updateOne({ _id: owner._id }, { $set: { operatorId: owner._id } });

  for (const { name } of await db.listCollections().toArray()) {
    if (name.startsWith('system.') || SHARED.has(name)) continue;
    const r = await db.collection(name).updateMany({ operatorId: NONE }, { $set: { operatorId: owner._id } });
    if (r.modifiedCount) console.log(`  ${name}: ${r.modifiedCount} documents -> operatorId`);
  }
  for (const s of await db.collection('settings').find({ _id: { $not: /:/ } }).toArray()) {
    const id = `${owner._id}:${s._id}`;
    await db.collection('settings').deleteOne({ _id: s._id });
    await db.collection('settings').replaceOne({ _id: id }, { ...s, _id: id, operatorId: owner._id }, { upsert: true });
    console.log(`  settings ${s._id} -> ${id}`);
  }
  await mongoose.disconnect();
  console.log('Done. Next: npm run db:init (rebuilds the per-operator unique indexes)');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
