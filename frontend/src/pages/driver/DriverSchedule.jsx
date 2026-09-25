import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../../api/client';
import Modal from '../../components/Modal';
import { todayNz } from '../../utils/nzTime';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Calendar columns, Monday-first (as NZ calendars are); values are getUTCDay() indexes.
const WEEK_COLUMNS = [1, 2, 3, 4, 5, 6, 0];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// How far ahead the calendar goes - matches the backend's one-year limit
// on PUT /driver/schedule/dates/:date.
const MONTHS_AHEAD = 12;
const AUTOSAVE_DELAY_MS = 700;

// Calendar colours per date state (see dateState()).
const STATE_STYLES = {
  scheduled: { background: '#dcfce7', border: '#16a34a', color: '#14532d', label: 'Scheduled' },
  off: { background: '#fee2e2', border: '#dc2626', color: '#7f1d1d', label: 'Not available' },
  unscheduled: { background: '#ffffff', border: '#cbd5e1', color: 'var(--text)', label: 'Not scheduled' },
  past: { background: '#f1f5f9', border: '#e2e8f0', color: 'var(--muted)' },
};

function emptySchedule() {
  return DAY_NAMES.map((_, dayOfWeek) => ({ dayOfWeek, slots: [] }));
}

// Accepts either the current shape ({dayOfWeek, slots: [{startTime,endTime}]})
// or the older one-slot-per-day shape ({dayOfWeek, enabled, startTime,
// endTime}) a driver's schedule may still be saved as from before multiple
// shifts per day existed, so opening this page never wipes out hours they
// already set.
function normalize(schedule) {
  return DAY_NAMES.map((_, dayOfWeek) => {
    const day = schedule.find((d) => d.dayOfWeek === dayOfWeek);
    if (!day) return { dayOfWeek, slots: [] };
    if (Array.isArray(day.slots)) return { dayOfWeek, slots: day.slots };
    return { dayOfWeek, slots: day.enabled ? [{ startTime: day.startTime, endTime: day.endTime }] : [] };
  });
}

// Calendar dates are plain "YYYY-MM-DD" strings (NZ calendar dates, as the
// backend stores them) - date math goes through UTC midnight so the
// browser's own timezone never shifts a day.
function utcDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`);
}

function weekdayOf(dateStr) {
  return utcDate(dateStr).getUTCDay();
}

function addMonths(monthStr, n) {
  const d = utcDate(`${monthStr}-01`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

// The dates to draw for a "YYYY-MM" month: leading blanks (null) to line
// the 1st up under its weekday column, then every day of the month.
function monthCells(monthStr) {
  const first = utcDate(`${monthStr}-01`);
  const cells = Array(WEEK_COLUMNS.indexOf(first.getUTCDay())).fill(null);
  for (const d = new Date(first); d.toISOString().slice(0, 7) === monthStr; d.setUTCDate(d.getUTCDate() + 1)) {
    cells.push(d.toISOString().slice(0, 10));
  }
  return cells;
}

// "17:30" -> "5:30pm", "09:00" -> "9am" - compact enough for a calendar cell.
function shortTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

function longDate(dateStr) {
  const d = utcDate(dateStr);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Only fully-typed shifts get saved - a half-filled row (e.g. a start time
// but no end yet) is skipped until it's complete, so auto-save never sends
// a shift the driver is still typing. Returns an error for anything that
// can't be saved as-is.
function checkSlots(slots) {
  const complete = slots.filter((s) => s.startTime && s.endTime);
  if (complete.some((s) => s.startTime >= s.endTime)) return { error: 'Each shift must end after it starts.' };
  const sorted = [...complete].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].startTime < sorted[i - 1].endTime) return { error: 'Shifts overlap - adjust the times so they don’t.' };
  }
  return { slots: sorted.map(({ startTime, endTime }) => ({ startTime, endTime })) };
}

// Runs save() AUTOSAVE_DELAY_MS after the last call to schedule(), with
// flush() to save immediately (e.g. when the dialog is closed mid-wait).
function useDebouncedSave(save) {
  const timer = useRef(null);
  const pending = useRef(null);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const fn = pending.current;
    pending.current = null;
    if (fn) fn();
  }, []);
  const schedule = useCallback((...args) => {
    clearTimeout(timer.current);
    pending.current = () => save(...args);
    timer.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  }, [save, flush]);
  useEffect(() => flush, [flush]);
  return { schedule, flush };
}

function SaveStatus({ status, error }) {
  if (error) return <span className="error-text">{error}</span>;
  if (status === 'saving') return <span className="muted">Saving...</span>;
  if (status === 'saved') return <span style={{ color: 'var(--success)' }}>All changes saved</span>;
  return null;
}

function SlotRow({ slot, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
      <input type="time" value={slot.startTime} style={{ width: 130 }} aria-label="Shift start"
        onChange={(e) => onChange({ ...slot, startTime: e.target.value })} />
      <span className="muted">to</span>
      <input type="time" value={slot.endTime} style={{ width: 130 }} aria-label="Shift end"
        onChange={(e) => onChange({ ...slot, endTime: e.target.value })} />
      <button type="button" className="btn danger" onClick={onRemove}>Remove</button>
    </div>
  );
}

// The dialog opened by tapping a calendar date. Edits auto-save (debounced)
// as a date-specific entry that overrides the weekly hours for that day.
function DateShiftsDialog({ date, entry, weeklySlots, onSaved, onClose }) {
  // A date with no entry of its own starts from the weekly hours (if any)
  // - or one blank shift ready to type into - without saving anything
  // until the driver actually changes something.
  const [draft, setDraft] = useState(() => {
    if (entry) return entry.slots;
    if (weeklySlots.length) return weeklySlots;
    return [{ startTime: '', endTime: '' }];
  });
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  const save = useCallback(async (slots) => {
    setStatus('saving');
    try {
      const r = slots === null
        ? await client.delete(`/driver/schedule/dates/${date}`)
        : await client.put(`/driver/schedule/dates/${date}`, { slots });
      onSaved(r.data.dateSchedule || []);
      setStatus('saved');
      setError('');
    } catch (err) {
      setStatus('idle');
      setError(err.response?.data?.error || 'Could not save - check your connection and try again');
    }
  }, [date, onSaved]);
  const { schedule: scheduleSave, flush } = useDebouncedSave(save);

  function edit(next) {
    setDraft(next);
    const checked = checkSlots(next);
    setError(checked.error || '');
    if (!checked.error) scheduleSave(checked.slots);
  }

  function close() {
    flush();
    onClose();
  }

  function markDayOff() {
    setDraft([]);
    setError('');
    scheduleSave([]);
    flush();
  }

  function resetToWeekly() {
    setDraft(weeklySlots.length ? weeklySlots : [{ startTime: '', endTime: '' }]);
    setError('');
    scheduleSave(null);
    flush();
  }

  const isDayOff = entry && entry.slots.length === 0 && draft.length === 0;

  return (
    <Modal title={longDate(date)} onClose={close}>
      <p className="muted" style={{ marginTop: 0 }}>
        {entry
          ? 'Shifts for this date only - they replace your weekly hours for the day.'
          : weeklySlots.length
            ? 'This date follows your weekly hours. Change anything below to set different shifts for just this date.'
            : 'Enter your shift for this date. It saves automatically.'}
      </p>

      {isDayOff && (
        <div style={{
          padding: '10px 12px', borderRadius: 6, fontWeight: 600,
          background: STATE_STYLES.off.background, border: `1px solid ${STATE_STYLES.off.border}`, color: STATE_STYLES.off.color,
        }}>
          Not available - not working this entire day. Add a shift below if that changes.
        </div>
      )}
      {draft.map((slot, i) => (
        <SlotRow key={i} slot={slot}
          onChange={(next) => edit(draft.map((s, j) => (j === i ? next : s)))}
          onRemove={() => edit(draft.filter((_, j) => j !== i))} />
      ))}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        <button type="button" className="btn secondary"
          onClick={() => setDraft([...draft, { startTime: '', endTime: '' }])}>+ Add shift</button>
        {!isDayOff && (
          <button type="button" className="btn danger" onClick={markDayOff}>Not available (whole day)</button>
        )}
        {entry && (
          <button type="button" className="btn secondary" onClick={resetToWeekly}>
            {weeklySlots.length ? 'Use weekly hours' : 'Clear this date'}
          </button>
        )}
      </div>

      <p style={{ marginBottom: 0, minHeight: '1.2em' }}><SaveStatus status={status} error={error} /></p>
    </Modal>
  );
}

// A date is one of: scheduled (has shifts - its own, or from the weekly
// hours), off (explicitly marked not available for the whole day), or
// unscheduled (nothing set). Each gets its own colour so a month reads at a
// glance; past dates are greyed out whatever they held.
function dateState(entry, weeklySlots) {
  if (entry) return entry.slots.length ? 'scheduled' : 'off';
  return weeklySlots.length ? 'scheduled' : 'unscheduled';
}

function CalendarCell({ date, today, entry, weeklySlots, onOpen }) {
  if (!date) return <div />;
  const isPast = date < today;
  const slots = entry ? entry.slots : weeklySlots;
  const dayNum = Number(date.slice(8));
  const state = dateState(entry, weeklySlots);
  const colours = isPast ? STATE_STYLES.past : STATE_STYLES[state];

  let body = null;
  if (state === 'off') body = <div style={{ fontWeight: 600 }}>Not available</div>;
  else if (slots.length) {
    body = slots.map((s) => (
      <div key={`${s.startTime}-${s.endTime}`}>{shortTime(s.startTime)}–{shortTime(s.endTime)}</div>
    ));
  }

  return (
    <button
      type="button"
      disabled={isPast}
      onClick={() => onOpen(date)}
      title={isPast ? 'Past date' : 'Set shifts for this date'}
      style={{
        minHeight: 72, padding: 6, textAlign: 'left', verticalAlign: 'top', font: 'inherit',
        display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, overflow: 'hidden',
        border: `${date === today ? 2 : 1}px solid ${date === today ? 'var(--primary)' : colours.border}`,
        borderRadius: 6,
        background: colours.background,
        color: colours.color,
        cursor: isPast ? 'default' : 'pointer',
      }}
    >
      <strong style={{ fontSize: '0.9rem' }}>{dayNum}</strong>
      <div style={{ fontSize: '0.7rem', lineHeight: 1.3, wordBreak: 'break-word' }}>{body}</div>
    </button>
  );
}

function WeeklyHours({ schedule, setSchedule }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  const save = useCallback(async (next) => {
    setStatus('saving');
    try {
      await client.put('/driver/schedule', { schedule: next });
      setStatus('saved');
      setError('');
    } catch (err) {
      setStatus('idle');
      setError(err.response?.data?.error || 'Could not save schedule');
    }
  }, []);
  const { schedule: scheduleSave } = useDebouncedSave(save);

  function editDay(dayOfWeek, slots) {
    const next = schedule.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, slots } : d));
    setSchedule(next);
    const cleaned = [];
    for (const day of next) {
      const checked = checkSlots(day.slots);
      if (checked.error) { setError(`${DAY_NAMES[day.dayOfWeek]}: ${checked.error}`); return; }
      cleaned.push({ dayOfWeek: day.dayOfWeek, slots: checked.slots });
    }
    setError('');
    scheduleSave(cleaned);
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Repeating weekly hours</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Optional - hours that repeat every week, so you don't have to enter each date. Any date you set on the
        calendar above overrides these for that day.
      </p>
      {schedule.map((day) => (
        <div key={day.dayOfWeek} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <strong>{DAY_NAMES[day.dayOfWeek]}</strong>
            <button type="button" className="btn secondary"
              onClick={() => editDay(day.dayOfWeek, [...day.slots, { startTime: '09:00', endTime: '17:00' }])}>+ Add shift</button>
          </div>
          {day.slots.length === 0 && <p className="muted" style={{ margin: '6px 0 0' }}>Not available</p>}
          {day.slots.map((slot, i) => (
            <SlotRow key={i} slot={slot}
              onChange={(next) => editDay(day.dayOfWeek, day.slots.map((s, j) => (j === i ? next : s)))}
              onRemove={() => editDay(day.dayOfWeek, day.slots.filter((_, j) => j !== i))} />
          ))}
        </div>
      ))}
      <p style={{ marginBottom: 0, minHeight: '1.2em' }}><SaveStatus status={status} error={error} /></p>
    </div>
  );
}

export default function DriverSchedule() {
  const today = todayNz();
  const firstMonth = today.slice(0, 7);
  const lastMonth = addMonths(firstMonth, MONTHS_AHEAD);

  const [weekly, setWeekly] = useState(emptySchedule());
  const [dated, setDated] = useState([]);
  const [month, setMonth] = useState(firstMonth);
  const [openDate, setOpenDate] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    client.get('/driver/profile').then((r) => {
      if (Array.isArray(r.data.availabilitySchedule) && r.data.availabilitySchedule.length > 0) {
        setWeekly(normalize(r.data.availabilitySchedule));
      }
      if (Array.isArray(r.data.dateSchedule)) setDated(r.data.dateSchedule);
    }).catch(() => setLoadError('Could not load your schedule - refresh to try again.'));
  }, []);

  const entryFor = (date) => dated.find((d) => d.date === date);
  const weeklyFor = (date) => weekly.find((d) => d.dayOfWeek === weekdayOf(date))?.slots || [];
  const [year, monthIndex] = month.split('-').map(Number);

  return (
    <div className="container">
      <h1>My schedule</h1>
      <p className="muted">
        Tap a date to enter your shifts for that day - you can plan up to a year ahead, and everything saves
        automatically. This is separate from the "Go online/offline" switch on your dashboard, which controls whether
        you can receive ride requests right now.
      </p>
      {loadError && <p className="error-text">{loadError}</p>}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <button type="button" className="btn secondary" aria-label="Previous month"
            disabled={month <= firstMonth} onClick={() => setMonth(addMonths(month, -1))}>‹</button>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{MONTH_NAMES[monthIndex - 1]} {year}</h2>
          <button type="button" className="btn secondary" aria-label="Next month"
            disabled={month >= lastMonth} onClick={() => setMonth(addMonths(month, 1))}>›</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
          {WEEK_COLUMNS.map((d) => (
            <div key={d} className="muted" style={{ textAlign: 'center', fontSize: '0.75rem', fontWeight: 600 }}>
              {DAY_NAMES[d].slice(0, 3)}
            </div>
          ))}
          {monthCells(month).map((date, i) => (
            <CalendarCell key={date || `blank-${i}`} date={date} today={today}
              entry={date && entryFor(date)} weeklySlots={date ? weeklyFor(date) : []} onOpen={setOpenDate} />
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 12, fontSize: '0.8rem' }}>
          {['scheduled', 'off', 'unscheduled'].map((state) => (
            <span key={state} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 14, height: 14, borderRadius: 3,
                background: STATE_STYLES[state].background, border: `1px solid ${STATE_STYLES[state].border}`,
              }} />
              {STATE_STYLES[state].label}
            </span>
          ))}
        </div>
      </div>

      <WeeklyHours schedule={weekly} setSchedule={setWeekly} />

      {openDate && (
        <DateShiftsDialog
          key={openDate}
          date={openDate}
          entry={entryFor(openDate)}
          weeklySlots={weeklyFor(openDate)}
          onSaved={setDated}
          onClose={() => setOpenDate(null)}
        />
      )}
    </div>
  );
}
