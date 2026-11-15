const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_MODE = 'memory';
process.env.NODE_ENV = 'test';
const { receiptAmounts } = require('../utils/receiptGst');
const { buildInvoiceHtml, buildInvoiceText } = require('../services/emailService');
const { buildInvoicePdf } = require('../services/invoicePdf');
const Booking = require('../models/Booking');
const { getSettings, loadSettings, updateSettingsConfirmed } = require('../config/platformSettings');
const base = { bookingId: 'TRIP-GST', actualFare: 50, cardSurchargeAmount: 1.67,
  paymentStatus: 'paid', paymentMethod: 'card', paidVia: 'card-in-person',
  completedAt: '2026-11-12T07:55:00Z', pickupAddress: 'New Plymouth Airport',
  dropAddress: '10B Cowling Road', distanceKm: 14.66 };

test('GST is extracted from inclusive fare/card total without increasing it', () => {
  assert.deepEqual(receiptAmounts(base), { fare: 50, cardFee: 1.67, tip: 0, rate: 15, gst: 6.74, subtotal: 44.93, total: 51.67 });
  assert.equal(receiptAmounts({ actualFare: 115 }).gst, 15);
  assert.equal(receiptAmounts({ actualFare: 0.01 }).gst, 0);
  for (const amount of [0.01, 0.03, 8, 50, 51.67, 115, 999.99]) {
    const t = receiptAmounts({ actualFare: amount });
    assert.equal(Math.round((t.subtotal + t.gst) * 100), Math.round(t.total * 100));
  }
});

test('voluntary tips are excluded; cash, custom rate and zero rate work', () => {
  const withTip = receiptAmounts({ ...base, tipAmount: 5 });
  assert.equal(withTip.total, 56.67);
  assert.equal(withTip.gst, 6.74);
  assert.equal(receiptAmounts({ actualFare: 50, paymentMethod: 'cash' }).total, 50);
  assert.equal(receiptAmounts({ actualFare: 112.5, receiptGstRatePercent: 12.5 }).gst, 12.5);
  assert.equal(receiptAmounts({ ...base, receiptGstRatePercent: 0 }).gst, 0);
});

test('HTML, email text and PDF share GST totals and supplier number', async () => {
  const booking = { ...base, receiptGstNumber: '123-456-789' };
  const html = buildInvoiceHtml(booking, { name: 'Passenger' }, null, 'Driver');
  const text = buildInvoiceText(booking, { name: 'Passenger' }, null, 'Driver');
  for (const output of [html, text]) for (const value of ['44.93', '6.74', '51.67', 'GST', '123-456-789']) assert.ok(output.includes(value), value);
  assert.ok(html.includes('GST (15%, included)'));
  assert.ok(!buildInvoiceHtml({ ...booking, receiptGstNumber: '<script>bad</script>' }, null, null).includes('<script>'));
  const pdf = await buildInvoicePdf(booking, { name: 'Passenger' }, null, 'Driver');
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 1000);
});

test('rate and supplier GST number persist and do not rewrite booked tax metadata', async () => {
  await loadSettings();
  const original = getSettings();
  try {
    await updateSettingsConfirmed({ receiptGstRatePercent: 15, gstNumber: '123-456-789' });
    const booking = await Booking.create({ estimatedFare: 115 });
    assert.equal(booking.receiptGstRatePercent, 15);
    assert.equal(booking.receiptGstNumber, '123-456-789');
    await updateSettingsConfirmed({ receiptGstRatePercent: 20, gstNumber: '987-654-321' });
    assert.equal(receiptAmounts(await Booking.findById(booking._id)).rate, 15);
    const newer = await Booking.create({ estimatedFare: 120 });
    assert.equal(newer.receiptGstRatePercent, 20);
    assert.equal(newer.receiptGstNumber, '987-654-321');
    assert.equal(receiptAmounts({ estimatedFare: 115 }).rate, 15); // legacy
    for (const rate of [-1, 101, NaN, Infinity, '15']) await assert.rejects(updateSettingsConfirmed({ receiptGstRatePercent: rate }), /GST rate/);
    for (const number of ['abc', '123', null]) await assert.rejects(updateSettingsConfirmed({ gstNumber: number }), /GST number/);
  } finally {
    await updateSettingsConfirmed({ receiptGstRatePercent: original.receiptGstRatePercent, gstNumber: original.gstNumber });
  }
});
