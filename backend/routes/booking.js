const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Mirrors routes/auth.js's signToken() - duplicated rather than imported
// since that one isn't exported (auth.js only exports its router). Only
// used for the one guest-checkout exception below: a card-paying guest
// needs a real session to reach the existing (login-gated) payment flow.
function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}
const Booking = require('../models/Booking');
const Driver = require('../models/Driver');
const User = require('../models/User');
const { auth, roleMiddleware } = require('../middleware/auth');
const { emailService, buildReceiptPage } = require('../services/emailService');
const { buildInvoicePdf } = require('../services/invoicePdf');
const { haversineKm, calculateTripFare, calculateCardSurcharge, routeDistanceKm, invalidStopsError, cleanStops } = require('../utils/distance');
const { VEHICLE_TYPES, isValidVehicleType } = require('../config/vehicleTypes');
const { notifyUser, notifyAdmins } = require('../utils/notify');
const { getPassengerRatingAvg } = require('../utils/ratings');
const { placeholderEmail, hasRealEmail } = require('../utils/users');
const { isWithinSchedule } = require('../utils/schedule');
const { getSettings } = require('../config/platformSettings');
const { getDriverReadyTime, isReadyInTime } = require('../utils/driverAvailability');

// Passengers should never see the rating a driver gave them (they can only
// see driver ratings) - strip it before sending any booking list/detail
// back to a passenger.
function hidePassengerRating(booking) {
  const { passengerRating, passengerReview, ...rest } = booking;
  return rest;
}

// The "Print receipt" link (GET /:id/receipt below) is a plain <a> opened
// in a new tab, which can't carry the Authorization header - so each
// completed booking in the passenger's list gets its own short-lived token
// scoped to just that one receipt. A fresh one is issued every time the
// list loads, so the button never goes stale in-app; only a copied link
// eventually expires.
function receiptToken(bookingId) {
  return jwt.sign({ receipt: String(bookingId) }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function withReceiptToken(booking) {
  return booking.status === 'completed' ? { ...booking, receiptToken: receiptToken(booking._id) } : booking;
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
async function findEligibleCandidates(paymentMethod, vehicleType, requestedTime) {
  const candidates = await Driver.find({ isAvailable: true, status: 'approved' });
  // requestedTime defaults to "now" - correct for every existing caller
  // that omits it (GET /driver, accept/decline/cancel's notify-others),
  // which really do mean "right now". findEligibleCandidatesWithTiming
  // below is the one that needs this to actually be the *scheduled* time
  // for a future booking - without it, scheduling ahead only ever checked
  // whether a driver happened to be within their own hours at the moment
  // of booking, not at the time being scheduled for, so it could let a
  // trip through for a time no driver's schedule will actually cover.
  return candidates.filter((d) => isWithinSchedule(d, requestedTime || new Date())
    && (paymentMethod !== 'card' || d.acceptsOnlinePayment !== false)
    && (!vehicleType || d.vehicleType === vehicleType));
}

// Same eligibility filter as findEligibleCandidates, plus a turnaround-time
// check: a driver who's mid-trip is only usable if utils/driverAvailability
// says they'd realistically be free (finish their current trip, drive to
// this new pickup, plus a buffer) by the time this trip actually needs
// them - "now" for an immediate request, or the requested scheduledFor.
// Used only where a NEW booking is actually being placed (quote/create/
// edit/guest) - not the passive "what's in my pending list" queries, which
// keep using the plain version above so a driver isn't confusingly hidden
// from their own already-broadcast requests.
//
// Returns the usable drivers plus, when any candidate was excluded purely
// for timing, the earliest any of them would actually be ready - so the
// caller can offer "try scheduling for then" instead of a flat rejection
// when that's genuinely the only blocker.
async function findEligibleCandidatesWithTiming(paymentMethod, vehicleType, pickup, requestedTime) {
  const scheduleOk = await findEligibleCandidates(paymentMethod, vehicleType, requestedTime);
  if (!pickup) return { usable: scheduleOk, nextAvailableTime: null };

  const when = requestedTime || new Date();
  const checked = await Promise.all(scheduleOk.map(async (d) => {
    const { busy, readyAt } = await getDriverReadyTime(d._id, pickup.lat, pickup.lng);
    return { driver: d, ready: !busy || isReadyInTime(readyAt, when), readyAt };
  }));
  const usable = checked.filter((c) => c.ready).map((c) => c.driver);
  const busyReadyTimes = checked.filter((c) => !c.ready).map((c) => c.readyAt);
  const nextAvailableTime = busyReadyTimes.length ? new Date(Math.min(...busyReadyTimes.map((d) => d.getTime()))) : null;
  return { usable, nextAvailableTime };
}

// pickup ({lat,lng}) and requestedTime (Date, defaults to now) are optional
// - omit them (as GET /driver and the accept/decline notify-others steps
// do) to skip the busy/turnaround check entirely and keep the original
// approval/payment/schedule-only resolution.
async function resolveDriver(driverId, paymentMethod, vehicleType, pickup, requestedTime) {
  let requestedUnavailable = false;
  let requestedCashOnly = false;
  let requestedName = null;
  let requestedBusyReadyAt = null;

  if (driverId) {
    const requested = await Driver.findById(driverId).populate('userId', 'name');
    if (requested && requested.status === 'approved') {
      if (paymentMethod !== 'card' || requested.acceptsOnlinePayment !== false) {
        if (!pickup) {
          return { driver: requested, usedFallback: false, requestedUnavailable: false, requestedCashOnly: false, requestedName: null, nextAvailableTime: null };
        }
        const { busy, readyAt } = await getDriverReadyTime(requested._id, pickup.lat, pickup.lng);
        if (!busy || isReadyInTime(readyAt, requestedTime || new Date())) {
          return { driver: requested, usedFallback: false, requestedUnavailable: false, requestedCashOnly: false, requestedName: null, nextAvailableTime: null };
        }
        requestedBusyReadyAt = readyAt;
      } else {
        requestedCashOnly = true;
      }
    }
    if (requested) {
      requestedUnavailable = true;
      requestedName = requested.userId?.name || null;
    }
  }

  const { usable, nextAvailableTime: fallbackNextAvailable } = await findEligibleCandidatesWithTiming(paymentMethod, vehicleType, pickup, requestedTime);
  const driver = usable[0] || null;

  // Only surface a reschedule suggestion when nobody usable was actually
  // found - if the fallback pool turned up a different free driver, the
  // passenger still gets a ride right now and timing was never their
  // problem to know about.
  const candidateTimes = [requestedBusyReadyAt, fallbackNextAvailable].filter(Boolean);
  const nextAvailableTime = !driver && candidateTimes.length
    ? new Date(Math.min(...candidateTimes.map((d) => d.getTime())))
    : null;

  return { driver, usedFallback: !!driverId, requestedUnavailable, requestedCashOnly, requestedName, nextAvailableTime };
}

function noDriverError(requestedUnavailable, requestedName, requestedCashOnly, vehicleType, nextAvailableTime) {
  if (requestedCashOnly) {
    return `${requestedName || 'That driver'} only accepts cash, and no other drivers are available for online payment right now. Choose cash, or try again shortly.`;
  }
  if (nextAvailableTime) {
    return requestedName
      ? `${requestedName} is still finishing another trip and won't be free in time for this request. See the suggested time below to reschedule.`
      : 'No driver will be free in time for this request. See the suggested time below to reschedule.';
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

// A QR-scan direct hail (see autoAccept below) skips the accept/decline
// step entirely - the driver's dashboard naturally shows it as an
// already-accepted trip (I've arrived/Complete/Cancel, no Accept button)
// once it reloads, so this only needs to tell them it happened, not ask
// them to respond.
async function notifyDriverOfAutoAcceptedTrip(req, driverUserId, booking, passengerName, passengerRatingAvg) {
  const driverUser = await User.findById(driverUserId);
  if (!driverUser) return;
  await emailService.sendDriverTripAssigned(driverUser.email, booking);
  emitToUser(req, driverUserId, 'booking:new', { ...booking, passengerName, passengerRatingAvg });
  await notifyUser(driverUserId, {
    type: 'booking-new',
    title: 'New confirmed trip',
    message: `${passengerName} scanned your QR code - ${booking.pickupAddress} → ${booking.dropAddress} - $${booking.estimatedFare}`,
    link: '/driver',
  });
}

// GET /api/booking/vehicle-types - public so the pre-login QR landing page
// and signup forms can render the same list the backend validates against.
router.get('/vehicle-types', (req, res) => res.json(VEHICLE_TYPES));

// GET /api/booking/vehicle-selection-enabled - public, same reasoning as
// /api/driver-signup/enabled: the booking form needs this before an admin
// session exists, so it can't live under the admin-gated /api/admin/settings.
router.get('/vehicle-selection-enabled', (req, res) => res.json({ enabled: getSettings().vehicleSelectionEnabled !== false }));

// GET /api/booking/admin-contact - public, so a "no driver available"
// error screen (logged-in booking forms, the guest QR-scan checkout, and
// driver book-for-passenger) can offer a direct way to reach the admin.
// Only ever returns the two contact fields, never the rest of
// platformSettings (commission rates etc. stay admin-only).
router.get('/admin-contact', (req, res) => {
  const settings = getSettings();
  res.json({ email: settings.adminEmail || null, mobile: settings.adminMobile || null });
});

// GET /api/booking/guest-lookup?mobile= - public. As a returning guest
// types their phone number on the QR landing page (see POST /guest below),
// this looks them up so their name/email/address can auto-fill - saves a
// repeat visitor from retyping their details every time they scan a car's
// QR code. Deliberately returns only name/email/address, never pickup/drop
// (those are per-trip, not part of a person's saved details) and never an
// account id or anything that would let this be used to enumerate users.
router.get('/guest-lookup', async (req, res) => {
  const mobile = (req.query.mobile || '').trim();
  if (!mobile) return res.json({ found: false });
  const existing = await User.findOne({ role: 'passenger', mobile });
  if (!existing) return res.json({ found: false });
  // A guest who never gave a real email got a generated placeholder (see
  // utils/users.js) - never surface that as if it were a saved address.
  res.json({ found: true, name: existing.name, email: hasRealEmail(existing) ? existing.email : null, address: existing.address || null });
});

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

// Shared by POST /quote and POST /guest-quote: distance + the same
// three-way fare floor (per-km / minimum / range price) as an actual
// booking would get, plus the card surcharge when relevant.
function buildQuote(distanceKm, ratePerKm, paymentMethod) {
  const settings = getSettings();
  const estimatedFare = calculateTripFare(distanceKm, ratePerKm, settings);
  const cardSurchargeAmount = paymentMethod === 'card' ? calculateCardSurcharge(estimatedFare, settings.cardSurchargePercent) : 0;
  return {
    distanceKm, estimatedFare, cardSurchargePercent: settings.cardSurchargePercent, cardSurchargeAmount,
    total: Math.round((estimatedFare + cardSurchargeAmount) * 100) / 100,
  };
}

// POST /api/booking/guest-quote - public counterpart to /quote below, for
// the QR-scan guest checkout (see POST /guest) which has no logged-in user
// to authenticate. driverId is required - a guest is always quoting a
// specific scanned driver, never an open auto-match.
router.post('/guest-quote', async (req, res) => {
  try {
    const { pickupLat, pickupLng, dropLat, dropLng, driverId, paymentMethod, vehicleType, scheduledFor, stops } = req.body;
    if (!driverId) return res.status(400).json({ error: 'driverId is required' });
    if (pickupLat == null || pickupLng == null || dropLat == null || dropLng == null) {
      return res.status(400).json({ error: 'pickup and drop coordinates are required' });
    }
    const stopsError = invalidStopsError(stops);
    if (stopsError) return res.status(400).json({ error: stopsError });
    const resolved = await resolveDriver(driverId, paymentMethod, vehicleType, { lat: pickupLat, lng: pickupLng }, scheduledFor ? new Date(scheduledFor) : undefined);
    if (!resolved.driver) {
      return res.status(404).json({
        error: noDriverError(resolved.requestedUnavailable, resolved.requestedName, resolved.requestedCashOnly, vehicleType, resolved.nextAvailableTime),
        requestedUnavailable: resolved.requestedUnavailable, requestedCashOnly: resolved.requestedCashOnly, nextAvailableTime: resolved.nextAvailableTime,
      });
    }
    const distanceKm = routeDistanceKm({ lat: pickupLat, lng: pickupLng }, { lat: dropLat, lng: dropLng }, stops);
    res.json({
      ...buildQuote(distanceKm, resolved.driver.ratePerKm, paymentMethod),
      usedFallback: resolved.usedFallback, requestedUnavailable: resolved.requestedUnavailable,
      requestedCashOnly: resolved.requestedCashOnly, requestedName: resolved.requestedName,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/booking/quote - preview distance/fare before confirming, so the
// UI can show "Estimated fare: $X - Confirm booking?" without creating a
// booking yet. Uses the same fare math and driver-fallback as POST / below.
// A driver caller (booking for a passenger) always quotes against their own
// rate rather than auto-matching/falling back.
router.post('/quote', auth, roleMiddleware(['passenger', 'driver']), async (req, res) => {
  try {
    const { pickupLat, pickupLng, dropLat, dropLng, driverId, paymentMethod, vehicleType, scheduledFor, stops } = req.body;
    if (pickupLat == null || pickupLng == null || dropLat == null || dropLng == null) {
      return res.status(400).json({ error: 'pickup and drop coordinates are required' });
    }
    if (vehicleType && !isValidVehicleType(vehicleType)) {
      return res.status(400).json({ error: 'Unknown vehicle type' });
    }
    const stopsError = invalidStopsError(stops);
    if (stopsError) return res.status(400).json({ error: stopsError });

    let driver;
    let usedFallback = false;
    let requestedUnavailable = false;
    let requestedCashOnly = false;
    let requestedName = null;
    let nextAvailableTime = null;

    if (req.user.role === 'driver') {
      driver = await Driver.findOne({ userId: req.user.id });
      if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    } else {
      ({ driver, usedFallback, requestedUnavailable, requestedCashOnly, requestedName, nextAvailableTime } = await resolveDriver(driverId, paymentMethod, vehicleType, { lat: pickupLat, lng: pickupLng }, scheduledFor ? new Date(scheduledFor) : undefined));
      if (!driver) {
        return res.status(404).json({
          error: noDriverError(requestedUnavailable, requestedName, requestedCashOnly, vehicleType, nextAvailableTime),
          requestedUnavailable, requestedCashOnly, nextAvailableTime,
        });
      }
    }

    const distanceKm = routeDistanceKm({ lat: pickupLat, lng: pickupLng }, { lat: dropLat, lng: dropLng }, stops);
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
    const { pickupAddress, pickupLat, pickupLng, dropAddress, dropLat, dropLng, driverId, scheduledFor, paymentMethod, vehicleType, stops, viaQr } = req.body;
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
    const stopsError = invalidStopsError(stops);
    if (stopsError) return res.status(400).json({ error: stopsError });

    const requestingPassenger = await User.findById(req.user.id);
    if (requestingPassenger?.bookingBlocked) {
      return res.status(403).json({ error: 'Your account is restricted from making new bookings. Contact support.' });
    }

    const distanceKm = routeDistanceKm({ lat: pickupLat, lng: pickupLng }, { lat: dropLat, lng: dropLng }, stops);
    const passenger = await User.findById(req.user.id);
    const passengerRatingAvg = await getPassengerRatingAvg(passenger._id);

    let targetDriverId = null;
    let broadcastCandidates = [];
    let usedFallback = false;
    let requestedUnavailable = false;
    let requestedCashOnly = false;
    let requestedName = null;
    let ratePerKmForEstimate;

    const requestedTime = scheduledFor ? new Date(scheduledFor) : new Date();
    const pickup = { lat: pickupLat, lng: pickupLng };

    if (driverId) {
      const resolved = await resolveDriver(driverId, paymentMethod, vehicleType, pickup, requestedTime);
      if (!resolved.driver) {
        return res.status(404).json({
          error: noDriverError(resolved.requestedUnavailable, resolved.requestedName, resolved.requestedCashOnly, vehicleType, resolved.nextAvailableTime),
          requestedUnavailable: resolved.requestedUnavailable, requestedCashOnly: resolved.requestedCashOnly, nextAvailableTime: resolved.nextAvailableTime,
        });
      }
      ({ usedFallback, requestedUnavailable, requestedCashOnly, requestedName } = resolved);
      targetDriverId = resolved.driver._id;
      ratePerKmForEstimate = resolved.driver.ratePerKm;
    } else {
      const { usable, nextAvailableTime } = await findEligibleCandidatesWithTiming(paymentMethod, vehicleType, pickup, requestedTime);
      broadcastCandidates = usable;
      if (broadcastCandidates.length === 0) {
        return res.status(404).json({
          error: noDriverError(false, null, false, vehicleType, nextAvailableTime),
          requestedUnavailable: false, requestedCashOnly: false, nextAvailableTime,
        });
      }
      ratePerKmForEstimate = broadcastCandidates.reduce((sum, d) => sum + d.ratePerKm, 0) / broadcastCandidates.length;
    }

    const bookingSettings = getSettings();
    const estimatedFare = calculateTripFare(distanceKm, ratePerKmForEstimate, bookingSettings);
    const cardSurchargeAmount = paymentMethod === 'card' ? calculateCardSurcharge(estimatedFare, bookingSettings.cardSurchargePercent) : 0;

    // A QR-scan direct hail (see frontend/src/pages/passenger/BookDriver.jsx,
    // the only caller that sends viaQr) skips the accept/decline step
    // entirely - scanning a specific driver's own car is the "flag a cab"
    // moment, not a request they might turn down. Only applies when a
    // single driver actually got resolved (targetDriverId) - if that
    // driver wasn't usable and this fell back to a broadcast instead,
    // there's no single driver to auto-assign to, so it behaves like any
    // other broadcast (first to accept claims it).
    const autoAccept = !!(viaQr && targetDriverId);

    const booking = await Booking.create({
      passengerId: req.user.id,
      driverId: targetDriverId,
      pickupAddress,
      pickupLat,
      pickupLng,
      dropAddress,
      dropLat,
      dropLng,
      stops: cleanStops(stops),
      distanceKm,
      estimatedFare,
      cardSurchargeAmount,
      requestedVehicleType: vehicleType || null,
      status: autoAccept ? 'accepted' : 'pending',
      ...(autoAccept && { acceptedAt: new Date() }),
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: 'unpaid',
      declinedBy: [],
      requestedAt: new Date(),
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    });

    if (autoAccept) {
      const assignedDriver = await Driver.findById(targetDriverId).populate('userId', 'name');
      await emailService.sendBookingConfirmedDirect(passenger.email, booking, assignedDriver, assignedDriver?.userId?.name);
    } else {
      await emailService.sendBookingConfirmation(passenger.email, booking);
    }

    const notifyDriverIds = targetDriverId
      ? [(await Driver.findById(targetDriverId)).userId]
      : broadcastCandidates.map((d) => d.userId);

    for (const driverUserId of notifyDriverIds) {
      if (autoAccept) {
        await notifyDriverOfAutoAcceptedTrip(req, driverUserId, booking, passenger.name, passengerRatingAvg);
      } else {
        await alertDriverOfBooking(req, driverUserId, booking, passenger.name, passengerRatingAvg);
      }
    }

    res.status(201).json({ ...booking, usedFallback, requestedUnavailable, requestedCashOnly, requestedName, broadcast: !targetDriverId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/booking/guest - public, no account/login required. For the QR
// landing page: a passenger who scanned a driver's code can complete a
// booking straight away with just their name/mobile (email optional)
// instead of going through full registration first - registration still
// exists and still works (see routes/auth.js /register), this is just a
// faster path for the QR-scan moment specifically. driverId is required
// (this is always a direct hail to the scanned driver, with the same
// fallback-to-another-driver behaviour as POST / above if they're no
// longer available).
//
// A returning guest is matched by mobile number and reused rather than
// creating a duplicate account each visit - see GET /guest-lookup, which
// the frontend calls as soon as they type their number, to prefill name/
// email/address (not pickup/drop - those are always entered fresh). No
// session/token is issued; this intentionally stays a one-off guest
// checkout rather than logging them in.
router.post('/guest', async (req, res) => {
  try {
    const {
      driverId, passengerName, passengerMobile, passengerEmail, passengerAddress,
      pickupAddress, pickupLat, pickupLng, dropAddress, dropLat, dropLng, scheduledFor, paymentMethod, vehicleType, stops,
    } = req.body;

    if (!driverId) return res.status(400).json({ error: 'driverId is required' });
    if (!passengerName || !passengerMobile) return res.status(400).json({ error: 'passengerName and passengerMobile are required' });
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
    const stopsError = invalidStopsError(stops);
    if (stopsError) return res.status(400).json({ error: stopsError });

    let passenger = await User.findOne({ role: 'passenger', mobile: passengerMobile });
    if (passenger) {
      // Same record-keeping requirement as a brand-new guest below - an
      // older account created before this was required might still have
      // no address on file, so still ask for one this time rather than
      // letting it slide forever.
      if (!passenger.address && !passengerAddress) {
        return res.status(400).json({ error: 'passengerAddress is required' });
      }
      // Keep their saved details current if this visit gave new ones,
      // without clobbering a previously-saved address with a blank.
      const patch = {};
      if (passengerName && passengerName !== passenger.name) patch.name = passengerName;
      if (passengerAddress && passengerAddress !== passenger.address) patch.address = passengerAddress;
      if (Object.keys(patch).length) passenger = await User.findByIdAndUpdate(passenger._id, patch);
    } else {
      // NZTA small passenger service record-keeping expects a way to
      // identify who travelled - same reasoning routes/driver.js POST
      // /bookings already applies to a driver-registered walk-up passenger.
      if (!passengerAddress) return res.status(400).json({ error: 'passengerAddress is required' });
      const placeholderPassword = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
      passenger = await User.create({
        name: passengerName,
        email: passengerEmail ? passengerEmail.toLowerCase() : placeholderEmail('guest'),
        password: placeholderPassword,
        mobile: passengerMobile,
        address: passengerAddress || null,
        role: 'passenger',
        isActive: true,
        emailVerified: false,
        registeredViaQr: true,
      });
    }

    const distanceKm = routeDistanceKm({ lat: pickupLat, lng: pickupLng }, { lat: dropLat, lng: dropLng }, stops);
    const passengerRatingAvg = await getPassengerRatingAvg(passenger._id);

    const resolved = await resolveDriver(driverId, paymentMethod, vehicleType, { lat: pickupLat, lng: pickupLng }, scheduledFor ? new Date(scheduledFor) : undefined);
    if (!resolved.driver) {
      return res.status(404).json({
        error: noDriverError(resolved.requestedUnavailable, resolved.requestedName, resolved.requestedCashOnly, vehicleType, resolved.nextAvailableTime),
        requestedUnavailable: resolved.requestedUnavailable, requestedCashOnly: resolved.requestedCashOnly, nextAvailableTime: resolved.nextAvailableTime,
      });
    }

    const bookingSettings = getSettings();
    const estimatedFare = calculateTripFare(distanceKm, resolved.driver.ratePerKm, bookingSettings);
    const cardSurchargeAmount = paymentMethod === 'card' ? calculateCardSurcharge(estimatedFare, bookingSettings.cardSurchargePercent) : 0;

    const booking = await Booking.create({
      passengerId: passenger._id,
      driverId: resolved.driver._id,
      pickupAddress,
      pickupLat,
      pickupLng,
      dropAddress,
      dropLat,
      dropLng,
      stops: cleanStops(stops),
      distanceKm,
      estimatedFare,
      cardSurchargeAmount,
      requestedVehicleType: vehicleType || null,
      // Guest checkout only ever exists behind a QR scan - always a
      // direct hail, never a broadcast - so it's always auto-accepted,
      // same "flag a cab" reasoning as the logged-in viaQr path above.
      status: 'accepted',
      acceptedAt: new Date(),
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: 'unpaid',
      declinedBy: [],
      requestedAt: new Date(),
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    });

    const assignedDriver = await Driver.findById(resolved.driver._id).populate('userId', 'name');
    await emailService.sendBookingConfirmedDirect(passenger.email, booking, assignedDriver, assignedDriver?.userId?.name);
    await notifyDriverOfAutoAcceptedTrip(req, resolved.driver.userId, booking, passenger.name, passengerRatingAvg);

    // A guest who chose to pay online has no other way back into the app
    // to pay once accepted - no account/login was ever set up for them
    // (that's the whole point of guest checkout). Rather than build a
    // separate unauthenticated payment path, quietly give them a real
    // session for their (already-created) passenger account here, so the
    // frontend can land them on the same login-gated /pay/:bookingId page
    // and Stripe flow every other passenger already uses. A cash guest
    // gets no token at all - guest checkout stays a true one-off for them.
    const { password: _pw, ...passengerPublic } = passenger;

    res.status(201).json({
      ...booking,
      usedFallback: resolved.usedFallback,
      requestedUnavailable: resolved.requestedUnavailable,
      requestedCashOnly: resolved.requestedCashOnly,
      requestedName: resolved.requestedName,
      ...(booking.paymentMethod === 'card' && { token: signToken(passenger), user: passengerPublic }),
    });
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
      scheduledFor, paymentMethod, vehicleType, stops,
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
    const stopsError = invalidStopsError(stops);
    if (stopsError) return res.status(400).json({ error: stopsError });
    const nextStops = stops !== undefined ? cleanStops(stops) : (booking.stops || []);

    const nextPickupAddress = pickupAddress ?? booking.pickupAddress;
    const nextPickupLat = pickupLat ?? booking.pickupLat;
    const nextPickupLng = pickupLng ?? booking.pickupLng;
    const nextDropAddress = dropAddress ?? booking.dropAddress;
    const nextDropLat = dropLat ?? booking.dropLat;
    const nextDropLng = dropLng ?? booking.dropLng;
    const nextPaymentMethod = paymentMethod || booking.paymentMethod;
    const oldVehicleType = booking.requestedVehicleType;
    const nextVehicleType = vehicleType !== undefined ? (vehicleType || null) : oldVehicleType;

    const distanceKm = routeDistanceKm({ lat: nextPickupLat, lng: nextPickupLng }, { lat: nextDropLat, lng: nextDropLng }, nextStops);
    const bookingSettings = getSettings();
    const nextScheduledFor = scheduledFor !== undefined ? scheduledFor : booking.scheduledFor;
    const nextRequestedTime = nextScheduledFor ? new Date(nextScheduledFor) : new Date();
    const nextPickup = { lat: nextPickupLat, lng: nextPickupLng };
    let ratePerKmForEstimate;
    let oldEligible = [];
    let newEligible = [];

    if (booking.driverId) {
      // Direct hail: driver is fixed, no fallback to fall back to - block
      // the edit outright (with a next-available-time suggestion) rather
      // than silently reassigning someone else.
      const driver = await Driver.findById(booking.driverId);
      if (nextPaymentMethod === 'card' && driver?.acceptsOnlinePayment === false) {
        const driverUser = await User.findById(driver.userId);
        return res.status(400).json({ error: `${driverUser?.name || 'This driver'} only accepts cash. Switch back to cash, or cancel and request a different driver.` });
      }
      const { busy, readyAt } = await getDriverReadyTime(driver._id, nextPickup.lat, nextPickup.lng);
      if (busy && !isReadyInTime(readyAt, nextRequestedTime)) {
        return res.status(400).json({
          error: `This driver is still finishing another trip and won't be free in time for the new pickup. Next available: ${readyAt.toISOString()}.`,
          nextAvailableTime: readyAt,
        });
      }
      ratePerKmForEstimate = driver.ratePerKm;
    } else {
      oldEligible = await findEligibleCandidates(booking.paymentMethod, oldVehicleType);
      const { usable, nextAvailableTime } = await findEligibleCandidatesWithTiming(nextPaymentMethod, nextVehicleType, nextPickup, nextRequestedTime);
      newEligible = usable;
      if (newEligible.length === 0) {
        return res.status(400).json({ error: noDriverError(false, null, false, nextVehicleType, nextAvailableTime), nextAvailableTime });
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
      stops: nextStops,
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

  res.json(bookings.map(hidePassengerRating).map(withReceiptToken));
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
    .populate('passengerId', 'name mobile email')
    .sort({ createdAt: -1 });

  let broadcastPending = [];
  if (driver.isAvailable && driver.status === 'approved' && isWithinSchedule(driver)) {
    broadcastPending = (await Booking.find({ driverId: null, status: 'pending' }).populate('passengerId', 'name mobile email'))
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
  // passengerHasEmail + receiptToken let the driver's app hand a passenger
  // with no real email their receipt link over WhatsApp at completion
  // (the address itself stays off the driver's payload).
  res.json(bookings.map((b) => {
    const { email, ...passengerPublic } = b.passengerId || {};
    return {
      ...b,
      passengerId: b.passengerId ? passengerPublic : b.passengerId,
      passengerHasEmail: hasRealEmail(b.passengerId),
      passengerRatingAvg: ratingByPassenger.get(String(b.passengerId?._id)),
      ...(b.driverId && { receiptToken: receiptToken(b._id) }),
    };
  }));
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

// GET /api/booking/driver-count - how many approved (bookable) drivers exist
// platform-wide. The passenger booking form uses this to hide its "specific
// driver vs. auto-match" choice when there's only one driver anyway - a
// choice between one option isn't a choice, and it's confusing UI otherwise.
router.get('/driver-count', auth, roleMiddleware(['passenger']), async (req, res) => {
  res.json({ count: await Driver.countDocuments({ status: 'approved' }) });
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
  try {
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
    await emailService.sendBookingAccepted(passenger.email, updated, driver, req.user.name);
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  const vehicleMake = [driver.vehicleBrand, driver.vehicleModel].filter(Boolean).join(' ');
  const vehicleLabel = `${vehicleMake ? `${vehicleMake} (${driver.vehicleType})` : driver.vehicleType} · ${driver.vehicleNumber}`;

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
  const updated = await Booking.findByIdAndUpdate(req.params.id, { status: 'in-progress', startedAt: new Date() });
  emitToUser(req, updated.passengerId, 'booking:started', updated);
  res.json(updated);
});

// PUT /api/booking/:id/complete - driver enters the actual fare charged
router.put('/:id/complete', auth, roleMiddleware(['driver']), async (req, res) => {
  try {
    const { actualFare } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    // Guards against double-incrementing the driver's totalTrips/
    // totalEarnings below if Complete is ever hit twice for the same trip.
    if (booking.status === 'completed') return res.status(400).json({ error: 'Trip already completed' });

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
    const driverUser = await User.findById(driver.userId);
    // The completion email *is* the receipt: same invoice as GET
    // /:id/receipt, PDF attached. Not awaited - the driver's Complete tap
    // shouldn't wait on PDF generation plus a mail API round-trip, and
    // send() never throws. A passenger with no real email (registered by
    // a driver/admin, or via the guest QR flow) gets the receipt link on
    // WhatsApp from the driver's phone instead - see DriverDashboard.jsx
    // complete(), fed by receiptToken/passengerHasEmail on GET /driver.
    if (hasRealEmail(passenger)) {
      const billedTo = { name: passenger.name, address: passenger.address };
      buildInvoicePdf(updated, billedTo, driver, driverUser?.name)
        .catch((err) => { console.error(`[receipt] PDF for ${updated.bookingId} failed: ${err.message}`); return undefined; })
        .then((pdf) => emailService.sendInvoiceEmail(passenger.email, updated, billedTo, driver, driverUser?.name, pdf));
    }
    emitToUser(req, booking.passengerId, 'booking:completed', updated);
    await notifyUser(booking.passengerId, {
      type: 'booking-completed',
      title: 'Trip completed',
      message: `Final fare: $${updated.actualFare}`,
      link: '/passenger',
    });

    await notifyAdmins({
      type: 'driver-action',
      title: 'Driver completed a trip',
      message: `${driverUser?.name || 'A driver'} completed booking ${updated._id} - $${updated.actualFare}`,
      link: '/admin',
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/booking/:id/cancel
router.put('/:id/cancel', auth, roleMiddleware(['passenger', 'driver']), async (req, res) => {
  try {
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
      // The in-app notification/socket event above only reaches the
      // passenger while they have the app open - email is the channel that
      // reaches them regardless (WhatsApp is handled client-side by the
      // driver, see pages/driver/DriverDashboard.jsx cancelTrip()).
      const passenger = await User.findById(booking.passengerId);
      if (passenger) await emailService.sendBookingCancelledByDriver(passenger.email, updated, reason);
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// GET /api/booking/:id/receipt?t=<receiptToken> - the same invoice the
// passenger was emailed on completion, as a standalone page. Authenticated
// by the per-booking token from GET /mine rather than the JWT header,
// because this is opened as a plain link in a new tab (see the "Receipt"
// button in PassengerDashboard.jsx) - window.print() from inside the app
// itself is a silent no-op in an installed PWA on iOS.
// GET /api/booking/:id/receipt.pdf?t=<receiptToken> - the same invoice as a
// generated PDF file (the page's "Download PDF" button and the email's
// attachment). Served inline: iOS shows it with its own share/save/print
// sheet, Android downloads it - either way the user ends up with a file,
// which the browser print dialog never reliably gave them on a phone.
router.get(['/:id/receipt', '/:id/receipt.pdf'], async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET);
  } catch {
    return res.status(401).type('text').send('This receipt link is invalid or has expired - open it again from your bookings.');
  }
  if (payload.receipt !== req.params.id) return res.status(403).type('text').send('This link is for a different booking.');

  const booking = await Booking.findById(req.params.id).populate('driverId');
  if (!booking || booking.status !== 'completed') return res.status(404).type('text').send('Receipt not found');
  const passenger = await User.findById(booking.passengerId);
  const driverUser = booking.driverId ? await User.findById(booking.driverId.userId) : null;
  const billedTo = { name: passenger?.name, address: passenger?.address };

  if (req.path.endsWith('.pdf')) {
    const pdf = await buildInvoicePdf(booking, billedTo, booking.driverId, driverUser?.name);
    res.setHeader('Content-Disposition', `inline; filename="EasyRide-invoice-${booking.bookingId}.pdf"`);
    return res.type('application/pdf').send(pdf);
  }
  const pdfUrl = `${req.baseUrl}/${booking._id}/receipt.pdf?t=${encodeURIComponent(req.query.t)}`;
  res.type('html').send(buildReceiptPage(booking, billedTo, booking.driverId, driverUser?.name, pdfUrl));
});

// PUT /api/booking/:id/payment-method - passenger changes how they're
// paying, any time before the trip wraps up (not just while still
// pending) - QR-scan direct hails are auto-accepted straight past
// 'pending' now, so this is the only way to switch on one of those.
// Blocked once paid (nothing left to switch) or once the trip is
// finished (completed/cancelled).
router.put('/:id/payment-method', auth, roleMiddleware(['passenger']), async (req, res) => {
  try {
    const { paymentMethod } = req.body;
    if (!['cash', 'card'].includes(paymentMethod)) return res.status(400).json({ error: 'paymentMethod must be "cash" or "card"' });

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (String(booking.passengerId) !== String(req.user.id)) return res.status(403).json({ error: 'Not your booking' });
    if (['completed', 'cancelled'].includes(booking.status)) {
      return res.status(400).json({ error: `Can't change payment method - trip is already ${booking.status}` });
    }
    if (booking.paymentStatus === 'paid') return res.status(400).json({ error: 'This trip is already paid - payment method can\'t be changed' });
    if (paymentMethod === booking.paymentMethod) return res.json(booking);

    if (paymentMethod === 'card' && booking.driverId) {
      const driver = await Driver.findById(booking.driverId);
      if (driver?.acceptsOnlinePayment === false) {
        return res.status(400).json({ error: 'This driver only accepts cash, so this trip can\'t be switched to online payment' });
      }
    }

    const settings = getSettings();
    const fare = booking.actualFare || booking.estimatedFare;
    const cardSurchargeAmount = paymentMethod === 'card' ? calculateCardSurcharge(fare, settings.cardSurchargePercent) : 0;
    const updated = await Booking.findByIdAndUpdate(booking._id, { paymentMethod, cardSurchargeAmount });

    if (booking.driverId) {
      const driverUser = await User.findById((await Driver.findById(booking.driverId)).userId);
      if (driverUser) {
        emitToUser(req, driverUser._id, 'booking:updated', { bookingId: booking._id });
        await notifyUser(driverUser._id, {
          type: 'booking-updated',
          title: 'Passenger changed payment method',
          message: `${updated.bookingId}: now paying by ${paymentMethod === 'card' ? 'card (online)' : 'cash'}`,
          link: '/driver',
        });
      }
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/booking/:id/mark-paid - driver manually confirms payment was
// received outside the app (e.g. the passenger paid cash in person
// despite booking as card, or an online payment was arranged another
// way) - an alternative to the Stripe flow, not a replacement for it.
router.put('/:id/mark-paid', auth, roleMiddleware(['driver']), async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver || String(booking.driverId) !== String(driver._id)) return res.status(403).json({ error: 'Not your trip' });
  if (booking.paymentStatus === 'paid') return res.status(400).json({ error: 'This trip is already marked paid' });

  const updated = await Booking.findByIdAndUpdate(booking._id, { paymentStatus: 'paid' });
  res.json(updated);
});

module.exports = router;
