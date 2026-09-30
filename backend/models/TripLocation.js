const { createModel } = require('../lib/createModel');

// One GPS fix from the driver's phone while a trip is active (see
// routes/booking.js POST /driver/location). Fields: bookingId (-> Booking),
// driverId (-> Driver), lat, lng, accuracy (metres), speed (m/s), heading
// (degrees), recordedAt (when the phone took the fix). Kept for 7 days
// only - see utils/retention.js cleanupOldTripLocations().
const TripLocation = createModel('TripLocation', {
  bookingId: 'Booking',
  driverId: 'Driver',
});

module.exports = TripLocation;
