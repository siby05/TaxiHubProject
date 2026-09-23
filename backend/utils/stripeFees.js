/**
 * Stripe's own processing fee, passed on to the passenger as the card
 * surcharge - not an admin setting. Rates are Stripe New Zealand's
 * published standard pricing (https://stripe.com/en-nz/pricing): which
 * one applies depends on the card's issuing country, so the exact
 * surcharge is only known once the passenger has entered their card (see
 * routes/payment.js /card-fee and /pay). Before that - fare quotes,
 * booking creation - the domestic rate is shown as the estimate.
 *
 * STRIPE_FEE_GST_PERCENT: set to 15 if Stripe adds GST on top of its fees
 * for your account (check a Stripe invoice). The real fee Stripe took is
 * recorded on each paid booking as stripeFeeActual, so any drift between
 * these rates and reality shows up there.
 */
const HOME_COUNTRY = 'NZ';
const RATES = {
  domestic: { percent: 2.65, fixed: 0.3 },
  international: { percent: 3.5, fixed: 0.3 },
};

function cardRegion(cardCountry) {
  return !cardCountry || cardCountry === HOME_COUNTRY ? 'domestic' : 'international';
}

// Stripe charges its fee on the whole amount collected - fare plus this
// surcharge - so the surcharge is grossed up to cover the fee on itself:
// total = (fare + fixed) / (1 - pct), surcharge = total - fare. Rounded up
// to the cent so Stripe's own rounding never leaves the platform short.
function calculateCardSurcharge(fare, cardCountry) {
  if (!fare || fare <= 0) return 0;
  const { percent, fixed } = RATES[cardRegion(cardCountry)];
  const gst = 1 + (Number(process.env.STRIPE_FEE_GST_PERCENT) || 0) / 100;
  const total = (fare + fixed * gst) / (1 - (percent / 100) * gst);
  return Math.ceil(Math.round((total - fare) * 1e6) / 1e4) / 100;
}

module.exports = { calculateCardSurcharge, cardRegion, RATES };
