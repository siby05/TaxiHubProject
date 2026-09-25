import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';
import { formatNzDate } from '../../utils/nzTime';

export default function MyComplaints() {
  const [complaints, setComplaints] = useState([]);
  const [reopenFor, setReopenFor] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  function load() {
    client.get('/complaints/passenger/my-complaints').then((r) => setComplaints(r.data));
  }

  useEffect(() => { load(); }, []);

  async function submitReopen(complaintId) {
    setError('');
    if (!reason.trim()) { setError('Tell us why you\'re reopening this.'); return; }
    try {
      await client.put(`/complaints/passenger/${complaintId}/reopen`, { reason });
      setReopenFor(null);
      setReason('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reopen complaint');
    }
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>My complaints</h1>
        <Link className="btn" to="/passenger/complaints/new">+ New complaint</Link>
      </div>
      {complaints.length === 0 && <p className="muted">No complaints lodged.</p>}
      <div className="grid cols-2">
        {complaints.map((c) => (
          <div className="card" key={c._id}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <strong>{c.complaintId}{c.bookingRef ? <span className="muted" style={{ fontWeight: 400 }}> · trip {c.bookingRef}</span> : null}</strong>
              <span className={`badge ${c.status}`}>{c.status}</span>
            </div>
            <p className="muted">{c.complaintType.replace(/-/g, ' ')} · {formatNzDate(c.incidentDate)}</p>
            <p>{c.description}</p>
            {c.isSerious && <p className="error-text">Escalated as serious incident</p>}
            {c.resolutionSummary && <p><strong>Resolution:</strong> {c.resolutionSummary}</p>}
            {c.driverComments?.length > 0 && (
              <div>
                <strong>Driver response:</strong>
                {c.driverComments.map((dc, i) => <p key={i} className="muted">{dc.comment}</p>)}
              </div>
            )}

            {['resolved', 'closed'].includes(c.status) && (
              <div style={{ marginTop: 10 }}>
                {reopenFor === c._id ? (
                  <div>
                    <textarea placeholder="Why are you reopening this?" value={reason} onChange={(e) => setReason(e.target.value)} />
                    {error && <p className="error-text">{error}</p>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      <button className="btn" onClick={() => submitReopen(c._id)}>Submit</button>
                      <button className="btn secondary" onClick={() => { setReopenFor(null); setError(''); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn secondary" onClick={() => setReopenFor(c._id)}>Not satisfied? Reopen</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
