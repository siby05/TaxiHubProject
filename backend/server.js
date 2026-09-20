require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

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
const stripeConnectRoutes = require('./routes/stripeConnect');
const { setIo } = require('./utils/notify');
const { startReminderScheduler } = require('./utils/reminders');
const { startBackupScheduler } = require('./utils/backup');

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

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', dbMode: process.env.DB_MODE || 'memory' }));

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
  // Memory mode always starts empty, so this reseeds fresh demo/test
  // accounts on every restart exactly as before. A real (mongo) database
  // only gets seeded once, the first time it's ever genuinely empty -
  // real data added after that is never touched again.
  const User = require('./models/User');
  if ((await User.countDocuments()) === 0) {
    await require('./utils/seed')();
  }
  server.listen(PORT, () => console.log(`EasyRide API listening on http://localhost:${PORT}`));
  startReminderScheduler();
  startBackupScheduler();
}).catch((err) => {
  console.error('[startup] failed to start:', err.message);
  process.exit(1);
});
