const Booking = require('../models/Booking');

// Aggregate rating a passenger has received from drivers on past trips -
// shown to drivers/admins (never to the passenger themselves - see
// hidePassengerRating() in routes/booking.js). null when no ratings yet.
async function getPassengerRatingAvg(passengerId) {
  const trips = await Booking.find({ passengerId, passengerRating: { $gte: 1 } });
  if (!trips.length) return null;
  return Math.round((trips.reduce((sum, t) => sum + t.passengerRating, 0) / trips.length) * 10) / 10;
}

module.exports = { getPassengerRatingAvg };
