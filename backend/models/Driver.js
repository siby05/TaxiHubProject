const { createModel } = require('../lib/MemoryStore');
const User = require('./User');

// Fields: userId (-> User), licenseNumber (globally unique - enforced in
// routes/admin.js), vehicleType, vehicleNumber, ratePerKm, pendingRatePerKm
// (driver-requested rate awaiting admin approval, null when none), status
// ('pending' | 'approved' | 'rejected'), isAvailable, availabilitySchedule,
// rating, totalTrips, totalEarnings, qrCodeUrl, qrCodeImage, feeOverride
// (null = use the platform-wide commission policy; otherwise a partial
// {commissionType, commissionPercent, weeklyFlatFee} just for this driver -
// see utils/billing.js). feeLimitOverride (null = use the platform-wide
// outstandingFeeLimit; otherwise a $ ceiling just for this driver - going
// over it blocks them from going online, see routes/driver.js). NZTA SPSV
// fields (see utils/compliance.js): serviceCategory ('private-hire' |
// 'taxi', default 'private-hire'), hasSecurityCamera, tslNumber (Transport
// Service Licence), passengerEndorsementNumber, passengerEndorsementExpiry,
// vehicleCofExpiry. Driver signup documents (see routes/driverSignup.js):
// licenseDocUrl, tslDocUrl, cofDocUrl, regoDocUrl, documentsSubmitted
// (bool), termsAcceptedAt (Date the driver accepted the T&Cs at signup).
// Stripe Connect (see routes/stripeConnect.js): stripeAccountId (Express
// connected account id, null until onboarding starts), stripeChargesEnabled
// (bool - true once Stripe has verified them enough to receive payouts).
// acceptsOnlinePayment (bool, default true, driver's own choice via PUT
// /api/driver/payment-preference) - false means cash-only: they're
// excluded from auto-match for card bookings, and a direct QR hail with
// paymentMethod:'card' is rejected instead of silently charging them.
const Driver = createModel('Driver', {
  userId: () => User.collection,
});

module.exports = Driver;
