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
const { ensureDriverQrCode } = require('../utils/qrcode');
const { getDriverBilling } = require('../utils/billing');
const WeeklyPayment = require('../models/WeeklyPayment');
const { getSettings, updateSettings } = require('../config/platformSettings');
const { checkDriverCompliance } = require('../utils/compliance');
const { isValidVehicleType } = require('../config/vehicleTypes');
const { DRIVER_DOCUMENTS, isValidDocumentKey, documentLabel, allDocumentsVerified, outstandingDocuments } = require('../config/driverDocuments');
const { getPassengerRatingAvg } = require('../utils/ratings');
const Feedback = require('../models/Feedback');
const { notifyUser } = require('../utils/notify');

function withCompliance(driver) {
  return { ...driver, compliance: checkDriverCompliance(driver) };
}

router.use(auth, roleMiddleware(['admin']));

function publicUser(user) {
  const { password, ...rest } = user;
  return rest;
}

async function isLicenseTaken(licenseNumber, excludeDriverId) {
  const drivers = await Driver.find({});
  return drivers.some((d) => d._id !== excludeDriverId && d.licenseNumber?.toLowerCase() === licenseNumber.toLowerCase());
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

// GET /api/admin/passengers - passenger roster with booking stats, for the grid view
router.get('/passengers', async (req, res) => {
  const [users, bookings] = await Promise.all([User.find({ role: 'passenger' }), Booking.find({})]);
  const result = await Promise.all(users.map(async (u) => {
    const own = bookings.filter((b) => String(b.passengerId) === String(u._id));
    return {
      ...publicUser(u),
      totalBookings: own.length,
      completedTrips: own.filter((b) => b.status === 'completed').length,
      ratingAvg: await getPassengerRatingAvg(u._id),
    };
  }));
  res.json(result);
});

// PUT /api/admin/users/:id/block-booking - passenger keeps login/account access but can't request new rides
router.put('/users/:id/block-booking', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { bookingBlocked: true });
  res.json(publicUser(user));
});

// PUT /api/admin/users/:id/unblock-booking
router.put('/users/:id/unblock-booking', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { bookingBlocked: false });
  res.json(publicUser(user));
});

// POST /api/admin/drivers - admin-managed driver creation. Drivers can
// also self-register with documents via POST /api/driver-signup; either
// way they land as status:'pending' until an admin approves them here.
router.post('/drivers', async (req, res) => {
  try {
    const {
      name, email, mobile, licenseNumber, vehicleType, vehicleNumber, ratePerKm,
      serviceCategory, hasSecurityCamera, tslNumber, passengerEndorsementNumber, passengerEndorsementExpiry, vehicleCofExpiry,
    } = req.body;
    if (!name || !email || !licenseNumber || !vehicleNumber) {
      return res.status(400).json({ error: 'name, email, licenseNumber and vehicleNumber are required' });
    }
    if (vehicleType && !isValidVehicleType(vehicleType)) {
      return res.status(400).json({ error: 'Unknown vehicle type' });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    if (await isLicenseTaken(licenseNumber)) {
      return res.status(409).json({ error: 'This license number is already registered to another driver' });
    }

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
      pendingRatePerKm: null,
      feeOverride: null,
      feeLimitOverride: null,
      acceptsOnlinePayment: true,
      status: 'pending',
      isAvailable: false,
      rating: 0,
      totalTrips: 0,
      totalEarnings: 0,
      serviceCategory: serviceCategory === 'taxi' ? 'taxi' : 'private-hire',
      hasSecurityCamera: !!hasSecurityCamera,
      tslNumber: tslNumber || null,
      passengerEndorsementNumber: passengerEndorsementNumber || null,
      passengerEndorsementExpiry: passengerEndorsementExpiry || null,
      vehicleCofExpiry: vehicleCofExpiry || null,
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
  res.json(drivers.map(withCompliance));
});

// GET /api/admin/drivers/:id - single driver (for the report/fee-override pages)
router.get('/drivers/:id', async (req, res) => {
  const driver = await Driver.findById(req.params.id).populate('userId', 'name email mobile isActive');
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  res.json(withCompliance(driver));
});

// PUT /api/admin/drivers/:id/fee-settings - override the platform-wide
// commission policy for just this driver (e.g. a negotiated lower rate).
router.put('/drivers/:id/fee-settings', async (req, res) => {
  const { commissionType, commissionPercent, weeklyFlatFee } = req.body;
  if (commissionType && !['per-trip-percent', 'weekly-flat'].includes(commissionType)) {
    return res.status(400).json({ error: 'commissionType must be "per-trip-percent" or "weekly-flat"' });
  }
  const driver = await Driver.findById(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  const feeOverride = {
    ...(commissionType && { commissionType }),
    ...(commissionPercent != null && { commissionPercent: Number(commissionPercent) }),
    ...(weeklyFlatFee != null && { weeklyFlatFee: Number(weeklyFlatFee) }),
  };
  const updated = await Driver.findByIdAndUpdate(driver._id, { feeOverride });
  res.json(updated);
});

// DELETE /api/admin/drivers/:id/fee-settings - revert this driver to the platform default
router.delete('/drivers/:id/fee-settings', async (req, res) => {
  const updated = await Driver.findByIdAndUpdate(req.params.id, { feeOverride: null });
  res.json(updated);
});

// PUT /api/admin/drivers/:id - edit driver/vehicle/NZTA compliance details
router.put('/drivers/:id', async (req, res) => {
  const {
    name, mobile, licenseNumber, vehicleType, vehicleNumber,
    serviceCategory, hasSecurityCamera, tslNumber, passengerEndorsementNumber, passengerEndorsementExpiry, vehicleCofExpiry,
  } = req.body;
  const driver = await Driver.findById(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  if (licenseNumber && await isLicenseTaken(licenseNumber, driver._id)) {
    return res.status(409).json({ error: 'This license number is already registered to another driver' });
  }
  if (vehicleType && !isValidVehicleType(vehicleType)) {
    return res.status(400).json({ error: 'Unknown vehicle type' });
  }

  if (name || mobile) {
    await User.findByIdAndUpdate(driver.userId, {
      ...(name && { name }),
      ...(mobile && { mobile }),
    });
  }

  const updated = await Driver.findByIdAndUpdate(driver._id, {
    ...(licenseNumber && { licenseNumber }),
    ...(vehicleType && { vehicleType }),
    ...(vehicleNumber && { vehicleNumber }),
    ...(serviceCategory && { serviceCategory: serviceCategory === 'taxi' ? 'taxi' : 'private-hire' }),
    ...(hasSecurityCamera != null && { hasSecurityCamera: !!hasSecurityCamera }),
    ...(tslNumber !== undefined && { tslNumber }),
    ...(passengerEndorsementNumber !== undefined && { passengerEndorsementNumber }),
    ...(passengerEndorsementExpiry !== undefined && { passengerEndorsementExpiry }),
    ...(vehicleCofExpiry !== undefined && { vehicleCofExpiry }),
  }).populate('userId', 'name email mobile isActive');

  res.json(withCompliance(updated));
});

// GET /api/admin/document-types - the compliance documents every driver
// must supply, so the review UI renders the same set the backend validates.
router.get('/document-types', (req, res) => res.json(DRIVER_DOCUMENTS.map(({ key, label }) => ({ key, label }))));

// PUT /api/admin/drivers/:id/verify-document - mark one uploaded document
// verified or rejected. Rejecting requires a reason, which is shown to the
// driver so they know what to fix before re-uploading (see routes/driver.js
// POST /documents/:key). Documents an admin created by hand (no self-signup
// upload) can't be reviewed - there's nothing to look at.
router.put('/drivers/:id/verify-document', async (req, res) => {
  const { documentKey, status, reason } = req.body;
  if (!isValidDocumentKey(documentKey)) return res.status(400).json({ error: 'Unknown document' });
  if (!['verified', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be "verified" or "rejected"' });
  if (status === 'rejected' && !reason?.trim()) return res.status(400).json({ error: 'A reason is required when rejecting a document' });

  const driver = await Driver.findById(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  const existing = driver.documents?.[documentKey];
  if (!existing?.url) return res.status(400).json({ error: `No ${documentLabel(documentKey)} has been uploaded yet` });

  const updated = await Driver.findByIdAndUpdate(driver._id, {
    documents: {
      ...driver.documents,
      [documentKey]: {
        ...existing,
        status,
        rejectionReason: status === 'rejected' ? reason.trim() : null,
        reviewedAt: new Date(),
      },
    },
  });

  const driverUser = await User.findById(driver.userId);
  if (driverUser) {
    await notifyUser(driverUser._id, {
      type: status === 'rejected' ? 'document-rejected' : 'document-verified',
      title: status === 'rejected' ? `${documentLabel(documentKey)} needs re-uploading` : `${documentLabel(documentKey)} verified`,
      message: status === 'rejected' ? reason.trim() : 'Thanks - this document has been checked and accepted.',
      link: '/driver/documents',
    });
  }

  res.json(updated);
});

// PUT /api/admin/drivers/:id/approve - gated on every document being
// verified first, so a driver can never go live on unchecked paperwork.
router.put('/drivers/:id/approve', async (req, res) => {
  const existing = await Driver.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Driver not found' });
  if (existing.documents && !allDocumentsVerified(existing)) {
    return res.status(400).json({
      error: `Verify every document before approving. Outstanding: ${outstandingDocuments(existing).join('; ')}`,
      outstandingDocuments: outstandingDocuments(existing),
    });
  }

  const driver = await Driver.findByIdAndUpdate(req.params.id, { status: 'approved' });
  const driverUser = await User.findById(driver.userId);
  if (driverUser) {
    await emailService.sendDriverApproved(driverUser.email, driverUser.name);
    await notifyUser(driverUser._id, {
      type: 'driver-approved',
      title: 'You are approved to drive',
      message: 'Log in and go online to start receiving trips.',
      link: '/driver',
    });
  }
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

// PUT /api/admin/drivers/:id/reactivate - bring a rejected/deactivated driver back to approved
router.put('/drivers/:id/reactivate', async (req, res) => {
  const driver = await Driver.findByIdAndUpdate(req.params.id, { status: 'approved', rejectionReason: null });
  res.json(driver);
});

// PUT /api/admin/drivers/:id/rate - admin can still set a rate directly at any time
router.put('/drivers/:id/rate', async (req, res) => {
  const { ratePerKm } = req.body;
  const driver = await Driver.findByIdAndUpdate(req.params.id, { ratePerKm, pendingRatePerKm: null });
  res.json(driver);
});

// PUT /api/admin/drivers/:id/rate/approve - apply a driver-requested rate change
router.put('/drivers/:id/rate/approve', async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (driver.pendingRatePerKm == null) return res.status(400).json({ error: 'No pending rate change to approve' });
  const updated = await Driver.findByIdAndUpdate(driver._id, { ratePerKm: driver.pendingRatePerKm, pendingRatePerKm: null });
  res.json(updated);
});

// PUT /api/admin/drivers/:id/rate/reject - discard a driver-requested rate change
router.put('/drivers/:id/rate/reject', async (req, res) => {
  const updated = await Driver.findByIdAndUpdate(req.params.id, { pendingRatePerKm: null });
  res.json(updated);
});

// GET /api/admin/drivers/:id/billing - weekly commission/fee ledger for one driver
router.get('/drivers/:id/billing', async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  res.json(await getDriverBilling(driver));
});

// POST /api/admin/drivers/:id/billing/pay - record a (typically offline) payment for a given week
router.post('/drivers/:id/billing/pay', async (req, res) => {
  const { weekStart, amount, note } = req.body;
  if (!weekStart || !amount || amount <= 0) return res.status(400).json({ error: 'weekStart and a positive amount are required' });
  const driver = await Driver.findById(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  await WeeklyPayment.create({ driverId: driver._id, weekStart, amountPaid: Number(amount), note });
  res.json(await getDriverBilling(driver));
});

// GET /api/admin/drivers/:id/trips - trip history report for one driver
router.get('/drivers/:id/trips', async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  const trips = await Booking.find({ driverId: driver._id }).populate('passengerId', 'name email').sort({ createdAt: -1 });
  res.json(trips);
});

// GET /api/admin/settings - current commission/fee policy
router.get('/settings', async (req, res) => {
  res.json(getSettings());
});

// PUT /api/admin/settings - update commission/fee policy
router.put('/settings', async (req, res) => {
  const { commissionType, commissionPercent, weeklyFlatFee, outstandingFeeLimit, cardSurchargePercent, minimumFare, fareRanges, driverSignupEnabled } = req.body;
  try {
    const updated = updateSettings({
      ...(commissionType && { commissionType }),
      ...(commissionPercent != null && { commissionPercent: Number(commissionPercent) }),
      ...(weeklyFlatFee != null && { weeklyFlatFee: Number(weeklyFlatFee) }),
      ...(outstandingFeeLimit != null && { outstandingFeeLimit: Number(outstandingFeeLimit) }),
      ...(cardSurchargePercent != null && { cardSurchargePercent: Number(cardSurchargePercent) }),
      ...(minimumFare != null && { minimumFare: Number(minimumFare) }),
      ...(fareRanges && { fareRanges: fareRanges.map((r) => ({ maxKm: Number(r.maxKm), price: Number(r.price) })) }),
      ...(driverSignupEnabled != null && { driverSignupEnabled: !!driverSignupEnabled }),
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/admin/drivers/:id/fee-limit - override the platform-wide
// outstanding-fee ceiling for just this driver (null clears the override).
router.put('/drivers/:id/fee-limit', async (req, res) => {
  const { feeLimitOverride } = req.body;
  const updated = await Driver.findByIdAndUpdate(req.params.id, {
    feeLimitOverride: feeLimitOverride === null || feeLimitOverride === '' ? null : Number(feeLimitOverride),
  });
  if (!updated) return res.status(404).json({ error: 'Driver not found' });
  res.json(withCompliance(updated));
});

// GET /api/admin/drivers/:id/qr-code - reprint a driver's QR (e.g. lost sticker)
router.get('/drivers/:id/qr-code', async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  const updated = await ensureDriverQrCode(driver);
  res.json({ qrCodeImage: updated.qrCodeImage, qrCodeUrl: updated.qrCodeUrl });
});

// GET /api/admin/bookings
router.get('/bookings', async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const bookings = await Booking.find(filter)
    .populate('passengerId', 'name email')
    .populate('driverId')
    .sort({ createdAt: -1 });

  // populate('driverId') only resolves the Driver doc, not its own
  // userId ref (the store's populate is single-level) - enrich with the
  // driver's name in a second pass so the trips table can show it.
  const driverUsers = await User.find({ role: 'driver' });
  const nameByUserId = new Map(driverUsers.map((u) => [String(u._id), u.name]));

  const ratingByPassenger = new Map();
  for (const b of bookings) {
    const pid = String(b.passengerId?._id);
    if (!ratingByPassenger.has(pid)) ratingByPassenger.set(pid, await getPassengerRatingAvg(pid));
  }

  const enriched = bookings.map((b) => ({
    ...(b.driverId ? { ...b, driverId: { ...b.driverId, userId: { _id: b.driverId.userId, name: nameByUserId.get(String(b.driverId.userId)) } } } : b),
    passengerRatingAvg: ratingByPassenger.get(String(b.passengerId?._id)),
  }));

  res.json(enriched);
});

// GET /api/admin/feedback - submissions from the public feedback form
router.get('/feedback', async (req, res) => {
  const feedback = await Feedback.find({}).sort({ createdAt: -1 });
  res.json(feedback);
});

module.exports = router;
