// NZTA work time rules (Land Transport Rule: Work Time and Logbooks 2007),
// which apply to small passenger service drivers, checked against the shifts
// a driver declares on their Schedule page:
//  - no more than 7 hours' continuous work without a rest break of at least
//    30 minutes (shifts less than 30 minutes apart count as continuous)
//  - no more than 13 hours' work in a day
//  - at least 10 continuous hours' rest between one day's last shift and the
//    next day's first shift
//  - no more than 70 hours' work before a break of at least 24 continuous hours
// Shifts never cross midnight (startTime < endTime on the same day), so the
// 10-hour rest between days is what separates one work day from the next.
const { daySlots } = require('./schedule');

const MIN_BREAK_MIN = 30;
const MAX_CONTINUOUS_MIN = 7 * 60;
const MAX_DAY_MIN = 13 * 60;
const MIN_REST_MIN = 10 * 60;
const LONG_REST_MIN = 24 * 60;
const MAX_PERIOD_MIN = 70 * 60;
const DAY_MIN = 24 * 60;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function hours(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateLabel(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// days: [{label, slots}] in consecutive calendar order. Returns every rule
// broken, as [{message, days: [indexes involved]}].
function findViolations(days) {
  const violations = [];
  const intervals = [];
  days.forEach((day, i) => {
    const sorted = [...day.slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
    let dayTotal = 0;
    for (const s of sorted) {
      const start = toMin(s.startTime);
      const end = toMin(s.endTime);
      dayTotal += end - start;
      intervals.push({ start: i * DAY_MIN + start, end: i * DAY_MIN + end, day: i });
    }
    if (dayTotal > MAX_DAY_MIN) {
      violations.push({ days: [i], message: `${day.label}: ${hours(dayTotal)} of shifts - NZTA allows at most 13 hours' work in a day.` });
    }
  });

  // Continuous work: shifts separated by less than a 30-minute break merge.
  let block = null;
  const closeBlock = () => {
    if (block && block.end - block.start > MAX_CONTINUOUS_MIN) {
      violations.push({ days: [block.day], message: `${days[block.day].label}: ${hours(block.end - block.start)} without a 30-minute break - NZTA allows at most 7 hours' continuous work.` });
    }
  };
  for (const iv of intervals) {
    if (block && iv.start - block.end < MIN_BREAK_MIN) {
      block.end = Math.max(block.end, iv.end);
    } else {
      closeBlock();
      block = { ...iv };
    }
  }
  closeBlock();

  // 10 hours' rest between consecutive days' shifts.
  for (let i = 1; i < intervals.length; i += 1) {
    const prev = intervals[i - 1];
    const next = intervals[i];
    if (next.day === prev.day + 1) {
      const rest = next.start - prev.end;
      if (rest < MIN_REST_MIN) {
        violations.push({
          days: [prev.day, next.day],
          message: `${days[next.day].label}: first shift starts only ${hours(rest)} after ${days[prev.day].label}'s last shift ends - NZTA requires at least 10 hours' rest between work days.`,
        });
      }
    }
  }

  // 70 hours' work before a 24-hour break.
  let period = null;
  const closePeriod = () => {
    if (period && period.total > MAX_PERIOD_MIN) {
      const involved = [];
      for (let d = period.firstDay; d <= period.lastDay; d += 1) involved.push(d);
      violations.push({
        days: involved,
        message: `${days[period.firstDay].label} to ${days[period.lastDay].label}: ${hours(period.total)} of shifts without a 24-hour break - NZTA allows at most 70 hours' work before a 24-hour break.`,
      });
    }
  };
  let lastEnd = null;
  for (const iv of intervals) {
    if (period && iv.start - lastEnd < LONG_REST_MIN) {
      period.total += iv.end - iv.start;
      period.lastDay = iv.day;
    } else {
      closePeriod();
      period = { total: iv.end - iv.start, firstDay: iv.day, lastDay: iv.day };
    }
    lastEnd = iv.end;
  }
  closePeriod();

  return violations;
}

// The weekly pattern on its own, repeated over three weeks so rest across
// Saturday -> Sunday and the 70-hour limit over a full cycle are checked.
// Returns an error message or null.
function checkWeeklyPattern(weekly) {
  const days = [];
  for (let i = 0; i < 21; i += 1) {
    const dayOfWeek = i % 7;
    days.push({ label: DAY_NAMES[dayOfWeek], slots: daySlots(weekly.find((d) => d.dayOfWeek === dayOfWeek)) });
  }
  const [first] = findViolations(days);
  return first ? first.message : null;
}

// The driver's effective shifts (a dated entry overrides the weekly pattern)
// for each date from `from` for `count` days.
function effectiveDays(weekly, dated, from, count) {
  const days = [];
  for (let i = 0; i < count; i += 1) {
    const date = addDays(from, i);
    const entry = dated.find((d) => d.date === date);
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    const slots = entry ? entry.slots || [] : daySlots(weekly.find((d) => d.dayOfWeek === dayOfWeek));
    days.push({ date, label: dateLabel(date), slots });
  }
  return days;
}

// Checks the combined schedule from yesterday (so today's first shift is
// checked against yesterday's last) to a year and a week ahead. Reports only
// rules broken involving a date `involves(date)` accepts - the date being
// edited, say - so an old problem elsewhere doesn't block an unrelated edit.
// Returns an error message or null.
function checkSchedule({ weekly = [], dated = [], today, involves = () => true }) {
  const from = addDays(today, -1);
  const days = effectiveDays(weekly, dated, from, 375);
  const hit = findViolations(days)
    .find((v) => v.days.some((i) => days[i].date >= today && involves(days[i].date)));
  return hit ? hit.message : null;
}

module.exports = { checkWeeklyPattern, checkSchedule, findViolations };
