import { useState } from 'react';

// Optional "book for later" toggle. Reports the combined date+time as an
// ISO string via onChange, or null when scheduling is off (book now). Pass
// defaultValue (an ISO string, e.g. an existing booking's scheduledFor) to
// pre-fill and start toggled on - used when editing an already-scheduled trip.
function pad(n) { return String(n).padStart(2, '0'); }

export default function ScheduleField({ onChange, defaultValue }) {
  // Date/time <input> values are local, but a stored scheduledFor is a UTC
  // ISO string - pull local components back out rather than slicing the
  // ISO string directly, or the pre-filled time would be off by the
  // viewer's UTC offset.
  const initial = defaultValue ? new Date(defaultValue) : null;
  const [enabled, setEnabled] = useState(!!initial);
  const [date, setDate] = useState(initial ? `${initial.getFullYear()}-${pad(initial.getMonth() + 1)}-${pad(initial.getDate())}` : '');
  const [time, setTime] = useState(initial ? `${pad(initial.getHours())}:${pad(initial.getMinutes())}` : '');

  function toggle(checked) {
    setEnabled(checked);
    onChange(checked && date && time ? new Date(`${date}T${time}`).toISOString() : null);
  }

  function update(nextDate, nextTime) {
    setDate(nextDate);
    setTime(nextTime);
    onChange(enabled && nextDate && nextTime ? new Date(`${nextDate}T${nextTime}`).toISOString() : null);
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={enabled} onChange={(e) => toggle(e.target.checked)} />
        Schedule for later (instead of now)
      </label>
      {enabled && (
        <div className="grid cols-2" style={{ marginTop: 8 }}>
          <div>
            <label>Date</label>
            <input type="date" min={today} value={date} required onChange={(e) => update(e.target.value, time)} />
          </div>
          <div>
            <label>Time</label>
            <input type="time" value={time} required onChange={(e) => update(date, e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}
