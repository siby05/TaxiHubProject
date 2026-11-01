const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Defensive regression checks; these do NOT replace runtime penetration testing.
test('production cannot mark a booking paid using mock Stripe', () => {
  const src = read('routes/payment.js');
  assert.match(src, /NODE_ENV === 'production'[\s\S]*?return res\.status\(503\)/);
});
test('unauthenticated returning card guest cannot receive an account token', () => {
  const src = read('routes/booking.js');
  assert.match(src, /passenger && paymentMethod === 'card'[\s\S]*?return res\.status\(403\)/);
});
test('native wallet checkout validates tip-inclusive authorized total before payment', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/StripePaymentModal.jsx'), 'utf8');
  assert.match(src, /<ExpressCheckoutElement/);
  assert.match(src, /Math\.round\(data\.total \* 100\) !== shown/);
  assert.match(src, /elements\.update\(\{ amount:/);
});
