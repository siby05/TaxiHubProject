const { createModel } = require('../lib/createModel');
const { nzDateStamp } = require('../utils/nzTime');

/**
 * Carried over from the previous session's Complaint.js (Mongoose schema),
 * adapted onto the in-memory Model API. NZ Transport Agency compliance
 * fields are preserved: complaintId format, 2-year retention, serious-
 * incident escalation (police / transport agency), driver + admin comment
 * trails, and attachment evidence.
 *
 * complaintType: 'driver-behaviour' | 'vehicle-condition' | 'safety-concern'
 *   | 'route-issue' | 'payment-issue' | 'vehicle-cleanliness'
 *   | 'reckless-driving' | 'assault-violence' | 'sexual-offence'
 *   | 'dui-drugs' | 'other'
 * severity: 'low' | 'medium' | 'high' | 'critical'
 * status: 'open' | 'investigating' | 'resolved' | 'closed' | 'escalated'
 */
const Complaint = createModel('Complaint', {
  complainantId: 'User',
  driverId: 'Driver',
  bookingId: 'Booking',
  'driverComments.commentedBy': 'User',
  'adminNotes.noteBy': 'User',
});

const SERIOUS_TYPES = ['assault-violence', 'sexual-offence', 'dui-drugs'];

Complaint.pre(async (doc, collection) => {
  if (!doc.complaintId) {
    const count = collection.docs.length;
    const dateStr = nzDateStamp();
    doc.complaintId = `COMP-${dateStr}-${String(count + 1).padStart(5, '0')}`;
  }
  if (!doc.status) doc.status = 'open';
  if (!doc.severity) doc.severity = SERIOUS_TYPES.includes(doc.complaintType) ? 'critical' : 'medium';
  if (doc.isSerious == null) doc.isSerious = SERIOUS_TYPES.includes(doc.complaintType);
  if (doc.requiresTransportAgencyReport == null) doc.requiresTransportAgencyReport = doc.isSerious;
  if (doc.requiresPoliceReport == null) doc.requiresPoliceReport = doc.isSerious;
  if (!doc.retentionExpiryDate) doc.retentionExpiryDate = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);
  if (!doc.driverComments) doc.driverComments = [];
  if (!doc.adminNotes) doc.adminNotes = [];
  if (!doc.attachments) doc.attachments = [];
  if (doc.complainantNotified == null) doc.complainantNotified = false;
});

module.exports = Complaint;
module.exports.SERIOUS_TYPES = SERIOUS_TYPES;
