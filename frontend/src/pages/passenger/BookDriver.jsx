import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import ScheduleField from '../../components/ScheduleField';

export default function BookDriver() {
  const { driverId } = useParams();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [driver, setDriver] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [pickup, setPickup] = useState(null);
  const [drop, setDrop] = useState(null);
  const [scheduledFor, setScheduledFor] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [error, setError] = useState('');
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
    if (!pickup || !drop) return;
    let cancelled = false;
    setQuoteLoading(true);
    client.post('/booking/quote', { driverId: effectiveDriverId, pickupLat: pickup.lat, pickupLng: pickup.lng, dropLat: drop.lat, dropLng: drop.lng })
      .then((r) => { if (!cancelled) setQuote(r.data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'Could not calculate fare'); })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [pickup, drop, effectiveDriverId]);

  async function confirmBooking() {
    setError('');
    setLoading(true);
    try {
      await client.post('/booking', {
        driverId: effectiveDriverId,
        pickupAddress: pickup.label, pickupLat: pickup.lat, pickupLng: pickup.lng,
        dropAddress: drop.label, dropLat: drop.lat, dropLng: drop.lng,
        scheduledFor,
      });
      navigate('/passenger');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create booking');
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return (
      <div className="container">
        <div className="hero">
          <div className="eyebrow">You scanned a TaxiHub driver</div>
          <h1>Your ride, on your terms.</h1>
          <p className="tagline">Upfront fares, direct booking with the driver in front of you, and live updates the moment they accept.</p>

          {preview && preview.available && (
            <div className="driver-chip">
              🚖 <strong>{preview.name}</strong> · {preview.vehicleType} · ⭐ {preview.rating || 'new'}
            </div>
          )}
          {preview && !preview.available && (
            <div className="card" style={{ background: '#fef3c7', maxWidth: 420, margin: '0 auto 20px', textAlign: 'left' }}>
              ⚠️ <strong>{preview.name || 'This driver'}</strong> isn't currently taking bookings. Sign up or log in and we'll match you with an available driver instead.
            </div>
          )}

          <ul className="feature-list">
            <li>✅ See your fare before you confirm</li>
            <li>✅ Book this exact driver directly</li>
            <li>✅ Admin-vetted, licensed drivers</li>
            <li>✅ Live trip status the moment they accept</li>
          </ul>

          <div className="cta-row">
            <Link className="btn" to="/register" state={{ from: `/book/${driverId}` }}>Create free account</Link>
            <Link className="btn secondary" to="/login" state={{ from: `/book/${driverId}` }}>Log in to book</Link>
          </div>

          <div className="grid cols-2" style={{ marginTop: 32, textAlign: 'left' }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>About TaxiHub</h3>
              <p className="muted">
                TaxiHub connects you directly with a driver by scanning the QR code in their vehicle - like flagging
                a cab, but with an upfront price and a booking record. Every driver on the platform is added and
                approved by an admin, holds a registered license and vehicle, and has a rating built from real
                completed trips. If a driver isn't taking bookings right now, we match you with another available
                one automatically instead of leaving you stuck.
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
          <AddressAutocomplete label="Drop address" onSelect={setDrop} required />
          <ScheduleField onChange={setScheduledFor} />

          {quoteLoading && <p className="muted">Calculating fare...</p>}

          {quote && !quoteLoading && (
            <div className="card fare-confirm">
              <strong>Estimated fare: ${quote.estimatedFare.toFixed(2)}</strong>
              <div className="muted">{quote.distanceKm} km{scheduledFor && ` · scheduled for ${new Date(scheduledFor).toLocaleString()}`}</div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn" style={{ marginTop: 8 }} onClick={confirmBooking} disabled={loading || !driver}>
                {loading ? 'Requesting...' : effectiveDriverId ? 'Confirm & request this driver' : 'Confirm & request ride'}
              </button>
            </div>
          )}

          {!quote && !quoteLoading && error && <p className="error-text">{error}</p>}
        </div>
      </div>
    </div>
  );
}
