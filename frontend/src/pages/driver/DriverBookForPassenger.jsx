import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import PhoneField from '../../components/PhoneField';
import ScheduleField from '../../components/ScheduleField';
import { waLink } from '../../utils/whatsapp';
import { makeStopHandlers, stopsPayload } from '../../utils/stops';
import ContactAdmin from '../../components/ContactAdmin';
import { formatNzDateTime } from '../../utils/nzTime';

export default function DriverBookForPassenger() {
  const navigate = useNavigate();
  // Arriving from Add passenger ("Book a trip for them") preselects them.
  const preselected = useLocation().state?.passenger || null;
  const [mode, setMode] = useState('search'); // 'search' | 'new'
  const [query, setQuery] = useState(preselected?.name || '');
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(preselected);
  const [newPassenger, setNewPassenger] = useState({ name: '', mobile: '', email: '', address: '' });
  const timer = useRef(null);

  const [pickup, setPickup] = useState(null);
  const [drop, setDrop] = useState(null);
  const [stops, setStops] = useState([]);
  const stopHandlers = makeStopHandlers(setStops);
  const [scheduledFor, setScheduledFor] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null);

  function searchPassengers(value) {
    setQuery(value);
    setSelected(null);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) { setMatches([]); return; }
    timer.current = setTimeout(async () => {
      const { data } = await client.get('/driver/passengers/search', { params: { q: value } });
      setMatches(data);
    }, 350);
  }

  useEffect(() => {
    setQuote(null);
    setError('');
    if (!pickup || !drop) return;
    if (stops.some((s) => !s.selection)) return;
    let cancelled = false;
    setQuoteLoading(true);
    client.post('/booking/quote', { pickupLat: pickup.lat, pickupLng: pickup.lng, dropLat: drop.lat, dropLng: drop.lng, stops: stopsPayload(stops), paymentMethod })
      .then((r) => { if (!cancelled) setQuote(r.data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'Could not calculate fare'); })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [pickup, drop, stops, paymentMethod]);

  const passengerReady = mode === 'search' ? !!selected : !!(newPassenger.name && newPassenger.mobile && newPassenger.address);

  async function confirmBooking() {
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post('/driver/bookings', {
        ...(mode === 'search'
          ? { passengerId: selected._id }
          : {
            passengerName: newPassenger.name,
            passengerMobile: newPassenger.mobile,
            passengerAddress: newPassenger.address,
            passengerEmail: newPassenger.email || undefined,
          }),
        pickupAddress: pickup.label, pickupLat: pickup.lat, pickupLng: pickup.lng,
        dropAddress: drop.label, dropLat: drop.lat, dropLng: drop.lng,
        stops: stopsPayload(stops),
        scheduledFor,
        paymentMethod,
      });
      setSuccess(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create booking');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 480, background: '#dcfce7' }}>
          <h3>Booking created</h3>
          <p>For {success.passenger.name} ({success.passenger.mobile}) - ${success.booking.estimatedFare} estimated, already marked accepted.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => navigate('/driver')}>Back to trips</button>
            {waLink(success.passenger.mobile, `Hi ${success.passenger.name}, your EasyRide ride is booked (${success.booking.bookingId}). Pickup: ${success.booking.pickupAddress}, drop: ${success.booking.dropAddress}. Estimated fare: $${success.booking.estimatedFare}.`) && (
              <a className="btn secondary" target="_blank" rel="noreferrer"
                href={waLink(success.passenger.mobile, `Hi ${success.passenger.name}, your EasyRide ride is booked (${success.booking.bookingId}). Pickup: ${success.booking.pickupAddress}, drop: ${success.booking.dropAddress}. Estimated fare: $${success.booking.estimatedFare}.`)}>
                WhatsApp passenger
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Book a trip for a passenger</h1>
      <p className="muted">For phone or walk-up bookings. It's assigned straight to you, already accepted.</p>

      <div className="card" style={{ maxWidth: 520 }}>
        <div className="tabs">
          <button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>Existing passenger</button>
          <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>New passenger</button>
        </div>

        {mode === 'search' && (
          <div>
            <label>Search by name, email or mobile</label>
            <input value={query} onChange={(e) => searchPassengers(e.target.value)} placeholder="e.g. Jane or 021..." />
            {matches.length > 0 && (
              <div className="autocomplete-list" style={{ position: 'static', marginTop: 6 }}>
                {matches.map((m) => (
                  <div key={m._id} className="autocomplete-item" style={{ background: selected?._id === m._id ? '#fff7ed' : undefined }} onClick={() => { setSelected(m); setMatches([]); setQuery(m.name); }}>
                    {m.name} · {m.mobile || m.email}
                  </div>
                ))}
              </div>
            )}
            {selected && <p className="muted" style={{ marginTop: 6 }}>Selected: <strong>{selected.name}</strong> ({selected.mobile || selected.email})</p>}
          </div>
        )}

        {mode === 'new' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="muted">This creates a new passenger account on the spot - no email verification or password needed to book right now.</p>
            <div><label>Full name</label><input value={newPassenger.name} onChange={(e) => setNewPassenger((p) => ({ ...p, name: e.target.value }))} required /></div>
            <PhoneField value={newPassenger.mobile} onChange={(v) => setNewPassenger((p) => ({ ...p, mobile: v }))} required hint="Their booking confirmation is sent here on WhatsApp." />
            <AddressAutocomplete label="Address" placeholder="For trip records" onSelect={(r) => setNewPassenger((p) => ({ ...p, address: r ? r.label : '' }))} required />
            <div><label>Email (optional)</label><input type="email" value={newPassenger.email} onChange={(e) => setNewPassenger((p) => ({ ...p, email: e.target.value }))} /></div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
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
          {(!pickup || !drop) && <p className="muted">Enter both pickup and drop address (pick a suggestion from the list) to see the fare and confirm.</p>}
          <ScheduleField onChange={setScheduledFor} />

          <div>
            <label>Payment</label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" style={{ width: 'auto' }} checked={paymentMethod === 'cash'} onChange={() => setPaymentMethod('cash')} /> Cash
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" style={{ width: 'auto' }} checked={paymentMethod === 'card'} onChange={() => setPaymentMethod('card')} /> Passenger pays online
              </label>
            </div>
          </div>

          {quoteLoading && <p className="muted">Calculating fare...</p>}

          {quote && !quoteLoading && (
            <div className="card fare-confirm">
              <strong>Estimated fare: ${quote.estimatedFare.toFixed(2)}</strong>
              {quote.cardSurchargeAmount > 0 && (
                <div className="muted">+ ${quote.cardSurchargeAmount.toFixed(2)} card processing fee (Stripe, NZ cards) = <strong>${quote.total.toFixed(2)} total</strong> - overseas cards cost a little more</div>
              )}
              <div className="muted">{quote.distanceKm} km{stops.length > 0 && ` · via ${stops.length} stop${stops.length > 1 ? 's' : ''}`}{scheduledFor && ` · scheduled for ${formatNzDateTime(scheduledFor)}`}</div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn" style={{ marginTop: 8 }} onClick={confirmBooking} disabled={loading || !passengerReady}>
                {loading ? 'Booking...' : 'Confirm booking'}
              </button>
              {!passengerReady && <p className="muted">Select or register a passenger first.</p>}
            </div>
          )}

          {!quote && !quoteLoading && error && (
            <div>
              <p className="error-text">{error}</p>
              <ContactAdmin context="booking for a passenger" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
