// This app has only ever operated in New Plymouth, NZ - every wall-clock
// time it shows or asks for (a scheduled pickup, a trip's timestamp) is
// meant as NZ local time, in a 12-hour clock, regardless of the viewer's
// own device timezone/locale. Mirrors the backend's own NZ-explicit
// handling in utils/schedule.js (see its nzDayAndTime()).
const NZ_TZ = 'Pacific/Auckland';

const DATE_TIME_OPTS = { timeZone: NZ_TZ, hour12: true, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
const DATE_OPTS = { timeZone: NZ_TZ, year: 'numeric', month: 'short', day: 'numeric' };
const TIME_OPTS = { timeZone: NZ_TZ, hour12: true, hour: 'numeric', minute: '2-digit' };

export function formatNzDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-NZ', DATE_TIME_OPTS);
}

export function formatNzDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-NZ', DATE_OPTS);
}

export function formatNzTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-NZ', TIME_OPTS);
}

// NZ's current UTC offset in minutes (+780 NZDT in summer / +720 NZST in
// winter) at the given instant - read via Intl rather than hardcoded,
// since it changes twice a year with daylight saving.
function nzOffsetMinutesAt(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: NZ_TZ, timeZoneName: 'shortOffset' }).formatToParts(date);
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+13';
  const match = raw.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return 13 * 60;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

// Converts a date+time typed into <input type="date">/<input type="time">
// (e.g. "2026-09-22", "14:30"), meant as NZ local wall-clock time, into the
// correct UTC instant - regardless of what timezone the browser itself is
// set to. A plain `new Date(`${date}T${time}`)` instead assumes the
// *browser's* local timezone, which silently breaks the moment a passenger
// (or their device) isn't set to NZ time: the resulting instant no longer
// lines up with a driver's availabilitySchedule, which the backend always
// interprets as NZ time (see utils/schedule.js) - this was written to fix
// exactly that "schedule vs shift" mismatch.
//
// Two-pass: first assume the wall-clock digits are UTC to get a rough
// instant, read NZ's offset there, apply it, then re-read the offset at
// that corrected instant (now within minutes of the true one) in case the
// first guess landed on the wrong side of a DST transition.
export function nzWallTimeToISO(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const naiveUtc = new Date(`${dateStr}T${timeStr}:00.000Z`);
  const pass1 = new Date(naiveUtc.getTime() - nzOffsetMinutesAt(naiveUtc) * 60000);
  const pass2 = new Date(naiveUtc.getTime() - nzOffsetMinutesAt(pass1) * 60000);
  return pass2.toISOString();
}

// Reverse of the above: splits a stored UTC instant back into the NZ local
// date/time strings an <input type="date">/<input type="time"> expects, so
// editing a scheduled trip pre-fills with what was actually typed rather
// than the viewer's own local time.
export function isoToNzDateTimeInputs(iso) {
  if (!iso) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

// Today's date in NZ time as "YYYY-MM-DD", for an <input type="date">'s
// min= - using the browser's own local date here could let someone whose
// device clock is already into "tomorrow" pick a date NZ still considers
// today, or vice versa.
export function todayNz() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
