import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function Login() {
  const { login } = useAuthStore();
  const navigate = useNavigate();
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
      navigate(home);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell card">
      <h2>Log in to TaxiHub</h2>
      <p className="muted">
        Demo accounts (password <code>password123</code>): admin@taxihub.local · driver@taxihub.local · passenger@taxihub.local
      </p>
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
      <p className="muted">No account? <Link to="/register">Sign up as a passenger</Link></p>
    </div>
  );
}
