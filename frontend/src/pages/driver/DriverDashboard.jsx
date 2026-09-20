import { useEffect, useState } from 'react';
import client from '../../api/client';
import { useBookingStore } from '../../store/bookingStore';
import { useSocket } from '../../hooks/useSocket';
import StarRating from '../../components/StarRating';
import { notificationPermission, requestNotificationPermission, showBrowserNotification } from '../../utils/browserNotify';
import { waLink, driverPendingMessage, driverConfirmedMessage, driverArrivedMessage, driverCancelledMessage, paymentReminderMessage } from '../../utils/whatsapp';
import WhatsAppIcon from '../../components/WhatsAppIcon';
import PhoneField from '../../components/PhoneField';
import { useAuthStore } from '../../store/authStore';

export default function DriverDashboard() {
  const { bookings, fetchDriverBookings } = useBookingStore();
  const { token, setSession } = useAuthStore();
  const [profile, setProfile] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [fareInputs, setFareInputs] = useState({});
  const [alert, setAlert] = useState('');
  const [availError, setAvailError] = useState('');
  const [newRate, setNewRate] = useState('');
  const [rateMsg, setRateMsg] = useState('');
  const [showAllTrips, setShowAllTrips] = useState(false);
  const [notifPermission, setNotifPermission] = useState(notificationPermission());
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', email: '', mobile: '', vehicleNumber: '', currentPassword: '' });
  const [profileMsg, setProfileMsg] = useState('');

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
    // The passenger edited a still-pending trip (ours or a broadcast we
    // could see) - reload so the details, or our eligibility for it, are
    // current rather than stale.
    'booking:updated': () => load(),
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

  function startEditProfile() {
    setProfileMsg('');
    setProfileForm({
      name: profile.userId?.name || '', email: profile.userId?.email || '', mobile: profile.userId?.mobile || '',
      vehicleNumber: profile.vehicleNumber || '', currentPassword: '',
    });
    setEditingProfile(true);
  }

  async function saveProfile(e) {
    e.preventDefault();
    setProfileMsg('');
    try {
      // Name/mobile/vehicle number are driver-managed (PUT /driver/profile);
      // email is a login credential, so it goes through the same
      // self-service account endpoint admin uses (PUT /api/auth/me),
      // which requires the current password to confirm identity.
      await client.put('/driver/profile', profileForm);
      if (profileForm.email && profileForm.email !== profile.userId?.email) {
        const { data } = await client.put('/auth/me', { email: profileForm.email, currentPassword: profileForm.currentPassword });
        setSession(token, data);
      }
      setEditingProfile(false);
      load();
    } catch (err) {
      setProfileMsg(err.response?.data?.error || 'Could not save your details');
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
    // Open the WhatsApp tab synchronously, in the same click, before any
    // await - browsers only allow window.open without a popup-blocker
    // prompt when it's called directly inside a user gesture's call stack.
    // Booking details are already in state, so the link doesn't need to
    // wait on the accept API call. Guarded in its own try/catch: a popup
    // blocked/throwing here must never stop the actual Accept call below -
    // that was the cause of Accept appearing to need two clicks.
    let popup = null;
    try {
      const booking = bookings.find((b) => b._id === id);
      const link = booking && waLink(booking.passengerId?.mobile, driverConfirmedMessage(booking, profile?.userId?.name, profile ? `${profile.vehicleType} · ${profile.vehicleNumber}` : ''));
      popup = link ? window.open(link, '_blank') : null;
    } catch {
      popup = null;
    }

    try {
      await client.put(`/booking/${id}/accept`);
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not accept this trip');
      if (popup) popup.close();
    }
    load();
  }

  async function decline(id) {
    await client.put(`/booking/${id}/decline`);
    load();
  }

  // Cancelling an already-accepted trip is more disruptive than declining
  // one that's still pending - the passenger is expecting this driver, so
  // they're told twice: an immediate WhatsApp heads-up (opened here, same
  // synchronous-before-await trick as accept()/complete()) and an email
  // from the backend (see routes/booking.js PUT /:id/cancel), which works
  // even if the driver doesn't have the passenger's number confirmed.
  async function cancelTrip(id) {
    const reason = window.prompt("Why are you cancelling this trip? The passenger will see this reason.");
    if (reason === null) return; // dismissed the prompt - don't cancel
    if (!window.confirm('Cancel this trip? The passenger will be notified by email and WhatsApp.')) return;

    let popup = null;
    try {
      const booking = bookings.find((b) => b._id === id);
      const link = booking && waLink(booking.passengerId?.mobile, driverCancelledMessage(booking, profile?.userId?.name, reason));
      popup = link ? window.open(link, '_blank') : null;
    } catch {
      popup = null;
    }

    try {
      await client.put(`/booking/${id}/cancel`, { reason });
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not cancel this trip');
      if (popup) popup.close();
    }
    load();
  }

  async function markArrived(id) {
    await client.put(`/booking/${id}/arrived`);
    load();
  }

  async function complete(id) {
    const booking = bookings.find((b) => b._id === id);
    const actualFare = Number(fareInputs[id]) || undefined;

    // Same synchronous-before-await trick as accept(): if this is a card
    // trip that's still unpaid, open WhatsApp with a payment-reminder link
    // right away, in this click, before the popup-blocker window closes.
    // Guarded the same way too, so a blocked/throwing popup can never stop
    // the actual Complete call below.
    let popup = null;
    try {
      if (booking && booking.paymentMethod === 'card' && booking.paymentStatus !== 'paid') {
        const payLink = `${window.location.origin}/pay/${id}`;
        const finalBooking = { ...booking, actualFare: actualFare || booking.estimatedFare };
        const link = waLink(booking.passengerId?.mobile, paymentReminderMessage(finalBooking, profile?.userId?.name, payLink));
        popup = link ? window.open(link, '_blank') : null;
      }
    } catch {
      popup = null;
    }

    try {
      await client.put(`/booking/${id}/complete`, { actualFare });
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not complete this trip');
      if (popup) popup.close();
    }
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

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            {!editingProfile ? (
              <button type="button" className="btn secondary" onClick={startEditProfile}>Edit my details</button>
            ) : (
              <form onSubmit={saveProfile} style={{ maxWidth: 320 }}>
                <div><label>Name</label><input value={profileForm.name} onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))} required /></div>
                <div><label>Email</label><input type="email" value={profileForm.email} onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))} required /></div>
                <PhoneField value={profileForm.mobile} onChange={(v) => setProfileForm((f) => ({ ...f, mobile: v }))} hint="Trip requests are sent here on WhatsApp." />
                <div><label>Vehicle number</label><input value={profileForm.vehicleNumber} onChange={(e) => setProfileForm((f) => ({ ...f, vehicleNumber: e.target.value }))} required /></div>
                <div><label>Current password</label><input type="password" value={profileForm.currentPassword} onChange={(e) => setProfileForm((f) => ({ ...f, currentPassword: e.target.value }))} placeholder="Only required if changing email" /></div>
                <p className="muted" style={{ marginTop: 4 }}>License and compliance documents can only be changed by an admin.</p>
                {profileMsg && <p className="error-text">{profileMsg}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn">Save</button>
                  <button type="button" className="btn secondary" onClick={() => setEditingProfile(false)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
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
        {bookings.map((b) => (
          <div className="booking-row" key={b._id}>
            <div className="booking-row-top">
              <div>
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
                {b.passengerRating && <div className="muted">You rated: {'★'.repeat(b.passengerRating)}{'☆'.repeat(5 - b.passengerRating)}</div>}
              </div>
              <span className={`badge ${b.status}`}>{b.status}</span>
            </div>

            {b.status === 'completed' && !b.passengerRating && (
              <StarRating label="Rate this passenger" submitLabel="Rate" onSubmit={(rating, review) => ratePassenger(b._id, rating, review)} />
            )}

            {b.status === 'pending' && (
              <div className="booking-actions">
                <button className="btn" onClick={() => accept(b._id)}>Accept</button>
                <button className="btn secondary" onClick={() => decline(b._id)}>Decline</button>
                {waLink(b.passengerId?.mobile, driverPendingMessage(b, b.passengerId?.name)) && (
                  <a className="btn whatsapp" target="_blank" rel="noreferrer"
                    href={waLink(b.passengerId?.mobile, driverPendingMessage(b, b.passengerId?.name))}><WhatsAppIcon /> Message passenger</a>
                )}
              </div>
            )}
            {(b.status === 'accepted' || b.status === 'in-progress') && (
              <div className="booking-actions">
                {b.status === 'accepted' && !b.arrivedAt && (
                  <button className="btn secondary" onClick={() => markArrived(b._id)}>I've arrived</button>
                )}
                {b.status === 'accepted' && b.arrivedAt && waLink(b.passengerId?.mobile, driverArrivedMessage(b, profile?.userId?.name, `${profile?.vehicleType} · ${profile?.vehicleNumber}`)) && (
                  <a className="btn whatsapp" target="_blank" rel="noreferrer"
                    href={waLink(b.passengerId?.mobile, driverArrivedMessage(b, profile?.userId?.name, `${profile?.vehicleType} · ${profile?.vehicleNumber}`))}><WhatsAppIcon /> "I've arrived"</a>
                )}
                <input style={{ width: 90 }} type="number" step="0.01" placeholder="Actual $"
                  value={fareInputs[b._id] || ''} onChange={(e) => setFareInputs((f) => ({ ...f, [b._id]: e.target.value }))} />
                <button className="btn" onClick={() => complete(b._id)}>Complete</button>
                <button className="btn danger" onClick={() => cancelTrip(b._id)}>Cancel trip</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
