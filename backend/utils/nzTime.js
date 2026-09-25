// Display formatting only - the backend always works with real UTC
// instants (Date objects/ISO strings); only the frontend's date/time
// <input>s need the NZ-wall-clock <-> UTC conversion (see
// frontend/src/utils/nzTime.js). This mirrors that file's formatting so a
// time shown in an email/notification matches the same NZ 12-hour clock a
// passenger sees in the app, regardless of the server's own OS timezone
// (a real deployment like Render typically runs in UTC).
const NZ_TZ = 'Pacific/Auckland';

function formatNzDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-NZ', {
    timeZone: NZ_TZ, hour12: true, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatNzDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-NZ', { timeZone: NZ_TZ, year: 'numeric', month: 'short', day: 'numeric' });
}

// Today's NZ calendar date as "YYYYMMDD", for human-readable IDs like
// TRIP-20260925-00001. Plain getFullYear()/getDate() would use the
// server's own timezone - UTC on Render - which is still "yesterday" for
// the first 12-13 hours of every NZ day.
function nzDateStamp(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

module.exports = { formatNzDateTime, formatNzDate, nzDateStamp };
