import { useEffect, useState } from 'react';
import client from '../../api/client';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function emptySchedule() {
  return DAY_NAMES.map((_, dayOfWeek) => ({ dayOfWeek, enabled: false, startTime: '09:00', endTime: '17:00' }));
}

export default function DriverSchedule() {
  const [schedule, setSchedule] = useState(emptySchedule());
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.get('/driver/profile').then((r) => {
      if (Array.isArray(r.data.availabilitySchedule) && r.data.availabilitySchedule.length === 7) {
        setSchedule(r.data.availabilitySchedule);
      }
    });
  }, []);

  function updateDay(dayOfWeek, field, value) {
    setSaved(false);
    setSchedule((s) => s.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, [field]: value } : d)));
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
        Set the days and hours you're normally available. This is separate from the "Go online/offline" switch on
        your dashboard, which controls whether you can receive ride requests right now.
      </p>

      <div className="card">
        {schedule.map((day) => (
          <div key={day.dayOfWeek} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 140 }}>
              <input type="checkbox" checked={day.enabled} onChange={(e) => updateDay(day.dayOfWeek, 'enabled', e.target.checked)} style={{ width: 'auto' }} />
              {DAY_NAMES[day.dayOfWeek]}
            </label>
            <input type="time" value={day.startTime} disabled={!day.enabled} style={{ width: 130 }}
              onChange={(e) => updateDay(day.dayOfWeek, 'startTime', e.target.value)} />
            <span className="muted">to</span>
            <input type="time" value={day.endTime} disabled={!day.enabled} style={{ width: 130 }}
              onChange={(e) => updateDay(day.dayOfWeek, 'endTime', e.target.value)} />
          </div>
        ))}

        {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
        {saved && <p className="muted" style={{ color: 'var(--success)', marginTop: 12 }}>Schedule saved.</p>}
        <button className="btn" style={{ marginTop: 16 }} onClick={save} disabled={loading}>{loading ? 'Saving...' : 'Save schedule'}</button>
      </div>
    </div>
  );
}
