const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const Booking = require('../models/Booking');
const { hasRealEmail } = require('../utils/users');
const { auth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

// Credential guessing / reset-token guessing / signup floods.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, message: 'Too many attempts - please wait 15 minutes and try again' });
// Claiming an account set up on someone's behalf is proven by a trip
// reference, which is far easier to guess than a password - so it gets a
// much tighter budget than login.
const claimLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many attempts - please wait 15 minutes and try again' });
const { emailService } = require('../services/emailService');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function signToken(user) {
  // Long-lived by default so users stay signed in across visits instead of
  // being logged out mid-week; override via JWT_EXPIRES_IN if needed.
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

function publicUser(user) {
  const { password, ...rest } = user;
  return rest;
}

// A passenger account someone else set up for them - a driver at the kerb,
// the guest QR flow, or an admin - that they haven't taken over yet with a
// password of their own (see POST /claim). Found by mobile, since that's
// the one detail every one of those flows records.
async function findClaimable(mobile) {
  const clean = String(mobile || '').trim();
  if (!clean) return null;
  const users = await User.find({ role: 'passenger', mobile: clean });
  return users.find((u) => (u.registeredByDriver || u.registeredViaQr || u.registeredByAdmin) && !u.claimedAt) || null;
}

// GET /api/auth/claim-lookup?mobile= - public. As someone types their phone
// number on the sign-up page, tells them we already have an account for
// them from an earlier trip, so they set a password on it instead of
// creating a duplicate. Like GET /booking/guest-lookup, only the first
// name and whether an email is on file come back - the rest of their
// details only become visible once they've proven it's them (POST /claim).
router.get('/claim-lookup', claimLimiter, async (req, res) => {
  const user = await findClaimable(req.query.mobile);
  if (!user) return res.json({ claimable: false });
  res.json({ claimable: true, firstName: String(user.name || '').split(' ')[0], hasEmail: hasRealEmail(user) });
});

// POST /api/auth/claim - set a password on an account someone else set up
// for this passenger. There's no SMS verification, so knowing the phone
// number isn't enough: they must also give the reference of one of their
// own trips (TRIP-YYYYMMDD-NNNNN, which the driver's WhatsApp messages and
// receipts carry). Their saved name/address are kept; an email can be
// added here if there wasn't a real one on file. Logs them straight in.
router.post('/claim', claimLimiter, async (req, res) => {
  try {
    const { mobile, tripRef, password, email } = req.body;
    if (!mobile || !tripRef || !password) return res.status(400).json({ error: 'mobile, trip reference and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const user = await findClaimable(mobile);
    const ref = String(tripRef).trim().toUpperCase();
    const trip = user && await Booking.findOne({ bookingId: ref });
    if (!trip || String(trip.passengerId) !== String(user._id)) {
      return res.status(400).json({ error: "That trip reference doesn't match this phone number - check it on your receipt or your driver's WhatsApp message" });
    }

    const patch = { password: await bcrypt.hash(password, 10), claimedAt: new Date(), emailVerified: true, resetToken: null, resetTokenExpiry: null };
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (cleanEmail && !hasRealEmail(user)) {
      const taken = await User.findOne({ email: cleanEmail });
      if (taken) return res.status(409).json({ error: 'An account with this email already exists - log in with it instead' });
      patch.email = cleanEmail;
    }
    const updated = await User.findByIdAndUpdate(user._id, patch, { new: true });
    res.json({ token: signToken(updated), user: publicUser(updated) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/claim-link - the no-trip-reference alternative for a
// claimable account that does have a real email on file: emails a
// set-password link there (the forgot-password link), which proves
// ownership of that inbox. Always the same response, so it can't be used
// to probe which numbers have accounts.
router.post('/claim-link', claimLimiter, async (req, res) => {
  try {
    const user = await findClaimable(req.body.mobile);
    const generic = { message: "If there's an email on file for this number, we've sent it a link to set your password." };
    if (!user || !hasRealEmail(user)) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    await User.findByIdAndUpdate(user._id, {
      resetToken: token,
      resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
    });
    const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${token}`;
    emailService.sendPasswordResetEmail(user.email, user.name, link).then((result) => {
      if (!result.ok) console.error(`[claim-link] email to ${user.email} failed: ${result.error}`);
    });
    res.json(generic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register - passengers self-register; drivers/admins are created by admin (see routes/admin.js)
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, mobile, address } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
    // A driver/admin already set this person up - claim that account
    // rather than creating a second one with the same phone number.
    if (await findClaimable(mobile)) {
      return res.status(409).json({ error: 'You already have an account from an earlier trip - set a password on it below', claimable: true });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashed,
      mobile,
      address,
      role: 'passenger',
      isActive: true,
      emailVerified: true,
    });

    await emailService.sendVerificationEmail(user.email, user.name);

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login - used by passengers, drivers and admin alike
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.isActive) return res.status(403).json({ error: 'Account is deactivated' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(user));
});

// PUT /api/auth/me - self-service account update, any role (passenger,
// driver or admin). Name can always change; email or password (actual
// login credentials, not profile details like PUT /api/passenger/profile
// or PUT /api/driver/profile) require confirming the current password
// first - this is the only place an admin can change their own login,
// since they have no admin-managed equivalent the way a driver does.
router.put('/me', auth, async (req, res) => {
  try {
    const { name, email, currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const changingEmail = email && email.toLowerCase() !== user.email;
    if (changingEmail || newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Enter your current password to change email or password' });
      const ok = await bcrypt.compare(currentPassword, user.password);
      if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (changingEmail) {
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'email must be a valid address' });
      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const updated = await User.findByIdAndUpdate(user._id, {
      ...(name && { name }),
      ...(changingEmail && { email: email.toLowerCase() }),
      ...(newPassword && { password: await bcrypt.hash(newPassword, 10) }),
    });
    res.json(publicUser(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/forgot-password - public, for passengers and drivers who
// can't log in (admins can just be reset by another admin, or use this
// too). Always responds with the same message regardless of whether the
// email is registered, to avoid confirming account existence - but the
// resetLink is only ever returned in this response (never guessed or
// logged) when the account really exists, so the requester's own browser
// can offer a "send via WhatsApp" shortcut alongside the emailed link
// (see frontend/src/pages/ForgotPassword.jsx) - this app has no server-
// side WhatsApp sending (see frontend/src/utils/whatsapp.js), so a
// link the user's own device can hand to WhatsApp is the only way that
// channel works at all.
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    const generic = { message: "If that email is registered, we've sent a password reset link." };
    if (!user) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    await User.findByIdAndUpdate(user._id, {
      resetToken: token,
      resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
    });

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${token}`;
    // Fire-and-forget: the token is already saved, so the link works the
    // instant this responds - no need to make the requester's "Sending..."
    // button wait on an SMTP round-trip that (misconfigured or not) can
    // take real time. send() never throws, but log a failure anyway since
    // there's no other visibility into whether it actually went out.
    emailService.sendPasswordResetEmail(user.email, user.name, resetLink).then((result) => {
      if (!result.ok) console.error(`[forgot-password] email to ${user.email} failed: ${result.error}`);
    });

    res.json({ ...generic, resetLink });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-password - consumes a forgot-password token (or an
// admin-shared one - same token shape) to set a new password. One-time
// use: the token is cleared immediately so the same link can't be reused
// or shared after the fact.
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'token and newPassword are required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'newPassword must be at least 6 characters' });

    const user = await User.findOne({ resetToken: token });
    if (!user || !user.resetTokenExpiry || new Date(user.resetTokenExpiry) < new Date()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired - request a new one' });
    }

    await User.findByIdAndUpdate(user._id, {
      password: await bcrypt.hash(newPassword, 10),
      // A set-password link from POST /claim-link is this same token, so
      // setting a password here also counts as claiming the account.
      claimedAt: user.claimedAt || new Date(),
      resetToken: null,
      resetTokenExpiry: null,
    });
    res.json({ message: 'Password reset - you can now log in with your new password.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
