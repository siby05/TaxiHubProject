import { useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, ExpressCheckoutElement, useStripe, useElements } from '@stripe/react-stripe-js';
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
function PayForm({ bookingId, onSuccess, onClose, tipOnly = false, baseAmount }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tipAmount, setTipAmount] = useState(tipOnly ? 5 : 0);
  const [customTip, setCustomTip] = useState('');
  const [card, setCard] = useState(null);
  const [walletBusy, setWalletBusy] = useState(false);
  // Wallets display exactly fare + selected tip. Processing fees are absorbed
  // by the platform for wallets, so the authorized sheet never understates the charge.
  useEffect(() => {
    if (elements && Number.isFinite(tipAmount) && tipAmount >= 0 && tipAmount <= 200) {
      elements.update({ amount: (tipOnly ? 0 : baseAmount) + Math.round(tipAmount * 100) });
    }
  }, [elements, baseAmount, tipAmount, tipOnly]); // { paymentMethodId, fare, cardSurchargeAmount, total, cardRegion, brand, last4 }

  async function reviewCard(e, wallet = false) {
    e?.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message);
      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({ elements });
      if (pmError) throw new Error(pmError.message);
      const { data } = await client.post(tipOnly ? '/payment/tip/fee' : '/payment/card-fee', { bookingId, paymentMethodId: paymentMethod.id, tipAmount });
      if (wallet) {
        const shown = (tipOnly ? 0 : baseAmount) + Math.round(tipAmount * 100);
        if (Math.round(data.total * 100) !== shown) throw new Error('Wallet total changed. No payment was taken; please try again.');
        await completePayment({ ...data, paymentMethodId: paymentMethod.id });
      } else setCard({ ...data, paymentMethodId: paymentMethod.id });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not check this card');
    } finally {
      setLoading(false);
    }
  }

  async function completePayment(selectedCard) {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.post(tipOnly ? '/payment/tip/pay' : '/payment/pay', { bookingId, paymentMethodId: selectedCard.paymentMethodId, tipAmount: selectedCard.tip });
      if (data.status === 'requires_action') {
        // 3D Secure - Stripe shows its own challenge, then we re-check.
        const { error: actionError, paymentIntent } = await stripe.handleNextAction({ clientSecret: data.clientSecret });
        if (actionError) throw new Error(actionError.message);
        if (paymentIntent?.status !== 'succeeded') throw new Error('Payment did not complete - try again.');
      } else if (data.status !== 'succeeded') {
        throw new Error('Payment did not complete - try again.');
      }
      await client.post(tipOnly ? '/payment/tip/confirm' : '/payment/confirm', { bookingId });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Payment failed');
      setLoading(false);
    }
  }

  async function pay() { await completePayment(card); }

  return (
    <form onSubmit={reviewCard}>
      {!card && <fieldset style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 12, marginBottom: 16 }}>
        <legend style={{ fontWeight: 700 }}>Would you like to thank your driver with a tip?</legend>
        <p className="muted" style={{ marginTop: 0 }}>Optional — tips go to your driver.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(tipOnly ? [5, 10, 20] : [0, 5, 10, 20]).map((n) => <button key={n} type="button" className={`btn ${tipAmount === n && customTip === '' ? '' : 'secondary'}`} onClick={() => { setTipAmount(n); setCustomTip(''); }}>{n === 0 ? 'No tip' : `${n}`}</button>)}
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>Custom tip (NZD)
          <input type="number" min="0" max="200" step="0.01" inputMode="decimal" placeholder="Enter amount" value={customTip} onChange={(e) => { setCustomTip(e.target.value); setTipAmount(e.target.value === '' ? 0 : Number(e.target.value)); }} style={{ width: '100%', marginTop: 4 }} />
        </label>
      </fieldset>}
      <div style={{ display: card ? 'none' : 'block' }}>
        <div style={{ marginBottom: 16 }}>
          <ExpressCheckoutElement
            onConfirm={() => reviewCard(undefined, true)}
            options={{ buttonHeight: 48, paymentMethods: { applePay: 'auto', googlePay: 'auto', link: 'never' } }}
          />
          <p className="muted">Wallet payments include your selected tip. No additional card processing fee is charged for Apple Pay or Google Pay.</p>
        </div>
        <PaymentElement options={{ wallets: { applePay: 'never', googlePay: 'never' } }} />
      </div>

      {card && (
        <div>
          <p className="muted" style={{ marginTop: 0 }}>
            {card.brand?.toUpperCase()} •••• {card.last4} ({card.cardRegion === 'domestic' ? 'NZ card' : 'overseas card'})
          </p>
          <table style={{ width: '100%' }}>
            <tbody>
              <tr><td>Fare</td><td style={{ textAlign: 'right' }}>{money(card.fare)}</td></tr>
              <tr><td>Driver tip (optional)</td><td style={{ textAlign: 'right' }}>{money(card.tip)}</td></tr>
              <tr><td>Card processing fee (Stripe)</td><td style={{ textAlign: 'right' }}>{money(card.cardSurchargeAmount)}</td></tr>
              <tr><td><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{money(card.total)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
      <div className="btn-grid" style={{ marginTop: 14 }}>
        {card ? (
          <>
            <button type="button" className="btn" onClick={pay} disabled={loading}>{loading ? 'Processing...' : `Pay ${money(card.total)}`}</button>
            <button type="button" className="btn secondary" onClick={() => { setCard(null); setError(''); }} disabled={loading}>Use a different card</button>
          </>
        ) : (
          <button className="btn" disabled={!stripe || loading || !Number.isFinite(tipAmount) || tipAmount < 0 || tipAmount > 200 || (tipOnly && tipAmount === 0)}>{loading ? 'Checking...' : 'Continue'}</button>
        )}
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export default function StripePaymentModal({ bookingId, amount, currency, onClose, onSuccess, tipOnly = false }) {
  // The backend has a Stripe key (it said mock:false) but this build has
  // no publishable key - say so rather than silently doing nothing.
  if (!stripePromise) {
    return (
      <Modal title={tipOnly ? 'Thank your driver' : 'Pay for your trip'} onClose={onClose}>
        <p className="error-text">Online payment isn't available right now (payment setup incomplete). Please pay the driver in cash or try again later.</p>
        <button type="button" className="btn secondary" onClick={onClose}>Close</button>
      </Modal>
    );
  }
  // Express Checkout displays supported wallets above the card fallback.\n  // Deferred-intent mode: the payment method is collected before any PaymentIntent
  // exists, because the final amount depends on the card itself.
  const options = { mode: 'payment', amount, currency, paymentMethodCreation: 'manual', paymentMethodTypes: ['card'] };
  return (
    <Modal title={tipOnly ? 'Thank your driver' : 'Pay for your trip'} onClose={onClose}>
      <Elements stripe={stripePromise} options={options}>
        <PayForm bookingId={bookingId} onSuccess={onSuccess} onClose={onClose} tipOnly={tipOnly} baseAmount={amount} />
      </Elements>
    </Modal>
  );
}
