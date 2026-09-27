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
    timeZone: 'Pacific/Auckland', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    dayOfWeek: WEEKDAY_INDEX[get('weekday')],
    hhmm: `${get('hour')}:${get('minute')}`,
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

// A day's slot list, tolerant of the old one-slot-per-day shape
// ({enabled, startTime, endTime}) that every driver's schedule was saved as
// before multiple shifts per day existed - lets a schedule saved under the
// old format keep working exactly as before until the driver next edits and
// re-saves it (in the current {dayOfWeek, slots: [{startTime,endTime}]} shape).
function daySlots(day) {
  if (!day) return [];
  if (Array.isArray(day.slots)) return day.slots;
  return day.enabled ? [{ startTime: day.startTime, endTime: day.endTime }] : [];
}

// Is `driver` within one of their declared shifts at `now`? Two sources,
// most specific first:
//  1. dateSchedule - shifts entered for a specific calendar date on the
//     driver's Schedule page ([{date: 'YYYY-MM-DD', slots}]); an entry
//     with no slots is an explicit day off. Overrides the weekly pattern.
//  2. availabilitySchedule - the repeating weekly pattern (7 days).
// A date covered by neither is "not available" if the driver has declared
// any hours at all (weekly, or upcoming dated shifts), and always available
// if they've declared nothing - so this only restricts drivers who have
// actually set a schedule. A day can have more than one slot (e.g. a
// morning shift and a separate evening shift) - any one being current is
// enough.
function isWithinSchedule(driver, now = new Date()) {
  const weekly = Array.isArray(driver.availabilitySchedule) ? driver.availabilitySchedule : [];
  const dated = Array.isArray(driver.dateSchedule) ? driver.dateSchedule : [];
  const { dayOfWeek, hhmm, date } = nzDayAndTime(now);

  let slots;
  const dateEntry = dated.find((d) => d.date === date);
  if (dateEntry) {
    slots = dateEntry.slots || [];
  } else if (weekly.length > 0) {
    slots = daySlots(weekly.find((s) => s.dayOfWeek === dayOfWeek));
  } else {
    // Only upcoming dated shifts count as "declared hours" - once every
    // dated shift a driver entered has passed, they're back to unrestricted
    // rather than silently locked out.
    return !dated.some((d) => d.date >= date && (d.slots || []).length > 0);
  }

  return slots.some((slot) => hhmm >= slot.startTime && hhmm < slot.endTime);
}

// Has the driver declared any working hours at all (a weekly pattern, or
// dated shifts from today on)? isWithinSchedule() treats "nothing declared"
// as always available - callers that need a real answer for a future time
// (scheduled bookings) use this to tell the two apart.
function hasDeclaredSchedule(driver, now = new Date()) {
  const weekly = Array.isArray(driver.availabilitySchedule) ? driver.availabilitySchedule : [];
  if (weekly.length > 0) return true;
  const today = nzDayAndTime(now).date;
  const dated = Array.isArray(driver.dateSchedule) ? driver.dateSchedule : [];
  return dated.some((d) => d.date >= today && (d.slots || []).length > 0);
}

module.exports = { isWithinSchedule, hasDeclaredSchedule, nzDayAndTime, daySlots };
