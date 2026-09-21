import { useEffect, useState } from 'react';
import client from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import PhoneField from '../../components/PhoneField';

export default function PassengerProfile() {
  const { setSession, token } = useAuthStore();
  const [form, setForm] = useState({ name: '', email: '', mobile: '', address: '', currentPassword: '', newPassword: '' });
  const [originalEmail, setOriginalEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/passenger/profile').then((r) => {
      setForm({
        name: r.data.name || '', email: r.data.email || '', mobile: r.data.mobile || '', address: r.data.address || '',
        currentPassword: '', newPassword: '',
      });
      setOriginalEmail(r.data.email || '');
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
      // Name/mobile/address are passenger-managed (PUT /passenger/profile);
      // email and password are login credentials, so they go through the
      // same self-service account endpoint every role uses (PUT /api/auth/me),
      // which requires the current password to confirm identity.
      const { data } = await client.put('/passenger/profile', { name: form.name, mobile: form.mobile, address: form.address });
      // Keep the locally-cached user (navbar name, etc.) in sync.
      setSession(token, data);

      const emailChanged = form.email && form.email !== originalEmail;
      if (emailChanged || form.newPassword) {
        const { data: accountData } = await client.put('/auth/me', {
          email: emailChanged ? form.email : undefined,
          newPassword: form.newPassword || undefined,
          currentPassword: form.currentPassword,
        });
        setSession(token, accountData);
        if (emailChanged) setOriginalEmail(form.email);
      }

      setMessage('Saved.');
      setForm((f) => ({ ...f, currentPassword: '', newPassword: '' }));
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
          <div><label>Email</label><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></div>
          <PhoneField value={form.mobile} onChange={(v) => update('mobile', v)} hint="Used for WhatsApp trip updates and driver contact." />
          <AddressAutocomplete label="Address" defaultValue={form.address} onSelect={(r) => update('address', r ? r.label : '')} />
          <div><label>New password (optional)</label><input type="password" value={form.newPassword} onChange={(e) => update('newPassword', e.target.value)} placeholder="Leave blank to keep current password" /></div>
          <div><label>Current password</label><input type="password" value={form.currentPassword} onChange={(e) => update('currentPassword', e.target.value)} placeholder="Only required if changing email or password" /></div>
          {error && <p className="error-text">{error}</p>}
          {message && <p className="muted">{message}</p>}
          <button className="btn" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
        </form>
      </div>
    </div>
  );
}
