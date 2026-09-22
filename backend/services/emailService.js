/**
 * Mock-by-default email service: logs to the console so the whole booking
 * and complaint flow (acknowledgements, escalations, resolutions) is
 * visible and testable with zero setup. Set BREVO_API_KEY in .env to send
 * real mail over HTTPS (preferred - see below), or SMTP_* to send via
 * nodemailer, without touching any calling code.
 */
const dns = require('dns');
const { promisify } = require('util');
const { getSettings } = require('../config/platformSettings');
const { formatNzDateTime, formatNzDate } = require('../utils/nzTime');

const resolve4 = promisify(dns.resolve4);
const brevoConfigured = !!process.env.BREVO_API_KEY;
const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);

// Sends over Brevo's HTTPS API (free tier: 300 emails/day, only needs the
// From address verified as a sender - no domain required). This exists
// because Render's free tier blocks *all* outbound SMTP ports (25/465/587),
// which is why every SMTP attempt below - on either port, after both
// retries - timed out in production: there's no port to fall back to, the
// only way out is not to use SMTP at all. Plain HTTPS on 443 is never
// blocked.
async function sendViaBrevo({ from, to, subject, text, html, attachments }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: process.env.EMAIL_FROM_NAME || 'EasyRide', email: from },
      to: [{ email: to }],
      ...(adminInbox() && { replyTo: { email: adminInbox() } }),
      subject,
      textContent: text,
      ...(html && { htmlContent: html }),
      ...(attachments && {
        attachment: attachments.map((a) => ({ name: a.filename, content: Buffer.from(a.content).toString('base64') })),
      }),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Brevo ${res.status}: ${body.message || body.code || res.statusText}`);
  }
}

// Builds a fresh transporter for every send, pointed at a literal IPv4
// address rather than the SMTP hostname. Render (and some other hosts) have
// no outbound IPv6 route - passing `family: 4` to createTransport() and
// setting dns.setDefaultResultOrder('ipv4first') (see server.js) both look
// like the standard fix, but neither actually does anything here: nodemailer
// v10 resolves the hostname itself (dist/cjs/shared/index.js), querying both
// A and AAAA records and then picking *at random* between whatever it finds
// - it never reads options.family, and setDefaultResultOrder only affects
// dns.lookup(), not the dns.resolve4()/resolve6() calls nodemailer actually
// makes. The result was a coin-flip on every single send: about half landed
// on smtp.gmail.com's IPv6 address and failed with ENETUNREACH. Resolving to
// an IPv4 literal ourselves sidesteps that logic entirely - nodemailer skips
// its own DNS resolution whenever `host` is already an IP (net.isIP check) -
// while tls.servername keeps TLS certificate validation working against the
// real hostname instead of the raw IP.
async function buildTransporter(port) {
  if (!smtpConfigured) return null;
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    console.warn('[email] nodemailer not installed; falling back to console mock. Run `npm install nodemailer` to enable real SMTP.');
    return null;
  }

  let host = process.env.SMTP_HOST;
  try {
    const addresses = await resolve4(process.env.SMTP_HOST);
    if (addresses[0]) host = addresses[0];
  } catch (err) {
    // Fall back to the hostname - better to let nodemailer take its own
    // (unreliable) shot than to fail the send outright over a DNS hiccup.
    console.warn(`[email] could not resolve ${process.env.SMTP_HOST} to an IPv4 address (${err.message}); falling back to hostname`);
  }

  return nodemailer.createTransport({
    host,
    port,
    // 465 is implicit TLS from the first byte; 587 (and anything else)
    // starts plaintext and upgrades via STARTTLS - passing the wrong one
    // for the port just produces its own connection failure, so this has
    // to track whichever port this attempt is actually using.
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { servername: process.env.SMTP_HOST },
    // Nodemailer's own defaults can take a long time to give up on a
    // misconfigured/unreachable host, which made a "Sending..." button
    // (forgot-password, run-backup) look stuck rather than failing
    // visibly - fail within ~10s instead so send() below always
    // resolves quickly, whichever way.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Connection-level failures (a dropped/refused/timed-out TCP handshake) are
// often a one-off network blip rather than a real, retry-proof problem -
// unlike an auth failure (bad credentials) or a rejected recipient, where
// trying again changes nothing. Nodemailer/Node label these with one of a
// handful of error codes, so only those get a second attempt.
const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH']);
function isRetryable(err) {
  return RETRYABLE_CODES.has(err.code) || /connection timeout/i.test(err.message || '');
}

// Never throws: a booking/complaint/enquiry must never fail (or, worse,
// crash the whole process via an unhandled rejection - see the SMTP
// ENETUNREACH incident) just because a courtesy email couldn't be sent.
// Most callers fire-and-forget this; runBackup() is the one exception that
// needs to know about a real failure, so it's told via the return value
// instead of a thrown error.
async function send(to, subject, text, attachments, html) {
  // EMAIL_FROM is optional - defaults to the admin's own configured inbox.
  // For Brevo that address must be a verified sender on the account; for
  // SMTP it's the account actually sending (most providers, Gmail
  // included, want the From address to match the authenticated account
  // anyway; an unset/mismatched From is a common reason a send silently
  // never arrives).
  const from = process.env.EMAIL_FROM || getSettings().adminEmail;

  if (brevoConfigured) {
    try {
      await sendViaBrevo({ from, to, subject, text, html, attachments });
      return { ok: true };
    } catch (err) {
      console.error(`[email] send to ${to} via Brevo failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  if (smtpConfigured) {
    let lastErr;
    // A same-port retry alone wasn't enough in production: Render logs
    // showed the *final* failure (both the first attempt and the 1s-later
    // retry) still timing out on the same port, which points to that
    // specific port being blocked/throttled outbound rather than a
    // one-off blip. 587 (STARTTLS) and 465 (implicit TLS) are both common
    // SMTP ports, and a network that blocks one sometimes still allows the
    // other - so the second attempt switches port instead of just
    // retrying the same one, on top of the fresh DNS resolution and
    // transporter every attempt already gets.
    const configuredPort = Number(process.env.SMTP_PORT) || 587;
    const fallbackPort = configuredPort === 465 ? 587 : 465;
    const ports = [configuredPort, fallbackPort];
    for (let attempt = 1; attempt <= ports.length; attempt += 1) {
      const port = ports[attempt - 1];
      try {
        const transporter = await buildTransporter(port);
        if (!transporter) throw new Error('SMTP transporter could not be created');
        await transporter.sendMail({ from, to, subject, text, ...(html && { html }), ...(attachments && { attachments }) });
        return { ok: true };
      } catch (err) {
        lastErr = err;
        if (attempt < ports.length && isRetryable(err)) {
          console.warn(`[email] send to ${to} via port ${port} failed (${err.message}) - retrying on port ${ports[attempt]}`);
          await sleep(1000);
          continue;
        }
        break;
      }
    }
    console.error(`[email] send to ${to} failed: ${lastErr.message}`);
    return { ok: false, error: lastErr.message };
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

// Same FRONTEND_URL every other deep link in the app uses (see
// utils/qrcode.js, routes/auth.js's reset link) - lets a driver tap
// straight into the app from a trip-notification email instead of having
// to find it themselves.
function appUrl(path = '/driver') {
  return `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}${path}`;
}

// "Toyota Corolla (Comfort) · ABC123" - brand/model are optional (older
// driver profiles may not have set them yet via PUT /api/driver/profile),
// so this degrades to just "Comfort · ABC123" when they're missing.
function vehicleLabel(driver) {
  if (!driver) return null;
  const make = [driver.vehicleBrand, driver.vehicleModel].filter(Boolean).join(' ');
  const withType = make ? `${make} (${driver.vehicleType})` : driver.vehicleType;
  return [withType, driver.vehicleNumber].filter(Boolean).join(' · ');
}

// Appended to a booking-confirmation email once a specific driver is
// assigned, so the passenger knows what car and who to look for at pickup
// without having to log back into the app.
function driverLine(driver, driverName) {
  const label = vehicleLabel(driver);
  return label ? `\nDriver: ${driverName || 'assigned'} - ${label}` : '';
}

// Addresses, names and vehicle details are typed by users and end up in
// HTML that is both emailed and served as a page (GET /:id/receipt).
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A row of the invoice's details table - kept as one helper so every row
// shares the same border/padding instead of repeating inline styles.
function invoiceRow(label, value) {
  if (!value) return '';
  return `<tr>
    <td style="padding:8px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">${label}</td>
    <td style="padding:8px 0;color:#0f172a;font-size:13px;text-align:right;border-bottom:1px solid #e2e8f0;">${esc(value)}</td>
  </tr>`;
}

// Table-based HTML (not flexbox/grid - the only layout email clients like
// Outlook reliably render) for the "Email invoice" action on a completed
// trip (see routes/booking.js POST /:id/invoice) - available to the
// passenger themselves, and to admin/driver so either can (re)send a
// passenger their invoice on request. Mirrors PrintableReceipt.jsx's
// content so the emailed and printed versions agree, but styled as a
// proper company invoice: branded header, admin contact details for
// queries, and a clearly totalled fare breakdown.
function buildInvoiceHtml(booking, passenger, driver, driverName, { forPrint = false } = {}) {
  const settings = getSettings();
  const fare = booking.actualFare ?? booking.estimatedFare;
  const total = fare + (booking.cardSurchargeAmount || 0);
  const vLabel = vehicleLabel(driver);
  const stopsRows = (booking.stops || []).map((s, i) => invoiceRow(`Stop ${i + 1}`, s.address)).join('');

  // The header's navy band is a <table bgcolor> rather than a <div
  // style="background"> on purpose: Outlook (desktop) and a few other
  // clients ignore CSS backgrounds on divs but honour the bgcolor
  // attribute on table cells, so this is the one way the band renders
  // everywhere. Same for the logo badge cell.
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;">
  <table width="100%" bgcolor="#0B2942" style="width:100%;border-collapse:separate;background:#0B2942;border-radius:10px 10px 0 0;" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td style="padding:24px 32px;">
        <table style="border-collapse:collapse;" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="width:40px;vertical-align:middle;">
              <!-- CSS-only badge (no external/attached image - the one asset guaranteed to render in every mail client, including ones that block remote images by default), matching frontend/src/components/Logo.jsx's chevron-in-a-badge mark. -->
              <table bgcolor="#38BDF8" style="border-collapse:separate;background:#38BDF8;border-radius:9px;" cellpadding="0" cellspacing="0" role="presentation">
                <tr><td style="width:34px;height:34px;text-align:center;vertical-align:middle;line-height:34px;color:#ffffff;font-size:18px;font-weight:800;font-family:Georgia,serif;">&rsaquo;</td></tr>
              </table>
            </td>
            <td style="vertical-align:middle;padding-left:10px;">
              <span style="font-size:22px;font-weight:800;"><span style="color:#ffffff;">Easy</span><span style="color:#38BDF8;">Ride</span></span>
              <div style="color:#94a3b8;font-size:11px;letter-spacing:0.08em;margin-top:2px;">PREMIUM TRANSPORT · NEW PLYMOUTH, NZ</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:32px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="font-size:20px;font-weight:700;color:#0f172a;">Invoice</td>
        <td style="text-align:right;color:#64748b;font-size:13px;">${formatNzDate(booking.completedAt || booking.requestedAt)}</td>
      </tr>
      <tr><td colspan="2" style="color:#64748b;font-size:13px;padding-top:2px;">${esc(booking.bookingId)}</td></tr>
    </table>

    ${passenger?.name ? `<div style="margin-bottom:20px;"><div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Billed to</div><div style="color:#0f172a;font-size:14px;font-weight:600;">${esc(passenger.name)}</div>${passenger.address ? `<div style="color:#64748b;font-size:13px;margin-top:2px;">${esc(passenger.address)}</div>` : ''}</div>` : ''}

    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
      ${invoiceRow('Pickup', booking.pickupAddress)}
      ${stopsRows}
      ${invoiceRow('Drop-off', booking.dropAddress)}
      ${invoiceRow('Distance', `${booking.distanceKm} km`)}
      ${invoiceRow('Driver', driverName)}
      ${invoiceRow('Vehicle', vLabel)}
      ${invoiceRow('Payment method', booking.paymentMethod === 'card' ? 'Card (online)' : 'Cash')}
      ${invoiceRow('Payment status', booking.paymentStatus === 'paid' ? 'Paid' : 'Unpaid')}
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:16px;">
      <tr><td colspan="2" style="border-top:2px solid #0B2942;padding-top:10px;"></td></tr>
      <tr>
        <td style="padding:4px 0;color:#64748b;font-size:13px;">Fare</td>
        <td style="padding:4px 0;color:#0f172a;font-size:13px;text-align:right;">$${fare.toFixed(2)}</td>
      </tr>
      ${booking.cardSurchargeAmount > 0 ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Online payment surcharge</td><td style="padding:4px 0;color:#0f172a;font-size:13px;text-align:right;">$${booking.cardSurchargeAmount.toFixed(2)}</td></tr>` : ''}
      <tr>
        <td style="padding:12px 0 0;color:#0f172a;font-size:16px;font-weight:700;">Total</td>
        <td style="padding:12px 0 0;color:#0EA5E9;font-size:16px;font-weight:700;text-align:right;">$${total.toFixed(2)}</td>
      </tr>
    </table>

    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;">
      <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">EasyRide</div>
      ${settings.adminEmail ? `<div>Email: <a href="mailto:${esc(settings.adminEmail)}" style="color:#0EA5E9;text-decoration:none;">${esc(settings.adminEmail)}</a></div>` : ''}
      ${settings.adminMobile ? `<div>Phone: ${esc(settings.adminMobile)}</div>` : ''}
      <div style="margin-top:8px;">Thanks for riding with EasyRide.${forPrint ? '' : ' Questions about this invoice? Just reply to this email.'}</div>
    </div>
  </div>
</div>`.trim();
}

// A complete, self-contained page around the same invoice HTML the email
// uses, for the "View receipt" button (see routes/booking.js GET
// /:id/receipt). Its primary action is a generated PDF (services/
// invoicePdf.js) rather than the browser's print dialog: window.print()
// is a no-op on most phones - always inside the installed PWA, and even
// in the in-app browser view it opens links in - and phones are where
// receipts actually get asked for. The Print button stays as a desktop
// convenience; print-color-adjust:exact keeps the navy header band there
// (browsers strip background colours when printing unless told not to).
function buildReceiptPage(booking, passenger, driver, driverName, pdfUrl) {
  const invoice = buildInvoiceHtml(booking, passenger, driver, driverName, { forPrint: true });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${esc(booking.bookingId)} - EasyRide</title>
<style>
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .toolbar { display: flex; gap: 10px; justify-content: center; padding: 16px; }
  .toolbar a, .toolbar button { font: inherit; font-weight: 600; padding: 10px 18px; border: none; border-radius: 6px; background: #0EA5E9; color: #fff; cursor: pointer; text-decoration: none; }
  .toolbar .secondary { background: #e2e8f0; color: #1e293b; }
  @media (max-width: 640px) { .toolbar .secondary { display: none; } }
  .sheet { padding: 0 16px 32px; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .sheet { padding: 0; }
  }
  @page { margin: 15mm; }
</style>
</head>
<body>
  <div class="toolbar">
    <a href="${esc(pdfUrl)}">Download PDF</a>
    <button type="button" class="secondary" onclick="window.print()">Print</button>
  </div>
  <div class="sheet">${invoice}</div>
</body>
</html>`;
}

// Plain-text fallback - shown by the console mock (no SMTP configured) and
// included alongside the HTML for mail clients that prefer/require text.
function buildInvoiceText(booking, passenger, driver, driverName) {
  const settings = getSettings();
  const fare = booking.actualFare ?? booking.estimatedFare;
  const total = fare + (booking.cardSurchargeAmount || 0);
  const vLabel = vehicleLabel(driver);
  return `Invoice for trip ${booking.bookingId}\n` +
    `${passenger?.name ? `Billed to: ${passenger.name}${passenger.address ? `, ${passenger.address}` : ''}\n` : ''}` +
    `Pickup: ${booking.pickupAddress}\nDrop-off: ${booking.dropAddress}\nDistance: ${booking.distanceKm} km\n` +
    `${driverName ? `Driver: ${driverName}\n` : ''}${vLabel ? `Vehicle: ${vLabel}\n` : ''}` +
    `Payment: ${booking.paymentMethod === 'card' ? 'Card (online)' : 'Cash'}, ${booking.paymentStatus === 'paid' ? 'paid' : 'unpaid'}\n` +
    `Fare: $${fare.toFixed(2)}${booking.cardSurchargeAmount > 0 ? `\nOnline payment surcharge: $${booking.cardSurchargeAmount.toFixed(2)}` : ''}\n` +
    `Total: $${total.toFixed(2)}\n\n` +
    `EasyRide${settings.adminEmail ? ` - ${settings.adminEmail}` : ''}${settings.adminMobile ? ` - ${settings.adminMobile}` : ''}`;
}

const emailService = {
  sendVerificationEmail: (to, name) =>
    send(to, 'Welcome to EasyRide - verify your email', `Hi ${name}, welcome to EasyRide! Your account is ready to use.`),

  sendDriverApplicationReceived: (to, name) =>
    send(to, 'Your EasyRide driver application was received', `Hi ${name}, thanks for applying to drive with EasyRide. Your documents (license, TSL, CoF, vehicle registration) are being reviewed by an admin - you'll be notified once your account is approved and you can start accepting trips.`),

  sendDriverApproved: (to, name) =>
    send(to, 'You are approved to drive on EasyRide', `Hi ${name}, your driver account has been approved. Log in, go online, and you can start receiving trip requests.`),

  sendBookingConfirmation: (to, booking, driver, driverName) =>
    send(to, `Booking confirmed (${booking.bookingId})`, `Your ride from ${booking.pickupAddress} to ${booking.dropAddress} has been requested. Estimated fare: $${booking.estimatedFare}.${driverLine(driver, driverName)}`),

  sendDriverBookingAlert: (to, booking) =>
    send(to, `New ride request (${booking.bookingId})`, `New booking from ${booking.pickupAddress} to ${booking.dropAddress}. You have 30 seconds to accept in-app.\nOpen the app: ${appUrl()}`),

  // A QR-scan direct hail is auto-accepted (see routes/booking.js) - no
  // accept/decline step, so the driver is told it's already theirs
  // rather than asked to respond.
  sendDriverTripAssigned: (to, booking) =>
    send(to, `New confirmed trip (${booking.bookingId})`, `A passenger scanned your QR code and booked you directly - already confirmed, head to ${booking.pickupAddress} for pickup.\nOpen the app: ${appUrl()}`),

  sendBookingAccepted: (to, booking, driver, driverName) =>
    send(to, `Driver accepted your ride (${booking.bookingId})`, `Your driver has accepted booking ${booking.bookingId} and is on the way.${driverLine(driver, driverName)}`),

  sendBookingConfirmedDirect: (to, booking, driver, driverName) =>
    send(to, `Your ride is confirmed (${booking.bookingId})`, `Your ride from ${booking.pickupAddress} to ${booking.dropAddress} is confirmed - the driver has been notified. Estimated fare: $${booking.estimatedFare}.${driverLine(driver, driverName)}`),

  // Sent automatically the moment a driver marks a trip complete (see
  // routes/booking.js PUT /:id/complete) - this is the passenger's
  // receipt. passenger is {name, address} - address is included in
  // "Billed to" when set. pdf is the buildInvoicePdf() Buffer, attached
  // so the passenger has a file to keep/forward, not just the inline HTML.
  sendInvoiceEmail: (to, booking, passenger, driver, driverName, pdf) =>
    send(
      to,
      `Invoice - trip ${booking.bookingId}`,
      buildInvoiceText(booking, passenger, driver, driverName),
      pdf && [{ filename: `EasyRide-invoice-${booking.bookingId}.pdf`, content: pdf, contentType: 'application/pdf' }],
      buildInvoiceHtml(booking, passenger, driver, driverName),
    ),

  sendBookingCancelledByDriver: (to, booking, reason) =>
    send(to, `Your driver cancelled trip ${booking.bookingId}`,
      `Your trip from ${booking.pickupAddress} to ${booking.dropAddress} was cancelled by the driver.` +
      `${reason ? `\nReason: ${reason}` : ''}\nPlease rebook in the app when you're ready.`),

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
    send(to, `Reminder: trip ${whenLabel} (${booking.bookingId})`, `Your trip from ${booking.pickupAddress} to ${booking.dropAddress} is scheduled for ${formatNzDateTime(booking.scheduledFor)}.`),

  // utils/backup.js's weekly/monthly data export - three CSV attachments
  // (passengers, trips, complaints) to whatever the admin has set as
  // adminEmail.
  sendBackupEmail: (to, counts, attachments) =>
    send(
      to,
      `EasyRide data backup - ${formatNzDate(new Date())}`,
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

module.exports = { emailService, buildReceiptPage };
