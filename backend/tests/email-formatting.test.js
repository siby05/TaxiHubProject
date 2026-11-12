const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTripReminder, buildStandardEmail } = require('../services/emailService');
const booking = { bookingId: 'TRIP-20261112-00016', status: 'accepted',
  scheduledFor: '2026-11-12T07:55:00Z', pickupAddress: 'New Plymouth Airport',
  dropAddress: '10B Cowling Road', stops: [{ address: 'First stop' }] };

test('passenger reminder has personal greeting and separated NZ pickup details', () => {
  const result = buildTripReminder(booking, 'today', { recipientName: 'Anu', passengerName: 'Anu' });
  assert.match(result.text, /Hi Anu,/);
  assert.match(result.text, /Passenger: Anu/);
  assert.match(result.text, /Pickup date: 12 November 2026/);
  assert.match(result.text, /Pickup time: 8:55 pm — New Zealand time/);
  for (const value of ['TRIP-20261112-00016', 'New Plymouth Airport', '10B Cowling Road', 'First stop']) {
    assert.ok(result.text.includes(value));
    assert.ok(result.html.includes(value));
  }
  assert.match(result.html, /table-layout:fixed/);
});

test('driver reminder distinguishes driver greeting from passenger name', () => {
  const result = buildTripReminder(booking, 'today', { role: 'driver', recipientName: 'Sam', passengerName: 'Anu' });
  assert.match(result.subject, /pickup reminder/);
  assert.match(result.text, /Hi Sam,/);
  assert.match(result.text, /Passenger: Anu/);
  assert.match(result.text, /Thank you for driving with EasyRide/);
  assert.match(result.text, /\/driver/);
});

test('pending reminder never implies a confirmed trip and escapes names and addresses', () => {
  const result = buildTripReminder({ ...booking, status: 'pending', pickupAddress: '<script>bad</script>' }, 'tomorrow',
    { recipientName: '<img src=x>', passengerName: 'A & B' });
  assert.match(result.text, /not yet confirmed/);
  assert.ok(!result.html.includes('<script>'));
  assert.ok(!result.html.includes('<img src=x>'));
  assert.ok(result.html.includes('&lt;script&gt;'));
  assert.ok(result.html.includes('A &amp; B'));
  assert.ok(!buildTripReminder(booking, 'today').text.includes('undefined'));
});

test('other notification emails preserve paragraphs and safely link original URLs', () => {
  const html = buildStandardEmail('Booking <update>', 'Hi <Anu>,\nPickup: Airport\n\nView: https://example.com/booking?t=abc&n=1');
  assert.ok(html.includes('Booking &lt;update&gt;'));
  assert.ok(html.includes('Hi &lt;Anu&gt;,<br>Pickup: Airport'));
  assert.ok(html.includes('href="https://example.com/booking?t=abc&amp;n=1"'));
  assert.ok(!html.includes('<Anu>'));
});
