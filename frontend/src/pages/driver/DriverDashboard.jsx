import { useEffect, useState } from 'react';
import client from '../../api/client';
import { useBookingStore } from '../../store/bookingStore';
import { useSocket } from '../../hooks/useSocket';
import StarRating from '../../components/StarRating';
import { notificationPermission, requestNotificationPermission, showBrowserNotification } from '../../utils/browserNotify';
import { waLink, newTripMessage, driverArrivedMessage } from '../../utils/whatsapp';

export default function DriverDashboard() {
  const { bookings, fetchDriverBookings } = useBookingStore();
  const [profile, setProfile] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [fareInputs, setFareInputs] = useState({});
  const [alert, setAlert] = useState('');
  const [availError, setAvailError] = useState('');
  const [newRate, setNewRate] = useState('');
  const [rateMsg, setRateMsg] = useState('');
  const [showAllTrips, setShowAllTrips] = useState(false);
  const [notifPermission, setNotifPermission] = useState(notificationPermission());

  function load() {
    fetchDriverBookings(showAllTrips ? { all: true } : undefined);
    client.get('/driver/profile').then((r) => setProfile(r.data));
    client.get('/driver/earnings').then((r) => setEarnings(r.data));
  }

  useEffect(() => { load(); }, [showAllTrips]);

  useSocket({
    'booking:new': (booking) => {
      const ratingText = booking.passengerRatingAvg ? `⭐${booking.passengerRatingAvg}` : 'no ratings yet';
      setAlert(`New ride request: ${booking.passengerName} (${ratingText}) · ${booking.pickupAddress} → ${booking.dropAddress}`);
      showBrowserNotification('New ride request', `${booking.passengerName} (${ratingText})\n${booking.pickupAddress} → ${booking.dropAddress}`);
      load();
    },
    // Another driver claimed a broadcast request we were also shown -
    // refresh so it drops out of our pending list too.
    'booking:claimed': () => load(),
  });

  async function enableNotifications() {
    const permission = await requestNotificationPermission();
    setNotifPermission(permission);
  }

  async function toggleAvailable() {
    setAvailError('');
    try {
      const { data } = await client.put('/driver/availability', { isAvailable: !profile.isAvailable });
      setProfile(data);
    } catch (err) {
      setAvailError(err.response?.data?.error || 'Could not update availability');
    }
  }

  async function togglePaymentPreference() {
    const { data } = await client.put('/driver/payment-preference', { acceptsOnlinePayment: !profile.acceptsOnlinePayment });
    setProfile(data);
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
    try {
      await client.put(`/booking/${id}/accept`);
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not accept this trip');
    }
    load();
  }

  async function decline(id) {
    await client.put(`/booking/${id}/decline`);
    load();
  }

  async function markArrived(id) {
    await client.put(`/booking/${id}/arrived`);
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
      {profile?.compliance && !profile.compliance.compliant && (
        <div className="card" style={{ background: '#fef3c7' }}>
          ⚠️ <strong>NZTA compliance incomplete:</strong> {profile.compliance.issues.join('; ')}. Contact an admin to update your record - this blocks going online.
        </div>
      )}

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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {notifPermission !== 'granted' && notifPermission !== 'unsupported' && (
                <button className="btn secondary" onClick={enableNotifications}>🔔 Enable trip notifications</button>
              )}
              <button className={`btn ${profile.isAvailable ? 'secondary' : ''}`} onClick={toggleAvailable} disabled={profile.status !== 'approved'}>
                {profile.isAvailable ? 'Go offline' : 'Go online'}
              </button>
            </div>
          </div>
          {availError && <p className="error-text" style={{ marginTop: 10 }}>{availError}</p>}

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={profile.acceptsOnlinePayment !== false} onChange={togglePaymentPreference} />
            Accept online (card) payments
          </label>
          <p className="muted" style={{ marginTop: 2 }}>
            {profile.acceptsOnlinePayment !== false
              ? 'Passengers can pay you by card or cash. Card fares include a small disclosed surcharge to cover payment processing.'
              : 'Cash only - you won\'t be offered card-paying passengers via auto-match, and a card payer scanning your QR code will be told to pay cash or matched with another driver.'}
          </p>

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Bookings {!showAllTrips && <span className="muted" style={{ fontWeight: 400 }}>(last 30 days)</span>}</h3>
          <button className="btn secondary" onClick={() => setShowAllTrips((v) => !v)}>{showAllTrips ? 'Show last 30 days' : 'Show all history'}</button>
        </div>
        {bookings.length === 0 && <p className="muted">No bookings yet.</p>}
        <table>
          <tbody>
            {bookings.map((b) => (
              <tr key={b._id}>
                <td>
                  <div className="muted">
                    {b.bookingId}
                    {b.status === 'pending' && !b.driverId && <span className="badge" style={{ marginLeft: 6 }}>open request - first to accept gets it</span>}
                  </div>
                  <div>{b.pickupAddress} → {b.dropAddress}</div>
                  <div className="muted">
                    {b.passengerId?.name}{b.passengerRatingAvg ? ` (⭐${b.passengerRatingAvg})` : ''} · {b.distanceKm} km · est. ${b.estimatedFare} · {b.paymentMethod === 'card' ? (b.paymentStatus === 'paid' ? 'paid online' : 'awaiting online payment') : 'cash'}
                  </div>
                  <div className="muted">
                    {b.scheduledFor ? `Scheduled: ${new Date(b.scheduledFor).toLocaleString()}` : `Requested: ${new Date(b.requestedAt || b.createdAt).toLocaleString()}`}
                  </div>
                  {b.arrivedAt && b.status === 'accepted' && <div className="muted">Arrived at pickup: {new Date(b.arrivedAt).toLocaleTimeString()}</div>}
                  {b.status === 'completed' && !b.passengerRating && (
                    <StarRating label="Rate this passenger" submitLabel="Rate" onSubmit={(rating, review) => ratePassenger(b._id, rating, review)} />
                  )}
                  {b.passengerRating && <div className="muted">You rated: {'★'.repeat(b.passengerRating)}{'☆'.repeat(5 - b.passengerRating)}</div>}
                </td>
                <td><span className={`badge ${b.status}`}>{b.status}</span></td>
                <td>
                  {b.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn" onClick={() => accept(b._id)}>Accept</button>
                      <button className="btn secondary" onClick={() => decline(b._id)}>Decline</button>
                      {waLink(b.passengerId?.mobile, newTripMessage(b, b.passengerId?.name)) && (
                        <a className="btn secondary" target="_blank" rel="noreferrer"
                          href={waLink(b.passengerId?.mobile, newTripMessage(b, b.passengerId?.name))}>WhatsApp passenger</a>
                      )}
                    </div>
                  )}
                  {(b.status === 'accepted' || b.status === 'in-progress') && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {b.status === 'accepted' && !b.arrivedAt && (
                        <button className="btn secondary" onClick={() => markArrived(b._id)}>I've arrived</button>
                      )}
                      {b.status === 'accepted' && b.arrivedAt && waLink(b.passengerId?.mobile, driverArrivedMessage(b, profile?.userId?.name, `${profile?.vehicleType} · ${profile?.vehicleNumber}`)) && (
                        <a className="btn secondary" target="_blank" rel="noreferrer"
                          href={waLink(b.passengerId?.mobile, driverArrivedMessage(b, profile?.userId?.name, `${profile?.vehicleType} · ${profile?.vehicleNumber}`))}>WhatsApp "I've arrived"</a>
                      )}
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
