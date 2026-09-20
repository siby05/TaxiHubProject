const express = require('express');
const router = express.Router();
const Enquiry = require('../models/Enquiry');
const { emailService } = require('../services/emailService');
const { notifyAdmins } = require('../utils/notify');

// POST /api/enquiry - public "get in touch" form on the homepage. Distinct
// from POST /api/feedback (post-trip/app feedback): this is for visitors
// who haven't necessarily booked yet, so it's also emailed straight to the
// admin inbox (see services/emailService.js sendEnquiryEmail) rather than
// just landing as an in-app notification.
router.post('/', async (req, res) => {
  const { name, email, phone, message } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

  const enquiry = await Enquiry.create({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone?.trim() || null,
    message: message.trim(),
  });

  await emailService.sendEnquiryEmail(enquiry);
  await notifyAdmins({
    type: 'enquiry-new',
    title: 'New enquiry from the website',
    message: `${enquiry.name}: ${enquiry.message.slice(0, 80)}${enquiry.message.length > 80 ? '...' : ''}`,
    link: '/admin',
  });

  res.status(201).json({ message: "Thanks - we'll be in touch soon." });
});

module.exports = router;
