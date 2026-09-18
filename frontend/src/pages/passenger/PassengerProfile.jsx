import { useEffect, useState } from 'react';
import client from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import PhoneField from '../../components/PhoneField';

export default function PassengerProfile() {
  const { setSession, token } = useAuthStore();
  const [form, setForm] = useState({ name: '', mobile: '', address: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/passenger/profile').then((r) => {
      setForm({ name: r.data.name || '', mobile: r.data.mobile || '', address: r.data.address || '' });
      setLoading(false);
    });
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const { data } = await client.put('/passenger/profile', form);
      // Keep the locally-cached user (navbar name, etc.) in sync.
      setSession(token, data);
      setMessage('Saved.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save your details');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="container"><p className="muted">Loading...</p></div>;

  return (
    <div className="container">
      <h1>My details</h1>
      <div className="card" style={{ maxWidth: 480 }}>
        <form onSubmit={onSubmit}>
          <div><label>Full name</label><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></div>
          <PhoneField value={form.mobile} onChange={(v) => update('mobile', v)} hint="Used for WhatsApp trip updates and driver contact." />
          <AddressAutocomplete label="Address" defaultValue={form.address} onSelect={(r) => update('address', r ? r.label : '')} />
          {error && <p className="error-text">{error}</p>}
          {message && <p className="muted">{message}</p>}
          <button className="btn" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
        </form>
      </div>
    </div>
  );
}
