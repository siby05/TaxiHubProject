import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import client from '../../api/client';
import StripePaymentModal from '../../components/StripePaymentModal';

// Deep link a driver sends over WhatsApp when a completed trip's card
// payment is still outstanding (see pages/driver/DriverDashboard.jsx
// complete()) - lands the passenger straight on this one booking instead
// of their full list. Wrapped in <ProtectedRoute roles={['passenger']}>
// in App.jsx, which now preserves this URL as the post-login redirect
// target if they weren't already signed in.
export default function PayBooking() {
  const { bookingId } = useParams();
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [payModal, setPayModal] = useState(null);

  function load() {
    client.get(`/booking/${bookingId}`)
      .then((r) => setBooking(r.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load this booking'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [bookingId]);

  async function payNow() {
    setError('');
    setPaying(true);
    try {
      const { data } = await client.post('/payment/create-intent', { bookingId });
      if (data.mock === false) {
        setPayModal({ clientSecret: data.clientSecret });
      } else {
        load();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Payment failed');
    } finally {
      setPaying(false);
    }
  }

  if (loading) return <div className="container"><p className="muted">Loading...</p></div>;

  if (error && !booking) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 420 }}>
          <p className="error-text">{error}</p>
          <Link className="btn secondary" to="/passenger">Go to my bookings</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 420 }}>
        <h2 style={{ marginTop: 0 }}>Trip payment</h2>
        <p className="muted">{booking.bookingId}</p>
        <p>{booking.pickupAddress} → {booking.dropAddress}</p>
        <p><strong>Fare: ${booking.actualFare ?? booking.estimatedFare}</strong></p>

        {booking.paymentMethod !== 'card' ? (
          <p className="muted">This trip is set to pay by cash - no online payment needed.</p>
        ) : booking.paymentStatus === 'paid' ? (
          <p style={{ color: 'var(--success)', fontWeight: 600 }}>✅ Already paid - thanks!</p>
        ) : (
          <>
            {error && <p className="error-text">{error}</p>}
            <button className="btn" onClick={payNow} disabled={paying}>{paying ? 'Paying...' : 'Pay now'}</button>
          </>
        )}

        <div style={{ marginTop: 16 }}>
          <Link className="btn secondary" to="/passenger">Go to my bookings</Link>
        </div>
      </div>

      {payModal && (
        <StripePaymentModal
          bookingId={bookingId}
          clientSecret={payModal.clientSecret}
          onClose={() => setPayModal(null)}
          onSuccess={() => { setPayModal(null); load(); }}
        />
      )}
    </div>
  );
}
