const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { auth } = require('../middleware/auth');

// GET /api/notifications - own notifications, newest first
router.get('/', auth, async (req, res) => {
  const notifications = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50);
  res.json(notifications);
});

// PUT /api/notifications/:id/read
router.put('/:id/read', auth, async (req, res) => {
  const notification = await Notification.findById(req.params.id);
  if (!notification || String(notification.userId) !== String(req.user.id)) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  const updated = await Notification.findByIdAndUpdate(req.params.id, { read: true });
  res.json(updated);
});

// PUT /api/notifications/read-all
router.put('/read-all', auth, async (req, res) => {
  const mine = await Notification.find({ userId: req.user.id, read: false });
  await Promise.all(mine.map((n) => Notification.findByIdAndUpdate(n._id, { read: true })));
  res.json({ updated: mine.length });
});

module.exports = router;
