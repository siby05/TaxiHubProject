const { createModel } = require('../lib/MemoryStore');

// Fields: name, email, password (bcrypt hash), mobile, address, role
// ('passenger' | 'driver' | 'admin'), isActive (false = can't log in at
// all), bookingBlocked (passenger-only: can still log in, but new bookings
// are refused - see routes/booking.js), emailVerified, createdAt.
const User = createModel('User');

module.exports = User;
