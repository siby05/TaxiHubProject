import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../../api/client';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import ScheduleField from '../../components/ScheduleField';

export default function DriverBookForPassenger() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('search'); // 'search' | 'new'
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [newPassenger, setNewPassenger] = useState({ name: '', mobile: '', email: '' });
  const timer = useRef(null);

  const [pickup, setPickup] = useState(null);
  const [drop, setDrop] = useState(null);
  const [scheduledFor, setScheduledFor] = useState(null);
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
    let cancelled = false;
    setQuoteLoading(true);
    client.post('/booking/quote', { pickupLat: pickup.lat, pickupLng: pickup.lng, dropLat: drop.lat, dropLng: drop.lng })
      .then((r) => { if (!cancelled) setQuote(r.data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'Could not calculate fare'); })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [pickup, drop]);

  const passengerReady = mode === 'search' ? !!selected : !!(newPassenger.name && newPassenger.mobile);

  async function confirmBooking() {
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post('/driver/bookings', {
        ...(mode === 'search'
          ? { passengerId: selected._id }
          : { passengerName: newPassenger.name, passengerMobile: newPassenger.mobile, passengerEmail: newPassenger.email || undefined }),
        pickupAddress: pickup.label, pickupLat: pickup.lat, pickupLng: pickup.lng,
        dropAddress: drop.label, dropLat: drop.lat, dropLng: drop.lng,
        scheduledFor,
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
          <button className="btn" onClick={() => navigate('/driver')}>Back to trips</button>
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
            <div><label>Mobile</label><input value={newPassenger.mobile} onChange={(e) => setNewPassenger((p) => ({ ...p, mobile: e.target.value }))} required /></div>
            <div><label>Email (optional)</label><input type="email" value={newPassenger.email} onChange={(e) => setNewPassenger((p) => ({ ...p, email: e.target.value }))} /></div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          <AddressAutocomplete label="Pickup address" onSelect={setPickup} required allowLocate />
          <AddressAutocomplete label="Drop address" onSelect={setDrop} required />
          <ScheduleField onChange={setScheduledFor} />

          {quoteLoading && <p className="muted">Calculating fare...</p>}

          {quote && !quoteLoading && (
            <div className="card fare-confirm">
              <strong>Estimated fare: ${quote.estimatedFare.toFixed(2)}</strong>
              <div className="muted">{quote.distanceKm} km{scheduledFor && ` · scheduled for ${new Date(scheduledFor).toLocaleString()}`}</div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn" style={{ marginTop: 8 }} onClick={confirmBooking} disabled={loading || !passengerReady}>
                {loading ? 'Booking...' : 'Confirm booking'}
              </button>
              {!passengerReady && <p className="muted">Select or register a passenger first.</p>}
            </div>
          )}

          {!quote && !quoteLoading && error && <p className="error-text">{error}</p>}
        </div>
      </div>
    </div>
  );
}
