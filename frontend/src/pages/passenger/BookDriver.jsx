import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import AddressAutocomplete from '../../components/AddressAutocomplete';

export default function BookDriver() {
  const { driverId } = useParams();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [driver, setDriver] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [pickup, setPickup] = useState(null);
  const [drop, setDrop] = useState(null);
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
      .catch(() => setNotFound(true));
  }, [user, driverId]);

  useEffect(() => {
    setQuote(null);
    setError('');
    if (!pickup || !drop) return;
    let cancelled = false;
    setQuoteLoading(true);
    client.post('/booking/quote', { driverId, pickupLat: pickup.lat, pickupLng: pickup.lng, dropLat: drop.lat, dropLng: drop.lng })
      .then((r) => { if (!cancelled) setQuote(r.data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'Could not calculate fare'); })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [pickup, drop, driverId]);

  async function confirmBooking() {
    setError('');
    setLoading(true);
    try {
      await client.post('/booking', {
        driverId,
        pickupAddress: pickup.label, pickupLat: pickup.lat, pickupLng: pickup.lng,
        dropAddress: drop.label, dropLat: drop.lat, dropLng: drop.lng,
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

          {preview && (
            <div className="driver-chip">
              🚖 <strong>{preview.name}</strong> · {preview.vehicleType} · ⭐ {preview.rating || 'new'}
            </div>
          )}

          <ul className="feature-list">
            <li>✅ See your fare before you confirm</li>
            <li>✅ Book this exact driver directly</li>
            <li>✅ NZ Transport Agency compliant</li>
            <li>✅ Live trip status the moment they accept</li>
          </ul>

          <div className="cta-row">
            <Link className="btn" to="/register" state={{ from: `/book/${driverId}` }}>Create free account</Link>
            <Link className="btn secondary" to="/login" state={{ from: `/book/${driverId}` }}>Log in to book</Link>
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
        <h2>Book this driver</h2>
        {driver ? (
          <p className="muted">{driver.name} · {driver.vehicleType} · {driver.vehicleNumber} · ${driver.ratePerKm}/km · ⭐ {driver.rating || 'new'}</p>
        ) : <p className="muted">Loading driver details...</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AddressAutocomplete label="Pickup address" onSelect={setPickup} required />
          <AddressAutocomplete label="Drop address" onSelect={setDrop} required />

          {quoteLoading && <p className="muted">Calculating fare...</p>}

          {quote && !quoteLoading && (
            <div className="card fare-confirm">
              <strong>Estimated fare: ${quote.estimatedFare.toFixed(2)}</strong>
              <div className="muted">{quote.distanceKm} km</div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn" style={{ marginTop: 8 }} onClick={confirmBooking} disabled={loading || !driver}>
                {loading ? 'Requesting...' : 'Confirm & request this driver'}
              </button>
            </div>
          )}

          {!quote && !quoteLoading && error && <p className="error-text">{error}</p>}
        </div>
      </div>
    </div>
  );
}
