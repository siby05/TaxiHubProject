import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';
import { useBookingStore } from '../../store/bookingStore';
import { useSocket } from '../../hooks/useSocket';

export default function PassengerDashboard() {
  const { bookings, fetchMine, createBooking } = useBookingStore();
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState({
    pickupAddress: '', pickupLat: '', pickupLng: '', dropAddress: '', dropLat: '', dropLng: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  function refresh() {
    fetchMine();
    client.get('/passenger/stats').then((r) => setStats(r.data)).catch(() => {});
  }

  useEffect(() => { refresh(); }, []);

  useSocket({
    'booking:accepted': () => { setNotice('A driver accepted your ride!'); refresh(); },
    'booking:started': () => { setNotice('Your trip has started.'); refresh(); },
    'booking:completed': () => { setNotice('Your trip is complete.'); refresh(); },
    'booking:cancelled': () => { setNotice('A booking was cancelled.'); refresh(); },
  });

  async function onBook(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await createBooking({
        ...form,
        pickupLat: Number(form.pickupLat),
        pickupLng: Number(form.pickupLng),
        dropLat: Number(form.dropLat),
        dropLng: Number(form.dropLng),
      });
      setForm({ pickupAddress: '', pickupLat: '', pickupLng: '', dropAddress: '', dropLat: '', dropLng: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create booking');
    } finally {
      setLoading(false);
    }
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <div className="container">
      <h1>Passenger dashboard</h1>
      {notice && <div className="card" style={{ background: '#dcfce7' }}>{notice} <button className="btn secondary" onClick={() => setNotice('')}>Dismiss</button></div>}

      {stats && (
        <div className="grid cols-4">
          <div className="card stat"><div className="value">{stats.totalTrips}</div><div className="label">Completed trips</div></div>
          <div className="card stat"><div className="value">{stats.activeBookings}</div><div className="label">Active bookings</div></div>
          <div className="card stat"><div className="value">${stats.totalSpent.toFixed(2)}</div><div className="label">Total spent</div></div>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <h3>Book a ride</h3>
          <p className="muted">Enter approximate coordinates for pickup/drop (e.g. from Google Maps "copy coordinates").</p>
          <form onSubmit={onBook}>
            <div><label>Pickup address</label><input value={form.pickupAddress} onChange={(e) => update('pickupAddress', e.target.value)} required /></div>
            <div className="grid cols-2">
              <div><label>Pickup latitude</label><input type="number" step="any" value={form.pickupLat} onChange={(e) => update('pickupLat', e.target.value)} required /></div>
              <div><label>Pickup longitude</label><input type="number" step="any" value={form.pickupLng} onChange={(e) => update('pickupLng', e.target.value)} required /></div>
            </div>
            <div><label>Drop address</label><input value={form.dropAddress} onChange={(e) => update('dropAddress', e.target.value)} required /></div>
            <div className="grid cols-2">
              <div><label>Drop latitude</label><input type="number" step="any" value={form.dropLat} onChange={(e) => update('dropLat', e.target.value)} required /></div>
              <div><label>Drop longitude</label><input type="number" step="any" value={form.dropLng} onChange={(e) => update('dropLng', e.target.value)} required /></div>
            </div>
            {error && <p className="error-text">{error}</p>}
            <button className="btn" disabled={loading}>{loading ? 'Booking...' : 'Request ride'}</button>
          </form>
        </div>

        <div className="card">
          <h3>My bookings</h3>
          {bookings.length === 0 && <p className="muted">No bookings yet.</p>}
          <table>
            <tbody>
              {bookings.map((b) => (
                <tr key={b._id}>
                  <td>
                    <div>{b.pickupAddress} → {b.dropAddress}</div>
                    <div className="muted">{b.distanceKm} km · ${b.actualFare ?? b.estimatedFare}</div>
                  </td>
                  <td><span className={`badge ${b.status}`}>{b.status}</span></td>
                  <td>{b.status === 'completed' && <Link to="/passenger/complaints/new" state={{ bookingId: b._id, driverName: b.driverId?.userId?.name }}>Lodge complaint</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
