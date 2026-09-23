const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const Driver = require('../models/Driver');
const Booking = require('../models/Booking');
const { auth, roleMiddleware } = require('../middleware/auth');
const { ensureDriverQrCode } = require('../utils/qrcode');
const { calculateTripFare, calculateCardSurcharge, routeDistanceKm, invalidStopsError, cleanStops } = require('../utils/distance');
const { emailService } = require('../services/emailService');
const { placeholderEmail } = require('../utils/users');
const { notifyUser, notifyAdmins } = require('../utils/notify');
const { checkDriverCompliance } = require('../utils/compliance');
const { isWithinSchedule } = require('../utils/schedule');
const { getSettings } = require('../config/platformSettings');
const { DRIVER_DOCUMENTS, isValidDocumentKey, documentLabel, allDocumentsVerified } = require('../config/driverDocuments');
const { documentUpload, documentUrl } = require('../utils/documentUpload');

async function getDriverProfile(userId) {
  return Driver.findOne({ userId }).populate('userId', 'name email mobile');
}

// GET /api/driver/profile
router.get('/profile', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await getDriverProfile(req.user.id);
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  res.json({ ...driver, compliance: checkDriverCompliance(driver) });
});

// PUT /api/driver/profile - a driver updating their own contact/vehicle
// details. Deliberately narrower than what an admin can change (see PUT
// /api/admin/drivers/:id): no email, license, TSL or compliance-document
// fields here - those stay admin/compliance-controlled since they're
// either a login identity or something an admin has to verify anyway.
router.put('/profile', auth, roleMiddleware(['driver']), async (req, res) => {
  const { name, mobile, vehicleNumber, vehicleBrand, vehicleModel } = req.body;
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  if (name || mobile) {
    await User.findByIdAndUpdate(req.user.id, {
      ...(name && { name }),
      ...(mobile && { mobile }),
    });
  }
  const vehicleChanges = {
    ...(vehicleNumber && { vehicleNumber }),
    ...(vehicleBrand !== undefined && { vehicleBrand }),
    ...(vehicleModel !== undefined && { vehicleModel }),
  };
  const updated = Object.keys(vehicleChanges).length
    ? await Driver.findByIdAndUpdate(driver._id, vehicleChanges)
    : driver;

  res.json(await getDriverProfile(req.user.id) || updated);
});

// GET /api/driver/documents - the driver's own view of each compliance
// document: whether it's still pending review, verified, or rejected (with
// the admin's reason so they know what to fix).
router.get('/documents', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const documents = DRIVER_DOCUMENTS.map((d) => ({
    key: d.key,
    label: d.label,
    ...(driver.documents?.[d.key] || { url: null, status: 'not-supplied', rejectionReason: null, uploadedAt: null, reviewedAt: null }),
  }));
  res.json({ documents, allVerified: allDocumentsVerified(driver), driverStatus: driver.status });
});

// POST /api/driver/documents/:key - re-upload a single document after an
// admin rejected it. Puts it straight back to 'pending' for another review
// and clears the old reason.
router.post('/documents/:key', auth, roleMiddleware(['driver']), documentUpload.single('document'), async (req, res) => {
  const { key } = req.params;
  if (!isValidDocumentKey(key)) return res.status(400).json({ error: 'Unknown document' });
  if (!req.file) return res.status(400).json({ error: 'A document file is required' });

  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const updated = await Driver.findByIdAndUpdate(driver._id, {
    documents: {
      ...driver.documents,
      [key]: {
        url: documentUrl(req.file),
        status: 'pending',
        rejectionReason: null,
        uploadedAt: new Date(),
        reviewedAt: null,
      },
    },
  });

  const driverUser = await User.findById(req.user.id);
  await notifyAdmins({
    type: 'driver-document',
    title: 'Driver re-uploaded a document',
    message: `${driverUser?.name || 'A driver'} re-uploaded their ${documentLabel(key)} for review.`,
    link: '/admin',
  });

  res.json(updated);
});

// PUT /api/driver/availability - toggle available for bookings
router.put('/availability', auth, roleMiddleware(['driver']), async (req, res) => {
  const { isAvailable } = req.body;
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  if (isAvailable) {
    const compliance = checkDriverCompliance(driver);
    if (!compliance.compliant) {
      return res.status(403).json({
        error: `Compliance details are incomplete: ${compliance.issues.join('; ')}. Ask an admin to update your record before going online.`,
        compliance,
      });
    }
  }

  const updated = await Driver.findByIdAndUpdate(driver._id, { isAvailable: !!isAvailable });
  res.json(updated);
});

// PUT /api/driver/payment-preference - driver decides whether they accept
// online (card) payments at all, or cash only. Cash-only drivers are
// excluded from auto-match for card bookings, and a direct QR hail with
// paymentMethod:'card' is rejected instead of silently charging them.
router.put('/payment-preference', auth, roleMiddleware(['driver']), async (req, res) => {
  const { acceptsOnlinePayment } = req.body;
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const updated = await Driver.findByIdAndUpdate(driver._id, { acceptsOnlinePayment: !!acceptsOnlinePayment });
  res.json(updated);
});

// PUT /api/driver/schedule - weekly availability calendar. One entry per day
// (Sunday-Saturday), each holding a list of time slots so a driver can
// declare more than one shift on the same day (e.g. a morning school run and
// a separate evening shift, with a gap in between that isn't "available").
router.put('/schedule', auth, roleMiddleware(['driver']), async (req, res) => {
  const { schedule } = req.body;
  if (!Array.isArray(schedule) || schedule.length !== 7) {
    return res.status(400).json({ error: 'schedule must be an array of 7 entries (Sunday-Saturday)' });
  }
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const day of schedule) {
    if (day.dayOfWeek == null || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      return res.status(400).json({ error: 'each day needs a dayOfWeek 0-6' });
    }
    if (!Array.isArray(day.slots)) {
      return res.status(400).json({ error: `day ${day.dayOfWeek}: slots must be an array` });
    }
    for (const slot of day.slots) {
      if (!timePattern.test(slot.startTime) || !timePattern.test(slot.endTime)) {
        return res.status(400).json({ error: `day ${day.dayOfWeek}: startTime/endTime must be HH:MM` });
      }
      if (slot.startTime >= slot.endTime) {
        return res.status(400).json({ error: `day ${day.dayOfWeek}: startTime must be before endTime` });
      }
    }
  }

  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const updated = await Driver.findByIdAndUpdate(driver._id, {
    availabilitySchedule: schedule.map((day) => ({ dayOfWeek: day.dayOfWeek, slots: day.slots })),
  });
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

  const driverUser = await User.findById(req.user.id);
  await notifyAdmins({
    type: 'rate-request',
    title: 'Driver requested a rate change',
    message: `${driverUser?.name || 'A driver'} requested $${ratePerKm}/km (currently $${driver.ratePerKm}/km)`,
    link: '/admin',
  });

  res.json({ message: 'Rate change submitted - awaiting admin approval before it goes live.', driver: updated });
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

// POST /api/driver/passengers - driver registers a passenger ahead of
// time (e.g. a regular who books by phone), same as the admin's POST
// /api/admin/passengers: name + mobile required, email and address
// optional. Without an email they get a placeholder (utils/users.js) and
// receipts go out on WhatsApp. Returns the same shape as /passengers/search
// so the result can be handed straight to the book-for-passenger page.
router.post('/passengers', auth, roleMiddleware(['driver']), async (req, res) => {
  const { name, mobile, email, address } = req.body;
  if (!name?.trim() || !mobile?.trim()) return res.status(400).json({ error: 'name and mobile are required' });
  const cleanEmail = email?.trim().toLowerCase() || null;
  if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) return res.status(400).json({ error: 'email must be a valid address' });
  const existing = await User.find({ role: 'passenger' });
  if (existing.some((u) => u.mobile === mobile.trim())) return res.status(409).json({ error: 'A passenger with this mobile number already exists - search for them under Book for passenger' });
  if (cleanEmail && existing.some((u) => u.email === cleanEmail)) return res.status(409).json({ error: 'An account with this email already exists' });

  const passenger = await User.create({
    name: name.trim(),
    email: cleanEmail || placeholderEmail('walkup'),
    password: await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10),
    mobile: mobile.trim(),
    address: address?.trim() || null,
    role: 'passenger',
    isActive: true,
    emailVerified: false,
    registeredByDriver: true,
  });
  res.status(201).json({ _id: passenger._id, name: passenger.name, email: cleanEmail, mobile: passenger.mobile });
});

// POST /api/driver/bookings - driver takes a booking on a passenger's
// behalf (e.g. phone/walk-up booking) and it's assigned straight to
// themself, already accepted (no separate accept step, since the driver
// is the one creating it).
//
// Pass an existing passengerId to book for an already-registered (and
// therefore already-verified) passenger. Omit it and pass
// passengerName/passengerMobile/passengerAddress instead to register a
// brand-new passenger on the spot - that account is created without any
// email verification or login step (the driver's own auth is what
// authorizes the booking); if that person later wants to log in
// themselves, an admin can help them set a password. This only applies to
// genuinely new people - an existing mobile/email match is rejected so the
// driver picks the real account instead of creating a duplicate.
//
// passengerAddress is required for a new passenger - NZTA small passenger
// service record-keeping expects a way to identify who travelled, and this
// is the only point in the walk-up flow where that's captured.
router.post('/bookings', auth, roleMiddleware(['driver']), async (req, res) => {
  try {
    const {
      passengerId, passengerName, passengerMobile, passengerEmail, passengerAddress,
      pickupAddress, pickupLat, pickupLng, dropAddress, dropLat, dropLng, scheduledFor, paymentMethod, stops,
    } = req.body;

    if (!pickupAddress || !dropAddress || pickupLat == null || dropLat == null) {
      return res.status(400).json({ error: 'pickupAddress, dropAddress and lat/lng for both are required' });
    }
    if (scheduledFor && new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'scheduledFor must be a time in the future' });
    }
    if (paymentMethod && !['cash', 'card'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'paymentMethod must be "cash" or "card"' });
    }
    const stopsError = invalidStopsError(stops);
    if (stopsError) return res.status(400).json({ error: stopsError });

    const driver = await Driver.findOne({ userId: req.user.id });
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    if (paymentMethod === 'card' && driver.acceptsOnlinePayment === false) {
      return res.status(400).json({ error: 'You have online payment turned off - book this trip as cash, or turn it on from your Fees page.' });
    }
    // A driver booking a passenger in directly (see POST / above for the
    // usual auto-match path) skips the whole eligibility check that keeps
    // a driver from being offered trips outside their own declared
    // availabilitySchedule - without this, "book for passenger" would let
    // them commit themselves to a scheduled trip during hours they've
    // told the platform they're not working.
    if (scheduledFor && !isWithinSchedule(driver, new Date(scheduledFor))) {
      return res.status(400).json({ error: "That time is outside your own availability schedule. Update it under Weekly availability, or pick a different time." });
    }

    let passenger;
    if (passengerId) {
      passenger = await User.findById(passengerId);
      if (!passenger || passenger.role !== 'passenger') return res.status(404).json({ error: 'Passenger not found' });
    } else {
      if (!passengerName || !passengerMobile || !passengerAddress) {
        return res.status(400).json({ error: 'passengerId, or passengerName + passengerMobile + passengerAddress to register a new passenger, is required' });
      }
      const existing = await User.find({ role: 'passenger' });
      const dupe = existing.find((u) => u.mobile === passengerMobile || (passengerEmail && u.email === passengerEmail.toLowerCase()));
      if (dupe) return res.status(409).json({ error: 'A passenger with this mobile/email is already registered - search for them instead' });

      const placeholderPassword = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
      passenger = await User.create({
        name: passengerName,
        email: passengerEmail ? passengerEmail.toLowerCase() : placeholderEmail('walkup'),
        password: placeholderPassword,
        mobile: passengerMobile,
        address: passengerAddress,
        role: 'passenger',
        isActive: true,
        emailVerified: false,
        registeredByDriver: true,
      });
    }

    const distanceKm = routeDistanceKm({ lat: pickupLat, lng: pickupLng }, { lat: dropLat, lng: dropLng }, stops);
    const driverBookingSettings = getSettings();
    const estimatedFare = calculateTripFare(distanceKm, driver.ratePerKm, driverBookingSettings);
    const cardSurchargeAmount = paymentMethod === 'card' ? calculateCardSurcharge(estimatedFare, driverBookingSettings.cardSurchargePercent) : 0;

    const booking = await Booking.create({
      passengerId: passenger._id,
      driverId: driver._id,
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
      status: 'accepted',
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: 'unpaid',
      requestedAt: new Date(),
      acceptedAt: new Date(),
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      bookedByDriver: true,
    });

    if (passenger.emailVerified) {
      await emailService.sendBookingConfirmation(passenger.email, booking, driver, req.user.name);
      await notifyUser(passenger._id, {
        type: 'booking-accepted',
        title: 'A driver booked a ride for you',
        message: `${booking.pickupAddress} → ${booking.dropAddress} - $${booking.estimatedFare}`,
        link: '/passenger',
      });
    }

    const driverUser = await User.findById(req.user.id);

    await notifyAdmins({
      type: 'driver-action',
      title: 'Driver booked a trip for a passenger',
      message: `${driverUser?.name || 'A driver'} booked for ${passenger.name}`,
      link: '/admin',
    });

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
