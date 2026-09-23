import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import client from '../api/client';
import Modal from './Modal';

// Only loads (and only gets used) when the frontend has a real publishable
// key configured - see payNow() in PassengerDashboard/PayBooking, which
// only opens this modal when the backend's /payment/start says mock:false.
const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

const money = (n) => `$${n.toFixed(2)}`;

// Two steps, because Stripe's fee depends on the card (NZ vs overseas -
// see backend utils/stripeFees.js): the passenger enters their card, the
// backend works out the exact card fee for it, and only once they've seen
// that total do they confirm. Charging happens server-side in /payment/pay.
function PayForm({ bookingId, onSuccess, onClose }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [card, setCard] = useState(null); // { paymentMethodId, fare, cardSurchargeAmount, total, cardRegion, brand, last4 }

  async function reviewCard(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message);
      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({ elements });
      if (pmError) throw new Error(pmError.message);
      const { data } = await client.post('/payment/card-fee', { bookingId, paymentMethodId: paymentMethod.id });
      setCard({ ...data, paymentMethodId: paymentMethod.id });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not check this card');
    } finally {
      setLoading(false);
    }
  }

  async function pay() {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.post('/payment/pay', { bookingId, paymentMethodId: card.paymentMethodId });
      if (data.status === 'requires_action') {
        // 3D Secure - Stripe shows its own challenge, then we re-check.
        const { error: actionError, paymentIntent } = await stripe.handleNextAction({ clientSecret: data.clientSecret });
        if (actionError) throw new Error(actionError.message);
        if (paymentIntent?.status !== 'succeeded') throw new Error('Payment did not complete - try again.');
      } else if (data.status !== 'succeeded') {
        throw new Error('Payment did not complete - try again.');
      }
      await client.post('/payment/confirm', { bookingId });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Payment failed');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={reviewCard}>
      <div style={{ display: card ? 'none' : 'block' }}>
        <PaymentElement />
      </div>

      {card && (
        <div>
          <p className="muted" style={{ marginTop: 0 }}>
            {card.brand?.toUpperCase()} •••• {card.last4} ({card.cardRegion === 'domestic' ? 'NZ card' : 'overseas card'})
          </p>
          <table style={{ width: '100%' }}>
            <tbody>
              <tr><td>Fare</td><td style={{ textAlign: 'right' }}>{money(card.fare)}</td></tr>
              <tr><td>Card processing fee (Stripe)</td><td style={{ textAlign: 'right' }}>{money(card.cardSurchargeAmount)}</td></tr>
              <tr><td><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{money(card.total)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {card ? (
          <>
            <button type="button" className="btn" onClick={pay} disabled={loading}>{loading ? 'Processing...' : `Pay ${money(card.total)}`}</button>
            <button type="button" className="btn secondary" onClick={() => { setCard(null); setError(''); }} disabled={loading}>Use a different card</button>
          </>
        ) : (
          <button className="btn" disabled={!stripe || loading}>{loading ? 'Checking...' : 'Continue'}</button>
        )}
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export default function StripePaymentModal({ bookingId, amount, currency, onClose, onSuccess }) {
  // The backend has a Stripe key (it said mock:false) but this build has
  // no publishable key - say so rather than silently doing nothing.
  if (!stripePromise) {
    return (
      <Modal title="Pay for your trip" onClose={onClose}>
        <p className="error-text">Online payment isn't available right now (payment setup incomplete). Please pay the driver in cash or try again later.</p>
        <button type="button" className="btn secondary" onClick={onClose}>Close</button>
      </Modal>
    );
  }
  // Deferred-intent mode: the card is collected before any PaymentIntent
  // exists, because the final amount depends on the card itself.
  const options = { mode: 'payment', amount, currency, paymentMethodCreation: 'manual', paymentMethodTypes: ['card'] };
  return (
    <Modal title="Pay for your trip" onClose={onClose}>
      <Elements stripe={stripePromise} options={options}>
        <PayForm bookingId={bookingId} onSuccess={onSuccess} onClose={onClose} />
      </Elements>
    </Modal>
  );
}
