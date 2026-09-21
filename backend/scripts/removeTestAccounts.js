/**
 * One-off maintenance script: removes the demo/test accounts seeded by
 * utils/seed.js (the ones that used to be listed on the login screen) from
 * a real database.
 *
 * Deletes the User docs for the test drivers/passengers (and their Driver
 * profiles). The seed admin (admin@easyride.local) is left alone unless you
 * pass --include-admin - and even then, the script refuses if it would
 * leave zero admin accounts behind, so you can never lock yourself out.
 *
 * Usage:
 *   node scripts/removeTestAccounts.js --yes                 (drivers + passengers only)
 *   node scripts/removeTestAccounts.js --yes --include-admin (also admin@easyride.local)
 *
 * Point MONGO_URI/DB_MODE at whichever database you actually want cleaned,
 * same as scripts/resetTestData.js.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const User = require('../models/User');
const Driver = require('../models/Driver');

const TEST_DRIVER_EMAILS = [
  'driver@easyride.local',
  'driver-economy@easyride.local',
  'driver-electric@easyride.local',
  'driver-premium@easyride.local',
];
const TEST_PASSENGER_EMAILS = [
  'passenger@easyride.local',
  'passenger2@easyride.local',
  'passenger3@easyride.local',
  'passenger4@easyride.local',
];
const TEST_ADMIN_EMAIL = 'admin@easyride.local';

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('Refusing to run without --yes (this permanently deletes accounts). Re-run as: node scripts/removeTestAccounts.js --yes [--include-admin]');
    process.exit(1);
  }
  const includeAdmin = process.argv.includes('--include-admin');

  await connectDatabase();
  const mode = process.env.DB_MODE || 'memory';
  console.log(`[remove] DB_MODE=${mode}${mode === 'mongo' ? ` (database "${mongoose.connection.name}")` : ' - nothing persists here, this is a no-op'}`);

  const emails = [...TEST_DRIVER_EMAILS, ...TEST_PASSENGER_EMAILS];
  if (includeAdmin) {
    const remainingAdmins = await User.find({ role: 'admin' });
    const otherAdmins = remainingAdmins.filter((u) => u.email !== TEST_ADMIN_EMAIL);
    if (otherAdmins.length === 0) {
      console.error(`[remove] refusing to delete ${TEST_ADMIN_EMAIL} - it's the only admin account and deleting it would lock you out. Create another admin login first (or change this account's email/password via account settings instead of deleting it).`);
      process.exit(1);
    }
    emails.push(TEST_ADMIN_EMAIL);
  }

  const users = await User.find({ email: { $in: emails } });
  const driverUserIds = users.filter((u) => u.role === 'driver').map((u) => u._id);

  let driversDeleted = 0;
  for (const id of driverUserIds) {
    const result = await Driver.deleteMany({ userId: id });
    driversDeleted += result.deletedCount;
  }

  const usersResult = await User.deleteMany({ email: { $in: emails } });

  console.log(`[remove] deleted ${usersResult.deletedCount} user account(s) and ${driversDeleted} driver profile(s):`);
  for (const u of users) console.log(`  ${u.role.padEnd(10)} ${u.email}`);
  if (!includeAdmin) console.log(`[remove] left ${TEST_ADMIN_EMAIL} untouched (pass --include-admin to remove it too, once you have another admin login).`);

  if (mode === 'mongo') await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[remove] failed:', err);
  process.exit(1);
});
