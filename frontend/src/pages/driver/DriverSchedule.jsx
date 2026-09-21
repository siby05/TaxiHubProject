import { useEffect, useState } from 'react';
import client from '../../api/client';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

export default function DriverSchedule() {
  const [schedule, setSchedule] = useState(emptySchedule());
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.get('/driver/profile').then((r) => {
      if (Array.isArray(r.data.availabilitySchedule) && r.data.availabilitySchedule.length > 0) {
        setSchedule(normalize(r.data.availabilitySchedule));
      }
    });
  }, []);

  function addSlot(dayOfWeek) {
    setSaved(false);
    setSchedule((s) => s.map((d) => (d.dayOfWeek === dayOfWeek
      ? { ...d, slots: [...d.slots, { startTime: '09:00', endTime: '17:00' }] }
      : d)));
  }

  function removeSlot(dayOfWeek, index) {
    setSaved(false);
    setSchedule((s) => s.map((d) => (d.dayOfWeek === dayOfWeek
      ? { ...d, slots: d.slots.filter((_, i) => i !== index) }
      : d)));
  }

  function updateSlot(dayOfWeek, index, field, value) {
    setSaved(false);
    setSchedule((s) => s.map((d) => (d.dayOfWeek === dayOfWeek
      ? { ...d, slots: d.slots.map((slot, i) => (i === index ? { ...slot, [field]: value } : slot)) }
      : d)));
  }

  async function save() {
    setError('');
    setLoading(true);
    try {
      await client.put('/driver/schedule', { schedule });
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save schedule');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <h1>Weekly availability calendar</h1>
      <p className="muted">
        Set the days and hours you're normally available - add more than one shift on a day (e.g. a morning run and a
        separate evening run) if there's a gap in between you're not available. This is separate from the "Go
        online/offline" switch on your dashboard, which controls whether you can receive ride requests right now.
      </p>

      <div className="card">
        {schedule.map((day) => (
          <div key={day.dayOfWeek} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <strong>{DAY_NAMES[day.dayOfWeek]}</strong>
              <button type="button" className="btn secondary" onClick={() => addSlot(day.dayOfWeek)}>+ Add shift</button>
            </div>
            {day.slots.length === 0 && <p className="muted" style={{ margin: '6px 0 0' }}>Not available</p>}
            {day.slots.map((slot, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                <input type="time" value={slot.startTime} style={{ width: 130 }}
                  onChange={(e) => updateSlot(day.dayOfWeek, i, 'startTime', e.target.value)} />
                <span className="muted">to</span>
                <input type="time" value={slot.endTime} style={{ width: 130 }}
                  onChange={(e) => updateSlot(day.dayOfWeek, i, 'endTime', e.target.value)} />
                <button type="button" className="btn danger" onClick={() => removeSlot(day.dayOfWeek, i)}>Remove</button>
              </div>
            ))}
          </div>
        ))}

        {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
        {saved && <p className="muted" style={{ color: 'var(--success)', marginTop: 12 }}>Schedule saved.</p>}
        <button className="btn" style={{ marginTop: 16 }} onClick={save} disabled={loading}>{loading ? 'Saving...' : 'Save schedule'}</button>
      </div>
    </div>
  );
}
