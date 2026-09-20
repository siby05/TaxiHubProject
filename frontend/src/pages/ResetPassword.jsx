import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../api/client';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await client.post('/auth/reset-password', { token, newPassword });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset your password');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="auth-shell card">
        <h2>Password reset</h2>
        <p className="muted" style={{ color: 'var(--success)' }}>Your password has been changed. Taking you to login...</p>
      </div>
    );
  }

  return (
    <div className="auth-shell card">
      <h2>Choose a new password</h2>
      <form onSubmit={onSubmit}>
        <div><label>New password</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} /></div>
        <div><label>Confirm password</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} /></div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn" disabled={loading}>{loading ? 'Saving...' : 'Reset password'}</button>
      </form>
      <p className="muted" style={{ marginTop: 16 }}><Link to="/login">Back to login</Link></p>
    </div>
  );
}
