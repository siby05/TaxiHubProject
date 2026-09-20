import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function Login() {
  const { login } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      const home = user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver' : '/passenger';
      navigate(location.state?.from || home);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell card">
      <h2>Log in to EasyRide</h2>
      <form onSubmit={onSubmit}>
        <div>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn" disabled={loading}>{loading ? 'Logging in...' : 'Log in'}</button>
      </form>
      <p className="muted"><Link to="/forgot-password">Forgot password?</Link></p>
      <p className="muted">No account? <Link to="/register" state={location.state}>Sign up as a passenger</Link> or <Link to="/driver-signup">apply to drive</Link></p>

      {/* TEMPORARY test-account panel - remove once real accounts replace these. */}
      <div className="card" style={{ background: '#fef3c7', marginTop: 20 }}>
        <strong>Test accounts</strong> <span className="muted">(temporary - password for all: <code>password123</code>)</span>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Role</th><th>Email</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td>Admin</td><td>admin@easyride.local</td><td></td></tr>
            <tr><td>Driver</td><td>driver@easyride.local</td><td>Comfort</td></tr>
            <tr><td>Driver</td><td>driver-economy@easyride.local</td><td>Economy</td></tr>
            <tr><td>Driver</td><td>driver-electric@easyride.local</td><td>Electric</td></tr>
            <tr><td>Driver</td><td>driver-premium@easyride.local</td><td>Premium</td></tr>
            <tr><td>Passenger</td><td>passenger@easyride.local</td><td></td></tr>
            <tr><td>Passenger</td><td>passenger2@easyride.local</td><td></td></tr>
            <tr><td>Passenger</td><td>passenger3@easyride.local</td><td></td></tr>
            <tr><td>Passenger</td><td>passenger4@easyride.local</td><td></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
