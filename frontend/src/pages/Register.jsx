import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useDriverSignupEnabled } from '../hooks/useDriverSignupEnabled';
import AddressAutocomplete from '../components/AddressAutocomplete';
import PhoneField from '../components/PhoneField';

export default function Register() {
  const driverSignupEnabled = useDriverSignupEnabled();
  const { register, setSession } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '', mobile: '', address: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // A passenger a driver (or the QR flow, or an admin) already set up
  // with this phone number - {firstName, hasEmail} - so they set a
  // password on that account instead of creating a duplicate one.
  const [existing, setExisting] = useState(null);
  const [claim, setClaim] = useState({ tripRef: '', email: '', password: '' });
  const [linkSent, setLinkSent] = useState('');

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Looked up as they type (debounced), once the number is long enough to
  // be a real one - see GET /api/auth/claim-lookup.
  useEffect(() => {
    setExisting(null);
    setLinkSent('');
    if (form.mobile.replace(/\D/g, '').length < 9) return undefined;
    const t = setTimeout(() => {
      client.get('/auth/claim-lookup', { params: { mobile: form.mobile } })
        .then((r) => setExisting(r.data.claimable ? r.data : null))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [form.mobile]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      navigate(location.state?.from || '/passenger');
    } catch (err) {
      if (err.response?.data?.claimable) {
        client.get('/auth/claim-lookup', { params: { mobile: form.mobile } })
          .then((r) => setExisting(r.data.claimable ? r.data : null)).catch(() => {});
      }
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  async function onClaim(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post('/auth/claim', { mobile: form.mobile, ...claim });
      setSession(data.token, data.user);
      navigate(location.state?.from || '/passenger');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not set up your account');
    } finally {
      setLoading(false);
    }
  }

  async function sendLink() {
    setError('');
    try {
      const { data } = await client.post('/auth/claim-link', { mobile: form.mobile });
      setLinkSent(data.message);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send the link');
    }
  }

  return (
    <div className="auth-shell card">
      <h2>Passenger sign-up</h2>
      {driverSignupEnabled && <p className="muted">Driver accounts <Link to="/driver-signup">apply here</Link> instead.</p>}
      <PhoneField value={form.mobile} onChange={(v) => update('mobile', v)}
        hint="Already had a trip booked for you by a driver? Enter that number and we'll find your details." />

      {existing ? (
        <form onSubmit={onClaim}>
          <div className="card" style={{ background: 'var(--surface-alt, #f0f9ff)', boxShadow: 'none' }}>
            <strong>Welcome back{existing.firstName ? `, ${existing.firstName}` : ''}!</strong>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Your driver already set up an account for this number, with your details and trip history. Just add a
              password to start booking yourself.
            </p>
          </div>
          <div>
            <label>Trip reference</label>
            <input value={claim.tripRef} onChange={(e) => setClaim((c) => ({ ...c, tripRef: e.target.value }))}
              placeholder="TRIP-20260922-00042" required autoCapitalize="characters" />
            <p className="muted" style={{ fontSize: '0.85rem', margin: '4px 0 0' }}>
              From any of your trips - it's on your receipt and your driver's WhatsApp messages. This confirms the number is yours.
            </p>
          </div>
          {!existing.hasEmail && (
            <div><label>Email (optional)</label><input type="email" value={claim.email} onChange={(e) => setClaim((c) => ({ ...c, email: e.target.value }))} /></div>
          )}
          <div><label>Choose a password</label><input type="password" value={claim.password} onChange={(e) => setClaim((c) => ({ ...c, password: e.target.value }))} required minLength={6} autoComplete="new-password" /></div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" disabled={loading}>{loading ? 'Setting up...' : 'Set password and continue'}</button>
          {existing.hasEmail && (
            linkSent
              ? <p className="muted" style={{ color: 'var(--success)' }}>{linkSent}</p>
              : <p className="muted">No trip reference handy? <button type="button" className="link-button" onClick={sendLink}
                  style={{ background: 'none', border: 0, padding: 0, color: 'var(--primary)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>Email me a link to set my password</button></p>
          )}
        </form>
      ) : (
        <form onSubmit={onSubmit}>
          <div><label>Full name</label><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></div>
          <div><label>Email</label><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></div>
          <div><label>Password</label><input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} required minLength={6} autoComplete="new-password" /></div>
          <AddressAutocomplete label="Address" onSelect={(r) => update('address', r ? r.label : '')} />
          {error && <p className="error-text">{error}</p>}
          <button className="btn" disabled={loading}>{loading ? 'Creating account...' : 'Sign up'}</button>
        </form>
      )}
      <p className="muted">Already have an account? <Link to="/login" state={location.state}>Log in</Link></p>
    </div>
  );
}
