const bcrypt = require('bcryptjs');
const User = require('../models/User');

const PLACEHOLDER_SECRETS = new Set(['', 'change-this-dev-secret', 'secret', 'changeme']);

// Loud, un-missable startup warnings for the two misconfigurations that
// would quietly hand the whole platform to a stranger: a guessable
// JWT_SECRET (every session, receipt link and email accept link is signed
// with it) and the seeded demo logins still answering to "password123"
// on a real deployment. Warn rather than refuse to boot - a dead API
// helps nobody - but in production these are treated as errors in the log.
function checkStartupSecurity() {
  const secret = process.env.JWT_SECRET || '';
  const isProd = process.env.NODE_ENV === 'production' || process.env.DB_MODE === 'mongo';
  if (PLACEHOLDER_SECRETS.has(secret.trim()) || secret.length < 24) {
    const msg = '[security] JWT_SECRET is missing, a placeholder, or shorter than 24 characters - set a long random value in the environment';
    if (isProd) console.error(msg); else console.warn(msg);
  }
}

// Only meaningful on a persistent database: memory mode reseeds the demo
// accounts on every boot by design.
checkStartupSecurity.demoAccounts = async function demoAccounts() {
  if (process.env.DB_MODE !== 'mongo') return;
  const demo = (await User.find({})).filter((u) => /@easyride\.local$/.test(u.email || '') && u.isActive !== false);
  const weak = [];
  for (const u of demo) {
    if (u.password && await bcrypt.compare('password123', u.password)) weak.push(u.email);
  }
  if (weak.length) {
    console.error(`[security] demo accounts with the default password are live on this database: ${weak.join(', ')} - change their passwords (Admin > Reset password) or remove them (npm run remove-test-accounts)`);
  }
};

module.exports = { checkStartupSecurity };
