const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const { auth, roleMiddleware } = require('../middleware/auth');

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// POST /api/payment/create-intent
// Uses real Stripe when STRIPE_SECRET_KEY is set; otherwise returns a mock
// intent so the booking flow can be tested end-to-end without a Stripe account.
router.post('/create-intent', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    const { bookingId } = req.body;
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (String(booking.passengerId) !== String(req.user.id)) return res.status(403).json({ error: 'Not your booking' });
    if (booking.paymentMethod === 'cash') return res.status(400).json({ error: 'This booking is set to pay by cash' });
    if (booking.paymentStatus === 'paid') return res.status(400).json({ error: 'This booking is already paid' });

    const amount = Math.round((booking.actualFare || booking.estimatedFare) * 100);

    if (stripe) {
      const intent = await stripe.paymentIntents.create({ amount, currency: 'nzd', metadata: { bookingId } });
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

// POST /api/payment/confirm - marks a booking paid (mock flow / webhook stand-in)
router.post('/confirm', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    const { bookingId } = req.body;
    const booking = await Booking.findByIdAndUpdate(bookingId, { paymentStatus: 'paid' });
    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
