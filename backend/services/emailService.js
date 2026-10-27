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

// "14 Oct 2026, 9:30 am" for a scheduled trip, else as soon as possible.
const pickupTimeText = (b) => (b.scheduledFor ? formatNzDateTime(b.scheduledFor) : 'As soon as possible');

// "Card (online)" vs a card the driver took in person (EFTPOS / another
// app - paidVia 'card-in-person', see routes/booking.js) vs cash.
const paymentLabel = (b) => (b.paidVia === 'card-in-person' ? 'Card (EFTPOS / in person)' : b.paymentMethod === 'card' ? 'Card (online)' : 'Cash');
const { hasRealEmail } = require('../utils/users');
const { siteUrl, siteLabel } = require('../utils/siteUrl');

const resolve4 = promisify(dns.resolve4);
// Trim whitespace and strip wrapping quotes: a key pasted into a hosting
// dashboard with a trailing space or as "xkeysib-..." is byte-for-byte
// different from the real key, and Brevo answers with a bare "401 Key not
// found" - identical to the error for a genuinely wrong key, which is why
// this was so hard to spot from the logs alone.
const BREVO_API_KEY = (process.env.BREVO_API_KEY || '').trim().replace(/^["']|["']$/g, '');
const brevoConfigured = !!BREVO_API_KEY;
const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
const BREVO_HEADERS = { 'api-key': BREVO_API_KEY, accept: 'application/json' };

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
    headers: { ...BREVO_HEADERS, 'content-type': 'application/json' },
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
  if (!res.ok) throw new Error(await brevoError(res));
}

// Turns a failed Brevo response into a message that says what to actually
// do. Brevo's own text for a rejected key is just "Key not found", which
// reads like a missing env var when the far more common cause is the
// *SMTP* key (Brevo > SMTP & API > "SMTP" tab) having been pasted where the
// *API* key (the "API Keys" tab, starts with xkeysib-) belongs.
async function brevoError(res) {
  const body = await res.json().catch(() => ({}));
  let msg = `Brevo ${res.status}: ${body.message || body.code || res.statusText}`;
  if (res.status === 401 && /unrecognised IP|authorised_ips/i.test(msg)) {
    // The key is fine - Brevo's optional "Authorised IPs" allow-list is on
    // and this host isn't in it. Hosts like Render don't have one fixed
    // egress IP, so turning the restriction off is the reliable fix.
    msg += ' - the key is valid but Brevo\'s "Authorised IPs" restriction is blocking this server: turn it off at https://app.brevo.com/security/authorised_ips (or add this host\'s outbound IPs there)';
  } else if (res.status === 401) {
    msg += BREVO_API_KEY.startsWith('xkeysib-')
      ? ' - BREVO_API_KEY is not recognised by Brevo (deleted/regenerated, or a character got lost when pasting). Generate a new key under Brevo > SMTP & API > API Keys and update the env var'
      : ' - BREVO_API_KEY must be an API key from Brevo > SMTP & API > "API Keys" (starts with xkeysib-), not the SMTP password from the "SMTP" tab';
  }
  return msg;
}

// Called once at startup (server.js). Checks the key against Brevo's
// account endpoint and that the From address is a verified sender, so a
// bad deploy config shows up in the deploy log the moment the service
// boots - not hours later as a silent "failed" line on the first real
// booking. Never throws: email being down must not stop the API serving.
const status = { provider: brevoConfigured ? 'brevo' : smtpConfigured ? 'smtp' : 'mock', verified: null, error: null };
async function verifyEmailConfig() {
  if (!brevoConfigured) {
    console.log(`[email] provider: ${status.provider}${status.provider === 'mock' ? ' (set BREVO_API_KEY to send real mail)' : ''}`);
    return status;
  }
  const from = process.env.EMAIL_FROM || getSettings().adminEmail;
  try {
    const res = await fetch('https://api.brevo.com/v3/account', { headers: BREVO_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(await brevoError(res));
    const account = await res.json();
    status.verified = true;
    console.log(`[email] provider: brevo - key OK (account ${account.email}), sending as ${from}`);

    const senders = await fetch('https://api.brevo.com/v3/senders', { headers: BREVO_HEADERS, signal: AbortSignal.timeout(10000) });
    if (senders.ok) {
      const list = (await senders.json()).senders || [];
      const match = list.find((s) => s.email?.toLowerCase() === String(from).toLowerCase());
      if (!match) console.warn(`[email] WARNING: ${from} is not a sender on this Brevo account - add and verify it under Brevo > Senders, or set EMAIL_FROM to one of: ${list.map((s) => s.email).join(', ') || '(none yet)'}`);
      else if (!match.active) console.warn(`[email] WARNING: sender ${from} exists on Brevo but is not verified yet - sends will be rejected until it is`);
    }
  } catch (err) {
    status.verified = false;
    status.error = err.message;
    console.error(`[email] provider: brevo - key check FAILED: ${err.message}`);
  }
  return status;
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
  // Passengers registered without an email carry a generated placeholder
  // (utils/users.js) so the unique-email login model still holds - it is
  // not a mailbox. Dropping those here, once, keeps every caller simple
  // and stops the provider bouncing them against our sending reputation.
  if (!hasRealEmail({ email: to })) {
    console.log(`[email] skipped "${subject}" - ${to || '(no address)'} is not a real mailbox`);
    return { ok: false, error: 'Recipient has no email address' };
  }

  // Every email ends with the website address - added here once rather
  // than in each template. Skipped where a template already shows it
  // (the invoice's own footer).
  const site = siteLabel();
  if (text) text = `${text}\n\n--\nEasyRide · ${site}`;
  if (html && !html.includes(`>${esc(site)}</a>`)) {
    html = `${html}\n<p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#64748b;font-size:12px;text-align:center;margin-top:24px;">EasyRide · <a href="${esc(siteUrl())}" style="color:#0EA5E9;text-decoration:none;">${esc(site)}</a></p>`;
  }

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
      console.log(`[email] sent to ${to} via Brevo: ${subject}`);
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
        console.log(`[email] sent to ${to} via SMTP port ${port}: ${subject}`);
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

// "Log in to view" is useless without saying where - every complaint
// email ends with the deep link to the right list for that recipient.
function complaintLink(path) {
  return `

View it here: ${appUrl(path)}`;
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
            <td style="width:44px;vertical-align:middle;">
              <!-- The exact site car-logo asset; when external images are blocked,
                   the adjacent EasyRide wordmark still identifies the sender. -->
              <img src="${esc(siteUrl())}/favicon.svg" alt="EasyRide" width="40" height="40" style="display:block;width:40px;height:40px;border:0;" />
            </td>
            <td style="vertical-align:middle;padding-left:10px;">
              <span style="font-size:22px;font-weight:800;"><span style="color:#ffffff;">Easy</span><span style="color:#FFCA28;">Ride</span></span>
              <div style="color:#94a3b8;font-size:11px;letter-spacing:0.08em;margin-top:2px;">TAXI & PRIVATE TRANSFERS</div>
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
      ${invoiceRow('Payment method', paymentLabel(booking))}
      ${invoiceRow('Payment status', booking.paymentStatus === 'paid' ? 'Paid' : 'Unpaid')}
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:16px;">
      <tr><td colspan="2" style="border-top:2px solid #0B2942;padding-top:10px;"></td></tr>
      <tr>
        <td style="padding:4px 0;color:#64748b;font-size:13px;">Fare</td>
        <td style="padding:4px 0;color:#0f172a;font-size:13px;text-align:right;">$${fare.toFixed(2)}</td>
      </tr>
      ${booking.cardSurchargeAmount > 0 ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Card fee</td><td style="padding:4px 0;color:#0f172a;font-size:13px;text-align:right;">$${booking.cardSurchargeAmount.toFixed(2)}</td></tr>` : ''}
      <tr>
        <td style="padding:12px 0 0;color:#0f172a;font-size:16px;font-weight:700;">Total</td>
        <td style="padding:12px 0 0;color:#0EA5E9;font-size:16px;font-weight:700;text-align:right;">$${total.toFixed(2)}</td>
      </tr>
    </table>

    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;">
      <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">EasyRide</div>
      ${settings.adminEmail ? `<div>Email: <a href="mailto:${esc(settings.adminEmail)}" style="color:#0EA5E9;text-decoration:none;">${esc(settings.adminEmail)}</a></div>` : ''}
      ${settings.adminMobile ? `<div>Phone: ${esc(settings.adminMobile)}</div>` : ''}
      ${siteUrl() ? `<div>Website: <a href="${esc(siteUrl())}" style="color:#0EA5E9;text-decoration:none;">${esc(siteLabel())}</a></div>` : ''}
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
// Trip facts shared by the driver alert email and the respond page.
function tripRows(booking) {
  return [
    ['Pickup', booking.pickupAddress],
    ...(booking.stops || []).map((s, i) => [`Stop ${i + 1}`, s.address]),
    ['Drop-off', booking.dropAddress],
    ['When', booking.scheduledFor ? formatNzDateTime(booking.scheduledFor) : 'Now'],
    ['Distance', `${booking.distanceKm} km`],
    ['Fare', `${booking.estimatedFare}`],
    ['Payment', paymentLabel(booking)],
  ].map(([label, value]) => invoiceRow(label, value)).join('');
}

const BTN = 'display:inline-block;padding:13px 26px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;';

function buildDriverAlertHtml(booking, respond) {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;">
  <table width="100%" bgcolor="#0B2942" style="width:100%;border-collapse:separate;background:#0B2942;border-radius:10px 10px 0 0;" cellpadding="0" cellspacing="0" role="presentation">
    <tr><td style="padding:20px 28px;color:#ffffff;font-size:20px;font-weight:800;">New ride request</td></tr>
  </table>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:24px 28px;">
    <div style="color:#64748b;font-size:13px;margin-bottom:12px;">${esc(booking.bookingId)}</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">${tripRows(booking)}</table>
    <table cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td style="padding-right:10px;"><a href="${esc(respond.acceptUrl)}" style="${BTN}background:#16a34a;color:#ffffff;">Accept trip</a></td>
      <td><a href="${esc(respond.declineUrl)}" style="${BTN}background:#e2e8f0;color:#1e293b;">Decline</a></td>
    </tr></table>
    <p style="color:#64748b;font-size:12px;margin-top:20px;line-height:1.6;">Each button opens a page to confirm your answer. These links are only for you and stop working after 2 days or once the trip is taken. You can also respond in the app: <a href="${esc(appUrl())}" style="color:#0EA5E9;">${esc(appUrl())}</a></p>
  </div>
</div>`.trim();
}

// GET /api/booking/:id/respond - the confirm step behind the email
// buttons. Both actions are offered so a mis-tap in the email isn't
// final; the one the driver clicked is shown first.
function buildRespondPage(booking, action, token) {
  const primary = action === 'decline' ? 'decline' : 'accept';
  const button = (a, style) => `<form method="post" style="display:inline"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="action" value="${a}"><button type="submit" style="${BTN}border:none;cursor:pointer;${style}">${a === 'accept' ? 'Accept trip' : 'Decline trip'}</button></form>`;
  return pageShell(`Respond to trip ${esc(booking.bookingId)}`, `
    <h1 style="font-size:20px;margin:0 0 4px;">${primary === 'accept' ? 'Accept this trip?' : 'Decline this trip?'}</h1>
    <div style="color:#64748b;font-size:13px;margin-bottom:14px;">${esc(booking.bookingId)}</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">${tripRows(booking)}</table>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${primary === 'accept' ? button('accept', 'background:#16a34a;color:#fff;') + button('decline', 'background:#e2e8f0;color:#1e293b;') : button('decline', 'background:#dc2626;color:#fff;') + button('accept', 'background:#e2e8f0;color:#1e293b;')}
    </div>`);
}

function buildRespondResultPage(title, message, ok) {
  return pageShell(title, `
    <h1 style="font-size:20px;margin:0 0 8px;color:${ok ? '#16a34a' : '#dc2626'};">${esc(title)}</h1>
    <p style="color:#334155;line-height:1.6;margin:0 0 20px;">${esc(message)}</p>
    <a href="${esc(appUrl())}" style="${BTN}background:#0EA5E9;color:#fff;">Open the app</a>`);
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} - EasyRide</title>
<style>body{margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a}.card{max-width:520px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px}.brand{max-width:520px;margin:20px auto 0;padding:0 4px;font-weight:800;font-size:18px;color:#0B2942}.brand span{color:#0EA5E9}</style>
</head><body><div class="brand">Easy<span>Ride</span></div><div class="card">${body}</div></body></html>`;
}

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
    `Payment: ${paymentLabel(booking)}, ${booking.paymentStatus === 'paid' ? 'paid' : 'unpaid'}\n` +
    `Fare: $${fare.toFixed(2)}${booking.cardSurchargeAmount > 0 ? `\nCard fee: $${booking.cardSurchargeAmount.toFixed(2)}` : ''}\n` +
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

  // Deliberately NOT "confirmed": at this point the request has only been
  // sent out, and a separate email follows when a driver actually accepts
  // (sendBookingAccepted) - calling this one "confirmed" had passengers
  // expecting a car that nobody had agreed to yet.
  sendBookingConfirmation: (to, booking, driver, driverName) =>
    send(to, `Ride requested - waiting for a driver (${booking.bookingId})`,
      `We've sent your request for ${booking.pickupAddress} to ${booking.dropAddress}. Estimated fare: $${booking.estimatedFare}.`
      + `${driverLine(driver, driverName)}`
      + `

You'll get another email as soon as a driver accepts. Track it here: ${appUrl('/passenger')}`),

  // respond is { acceptUrl, declineUrl } - signed, single-driver links to
  // GET /api/booking/:id/respond (see routes/booking.js), so a driver can
  // answer straight from the email without logging in first. Each link
  // opens a confirm page rather than acting on the click itself, because
  // mail clients and link scanners pre-fetch URLs in emails.
  sendDriverBookingAlert: (to, booking, respond) =>
    send(
      to,
      `New ride request (${booking.bookingId})`,
      `New booking from ${booking.pickupAddress} to ${booking.dropAddress}${booking.scheduledFor ? ` scheduled for ${formatNzDateTime(booking.scheduledFor)}` : ''}. Fare: ${booking.estimatedFare}.\n` +
        `Accept: ${respond.acceptUrl}\nDecline: ${respond.declineUrl}\nOr open the app: ${appUrl()}`,
      undefined,
      buildDriverAlertHtml(booking, respond),
    ),

  // A QR-scan direct hail is auto-accepted (see routes/booking.js) - no
  // accept/decline step, so the driver is told it's already theirs
  // rather than asked to respond.
  sendDriverTripAssigned: (to, booking) =>
    send(to, `New confirmed trip (${booking.bookingId})`, `A passenger scanned your QR code and booked you directly - already confirmed, head to ${booking.pickupAddress} for pickup.\nOpen the app: ${appUrl()}`),

  // A scheduled trip says when; a "now" trip that the driver is on the way.
  sendBookingAccepted: (to, booking, driver, driverName) =>
    send(to, `Driver accepted your ride (${booking.bookingId})`,
      `Your driver has accepted booking ${booking.bookingId}${booking.scheduledFor ? '' : ' and is on the way'}.\n`
      + `Pickup time: ${pickupTimeText(booking)}\n`
      + `Pickup: ${booking.pickupAddress}\nDrop-off: ${booking.dropAddress}\n`
      + `Estimated fare: $${Number(booking.estimatedFare).toFixed(2)}`
      + `${driverLine(driver, driverName)}`),

  sendBookingConfirmedDirect: (to, booking, driver, driverName) =>
    send(to, `Your ride is confirmed (${booking.bookingId})`, `Your ride from ${booking.pickupAddress} to ${booking.dropAddress} is confirmed - the driver has been notified.\nPickup time: ${pickupTimeText(booking)}\nEstimated fare: $${Number(booking.estimatedFare).toFixed(2)}.${driverLine(driver, driverName)}`),

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

  // Sent ahead of the trip when a same-day return-trip discount starts or
  // stops applying to an already-booked trip (see utils/discounts.js).
  // Subject and message are worded by utils/discounts.js fareChangeWording().
  sendFareChanged: (to, subject, message) =>
    send(to, subject, `${message}\nOpen the app: ${appUrl('/passenger')}`),

  // The driver changed a trip before it started (routes/booking.js
  // PUT /:id/driver-edit) - new route/time/fare for the passenger.
  sendTripChangedByDriver: (to, booking, oldFare) =>
    send(to, `Your trip ${booking.bookingId} has been updated by your driver`,
      `Your driver has updated your trip:\n` +
      `Pickup: ${booking.pickupAddress}\n` +
      `${(booking.stops || []).map((s, i) => `Stop ${i + 1}: ${s.address}\n`).join('')}` +
      `Drop-off: ${booking.dropAddress}\n` +
      `When: ${booking.scheduledFor ? formatNzDateTime(booking.scheduledFor) : 'Now'}\n` +
      `Estimated fare: $${Number(booking.estimatedFare).toFixed(2)}${oldFare != null && oldFare !== booking.estimatedFare ? ` (was $${Number(oldFare).toFixed(2)})` : ''}\n` +
      `Payment: ${booking.paymentMethod === 'card' ? `pay online by card${booking.cardSurchargeAmount ? ` (+ $${Number(booking.cardSurchargeAmount).toFixed(2)} card fee)` : ''}` : 'cash to the driver'}\n` +
      `If anything looks wrong, contact your driver or reply in the app: ${appUrl('/passenger')}`),

  // A driver turned a trip request down (see routes/booking.js
  // declineBooking). Either it's gone to other drivers, or no other driver
  // can take it and the request has been closed.
  sendBookingDeclined: (to, booking, passedOn) =>
    send(to,
      passedOn ? `ACTION UPDATE: Driver declined - finding another driver (${booking.bookingId})`
        : `IMPORTANT: Your booking request was cancelled (${booking.bookingId})`,
      passedOn
        ? `IMPORTANT BOOKING UPDATE - DRIVER DECLINED\n\nYour original driver cannot take booking ${booking.bookingId}. We are checking for another available driver. Your ride is NOT confirmed until a driver accepts.\nPickup: ${booking.pickupAddress}\nDestination: ${booking.dropAddress}\n${booking.scheduledFor ? `Requested time: ${formatNzDateTime(booking.scheduledFor)}\n` : ''}We will update you when a driver confirms. Check your booking: ${appUrl('/passenger')}`
        : `IMPORTANT: BOOKING REQUEST CANCELLED\n\nYour booking ${booking.bookingId} has been cancelled because the driver declined and no other driver is currently available. Please do not rely on this booking for your travel.\nPickup: ${booking.pickupAddress}\nDestination: ${booking.dropAddress}\n${booking.scheduledFor ? `Requested time: ${formatNzDateTime(booking.scheduledFor)}\n` : ''}${booking.paymentStatus === 'paid' ? 'Payment has already been recorded. Please contact support to arrange or confirm your refund.' : 'No payment has been recorded for this booking.'}\n\nYou may submit a new booking request for a different time: ${appUrl('/passenger')}`),

  sendBookingCancelledByDriver: (to, booking, reason) =>
    send(to, `IMPORTANT: Your confirmed trip was cancelled (${booking.bookingId})`,
      `IMPORTANT: TRIP CANCELLED\n\nYour driver cancelled booking ${booking.bookingId}. Your trip is no longer confirmed. Please arrange alternative transport if needed.\nPickup: ${booking.pickupAddress}\nDestination: ${booking.dropAddress}`
      + `${reason ? `\nReason: ${reason}` : ''}\nCheck your booking: ${appUrl('/passenger')}`),

  sendComplaintAcknowledgement: (to, complaint) =>
    send(to, `Complaint received (${complaint.complaintId})`, `We've received your complaint and will investigate. Reference: ${complaint.complaintId}.${complaintLink('/passenger/complaints')}`),

  sendComplaintNotification: (to, complaint) =>
    send(to, `A complaint has been lodged (${complaint.complaintId})`, `A passenger has lodged a complaint regarding a recent trip. Please review and respond.${complaintLink('/driver/complaints')}`),

  sendAdminAlertSerious: (complaint) =>
    send(adminInbox(), `SERIOUS INCIDENT: ${complaint.complaintId}`, `A serious complaint (${complaint.complaintType}) was lodged and requires immediate review.${complaintLink('/admin/complaints')}`),

  sendDriverResponseNotification: (to, complaint) =>
    send(to, `Driver responded to your complaint (${complaint.complaintId})`, `The driver has responded to your complaint (${complaint.complaintId}).${complaintLink('/passenger/complaints')}`),

  sendComplaintResolution: (to, complaint) =>
    send(to, `Complaint resolved (${complaint.complaintId})`, `Your complaint has been ${complaint.status}. Summary: ${complaint.resolutionSummary || 'See the app for details.'}${complaintLink('/passenger/complaints')}`),

  sendComplaintStatusChanged: (to, complaint) =>
    send(to, `Complaint update (${complaint.complaintId})`, `Your complaint is now marked "${complaint.status}".${complaintLink('/passenger/complaints')}`),

  sendReopenedConfirmation: (to, complaint) =>
    send(to, `Complaint reopened (${complaint.complaintId})`, `We've reopened your complaint and will review it again.${complaintLink('/passenger/complaints')}`),

  sendEscalationAlert: (complaint) =>
    send(adminInbox(), `ESCALATED: ${complaint.complaintId}`, `Complaint ${complaint.complaintId} has been escalated to authorities.${complaintLink('/admin/complaints')}`),

  sendTripReminder: (to, booking, whenLabel) =>
    send(to, `Reminder: trip ${whenLabel} (${booking.bookingId})`, `Your trip from ${booking.pickupAddress} to ${booking.dropAddress} is scheduled for ${formatNzDateTime(booking.scheduledFor)}.`),

  // utils/backup.js's weekly/monthly data export - three CSV attachments
  // (passengers, trips, complaints) to whatever the admin has set as
  // adminEmail.
  sendBackupEmail: (to, counts, attachments) =>
    send(
      to,
      `EasyRide data backup - ${formatNzDate(new Date())}`,
      `Attached: ${counts.passengers} passengers, ${counts.drivers ?? 0} drivers, ${counts.bookings} trips, ${counts.complaints} complaints, ${counts.expenses ?? 0} driver expenses (CSV files).`,
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

module.exports = { emailService, buildReceiptPage, buildRespondPage, buildRespondResultPage, verifyEmailConfig, emailStatus: status };
