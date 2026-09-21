const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Drivers set their schedule in NZ local time (this app has only ever
// operated in New Plymouth) - a schedule slot's dayOfWeek/startTime/
// endTime are meant as NZT/NZDT, not whatever timezone the server
// process happens to be running in. Computed explicitly via Intl rather
// than Date's own getDay()/getHours() (which use the *host's* local
// timezone) since a real deployment (Render) typically runs in UTC, a
// 12-13 hour offset from NZ - using the host's zone would check a
// driver's "9am-5pm" against a completely different 9am-5pm.
function nzDayAndTime(date) {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { dayOfWeek: WEEKDAY_INDEX[get('weekday')], hhmm: `${get('hour')}:${get('minute')}` };
}

// Is `driver` currently within a day/time slot they've marked enabled on
// their weekly availability calendar? A driver with no schedule set at all
// (empty/never-saved array) is treated as always-in-schedule, so this only
// restricts drivers who have actually declared hours.
function isWithinSchedule(driver, now = new Date()) {
  const schedule = driver.availabilitySchedule;
  if (!Array.isArray(schedule) || schedule.length === 0) return true;

  const { dayOfWeek, hhmm } = nzDayAndTime(now);
  const slot = schedule.find((s) => s.dayOfWeek === dayOfWeek);
  if (!slot || !slot.enabled) return false;

  return hhmm >= slot.startTime && hhmm < slot.endTime;
}

module.exports = { isWithinSchedule };
