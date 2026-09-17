import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import client from '../api/client';
import Modal from './Modal';

// Only loads (and only gets used) when the frontend has a real publishable
// key configured - see PassengerDashboard's payNow(), which only opens
// this modal when the backend's create-intent response says mock:false.
const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

function PayForm({ bookingId, onSuccess, onClose }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');

    // redirect: 'if_required' keeps the passenger in-app unless their card
    // needs 3D Secure, in which case Stripe handles the redirect itself.
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });

    if (confirmError) {
      setError(confirmError.message);
      setLoading(false);
      return;
    }
    if (paymentIntent?.status === 'succeeded') {
      await client.post('/payment/confirm', { bookingId });
      onSuccess();
    } else {
      setError('Payment did not complete - try again.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement />
      {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn" disabled={!stripe || loading}>{loading ? 'Processing...' : 'Pay'}</button>
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export default function StripePaymentModal({ bookingId, clientSecret, onClose, onSuccess }) {
  if (!stripePromise) return null;
  return (
    <Modal title="Pay for your trip" onClose={onClose}>
      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <PayForm bookingId={bookingId} onSuccess={onSuccess} onClose={onClose} />
      </Elements>
    </Modal>
  );
}
