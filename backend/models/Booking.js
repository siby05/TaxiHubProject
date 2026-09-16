const { createModel } = require('../lib/MemoryStore');
const User = require('./User');
const Driver = require('./Driver');

// Fields: passengerId (-> User), driverId (-> Driver), pickupAddress,
// pickupLat/Lng, dropAddress, dropLat/Lng, distanceKm, estimatedFare,
// actualFare, status ('pending' | 'accepted' | 'in-progress' | 'completed'
// | 'cancelled' | 'expired'), requestedAt, acceptedAt, completedAt,
// cancelledAt, cancelReason, paymentStatus, paymentIntentId, rating, review.
const Booking = createModel('Booking', {
  passengerId: () => User.collection,
  driverId: () => Driver.collection,
});

module.exports = Booking;
