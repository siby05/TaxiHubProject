const { createModel } = require('../lib/MemoryStore');
const User = require('./User');
const Driver = require('./Driver');

// Fields: bookingId (human-readable "TRIP-YYYYMMDD-NNNNN", like Complaint's
// complaintId), passengerId (-> User), driverId (-> Driver), pickupAddress,
// pickupLat/Lng, dropAddress, dropLat/Lng, distanceKm, estimatedFare,
// actualFare, status ('pending' | 'accepted' | 'in-progress' | 'completed'
// | 'cancelled' | 'expired'), requestedAt, scheduledFor (optional - a
// future date/time the passenger asked for instead of "now"), acceptedAt,
// completedAt, cancelledAt, cancelReason, paymentMethod ('cash' | 'card',
// chosen at booking time), paymentStatus ('unpaid' | 'paid' - cash trips
// are auto-marked paid on completion; card trips only once /api/payment
// confirms), paymentIntentId,
// rating/review (passenger's rating of the driver - public, feeds the
// driver's aggregate Driver.rating), passengerRating/passengerReview
// (driver's rating of the passenger - never shown to the passenger, see
// hidePassengerRating() in routes/booking.js), bookedByDriver (true when a
// driver created this on a passenger's behalf - see routes/driver.js POST
// /bookings), reminderDayEmailSent/reminderHourEmailSent (scheduled-trip
// reminder flags - see utils/reminders.js).
const Booking = createModel('Booking', {
  passengerId: () => User.collection,
  driverId: () => Driver.collection,
});

Booking.pre(async (doc, collection) => {
  if (!doc.bookingId) {
    const count = collection.docs.length;
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    doc.bookingId = `TRIP-${dateStr}-${String(count + 1).padStart(5, '0')}`;
  }
});

module.exports = Booking;
