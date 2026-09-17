const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const router = express.Router();
const User = require('../models/User');
const Driver = require('../models/Driver');
const { emailService } = require('../services/emailService');
const { notifyAdmins } = require('../utils/notify');

const upload = multer({
  dest: 'uploads/driver-documents/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    cb(allowedTypes.includes(file.mimetype) ? null : new Error('Documents must be JPG, PNG or PDF'), allowedTypes.includes(file.mimetype));
  },
  limits: { fileSize: 8 * 1024 * 1024 },
});

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

async function isLicenseTaken(licenseNumber) {
  const drivers = await Driver.find({});
  return drivers.some((d) => d.licenseNumber?.toLowerCase() === licenseNumber.toLowerCase());
}

// POST /api/driver-signup - public driver self-registration with mandatory
// document uploads (license, TSL, CoF, rego). Lands as status:'pending',
// same as an admin-created driver - an admin still has to approve them
// before they can go online or be assigned trips. Requires explicit T&C
// acceptance (see frontend/src/pages/DriverSignup.jsx for the popup).
router.post(
  '/',
  upload.fields([
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'tslDoc', maxCount: 1 },
    { name: 'cofDoc', maxCount: 1 },
    { name: 'regoDoc', maxCount: 1 },
  ]),
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
      const files = req.files || {};
      if (!files.licenseDoc || !files.tslDoc || !files.cofDoc || !files.regoDoc) {
        return res.status(400).json({ error: 'License, TSL, CoF and vehicle registration documents are all required' });
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

      const docUrl = (f) => `/uploads/driver-documents/${f[0].filename}`;
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
        licenseDocUrl: docUrl(files.licenseDoc),
        tslDocUrl: docUrl(files.tslDoc),
        cofDocUrl: docUrl(files.cofDoc),
        regoDocUrl: docUrl(files.regoDoc),
        documentsSubmitted: true,
        termsAcceptedAt: new Date(),
      });

      await emailService.sendDriverApplicationReceived(user.email, user.name);
      await notifyAdmins({
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
