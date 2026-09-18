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

export function newTripMessage(booking, passengerName) {
  return `Hi, this is TaxiHub - new ride request${passengerName ? ` from ${passengerName}` : ''}.\n` +
    `Pickup: ${booking.pickupAddress}\nDrop: ${booking.dropAddress}\n` +
    `${booking.distanceKm} km · est. $${booking.estimatedFare} · ${booking.paymentMethod === 'card' ? 'paying online' : 'cash'}` +
    `${booking.scheduledFor ? `\nScheduled: ${new Date(booking.scheduledFor).toLocaleString()}` : ''}`;
}

export function bookingAcceptedMessage(booking, driverName, vehicleLabel) {
  return `Hi, your TaxiHub ride is confirmed (${booking.bookingId}).\n` +
    `Driver: ${driverName}${vehicleLabel ? `\nVehicle: ${vehicleLabel}` : ''}\n` +
    `Pickup: ${booking.pickupAddress}\nDrop: ${booking.dropAddress}\n` +
    `Estimated fare: $${booking.estimatedFare}` +
    `${booking.scheduledFor ? `\nScheduled: ${new Date(booking.scheduledFor).toLocaleString()}` : ''}`;
}

export function driverArrivedMessage(booking, driverName, vehicleLabel) {
  return `Hi, your TaxiHub driver has arrived at the pickup point.\n${driverName}${vehicleLabel ? ` · ${vehicleLabel}` : ''}\nPickup: ${booking.pickupAddress}`;
}
