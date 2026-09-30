const { createModel } = require('../lib/createModel');

// Fields: userId (-> User), licenseNumber (globally unique - enforced in
// routes/admin.js), vehicleType, vehicleNumber, vehicleBrand, vehicleModel
// (e.g. "Toyota"/"Corolla" - driver-editable via PUT /api/driver/profile,
// shown to passengers in booking emails/WhatsApp messages so the car is
// easy to spot at pickup), ratePerKm, pendingRatePerKm
// (driver-requested rate awaiting admin approval, null when none), status
// ('pending' | 'approved' | 'rejected'), isAvailable, availabilitySchedule
// (see utils/schedule.js - an array of 7 {dayOfWeek, slots: [{startTime,
// endTime}]} entries, Sunday-Saturday; a day can hold more than one slot for
// separate shifts, e.g. a morning run and an evening run with a gap between),
// dateSchedule (shifts for specific calendar dates, [{date: 'YYYY-MM-DD',
// slots}] - overrides the weekly pattern for that date; see
// routes/driver.js PUT /schedule/dates/:date), rating, totalTrips, totalEarnings, qrCodeUrl, qrCodeImage, feeOverride
// (null = use the platform-wide commission policy; otherwise a partial
// {commissionType, commissionPercent, weeklyFlatFee} just for this driver -
// see utils/billing.js). feeLimitOverride (null = use the platform-wide
// outstandingFeeLimit; otherwise a $ ceiling just for this driver - going
// over it blocks them from going online, see routes/driver.js). NZTA SPSV
// fields (see utils/compliance.js): serviceCategory ('private-hire' |
// 'taxi', default 'private-hire'), hasSecurityCamera, tslNumber (Transport
// Service Licence), passengerEndorsementNumber, passengerEndorsementExpiry,
// vehicleCofExpiry. Compliance documents (see config/driverDocuments.js):
// documents - a map keyed by license/tsl/cof/rego, each
// {url, status: 'pending'|'verified'|'rejected', rejectionReason,
// uploadedAt, reviewedAt}. An admin reviews each one individually
// (routes/admin.js PUT /drivers/:id/verify-document); a rejection sends it
// back with a reason for the driver to re-upload (routes/driver.js POST
// /documents/:key), and approval is blocked until all four are verified.
// termsAcceptedAt (Date the driver accepted the T&Cs at signup).
// Stripe Connect (see routes/stripeConnect.js): stripeAccountId (Express
// connected account id, null until onboarding starts), stripeChargesEnabled
// (bool - true once Stripe has verified them enough to receive payouts).
// acceptsOnlinePayment (bool, default true, driver's own choice via PUT
// /api/driver/payment-preference) - false means cash-only: they're
// excluded from auto-match for card bookings, and a direct QR hail with
// paymentMethod:'card' is rejected instead of silently charging them.
// expenseCategories: the driver's own expense categories, [{key, label}],
// on top of config/expenseCategories.js (see routes/expenses.js).
const Driver = createModel('Driver', {
  userId: 'User',
});

module.exports = Driver;
