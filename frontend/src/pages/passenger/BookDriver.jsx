import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import ScheduleField from '../../components/ScheduleField';
import PhoneField from '../../components/PhoneField';
import { makeStopHandlers, stopsPayload } from '../../utils/stops';
import ContactAdmin from '../../components/ContactAdmin';
import { formatNzDateTime } from '../../utils/nzTime';

export default function BookDriver() {
  const { driverId } = useParams();
  const { user, setSession } = useAuthStore();
  const navigate = useNavigate();
  const [driver, setDriver] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [pickup, setPickup] = useState(null);
  const [drop, setDrop] = useState(null);
  const [stops, setStops] = useState([]);
  const stopHandlers = makeStopHandlers(setStops);
  const [scheduledFor, setScheduledFor] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [error, setError] = useState('');
  const [nextAvailableTime, setNextAvailableTime] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.get(`/booking/driver-preview/${driverId}`).then((r) => setPreview(r.data)).catch(() => {});
  }, [driverId]);

  useEffect(() => {
    if (!user || user.role !== 'passenger') return;
    client.get(`/booking/driver-info/${driverId}`)
      .then((r) => setDriver(r.data))
      .catch((err) => { if (err.response?.status === 404) setNotFound(true); });
  }, [user, driverId]);

  // Only hail the specific driver when they're still approved; otherwise
  // send no driverId at all so the backend auto-matches any available
  // driver (same fallback the backend also applies defensively itself).
  const effectiveDriverId = driver?.available ? driverId : undefined;

  useEffect(() => {
    setQuote(null);
    setError('');
    setNextAvailableTime(null);
    if (!pickup || !drop) return;
    if (stops.some((s) => !s.selection)) return;
    let cancelled = false;
    setQuoteLoading(true);
    client.post('/booking/quote', { driverId: effectiveDriverId, pickupLat: pickup.lat, pickupLng: pickup.lng, dropLat: drop.lat, dropLng: drop.lng, stops: stopsPayload(stops), paymentMethod, scheduledFor })
      .then((r) => { if (!cancelled) setQuote(r.data); })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Could not calculate fare');
        setNextAvailableTime(err.response?.data?.nextAvailableTime || null);
      })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [pickup, drop, stops, effectiveDriverId, paymentMethod, scheduledFor]);

  async function confirmBooking() {
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post('/booking', {
        driverId: effectiveDriverId,
        pickupAddress: pickup.label, pickupLat: pickup.lat, pickupLng: pickup.lng,
        dropAddress: drop.label, dropLat: drop.lat, dropLng: drop.lng,
        stops: stopsPayload(stops),
        scheduledFor,
        paymentMethod,
        viaQr: true,
      });
      // Auto-accepted (this page only exists behind a QR scan) - if paying
      // online, go straight to the payment page instead of the dashboard;
      // the trip's already confirmed, so there's no "wait for accept" step.
      navigate(paymentMethod === 'card' ? `/pay/${data._id}` : '/passenger');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create booking');
      setNextAvailableTime(err.response?.data?.nextAvailableTime || null);
    } finally {
      setLoading(false);
    }
  }

  // Guest checkout (no account) - the "scan the QR, book, done" path.
  // Full registration (below) still exists side by side for anyone who
  // wants an account to track trip history from.
  const [guestName, setGuestName] = useState('');
  const [guestMobile, setGuestMobile] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestAddress, setGuestAddress] = useState('');
  // null = new guest; otherwise { firstName, hasEmail, hasAddress } from
  // /guest-lookup - the saved values themselves stay server-side.
  const [guestReturning, setGuestReturning] = useState(null);
  const [guestPickup, setGuestPickup] = useState(null);
  const [guestDrop, setGuestDrop] = useState(null);
  const [guestStops, setGuestStops] = useState([]);
  const guestStopHandlers = makeStopHandlers(setGuestStops);
  const [guestScheduledFor, setGuestScheduledFor] = useState(null);
  const [guestPaymentMethod, setGuestPaymentMethod] = useState('cash');
  const [guestQuote, setGuestQuote] = useState(null);
  const [guestQuoteLoading, setGuestQuoteLoading] = useState(false);
  const [guestError, setGuestError] = useState('');
  const [guestNextAvailable, setGuestNextAvailable] = useState(null);
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestSuccess, setGuestSuccess] = useState(null);

  // As soon as a full number is typed, check if we've seen them before -
  // prefills name/email/address (never pickup/drop, those are per-trip)
  // for a returning guest instead of making them retype everything.
  useEffect(() => {
    setGuestReturning(null);
    if (!guestMobile || guestMobile.replace(/\D/g, '').length < 8) return;
    let cancelled = false;
    const t = setTimeout(() => {
      client.get('/booking/guest-lookup', { params: { mobile: guestMobile } }).then((r) => {
        if (cancelled || !r.data.found) return;
        setGuestReturning(r.data);
      }).catch(() => {});
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [guestMobile]);

  useEffect(() => {
    setGuestQuote(null);
    setGuestError('');
    setGuestNextAvailable(null);
    if (!guestPickup || !guestDrop) return;
    if (guestStops.some((s) => !s.selection)) return;
    let cancelled = false;
    setGuestQuoteLoading(true);
    client.post('/booking/guest-quote', { driverId, pickupLat: guestPickup.lat, pickupLng: guestPickup.lng, dropLat: guestDrop.lat, dropLng: guestDrop.lng, stops: stopsPayload(guestStops), paymentMethod: guestPaymentMethod, scheduledFor: guestScheduledFor })
      .then((r) => { if (!cancelled) setGuestQuote(r.data); })
      .catch((err) => {
        if (cancelled) return;
        setGuestError(err.response?.data?.error || 'Could not calculate fare');
        setGuestNextAvailable(err.response?.data?.nextAvailableTime || null);
      })
      .finally(() => { if (!cancelled) setGuestQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [guestPickup, guestDrop, guestStops, guestPaymentMethod, guestScheduledFor, driverId]);

  // A returning guest's name/address fields are hidden (the server already
  // has them - see /guest-lookup), so only require what's actually shown.
  const guestMissing = [
    !guestMobile && 'mobile',
    !guestReturning && !guestName && 'full name',
    !guestReturning?.hasAddress && !guestAddress && 'home address (pick one from the suggestions)',
  ].filter(Boolean);

  async function confirmGuestBooking() {
    setGuestError('');
    setGuestLoading(true);
    try {
      const { data } = await client.post('/booking/guest', {
        driverId,
        passengerName: guestName || undefined, passengerMobile: guestMobile, passengerEmail: guestEmail || undefined, passengerAddress: guestAddress || undefined,
        pickupAddress: guestPickup.label, pickupLat: guestPickup.lat, pickupLng: guestPickup.lng,
        dropAddress: guestDrop.label, dropLat: guestDrop.lat, dropLng: guestDrop.lng,
        stops: stopsPayload(guestStops),
        scheduledFor: guestScheduledFor,
        paymentMethod: guestPaymentMethod,
      });
      if (data.token) {
        // Card payment: quietly log them into the (already-created)
        // passenger account behind this guest booking, so they can reach
        // the same login-gated /pay/:bookingId + Stripe flow every other
        // passenger uses - guest checkout has no other way back in to pay.
        setSession(data.token, data.user);
        navigate(`/pay/${data._id}`);
        return;
      }
      setGuestSuccess(data);
    } catch (err) {
      setGuestError(err.response?.data?.error || 'Could not create booking');
      setGuestNextAvailable(err.response?.data?.nextAvailableTime || null);
    } finally {
      setGuestLoading(false);
    }
  }

  if (!user) {
    if (guestSuccess) {
      return (
        <div className="container">
          <div className="card" style={{ maxWidth: 460, margin: '40px auto', background: '#dcfce7' }}>
            <h2 style={{ marginTop: 0 }}>Ride confirmed!</h2>
            <p>{guestSuccess.bookingId} · {guestSuccess.pickupAddress} → {guestSuccess.dropAddress}</p>
            <p><strong>Estimated fare: ${guestSuccess.estimatedFare}</strong></p>
            <p className="muted">
              {preview?.name || 'The driver'} has been notified and is on the way. We've saved your details
              under {guestMobile} - next time you scan a car's QR code, just enter the same number and your details
              fill in automatically.
            </p>
            <p className="muted">Want to track this trip and your history? <Link to="/register" state={{ from: `/book/${driverId}` }}>Create a free account</Link> using the same mobile number.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="container">
        <div className="hero">
          <div className="eyebrow">You scanned an EasyRide driver</div>
          <h1>Your ride, on your terms.</h1>
          <p className="tagline">Upfront fares, direct booking with the driver in front of you, and live updates the moment they accept.</p>

          {preview && preview.available && (
            <div className="driver-chip">
              🚖 <strong>{preview.name}</strong> · {preview.vehicleType} · ⭐ {preview.rating || 'new'}
            </div>
          )}
          {preview && !preview.available && (
            <div className="card" style={{ background: '#fef3c7', maxWidth: 420, margin: '0 auto 20px', textAlign: 'left' }}>
              ⚠️ <strong>{preview.name || 'This driver'}</strong> isn't currently taking bookings.
            </div>
          )}
        </div>

        {preview && preview.available && (
          <div className="card" style={{ maxWidth: 460, margin: '0 auto', textAlign: 'left' }}>
            <h3 style={{ marginTop: 0 }}>Book now - no account needed</h3>
            {guestReturning && <p className="muted" style={{ color: 'var(--success)' }}>👋 Welcome back{guestReturning.firstName ? `, ${guestReturning.firstName}` : ''} - we have your details on file, so you only need to fill in what's new.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <PhoneField label="Mobile" value={guestMobile} onChange={setGuestMobile} required hint="We'll remember your name and address for next time." />
              {!guestReturning && <div><label>Full name</label><input value={guestName} onChange={(e) => setGuestName(e.target.value)} required /></div>}
              {!guestReturning?.hasEmail && <div><label>Email (optional)</label><input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} /></div>}
              {!guestReturning?.hasAddress && <AddressAutocomplete label="Home address" defaultValue={guestAddress} onSelect={(r) => setGuestAddress(r ? r.label : '')} required />}

              <AddressAutocomplete label="Pickup address" onSelect={setGuestPickup} required allowLocate />

              {guestStops.map((stop, i) => (
                <div key={stop.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <AddressAutocomplete label={`Stop ${i + 1}`} onSelect={(sel) => guestStopHandlers.update(stop.id, sel)} required />
                  </div>
                  <button type="button" className="btn danger" style={{ marginBottom: 1 }} onClick={() => guestStopHandlers.remove(stop.id)}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn secondary" style={{ alignSelf: 'flex-start' }} onClick={guestStopHandlers.add}>+ Add stop</button>

              <AddressAutocomplete label="Drop address" onSelect={setGuestDrop} required />
              <ScheduleField onChange={setGuestScheduledFor} />

              <div>
                <label>Payment</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="radio" style={{ width: 'auto' }} checked={guestPaymentMethod === 'cash'} onChange={() => setGuestPaymentMethod('cash')} /> Cash to driver
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="radio" style={{ width: 'auto' }} checked={guestPaymentMethod === 'card'} onChange={() => setGuestPaymentMethod('card')} /> Pay online
                  </label>
                </div>
                {guestPaymentMethod === 'card' && <p className="muted">You'll be taken straight to a secure payment page once you confirm - this ride is booked directly with this driver, no waiting on an accept step.</p>}
              </div>

              {guestQuoteLoading && <p className="muted">Calculating fare...</p>}
              {guestQuote && !guestQuoteLoading && (
                <div className="card fare-confirm">
                  {guestQuote.requestedCashOnly && (
                    <p className="muted" style={{ color: '#b45309' }}>⚠️ {guestQuote.requestedName || 'This driver'} is cash-only.</p>
                  )}
                  {guestQuote.requestedOffSchedule && (
                    <p className="muted" style={{ color: '#b45309' }}>⚠️ {guestQuote.requestedName || 'This driver'} isn't scheduled to work at that time - matching you with another driver who is.</p>
                  )}
                  <strong>Estimated fare: ${guestQuote.estimatedFare.toFixed(2)}</strong>
                  <div className="muted">{guestQuote.distanceKm} km{guestStops.length > 0 && ` · via ${guestStops.length} stop${guestStops.length > 1 ? 's' : ''}`}{guestScheduledFor && ` · scheduled for ${formatNzDateTime(guestScheduledFor)}`}</div>
                  {guestError && <p className="error-text">{guestError}</p>}
                  {guestMissing.length > 0 && <p className="muted">Still needed: {guestMissing.join(', ')}.</p>}
                  <button className="btn" style={{ marginTop: 8 }}
                    onClick={confirmGuestBooking}
                    disabled={guestLoading || guestMissing.length > 0}>
                    {guestLoading ? 'Requesting...' : 'Confirm & request ride'}
                  </button>
                </div>
              )}
              {!guestQuote && !guestQuoteLoading && guestError && (
                <div>
                  <p className="error-text">{guestError}</p>
                  {guestNextAvailable && (
                    <p className="muted">
                      Next available: <strong>{formatNzDateTime(guestNextAvailable)}</strong> - toggle
                      "Schedule for later" above and enter this time instead.
                    </p>
                  )}
                  <ContactAdmin context="scanning a driver's QR code" />
                </div>
              )}
            </div>
          </div>
        )}

        <p className="muted" style={{ textAlign: 'center', marginTop: 20 }}>
          Prefer an account to track your trip history? <Link to="/register" state={{ from: `/book/${driverId}` }}>Sign up</Link> or <Link to="/login" state={{ from: `/book/${driverId}` }}>log in</Link>.
        </p>

        <div className="grid cols-2" style={{ marginTop: 32, textAlign: 'left' }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>About EasyRide</h3>
            <p className="muted">
              EasyRide connects you directly with a driver by scanning the QR code in their vehicle - like hailing a ride inperson, but with an upfront price and a booking record. Every driver on the platform is added and
              approved by an admin, holds a registered license and vehicle, and has a rating built from real
              completed trips.
            </p>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>How fares work</h3>
            <p className="muted">
              Every fare is a small base fare plus a per-kilometre rate set by the driver - no surge pricing, and
              you always see the total before you confirm. What you pay is exactly what the driver charges; any
              platform fee is billed to the driver separately and never added to your fare.
            </p>
            {preview && preview.available && (
              <p className="muted">This driver: {preview.vehicleType} · ⭐ {preview.rating || 'new (no ratings yet)'}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (user.role !== 'passenger') {
    return <div className="container"><p className="error-text">Only passenger accounts can book a ride.</p></div>;
  }

  if (notFound) {
    return <div className="container"><p className="error-text">This driver isn't available for booking right now.</p></div>;
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 480 }}>
        <h2>{driver?.available === false ? 'Book a ride' : 'Book this driver'}</h2>

        {!driver && <p className="muted">Loading driver details...</p>}

        {driver?.available && (
          <p className="muted">{driver.name} · {driver.vehicleType} · {driver.vehicleNumber} · ${driver.ratePerKm}/km · ⭐ {driver.rating || 'new'}</p>
        )}

        {driver && driver.available === false && (
          <div className="card" style={{ background: '#fef3c7' }}>
            ⚠️ <strong>{driver.requestedName || 'This driver'}</strong> isn't currently taking bookings ({driver.vehicleType} · {driver.vehicleNumber}).
            We'll match you with the next available driver instead.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AddressAutocomplete label="Pickup address" onSelect={setPickup} required allowLocate />

          {stops.map((stop, i) => (
            <div key={stop.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <AddressAutocomplete label={`Stop ${i + 1}`} onSelect={(sel) => stopHandlers.update(stop.id, sel)} required />
              </div>
              <button type="button" className="btn danger" style={{ marginBottom: 1 }} onClick={() => stopHandlers.remove(stop.id)}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn secondary" style={{ alignSelf: 'flex-start' }} onClick={stopHandlers.add}>+ Add stop</button>

          <AddressAutocomplete label="Drop address" onSelect={setDrop} required />
          <ScheduleField onChange={setScheduledFor} />

          <div>
            <label>Payment</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" style={{ width: 'auto' }} checked={paymentMethod === 'cash'} onChange={() => setPaymentMethod('cash')} /> Cash to driver
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" style={{ width: 'auto' }} checked={paymentMethod === 'card'} onChange={() => setPaymentMethod('card')} /> Pay online
              </label>
            </div>
            {paymentMethod === 'card' && <p className="muted">Online payment adds Stripe's card processing fee (2.65% + $0.30 for NZ cards, 3.5% + $0.30 for overseas cards) on top of the fare - the exact amount is shown before you pay.</p>}
            {paymentMethod === 'card' && <p className="muted">You'll be taken straight to a secure payment page once you confirm - this ride is booked directly with this driver, no waiting on an accept step.</p>}
          </div>

          {quoteLoading && <p className="muted">Calculating fare...</p>}

          {quote && !quoteLoading && (
            <div className="card fare-confirm">
              {quote.requestedCashOnly && (
                <p className="muted" style={{ color: '#b45309' }}>⚠️ {quote.requestedName || 'This driver'} is cash-only - matching you with another driver for online payment.</p>
              )}
              {quote.requestedOffSchedule && (
                <p className="muted" style={{ color: '#b45309' }}>⚠️ {quote.requestedName || 'This driver'} isn't scheduled to work at that time - matching you with another driver who is.</p>
              )}
              <strong>Estimated fare: ${quote.estimatedFare.toFixed(2)}</strong>
              {quote.cardSurchargeAmount > 0 && (
                <div className="muted">+ ${quote.cardSurchargeAmount.toFixed(2)} card processing fee (Stripe, NZ cards) = <strong>${quote.total.toFixed(2)} total</strong> - overseas cards cost a little more, shown before you pay</div>
              )}
              <div className="muted">{quote.distanceKm} km{stops.length > 0 && ` · via ${stops.length} stop${stops.length > 1 ? 's' : ''}`}{scheduledFor && ` · scheduled for ${formatNzDateTime(scheduledFor)}`}</div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn" style={{ marginTop: 8 }} onClick={confirmBooking} disabled={loading || !driver}>
                {loading ? 'Requesting...' : effectiveDriverId ? 'Confirm & request this driver' : 'Confirm & request ride'}
              </button>
            </div>
          )}

          {!quote && !quoteLoading && error && (
            <div>
              <p className="error-text">{error}</p>
              {nextAvailableTime && (
                <p className="muted">Next available: <strong>{formatNzDateTime(nextAvailableTime)}</strong> - toggle "Schedule for later" above and enter this time instead.</p>
              )}
              <ContactAdmin context="booking this driver" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
