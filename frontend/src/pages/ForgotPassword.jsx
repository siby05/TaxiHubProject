import { useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { waShareLink } from '../utils/whatsapp';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post('/auth/forgot-password', { email });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not process that request');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell card">
      <h2>Reset your password</h2>
      {!result ? (
        <form onSubmit={onSubmit}>
          <p className="muted">Enter your account email and we'll send you a link to reset your password.</p>
          <div><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" disabled={loading}>{loading ? 'Sending...' : 'Send reset link'}</button>
        </form>
      ) : (
        <div>
          <p className="muted">{result.message}</p>
          {result.resetLink && (
            <>
              <p className="muted">Since you're on the account's own device, here's a shortcut to send yourself the link on WhatsApp instead of waiting for the email:</p>
              <a className="btn whatsapp" target="_blank" rel="noreferrer" href={waShareLink(`Reset my EasyRide password: ${result.resetLink}`)}>
                Send link via WhatsApp
              </a>
            </>
          )}
        </div>
      )}
      <p className="muted" style={{ marginTop: 16 }}><Link to="/login">Back to login</Link></p>
    </div>
  );
}
