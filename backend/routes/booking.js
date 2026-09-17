const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const User = require('../models/User');
const { auth, roleMiddleware } = require('../middleware/auth');
const { emailService } = require('../services/emailService');
const { haversineKm, calculateFare } = require('../utils/distance');
const { notifyUser, notifyAdmins } = require('../utils/notify');
const { getPassengerRatingAvg } = require('../utils/ratings');
const { isWithinSchedule } = require('../utils/schedule');
const { getDriverBilling } = require('../utils/billing');

// Passengers should never see the rating a driver gave them (they can only
// see driver ratings) - strip it before sending any booking list/detail
// back to a passenger.
function hidePassengerRating(booking) {
  const { passengerRating, passengerReview, ...rest } = booking;
  return rest;
}

function emitToUser(req, userId, event, payload) {
  const io = req.app.get('io');
  if (io) io.to(String(userId)).emit(event, payload);
}

// Resolves who a booking/quote should go to: the requested driver if
// they're still approved, otherwise falls back to any available approved
// driver (same as a QR code for a driver who's since been rejected,
// deactivated, or currently outside their own declared schedule - the
// passenger still gets a ride, just not that specific driver).
// requestedUnavailable/requestedName let the caller show a warning; a null
// driver with requestedUnavailable true means the fallback itself came up
// empty ("no drivers available").
//
// A direct QR hail bypasses the ad-hoc isAvailable ("online/offline")
// toggle - same as flagging a cab in person, it goes through even if they
// forgot to switch it on. It does NOT bypass their declared weekly
// schedule: a driver who's told the system "I don't work Sundays" stays
// off Sundays regardless of how the booking reaches them.
async function resolveDriver(driverId) {
  let requestedUnavailable = false;
  let requestedName = null;

  if (driverId) {
    const requested = await Driver.findById(driverId).populate('userId', 'name');
    if (requested && requested.status === 'approved' && isWithinSchedule(requested)) {
      return { driver: requested, usedFallback: false, requestedUnavailable: false, requestedName: null };
    }
    if (requested) {
      requestedUnavailable = true;
      requestedName = requested.userId?.name || null;
    }
  }

  // Auto-match (no specific driver requested) considers drivers who are
  // both toggled online AND currently within their declared schedule.
  const candidates = await Driver.find({ isAvailable: true, status: 'approved' });
  const inSchedule = candidates.filter((d) => isWithinSchedule(d));
  return { driver: inSchedule[0] || null, usedFallback: !!driverId, requestedUnavailable, requestedName };
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
// A driver caller (booking for a passenger) always quotes against their own
// rate rather than auto-matching/falling back.
router.post('/quote', auth, roleMiddleware(['passenger', 'driver']), async (req, res) => {
  try {
    const { pickupLat, pickupLng, dropLat, dropLng, driverId } = req.body;
    if (pickupLat == null || pickupLng == null || dropLat == null || dropLng == null) {
      return res.status(400).json({ error: 'pickup and drop coordinates are required' });
    }

    let driver;
    let usedFallback = false;
    let requestedUnavailable = false;
    let requestedName = null;

    if (req.user.role === 'driver') {
      driver = await Driver.findOne({ userId: req.user.id });
      if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    } else {
      ({ driver, usedFallback, requestedUnavailable, requestedName } = await resolveDriver(driverId));
      if (!driver) return res.status(404).json({ error: noDriverError(requestedUnavailable, requestedName), requestedUnavailable });
    }

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
    const { pickupAddress, pickupLat, pickupLng, dropAddress, dropLat, dropLng, driverId, scheduledFor, paymentMethod } = req.body;
    if (!pickupAddress || !dropAddress || pickupLat == null || dropLat == null) {
      return res.status(400).json({ error: 'pickupAddress, dropAddress and lat/lng for both are required' });
    }
    if (scheduledFor && new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'scheduledFor must be a time in the future' });
    }
    if (paymentMethod && !['cash', 'card'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'paymentMethod must be "cash" or "card"' });
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
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: 'unpaid',
      requestedAt: new Date(),
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    });

    const passenger = await User.findById(req.user.id);
    const driverUser = await User.findById(driver.userId);
    await emailService.sendBookingConfirmation(passenger.email, booking);
    if (driverUser) await emailService.sendDriverBookingAlert(driverUser.email, booking);

    const passengerRatingAvg = await getPassengerRatingAvg(passenger._id);
    emitToUser(req, driver.userId, 'booking:new', { ...booking, passengerName: passenger.name, passengerRatingAvg });
    if (driverUser) {
      await notifyUser(driverUser._id, {
        type: 'booking-new',
        title: 'New ride request',
        message: `${passenger.name} (${passengerRatingAvg ? `⭐${passengerRatingAvg}` : 'no ratings yet'}) · ${booking.pickupAddress} → ${booking.dropAddress} - $${booking.estimatedFare}`,
        link: '/driver',
      });
    }

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
  res.json(bookings.map(hidePassengerRating));
});

// GET /api/booking/driver - bookings assigned to the logged-in driver.
// Defaults to the last 30 days of trip history; pass ?all=true to see
// everything (nothing is ever deleted - this is just the default view).
router.get('/driver', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const filter = { driverId: driver._id };
  if (req.query.all !== 'true') {
    filter.createdAt = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
  }

  const bookings = await Booking.find(filter)
    .populate('passengerId', 'name mobile')
    .sort({ createdAt: -1 });

  const ratingByPassenger = new Map();
  for (const b of bookings) {
    const pid = String(b.passengerId?._id);
    if (!ratingByPassenger.has(pid)) ratingByPassenger.set(pid, await getPassengerRatingAvg(pid));
  }
  res.json(bookings.map((b) => ({ ...b, passengerRatingAvg: ratingByPassenger.get(String(b.passengerId?._id)) })));
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
  await notifyUser(booking.passengerId, {
    type: 'booking-accepted',
    title: 'A driver accepted your ride',
    message: `${updated.pickupAddress} → ${updated.dropAddress}`,
    link: '/passenger',
  });

  const driver = await Driver.findById(booking.driverId).populate('userId', 'name');
  await notifyAdmins({
    type: 'driver-action',
    title: 'Driver accepted a trip',
    message: `${driver?.userId?.name || 'A driver'} accepted booking ${updated._id}`,
    link: '/admin',
  });

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
    // Cash is collected in person at trip end; card bookings only become
    // "paid" once the passenger actually pays via /api/payment.
    ...(booking.paymentMethod !== 'card' && { paymentStatus: 'paid' }),
  });

  const driver = await Driver.findById(booking.driverId);
  await Driver.findByIdAndUpdate(driver._id, {
    totalTrips: (driver.totalTrips || 0) + 1,
    totalEarnings: (driver.totalEarnings || 0) + updated.actualFare,
  });

  const passenger = await User.findById(booking.passengerId);
  await emailService.sendBookingCompleted(passenger.email, updated);
  emitToUser(req, booking.passengerId, 'booking:completed', updated);
  await notifyUser(booking.passengerId, {
    type: 'booking-completed',
    title: 'Trip completed',
    message: `Final fare: $${updated.actualFare}`,
    link: '/passenger',
  });

  const driverUser = await User.findById(driver.userId);
  await notifyAdmins({
    type: 'driver-action',
    title: 'Driver completed a trip',
    message: `${driverUser?.name || 'A driver'} completed booking ${updated._id} - $${updated.actualFare}`,
    link: '/admin',
  });

  // Completing a trip can push a per-trip-commission driver's outstanding
  // balance over their limit - take them offline immediately rather than
  // waiting for their next go-online attempt.
  const freshDriver = await Driver.findById(driver._id);
  const billing = await getDriverBilling(freshDriver);
  if (billing.overLimit && freshDriver.isAvailable) {
    await Driver.findByIdAndUpdate(driver._id, { isAvailable: false });
    if (driverUser) {
      await notifyUser(driverUser._id, {
        type: 'driver-disabled',
        title: 'You have been taken offline',
        message: `Outstanding fees ($${billing.totalPending.toFixed(2)}) are over the $${billing.feeLimit} limit. Pay the balance or contact admin to go online again.`,
        link: '/driver/billing',
      });
    }
    await notifyAdmins({
      type: 'driver-disabled',
      title: 'Driver auto-disabled (fee limit)',
      message: `${driverUser?.name || 'A driver'} exceeded their $${billing.feeLimit} outstanding fee limit ($${billing.totalPending.toFixed(2)} owed) and was taken offline`,
      link: `/admin/drivers/${driver._id}/report`,
    });
  }

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
  await notifyUser(notifyId, {
    type: 'booking-cancelled',
    title: 'A booking was cancelled',
    message: `${updated.pickupAddress} → ${updated.dropAddress}${reason ? ` - ${reason}` : ''}`,
    link: req.user.role === 'passenger' ? '/driver' : '/passenger',
  });

  if (req.user.role === 'driver') {
    const driverUser = await User.findById(req.user.id);
    await notifyAdmins({
      type: 'driver-action',
      title: 'Driver cancelled a trip',
      message: `${driverUser?.name || 'A driver'} cancelled booking ${updated._id}${reason ? ` - ${reason}` : ''}`,
      link: '/admin',
    });
  }

  res.json(updated);
});

// PUT /api/booking/:id/rate - passenger rates a completed trip (rates the driver)
router.put('/:id/rate', auth, roleMiddleware(['passenger']), async (req, res) => {
  const { rating, review } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating must be 1-5' });
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (String(booking.passengerId) !== String(req.user.id)) return res.status(403).json({ error: 'Not your booking' });
  if (booking.status !== 'completed') return res.status(400).json({ error: 'Only completed trips can be rated' });

  const updated = await Booking.findByIdAndUpdate(req.params.id, { rating, review });

  const rated = await Booking.find({ driverId: booking.driverId, rating: { $gte: 1 } });
  const avg = rated.reduce((sum, b) => sum + b.rating, 0) / rated.length;
  await Driver.findByIdAndUpdate(booking.driverId, { rating: Math.round(avg * 10) / 10 });

  res.json(hidePassengerRating(updated));
});

// PUT /api/booking/:id/rate-passenger - driver rates the passenger after a
// completed trip. Passengers never see this (see hidePassengerRating) -
// only the driver who gave it and admins can.
router.put('/:id/rate-passenger', auth, roleMiddleware(['driver']), async (req, res) => {
  const { rating, review } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating must be 1-5' });
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver || String(booking.driverId) !== String(driver._id)) return res.status(403).json({ error: 'Not your trip' });
  if (booking.status !== 'completed') return res.status(400).json({ error: 'Only completed trips can be rated' });

  const updated = await Booking.findByIdAndUpdate(req.params.id, { passengerRating: rating, passengerReview: review });
  res.json(updated);
});

module.exports = router;
