const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Driver = require('../models/Driver');
const Booking = require('../models/Booking');
const { auth, roleMiddleware } = require('../middleware/auth');

async function getDriverProfile(userId) {
  return Driver.findOne({ userId }).populate('userId', 'name email mobile');
}

// GET /api/driver/profile
router.get('/profile', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await getDriverProfile(req.user.id);
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  res.json(driver);
});

// PUT /api/driver/availability - toggle available for bookings
router.put('/availability', auth, roleMiddleware(['driver']), async (req, res) => {
  const { isAvailable } = req.body;
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const updated = await Driver.findByIdAndUpdate(driver._id, { isAvailable: !!isAvailable });
  res.json(updated);
});

// PUT /api/driver/rate - custom rate per km
router.put('/rate', auth, roleMiddleware(['driver']), async (req, res) => {
  const { ratePerKm } = req.body;
  if (!ratePerKm || ratePerKm <= 0) return res.status(400).json({ error: 'ratePerKm must be a positive number' });
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const updated = await Driver.findByIdAndUpdate(driver._id, { ratePerKm });
  res.json(updated);
});

// GET /api/driver/earnings
router.get('/earnings', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const trips = await Booking.find({ driverId: driver._id, status: 'completed' });
  const totalEarnings = trips.reduce((sum, t) => sum + (t.actualFare || 0), 0);
  const gst = Math.round(totalEarnings * 0.18 * 100) / 100; // 18% GST, matches prior tax-tracking spec

  res.json({
    totalTrips: trips.length,
    totalEarnings,
    estimatedGst: gst,
    netEarnings: Math.round((totalEarnings - gst) * 100) / 100,
  });
});

module.exports = router;
