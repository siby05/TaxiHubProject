const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const User = require('../models/User');
const { auth, roleMiddleware } = require('../middleware/auth');

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

/**
 * Stripe Connect (Express accounts): each driver gets their own
 * Stripe-hosted onboarding (identity + bank account) so trip payments can
 * go straight to them instead of pooling in the platform's account. See
 * routes/payment.js /pay - once a driver's account has
 * charges_enabled, card payments for their trips become destination
 * charges with the platform's commission taken as application_fee_amount,
 * and everything else falls back to today's pooled-account behavior.
 */

// GET /api/driver/stripe/status - onboarding state for the logged-in driver
router.get('/status', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  if (!stripe) return res.json({ configured: false, connected: false, chargesEnabled: false });
  if (!driver.stripeAccountId) return res.json({ configured: true, connected: false, chargesEnabled: false });

  const account = await stripe.accounts.retrieve(driver.stripeAccountId);
  const chargesEnabled = !!account.charges_enabled;
  if (chargesEnabled !== driver.stripeChargesEnabled) {
    await Driver.findByIdAndUpdate(driver._id, { stripeChargesEnabled: chargesEnabled });
  }
  res.json({ configured: true, connected: true, chargesEnabled, detailsSubmitted: !!account.details_submitted });
});

// POST /api/driver/stripe/onboard - creates (if needed) the driver's Express
// account and returns a one-time Stripe-hosted onboarding link to visit.
router.post('/onboard', auth, roleMiddleware(['driver']), async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Payments are not configured on this platform yet - ask an admin.' });

  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const driverUser = await User.findById(req.user.id);

  try {
    let accountId = driver.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'NZ',
        email: driverUser.email,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_type: 'individual',
      });
      accountId = account.id;
      await Driver.findByIdAndUpdate(driver._id, { stripeAccountId: accountId, stripeChargesEnabled: false });
    }

    const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${base}/driver/settings?stripe=refresh`,
      return_url: `${base}/driver/settings?stripe=return`,
      type: 'account_onboarding',
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
