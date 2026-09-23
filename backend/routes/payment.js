const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const { auth, roleMiddleware } = require('../middleware/auth');
const { getEffectiveCommissionSettings } = require('../utils/billing');
const { calculateCardSurcharge, cardRegion } = require('../utils/stripeFees');

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const CURRENCY = 'nzd';
const toCents = (dollars) => Math.round(dollars * 100);
const fareOf = (booking) => booking.actualFare || booking.estimatedFare;

// Every payment step starts with the same checks: the booking exists, is
// the caller's, is a card trip, and is in a state that can be paid.
async function loadPayableBooking(req, res) {
  const booking = await Booking.findById(req.body.bookingId);
  if (!booking) { res.status(404).json({ error: 'Booking not found' }); return null; }
  if (String(booking.passengerId) !== String(req.user.id)) { res.status(403).json({ error: 'Not your booking' }); return null; }
  if (booking.paymentMethod === 'cash') { res.status(400).json({ error: 'This booking is set to pay by cash' }); return null; }
  if (booking.paymentStatus === 'paid') { res.status(400).json({ error: 'This booking is already paid' }); return null; }
  if (booking.status === 'pending') { res.status(400).json({ error: 'Wait for a driver to accept before paying' }); return null; }
  if (booking.status === 'cancelled') { res.status(400).json({ error: 'This booking was cancelled' }); return null; }
  return booking;
}

// The card surcharge is Stripe's own fee for *this* card (see
// utils/stripeFees.js), so it's worked out from the PaymentMethod the
// passenger just entered - never from anything the client sends.
async function feeForCard(booking, paymentMethodId) {
  if (!paymentMethodId) throw Object.assign(new Error('paymentMethodId is required'), { status: 400 });
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (pm.type !== 'card') throw Object.assign(new Error('Only card payments are supported'), { status: 400 });
  const fare = fareOf(booking);
  const cardSurchargeAmount = calculateCardSurcharge(fare, pm.card.country);
  return {
    fare,
    cardSurchargeAmount,
    total: Math.round((fare + cardSurchargeAmount) * 100) / 100,
    cardRegion: cardRegion(pm.card.country),
    brand: pm.card.brand,
    last4: pm.card.last4,
  };
}

// What Stripe actually took for this payment, from the charge's balance
// transaction - saved so the surcharge can be checked against reality.
// Application fees (the platform's own cut on Connect charges) aren't
// Stripe's fee, so they're excluded. Best-effort: never blocks payment.
async function recordStripeFee(bookingId, intentId) {
  try {
    const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge.balance_transaction'] });
    const txn = intent.latest_charge?.balance_transaction;
    if (!txn || typeof txn !== 'object') return;
    const feeCents = txn.fee_details
      .filter((f) => f.type !== 'application_fee')
      .reduce((sum, f) => sum + f.amount, 0);
    await Booking.findByIdAndUpdate(bookingId, { stripeFeeActual: feeCents / 100 });
  } catch (err) {
    console.error(`Could not record Stripe fee for booking ${bookingId}:`, err.message);
  }
}

// POST /api/payment/start
// Without STRIPE_SECRET_KEY the payment is mocked (auto-marked paid) so
// the booking flow can be tested end-to-end without a Stripe account.
// With real Stripe nothing is charged yet: the frontend collects the card
// first, then calls /card-fee to show the exact surcharge, then /pay.
router.post('/start', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    const booking = await loadPayableBooking(req, res);
    if (!booking) return;

    if (stripe) {
      return res.json({ mock: false, amount: toCents(fareOf(booking)), currency: CURRENCY });
    }

    const mockId = `mock_pi_${Date.now()}`;
    await Booking.findByIdAndUpdate(booking._id, { paymentIntentId: mockId, paymentStatus: 'paid' });
    res.json({ mock: true, message: 'STRIPE_SECRET_KEY not set - payment auto-marked as paid for testing' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/card-fee { bookingId, paymentMethodId }
// Exact Stripe fee for the card just entered, shown to the passenger
// before they confirm.
router.post('/card-fee', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    if (!stripe) return res.status(400).json({ error: 'Online payments are not configured' });
    const booking = await loadPayableBooking(req, res);
    if (!booking) return;
    res.json(await feeForCard(booking, req.body.paymentMethodId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/payment/pay { bookingId, paymentMethodId }
// Recomputes the surcharge for this card, stores it on the booking (so
// emails/invoices show what was really charged), then creates and
// confirms the PaymentIntent server-side. If the card needs 3D Secure the
// client finishes it with stripe.handleNextAction(clientSecret) and then
// calls /confirm. When the trip's driver has completed Stripe Connect
// onboarding (see routes/stripeConnect.js) it's a destination charge
// straight to their account, with the platform's commission plus the
// whole surcharge withheld as application_fee_amount - the platform pays
// Stripe's fee on destination charges, so the surcharge covers exactly
// that, and the driver still gets fare minus their commission.
router.post('/pay', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    if (!stripe) return res.status(400).json({ error: 'Online payments are not configured' });
    const booking = await loadPayableBooking(req, res);
    if (!booking) return;

    // A previous attempt that's already gone through (or is still going
    // through) must not be charged twice; one that stalled (e.g. 3D Secure
    // abandoned) is cancelled so it can't complete later on the old card.
    if (booking.paymentIntentId?.startsWith('pi_')) {
      const previous = await stripe.paymentIntents.retrieve(booking.paymentIntentId);
      if (previous.status === 'succeeded' || previous.status === 'processing') {
        return res.status(409).json({ error: 'A payment for this trip is already in progress or complete - refresh the page' });
      }
      if (previous.status !== 'canceled') await stripe.paymentIntents.cancel(previous.id).catch(() => {});
    }

    const { fare, cardSurchargeAmount, total } = await feeForCard(booking, req.body.paymentMethodId);
    await Booking.findByIdAndUpdate(booking._id, { cardSurchargeAmount });

    const intentOptions = {
      amount: toCents(total),
      currency: CURRENCY,
      payment_method: req.body.paymentMethodId,
      payment_method_types: ['card'],
      confirm: true,
      use_stripe_sdk: true,
      metadata: { bookingId: String(booking._id), cardSurchargeAmount: String(cardSurchargeAmount) },
    };

    const driver = await Driver.findById(booking.driverId);
    if (driver?.stripeAccountId && driver.stripeChargesEnabled) {
      const settings = getEffectiveCommissionSettings(driver);
      const feePercent = settings.commissionType === 'per-trip-percent' ? settings.commissionPercent : 0;
      intentOptions.application_fee_amount = Math.round(toCents(fare) * (feePercent / 100)) + toCents(cardSurchargeAmount);
      intentOptions.transfer_data = { destination: driver.stripeAccountId };
    }

    let intent;
    try {
      intent = await stripe.paymentIntents.create(intentOptions);
    } catch (err) {
      if (err.type === 'StripeCardError') return res.status(402).json({ error: err.message });
      throw err;
    }
    await Booking.findByIdAndUpdate(booking._id, { paymentIntentId: intent.id });

    if (intent.status === 'succeeded') {
      await Booking.findByIdAndUpdate(booking._id, { paymentStatus: 'paid' });
      await recordStripeFee(booking._id, intent.id);
    }
    res.json({ status: intent.status, clientSecret: intent.client_secret });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/payment/confirm - the client reports that Stripe's checkout
// succeeded. Never trusted on its own: the booking must be the caller's,
// and with real Stripe the PaymentIntent created above is fetched back
// and must actually be succeeded for the full amount before anything is
// marked paid. (Without STRIPE_SECRET_KEY, /start already marked the mock
// payment paid, so this just confirms ownership.)
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
      const expected = toCents(fareOf(booking) + (booking.cardSurchargeAmount || 0));
      if (intent.status !== 'succeeded' || intent.amount_received < expected) {
        return res.status(402).json({ error: `Payment not completed (status: ${intent.status})` });
      }
      await Booking.findByIdAndUpdate(bookingId, { paymentStatus: 'paid' });
      await recordStripeFee(bookingId, intent.id);
      return res.json(await Booking.findById(bookingId));
    }

    res.json(await Booking.findByIdAndUpdate(bookingId, { paymentStatus: 'paid' }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
