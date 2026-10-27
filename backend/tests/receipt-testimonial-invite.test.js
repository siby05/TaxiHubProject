const test = require('node:test');
const assert = require('node:assert/strict');
const { receiptTestimonialInvitation } = require('../services/emailService');

test('receipt email review invitation links to the public review form', () => {
  const { text, html } = receiptTestimonialInvitation();
  assert.match(text, /How was your EasyRide trip\?/);
  assert.match(text, /\/about#feedback/);
  assert.match(html, /Leave a review/);
  assert.match(html, /href="https?:\/\/[^"]+\/about#feedback"/);
});

test('testimonial invitation does not depend on receipt contents', () => {
  const first = receiptTestimonialInvitation();
  const second = receiptTestimonialInvitation();
  assert.deepEqual(first, second);
  assert.doesNotMatch(first.html, /invoice|booking ID|total fare/i);
});
