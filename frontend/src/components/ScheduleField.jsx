import { useState } from 'react';

// Optional "book for later" toggle. Reports the combined date+time as an
// ISO string via onChange, or null when scheduling is off (book now).
export default function ScheduleField({ onChange }) {
  const [enabled, setEnabled] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

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
