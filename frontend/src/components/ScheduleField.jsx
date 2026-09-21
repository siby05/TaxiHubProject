import { useState } from 'react';
import { nzWallTimeToISO, isoToNzDateTimeInputs, todayNz } from '../utils/nzTime';

// Optional "book for later" toggle. Reports the combined date+time as an
// ISO string via onChange, or null when scheduling is off (book now). Pass
// defaultValue (an ISO string, e.g. an existing booking's scheduledFor) to
// pre-fill and start toggled on - used when editing an already-scheduled trip.
//
// The date/time <input>s are always read/written as NZ local wall-clock
// time (via nzWallTimeToISO/isoToNzDateTimeInputs), not the viewer's own
// device timezone - this app only ever operates in NZ, and a driver's
// availabilitySchedule is likewise always interpreted as NZ time (see
// backend/utils/schedule.js), so building this from the browser's local
// zone would silently mismatch a driver's shift for anyone not on NZ time.
export default function ScheduleField({ onChange, defaultValue }) {
  const initial = defaultValue ? isoToNzDateTimeInputs(defaultValue) : null;
  const [enabled, setEnabled] = useState(!!initial);
  const [date, setDate] = useState(initial?.date || '');
  const [time, setTime] = useState(initial?.time || '');

  function toggle(checked) {
    setEnabled(checked);
    onChange(checked && date && time ? nzWallTimeToISO(date, time) : null);
  }

  function update(nextDate, nextTime) {
    setDate(nextDate);
    setTime(nextTime);
    onChange(enabled && nextDate && nextTime ? nzWallTimeToISO(nextDate, nextTime) : null);
  }

  const today = todayNz();

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={enabled} onChange={(e) => toggle(e.target.checked)} />
        Schedule for later (instead of now)
      </label>
      {enabled && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
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
