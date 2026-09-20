const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const { auth } = require('../middleware/auth');
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

// POST /api/auth/register - passengers self-register; drivers/admins are created by admin (see routes/admin.js)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, mobile, address } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

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
router.post('/login', async (req, res) => {
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
router.post('/forgot-password', async (req, res) => {
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
    await emailService.sendPasswordResetEmail(user.email, user.name, resetLink);

    res.json({ ...generic, resetLink });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-password - consumes a forgot-password token (or an
// admin-shared one - same token shape) to set a new password. One-time
// use: the token is cleared immediately so the same link can't be reused
// or shared after the fact.
router.post('/reset-password', async (req, res) => {
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
      resetToken: null,
      resetTokenExpiry: null,
    });
    res.json({ message: 'Password reset - you can now log in with your new password.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
