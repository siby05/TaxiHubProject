/**
 * Mock-by-default email service: logs to the console so the whole booking
 * and complaint flow (acknowledgements, escalations, resolutions) is
 * visible and testable with zero setup. Set SMTP_* in .env to send real
 * mail via nodemailer without touching any calling code.
 */
const { getSettings } = require('../config/platformSettings');

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Render (and some other hosts) have no outbound IPv6 route, but
      // smtp.gmail.com resolves to both an IPv4 and IPv6 address - Node's
      // default resolver order tried the IPv6 one first and got
      // "connect ENETUNREACH", every single send. Forcing IPv4 here (and
      // the global dns.setDefaultResultOrder in server.js, for every
      // other outbound connection this app makes) is the standard fix.
      family: 4,
      // Nodemailer's own defaults can take a long time to give up on a
      // misconfigured/unreachable host, which made a "Sending..." button
      // (forgot-password, run-backup) look stuck rather than failing
      // visibly - fail within ~10s instead so send() below always
      // resolves quickly, whichever way.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  } catch {
    console.warn('[email] nodemailer not installed; falling back to console mock. Run `npm install nodemailer` to enable real SMTP.');
  }
}

// Never throws: a booking/complaint/enquiry must never fail (or, worse,
// crash the whole process via an unhandled rejection - see the SMTP
// ENETUNREACH incident) just because a courtesy email couldn't be sent.
// Most callers fire-and-forget this; runBackup() is the one exception that
// needs to know about a real failure, so it's told via the return value
// instead of a thrown error.
async function send(to, subject, text, attachments) {
  if (transporter) {
    try {
      // EMAIL_FROM is optional - defaults to the admin's own configured
      // inbox, which is also the SMTP account actually sending (most
      // providers, Gmail included, want the From address to match the
      // authenticated account anyway; an unset/mismatched From is a
      // common reason a send silently never arrives).
      const from = process.env.EMAIL_FROM || getSettings().adminEmail;
      await transporter.sendMail({ from, to, subject, text, ...(attachments && { attachments }) });
      return { ok: true };
    } catch (err) {
      console.error(`[email] send to ${to} failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }
  const attachmentNote = attachments ? `\nAttachments: ${attachments.map((a) => a.filename).join(', ')}` : '';
  console.log(`\n[EMAIL MOCK] To: ${to}\nSubject: ${subject}\n${text}${attachmentNote}\n`);
  return { ok: true };
}

// The admin's real inbox (config/platformSettings.js adminEmail) - falls
// back to EMAIL_FROM only if an admin hasn't set one yet, so alerts still
// go somewhere rather than silently vanishing.
function adminInbox() {
  return getSettings().adminEmail || process.env.EMAIL_FROM;
}

const emailService = {
  sendVerificationEmail: (to, name) =>
    send(to, 'Welcome to EasyRide - verify your email', `Hi ${name}, welcome to EasyRide! Your account is ready to use.`),

  sendDriverApplicationReceived: (to, name) =>
    send(to, 'Your EasyRide driver application was received', `Hi ${name}, thanks for applying to drive with EasyRide. Your documents (license, TSL, CoF, vehicle registration) are being reviewed by an admin - you'll be notified once your account is approved and you can start accepting trips.`),

  sendDriverApproved: (to, name) =>
    send(to, 'You are approved to drive on EasyRide', `Hi ${name}, your driver account has been approved. Log in, go online, and you can start receiving trip requests.`),

  sendBookingConfirmation: (to, booking) =>
    send(to, `Booking confirmed (${booking._id})`, `Your ride from ${booking.pickupAddress} to ${booking.dropAddress} has been requested. Estimated fare: $${booking.estimatedFare}.`),

  sendDriverBookingAlert: (to, booking) =>
    send(to, 'New ride request', `New booking from ${booking.pickupAddress} to ${booking.dropAddress}. You have 30 seconds to accept in-app.`),

  // A QR-scan direct hail is auto-accepted (see routes/booking.js) - no
  // accept/decline step, so the driver is told it's already theirs
  // rather than asked to respond.
  sendDriverTripAssigned: (to, booking) =>
    send(to, 'New confirmed trip', `A passenger scanned your QR code and booked you directly - already confirmed, head to ${booking.pickupAddress} for pickup.`),

  sendBookingAccepted: (to, booking) =>
    send(to, 'Driver accepted your ride', `Your driver has accepted booking ${booking._id} and is on the way.`),

  sendBookingConfirmedDirect: (to, booking) =>
    send(to, 'Your ride is confirmed', `Your ride from ${booking.pickupAddress} to ${booking.dropAddress} is confirmed - the driver has been notified. Estimated fare: $${booking.estimatedFare}.`),

  sendBookingCompleted: (to, booking) =>
    send(to, 'Trip completed', `Your trip is complete. Final fare: $${booking.actualFare}.`),

  sendBookingCancelledByDriver: (to, booking, reason) =>
    send(to, `Your driver cancelled trip ${booking.bookingId}`,
      `Your trip from ${booking.pickupAddress} to ${booking.dropAddress} was cancelled by the driver.` +
      `${reason ? `\nReason: ${reason}` : ''}\nPlease rebook in the app - you'll be matched with another driver.`),

  sendComplaintAcknowledgement: (to, complaint) =>
    send(to, `Complaint received (${complaint.complaintId})`, `We've received your complaint and will investigate. Reference: ${complaint.complaintId}.`),

  sendComplaintNotification: (to, complaint) =>
    send(to, `A complaint has been lodged (${complaint.complaintId})`, `A passenger has lodged a complaint regarding a recent trip. Please log in to review and respond.`),

  sendAdminAlertSerious: (complaint) =>
    send(adminInbox(), `SERIOUS INCIDENT: ${complaint.complaintId}`, `A serious complaint (${complaint.complaintType}) was lodged and requires immediate review.`),

  sendDriverResponseNotification: (to, complaint) =>
    send(to, `Driver responded to your complaint (${complaint.complaintId})`, `The driver has responded to your complaint. Log in to view the response.`),

  sendComplaintResolution: (to, complaint) =>
    send(to, `Complaint resolved (${complaint.complaintId})`, `Your complaint has been ${complaint.status}. Summary: ${complaint.resolutionSummary || 'See app for details.'}`),

  sendComplaintStatusChanged: (to, complaint) =>
    send(to, `Complaint update (${complaint.complaintId})`, `Your complaint is now marked "${complaint.status}". Log in to view details.`),

  sendReopenedConfirmation: (to, complaint) =>
    send(to, `Complaint reopened (${complaint.complaintId})`, `We've reopened your complaint and will review it again.`),

  sendEscalationAlert: (complaint) =>
    send(adminInbox(), `ESCALATED: ${complaint.complaintId}`, `Complaint ${complaint.complaintId} has been escalated to authorities.`),

  sendTripReminder: (to, booking, whenLabel) =>
    send(to, `Reminder: trip ${whenLabel} (${booking.bookingId})`, `Your trip from ${booking.pickupAddress} to ${booking.dropAddress} is scheduled for ${new Date(booking.scheduledFor).toLocaleString()}.`),

  // utils/backup.js's weekly/monthly data export - three CSV attachments
  // (passengers, trips, complaints) to whatever the admin has set as
  // adminEmail.
  sendBackupEmail: (to, counts, attachments) =>
    send(
      to,
      `EasyRide data backup - ${new Date().toLocaleDateString()}`,
      `Attached: ${counts.passengers} passengers, ${counts.bookings} trips, ${counts.complaints} complaints (CSV files).`,
      attachments,
    ),

  sendPasswordResetEmail: (to, name, resetLink) =>
    send(to, 'Reset your EasyRide password',
      `Hi ${name}, click the link below to reset your password (expires in 1 hour):\n${resetLink}\n\nIf you didn't ask for this, you can ignore this email - your password stays unchanged.`),

  // Homepage "get in touch" form (routes/enquiry.js) - goes straight to the
  // admin inbox since these are pre-signup visitors, not yet in-app users.
  sendEnquiryEmail: (enquiry) =>
    send(
      adminInbox(),
      `New website enquiry from ${enquiry.name}`,
      `Name: ${enquiry.name}\nEmail: ${enquiry.email}\nPhone: ${enquiry.phone || '-'}\n\nMessage:\n${enquiry.message}`,
    ),
};

module.exports = { emailService };
