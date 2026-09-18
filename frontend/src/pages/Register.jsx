import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import AddressAutocomplete from '../components/AddressAutocomplete';
import PhoneField from '../components/PhoneField';

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
      <p className="muted">Driver accounts <Link to="/driver-signup">apply here</Link> instead.</p>
      <form onSubmit={onSubmit}>
        <div><label>Full name</label><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></div>
        <div><label>Email</label><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></div>
        <div><label>Password</label><input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} required minLength={6} /></div>
        <PhoneField value={form.mobile} onChange={(v) => update('mobile', v)} />
        <AddressAutocomplete label="Address" onSelect={(r) => update('address', r ? r.label : '')} />
        {error && <p className="error-text">{error}</p>}
        <button className="btn" disabled={loading}>{loading ? 'Creating account...' : 'Sign up'}</button>
      </form>
      <p className="muted">Already have an account? <Link to="/login" state={location.state}>Log in</Link></p>
    </div>
  );
}
