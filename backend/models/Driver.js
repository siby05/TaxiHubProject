const { createModel } = require('../lib/MemoryStore');
const User = require('./User');

// Fields: userId (-> User), licenseNumber (globally unique - enforced in
// routes/admin.js), vehicleType, vehicleNumber, ratePerKm, pendingRatePerKm
// (driver-requested rate awaiting admin approval, null when none), status
// ('pending' | 'approved' | 'rejected'), isAvailable, availabilitySchedule,
// rating, totalTrips, totalEarnings, qrCodeUrl, qrCodeImage, feeOverride
// (null = use the platform-wide commission policy; otherwise a partial
// {commissionType, commissionPercent, weeklyFlatFee} just for this driver -
// see utils/billing.js). NZTA SPSV fields (see utils/compliance.js):
// serviceCategory ('private-hire' | 'taxi', default 'private-hire'),
// hasSecurityCamera, passengerEndorsementNumber, passengerEndorsementExpiry,
// vehicleCofExpiry.
const Driver = createModel('Driver', {
  userId: () => User.collection,
});

module.exports = Driver;
