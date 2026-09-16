const { createModel } = require('../lib/MemoryStore');
const User = require('./User');

// Fields: userId (-> User), licenseNumber (globally unique - enforced in
// routes/admin.js), vehicleType, vehicleNumber, ratePerKm, pendingRatePerKm
// (driver-requested rate awaiting admin approval, null when none), status
// ('pending' | 'approved' | 'rejected'), isAvailable, availabilitySchedule,
// rating, totalTrips, totalEarnings, qrCodeUrl, qrCodeImage.
const Driver = createModel('Driver', {
  userId: () => User.collection,
});

module.exports = Driver;
