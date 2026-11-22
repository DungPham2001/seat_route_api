/**
 * Creates the database, every collection and every index, the province list (when empty) and the default admin
 * account (when there is no admin yet). Safe to re-run:
 *   npm run db:init
 *   MONGODB_URI="mongodb+srv://..." DEFAULT_ADMIN_EMAIL=admin@yourdomain.vn npm run db:init
 *
 * The default admin gets a random password printed ONCE here (never in the app, the repo or the docs).
 * Change it in the app (Profile > change password); nothing forces it.
 */
const mongoose = require('mongoose');
const config = require('../src/config');
const models = require('../src/models');
const { uuid, noAccent } = require('../src/lib/util');
const password = require('../src/lib/password');
const { tempPassword } = require('../src/services/accounts');
const PROVINCES = require('./provinces');

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log(`database: ${mongoose.connection.db.databaseName}`);
  for (const name of mongoose.modelNames()) {
    const Model = mongoose.model(name);
    await Model.createCollection().catch(() => {});
    await Model.syncIndexes();
    console.log(`  ${Model.collection.name.padEnd(22)} ${(await Model.collection.indexes()).length} indexes`);
  }
  if (!(await models.Province.countDocuments())) {
    const now = new Date();
    await models.Province.insertMany(PROVINCES.map((name, i) => ({ _id: uuid(), name, nameNoAccent: noAccent(name), sortOrder: i + 1, isActive: true, search: noAccent(name), createdAt: now, updatedAt: now })));
    console.log(`provinces: ${PROVINCES.length} added`);
  }
  if (!(await models.Account.exists({ role: 'admin' }))) {
    const email = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@nhaxevietnam.local').toLowerCase();
    const plain = tempPassword();
    const now = new Date();
    const id = uuid();
    await models.Account.create({
      _id: id, operatorId: id, email, passwordHash: await password.hash(plain), displayName: 'Quản trị viên', role: 'admin', preferredLanguage: 'vi', status: 'active',
      search: noAccent(`quan tri vien ${email}`), passwordChangedAt: now, createdAt: now, updatedAt: now,
    });
    console.log('\nDefault admin created (shown only once, change it in the app):');
    console.log(`  email:    ${email}`);
    console.log(`  password: ${plain}\n`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
