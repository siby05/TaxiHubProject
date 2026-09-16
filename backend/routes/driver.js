const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const Driver = require('../models/Driver');
const Booking = require('../models/Booking');
const { auth, roleMiddleware } = require('../middleware/auth');
const { ensureDriverQrCode } = require('../utils/qrcode');
const { getDriverBilling } = require('../utils/billing');
const { haversineKm, calculateFare } = require('../utils/distance');
const { emailService } = require('../services/emailService');

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

  if (isAvailable) {
    const billing = await getDriverBilling(driver);
    if (billing.hasOverdue) {
      return res.status(402).json({
        error: `You have overdue platform fees ($${billing.totalPending.toFixed(2)}). Settle payment with the admin to go online again.`,
        billing,
      });
    }
  }

  const updated = await Driver.findByIdAndUpdate(driver._id, { isAvailable: !!isAvailable });
  res.json(updated);
});

// PUT /api/driver/schedule - weekly availability calendar (day + time slot per day)
router.put('/schedule', auth, roleMiddleware(['driver']), async (req, res) => {
  const { schedule } = req.body;
  if (!Array.isArray(schedule) || schedule.length !== 7) {
    return res.status(400).json({ error: 'schedule must be an array of 7 entries (Sunday-Saturday)' });
  }
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const slot of schedule) {
    if (slot.dayOfWeek == null || slot.dayOfWeek < 0 || slot.dayOfWeek > 6) {
      return res.status(400).json({ error: 'each slot needs a dayOfWeek 0-6' });
    }
    if (slot.enabled && (!timePattern.test(slot.startTime) || !timePattern.test(slot.endTime))) {
      return res.status(400).json({ error: `day ${slot.dayOfWeek}: startTime/endTime must be HH:MM` });
    }
    if (slot.enabled && slot.startTime >= slot.endTime) {
      return res.status(400).json({ error: `day ${slot.dayOfWeek}: startTime must be before endTime` });
    }
  }

  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const updated = await Driver.findByIdAndUpdate(driver._id, { availabilitySchedule: schedule });
  res.json(updated);
});

// GET /api/driver/qr-code - QR that deep-links passengers to book this driver directly
router.get('/qr-code', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const updated = await ensureDriverQrCode(driver);
  res.json({ qrCodeImage: updated.qrCodeImage, qrCodeUrl: updated.qrCodeUrl });
});

// PUT /api/driver/rate - request a new rate per km; takes effect only once
// an admin approves it (see PUT /api/admin/drivers/:id/rate/approve).
router.put('/rate', auth, roleMiddleware(['driver']), async (req, res) => {
  const { ratePerKm } = req.body;
  if (!ratePerKm || ratePerKm <= 0) return res.status(400).json({ error: 'ratePerKm must be a positive number' });
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const updated = await Driver.findByIdAndUpdate(driver._id, { pendingRatePerKm: ratePerKm });
  res.json({ message: 'Rate change submitted - awaiting admin approval before it goes live.', driver: updated });
});

// GET /api/driver/billing - own weekly commission/fee ledger
router.get('/billing', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  res.json(await getDriverBilling(driver));
});

// GET /api/driver/passengers/search?q= - find an already-registered
// passenger by name/email/mobile, so a driver taking a phone/walk-up
// booking can attach it to a real verified account instead of a new one.
router.get('/passengers/search', auth, roleMiddleware(['driver']), async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const passengers = await User.find({ role: 'passenger' });
  const matches = passengers
    .filter((u) => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.mobile?.includes(q))
    .slice(0, 8)
    .map((u) => ({ _id: u._id, name: u.name, email: u.email, mobile: u.mobile }));
  res.json(matches);
});

// POST /api/driver/bookings - driver takes a booking on a passenger's
// behalf (e.g. phone/walk-up booking) and it's assigned straight to
// themself, already accepted (no separate accept step, since the driver
// is the one creating it).
//
// Pass an existing passengerId to book for an already-registered (and
// therefore already-verified) passenger. Omit it and pass
// passengerName/passengerMobile instead to register a brand-new passenger
// on the spot - that account is created without any email verification or
// login step (the driver's own auth is what authorizes the booking); if
// that person later wants to log in themselves, an admin can help them set
// a password. This only applies to genuinely new people - an existing
// mobile/email match is rejected so the driver picks the real account
// instead of creating a duplicate.
router.post('/bookings', auth, roleMiddleware(['driver']), async (req, res) => {
  try {
    const {
      passengerId, passengerName, passengerMobile, passengerEmail,
      pickupAddress, pickupLat, pickupLng, dropAddress, dropLat, dropLng, scheduledFor,
    } = req.body;

    if (!pickupAddress || !dropAddress || pickupLat == null || dropLat == null) {
      return res.status(400).json({ error: 'pickupAddress, dropAddress and lat/lng for both are required' });
    }
    if (scheduledFor && new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'scheduledFor must be a time in the future' });
    }

    const driver = await Driver.findOne({ userId: req.user.id });
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    let passenger;
    if (passengerId) {
      passenger = await User.findById(passengerId);
      if (!passenger || passenger.role !== 'passenger') return res.status(404).json({ error: 'Passenger not found' });
    } else {
      if (!passengerName || !passengerMobile) {
        return res.status(400).json({ error: 'passengerId, or passengerName + passengerMobile to register a new passenger, is required' });
      }
      const existing = await User.find({ role: 'passenger' });
      const dupe = existing.find((u) => u.mobile === passengerMobile || (passengerEmail && u.email === passengerEmail.toLowerCase()));
      if (dupe) return res.status(409).json({ error: 'A passenger with this mobile/email is already registered - search for them instead' });

      const placeholderPassword = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
      passenger = await User.create({
        name: passengerName,
        email: passengerEmail ? passengerEmail.toLowerCase() : `walkup-${crypto.randomBytes(4).toString('hex')}@no-email.taxihub.local`,
        password: placeholderPassword,
        mobile: passengerMobile,
        role: 'passenger',
        isActive: true,
        emailVerified: false,
        registeredByDriver: true,
      });
    }

    const distanceKm = Math.round(haversineKm(pickupLat, pickupLng, dropLat, dropLng) * 100) / 100;
    const estimatedFare = calculateFare(distanceKm, driver.ratePerKm);

    const booking = await Booking.create({
      passengerId: passenger._id,
      driverId: driver._id,
      pickupAddress,
      pickupLat,
      pickupLng,
      dropAddress,
      dropLat,
      dropLng,
      distanceKm,
      estimatedFare,
      status: 'accepted',
      paymentStatus: 'unpaid',
      requestedAt: new Date(),
      acceptedAt: new Date(),
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      bookedByDriver: true,
    });

    if (passenger.emailVerified) await emailService.sendBookingConfirmation(passenger.email, booking);

    res.status(201).json({ booking, passenger: { _id: passenger._id, name: passenger.name, mobile: passenger.mobile } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
