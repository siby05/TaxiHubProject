import { formatNzDateTime } from './nzTime';

// "Toyota Corolla (Comfort) · ABC123" - brand/model are optional (a driver
// may not have set them yet in Settings), so this degrades gracefully to
// just "Comfort · ABC123" when they're missing. Shared by every WhatsApp
// message below that tells a passenger what car to look for at pickup.
export function vehicleLabel(driver) {
  if (!driver) return '';
  const make = [driver.vehicleBrand, driver.vehicleModel].filter(Boolean).join(' ');
  const withType = make ? `${make} (${driver.vehicleType})` : driver.vehicleType;
  return [withType, driver.vehicleNumber].filter(Boolean).join(' · ');
}

// Builds a free wa.me deep link: opens WhatsApp (app or web) with the
// recipient and message pre-filled, one tap away from sending. This is the
// free alternative to the paid WhatsApp Business API - there's no way to
// have the server push the message automatically without that, so every
// "message on WhatsApp" button in the app uses this instead.
// Every pre-filled WhatsApp message ends with the website address, added
// here once rather than in each message builder.
export const SITE_LABEL = 'easyridenz.com';

function withSite(text) {
  if (!text || text.includes(SITE_LABEL)) return text;
  return `${text}\n\nEasyRide - ${SITE_LABEL}`;
}

// Opened from the iPhone home-screen app (navigator.standalone is
// iOS-only), a wa.me link loads in an in-app browser sheet that hands off
// to WhatsApp and is then left behind as a blank white page - reloading
// only reloads the blank wa.me page, so the driver had to force-quit
// EasyRide. The whatsapp:// scheme goes straight to the WhatsApp app and
// leaves EasyRide's own page untouched.
function inIosHomeScreenApp() {
  return typeof navigator !== 'undefined' && navigator.standalone === true;
}

export function waLink(mobile, text) {
  if (!mobile) return null;
  const digits = String(mobile).replace(/[^\d]/g, ''); // wa.me wants digits only, no leading +
  if (!digits) return null;
  const encoded = text ? encodeURIComponent(withSite(text)) : '';
  if (inIosHomeScreenApp()) return `whatsapp://send?phone=${digits}${encoded ? `&text=${encoded}` : ''}`;
  return `https://wa.me/${digits}${encoded ? `?text=${encoded}` : ''}`;
}

// Opens a waLink() automatically as part of a button tap (DriverDashboard's
// "I've arrived" and Complete). An app-scheme link is followed in place -
// it switches to WhatsApp without navigating EasyRide away - while a wa.me
// link gets its own tab so the app stays open behind it.
export function openWhatsApp(link) {
  if (!link) return;
  try {
    if (link.startsWith('whatsapp:')) window.location.href = link;
    else window.open(link, '_blank');
  } catch { /* popup blocked - the same links are rendered as buttons */ }
}

// No fixed recipient - opens WhatsApp's own contact picker with the text
// pre-filled, so the sender chooses who to forward it to (often "Message
// Yourself", or a family member helping them). Used where there's no
// specific mobile number to address (e.g. sharing a password-reset link
// - see pages/ForgotPassword.jsx and pages/admin/AdminDashboard.jsx's
// reset-password action, which does have a number and uses waLink instead).
export function waShareLink(text) {
  if (inIosHomeScreenApp()) return `whatsapp://send?text=${encodeURIComponent(withSite(text))}`;
  return `https://wa.me/?text=${encodeURIComponent(withSite(text))}`;
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
    `${booking.scheduledFor ? `\nScheduled: ${formatNzDateTime(booking.scheduledFor)}` : ''}\n` +
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
    `${booking.scheduledFor ? `\nScheduled: ${formatNzDateTime(booking.scheduledFor)}` : ''}`;
}

// Driver -> passenger, sent once the driver has arrived at pickup.
export function driverArrivedMessage(booking, driverName, vehicleLabel) {
  return `Hi, this is ${driverName || 'your driver'}, Driver from EasyRide${vehicleLabel ? ` (${vehicleLabel})` : ''} - I've arrived at ${booking.pickupAddress} for booking ${booking.bookingId}. No rush at all, take your time - I'll be here waiting.`;
}

// Driver -> passenger, opened automatically the moment the driver cancels
// an accepted/in-progress trip (see pages/driver/DriverDashboard.jsx
// cancelTrip()) - the backend also emails the passenger the same news
// (see routes/booking.js PUT /:id/cancel), so this is the immediate,
// no-delay heads-up on top of that.
export function driverCancelledMessage(booking, driverName, reason) {
  return `Hi, this is ${driverName || 'your EasyRide driver'} - I'm sorry, I have to cancel your trip (${booking.bookingId}: ${booking.pickupAddress} → ${booking.dropAddress}).` +
    `${reason ? `\nReason: ${reason}` : ''}\nPlease rebook in the app when you're ready.`;
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
// Driver -> passenger, opened automatically on Complete when the passenger
// has no real email on file (registered by a driver/admin or via the guest
// QR flow - see GET /api/booking/driver's passengerHasEmail), so the
// receipt still reaches them: the same receipt page (view / download PDF)
// an emailed passenger gets, as a link. Folds in the pay link when a card
// fare is still owing, so it's one message rather than two.
export function receiptMessage(booking, driverName, receiptLink, payLink) {
  return `Hi, this is ${driverName || 'your EasyRide driver'} - your trip (${booking.bookingId}) is complete.\n` +
    `Fare: $${booking.actualFare}\n` +
    `Your receipt (view or download as PDF): ${receiptLink}` +
    `${payLink ? `\n\nPlease complete your online payment here: ${payLink}` : ''}`;
}

// payLink is null for a cash trip left as "payment pending".
export function paymentReminderMessage(booking, driverName, payLink) {
  return `Hi, this is ${driverName || 'your EasyRide driver'} - your trip (${booking.bookingId}) is complete.\n` +
    `Fare: $${booking.actualFare ?? booking.estimatedFare}\n` +
    (payLink ? `Please complete your online payment here: ${payLink}` : 'Payment is still pending - please pay at your convenience. Thank you!');
}
