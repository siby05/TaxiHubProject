/**
 * Mock-by-default WhatsApp service, same shape as emailService: logs to the
 * console so the booking flow is testable with zero setup, and sends real
 * messages via Twilio's WhatsApp API once TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM are set - no calling code
 * changes either way.
 *
 * Numbers are stored as the NZ local form users type ("0210000000"), so
 * they're normalised to E.164 (+64...) before sending. Sends never throw:
 * a WhatsApp outage must not roll back a booking that already exists, so
 * failures are logged and swallowed (the in-app notification and email are
 * the reliable channels).
 */
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch {
    console.warn('[whatsapp] twilio not installed; falling back to console mock. Run `npm install twilio` to enable real sending.');
  }
}

const DEFAULT_COUNTRY_CODE = process.env.WHATSAPP_COUNTRY_CODE || '64';

function toE164(mobile) {
  if (!mobile) return null;
  const digits = String(mobile).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) return `+${digits}`;
  return `+${DEFAULT_COUNTRY_CODE}${digits}`;
}

async function send(mobile, body) {
  const to = toE164(mobile);
  if (!to) return;

  if (!twilioClient || !process.env.TWILIO_WHATSAPP_FROM) {
    console.log(`\n[WHATSAPP MOCK] To: ${to}\n${body}\n`);
    return;
  }

  try {
    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
      to: `whatsapp:${to}`,
      body,
    });
  } catch (err) {
    console.error(`[whatsapp] send to ${to} failed: ${err.message}`);
  }
}

const whatsappService = {
  sendDriverBookingAlert: (mobile, booking, passengerName) =>
    send(mobile, `🚖 New TaxiHub ride request${passengerName ? ` from ${passengerName}` : ''}\n\n` +
      `Pickup: ${booking.pickupAddress}\nDrop: ${booking.dropAddress}\n` +
      `${booking.distanceKm} km · est. $${booking.estimatedFare} · ${booking.paymentMethod === 'card' ? 'paying online' : 'cash'}\n` +
      `${booking.scheduledFor ? `Scheduled: ${new Date(booking.scheduledFor).toLocaleString()}\n` : ''}` +
      `\nOpen your TaxiHub dashboard to accept.`),

  sendPassengerBookingAccepted: (mobile, booking, driverName, vehicleLabel) =>
    send(mobile, `✅ Your TaxiHub ride is confirmed (${booking.bookingId})\n\n` +
      `Driver: ${driverName}${vehicleLabel ? `\nVehicle: ${vehicleLabel}` : ''}\n` +
      `Pickup: ${booking.pickupAddress}\nDrop: ${booking.dropAddress}\n` +
      `Estimated fare: $${booking.estimatedFare}` +
      `${booking.scheduledFor ? `\nScheduled: ${new Date(booking.scheduledFor).toLocaleString()}` : ''}`),

  sendPassengerDriverArrived: (mobile, booking, driverName, vehicleLabel) =>
    send(mobile, `🚕 Your TaxiHub driver has arrived at the pickup point.\n\n` +
      `${driverName}${vehicleLabel ? ` · ${vehicleLabel}` : ''}\nPickup: ${booking.pickupAddress}`),
};

module.exports = { whatsappService, toE164 };
