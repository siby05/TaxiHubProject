const { createModel } = require('../lib/MemoryStore');
const User = require('./User');
const Driver = require('./Driver');

// Fields: passengerId (-> User), driverId (-> Driver), pickupAddress,
// pickupLat/Lng, dropAddress, dropLat/Lng, distanceKm, estimatedFare,
// actualFare, status ('pending' | 'accepted' | 'in-progress' | 'completed'
// | 'cancelled' | 'expired'), requestedAt, scheduledFor (optional - a
// future date/time the passenger asked for instead of "now"), acceptedAt,
// completedAt, cancelledAt, cancelReason, paymentStatus, paymentIntentId,
// rating/review (passenger's rating of the driver - public, feeds the
// driver's aggregate Driver.rating), passengerRating/passengerReview
// (driver's rating of the passenger - never shown to the passenger, see
// hidePassengerRating() in routes/booking.js), bookedByDriver (true when a
// driver created this on a passenger's behalf - see routes/driver.js POST
// /bookings).
const Booking = createModel('Booking', {
  passengerId: () => User.collection,
  driverId: () => Driver.collection,
});

module.exports = Booking;
