import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuthStore } from '../../store/authStore';

export default function BookDriver() {
  const { driverId } = useParams();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [driver, setDriver] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState({ pickupAddress: '', pickupLat: '', pickupLng: '', dropAddress: '', dropLat: '', dropLng: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || user.role !== 'passenger') return;
    client.get(`/booking/driver-info/${driverId}`)
      .then((r) => setDriver(r.data))
      .catch(() => setNotFound(true));
  }, [user, driverId]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await client.post('/booking', {
        ...form,
        driverId,
        pickupLat: Number(form.pickupLat),
        pickupLng: Number(form.pickupLng),
        dropLat: Number(form.dropLat),
        dropLng: Number(form.dropLng),
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
        <div className="card" style={{ maxWidth: 420 }}>
          <h2>Book this driver</h2>
          <p className="muted">You scanned a driver's QR code. Log in or sign up to continue - you'll land right back here.</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link className="btn" to="/login" state={{ from: `/book/${driverId}` }}>Log in</Link>
            <Link className="btn secondary" to="/register" state={{ from: `/book/${driverId}` }}>Sign up</Link>
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

        <form onSubmit={onSubmit}>
          <div><label>Pickup address</label><input value={form.pickupAddress} onChange={(e) => update('pickupAddress', e.target.value)} required /></div>
          <div className="grid cols-2">
            <div><label>Pickup latitude</label><input type="number" step="any" value={form.pickupLat} onChange={(e) => update('pickupLat', e.target.value)} required /></div>
            <div><label>Pickup longitude</label><input type="number" step="any" value={form.pickupLng} onChange={(e) => update('pickupLng', e.target.value)} required /></div>
          </div>
          <div><label>Drop address</label><input value={form.dropAddress} onChange={(e) => update('dropAddress', e.target.value)} required /></div>
          <div className="grid cols-2">
            <div><label>Drop latitude</label><input type="number" step="any" value={form.dropLat} onChange={(e) => update('dropLat', e.target.value)} required /></div>
            <div><label>Drop longitude</label><input type="number" step="any" value={form.dropLng} onChange={(e) => update('dropLng', e.target.value)} required /></div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" disabled={loading || !driver}>{loading ? 'Requesting...' : 'Request this driver'}</button>
        </form>
      </div>
    </div>
  );
}
