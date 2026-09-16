import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';

export default function MyComplaints() {
  const [complaints, setComplaints] = useState([]);

  useEffect(() => {
    client.get('/complaints/passenger/my-complaints').then((r) => setComplaints(r.data));
  }, []);

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>My complaints</h1>
        <Link className="btn" to="/passenger/complaints/new">+ New complaint</Link>
      </div>
      {complaints.length === 0 && <p className="muted">No complaints lodged.</p>}
      <div className="grid cols-2">
        {complaints.map((c) => (
          <div className="card" key={c._id}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{c.complaintId}</strong>
              <span className={`badge ${c.status}`}>{c.status}</span>
            </div>
            <p className="muted">{c.complaintType.replace(/-/g, ' ')} · {new Date(c.incidentDate).toLocaleDateString()}</p>
            <p>{c.description}</p>
            {c.isSerious && <p className="error-text">Escalated as serious incident</p>}
            {c.resolutionSummary && <p><strong>Resolution:</strong> {c.resolutionSummary}</p>}
            {c.driverComments?.length > 0 && (
              <div>
                <strong>Driver response:</strong>
                {c.driverComments.map((dc, i) => <p key={i} className="muted">{dc.comment}</p>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
