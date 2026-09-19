const { createModel } = require('../lib/createModel');

// Fields: name, email, password (bcrypt hash), mobile, address, role
// ('passenger' | 'driver' | 'admin'), isActive (false = can't log in at
// all), bookingBlocked (passenger-only: can still log in, but new bookings
// are refused - see routes/booking.js), emailVerified, registeredByDriver
// (true for a passenger a driver registered on the spot with a
// placeholder password - see routes/driver.js POST /bookings), createdAt.
const User = createModel('User');

module.exports = User;
