import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../../api/client';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import PhoneField from '../../components/PhoneField';

const EMPTY_FORM = { name: '', mobile: '', email: '', address: '' };

export default function DriverAddPassenger() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState(null);

  async function addPassenger(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const { data } = await client.post('/driver/passengers', form);
      setAdded(data);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add passenger');
    } finally {
      setSaving(false);
    }
  }

  if (added) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 480, background: '#dcfce7' }}>
          <h3>Passenger added</h3>
          <p>{added.name} ({added.mobile}) can now be booked from Book for passenger.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="btn" onClick={() => navigate('/driver/book', { state: { passenger: added } })}>Book a trip for them</button>
            <button className="btn secondary" onClick={() => setAdded(null)}>Add another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Add a passenger</h1>
      <div className="card" style={{ maxWidth: 480 }}>
        <p className="muted">For someone who books by phone and won't use the app themselves. Email is optional - without one, their receipt is sent over WhatsApp when each trip completes.</p>
        <form onSubmit={addPassenger}>
          <div><label>Full name</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
          <PhoneField value={form.mobile} onChange={(v) => setForm((f) => ({ ...f, mobile: v }))} required hint="Used to reach them on WhatsApp - receipts go here if there's no email." />
          <div><label>Email (optional)</label><input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
          <AddressAutocomplete label="Home address (optional)" onSelect={(r) => setForm((f) => ({ ...f, address: r ? r.label : '' }))} />
          {error && <p className="error-text">{error}</p>}
          <button className="btn" disabled={saving}>{saving ? 'Adding...' : 'Add passenger'}</button>
        </form>
      </div>
    </div>
  );
}
