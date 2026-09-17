const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Feedback = require('../models/Feedback');
const { notifyAdmins } = require('../utils/notify');

// POST /api/feedback - public (works whether or not the sender is logged
// in; attaches userId when a valid token is present, but doesn't require
// one - the About/Contact page is reachable before signing in).
router.post('/', async (req, res) => {
  const { name, email, message, rating } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

  let userId = null;
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) {
    try { userId = jwt.verify(token, process.env.JWT_SECRET).id; } catch { /* anonymous is fine */ }
  }

  const feedback = await Feedback.create({
    name: name || 'Anonymous',
    email: email || null,
    message,
    rating: rating ? Number(rating) : null,
    userId,
  });

  await notifyAdmins({
    type: 'feedback-new',
    title: 'New feedback received',
    message: `${feedback.name}: ${message.slice(0, 80)}${message.length > 80 ? '...' : ''}`,
    link: '/admin',
  });

  res.status(201).json({ message: 'Thanks for the feedback!' });
});

module.exports = router;
