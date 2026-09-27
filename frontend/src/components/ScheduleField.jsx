import { useState } from 'react';
import TimeSelect from './TimeSelect';
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
    // minWidth: 0 - this sits directly inside a `display:flex` <form>
    // (flex-direction: column). A flex item's default min-width is
    // "auto", i.e. it refuses to shrink below its content's own intrinsic
    // minimum - and a native date/time picker's intrinsic width can
    // exceed the form's actual width on a narrow phone screen, pushing it
    // past the card's edge (align-items: stretch still sets the *target*
    // width, but without this the item won't actually shrink to it).
    <div style={{ minWidth: 0 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={enabled} onChange={(e) => toggle(e.target.checked)} />
        Schedule for later (instead of now)
      </label>
      {enabled && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <label>Date</label>
            <input type="date" min={today} value={date} required onChange={(e) => update(e.target.value, time)}
              style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <label>Time</label>
            <TimeSelect value={time} required ariaLabel="Time" onChange={(t) => update(date, t)} />
          </div>
        </div>
      )}
    </div>
  );
}
