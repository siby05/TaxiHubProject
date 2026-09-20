const { createModel } = require('../lib/createModel');

// Fields: bookingId (human-readable "TRIP-YYYYMMDD-NNNNN", like Complaint's
// complaintId), passengerId (-> User), driverId (-> Driver, null while a
// request is still an unclaimed broadcast - see routes/booking.js POST /),
// declinedBy (driver ids who turned this request down, so it's never shown
// to them again - see PUT /:id/decline), requestedVehicleType (the class
// the passenger asked for, null = any - see config/vehicleTypes.js),
// pickupAddress, pickupLat/Lng, dropAddress, dropLat/Lng, distanceKm,
// estimatedFare, actualFare, status ('pending' | 'accepted' | 'in-progress'
// | 'completed' | 'cancelled' | 'expired'), requestedAt, scheduledFor
// (optional - a future date/time the passenger asked for instead of "now"),
// acceptedAt, arrivedAt (driver reached the pickup point; status stays
// 'accepted' - see PUT /:id/arrived), startedAt (driver began the trip
// itself, see PUT /:id/start - used as the reference point for
// utils/driverAvailability.js's next-available-time estimate),
// completedAt, cancelledAt, cancelReason, paymentMethod ('cash' | 'card',
// chosen at booking time), cardSurchargeAmount (payment-gateway fee
// disclosed and added on top of the fare for card bookings only, 0 for
// cash - see utils/distance.js calculateCardSurcharge()), paymentStatus
// ('unpaid' | 'paid' - cash trips are auto-marked paid on completion;
// card trips only once /api/payment confirms), paymentIntentId,
// rating/review (passenger's rating of the driver - public, feeds the
// driver's aggregate Driver.rating), passengerRating/passengerReview
// (driver's rating of the passenger - never shown to the passenger, see
// hidePassengerRating() in routes/booking.js), bookedByDriver (true when a
// driver created this on a passenger's behalf - see routes/driver.js POST
// /bookings), reminderDayEmailSent/reminderHourEmailSent (scheduled-trip
// reminder flags - see utils/reminders.js).
const Booking = createModel('Booking', {
  passengerId: 'User',
  driverId: 'Driver',
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
