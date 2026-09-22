const Booking = require('../models/Booking');
const User = require('../models/User');
const Driver = require('../models/Driver');
const { emailService } = require('../services/emailService');
const { notifyUser } = require('./notify');
const { formatNzDateTime } = require('./nzTime');

const HOUR = 60 * 60 * 1000;

// Each reminder fires exactly once per booking, tracked by its flag on the
// booking regardless of poll cadence. The 2-hour one is driver-only: it's
// the "leave now / plan your run" nudge, which the passenger doesn't need
// on top of their 24h and 1h ones.
const REMINDERS = [
  { flag: 'reminderDayEmailSent', within: 24 * HOUR, label: 'tomorrow', to: ['passenger', 'driver'] },
  { flag: 'reminderTwoHourDriverEmailSent', within: 2 * HOUR, label: 'in about 2 hours', to: ['driver'] },
  { flag: 'reminderHourEmailSent', within: HOUR, label: 'in about 1 hour', to: ['passenger', 'driver'] },
];

/**
 * Polls for scheduled (not-yet-completed) trips and fires reminder emails
 * + in-app notifications as each trip crosses the marks above.
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

    const due = REMINDERS.filter((r) => msUntil <= r.within && !booking[r.flag]);
    if (!due.length) continue;

    const [passenger, driver] = await Promise.all([
      User.findById(booking.passengerId),
      Driver.findById(booking.driverId).then((d) => (d ? User.findById(d.userId) : null)),
    ]);

    // When several marks are crossed at once (e.g. the process was down),
    // each recipient gets only the most imminent reminder, not a backlog.
    const byRole = { passenger, driver };
    const sentTo = new Set();
    for (const r of [...due].sort((a, b) => a.within - b.within)) {
      for (const role of r.to) {
        const recipient = byRole[role];
        if (!recipient || sentTo.has(role)) continue;
        sentTo.add(role);
        await emailService.sendTripReminder(recipient.email, booking, r.label);
        await notifyUser(recipient._id, {
          type: 'trip-reminder',
          title: `Trip reminder - ${r.label}`,
          message: `${booking.pickupAddress} → ${booking.dropAddress} at ${formatNzDateTime(booking.scheduledFor)}`,
          link: role === 'passenger' ? '/passenger' : '/driver',
        });
      }
    }

    await Booking.findByIdAndUpdate(booking._id, Object.fromEntries(due.map((r) => [r.flag, true])));
  }
}

function startReminderScheduler(intervalMs = 5 * 60 * 1000) {
  checkReminders().catch((err) => console.error('[reminders] initial check failed:', err));
  return setInterval(() => {
    checkReminders().catch((err) => console.error('[reminders] check failed:', err));
  }, intervalMs);
}

module.exports = { startReminderScheduler, checkReminders };
