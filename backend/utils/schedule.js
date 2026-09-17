// Is `driver` currently within a day/time slot they've marked enabled on
// their weekly availability calendar? A driver with no schedule set at all
// (empty/never-saved array) is treated as always-in-schedule, so this only
// restricts drivers who have actually declared hours.
function isWithinSchedule(driver, now = new Date()) {
  const schedule = driver.availabilitySchedule;
  if (!Array.isArray(schedule) || schedule.length === 0) return true;

  const slot = schedule.find((s) => s.dayOfWeek === now.getDay());
  if (!slot || !slot.enabled) return false;

  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hhmm >= slot.startTime && hhmm < slot.endTime;
}

module.exports = { isWithinSchedule };
