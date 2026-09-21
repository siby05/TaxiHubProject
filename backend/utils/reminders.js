const Booking = require('../models/Booking');
const User = require('../models/User');
const Driver = require('../models/Driver');
const { emailService } = require('../services/emailService');
const { notifyUser } = require('./notify');
const { formatNzDateTime } = require('./nzTime');

/**
 * Polls for scheduled (not-yet-completed) trips and fires a reminder email
 * + in-app notification to both passenger and driver once a trip crosses
 * the 24h and 1h marks - each fires exactly once per booking (tracked via
 * reminderDayEmailSent/reminderHourEmailSent), regardless of poll cadence.
 *
 * Caveat: this is an in-process interval, not a real cron - it only runs
 * while this Node process is up, and doesn't coordinate across multiple
 * instances. Fine for a single-instance deployment; a real job queue would
 * be needed to scale beyond that.
 */
async function checkReminders() {
  const now = Date.now();
  const upcoming = await Booking.find({ status: { $in: ['pending', 'accepted'] } });

  for (const booking of upcoming) {
    if (!booking.scheduledFor) continue;
    const msUntil = new Date(booking.scheduledFor).getTime() - now;
    if (msUntil <= 0) continue;

    const dueForDay = msUntil <= 24 * 60 * 60 * 1000 && !booking.reminderDayEmailSent;
    const dueForHour = msUntil <= 60 * 60 * 1000 && !booking.reminderHourEmailSent;
    if (!dueForDay && !dueForHour) continue;

    const whenLabel = dueForHour ? 'in about 1 hour' : 'tomorrow';
    const [passenger, driver] = await Promise.all([
      User.findById(booking.passengerId),
      Driver.findById(booking.driverId).then((d) => (d ? User.findById(d.userId) : null)),
    ]);

    for (const recipient of [passenger, driver].filter(Boolean)) {
      await emailService.sendTripReminder(recipient.email, booking, whenLabel);
      await notifyUser(recipient._id, {
        type: 'trip-reminder',
        title: `Trip reminder - ${whenLabel}`,
        message: `${booking.pickupAddress} → ${booking.dropAddress} at ${formatNzDateTime(booking.scheduledFor)}`,
        link: recipient._id === passenger._id ? '/passenger' : '/driver',
      });
    }

    await Booking.findByIdAndUpdate(booking._id, {
      ...(dueForDay && { reminderDayEmailSent: true }),
      ...(dueForHour && { reminderHourEmailSent: true }),
    });
  }
}

function startReminderScheduler(intervalMs = 5 * 60 * 1000) {
  checkReminders().catch((err) => console.error('[reminders] initial check failed:', err));
  return setInterval(() => {
    checkReminders().catch((err) => console.error('[reminders] check failed:', err));
  }, intervalMs);
}

module.exports = { startReminderScheduler, checkReminders };
