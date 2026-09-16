const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const User = require('../models/User');
const { auth, roleMiddleware } = require('../middleware/auth');
const { emailService } = require('../services/emailService');
const { haversineKm, calculateFare } = require('../utils/distance');

function emitToUser(req, userId, event, payload) {
  const io = req.app.get('io');
  if (io) io.to(String(userId)).emit(event, payload);
}

// Resolves who a booking/quote should go to: the requested driver if
// they're still approved, otherwise falls back to any available approved
// driver (same as a QR code for a driver who's since been rejected or
// deactivated - the passenger still gets a ride, just not that specific
// driver). requestedUnavailable/requestedName let the caller show a
// warning; a null driver with requestedUnavailable true means the
// fallback itself came up empty ("no drivers available").
async function resolveDriver(driverId) {
  let requestedUnavailable = false;
  let requestedName = null;

  if (driverId) {
    const requested = await Driver.findById(driverId).populate('userId', 'name');
    if (requested && requested.status === 'approved') {
      return { driver: requested, usedFallback: false, requestedUnavailable: false, requestedName: null };
    }
    if (requested) {
      requestedUnavailable = true;
      requestedName = requested.userId?.name || null;
    }
  }

  const available = await Driver.find({ isAvailable: true, status: 'approved' });
  return { driver: available[0] || null, usedFallback: !!driverId, requestedUnavailable, requestedName };
}

function noDriverError(requestedUnavailable, requestedName) {
  return requestedUnavailable
    ? `${requestedName || 'That driver'} isn't currently active, and no other drivers are available right now. Please try again shortly.`
    : 'No drivers are available right now. Please try again shortly.';
}

// GET /api/booking/driver-preview/:id - unauthenticated, minimal driver info
// for the QR landing page shown before a scanning passenger has signed in.
router.get('/driver-preview/:id', async (req, res) => {
  const driver = await Driver.findById(req.params.id).populate('userId', 'name');
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  res.json({ available: driver.status === 'approved', name: driver.userId?.name, vehicleType: driver.vehicleType, rating: driver.rating });
});

// GET /api/booking/driver-info/:id - basic public-facing details for the QR
// scan-to-book flow (passenger sees who they're booking before confirming).
// available:false (driver exists but isn't approved) is not a 404 - the
// frontend uses it to show a warning and fall back to auto-matching.
router.get('/driver-info/:id', auth, roleMiddleware(['passenger']), async (req, res) => {
  const driver = await Driver.findById(req.params.id).populate('userId', 'name');
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (driver.status !== 'approved') {
    return res.json({ available: false, requestedName: driver.userId?.name, vehicleType: driver.vehicleType, vehicleNumber: driver.vehicleNumber });
  }
  res.json({
    available: true,
    _id: driver._id,
    name: driver.userId?.name,
    vehicleType: driver.vehicleType,
    vehicleNumber: driver.vehicleNumber,
    ratePerKm: driver.ratePerKm,
    rating: driver.rating,
  });
});

// POST /api/booking/quote - preview distance/fare before confirming, so the
// UI can show "Estimated fare: $X - Confirm booking?" without creating a
// booking yet. Uses the same fare math and driver-fallback as POST / below.
router.post('/quote', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    const { pickupLat, pickupLng, dropLat, dropLng, driverId } = req.body;
    if (pickupLat == null || pickupLng == null || dropLat == null || dropLng == null) {
      return res.status(400).json({ error: 'pickup and drop coordinates are required' });
    }

    const { driver, usedFallback, requestedUnavailable, requestedName } = await resolveDriver(driverId);
    if (!driver) return res.status(404).json({ error: noDriverError(requestedUnavailable, requestedName), requestedUnavailable });

    const distanceKm = Math.round(haversineKm(pickupLat, pickupLng, dropLat, dropLng) * 100) / 100;
    const estimatedFare = calculateFare(distanceKm, driver.ratePerKm);
    res.json({ distanceKm, estimatedFare, usedFallback, requestedUnavailable, requestedName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/booking - passenger requests a ride (omit driverId to auto-match
// any available driver; pass driverId to hail a specific driver, e.g. via
// their QR code - that request goes through even if they haven't toggled
// "available", same as flagging a cab in person). If the requested driver
// is no longer approved, falls back to any available driver instead of
// failing outright - see resolveDriver above.
router.post('/', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    const { pickupAddress, pickupLat, pickupLng, dropAddress, dropLat, dropLng, driverId } = req.body;
    if (!pickupAddress || !dropAddress || pickupLat == null || dropLat == null) {
      return res.status(400).json({ error: 'pickupAddress, dropAddress and lat/lng for both are required' });
    }

    const requestingPassenger = await User.findById(req.user.id);
    if (requestingPassenger?.bookingBlocked) {
      return res.status(403).json({ error: 'Your account is restricted from making new bookings. Contact support.' });
    }

    const { driver, usedFallback, requestedUnavailable, requestedName } = await resolveDriver(driverId);
    if (!driver) return res.status(404).json({ error: noDriverError(requestedUnavailable, requestedName), requestedUnavailable });

    const distanceKm = Math.round(haversineKm(pickupLat, pickupLng, dropLat, dropLng) * 100) / 100;
    const estimatedFare = calculateFare(distanceKm, driver.ratePerKm);

    const booking = await Booking.create({
      passengerId: req.user.id,
      driverId: driver._id,
      pickupAddress,
      pickupLat,
      pickupLng,
      dropAddress,
      dropLat,
      dropLng,
      distanceKm,
      estimatedFare,
      status: 'pending',
      paymentStatus: 'unpaid',
      requestedAt: new Date(),
    });

    const passenger = await User.findById(req.user.id);
    const driverUser = await User.findById(driver.userId);
    await emailService.sendBookingConfirmation(passenger.email, booking);
    if (driverUser) await emailService.sendDriverBookingAlert(driverUser.email, booking);

    emitToUser(req, driver.userId, 'booking:new', booking);

    res.status(201).json({ ...booking, usedFallback, requestedUnavailable, requestedName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/booking/mine - passenger's own bookings
router.get('/mine', auth, roleMiddleware(['passenger']), async (req, res) => {
  const bookings = await Booking.find({ passengerId: req.user.id })
    .populate('driverId')
    .sort({ createdAt: -1 });
  res.json(bookings);
});

// GET /api/booking/driver - bookings assigned to the logged-in driver
router.get('/driver', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const bookings = await Booking.find({ driverId: driver._id })
    .populate('passengerId', 'name mobile')
    .sort({ createdAt: -1 });
  res.json(bookings);
});

// PUT /api/booking/:id/accept - driver accepts within the 30s window
router.put('/:id/accept', auth, roleMiddleware(['driver']), async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status !== 'pending') return res.status(400).json({ error: `Booking already ${booking.status}` });

  const updated = await Booking.findByIdAndUpdate(req.params.id, { status: 'accepted', acceptedAt: new Date() });
  const passenger = await User.findById(booking.passengerId);
  await emailService.sendBookingAccepted(passenger.email, updated);
  emitToUser(req, booking.passengerId, 'booking:accepted', updated);
  res.json(updated);
});

// PUT /api/booking/:id/start
router.put('/:id/start', auth, roleMiddleware(['driver']), async (req, res) => {
  const updated = await Booking.findByIdAndUpdate(req.params.id, { status: 'in-progress' });
  emitToUser(req, updated.passengerId, 'booking:started', updated);
  res.json(updated);
});

// PUT /api/booking/:id/complete - driver enters the actual fare charged
router.put('/:id/complete', auth, roleMiddleware(['driver']), async (req, res) => {
  const { actualFare } = req.body;
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const updated = await Booking.findByIdAndUpdate(req.params.id, {
    status: 'completed',
    actualFare: actualFare || booking.estimatedFare,
    completedAt: new Date(),
  });

  const driver = await Driver.findById(booking.driverId);
  await Driver.findByIdAndUpdate(driver._id, {
    totalTrips: (driver.totalTrips || 0) + 1,
    totalEarnings: (driver.totalEarnings || 0) + updated.actualFare,
  });

  const passenger = await User.findById(booking.passengerId);
  await emailService.sendBookingCompleted(passenger.email, updated);
  emitToUser(req, booking.passengerId, 'booking:completed', updated);
  res.json(updated);
});

// PUT /api/booking/:id/cancel
router.put('/:id/cancel', auth, roleMiddleware(['passenger', 'driver']), async (req, res) => {
  const { reason } = req.body;
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (['completed', 'cancelled'].includes(booking.status)) {
    return res.status(400).json({ error: `Booking already ${booking.status}` });
  }
  const updated = await Booking.findByIdAndUpdate(req.params.id, {
    status: 'cancelled',
    cancelledAt: new Date(),
    cancelReason: reason || 'No reason given',
  });
  const notifyId = req.user.role === 'passenger' ? booking.driverId : booking.passengerId;
  emitToUser(req, notifyId, 'booking:cancelled', updated);
  res.json(updated);
});

// PUT /api/booking/:id/rate - passenger rates a completed trip
router.put('/:id/rate', auth, roleMiddleware(['passenger']), async (req, res) => {
  const { rating, review } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating must be 1-5' });
  const updated = await Booking.findByIdAndUpdate(req.params.id, { rating, review });
  res.json(updated);
});

module.exports = router;
