import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import client from '../api/client';
import { useServerStatus } from '../components/ProtectedRoute';
import { useDriverSignupEnabled } from '../hooks/useDriverSignupEnabled';
import GoogleSignInButton from '../components/GoogleSignInButton';

const homeFor = (user) => (user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver' : '/passenger');

export default function Login() {
  const driverSignupEnabled = useDriverSignupEnabled();
  const { user, login, logout, setSession } = useAuthStore();
  const serverStatus = useServerStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Sent here because the server was asleep (see ProtectedRoute.jsx) with
  // a login still saved: once the server answers, check that login is
  // still good and carry on to the page they were opening.
  const resumable = !!user && !!location.state?.serverAsleep;
  useEffect(() => {
    if (!resumable || serverStatus !== 'awake') return undefined;
    let cancelled = false;
    client.get('/auth/me')
      .then(() => { if (!cancelled) navigate(location.state?.from || homeFor(user), { replace: true }); })
      .catch((err) => { if (!cancelled && err.response?.status === 401) logout(); });
    return () => { cancelled = true; };
  }, [resumable, serverStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep nudging the server while waiting on it, in case it takes longer
  // than api/client.js's own retries cover.
  useEffect(() => {
    if (serverStatus === 'awake' || !location.state?.serverAsleep) return undefined;
    const t = setInterval(() => client.get('/health', { wakeRetry: false }).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [serverStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(location.state?.from || homeFor(user));
    } catch (err) {
      setError(err.response?.data?.error || (err.response ? 'Login failed' : 'The server is still starting - please try again in a moment.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell card">
      <h2>Log in to EasyRide</h2>
      {serverStatus !== 'awake' && (resumable || location.state?.serverAsleep) && (
        <p role="status" style={{ background: '#fef3c7', color: '#92400e', padding: '10px 12px', borderRadius: 8, fontSize: '0.9rem' }}>
          {resumable
            ? 'The server is starting up after a quiet spell (up to a minute). You\'ll go to your dashboard automatically once it\'s ready - no need to log in again.'
            : 'The server is starting up after a quiet spell (up to a minute). You can log in now - it will go through as soon as the server is ready.'}
        </p>
      )}
      <GoogleSignInButton
        text="signin_with"
        onSignedIn={(token, user) => { setSession(token, user); navigate(location.state?.from || homeFor(user)); }}
      />
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
