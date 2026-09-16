import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function Register() {
  const { register } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '', mobile: '', address: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      navigate(location.state?.from || '/passenger');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell card">
      <h2>Create a passenger account</h2>
      <p className="muted">Driver and admin accounts are created by an administrator.</p>
      <form onSubmit={onSubmit}>
        <div><label>Full name</label><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></div>
        <div><label>Email</label><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></div>
        <div><label>Password</label><input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} required minLength={6} /></div>
        <div><label>Mobile</label><input value={form.mobile} onChange={(e) => update('mobile', e.target.value)} /></div>
        <div><label>Address</label><input value={form.address} onChange={(e) => update('address', e.target.value)} /></div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn" disabled={loading}>{loading ? 'Creating account...' : 'Sign up'}</button>
      </form>
      <p className="muted">Already have an account? <Link to="/login" state={location.state}>Log in</Link></p>
    </div>
  );
}
