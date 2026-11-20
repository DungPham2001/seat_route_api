/**
 * Adds an admin from the server (e.g. when every admin lost access):
 *   npm run admin:create -- admin2@yourdomain.vn "Tên quản trị"
 * Prints a random temporary password once; the account must change it at the first sign-in.
 */
const mongoose = require('mongoose');
const config = require('../src/config');
const models = require('../src/models');
const { uuid, noAccent } = require('../src/lib/util');
const password = require('../src/lib/password');
const { tempPassword } = require('../src/services/accounts');

async function main() {
  const [email, name = 'Quản trị viên'] = process.argv.slice(2);
  if (!email || !email.includes('@')) throw new Error('usage: npm run admin:create -- <email> [name]');
  await mongoose.connect(config.mongoUri);
  const plain = tempPassword();
  const existing = await models.Account.findOne({ email: email.toLowerCase() }).lean();
  if (existing && existing.role !== 'admin') throw new Error('this email belongs to a customer account');
  const now = new Date();
  if (existing) {
    await models.Account.updateOne({ _id: existing._id }, { $set: { passwordHash: await password.hash(plain), status: 'active', updatedAt: now } });
    await models.Session.updateMany({ accountId: existing._id, revokedAt: null }, { $set: { revokedAt: now, revokeReason: 'password_reset' } });
  } else {
    await models.Account.create({ _id: uuid(), email: email.toLowerCase(), passwordHash: await password.hash(plain), displayName: name, role: 'admin', preferredLanguage: 'vi', status: 'active', search: noAccent(`${name} ${email}`), passwordChangedAt: now, createdAt: now, updatedAt: now });
  }
  console.log(`${existing ? 'Password reset' : 'Admin created'}: ${email.toLowerCase()}\ntemporary password: ${plain}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
