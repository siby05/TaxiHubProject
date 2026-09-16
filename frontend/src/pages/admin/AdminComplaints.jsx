import { useEffect, useState } from 'react';
import client from '../../api/client';
import { useSocket } from '../../hooks/useSocket';

const STATUSES = ['open', 'investigating', 'resolved', 'closed', 'escalated'];

export default function AdminComplaints() {
  const [complaints, setComplaints] = useState([]);
  const [filter, setFilter] = useState('');
  const [notes, setNotes] = useState({});
  const [alert, setAlert] = useState('');

  function load() {
    client.get('/complaints/admin/all-complaints', { params: filter ? { status: filter } : {} })
      .then((r) => setComplaints(r.data.complaints));
  }

  useEffect(() => { load(); }, [filter]);

  useSocket({
    'complaint:new': (complaint) => {
      setAlert(`New complaint lodged: ${complaint.complaintId}${complaint.isSerious ? ' (SERIOUS)' : ''}`);
      load();
    },
  });

  async function setStatus(id, status) {
    const resolutionSummary = status === 'resolved' || status === 'closed' ? window.prompt('Resolution summary?') || '' : undefined;
    await client.put(`/complaints/admin/${id}/status`, { status, resolutionSummary });
    load();
  }

  async function escalate(id) {
    if (!window.confirm('Escalate to NZ Transport Agency / Police?')) return;
    await client.put(`/complaints/admin/${id}/escalate`, { requiresPoliceReport: true, requiresTransportAgencyReport: true });
    load();
  }

  async function addNote(id) {
    const note = notes[id];
    if (!note?.trim()) return;
    await client.post(`/complaints/admin/${id}/add-note`, { note });
    setNotes((n) => ({ ...n, [id]: '' }));
    load();
  }

  return (
    <div className="container">
      <h1>Complaint management</h1>
      {alert && <div className="card" style={{ background: '#fef3c7' }}>{alert} <button className="btn secondary" onClick={() => setAlert('')}>Dismiss</button></div>}
      <div className="tabs">
        <button className={filter === '' ? 'active' : ''} onClick={() => setFilter('')}>All</button>
        {STATUSES.map((s) => (
          <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>{s}</button>
        ))}
      </div>

      {complaints.length === 0 && <p className="muted">No complaints match this filter.</p>}

      <div className="grid cols-2">
        {complaints.map((c) => (
          <div className="card" key={c._id}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{c.complaintId}</strong>
              <div>
                {c.isSerious && <span className="badge critical" style={{ marginRight: 6 }}>serious</span>}
                <span className={`badge ${c.status}`}>{c.status}</span>
              </div>
            </div>
            <p className="muted">{c.complaintType.replace(/-/g, ' ')} · vs {c.driverName} ({c.vehicleNumber})</p>
            <p>{c.description}</p>
            <p className="muted">By {c.complainantId?.name} on {new Date(c.incidentDate).toLocaleDateString()} at {c.incidentLocation}</p>

            {c.driverComments?.map((dc, i) => <p key={i} className="muted"><strong>Driver:</strong> {dc.comment}</p>)}
            {c.adminNotes?.map((n, i) => <p key={i} className="muted"><strong>Internal note ({n.noteByName}):</strong> {n.note}</p>)}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <select defaultValue="" onChange={(e) => { if (e.target.value) setStatus(c._id, e.target.value); }}>
                <option value="">Change status...</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {!c.isSerious && <button className="btn danger" onClick={() => escalate(c._id)}>Escalate</button>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input placeholder="Internal note..." value={notes[c._id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [c._id]: e.target.value }))} />
              <button className="btn secondary" onClick={() => addNote(c._id)}>Add note</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
