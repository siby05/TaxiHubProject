const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Driver = require('../models/Driver');
const { auth, roleMiddleware } = require('../middleware/auth');
const { emailService } = require('../services/emailService');
const { runInBackground } = require('../utils/background');
const { notifyUser, notifyAdmins } = require('../utils/notify');
const multer = require('multer');

/**
 * Adapted from the previous session's complaint-routes.js. Logic and
 * endpoints are preserved (create, driver comment, admin manage/escalate/
 * compliance-report/archive); the only changes are: Mongoose model calls
 * -> in-memory Model API, and `new Complaint(); doc.save()` -> `Complaint
 * .create()` / a second `findByIdAndUpdate()`, since the memory layer
 * doesn't support mutate-then-save on a plain object.
 */
const upload = multer({
  dest: 'uploads/complaints/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'];
    cb(allowedTypes.includes(file.mimetype) ? null : Object.assign(new Error('Invalid file type'), { status: 400 }), allowedTypes.includes(file.mimetype));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

/** PASSENGER ROUTES */

// POST /api/complaints - passenger logs a complaint
router.post('/', auth, roleMiddleware(['passenger']), upload.array('attachments', 5), async (req, res) => {
  try {
    const { bookingId, complaintType, description, incidentDate, incidentTime, incidentLocation } = req.body;
    if (!bookingId || !complaintType || !description || !incidentDate || !incidentTime || !incidentLocation) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Accepts the trip's human reference (TRIP-...) as typed from My
    // bookings, or the internal id when arriving via the trip's own
    // "Lodge complaint" button.
    const ref = String(bookingId).trim();
    const booking = (await Booking.findOne({ bookingId: ref.toUpperCase() })) || (/^[0-9a-f]{24}$/i.test(ref) ? await Booking.findById(ref) : null);
    if (!booking) return res.status(404).json({ error: 'No trip found with that reference - check it against My bookings' });
    if (String(booking.passengerId) !== String(req.user.id)) return res.status(403).json({ error: 'That trip is not one of yours' });

    const passenger = await User.findById(req.user.id);
    const driver = await Driver.findById(booking.driverId);
    const driverUser = driver ? await User.findById(driver.userId) : null;

    const attachments = (req.files || []).map((file) => ({
      fileName: file.originalname,
      fileUrl: `/uploads/complaints/${file.filename}`,
      fileType: file.mimetype,
      uploadedAt: new Date(),
      uploadedBy: passenger.name,
    }));

    const complaint = await Complaint.create({
      complainantId: req.user.id,
      complainantName: passenger.name,
      complainantEmail: passenger.email,
      complainantPhone: passenger.mobile,
      complainantAddress: passenger.address,
      complaintType,
      description,
      incidentDate: new Date(incidentDate),
      incidentTime,
      incidentLocation,
      bookingId: booking._id,
      bookingRef: booking.bookingId,
      driverId: booking.driverId,
      driverName: driverUser?.name || 'Unknown',
      vehicleNumber: driver?.vehicleNumber,
      vehicleType: driver?.vehicleType,
      attachments,
    });

    runInBackground('email sendComplaintAcknowledgement', () => emailService.sendComplaintAcknowledgement(passenger.email, complaint));
    if (driverUser) runInBackground('email sendComplaintNotification', () => emailService.sendComplaintNotification(driverUser.email, complaint));
    if (complaint.isSerious) runInBackground('email sendAdminAlertSerious', () => emailService.sendAdminAlertSerious(complaint));

    const io = req.app.get('io');
    if (io) io.to('admins').emit('complaint:new', complaint);
    notifyAdmins({
      type: complaint.isSerious ? 'complaint-serious' : 'complaint-new',
      title: complaint.isSerious ? 'SERIOUS complaint lodged' : 'New complaint lodged',
      message: `${complaint.complaintId} - ${complaint.complaintType.replace(/-/g, ' ')} vs ${complaint.driverName}`,
      link: '/admin/complaints',
    });

    res.status(201).json({ message: 'Complaint logged successfully', complaintId: complaint.complaintId, complaint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/complaints/passenger/my-complaints
router.get('/passenger/my-complaints', auth, roleMiddleware(['passenger']), async (req, res) => {
  const complaints = await Complaint.find({ complainantId: req.user.id })
    .populate('driverId', 'vehicleNumber vehicleType')
    .sort({ createdAt: -1 });
  res.json(complaints);
});

// GET /api/complaints/passenger/:complaintId
router.get('/passenger/:complaintId', auth, roleMiddleware(['passenger']), async (req, res) => {
  const complaint = await Complaint.findOne({ _id: req.params.complaintId, complainantId: req.user.id })
    .populate('driverId')
    .populate('driverComments.commentedBy', 'name');
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  res.json(complaint);
});

// PUT /api/complaints/passenger/:complaintId/reopen - if the passenger
// isn't satisfied with a resolved/closed outcome
router.put('/passenger/:complaintId/reopen', auth, roleMiddleware(['passenger']), async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required to reopen a complaint' });

  const complaint = await Complaint.findOne({ _id: req.params.complaintId, complainantId: req.user.id });
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  if (!['resolved', 'closed'].includes(complaint.status)) {
    return res.status(400).json({ error: 'Only a resolved or closed complaint can be reopened' });
  }

  const passenger = await User.findById(req.user.id);
  const updated = await Complaint.findByIdAndUpdate(req.params.complaintId, {
    status: 'investigating',
    $push: { adminNotes: { note: `Passenger reopened this complaint: ${reason}`, noteBy: req.user.id, noteByName: passenger.name, noteAt: new Date() } },
  });

  notifyAdmins({
    type: 'complaint-reopened',
    title: 'Complaint reopened by passenger',
    message: `${complaint.complaintId} - ${reason}`,
    link: '/admin/complaints',
  });
  runInBackground('email sendReopenedConfirmation', () => emailService.sendReopenedConfirmation(passenger.email, complaint));

  res.json({ message: 'Complaint reopened', complaint: updated });
});

/** DRIVER ROUTES */

// GET /api/complaints/driver/complaints-against-me
router.get('/driver/complaints-against-me', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const complaints = await Complaint.find({ driverId: driver._id })
    .populate('complainantId', 'name email')
    .populate('driverComments.commentedBy', 'name')
    .sort({ createdAt: -1 });
  res.json(complaints);
});

// GET /api/complaints/driver/:complaintId
router.get('/driver/:complaintId', auth, roleMiddleware(['driver']), async (req, res) => {
  const driver = await Driver.findOne({ userId: req.user.id });
  const complaint = await Complaint.findOne({ _id: req.params.complaintId, driverId: driver._id })
    .populate('complainantId', 'name email mobile')
    .populate('driverComments.commentedBy', 'name')
    .populate('adminNotes.noteBy', 'name');
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  res.json(complaint);
});

// POST /api/complaints/:complaintId/driver-comment
router.post('/:complaintId/driver-comment', auth, roleMiddleware(['driver']), async (req, res) => {
  try {
    const { comment } = req.body;
    if (!comment || !comment.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

    const driverUser = await User.findById(req.user.id);

    const complaint = await Complaint.findByIdAndUpdate(req.params.complaintId, {
      $push: {
        driverComments: {
          comment,
          commentedBy: req.user.id,
          commentedByName: driverUser.name,
          commentedByRole: 'driver',
          commentedAt: new Date(),
        },
      },
    }).populate('driverComments.commentedBy', 'name');

    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    const passenger = await User.findById(complaint.complainantId);
    if (passenger) {
      runInBackground('email sendDriverResponseNotification', () => emailService.sendDriverResponseNotification(passenger.email, complaint));
      notifyUser(passenger._id, {
        type: 'complaint-driver-response',
        title: 'Driver responded to your complaint',
        message: complaint.complaintId,
        link: '/passenger/complaints',
      });
    }

    res.json({ message: 'Comment added successfully', complaint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** ADMIN ROUTES */

// GET /api/complaints/admin/all-complaints
router.get('/admin/all-complaints', auth, roleMiddleware(['admin']), async (req, res) => {
  const { status, severity, isSerious, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (severity) filter.severity = severity;
  if (isSerious === 'true') filter.isSerious = true;

  const complaints = await Complaint.find(filter)
    .populate('complainantId', 'name email')
    .populate('driverId')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit, 10));

  const total = await Complaint.countDocuments(filter);
  res.json({ complaints, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) } });
});

// GET /api/complaints/admin/compliance-report - must come before /admin/:complaintId
router.get('/admin/compliance-report', auth, roleMiddleware(['admin']), async (req, res) => {
  const { startDate, endDate } = req.query;
  const filter = {};
  if (startDate && endDate) filter.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };

  const complaints = await Complaint.find(filter).select(
    'complaintId bookingRef complainantName complaintType description incidentDate incidentTime incidentLocation '
    + 'driverName vehicleNumber severity status resolutionSummary requiresTransportAgencyReport '
    + 'transportAgencyReportNumber requiresPoliceReport policeCaseNumber attachments createdAt',
  );

  res.json({
    message: 'Compliance report generated',
    reportPeriod: { startDate, endDate },
    totalComplaints: complaints.length,
    seriousIncidents: complaints.filter((c) => c.isSerious).length,
    complaints,
  });
});

// GET /api/complaints/admin/:complaintId
router.get('/admin/:complaintId', auth, roleMiddleware(['admin']), async (req, res) => {
  const complaint = await Complaint.findById(req.params.complaintId)
    .populate('complainantId')
    .populate('driverId')
    .populate('driverComments.commentedBy', 'name')
    .populate('adminNotes.noteBy', 'name');
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  res.json(complaint);
});

// PUT /api/complaints/admin/:complaintId/status
router.put('/admin/:complaintId/status', auth, roleMiddleware(['admin']), async (req, res) => {
  const { status, resolutionSummary } = req.body;
  const validStatuses = ['open', 'investigating', 'resolved', 'closed', 'escalated'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const update = { status };
  if (status === 'resolved' || status === 'closed') {
    update.resolutionDate = new Date();
    if (resolutionSummary) update.resolutionSummary = resolutionSummary;
  }

  let complaint = await Complaint.findByIdAndUpdate(req.params.complaintId, update);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

  const passenger = await User.findById(complaint.complainantId);
  if (passenger) {
    if (status === 'resolved' || status === 'closed') {
      runInBackground('email sendComplaintResolution', () => emailService.sendComplaintResolution(passenger.email, complaint));
    } else {
      runInBackground('email sendComplaintStatusChanged', () => emailService.sendComplaintStatusChanged(passenger.email, complaint));
    }
    notifyUser(passenger._id, {
      type: 'complaint-status',
      title: `Complaint ${status}`,
      message: complaint.complaintId,
      link: '/passenger/complaints',
    });
  }
  complaint = await Complaint.findByIdAndUpdate(req.params.complaintId, {
    complainantNotified: true,
    complainantNotifiedDate: new Date(),
    complainantNotifiedMethod: 'email',
  });

  res.json({ message: 'Complaint status updated', complaint });
});

// POST /api/complaints/admin/:complaintId/add-note
router.post('/admin/:complaintId/add-note', auth, roleMiddleware(['admin']), async (req, res) => {
  const { note } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ error: 'Note cannot be empty' });

  const admin = await User.findById(req.user.id);
  const complaint = await Complaint.findByIdAndUpdate(req.params.complaintId, {
    $push: { adminNotes: { note, noteBy: req.user.id, noteByName: admin.name, noteAt: new Date() } },
  }).populate('adminNotes.noteBy', 'name');

  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  res.json({ message: 'Note added successfully', complaint });
});

// PUT /api/complaints/admin/:complaintId/escalate
router.put('/admin/:complaintId/escalate', auth, roleMiddleware(['admin']), async (req, res) => {
  const { requiresPoliceReport, requiresTransportAgencyReport, transportAgencyReportNumber, policeCaseNumber } = req.body;

  const complaint = await Complaint.findByIdAndUpdate(req.params.complaintId, {
    isSerious: true,
    severity: 'critical',
    status: 'escalated',
    requiresPoliceReport: !!requiresPoliceReport,
    requiresTransportAgencyReport: !!requiresTransportAgencyReport,
    transportAgencyReportNumber,
    policeCaseNumber,
    transportAgencyReportedDate: new Date(),
  });
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

  runInBackground('email sendEscalationAlert', () => emailService.sendEscalationAlert(complaint));
  notifyAdmins({
    type: 'complaint-escalated',
    title: 'Complaint escalated',
    message: complaint.complaintId,
    link: '/admin/complaints',
  });
  res.json({ message: 'Complaint escalated successfully', complaint });
});

// POST /api/complaints/:complaintId/upload-document
router.post('/:complaintId/upload-document', auth, roleMiddleware(['admin']), upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const admin = await User.findById(req.user.id);

  const complaint = await Complaint.findByIdAndUpdate(req.params.complaintId, {
    $push: {
      attachments: {
        fileName: req.file.originalname,
        fileUrl: `/uploads/complaints/${req.file.filename}`,
        fileType: req.file.mimetype,
        uploadedAt: new Date(),
        uploadedBy: admin.name,
      },
    },
  });
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  res.json({ message: 'Document uploaded', complaint });
});

// DELETE /api/complaints/admin/archive-old - purge complaints past the 2-year NZ TA retention window
router.delete('/admin/archive-old', auth, roleMiddleware(['admin']), async (req, res) => {
  const result = await Complaint.deleteMany({ retentionExpiryDate: { $lt: new Date() } });
  res.json({ message: 'Old complaints archived', deletedCount: result.deletedCount });
});

module.exports = router;
