// Builds a free wa.me deep link: opens WhatsApp (app or web) with the
// recipient and message pre-filled, one tap away from sending. This is the
// free alternative to the paid WhatsApp Business API - there's no way to
// have the server push the message automatically without that, so every
// "message on WhatsApp" button in the app uses this instead.
export function waLink(mobile, text) {
  if (!mobile) return null;
  const digits = String(mobile).replace(/[^\d]/g, ''); // wa.me wants digits only, no leading +
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

// No fixed recipient - opens WhatsApp's own contact picker with the text
// pre-filled, so the sender chooses who to forward it to (often "Message
// Yourself", or a family member helping them). Used where there's no
// specific mobile number to address (e.g. sharing a password-reset link
// - see pages/ForgotPassword.jsx and pages/admin/AdminDashboard.jsx's
// reset-password action, which does have a number and uses waLink instead).
export function waShareLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// Each message below is pre-filled text for the SENDER to send - so it must
// read naturally in that person's voice, addressed to the other party. Mixing
// these up (e.g. giving the passenger a message written as if the driver
// were confirming their own details) reads backwards to whoever gets it.

// Driver -> passenger, sent from a still-pending request (before accept).
export function driverPendingMessage(booking, passengerName) {
  return `Hi${passengerName ? ` ${passengerName}` : ''}, this is your EasyRide driver about booking ${booking.bookingId}.\n` +
    `Pickup: ${booking.pickupAddress}\nDrop: ${booking.dropAddress}\n` +
    `${booking.distanceKm} km · est. $${booking.estimatedFare} · ${booking.paymentMethod === 'card' ? 'paying online' : 'cash'}` +
    `${booking.scheduledFor ? `\nScheduled: ${new Date(booking.scheduledFor).toLocaleString()}` : ''}\n` +
    `I'll confirm shortly.`;
}

// Driver -> passenger, opened automatically the moment the driver taps
// Accept (see pages/driver/DriverDashboard.jsx accept()) - states the
// confirmation: who's coming, in what, and the fare.
export function driverConfirmedMessage(booking, driverName, vehicleLabel) {
  return `Hi, this is ${driverName || 'your EasyRide driver'} - your ride is confirmed (${booking.bookingId}).\n` +
    `${vehicleLabel ? `Vehicle: ${vehicleLabel}\n` : ''}` +
    `Pickup: ${booking.pickupAddress}\nDrop: ${booking.dropAddress}\n` +
    `Estimated fare: $${booking.estimatedFare}` +
    `${booking.scheduledFor ? `\nScheduled: ${new Date(booking.scheduledFor).toLocaleString()}` : ''}`;
}

// Driver -> passenger, sent once the driver has arrived at pickup.
export function driverArrivedMessage(booking, driverName, vehicleLabel) {
  return `Hi, this is ${driverName || 'your EasyRide driver'}${vehicleLabel ? ` (${vehicleLabel})` : ''} - I've arrived at ${booking.pickupAddress} for booking ${booking.bookingId}. No rush at all, take your time - I'll be here waiting.`;
}

// Driver -> passenger, opened automatically the moment the driver cancels
// an accepted/in-progress trip (see pages/driver/DriverDashboard.jsx
// cancelTrip()) - the backend also emails the passenger the same news
// (see routes/booking.js PUT /:id/cancel), so this is the immediate,
// no-delay heads-up on top of that.
export function driverCancelledMessage(booking, driverName, reason) {
  return `Hi, this is ${driverName || 'your EasyRide driver'} - I'm sorry, I have to cancel your trip (${booking.bookingId}: ${booking.pickupAddress} → ${booking.dropAddress}).` +
    `${reason ? `\nReason: ${reason}` : ''}\nPlease rebook in the app - you'll be matched with another driver.`;
}

// Passenger -> driver, once the driver has accepted the ride. Deliberately
// just a greeting - the passenger types their own message rather than
// getting a wall of booking details dropped into the compose box.
export function passengerToDriverMessage(driverName) {
  return `Hi${driverName ? ` ${driverName}` : ''}`;
}

// Driver -> passenger, opened automatically on Complete when the trip was
// a card payment that's still unpaid (see pages/driver/DriverDashboard.jsx
// complete()). payLink is the /pay/:bookingId deep link - one tap from
// WhatsApp straight to the payment screen (logging in first if needed),
// no need to find the trip in their own booking list.
export function paymentReminderMessage(booking, driverName, payLink) {
  return `Hi, this is ${driverName || 'your EasyRide driver'} - your trip (${booking.bookingId}) is complete.\n` +
    `Fare: $${booking.actualFare}\n` +
    `Please complete your online payment here: ${payLink}`;
}
