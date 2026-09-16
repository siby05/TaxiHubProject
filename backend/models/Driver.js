const { createModel } = require('../lib/MemoryStore');
const User = require('./User');

// Fields: userId (-> User), licenseNumber, vehicleType, vehicleNumber,
// ratePerKm, status ('pending' | 'approved' | 'rejected'), isAvailable,
// availabilitySchedule, rating, totalTrips, totalEarnings, qrCode.
const Driver = createModel('Driver', {
  userId: () => User.collection,
});

module.exports = Driver;
