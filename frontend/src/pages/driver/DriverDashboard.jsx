import { useEffect, useState } from 'react';
import client from '../../api/client';
import { useBookingStore } from '../../store/bookingStore';
import { useSocket } from '../../hooks/useSocket';
import StarRating from '../../components/StarRating';
import { notificationPermission, requestNotificationPermission, showBrowserNotification } from '../../utils/browserNotify';
import { waLink, driverPendingMessage, driverConfirmedMessage, driverArrivedMessage, driverCancelledMessage, paymentReminderMessage, vehicleLabel } from '../../utils/whatsapp';
import { formatNzDateTime, formatNzTime } from '../../utils/nzTime';
import WhatsAppIcon from '../../components/WhatsAppIcon';

export default function DriverDashboard() {
  const { bookings, fetchDriverBookings } = useBookingStore();
  const [profile, setProfile] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [fareInputs, setFareInputs] = useState({});
  const [alert, setAlert] = useState('');
  const [availError, setAvailError] = useState('');
  const [showAllTrips, setShowAllTrips] = useState(false);
  const [notifPermission, setNotifPermission] = useState(notificationPermission());
  // Cancelling is the one trip-lifecycle action with no data-derived way
  // to tell "I just cancelled this" after the fact (the booking is just
  // status:'cancelled' - nothing marks it as "cancelled by me, offer a
  // WhatsApp link"), so unlike accept/arrived/payment-reminder below
  // (which render straight off the booking's own fields, no state
  // needed) this one small per-booking map is kept around after a
  // successful cancel so the link can still show inline in that row.
  const [cancelWaLinks, setCancelWaLinks] = useState({});

  function load() {
    fetchDriverBookings(showAllTrips ? { all: true } : undefined);
    client.get('/driver/profile').then((r) => setProfile(r.data));
    client.get('/driver/earnings').then((r) => setEarnings(r.data));
  }

  useEffect(() => { load(); }, [showAllTrips]);

  // Belt-and-suspenders alongside the socket events below - keeps new
  // requests/status changes showing up without a manual refresh even if
  // the socket connection itself isn't up.
  useEffect(() => {
    const poll = setInterval(load, 20000);
    return () => clearInterval(poll);
  }, [showAllTrips]);

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

  // Cancelling an already-accepted trip is more disruptive than declining
  // one that's still pending - the passenger is expecting this driver, so
  // they're told twice: an email from the backend (see routes/booking.js
  // PUT /:id/cancel, which works even without the passenger's number) and
  // a WhatsApp link, kept in cancelWaLinks so it can still show inline in
  // this booking's row once cancelled (see comment on that state above).
  async function cancelTrip(id) {
    const reason = window.prompt("Why are you cancelling this trip? The passenger will see this reason.");
    if (reason === null) return; // dismissed the prompt - don't cancel
    if (!window.confirm('Cancel this trip? The passenger will be notified by email.')) return;

    try {
      const booking = bookings.find((b) => b._id === id);
      await client.put(`/booking/${id}/cancel`, { reason });
      const link = booking && waLink(booking.passengerId?.mobile, driverCancelledMessage(booking, profile?.userId?.name, reason));
      if (link) setCancelWaLinks((links) => ({ ...links, [id]: link }));
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not cancel this trip');
    }
    load();
  }

  // "I've arrived" and Complete are single buttons that also send their
  // WhatsApp update, on the same click - no separate message button for
  // either. Safe to open the popup before the await here (unlike accept/
  // cancel, there's no "already did this" conflict a stray second click
  // could hit): worst case is a resend, not a confusing error.
  async function markArrived(id) {
    const booking = bookings.find((b) => b._id === id);
    const link = booking && waLink(booking.passengerId?.mobile, driverArrivedMessage(booking, profile?.userId?.name, vehicleLabel(profile)));
    if (link) {
      try { window.open(link, '_blank'); } catch { /* popup blocked - nothing else to fall back to, per "no separate button" */ }
    }

    try {
      await client.put(`/booking/${id}/arrived`);
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not mark arrived');
    }
    load();
  }

  async function complete(id) {
    const booking = bookings.find((b) => b._id === id);
    const actualFare = Number(fareInputs[id]) || undefined;
    // Only a card trip that's still unpaid has anything worth messaging
    // about on completion - a cash trip is auto-marked paid by the
    // backend, nothing to remind the passenger of.
    if (booking && booking.paymentMethod === 'card' && booking.paymentStatus !== 'paid') {
      const finalBooking = { ...booking, actualFare: actualFare || booking.estimatedFare };
      const link = waLink(booking.passengerId?.mobile, paymentReminderMessage(finalBooking, profile?.userId?.name, `${window.location.origin}/pay/${id}`));
      if (link) {
        try { window.open(link, '_blank'); } catch { /* the payment-reminder link still rendered below covers a blocked popup */ }
      }
    }

    try {
      await client.put(`/booking/${id}/complete`, { actualFare });
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not complete this trip');
    }
    load();
  }

  async function markPaid(id) {
    if (!window.confirm('Mark this trip as paid? Use this once you have received payment outside the app (e.g. cash in person).')) return;
    try {
      await client.put(`/booking/${id}/mark-paid`);
      load();
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not mark this trip as paid');
    }
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
              <strong>{vehicleLabel(profile)}</strong> · ${profile.ratePerKm}/km
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
                <div>{b.pickupAddress}{b.stops?.map((s, i) => <span key={i}> → {s.address}</span>)} → {b.dropAddress}</div>
                <div className="muted">
                  {b.passengerId?.name}{b.passengerRatingAvg ? ` (⭐${b.passengerRatingAvg})` : ''} · {b.distanceKm} km · est. ${b.estimatedFare} · {b.paymentMethod === 'card' ? (b.paymentStatus === 'paid' ? 'paid online' : 'awaiting online payment') : 'cash'}
                </div>
                <div className="muted">
                  {b.scheduledFor ? `Scheduled: ${formatNzDateTime(b.scheduledFor)}` : `Requested: ${formatNzDateTime(b.requestedAt || b.createdAt)}`}
                </div>
                {b.arrivedAt && b.status === 'accepted' && <div className="muted">Arrived at pickup: {formatNzTime(b.arrivedAt)}</div>}
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
                  <>
                    <button className="btn secondary" onClick={() => markArrived(b._id)}>I've arrived</button>
                    {waLink(b.passengerId?.mobile, driverConfirmedMessage(b, profile?.userId?.name, vehicleLabel(profile))) && (
                      <a className="btn whatsapp" target="_blank" rel="noreferrer"
                        href={waLink(b.passengerId?.mobile, driverConfirmedMessage(b, profile?.userId?.name, vehicleLabel(profile)))}><WhatsAppIcon /> Message passenger: trip confirmed</a>
                    )}
                  </>
                )}
                <input style={{ width: 90 }} type="number" step="0.01" placeholder="Actual $"
                  value={fareInputs[b._id] || ''} onChange={(e) => setFareInputs((f) => ({ ...f, [b._id]: e.target.value }))} />
                <button className="btn" onClick={() => complete(b._id)}>Complete</button>
                <button className="btn danger" onClick={() => cancelTrip(b._id)}>Cancel trip</button>
              </div>
            )}
            {b.paymentMethod === 'card' && b.paymentStatus !== 'paid' && ['accepted', 'in-progress', 'completed'].includes(b.status) && (
              <div className="booking-actions">
                {waLink(b.passengerId?.mobile, paymentReminderMessage(b, profile?.userId?.name, `${window.location.origin}/pay/${b._id}`)) && (
                  <a className="btn whatsapp" target="_blank" rel="noreferrer"
                    href={waLink(b.passengerId?.mobile, paymentReminderMessage(b, profile?.userId?.name, `${window.location.origin}/pay/${b._id}`))}><WhatsAppIcon /> Message passenger: payment reminder</a>
                )}
                <button className="btn secondary" onClick={() => markPaid(b._id)}>Mark as paid</button>
              </div>
            )}
            {b.status === 'cancelled' && cancelWaLinks[b._id] && (
              <div className="booking-actions">
                <a className="btn whatsapp" target="_blank" rel="noreferrer" href={cancelWaLinks[b._id]}><WhatsAppIcon /> Message passenger: trip cancelled</a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
