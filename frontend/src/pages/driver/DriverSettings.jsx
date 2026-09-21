import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import PhoneField from '../../components/PhoneField';

export default function DriverSettings() {
  const { token, setSession } = useAuthStore();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', mobile: '', vehicleNumber: '', vehicleBrand: '', vehicleModel: '', currentPassword: '', newPassword: '' });
  const [originalEmail, setOriginalEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newRate, setNewRate] = useState('');
  const [rateMsg, setRateMsg] = useState('');
  const [stripeStatus, setStripeStatus] = useState(null);
  const [onboarding, setOnboarding] = useState(false);
  const [stripeError, setStripeError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  function loadStripeStatus() {
    client.get('/driver/stripe/status').then((r) => setStripeStatus(r.data)).catch(() => {});
  }

  useEffect(() => {
    loadStripeStatus();
    if (searchParams.get('stripe')) setSearchParams({}, { replace: true });
  }, []);

  async function startOnboarding() {
    setStripeError('');
    setOnboarding(true);
    try {
      const { data } = await client.post('/driver/stripe/onboard');
      window.location.href = data.url;
    } catch (err) {
      setStripeError(err.response?.data?.error || 'Could not start Stripe onboarding');
      setOnboarding(false);
    }
  }

  function load() {
    client.get('/driver/profile').then((r) => {
      setProfile(r.data);
      setForm({
        name: r.data.userId?.name || '', email: r.data.userId?.email || '', mobile: r.data.userId?.mobile || '',
        vehicleNumber: r.data.vehicleNumber || '', vehicleBrand: r.data.vehicleBrand || '', vehicleModel: r.data.vehicleModel || '',
        currentPassword: '', newPassword: '',
      });
      setOriginalEmail(r.data.userId?.email || '');
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      // Name/mobile/vehicle number are driver-managed (PUT /driver/profile);
      // email and password are login credentials, so they go through the
      // same self-service account endpoint every role uses (PUT /api/auth/me),
      // which requires the current password to confirm identity.
      await client.put('/driver/profile', form);
      const emailChanged = form.email && form.email !== originalEmail;
      if (emailChanged || form.newPassword) {
        const { data } = await client.put('/auth/me', {
          email: emailChanged ? form.email : undefined,
          newPassword: form.newPassword || undefined,
          currentPassword: form.currentPassword,
        });
        setSession(token, data);
        if (emailChanged) setOriginalEmail(form.email);
      }
      setMessage('Saved.');
      setForm((f) => ({ ...f, currentPassword: '', newPassword: '' }));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save your details');
    } finally {
      setSaving(false);
    }
  }

  async function togglePaymentPreference() {
    const { data } = await client.put('/driver/payment-preference', { acceptsOnlinePayment: !profile.acceptsOnlinePayment });
    setProfile(data);
  }

  async function requestRate(e) {
    e.preventDefault();
    setRateMsg('');
    try {
      const { data } = await client.put('/driver/rate', { ratePerKm: Number(newRate) });
      setProfile(data.driver);
      setRateMsg(data.message);
      setNewRate('');
    } catch (err) {
      setRateMsg(err.response?.data?.error || 'Could not submit rate change');
    }
  }

  if (loading) return <div className="container"><p className="muted">Loading...</p></div>;

  return (
    <div className="container">
      <h1>Settings</h1>

      <div className="card" style={{ maxWidth: 400 }}>
        <h3 style={{ marginTop: 0 }}>My details</h3>
        <form onSubmit={onSubmit}>
          <div><label>Name</label><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></div>
          <div><label>Email</label><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></div>
          <PhoneField value={form.mobile} onChange={(v) => update('mobile', v)} hint="Trip requests are sent here on WhatsApp." />
          <div><label>Vehicle number</label><input value={form.vehicleNumber} onChange={(e) => update('vehicleNumber', e.target.value)} required /></div>
          <div><label>Vehicle brand</label><input value={form.vehicleBrand} onChange={(e) => update('vehicleBrand', e.target.value)} placeholder="e.g. Toyota" /></div>
          <div><label>Vehicle model</label><input value={form.vehicleModel} onChange={(e) => update('vehicleModel', e.target.value)} placeholder="e.g. Corolla" /></div>
          <p className="muted" style={{ marginTop: 4, marginBottom: 8 }}>Shown to passengers in booking emails and WhatsApp messages so your car is easy to spot at pickup.</p>
          <div><label>New password (optional)</label><input type="password" value={form.newPassword} onChange={(e) => update('newPassword', e.target.value)} placeholder="Leave blank to keep current password" /></div>
          <div><label>Current password</label><input type="password" value={form.currentPassword} onChange={(e) => update('currentPassword', e.target.value)} placeholder="Only required if changing email or password" /></div>
          <p className="muted" style={{ marginTop: 4 }}>License and compliance documents can only be changed by an admin.</p>
          {error && <p className="error-text">{error}</p>}
          {message && <p className="muted">{message}</p>}
          <button className="btn" disabled={saving} style={{ marginTop: 8 }}>{saving ? 'Saving...' : 'Save changes'}</button>
        </form>
      </div>

      {stripeStatus?.configured && (
        <div className="card" style={{ maxWidth: 400 }}>
          <h3 style={{ marginTop: 0 }}>Get paid directly (Stripe)</h3>
          {stripeStatus.chargesEnabled ? (
            <p className="muted" style={{ color: 'var(--success)' }}>
              ✅ Connected - online payments for your trips go straight to your bank account, with the platform fee
              deducted automatically.
            </p>
          ) : (
            <>
              <p className="muted">
                {stripeStatus.connected
                  ? "You've started Stripe onboarding but it's not finished yet - Stripe still needs a few details before you can receive payouts."
                  : 'Set up your own Stripe account so online trip payments pay out straight to you (minus the platform fee), instead of the platform holding the funds.'}
              </p>
              {stripeError && <p className="error-text">{stripeError}</p>}
              <button className="btn" onClick={startOnboarding} disabled={onboarding}>
                {onboarding ? 'Redirecting...' : stripeStatus.connected ? 'Continue Stripe setup' : 'Set up Stripe payouts'}
              </button>
            </>
          )}
        </div>
      )}

      <div className="card" style={{ maxWidth: 400 }}>
        <h3 style={{ marginTop: 0 }}>Payments</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={profile.acceptsOnlinePayment !== false} onChange={togglePaymentPreference} />
          Accept online (card) payments
        </label>
        <p className="muted" style={{ marginTop: 2 }}>
          {profile.acceptsOnlinePayment !== false
            ? 'Passengers can pay you by card or cash. Card fares include a small disclosed surcharge to cover payment processing.'
            : 'Cash only - you won\'t be offered card-paying passengers via auto-match, and a card payer scanning your QR code will be told to pay cash or matched with another driver.'}
        </p>
      </div>

      <div className="card" style={{ maxWidth: 400 }}>
        <h3 style={{ marginTop: 0 }}>Rate</h3>
        <p className="muted">Currently ${profile.ratePerKm}/km.{profile.pendingRatePerKm != null && ` Change to $${profile.pendingRatePerKm}/km pending admin approval.`}</p>
        <form onSubmit={requestRate} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 160 }}>
            <label>Request new rate ($/km)</label>
            <input type="number" step="0.1" min="0.1" value={newRate} onChange={(e) => setNewRate(e.target.value)} required />
          </div>
          <button className="btn secondary">Submit for approval</button>
        </form>
        {rateMsg && <p className="muted" style={{ marginTop: 6 }}>{rateMsg}</p>}
      </div>
    </div>
  );
}
