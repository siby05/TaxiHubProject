const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const Driver = require('../models/Driver');
const Booking = require('../models/Booking');
const Complaint = require('../models/Complaint');
const { auth, roleMiddleware } = require('../middleware/auth');
const { emailService } = require('../services/emailService');

router.use(auth, roleMiddleware(['admin']));

function publicUser(user) {
  const { password, ...rest } = user;
  return rest;
}

// GET /api/admin/stats - dashboard summary
router.get('/stats', async (req, res) => {
  const [users, drivers, bookings, complaints] = await Promise.all([
    User.find({}),
    Driver.find({}),
    Booking.find({}),
    Complaint.find({}),
  ]);
  const completed = bookings.filter((b) => b.status === 'completed');
  res.json({
    totalPassengers: users.filter((u) => u.role === 'passenger').length,
    totalDrivers: drivers.length,
    pendingDriverApprovals: drivers.filter((d) => d.status === 'pending').length,
    totalBookings: bookings.length,
    completedTrips: completed.length,
    totalRevenue: completed.reduce((sum, b) => sum + (b.actualFare || 0), 0),
    openComplaints: complaints.filter((c) => ['open', 'investigating'].includes(c.status)).length,
    seriousComplaints: complaints.filter((c) => c.isSerious).length,
  });
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const users = await User.find({});
  res.json(users.map(publicUser));
});

// PUT /api/admin/users/:id/deactivate
router.put('/users/:id/deactivate', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: false });
  res.json(publicUser(user));
});

// PUT /api/admin/users/:id/activate
router.put('/users/:id/activate', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: true });
  res.json(publicUser(user));
});

// POST /api/admin/drivers - admin-managed driver creation (no public driver signup)
router.post('/drivers', async (req, res) => {
  try {
    const { name, email, mobile, licenseNumber, vehicleType, vehicleNumber, ratePerKm } = req.body;
    if (!name || !email || !licenseNumber || !vehicleNumber) {
      return res.status(400).json({ error: 'name, email, licenseNumber and vehicleNumber are required' });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const tempPassword = crypto.randomBytes(4).toString('hex');
    const hashed = await bcrypt.hash(tempPassword, 10);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashed,
      mobile,
      role: 'driver',
      isActive: true,
      emailVerified: true,
    });

    const driver = await Driver.create({
      userId: user._id,
      licenseNumber,
      vehicleType: vehicleType || 'Economy',
      vehicleNumber,
      ratePerKm: ratePerKm || Number(process.env.DEFAULT_RATE_PER_KM) || 1.8,
      status: 'pending',
      isAvailable: false,
      rating: 0,
      totalTrips: 0,
      totalEarnings: 0,
    });

    await emailService.sendVerificationEmail(user.email, user.name);

    res.status(201).json({ driver, temporaryPassword: tempPassword, note: 'Send this temporary password to the driver securely (SMS/WhatsApp) - not emailed for security.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/drivers
router.get('/drivers', async (req, res) => {
  const drivers = await Driver.find({}).populate('userId', 'name email mobile isActive');
  res.json(drivers);
});

// PUT /api/admin/drivers/:id/approve
router.put('/drivers/:id/approve', async (req, res) => {
  const driver = await Driver.findByIdAndUpdate(req.params.id, { status: 'approved' });
  res.json(driver);
});

// PUT /api/admin/drivers/:id/reject
router.put('/drivers/:id/reject', async (req, res) => {
  const { reason } = req.body;
  const driver = await Driver.findByIdAndUpdate(req.params.id, { status: 'rejected', rejectionReason: reason });
  res.json(driver);
});

// PUT /api/admin/drivers/:id/deactivate
router.put('/drivers/:id/deactivate', async (req, res) => {
  const driver = await Driver.findByIdAndUpdate(req.params.id, { isAvailable: false, status: 'rejected' });
  res.json(driver);
});

// PUT /api/admin/drivers/:id/rate
router.put('/drivers/:id/rate', async (req, res) => {
  const { ratePerKm } = req.body;
  const driver = await Driver.findByIdAndUpdate(req.params.id, { ratePerKm });
  res.json(driver);
});

// GET /api/admin/bookings
router.get('/bookings', async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const bookings = await Booking.find(filter)
    .populate('passengerId', 'name email')
    .populate('driverId')
    .sort({ createdAt: -1 });
  res.json(bookings);
});

module.exports = router;
