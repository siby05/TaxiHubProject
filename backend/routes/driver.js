const express = require('express');
const { serverError } = require('../utils/serverError');
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
const { runInBackground } = require('../utils/background');
const { placeholderEmail } = require('../utils/users');
const { notifyUser, notifyAdmins } = require('../utils/notify');
const { priceWithPromo, discountedFare, refreshReturnTripInBackground } = require('../utils/discounts');
const { driverEarnings, tripCountOf, faresOf } = require('../utils/earnings');
const { checkDriverCompliance } = require('../utils/compliance');
const { isWithinSchedule, nzDayAndTime, ownBookingScheduleAdvisory } = require('../utils/schedule');
const { checkWeeklyPattern, checkSchedule } = require('../utils/workTime');
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
  notifyAdmins({
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

  const availabilitySchedule = schedule.map((day) => ({
    dayOfWeek: day.dayOfWeek,
    slots: day.slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime })),
  }));
  // NZTA work time rules (utils/workTime.js) - the pattern on its own...
  const patternError = checkWeeklyPattern(availabilitySchedule);
  if (patternError) return res.status(400).json({ error: patternError });

  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  // ...and around dated shifts already entered. Only dates still following
  // the weekly pattern are held against this save.
  const dated = Array.isArray(driver.dateSchedule) ? driver.dateSchedule : [];
  const combinedError = checkSchedule({
    weekly: availabilitySchedule, dated, today: nzDayAndTime(new Date()).date,
    involves: (date) => !dated.some((d) => d.date === date),
  });
  if (combinedError) return res.status(400).json({ error: combinedError });

  const updated = await Driver.findByIdAndUpdate(driver._id, { availabilitySchedule });
  res.json(updated);
});

// PUT /api/driver/schedule/dates/:date - shifts for one specific calendar
// date (NZ, "YYYY-MM-DD"), entered from the Schedule page's month calendar
// and auto-saved one date at a time, so quick edits on different dates
// can't overwrite each other. body: {slots: [{startTime, endTime}]} - an
// empty slots array marks the date as a day off, overriding the weekly
// pattern. Dates can be set up to a year ahead; entries before today are
// pruned on every save so the list doesn't grow forever. DELETE the same
// path to clear a date back to the weekly pattern. See utils/schedule.js
// for how dated shifts combine with the weekly pattern.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidDateKey(date) {
  if (!DATE_PATTERN.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

function oneYearAfter(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// slots === null clears the date instead of setting it.
async function saveDateShifts(req, res, slots) {
  const { date } = req.params;
  if (!isValidDateKey(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const today = nzDayAndTime(new Date()).date;
  if (date < today) return res.status(400).json({ error: "You can't change shifts for a past date" });
  if (date > oneYearAfter(today)) return res.status(400).json({ error: 'Shifts can be set up to a year ahead' });

  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const next = (Array.isArray(driver.dateSchedule) ? driver.dateSchedule : []).filter((d) => d.date !== date);
  if (slots) next.push({ date, slots });
  // NZTA work time rules (utils/workTime.js), checked before pruning so
  // yesterday's shifts still count against today's first shift. Only
  // shifts the driver has actually entered on the calendar are compared:
  // a neighbouring date they haven't set shows as "Not scheduled", so
  // its repeating weekly hours mustn't block this date (e.g. a late Friday
  // shift being refused because of weekly Saturday hours the driver never
  // put on Saturday's date). The clash is caught instead when they do
  // enter a shift on that neighbouring date.
  const workTimeError = checkSchedule({
    weekly: [], dated: next, today, involves: (d) => d === date,
  });
  if (workTimeError) return res.status(400).json({ error: workTimeError });

  const dateSchedule = next.filter((d) => d.date >= today);
  dateSchedule.sort((a, b) => a.date.localeCompare(b.date));

  const updated = await Driver.findByIdAndUpdate(driver._id, { dateSchedule });
  res.json({ dateSchedule: updated.dateSchedule });
}

router.put('/schedule/dates/:date', auth, roleMiddleware(['driver']), async (req, res) => {
  const { slots } = req.body;
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots must be an array' });
  for (const slot of slots) {
    if (!TIME_PATTERN.test(slot?.startTime) || !TIME_PATTERN.test(slot?.endTime)) {
      return res.status(400).json({ error: 'Shift times must be HH:MM' });
    }
    if (slot.startTime >= slot.endTime) {
      return res.status(400).json({ error: 'Each shift must end after it starts' });
    }
  }
  const clean = slots
    .map((s) => ({ startTime: s.startTime, endTime: s.endTime }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  return saveDateShifts(req, res, clean);
});

router.delete('/schedule/dates/:date', auth, roleMiddleware(['driver']), (req, res) => saveDateShifts(req, res, null));

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
  notifyAdmins({
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
      customFare,
    } = req.body;

    if (!pickupAddress || !dropAddress || pickupLat == null || dropLat == null) {
      return res.status(400).json({ error: 'pickupAddress, dropAddress and lat/lng for both are required' });
    }
    // Optional price the driver agreed with the passenger (e.g. over the
    // phone). Blank = the normal calculated fare.
    const hasCustomFare = customFare !== undefined && customFare !== null && customFare !== '';
    const customFareValue = hasCustomFare ? Math.round(Number(customFare) * 100) / 100 : null;
    if (hasCustomFare && !(customFareValue > 0 && customFareValue <= 10000)) {
      return res.status(400).json({ error: 'Trip price must be an amount between $0.01 and $10,000, or left empty to use the calculated fare' });
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
    // A driver who creates this booking is also personally accepting it.
    // Their declared schedule is advisory here rather than a hard gate.
    // Auto-dispatched passenger requests still obey schedule eligibility.
    const scheduleAdvice = ownBookingScheduleAdvisory(driver, scheduledFor);

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
    // A price the driver agreed with the passenger isn't cut further by
    // the promotion - but it still gets the same-day return-trip discount
    // (applied after saving, like every other booking).
    const fare = hasCustomFare
      ? discountedFare(customFareValue)
      : priceWithPromo(calculateTripFare(distanceKm, driver.ratePerKm, driverBookingSettings), scheduledFor ? new Date(scheduledFor) : new Date());
    const cardSurchargeAmount = paymentMethod === 'card' ? calculateCardSurcharge(fare.estimatedFare) : 0;

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
      ...fare,
      cardSurchargeAmount,
      status: 'accepted',
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: 'unpaid',
      requestedAt: new Date(),
      acceptedAt: new Date(),
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      bookedByDriver: true,
      // Kept so an admin can tell a driver-set price from a calculated one.
      fareSetByDriver: hasCustomFare,
    });

    // Always tell the passenger - emailVerified is false for anyone a driver
    // or the QR flow registered, even with a real address, and gating on it
    // meant those passengers never heard about their booking. send() itself
    // skips placeholder (no-email) addresses.
    runInBackground('email sendBookingConfirmation', () => emailService.sendBookingConfirmation(passenger.email, booking, driver, req.user.name));
    notifyUser(passenger._id, {
      type: 'booking-accepted',
      title: 'A driver booked a ride for you',
      message: `${booking.pickupAddress} → ${booking.dropAddress} - $${booking.estimatedFare}`,
      link: '/passenger',
    });

    refreshReturnTripInBackground(req, null, booking);

    const driverUser = await User.findById(req.user.id);

    notifyAdmins({
      type: 'driver-action',
      title: 'Driver booked a trip for a passenger',
      message: `${driverUser?.name || 'A driver'} booked for ${passenger.name}`,
      link: '/admin',
    });

    res.status(201).json({ booking, passenger: { _id: passenger._id, name: passenger.name, mobile: passenger.mobile }, ...scheduleAdvice });
  } catch (err) {
    serverError(res, err, req);
  }
});

// GET /api/driver/earnings
router.get('/earnings', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  // Live trips plus earnings archived from deleted ones (utils/earnings.js).
  const trips = await driverEarnings(driver._id);
  const totalEarnings = faresOf(trips);
  // NZ GST is 15% and fares are GST-inclusive, so the GST inside them is
  // 3/23 of the total (same as routes/expenses.js gstPortion()).
  const gst = Math.round(((totalEarnings * 3) / 23) * 100) / 100;

  res.json({
    totalTrips: tripCountOf(trips),
    totalEarnings,
    estimatedGst: gst,
    netEarnings: Math.round((totalEarnings - gst) * 100) / 100,
  });
});

module.exports = router;
