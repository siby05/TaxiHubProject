import { useEffect, useState } from 'react';
import client, { API_URL } from '../../api/client';
import { useBookingStore } from '../../store/bookingStore';
import { useSocket } from '../../hooks/useSocket';
import StarRating from '../../components/StarRating';
import { notificationPermission, requestNotificationPermission, showBrowserNotification } from '../../utils/browserNotify';
import { waLink, openWhatsApp, driverPendingMessage, driverConfirmedMessage, driverArrivedMessage, driverCancelledMessage, paymentReminderMessage, receiptMessage, vehicleLabel } from '../../utils/whatsapp';
import { formatNzDateTime, formatNzTime } from '../../utils/nzTime';
import { directionsLink } from '../../utils/maps';
import { telLink } from '../../utils/phone';
import { discountNote } from '../../utils/fare';
import { useTripGpsTracking } from '../../hooks/useTripGpsTracking';
import WhatsAppIcon from '../../components/WhatsAppIcon';
import Modal from '../../components/Modal';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import ScheduleField from '../../components/ScheduleField';
import { newStopId, makeStopHandlers, stopsPayload } from '../../utils/stops';

// Same rule as the backend's POST /api/booking/driver/location: a trip is
// "on the go" (so its GPS route is recorded) once it's in progress, or
// accepted and either due now or the driver has already arrived - not an
// accepted trip scheduled for later in the week.
const SCHEDULED_AHEAD_MS = 15 * 60 * 1000;
function isTripOnTheGo(b) {
  if (b.status === 'in-progress') return true;
  if (b.status !== 'accepted') return false;
  return !!b.arrivedAt || !b.scheduledFor || new Date(b.scheduledFor).getTime() - Date.now() <= SCHEDULED_AHEAD_MS;
}

export default function DriverDashboard() {
  const { bookings, fetchDriverBookings } = useBookingStore();
  const [profile, setProfile] = useState(null);
  const [earnings, setEarnings] = useState(null);
  // The "Complete trip" / "Edit trip" dialog: { mode: 'complete' | 'edit',
  // booking, fare, paymentPending, error, saving } or null when closed.
  const [fareDialog, setFareDialog] = useState(null);
  // "Edit trip" before it starts (route and time) - the trip being edited,
  // or null. Completed trips use the fare dialog above instead.
  const [tripEdit, setTripEdit] = useState(null);
  const [tePickup, setTePickup] = useState(null);
  const [teDrop, setTeDrop] = useState(null);
  const [teStops, setTeStops] = useState([]);
  const [teScheduledFor, setTeScheduledFor] = useState(null);
  const [tePreview, setTePreview] = useState(null);
  // Fare box: follows the calculated fare until the driver types their own.
  const [teFare, setTeFare] = useState('');
  const [teFareCustom, setTeFareCustom] = useState(false);
  const [teError, setTeError] = useState('');
  const [teSaving, setTeSaving] = useState(false);
  const teStopHandlers = makeStopHandlers(setTeStops);

  function openTripEdit(b) {
    setTripEdit(b);
    setTePickup({ label: b.pickupAddress, lat: b.pickupLat, lng: b.pickupLng });
    setTeDrop({ label: b.dropAddress, lat: b.dropLat, lng: b.dropLng });
    setTeStops((b.stops || []).map((st) => ({ id: newStopId(), selection: { label: st.address, lat: st.lat, lng: st.lng } })));
    setTeScheduledFor(b.scheduledFor || null);
    setTePreview(null);
    setTeFare(Number(b.estimatedFare).toFixed(2));
    setTeFareCustom(!!b.fareSetByDriver);
    setTeError('');
  }

  function tripEditPayload() {
    return {
      pickupAddress: tePickup.label, pickupLat: tePickup.lat, pickupLng: tePickup.lng,
      dropAddress: teDrop.label, dropLat: teDrop.lat, dropLng: teDrop.lng,
      stops: stopsPayload(teStops), scheduledFor: teScheduledFor,
    };
  }

  // Live fare for the edited route (same endpoint, preview only).
  useEffect(() => {
    if (!tripEdit || !tePickup || !teDrop || teStops.some((st) => !st.selection)) return undefined;
    let cancelled = false;
    const t = setTimeout(() => {
      client.put(`/booking/${tripEdit._id}/driver-edit`, { ...tripEditPayload(), preview: true })
        .then((r) => {
          if (cancelled) return;
          setTePreview(r.data);
          setTeError('');
          if (!teFareCustom) setTeFare(r.data.estimatedFare.toFixed(2));
        })
        .catch((err) => { if (!cancelled) { setTePreview(null); setTeError(err.response?.data?.error || 'Could not work out the fare'); } });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [tripEdit, tePickup, teDrop, teStops, teScheduledFor]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveTripEdit() {
    const amount = Number(teFare);
    if (!Number.isFinite(amount) || amount <= 0) {
      setTeError('Enter the fare');
      return;
    }
    setTeSaving(true);
    setTeError('');
    try {
      await client.put(`/booking/${tripEdit._id}/driver-edit`, {
        ...tripEditPayload(),
        ...(teFareCustom && { estimatedFare: amount }),
      });
      setTripEdit(null);
      load();
    } catch (err) {
      setTeError(err.response?.data?.error || 'Could not save the changes');
    } finally {
      setTeSaving(false);
    }
  }
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
  const [receiptSent, setReceiptSent] = useState({});
  const [gpsError, setGpsError] = useState('');

  const tracking = bookings.some((b) => b.driverId && isTripOnTheGo(b));
  useTripGpsTracking(tracking, setGpsError);
  useEffect(() => { if (!tracking) setGpsError(''); }, [tracking]);

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
      openWhatsApp(link);
    }

    try {
      await client.put(`/booking/${id}/arrived`);
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not mark arrived');
    }
    load();
  }

  // The receipt page (view / download PDF) for a completed trip, or null
  // before there's a token. Drivers can open it for any trip, and send it
  // on WhatsApp or re-email it - see the completed-trip actions below.
  function receiptUrl(b) {
    return b.receiptToken ? `${API_URL}/booking/${b._id}/receipt?t=${b.receiptToken}` : null;
  }

  async function emailReceipt(id) {
    setReceiptSent((s) => ({ ...s, [id]: 'sending' }));
    try {
      await client.post(`/booking/${id}/email-receipt`);
      setReceiptSent((s) => ({ ...s, [id]: 'sent' }));
    } catch (err) {
      setReceiptSent((s) => ({ ...s, [id]: undefined }));
      setAlert(err.response?.data?.error || 'Could not email the receipt');
    }
  }

  // Asks for the fare (and, for cash, whether it's been paid) instead of a
  // fare box on every trip - see the fare dialog at the bottom.
  // The fare box opens filled in (the estimate when completing, the fare
  // charged when editing) as e.g. "26.80", so the driver only types if it
  // differs - the amount is selected on open, so typing replaces it.
  const fareText = (n) => (n == null || n === '' ? '' : Number(n).toFixed(2));

  function openComplete(b) {
    setFareDialog({ mode: 'complete', booking: b, fare: fareText(b.estimatedFare), paymentPending: false, sendWhatsApp: false, error: '' });
  }

  function openEdit(b) {
    setFareDialog({
      mode: 'edit', booking: b, fare: fareText(b.actualFare ?? b.estimatedFare),
      paymentMethod: b.paymentMethod, paymentPending: b.paymentStatus !== 'paid', error: '',
    });
  }

  async function saveFareDialog() {
    const { mode, booking, fare, paymentMethod, paymentPending, sendWhatsApp } = fareDialog;
    const amount = Number(fare);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFareDialog((d) => ({ ...d, error: 'Enter the fare charged' }));
      return;
    }
    if (mode === 'complete') {
      setFareDialog(null);
      await complete(booking._id, amount, booking.paymentMethod !== 'card' && paymentPending, sendWhatsApp);
      return;
    }
    setFareDialog((d) => ({ ...d, saving: true, error: '' }));
    try {
      await client.put(`/booking/${booking._id}/fare`, {
        actualFare: amount,
        paymentMethod,
        ...(paymentMethod !== 'card' && { paymentPending }),
      });
      setFareDialog(null);
      load();
    } catch (err) {
      setFareDialog((d) => ({ ...d, saving: false, error: err.response?.data?.error || 'Could not save the changes' }));
    }
  }

  // WhatsApp only opens when the driver ticked "Send receipt on WhatsApp"
  // in the Complete trip box - it's not needed for every trip (passengers
  // with an email get the receipt emailed anyway).
  async function complete(id, actualFare, paymentPending, sendWhatsApp) {
    const booking = bookings.find((b) => b._id === id);
    if (booking && sendWhatsApp) {
      const finalBooking = { ...booking, actualFare: actualFare || booking.estimatedFare };
      const cardOwing = booking.paymentMethod === 'card' && booking.paymentStatus !== 'paid';
      const payLink = cardOwing ? `${window.location.origin}/pay/${id}` : null;
      const receipt = receiptUrl(booking);
      // Opened before the API call so it counts as part of the tap (popup
      // blockers reject a window opened after an await). One message: the
      // receipt link, with the pay link folded in if a card fare is owing,
      // or a note if a cash fare is left pending.
      const text = receipt
        ? receiptMessage(finalBooking, profile?.userId?.name, receipt, payLink)
          + (paymentPending ? '\n\nPayment is still pending - please pay at your convenience. Thank you!' : '')
        : paymentReminderMessage(finalBooking, profile?.userId?.name, payLink);
      const link = waLink(booking.passengerId?.mobile, text);
      if (link) openWhatsApp(link);
    }

    try {
      await client.put(`/booking/${id}/complete`, { actualFare, paymentPending });
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
      {tracking && (
        <div className="card" style={{ background: gpsError ? '#fef3c7' : '#ecfdf5' }}>
          {gpsError || '📡 GPS tracking is on for your current trip. The route is kept for 7 days.'}
        </div>
      )}
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
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
          <div className="card stat"><div className="value">${earnings.estimatedGst.toFixed(2)}</div><div className="label">GST included (15%)</div></div>
          <div className="card stat"><div className="value">${earnings.netEarnings.toFixed(2)}</div><div className="label">Net earnings</div></div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
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
                  {b.passengerId?.name}{b.passengerRatingAvg ? ` (⭐${b.passengerRatingAvg})` : ''} · {b.distanceKm} km · est. ${b.estimatedFare}{discountNote(b)} · {b.paymentMethod === 'card' ? (b.paymentStatus === 'paid' ? 'paid online' : 'awaiting online payment') : (b.status === 'completed' && b.paymentStatus !== 'paid' ? 'cash · payment pending' : 'cash')}
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
              <div className="booking-actions trip-actions">
                <button className="btn" onClick={() => accept(b._id)}>Accept</button>
                <button className="btn secondary" onClick={() => decline(b._id)}>Decline</button>
                {waLink(b.passengerId?.mobile, driverPendingMessage(b, b.passengerId?.name)) && (
                  <a className="btn whatsapp" target="_blank" rel="noreferrer"
                    href={waLink(b.passengerId?.mobile, driverPendingMessage(b, b.passengerId?.name))}><WhatsAppIcon /> Message passenger</a>
                )}
              </div>
            )}
            {(b.status === 'accepted' || b.status === 'in-progress') && (() => {
              const cardOwing = b.paymentMethod === 'card' && b.paymentStatus !== 'paid';
              const payLink = `${window.location.origin}/pay/${b._id}`;
              const confirmLink = waLink(b.passengerId?.mobile, driverConfirmedMessage(b, profile?.userId?.name, vehicleLabel(profile)));
              const remindLink = cardOwing && waLink(b.passengerId?.mobile, paymentReminderMessage(b, profile?.userId?.name, payLink));
              return (
                <>
                  <div className="booking-actions trip-actions">
                    {b.status === 'accepted' && !b.arrivedAt && confirmLink && (
                      <a className="btn whatsapp" target="_blank" rel="noreferrer" title="Message passenger on WhatsApp: trip confirmed"
                        href={confirmLink}><WhatsAppIcon /> Trip confirmed</a>
                    )}
                    {b.status === 'accepted' && !b.arrivedAt && (
                      <button className="btn secondary" onClick={() => markArrived(b._id)}>I've arrived</button>
                    )}
                    {/* Call is only offered while the trip is live (accepted / in
                        progress) - e.g. the passenger can't be found at pickup.
                        It disappears once the trip is completed or cancelled. */}
                    {telLink(b.passengerId?.mobile) && (
                      <a className="btn call" href={telLink(b.passengerId?.mobile)}>📞 Call passenger</a>
                    )}
                    <a className="btn secondary" target="_blank" rel="noreferrer" href={directionsLink(b)}>📍 Directions</a>
                    <button className="btn" onClick={() => openComplete(b)}>Complete</button>
                    {remindLink && (
                      <a className="btn whatsapp" target="_blank" rel="noreferrer" title="Message passenger on WhatsApp: payment reminder"
                        href={remindLink}><WhatsAppIcon /> Remind to pay</a>
                    )}
                    {cardOwing && <button className="btn secondary" onClick={() => markPaid(b._id)}>Mark as paid</button>}
                  </div>
                  <div className="booking-actions trip-actions">
                    {b.status === 'accepted' && (
                      <button className="btn secondary" onClick={() => openTripEdit(b)}>✏️ Edit trip</button>
                    )}
                    <button className="btn danger-outline" onClick={() => cancelTrip(b._id)}>Cancel trip</button>
                  </div>
                </>
              );
            })()}
            {b.status === 'completed' && (() => {
              const unpaid = b.paymentStatus !== 'paid';
              const payLink = b.paymentMethod === 'card' ? `${window.location.origin}/pay/${b._id}` : null;
              const remindLink = unpaid && waLink(b.passengerId?.mobile, paymentReminderMessage(b, profile?.userId?.name, payLink));
              const receiptWa = receiptUrl(b) && waLink(b.passengerId?.mobile, receiptMessage(b, profile?.userId?.name, receiptUrl(b), unpaid ? payLink : null));
              return (
                <div className="booking-actions trip-actions">
                  {remindLink && (
                    <a className="btn whatsapp" target="_blank" rel="noreferrer" title="Message passenger on WhatsApp: payment reminder"
                      href={remindLink}><WhatsAppIcon /> Remind to pay</a>
                  )}
                  {unpaid && <button className="btn secondary" onClick={() => markPaid(b._id)}>Mark as paid</button>}
                  {receiptUrl(b) && <a className="btn secondary" target="_blank" rel="noreferrer" href={receiptUrl(b)}>View receipt</a>}
                  {receiptUrl(b) && b.passengerHasEmail && (
                    <button className="btn secondary" disabled={!!receiptSent[b._id]} onClick={() => emailReceipt(b._id)}>
                      {receiptSent[b._id] === 'sent' ? 'Receipt emailed' : receiptSent[b._id] === 'sending' ? 'Sending...' : 'Email receipt'}
                    </button>
                  )}
                  {receiptWa && (
                    <a className="btn whatsapp" target="_blank" rel="noreferrer" title="Send receipt on WhatsApp" href={receiptWa}><WhatsAppIcon /> Send receipt</a>
                  )}
                  <button className="btn secondary" onClick={() => openEdit(b)}>✏️ Edit trip</button>
                  {receiptUrl(b) && !b.passengerHasEmail && <span className="muted">No email on file for this passenger</span>}
                </div>
              );
            })()}
            {b.status === 'cancelled' && cancelWaLinks[b._id] && (
              <div className="booking-actions trip-actions">
                <a className="btn whatsapp" target="_blank" rel="noreferrer" href={cancelWaLinks[b._id]}><WhatsAppIcon /> Message passenger: trip cancelled</a>
              </div>
            )}
          </div>
        ))}
      </div>

      {tripEdit && (
        <Modal title="Edit trip" onClose={() => setTripEdit(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            {tripEdit.bookingId} · {tripEdit.passengerId?.name}. The fare follows the route unless you type your own. The passenger is told about the change in the app and by email.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <AddressAutocomplete label="Pickup address" defaultValue={tePickup?.label} onSelect={setTePickup} required />
            {teStops.map((stop, i) => (
              <div key={stop.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <AddressAutocomplete label={`Stop ${i + 1}`} defaultValue={stop.selection?.label} onSelect={(sel) => teStopHandlers.update(stop.id, sel)} required />
                </div>
                <button type="button" className="btn danger" style={{ marginBottom: 1 }} onClick={() => teStopHandlers.remove(stop.id)}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn secondary" style={{ alignSelf: 'flex-start' }} onClick={teStopHandlers.add}>+ Add stop</button>
            <AddressAutocomplete label="Drop-off address" defaultValue={teDrop?.label} onSelect={setTeDrop} required />
            <ScheduleField onChange={setTeScheduledFor} defaultValue={teScheduledFor} />
            <div>
              <label>Fare (NZD)</label>
              <input type="number" inputMode="decimal" min="0.01" step="0.01" value={teFare}
                onFocus={(e) => e.target.select()}
                onChange={(e) => { setTeFare(e.target.value); setTeFareCustom(true); }} />
              <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                Was ${Number(tripEdit.estimatedFare).toFixed(2)}.
                {tePreview && <> Calculated for this route: ${tePreview.estimatedFare.toFixed(2)} ({tePreview.distanceKm} km{teStops.length > 0 && `, via ${teStops.length} stop${teStops.length > 1 ? 's' : ''}`}).</>}
                {tePreview && teFareCustom && Number(teFare) !== tePreview.estimatedFare && (
                  <> <button type="button" onClick={() => { setTeFareCustom(false); setTeFare(tePreview.estimatedFare.toFixed(2)); }}
                    style={{ background: 'none', border: 'none', padding: 0, width: 'auto', color: 'var(--primary)', cursor: 'pointer', font: 'inherit' }}>
                    Use calculated ${tePreview.estimatedFare.toFixed(2)}</button>.</>
                )}
                {teFareCustom && Number(teFare) !== tePreview?.estimatedFare && ' Your own fare is kept as set - discounts won\'t change it.'}
              </p>
            </div>
            {teError && <p className="error-text" style={{ margin: 0 }}>{teError}</p>}
          </div>
          <div className="booking-row" style={{ border: 'none', paddingBottom: 0 }}>
            <div className="booking-actions trip-actions">
              <button className="btn secondary" onClick={() => setTripEdit(null)}>Cancel</button>
              <button className="btn" disabled={teSaving || !tePreview} onClick={saveTripEdit}>{teSaving ? 'Saving...' : 'Save changes'}</button>
            </div>
          </div>
        </Modal>
      )}

      {fareDialog && (() => {
        const { mode, booking: fb, fare, paymentPending, error, saving } = fareDialog;
        // Editing can switch the payment type; completing keeps the booked one.
        const method = (mode === 'edit' && fareDialog.paymentMethod) || fb.paymentMethod;
        const isCash = method !== 'card';
        const cardPaid = fb.paymentMethod === 'card' && fb.paymentStatus === 'paid';
        const canSwitchMethod = mode === 'edit' && !cardPaid;
        const set = (patch) => setFareDialog((d) => ({ ...d, ...patch, error: '' }));
        return (
          <Modal title={mode === 'complete' ? 'Complete trip' : 'Edit trip'} onClose={() => setFareDialog(null)}>
            <p className="muted" style={{ marginTop: 0 }}>{fb.bookingId}<br />{fb.pickupAddress} → {fb.dropAddress}</p>
            <label>Fare charged (NZD)</label>
            <input type="number" inputMode="decimal" min="0.01" step="0.01" autoFocus value={fare} disabled={cardPaid}
              onFocus={(e) => e.target.select()}
              onChange={(e) => set({ fare: e.target.value })} />
            <p className="muted" style={{ margin: '4px 0 12px', fontSize: '0.85rem' }}>
              Estimate was ${fb.estimatedFare}.{cardPaid ? ' Already paid online, so the fare can\'t be changed.' : ''}
            </p>
            {canSwitchMethod && (
              <>
                <label>Payment type</label>
                <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal' }}>
                    <input type="radio" name="fare-method" checked={isCash} style={{ width: 'auto' }} onChange={() => set({ paymentMethod: 'cash' })} />
                    Cash
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal', opacity: profile?.acceptsOnlinePayment === false ? 0.5 : 1 }}>
                    <input type="radio" name="fare-method" checked={!isCash} style={{ width: 'auto' }} disabled={profile?.acceptsOnlinePayment === false}
                      onChange={() => set({ paymentMethod: 'card' })} />
                    Card (online)
                  </label>
                </div>
              </>
            )}
            {isCash ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal' }}>
                  <input type="radio" name="fare-paid" checked={!paymentPending} style={{ width: 'auto' }} onChange={() => set({ paymentPending: false })} />
                  Paid (cash received)
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal' }}>
                  <input type="radio" name="fare-paid" checked={paymentPending} style={{ width: 'auto' }} onChange={() => set({ paymentPending: true })} />
                  Payment pending - passenger will pay later
                </label>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {cardPaid ? 'Paid online by card.' : 'Card trip - the passenger pays online. Use "Remind to pay" to send them the payment link.'}
              </p>
            )}
            {mode === 'complete' && waLink(fb.passengerId?.mobile) && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal' }}>
                  <input type="checkbox" checked={!!fareDialog.sendWhatsApp} style={{ width: 'auto' }}
                    onChange={(e) => set({ sendWhatsApp: e.target.checked })} />
                  <span><WhatsAppIcon /> Send receipt on WhatsApp</span>
                </label>
                <p className="muted" style={{ margin: '4px 0 0 26px', fontSize: '0.85rem' }}>
                  {fb.passengerHasEmail
                    ? 'Optional - the passenger is emailed their receipt anyway.'
                    : 'No email on file for this passenger, so WhatsApp is the only way they get a receipt.'}
                  {!isCash && fb.paymentStatus !== 'paid' ? ' Includes the online payment link.' : ''}
                </p>
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
            <div className="booking-row" style={{ border: 'none', paddingBottom: 0 }}>
              <div className="booking-actions trip-actions">
                <button className="btn secondary" onClick={() => setFareDialog(null)}>Cancel</button>
                <button className="btn" disabled={saving || (cardPaid && mode === 'edit')} onClick={saveFareDialog}>
                  {mode === 'complete' ? 'Complete trip' : saving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
