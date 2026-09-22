const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const { auth, roleMiddleware } = require('../middleware/auth');
const { getEffectiveCommissionSettings } = require('../utils/billing');

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// POST /api/payment/create-intent
// Uses real Stripe when STRIPE_SECRET_KEY is set; otherwise returns a mock
// intent so the booking flow can be tested end-to-end without a Stripe
// account. When the trip's driver has completed Stripe Connect onboarding
// (see routes/stripeConnect.js), the charge is created as a destination
// charge straight to their connected account, with the platform's
// commission withheld as application_fee_amount - so the fare goes to the
// driver, not the platform's pooled account, automatically net of the fee.
router.post('/create-intent', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    const { bookingId } = req.body;
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (String(booking.passengerId) !== String(req.user.id)) return res.status(403).json({ error: 'Not your booking' });
    if (booking.paymentMethod === 'cash') return res.status(400).json({ error: 'This booking is set to pay by cash' });
    if (booking.paymentStatus === 'paid') return res.status(400).json({ error: 'This booking is already paid' });
    if (booking.status === 'pending') return res.status(400).json({ error: 'Wait for a driver to accept before paying' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'This booking was cancelled' });

    // The disclosed card surcharge (see routes/booking.js quote/create) is
    // part of what's actually charged - it's not just a cosmetic label.
    const fare = booking.actualFare || booking.estimatedFare;
    const amount = Math.round((fare + (booking.cardSurchargeAmount || 0)) * 100);
    const surchargeCents = Math.round((booking.cardSurchargeAmount || 0) * 100);

    if (stripe) {
      const intentOptions = { amount, currency: 'nzd', metadata: { bookingId }, automatic_payment_methods: { enabled: true } };

      const driver = await Driver.findById(booking.driverId);
      if (driver?.stripeAccountId && driver.stripeChargesEnabled) {
        const settings = getEffectiveCommissionSettings(driver);
        const feePercent = settings.commissionType === 'per-trip-percent' ? settings.commissionPercent : 0;
        // Platform keeps its usual commission off the fare, plus the whole
        // surcharge (that's what covers Stripe's own processing cost) -
        // the driver still receives exactly fare minus their commission.
        intentOptions.application_fee_amount = Math.round(fare * 100 * (feePercent / 100)) + surchargeCents;
        intentOptions.transfer_data = { destination: driver.stripeAccountId };
      }

      const intent = await stripe.paymentIntents.create(intentOptions);
      await Booking.findByIdAndUpdate(bookingId, { paymentIntentId: intent.id });
      return res.json({ clientSecret: intent.client_secret, mock: false });
    }

    const mockId = `mock_pi_${Date.now()}`;
    await Booking.findByIdAndUpdate(bookingId, { paymentIntentId: mockId, paymentStatus: 'paid' });
    res.json({ clientSecret: `${mockId}_secret`, mock: true, message: 'STRIPE_SECRET_KEY not set - payment auto-marked as paid for testing' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/confirm - the client reports that Stripe's checkout
// succeeded. Never trusted on its own: the booking must be the caller's,
// and with real Stripe the PaymentIntent created above is fetched back
// and must actually be succeeded for the full amount before anything is
// marked paid. (Without STRIPE_SECRET_KEY, create-intent already marked
// the mock payment paid, so this just confirms ownership.)
router.post('/confirm', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    const { bookingId } = req.body;
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (String(booking.passengerId) !== String(req.user.id)) return res.status(403).json({ error: 'Not your booking' });
    if (booking.paymentStatus === 'paid') return res.json(booking);

    if (stripe) {
      if (!booking.paymentIntentId) return res.status(400).json({ error: 'No payment has been started for this booking' });
      const intent = await stripe.paymentIntents.retrieve(booking.paymentIntentId);
      const fare = booking.actualFare || booking.estimatedFare;
      const expected = Math.round((fare + (booking.cardSurchargeAmount || 0)) * 100);
      if (intent.status !== 'succeeded' || intent.amount_received < expected) {
        return res.status(402).json({ error: `Payment not completed (status: ${intent.status})` });
      }
    }

    res.json(await Booking.findByIdAndUpdate(bookingId, { paymentStatus: 'paid' }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
