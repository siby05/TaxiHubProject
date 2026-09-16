import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import client from '../../api/client';

const COMPLAINT_TYPES = [
  'driver-behaviour', 'vehicle-condition', 'safety-concern', 'route-issue', 'payment-issue',
  'vehicle-cleanliness', 'reckless-driving', 'assault-violence', 'sexual-offence', 'dui-drugs', 'other',
];

export default function LodgeComplaint() {
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    bookingId: location.state?.bookingId || '',
    complaintType: 'driver-behaviour',
    description: '',
    incidentDate: '',
    incidentTime: '',
    incidentLocation: '',
  });
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
      await client.post('/complaints', form);
      navigate('/passenger/complaints');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit complaint');
    } finally {
      setLoading(false);
    }
  }

  const isSerious = ['assault-violence', 'sexual-offence', 'dui-drugs'].includes(form.complaintType);

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 560 }}>
        <h2>Lodge a complaint</h2>
        <p className="muted">Records are retained for 2 years per NZ Transport Agency requirements. Serious incidents are escalated to authorities.</p>
        <form onSubmit={onSubmit}>
          <div>
            <label>Booking ID</label>
            <input value={form.bookingId} onChange={(e) => update('bookingId', e.target.value)} required placeholder="From My Bookings" />
          </div>
          <div>
            <label>Complaint type</label>
            <select value={form.complaintType} onChange={(e) => update('complaintType', e.target.value)}>
              {COMPLAINT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/-/g, ' ')}</option>)}
            </select>
          </div>
          {isSerious && <p className="error-text">This category is treated as a serious incident and will be reported to the NZ Transport Agency / Police.</p>}
          <div><label>Description</label><textarea value={form.description} onChange={(e) => update('description', e.target.value)} required minLength={10} maxLength={2000} /></div>
          <div className="grid cols-2">
            <div><label>Incident date</label><input type="date" value={form.incidentDate} onChange={(e) => update('incidentDate', e.target.value)} required /></div>
            <div><label>Incident time</label><input type="time" value={form.incidentTime} onChange={(e) => update('incidentTime', e.target.value)} required /></div>
          </div>
          <div><label>Incident location</label><input value={form.incidentLocation} onChange={(e) => update('incidentLocation', e.target.value)} required /></div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" disabled={loading}>{loading ? 'Submitting...' : 'Submit complaint'}</button>
        </form>
      </div>
    </div>
  );
}
