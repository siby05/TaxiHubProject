import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useDriverSignupEnabled } from '../hooks/useDriverSignupEnabled';

export default function Login() {
  const driverSignupEnabled = useDriverSignupEnabled();
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
      <p className="muted">No account? <Link to="/register" state={location.state}>Sign up as a passenger</Link>{driverSignupEnabled && <> or <Link to="/driver-signup">apply to drive</Link></>}</p>
    </div>
  );
}
