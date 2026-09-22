import { useEffect, useState } from 'react';
import client from '../../api/client';
import { formatNzDate } from '../../utils/nzTime';

export default function DriverComplaints() {
  const [complaints, setComplaints] = useState([]);
  const [drafts, setDrafts] = useState({});

  function load() {
    client.get('/complaints/driver/complaints-against-me').then((r) => setComplaints(r.data));
  }

  useEffect(() => { load(); }, []);

  async function respond(id) {
    const comment = drafts[id];
    if (!comment?.trim()) return;
    await client.post(`/complaints/${id}/driver-comment`, { comment });
    setDrafts((d) => ({ ...d, [id]: '' }));
    load();
  }

  return (
    <div className="container">
      <h1>Complaints against me</h1>
      {complaints.length === 0 && <p className="muted">No complaints on file.</p>}
      <div className="grid cols-2">
        {complaints.map((c) => (
          <div className="card" key={c._id}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{c.complaintId}{c.bookingRef ? <span className="muted" style={{ fontWeight: 400 }}> · trip {c.bookingRef}</span> : null}</strong>
              <span className={`badge ${c.status}`}>{c.status}</span>
            </div>
            <p className="muted">{c.complaintType.replace(/-/g, ' ')} · {formatNzDate(c.incidentDate)}</p>
            <p>{c.description}</p>

            {c.driverComments?.map((dc, i) => (
              <p key={i} className="muted"><strong>{dc.commentedByName}:</strong> {dc.comment}</p>
            ))}

            {!['resolved', 'closed'].includes(c.status) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input placeholder="Respond to this complaint..." value={drafts[c._id] || ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [c._id]: e.target.value }))} />
                <button className="btn" onClick={() => respond(c._id)}>Send</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
