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
test('native wallet buttons are blocked until correct tip-inclusive amounts can be authorized', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/StripePaymentModal.jsx'), 'utf8');
  assert.doesNotMatch(src, /<ExpressCheckoutElement/);
});
