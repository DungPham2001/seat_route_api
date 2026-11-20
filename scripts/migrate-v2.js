/**
 * One-off migration to the "pay at the counter" model (docs/SeatRoute-tai-lieu-BE.md). DESTRUCTIVE, so it needs --yes:
 *   MONGODB_URI="mongodb+srv://..." node scripts/migrate-v2.js --yes
 * - drops the collections of the old receipt-photo flow (payment_proofs, files) and of the removed saved data
 * - deletes every booking, parcel, trip, route, vehicle... (the old demo data) and every customer / demo account
 * - keeps: real admin accounts (not *@seatroute.test), the province list
 * - resets settings to the new defaults, then run `npm run db:init` and `npm run seed:demo`
 */
const mongoose = require('mongoose');
const config = require('../src/config');

const DROP = ['payment_proofs', 'files', 'saved_passengers', 'saved_addresses', 'saved_receivers', 'favorites'];
const KEEP = new Set(['provinces', 'accounts']);

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('This deletes bookings, parcels, trips, routes, vehicles, customers and old settings. Re-run with --yes.');
    process.exit(1);
  }
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  console.log(`database: ${db.databaseName}`);
  const names = (await db.listCollections().toArray()).map((c) => c.name);
  for (const name of names) {
    if (name.startsWith('system.')) continue;
    if (DROP.includes(name)) {
      await db.collection(name).drop();
      console.log(`  dropped ${name}`);
    } else if (!KEEP.has(name)) {
      const r = await db.collection(name).deleteMany({});
      console.log(`  cleared ${name} (${r.deletedCount})`);
    }
  }
  const a = await db.collection('accounts').deleteMany({ $or: [{ role: 'customer' }, { email: /@seatroute\.test$/ }] });
  await db.collection('accounts').updateMany({}, { $unset: { mustChangePassword: '', refundAccount: '', emergencyContact: '', preferences: '' } });
  console.log(`  accounts: removed ${a.deletedCount}, kept ${await db.collection('accounts').countDocuments({ role: 'admin' })} admin(s)`);
  await mongoose.disconnect();
  console.log('Done. Next: npm run db:init && npm run seed:demo');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
