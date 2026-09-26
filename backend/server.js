require('dotenv').config();
const dns = require('dns');
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// Render (and some other hosts) have no outbound IPv6 route, but plenty of
// third-party hosts we call out to (Gmail's SMTP servers being the one
// that actually surfaced this - "connect ENETUNREACH" on every email
// send) resolve to both an IPv4 and IPv6 address. Node's default resolver
// order tries IPv6 first regardless of whether the host can actually
// route it - prefer IPv4 globally so nothing else (geocoding, Stripe,
// anything added later) hits the same failure. services/emailService.js
// also pins nodemailer's own socket to IPv4 directly, since it's the one
// place this already bit us.
dns.setDefaultResultOrder('ipv4first');

const { connectDatabase } = require('./config/database');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const passengerRoutes = require('./routes/passenger');
const driverRoutes = require('./routes/driver');
const bookingRoutes = require('./routes/booking');
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');
const complaintRoutes = require('./routes/complaints');
const geocodeRoutes = require('./routes/geocode');
const notificationRoutes = require('./routes/notifications');
const driverSignupRoutes = require('./routes/driverSignup');
const feedbackRoutes = require('./routes/feedback');
const enquiryRoutes = require('./routes/enquiry');
const cronRoutes = require('./routes/cron');
const stripeConnectRoutes = require('./routes/stripeConnect');
const { setIo } = require('./utils/notify');
const { startReminderScheduler } = require('./utils/reminders');
const { startBackupScheduler } = require('./utils/backup');
const { startRetentionScheduler } = require('./utils/retention');
const { loadSettings } = require('./config/platformSettings');
const { verifyEmailConfig, emailStatus } = require('./services/emailService');
const { signUploadsInResponses, serveSignedUpload } = require('./middleware/signedUploads');
const { checkStartupSecurity } = require('./utils/startupChecks');

// Defense in depth: a single unhandled promise rejection anywhere (a
// missed try/catch, a third-party call that throws unexpectedly) should
// never take down the whole booking platform - see the SMTP ENETUNREACH
// incident that crashed the process via an un-caught email send. Log it
// and keep serving; the specific failure still needs fixing at its source,
// but one bad request must not mean downtime for every other user.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.FRONTEND_URL || '*' } });

app.set('io', io);
setIo(io);

// Behind Render's (or any PaaS's) TLS-terminating proxy - often more than
// one hop (CDN + load balancer) - so req.protocol and req.ip must come from
// X-Forwarded-*. 'trust proxy' true takes the left-most forwarded address
// (the real visitor); with a hop count of 1 every visitor resolved to the
// CDN's own address and shared a single rate-limit bucket, which is how
// address autocomplete went dark for everyone at once.
app.set('trust proxy', true);
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Baseline hardening headers (what helmet would set, minus CSP - the API
// serves JSON plus a few self-contained HTML pages).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Personal documents: every /uploads URL in a response is signed on the
// way out and the file route only serves with a valid token - see
// middleware/signedUploads.js.
app.use(signUploadsInResponses);
app.use('/uploads', serveSignedUpload(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', dbMode: process.env.DB_MODE || 'memory', email: emailStatus }));

app.use('/api/auth', authRoutes);
app.use('/api/passenger', passengerRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/geocode', geocodeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/driver-signup', driverSignupRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/enquiry', enquiryRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/driver/stripe', stripeConnectRoutes);

app.use(notFound);
app.use(errorHandler);

// Sockets: clients connect with ?token=<jwt> and are joined to a room keyed
// by their user id (and "admins" for admin users) so routes can push
// real-time booking/complaint events with io.to(userId).emit(...).
io.on('connection', (socket) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.join(String(payload.id));
      if (payload.role === 'admin') socket.join('admins');
    }
  } catch {
    // Unauthenticated sockets simply don't get joined to any room.
  }
});

const PORT = process.env.PORT || 5000;

connectDatabase().then(async () => {
  checkStartupSecurity();
  // Memory mode always starts empty, so this reseeds fresh demo/test
  // accounts on every restart exactly as before. A real (mongo) database
  // only gets seeded once, the first time it's ever genuinely empty -
  // real data added after that is never touched again.
  const User = require('./models/User');
  if ((await User.countDocuments()) === 0) {
    await require('./utils/seed')();
  }
  // Hydrate admin-configured settings from the database before serving any
  // requests, so a real (mongo) deployment doesn't silently reset every
  // setting back to hardcoded defaults on each restart/redeploy.
  await loadSettings();
  await checkStartupSecurity.demoAccounts();
  // After loadSettings() so the admin-configured From address is known.
  // Not awaited: a slow/unreachable Brevo must not delay the API coming up.
  verifyEmailConfig();
  server.listen(PORT, () => console.log(`EasyRide API listening on http://localhost:${PORT}`));
  startReminderScheduler();
  startBackupScheduler();
  startRetentionScheduler();
}).catch((err) => {
  console.error('[startup] failed to start:', err.message);
  process.exit(1);
});
