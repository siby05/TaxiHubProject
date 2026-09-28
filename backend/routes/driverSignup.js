const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');
const Driver = require('../models/Driver');
const { emailService } = require('../services/emailService');
const { runInBackground } = require('../utils/background');
const { notifyAdmins } = require('../utils/notify');
const { isValidVehicleType } = require('../config/vehicleTypes');
const { DRIVER_DOCUMENTS } = require('../config/driverDocuments');
const { rateLimit } = require('../middleware/rateLimit');
const { documentUpload, documentUrl } = require('../utils/documentUpload');
const { getSettings } = require('../config/platformSettings');

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

async function isLicenseTaken(licenseNumber) {
  const drivers = await Driver.find({});
  return drivers.some((d) => d.licenseNumber?.toLowerCase() === licenseNumber.toLowerCase());
}

// GET /api/driver-signup/enabled - public, so the pre-login nav can decide
// whether to show "Drive with us" at all, and the signup page itself can
// bail out early with a clear message rather than let someone fill in the
// whole form only to be rejected by the POST below.
router.get('/enabled', (req, res) => res.json({ enabled: getSettings().driverSignupEnabled !== false }));

// POST /api/driver-signup - public driver self-registration with mandatory
// document uploads (license, TSL, CoF, rego). Lands as status:'pending',
// same as an admin-created driver - an admin still has to approve them
// before they can go online or be assigned trips. Requires explicit T&C
// acceptance (see frontend/src/pages/DriverSignup.jsx for the popup).
router.post(
  '/',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many applications from this connection - please try again later' }),
  (req, res, next) => (getSettings().driverSignupEnabled === false
    ? res.status(403).json({ error: 'Driver sign-up is closed right now. Please check back later.' })
    : next()),
  documentUpload.fields(DRIVER_DOCUMENTS.map((d) => ({ name: d.field, maxCount: 1 }))),
  async (req, res) => {
    try {
      const {
        name, email, password, mobile, address,
        licenseNumber, tslNumber, vehicleType, vehicleNumber, ratePerKm,
        passengerEndorsementNumber, passengerEndorsementExpiry, vehicleCofExpiry,
        termsAccepted,
      } = req.body;

      if (!name || !email || !password || !mobile || !licenseNumber || !tslNumber || !vehicleNumber) {
        return res.status(400).json({ error: 'name, email, password, mobile, licenseNumber, tslNumber and vehicleNumber are required' });
      }
      if (termsAccepted !== 'true' && termsAccepted !== true) {
        return res.status(400).json({ error: 'You must accept the Terms & Conditions to sign up' });
      }
      if (vehicleType && !isValidVehicleType(vehicleType)) {
        return res.status(400).json({ error: 'Unknown vehicle type' });
      }
      const files = req.files || {};
      const missing = DRIVER_DOCUMENTS.filter((d) => !files[d.field]);
      if (missing.length) {
        return res.status(400).json({ error: `These documents are required: ${missing.map((d) => d.label).join(', ')}` });
      }

      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) return res.status(409).json({ error: 'An account with this email already exists' });
      if (await isLicenseTaken(licenseNumber)) {
        return res.status(409).json({ error: 'This license number is already registered to another driver' });
      }

      const hashed = await bcrypt.hash(password, 10);
      const user = await User.create({
        name, email: email.toLowerCase(), password: hashed, mobile, address, role: 'driver', isActive: true, emailVerified: true,
      });

      const documents = Object.fromEntries(DRIVER_DOCUMENTS.map((d) => [d.key, {
        url: documentUrl(files[d.field][0]),
        status: 'pending',
        rejectionReason: null,
        uploadedAt: new Date(),
        reviewedAt: null,
      }]));

      const driver = await Driver.create({
        userId: user._id,
        licenseNumber,
        tslNumber,
        vehicleType: vehicleType || 'Economy',
        vehicleNumber,
        ratePerKm: ratePerKm ? Number(ratePerKm) : (Number(process.env.DEFAULT_RATE_PER_KM) || 1.8),
        pendingRatePerKm: null,
        feeOverride: null,
        feeLimitOverride: null,
        acceptsOnlinePayment: true,
        status: 'pending',
        isAvailable: false,
        rating: 0,
        totalTrips: 0,
        totalEarnings: 0,
        serviceCategory: 'private-hire',
        hasSecurityCamera: false,
        passengerEndorsementNumber: passengerEndorsementNumber || null,
        passengerEndorsementExpiry: passengerEndorsementExpiry || null,
        vehicleCofExpiry: vehicleCofExpiry || null,
        documents,
        termsAcceptedAt: new Date(),
      });

      runInBackground('email sendDriverApplicationReceived', () => emailService.sendDriverApplicationReceived(user.email, user.name));
      notifyAdmins({
        type: 'driver-signup',
        title: 'New driver application',
        message: `${name} applied to drive - documents submitted, awaiting approval.`,
        link: '/admin',
      });

      res.status(201).json({
        token: signToken(user),
        user: { _id: user._id, name: user.name, email: user.email, role: user.role },
        driver,
        message: 'Application submitted. An admin will review your documents before you can go online.',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
