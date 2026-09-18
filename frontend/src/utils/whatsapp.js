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

// Each message below is pre-filled text for the SENDER to send - so it must
// read naturally in that person's voice, addressed to the other party. Mixing
// these up (e.g. giving the passenger a message written as if the driver
// were confirming their own details) reads backwards to whoever gets it.

// Driver -> passenger, sent from a still-pending request (before accept).
export function driverPendingMessage(booking, passengerName) {
  return `Hi${passengerName ? ` ${passengerName}` : ''}, this is your TaxiHub driver about booking ${booking.bookingId}.\n` +
    `Pickup: ${booking.pickupAddress}\nDrop: ${booking.dropAddress}\n` +
    `${booking.distanceKm} km · est. $${booking.estimatedFare} · ${booking.paymentMethod === 'card' ? 'paying online' : 'cash'}` +
    `${booking.scheduledFor ? `\nScheduled: ${new Date(booking.scheduledFor).toLocaleString()}` : ''}\n` +
    `I'll confirm shortly.`;
}

// Driver -> passenger, sent once the driver has arrived at pickup.
export function driverArrivedMessage(booking, driverName, vehicleLabel) {
  return `Hi, this is ${driverName || 'your TaxiHub driver'}${vehicleLabel ? ` (${vehicleLabel})` : ''} - I've arrived at ${booking.pickupAddress}. Whenever you're ready.`;
}

// Passenger -> driver, sent once the driver has accepted the ride.
export function passengerToDriverMessage(booking, passengerName, driverName) {
  return `Hi${driverName ? ` ${driverName}` : ''}, this is ${passengerName || 'your TaxiHub passenger'} - about booking ${booking.bookingId}.\n` +
    `Pickup: ${booking.pickupAddress}\nDrop: ${booking.dropAddress}` +
    `${booking.scheduledFor ? `\nScheduled: ${new Date(booking.scheduledFor).toLocaleString()}` : ''}`;
}
