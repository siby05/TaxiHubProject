const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const User = require('../models/User');
const { auth, roleMiddleware } = require('../middleware/auth');
const { emailService } = require('../services/emailService');
const { haversineKm, calculateTripFare, calculateCardSurcharge } = require('../utils/distance');
const { VEHICLE_TYPES, isValidVehicleType } = require('../config/vehicleTypes');
const { notifyUser, notifyAdmins } = require('../utils/notify');
const { getPassengerRatingAvg } = require('../utils/ratings');
const { isWithinSchedule } = require('../utils/schedule');
const { getDriverBilling } = require('../utils/billing');
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
// within their declared schedule, driving the requested class of vehicle
// (when the passenger asked for one), and - for a card booking - willing to
// accept online payment. Shared by the /quote estimate, the broadcast
// booking flow below, GET /driver's live request list, and the notify-others
// step on accept.
async function findEligibleCandidates(paymentMethod, vehicleType) {
  const candidates = await Driver.find({ isAvailable: true, status: 'approved' });
  return candidates.filter((d) => isWithinSchedule(d)
    && (paymentMethod !== 'card' || d.acceptsOnlinePayment !== false)
    && (!vehicleType || d.vehicleType === vehicleType));
}

async function resolveDriver(driverId, paymentMethod, vehicleType) {
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

  const usable = await findEligibleCandidates(paymentMethod, vehicleType);
  return { driver: usable[0] || null, usedFallback: !!driverId, requestedUnavailable, requestedCashOnly, requestedName };
}

function noDriverError(requestedUnavailable, requestedName, requestedCashOnly, vehicleType) {
  if (requestedCashOnly) {
    return `${requestedName || 'That driver'} only accepts cash, and no other drivers are available for online payment right now. Choose cash, or try again shortly.`;
  }
  if (requestedUnavailable) {
    return `${requestedName || 'That driver'} isn't currently active, and no other drivers are available right now. Please try again shortly.`;
  }
  return vehicleType
    ? `No ${vehicleType} drivers are available right now. Try another vehicle type, or try again shortly.`
    : 'No drivers are available right now. Please try again shortly.';
}

// Notifies one driver of a new request across every automatic channel:
// real-time socket event, stored in-app notification, and email. WhatsApp
// isn't sent automatically here - it's a free wa.me link the frontend
// renders as a "Message on WhatsApp" button (opens WhatsApp with the trip
// details pre-filled, one tap to send) rather than a server-pushed message,
// since that needs a paid WhatsApp Business API account. See
// frontend/src/utils/whatsapp.js.
async function alertDriverOfBooking(req, driverUserId, booking, passengerName, passengerRatingAvg) {
  const driverUser = await User.findById(driverUserId);
  if (!driverUser) return;
  await emailService.sendDriverBookingAlert(driverUser.email, booking);
  emitToUser(req, driverUserId, 'booking:new', { ...booking, passengerName, passengerRatingAvg });
  await notifyUser(driverUserId, {
    type: 'booking-new',
    title: 'New ride request',
    message: `${passengerName} (${passengerRatingAvg ? `⭐${passengerRatingAvg}` : 'no ratings yet'}) · ${booking.pickupAddress} → ${booking.dropAddress} - $${booking.estimatedFare}`,
    link: '/driver',
  });
}

// GET /api/booking/vehicle-types - public so the pre-login QR landing page
// and signup forms can render the same list the backend validates against.
router.get('/vehicle-types', (req, res) => res.json(VEHICLE_TYPES));

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
    const { pickupLat, pickupLng, dropLat, dropLng, driverId, paymentMethod, vehicleType } = req.body;
    if (pickupLat == null || pickupLng == null || dropLat == null || dropLng == null) {
      return res.status(400).json({ error: 'pickup and drop coordinates are required' });
    }
    if (vehicleType && !isValidVehicleType(vehicleType)) {
      return res.status(400).json({ error: 'Unknown vehicle type' });
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
      ({ driver, usedFallback, requestedUnavailable, requestedCashOnly, requestedName } = await resolveDriver(driverId, paymentMethod, vehicleType));
      if (!driver) return res.status(404).json({ error: noDriverError(requestedUnavailable, requestedName, requestedCashOnly, vehicleType), requestedUnavailable, requestedCashOnly });
    }

    const distanceKm = Math.round(haversineKm(pickupLat, pickupLng, dropLat, dropLng) * 100) / 100;
    const settings = getSettings();
    const estimatedFare = calculateTripFare(distanceKm, driver.ratePerKm, settings);
    const cardSurchargePercent = settings.cardSurchargePercent;
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
    const { pickupAddress, pickupLat, pickupLng, dropAddress, dropLat, dropLng, driverId, scheduledFor, paymentMethod, vehicleType } = req.body;
    if (!pickupAddress || !dropAddress || pickupLat == null || dropLat == null) {
      return res.status(400).json({ error: 'pickupAddress, dropAddress and lat/lng for both are required' });
    }
    if (scheduledFor && new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'scheduledFor must be a time in the future' });
    }
    if (paymentMethod && !['cash', 'card'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'paymentMethod must be "cash" or "card"' });
    }
    if (vehicleType && !isValidVehicleType(vehicleType)) {
      return res.status(400).json({ error: 'Unknown vehicle type' });
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
      const resolved = await resolveDriver(driverId, paymentMethod, vehicleType);
      if (!resolved.driver) return res.status(404).json({ error: noDriverError(resolved.requestedUnavailable, resolved.requestedName, resolved.requestedCashOnly, vehicleType), requestedUnavailable: resolved.requestedUnavailable, requestedCashOnly: resolved.requestedCashOnly });
      ({ usedFallback, requestedUnavailable, requestedCashOnly, requestedName } = resolved);
      targetDriverId = resolved.driver._id;
      ratePerKmForEstimate = resolved.driver.ratePerKm;
    } else {
      broadcastCandidates = await findEligibleCandidates(paymentMethod, vehicleType);
      if (broadcastCandidates.length === 0) {
        return res.status(404).json({ error: noDriverError(false, null, false, vehicleType), requestedUnavailable: false, requestedCashOnly: false });
      }
      ratePerKmForEstimate = broadcastCandidates.reduce((sum, d) => sum + d.ratePerKm, 0) / broadcastCandidates.length;
    }

    const bookingSettings = getSettings();
    const estimatedFare = calculateTripFare(distanceKm, ratePerKmForEstimate, bookingSettings);
    const cardSurchargeAmount = paymentMethod === 'card' ? calculateCardSurcharge(estimatedFare, bookingSettings.cardSurchargePercent) : 0;

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
      requestedVehicleType: vehicleType || null,
      status: 'pending',
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: 'unpaid',
      declinedBy: [],
      requestedAt: new Date(),
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    });

    await emailService.sendBookingConfirmation(passenger.email, booking);

    const notifyDriverIds = targetDriverId
      ? [(await Driver.findById(targetDriverId)).userId]
      : broadcastCandidates.map((d) => d.userId);

    for (const driverUserId of notifyDriverIds) {
      await alertDriverOfBooking(req, driverUserId, booking, passenger.name, passengerRatingAvg);
    }

    res.status(201).json({ ...booking, usedFallback, requestedUnavailable, requestedCashOnly, requestedName, broadcast: !targetDriverId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/booking/:id/edit - passenger corrects trip details (pickup/drop,
// scheduled time, payment method, vehicle type) while the request is still
// pending. Locked once a driver accepts - editing a trip mid-drive doesn't
// make sense, and re-editing a broadcast a driver already committed to
// would be confusing. Driver assignment itself isn't editable here: for a
// direct-hail booking the driver stays fixed (only the trip details around
// them change); for a still-unclaimed broadcast, changing the payment
// method or vehicle type can change who it's even shown to, so the fare
// and eligible-driver pool are both recalculated exactly like a fresh
// booking, and everyone who could see the old or new version is nudged to
// refresh (see 'booking:updated' below).
router.put('/:id/edit', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (String(booking.passengerId) !== String(req.user.id)) return res.status(403).json({ error: 'Not your booking' });
    if (booking.status !== 'pending') return res.status(400).json({ error: `Can't edit a trip that's already ${booking.status}` });

    const {
      pickupAddress, pickupLat, pickupLng, dropAddress, dropLat, dropLng,
      scheduledFor, paymentMethod, vehicleType,
    } = req.body;

    if (scheduledFor !== undefined && scheduledFor && new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'scheduledFor must be a time in the future' });
    }
    if (paymentMethod && !['cash', 'card'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'paymentMethod must be "cash" or "card"' });
    }
    if (vehicleType && !isValidVehicleType(vehicleType)) {
      return res.status(400).json({ error: 'Unknown vehicle type' });
    }

    const nextPickupAddress = pickupAddress ?? booking.pickupAddress;
    const nextPickupLat = pickupLat ?? booking.pickupLat;
    const nextPickupLng = pickupLng ?? booking.pickupLng;
    const nextDropAddress = dropAddress ?? booking.dropAddress;
    const nextDropLat = dropLat ?? booking.dropLat;
    const nextDropLng = dropLng ?? booking.dropLng;
    const nextPaymentMethod = paymentMethod || booking.paymentMethod;
    const oldVehicleType = booking.requestedVehicleType;
    const nextVehicleType = vehicleType !== undefined ? (vehicleType || null) : oldVehicleType;

    const distanceKm = Math.round(haversineKm(nextPickupLat, nextPickupLng, nextDropLat, nextDropLng) * 100) / 100;
    const bookingSettings = getSettings();
    let ratePerKmForEstimate;
    let oldEligible = [];
    let newEligible = [];

    if (booking.driverId) {
      // Direct hail: driver is fixed. Only block the edit if it would
      // require charging by card through a driver who doesn't take it.
      const driver = await Driver.findById(booking.driverId);
      if (nextPaymentMethod === 'card' && driver?.acceptsOnlinePayment === false) {
        const driverUser = await User.findById(driver.userId);
        return res.status(400).json({ error: `${driverUser?.name || 'This driver'} only accepts cash. Switch back to cash, or cancel and request a different driver.` });
      }
      ratePerKmForEstimate = driver.ratePerKm;
    } else {
      oldEligible = await findEligibleCandidates(booking.paymentMethod, oldVehicleType);
      newEligible = await findEligibleCandidates(nextPaymentMethod, nextVehicleType);
      if (newEligible.length === 0) {
        return res.status(400).json({ error: noDriverError(false, null, false, nextVehicleType) });
      }
      ratePerKmForEstimate = newEligible.reduce((sum, d) => sum + d.ratePerKm, 0) / newEligible.length;
    }

    const estimatedFare = calculateTripFare(distanceKm, ratePerKmForEstimate, bookingSettings);
    const cardSurchargeAmount = nextPaymentMethod === 'card' ? calculateCardSurcharge(estimatedFare, bookingSettings.cardSurchargePercent) : 0;

    const updated = await Booking.findByIdAndUpdate(booking._id, {
      pickupAddress: nextPickupAddress,
      pickupLat: nextPickupLat,
      pickupLng: nextPickupLng,
      dropAddress: nextDropAddress,
      dropLat: nextDropLat,
      dropLng: nextDropLng,
      scheduledFor: scheduledFor !== undefined ? (scheduledFor ? new Date(scheduledFor) : null) : booking.scheduledFor,
      paymentMethod: nextPaymentMethod,
      requestedVehicleType: nextVehicleType,
      distanceKm,
      estimatedFare,
      cardSurchargeAmount,
    });

    // Let whoever could see this trip know it changed - a full reload is
    // enough since GET /driver always re-filters live against the current
    // booking state, so a driver who's no longer eligible just won't see
    // it after refreshing, and a newly-eligible one will.
    if (booking.driverId) {
      const driverUser = await User.findById((await Driver.findById(booking.driverId)).userId);
      if (driverUser) {
        emitToUser(req, driverUser._id, 'booking:updated', { bookingId: booking._id });
        await notifyUser(driverUser._id, {
          type: 'booking-updated',
          title: 'A trip you accepted was updated',
          message: `${updated.pickupAddress} → ${updated.dropAddress}`,
          link: '/driver',
        });
      }
    } else {
      const notifySet = new Map([...oldEligible, ...newEligible].map((d) => [String(d.userId), d.userId]));
      for (const userId of notifySet.values()) emitToUser(req, userId, 'booking:updated', { bookingId: booking._id });
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/booking/mine - passenger's own bookings
router.get('/mine', auth, roleMiddleware(['passenger']), async (req, res) => {
  const bookings = await Booking.find({ passengerId: req.user.id })
    .populate('driverId')
    .sort({ createdAt: -1 });

  // driverId is populated as the Driver doc, but its own userId field stays
  // an unresolved id - fetch each driver's name/mobile once so the frontend
  // can offer a "Message driver on WhatsApp" wa.me link (see
  // frontend/src/utils/whatsapp.js), same as the driver already gets for
  // the passenger via GET /driver's passengerId populate.
  const driverUserCache = new Map();
  for (const b of bookings) {
    if (!b.driverId) continue;
    const uid = String(b.driverId.userId);
    if (!driverUserCache.has(uid)) driverUserCache.set(uid, await User.findById(uid));
    const driverUser = driverUserCache.get(uid);
    if (driverUser) b.driverContact = { name: driverUser.name, mobile: driverUser.mobile };
  }

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
      .filter((b) => (b.paymentMethod !== 'card' || driver.acceptsOnlinePayment !== false)
        && (!b.requestedVehicleType || b.requestedVehicleType === driver.vehicleType)
        && !(b.declinedBy || []).some((id) => String(id) === String(driver._id)));
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

// GET /api/booking/:id - single booking for its own passenger. Backs the
// /pay/:bookingId deep link a driver can WhatsApp to a passenger who
// completed a trip without having paid online yet (see PUT /:id/complete
// below) - lets them jump straight to paying that one trip without
// scrolling their full booking list. Kept deliberately last among the GET
// routes above so it can't shadow the static ones (/mine, /vehicle-types,
// /previous-drivers etc.) that share this router.
router.get('/:id', auth, roleMiddleware(['passenger']), async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate('driverId');
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (String(booking.passengerId) !== String(req.user.id)) return res.status(403).json({ error: 'Not your booking' });
  res.json(hidePassengerRating(booking));
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
    const others = (await findEligibleCandidates(booking.paymentMethod, booking.requestedVehicleType)).filter((d) => String(d._id) !== String(driver._id));
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

// PUT /api/booking/:id/decline - driver turns a pending request down. It
// leaves their list for good (they're added to declinedBy, so it won't come
// back around as a broadcast either). A request that was assigned directly
// to them is released back to the pool as a broadcast, so the passenger
// still gets a ride from whoever else is eligible rather than being stuck.
router.put('/:id/decline', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status !== 'pending') return res.status(400).json({ error: `Booking already ${booking.status}` });

  const wasAssignedToMe = booking.driverId != null && String(booking.driverId) === String(driver._id);
  const updated = await Booking.findByIdAndUpdate(req.params.id, {
    $push: { declinedBy: driver._id },
    ...(wasAssignedToMe && { driverId: null }),
  });

  if (wasAssignedToMe) {
    const passenger = await User.findById(booking.passengerId);
    const passengerRatingAvg = await getPassengerRatingAvg(passenger._id);
    const others = (await findEligibleCandidates(booking.paymentMethod, booking.requestedVehicleType))
      .filter((d) => !(updated.declinedBy || []).some((id) => String(id) === String(d._id)));

    for (const d of others) {
      await alertDriverOfBooking(req, d.userId, updated, passenger.name, passengerRatingAvg);
    }

    await notifyUser(booking.passengerId, {
      type: 'booking-declined',
      title: others.length ? 'Finding you another driver' : 'No driver available yet',
      message: others.length
        ? `${booking.pickupAddress} → ${booking.dropAddress} - your first driver couldn't take it, so we've sent it to other available drivers.`
        : `${booking.pickupAddress} → ${booking.dropAddress} - no drivers are free right now. We'll keep the request open.`,
      link: '/passenger',
    });
    emitToUser(req, booking.passengerId, 'booking:declined', updated);
  }

  res.json(updated);
});

// PUT /api/booking/:id/arrived - driver is at the pickup point. Keeps the
// booking 'accepted' (the trip hasn't started) and just stamps arrivedAt,
// so the passenger can be told to come out to the car.
router.put('/:id/arrived', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (String(booking.driverId) !== String(driver._id)) return res.status(403).json({ error: 'Not your booking' });
  if (booking.status !== 'accepted') return res.status(400).json({ error: `Booking is ${booking.status}` });

  const updated = await Booking.findByIdAndUpdate(req.params.id, { arrivedAt: new Date() });

  const driverUser = await User.findById(driver.userId);
  const vehicleLabel = `${driver.vehicleType} · ${driver.vehicleNumber}`;

  emitToUser(req, booking.passengerId, 'booking:arrived', updated);
  await notifyUser(booking.passengerId, {
    type: 'booking-arrived',
    title: 'Your driver has arrived',
    message: `${driverUser?.name || 'Your driver'} (${vehicleLabel}) is waiting at ${booking.pickupAddress}.`,
    link: '/passenger',
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
