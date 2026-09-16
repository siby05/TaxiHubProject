import { useEffect, useState } from 'react';
import client from '../../api/client';
import { useBookingStore } from '../../store/bookingStore';
import { useSocket } from '../../hooks/useSocket';
import StarRating from '../../components/StarRating';

export default function DriverDashboard() {
  const { bookings, fetchDriverBookings } = useBookingStore();
  const [profile, setProfile] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [fareInputs, setFareInputs] = useState({});
  const [alert, setAlert] = useState('');
  const [availError, setAvailError] = useState('');
  const [newRate, setNewRate] = useState('');
  const [rateMsg, setRateMsg] = useState('');

  function load() {
    fetchDriverBookings();
    client.get('/driver/profile').then((r) => setProfile(r.data));
    client.get('/driver/earnings').then((r) => setEarnings(r.data));
  }

  useEffect(() => { load(); }, []);

  useSocket({
    'booking:new': (booking) => {
      setAlert(`New ride request: ${booking.pickupAddress} → ${booking.dropAddress}`);
      load();
    },
  });

  async function toggleAvailable() {
    setAvailError('');
    try {
      const { data } = await client.put('/driver/availability', { isAvailable: !profile.isAvailable });
      setProfile(data);
    } catch (err) {
      setAvailError(err.response?.data?.error || 'Could not update availability');
    }
  }

  async function requestRate(e) {
    e.preventDefault();
    setRateMsg('');
    try {
      const { data } = await client.put('/driver/rate', { ratePerKm: Number(newRate) });
      setProfile(data.driver);
      setRateMsg(data.message);
      setNewRate('');
    } catch (err) {
      setRateMsg(err.response?.data?.error || 'Could not submit rate change');
    }
  }

  async function accept(id) {
    await client.put(`/booking/${id}/accept`);
    load();
  }

  async function complete(id) {
    const actualFare = Number(fareInputs[id]) || undefined;
    await client.put(`/booking/${id}/complete`, { actualFare });
    load();
  }

  async function ratePassenger(id, rating, review) {
    await client.put(`/booking/${id}/rate-passenger`, { rating, review });
    load();
  }

  return (
    <div className="container">
      <h1>Driver dashboard</h1>
      {alert && <div className="card" style={{ background: '#fef3c7' }}>{alert} <button className="btn secondary" onClick={() => setAlert('')}>Dismiss</button></div>}

      {profile && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong>{profile.vehicleType}</strong> · {profile.vehicleNumber} · ${profile.ratePerKm}/km
              <div className="muted">Status: <span className={`badge ${profile.status}`}>{profile.status}</span></div>
              {profile.pendingRatePerKm != null && (
                <div className="muted">Rate change to ${profile.pendingRatePerKm}/km pending admin approval</div>
              )}
            </div>
            <button className={`btn ${profile.isAvailable ? 'secondary' : ''}`} onClick={toggleAvailable} disabled={profile.status !== 'approved'}>
              {profile.isAvailable ? 'Go offline' : 'Go online'}
            </button>
          </div>
          {availError && <p className="error-text" style={{ marginTop: 10 }}>{availError}</p>}

          <form onSubmit={requestRate} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 160 }}>
              <label>Request new rate ($/km)</label>
              <input type="number" step="0.1" min="0.1" value={newRate} onChange={(e) => setNewRate(e.target.value)} required />
            </div>
            <button className="btn secondary">Submit for approval</button>
          </form>
          {rateMsg && <p className="muted" style={{ marginTop: 6 }}>{rateMsg}</p>}
        </div>
      )}

      {earnings && (
        <div className="grid cols-4">
          <div className="card stat"><div className="value">{earnings.totalTrips}</div><div className="label">Trips</div></div>
          <div className="card stat"><div className="value">${earnings.totalEarnings.toFixed(2)}</div><div className="label">Gross earnings</div></div>
          <div className="card stat"><div className="value">${earnings.estimatedGst.toFixed(2)}</div><div className="label">Est. GST (18%)</div></div>
          <div className="card stat"><div className="value">${earnings.netEarnings.toFixed(2)}</div><div className="label">Net earnings</div></div>
        </div>
      )}

      <div className="card">
        <h3>Bookings</h3>
        {bookings.length === 0 && <p className="muted">No bookings yet.</p>}
        <table>
          <tbody>
            {bookings.map((b) => (
              <tr key={b._id}>
                <td>
                  <div>{b.pickupAddress} → {b.dropAddress}</div>
                  <div className="muted">{b.passengerId?.name} · {b.distanceKm} km · est. ${b.estimatedFare}</div>
                  {b.status === 'completed' && !b.passengerRating && (
                    <StarRating label="Rate this passenger" submitLabel="Rate" onSubmit={(rating, review) => ratePassenger(b._id, rating, review)} />
                  )}
                  {b.passengerRating && <div className="muted">You rated: {'★'.repeat(b.passengerRating)}{'☆'.repeat(5 - b.passengerRating)}</div>}
                </td>
                <td><span className={`badge ${b.status}`}>{b.status}</span></td>
                <td>
                  {b.status === 'pending' && <button className="btn" onClick={() => accept(b._id)}>Accept</button>}
                  {(b.status === 'accepted' || b.status === 'in-progress') && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input style={{ width: 90 }} type="number" step="0.01" placeholder="Actual $"
                        value={fareInputs[b._id] || ''} onChange={(e) => setFareInputs((f) => ({ ...f, [b._id]: e.target.value }))} />
                      <button className="btn" onClick={() => complete(b._id)}>Complete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
