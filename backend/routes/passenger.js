const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Booking = require('../models/Booking');
const { passengerSpending, tripCountOf, faresOf } = require('../utils/earnings');
const { auth, roleMiddleware } = require('../middleware/auth');

// GET /api/passenger/profile
router.get('/profile', auth, roleMiddleware(['passenger']), async (req, res) => {
  const user = await User.findById(req.user.id);
  const { password, ...rest } = user;
  res.json(rest);
});

// PUT /api/passenger/profile
router.put('/profile', auth, roleMiddleware(['passenger']), async (req, res) => {
  const { name, mobile, address } = req.body;
  const user = await User.findByIdAndUpdate(req.user.id, { name, mobile, address });
  const { password, ...rest } = user;
  res.json(rest);
});

// GET /api/passenger/stats - quick summary for the dashboard
router.get('/stats', auth, roleMiddleware(['passenger']), async (req, res) => {
  const bookings = await Booking.find({ passengerId: req.user.id });
  // Includes spending archived from deleted trips (utils/earnings.js).
  const spent = await passengerSpending(req.user.id);
  res.json({
    totalTrips: tripCountOf(spent),
    activeBookings: bookings.filter((b) => ['pending', 'accepted', 'in-progress'].includes(b.status)).length,
    totalSpent: faresOf(spent),
  });
});

module.exports = router;
