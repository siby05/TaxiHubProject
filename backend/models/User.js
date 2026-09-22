const { createModel } = require('../lib/createModel');

// Fields: name, email, password (bcrypt hash), mobile, address, role
// ('passenger' | 'driver' | 'admin'), isActive (false = can't log in at
// all), bookingBlocked (passenger-only: can still log in, but new bookings
// are refused - see routes/booking.js), emailVerified, registeredByDriver
// (true for a passenger a driver registered on the spot with a
// placeholder password - see routes/driver.js POST /bookings),
// registeredViaQr (true for a passenger created by the guest QR-scan
// booking flow, same placeholder-password idea - see routes/booking.js
// POST /guest), registeredByAdmin (true for a passenger an admin created
// from the dashboard - see routes/admin.js POST /passengers; like the two
// above, email is optional and a placeholder from utils/users.js stands in
// when there is none), resetToken/resetTokenExpiry (forgot-password flow, see
// routes/auth.js POST /forgot-password and /reset-password - null/unset
// once used or expired), createdAt.
const User = createModel('User');

module.exports = User;
