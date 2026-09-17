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
const { calculateCardSurcharge } = require('../utils/distance');
const { getSettings } = require('../config/platformSettings');

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
// they're still approved (and, for a card payment, accept online payment),
// otherwise falls back to any available approved driver (same as a QR code
// for a driver who's since been rejected, deactivated, or is cash-only
// when the passenger wants to pay by card - the passenger still gets a
// ride, just not that specific driver). requestedUnavailable/requestedName
// let the caller show a warning; requestedCashOnly distinguishes "wrong
// payment method" from other unavailability so the message is accurate. A
// null driver with requestedUnavailable true means the fallback itself
// came up empty ("no drivers available").
//
// A direct QR hail checks status==='approved' and (for card) the driver's
// own payment preference - no isAvailable toggle, no declared schedule.
// Same as flagging a cab in person: it goes through regardless of those
// two. That's a deliberate, explicit product decision - don't add
// availability/schedule checks here. The declared weekly schedule only
// gates the auto-match fallback below (no specific driver requested, or
// the requested one isn't usable for this booking).
// Auto-match candidate pool: drivers who are toggled online, approved,
// within their declared schedule, and - for a card booking - willing to
// accept online payment. Shared by the /quote estimate, the broadcast
// booking flow below, GET /driver's live request list, and the notify-others
// step on accept.
async function findEligibleCandidates(paymentMethod) {
  const candidates = await Driver.find({ isAvailable: true, status: 'approved' });
  return candidates.filter((d) => isWithinSchedule(d) && (paymentMethod !== 'card' || d.acceptsOnlinePayment !== false));
}

async function resolveDriver(driverId, paymentMethod) {
  let requestedUnavailable = false;
  let requestedCashOnly = false;
  let requestedName = null;

  if (driverId) {
    const requested = await Driver.findById(driverId).populate('userId', 'name');
    if (requested && requested.status === 'approved') {
      if (paymentMethod !== 'card' || requested.acceptsOnlinePayment !== false) {
        return { driver: requested, usedFallback: false, requestedUnavailable: false, requestedCashOnly: false, requestedName: null };
      }
      requestedCashOnly = true;
    }
    if (requested) {
      requestedUnavailable = true;
      requestedName = requested.userId?.name || null;
    }
  }

  const usable = await findEligibleCandidates(paymentMethod);
  return { driver: usable[0] || null, usedFallback: !!driverId, requestedUnavailable, requestedCashOnly, requestedName };
}

function noDriverError(requestedUnavailable, requestedName, requestedCashOnly) {
  if (requestedCashOnly) {
    return `${requestedName || 'That driver'} only accepts cash, and no other drivers are available for online payment right now. Choose cash, or try again shortly.`;
  }
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
    const { pickupLat, pickupLng, dropLat, dropLng, driverId, paymentMethod } = req.body;
    if (pickupLat == null || pickupLng == null || dropLat == null || dropLng == null) {
      return res.status(400).json({ error: 'pickup and drop coordinates are required' });
    }

    let driver;
    let usedFallback = false;
    let requestedUnavailable = false;
    let requestedCashOnly = false;
    let requestedName = null;

    if (req.user.role === 'driver') {
      driver = await Driver.findOne({ userId: req.user.id });
      if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    } else {
      ({ driver, usedFallback, requestedUnavailable, requestedCashOnly, requestedName } = await resolveDriver(driverId, paymentMethod));
      if (!driver) return res.status(404).json({ error: noDriverError(requestedUnavailable, requestedName, requestedCashOnly), requestedUnavailable, requestedCashOnly });
    }

    const distanceKm = Math.round(haversineKm(pickupLat, pickupLng, dropLat, dropLng) * 100) / 100;
    const estimatedFare = calculateFare(distanceKm, driver.ratePerKm);
    const cardSurchargePercent = getSettings().cardSurchargePercent;
    const cardSurchargeAmount = paymentMethod === 'card' ? calculateCardSurcharge(estimatedFare, cardSurchargePercent) : 0;
    res.json({
      distanceKm, estimatedFare, usedFallback, requestedUnavailable, requestedCashOnly, requestedName,
      cardSurchargePercent, cardSurchargeAmount,
      total: Math.round((estimatedFare + cardSurchargeAmount) * 100) / 100,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/booking - passenger requests a ride. Pass driverId to hail a
// specific driver, e.g. via their QR code, or one the passenger picked from
// "book again" - that request goes through even if they haven't toggled
// "available", same as flagging a cab in person (see resolveDriver above);
// if that driver is no longer approved/usable, falls back to broadcasting
// instead of failing outright.
//
// Omit driverId to auto-match: rather than silently picking one driver, the
// request is broadcast (driverId left null, status 'pending') to every
// currently-eligible online driver at once - same as a real taxi dispatch.
// Whichever of them taps Accept first claims it (see PUT /:id/accept),
// which also tells the others' dashboards to drop the request in real time.
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

    const distanceKm = Math.round(haversineKm(pickupLat, pickupLng, dropLat, dropLng) * 100) / 100;
    const passenger = await User.findById(req.user.id);
    const passengerRatingAvg = await getPassengerRatingAvg(passenger._id);

    let targetDriverId = null;
    let broadcastCandidates = [];
    let usedFallback = false;
    let requestedUnavailable = false;
    let requestedCashOnly = false;
    let requestedName = null;
    let ratePerKmForEstimate;

    if (driverId) {
      const resolved = await resolveDriver(driverId, paymentMethod);
      if (!resolved.driver) return res.status(404).json({ error: noDriverError(resolved.requestedUnavailable, resolved.requestedName, resolved.requestedCashOnly), requestedUnavailable: resolved.requestedUnavailable, requestedCashOnly: resolved.requestedCashOnly });
      ({ usedFallback, requestedUnavailable, requestedCashOnly, requestedName } = resolved);
      targetDriverId = resolved.driver._id;
      ratePerKmForEstimate = resolved.driver.ratePerKm;
    } else {
      broadcastCandidates = await findEligibleCandidates(paymentMethod);
      if (broadcastCandidates.length === 0) {
        return res.status(404).json({ error: noDriverError(false, null, false), requestedUnavailable: false, requestedCashOnly: false });
      }
      ratePerKmForEstimate = broadcastCandidates.reduce((sum, d) => sum + d.ratePerKm, 0) / broadcastCandidates.length;
    }

    const estimatedFare = calculateFare(distanceKm, ratePerKmForEstimate);
    const cardSurchargeAmount = paymentMethod === 'card' ? calculateCardSurcharge(estimatedFare, getSettings().cardSurchargePercent) : 0;

    const booking = await Booking.create({
      passengerId: req.user.id,
      driverId: targetDriverId,
      pickupAddress,
      pickupLat,
      pickupLng,
      dropAddress,
      dropLat,
      dropLng,
      distanceKm,
      estimatedFare,
      cardSurchargeAmount,
      status: 'pending',
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: 'unpaid',
      requestedAt: new Date(),
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    });

    await emailService.sendBookingConfirmation(passenger.email, booking);

    const notifyDrivers = targetDriverId
      ? [{ userId: (await Driver.findById(targetDriverId)).userId }]
      : broadcastCandidates.map((d) => ({ userId: d.userId }));

    for (const { userId } of notifyDrivers) {
      const driverUser = await User.findById(userId);
      if (!driverUser) continue;
      await emailService.sendDriverBookingAlert(driverUser.email, booking);
      emitToUser(req, userId, 'booking:new', { ...booking, passengerName: passenger.name, passengerRatingAvg });
      await notifyUser(userId, {
        type: 'booking-new',
        title: 'New ride request',
        message: `${passenger.name} (${passengerRatingAvg ? `⭐${passengerRatingAvg}` : 'no ratings yet'}) · ${booking.pickupAddress} → ${booking.dropAddress} - $${booking.estimatedFare}`,
        link: '/driver',
      });
    }

    res.status(201).json({ ...booking, usedFallback, requestedUnavailable, requestedCashOnly, requestedName, broadcast: !targetDriverId });
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

// GET /api/booking/driver - bookings assigned to the logged-in driver, plus
// (when they're online) any live broadcast requests they're currently
// eligible to accept - see the POST / broadcast flow above. Defaults to the
// last 30 days of trip history; pass ?all=true to see everything (nothing
// is ever deleted - this is just the default view).
router.get('/driver', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const filter = { driverId: driver._id };
  if (req.query.all !== 'true') {
    filter.createdAt = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
  }

  const assigned = await Booking.find(filter)
    .populate('passengerId', 'name mobile')
    .sort({ createdAt: -1 });

  let broadcastPending = [];
  if (driver.isAvailable && driver.status === 'approved' && isWithinSchedule(driver)) {
    broadcastPending = (await Booking.find({ driverId: null, status: 'pending' }).populate('passengerId', 'name mobile'))
      .filter((b) => b.paymentMethod !== 'card' || driver.acceptsOnlinePayment !== false);
  }

  const bookings = [...broadcastPending, ...assigned].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const ratingByPassenger = new Map();
  for (const b of bookings) {
    const pid = String(b.passengerId?._id);
    if (!ratingByPassenger.has(pid)) ratingByPassenger.set(pid, await getPassengerRatingAvg(pid));
  }
  res.json(bookings.map((b) => ({ ...b, passengerRatingAvg: ratingByPassenger.get(String(b.passengerId?._id)) })));
});

// GET /api/booking/previous-drivers - distinct drivers this passenger has
// been on a trip with before (most recent first), so they can skip
// auto-match and directly rehail someone they liked - same direct-hail path
// as scanning that driver's QR code (see resolveDriver above).
router.get('/previous-drivers', auth, roleMiddleware(['passenger']), async (req, res) => {
  const bookings = await Booking.find({ passengerId: req.user.id }).populate('driverId').sort({ createdAt: -1 });
  const seen = new Map();
  for (const b of bookings) {
    if (!b.driverId || seen.has(String(b.driverId._id))) continue;
    seen.set(String(b.driverId._id), b.driverId);
  }
  const drivers = await Promise.all([...seen.values()].map(async (d) => {
    const u = await User.findById(d.userId);
    return { _id: d._id, name: u?.name || 'Driver', vehicleType: d.vehicleType, vehicleNumber: d.vehicleNumber, rating: d.rating, status: d.status };
  }));
  res.json(drivers);
});

// PUT /api/booking/:id/accept - driver accepts. For a booking already
// assigned to this driver (direct hail), same as before. For a broadcast
// request (driverId still null - see POST / above), this claims it: first
// driver to accept wins, and everyone else who was shown the request gets
// a real-time nudge to drop it from their pending list.
router.put('/:id/accept', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status !== 'pending') return res.status(400).json({ error: `Booking already ${booking.status}` });

  const isBroadcast = booking.driverId == null;
  if (!isBroadcast && String(booking.driverId) !== String(driver._id)) {
    return res.status(403).json({ error: 'This trip was not sent to you' });
  }

  const updated = await Booking.findByIdAndUpdate(req.params.id, {
    status: 'accepted',
    acceptedAt: new Date(),
    ...(isBroadcast && { driverId: driver._id }),
  });

  // Narrow (not eliminate) the race window: if another driver's claim on
  // this same broadcast request landed between our update and this
  // re-check, back out rather than reporting a false success.
  if (isBroadcast) {
    const verify = await Booking.findById(req.params.id);
    if (String(verify.driverId) !== String(driver._id)) {
      return res.status(409).json({ error: 'This trip was just accepted by another driver.' });
    }
  }

  const passenger = await User.findById(booking.passengerId);
  await emailService.sendBookingAccepted(passenger.email, updated);
  emitToUser(req, booking.passengerId, 'booking:accepted', updated);
  await notifyUser(booking.passengerId, {
    type: 'booking-accepted',
    title: 'A driver accepted your ride',
    message: `${updated.pickupAddress} → ${updated.dropAddress}`,
    link: '/passenger',
  });

  if (isBroadcast) {
    const others = (await findEligibleCandidates(booking.paymentMethod)).filter((d) => String(d._id) !== String(driver._id));
    for (const d of others) emitToUser(req, d.userId, 'booking:claimed', { bookingId: booking._id });
  }

  const driverUser = await User.findById(driver.userId);
  await notifyAdmins({
    type: 'driver-action',
    title: 'Driver accepted a trip',
    message: `${driverUser?.name || 'A driver'} accepted booking ${updated._id}`,
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

  if (req.user.role === 'passenger' && booking.driverId == null) {
    // Still an unclaimed broadcast request - withdraw it from every
    // driver it was shown to, instead of notifying nobody (driverId null).
    const stillWatching = await findEligibleCandidates(booking.paymentMethod);
    for (const d of stillWatching) emitToUser(req, d.userId, 'booking:claimed', { bookingId: booking._id });
  } else {
    const notifyId = req.user.role === 'passenger' ? booking.driverId : booking.passengerId;
    emitToUser(req, notifyId, 'booking:cancelled', updated);
    await notifyUser(notifyId, {
      type: 'booking-cancelled',
      title: 'A booking was cancelled',
      message: `${updated.pickupAddress} → ${updated.dropAddress}${reason ? ` - ${reason}` : ''}`,
      link: req.user.role === 'passenger' ? '/driver' : '/passenger',
    });
  }

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
