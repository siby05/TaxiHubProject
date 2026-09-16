import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [tab, setTab] = useState('drivers');
  const [form, setForm] = useState({ name: '', email: '', mobile: '', licenseNumber: '', vehicleType: 'Economy', vehicleNumber: '', ratePerKm: 1.8 });
  const [createdInfo, setCreatedInfo] = useState(null);
  const [error, setError] = useState('');
  const [qrFor, setQrFor] = useState(null);

  function load() {
    client.get('/admin/stats').then((r) => setStats(r.data));
    client.get('/admin/drivers').then((r) => setDrivers(r.data));
  }

  useEffect(() => { load(); }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function addDriver(e) {
    e.preventDefault();
    setError('');
    setCreatedInfo(null);
    try {
      const { data } = await client.post('/admin/drivers', form);
      setCreatedInfo(data);
      setForm({ name: '', email: '', mobile: '', licenseNumber: '', vehicleType: 'Economy', vehicleNumber: '', ratePerKm: 1.8 });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add driver');
    }
  }

  async function approve(id) { await client.put(`/admin/drivers/${id}/approve`); load(); }
  async function reject(id) { await client.put(`/admin/drivers/${id}/reject`); load(); }
  async function deactivate(id) { await client.put(`/admin/drivers/${id}/deactivate`); load(); }

  async function viewQr(id) {
    if (qrFor?.id === id) { setQrFor(null); return; }
    const { data } = await client.get(`/admin/drivers/${id}/qr-code`);
    setQrFor({ id, ...data });
  }

  return (
    <div className="container">
      <h1>Admin dashboard</h1>

      {stats && (
        <div className="grid cols-4">
          <div className="card stat"><div className="value">{stats.totalPassengers}</div><div className="label">Passengers</div></div>
          <div className="card stat"><div className="value">{stats.totalDrivers}</div><div className="label">Drivers</div></div>
          <div className="card stat"><div className="value">{stats.completedTrips}</div><div className="label">Completed trips</div></div>
          <div className="card stat"><div className="value">${stats.totalRevenue.toFixed(2)}</div><div className="label">Revenue</div></div>
          <div className="card stat"><div className="value">{stats.pendingDriverApprovals}</div><div className="label">Pending approvals</div></div>
          <div className="card stat"><div className="value">{stats.openComplaints}</div><div className="label">Open complaints</div></div>
          <div className="card stat"><div className="value">{stats.seriousComplaints}</div><div className="label">Serious complaints</div></div>
          <div className="card stat"><Link to="/admin/complaints" className="btn">Manage complaints</Link></div>
        </div>
      )}

      <div className="tabs">
        <button className={tab === 'drivers' ? 'active' : ''} onClick={() => setTab('drivers')}>Drivers</button>
        <button className={tab === 'add' ? 'active' : ''} onClick={() => setTab('add')}>Add driver</button>
      </div>

      {tab === 'drivers' && (
        <div className="card">
          <table>
            <thead><tr><th>Driver</th><th>Vehicle</th><th>Rate/km</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {drivers.map((d) => (
                <Fragment key={d._id}>
                  <tr>
                    <td>{d.userId?.name}<div className="muted">{d.userId?.email}</div></td>
                    <td>{d.vehicleType} · {d.vehicleNumber}</td>
                    <td>${d.ratePerKm}</td>
                    <td><span className={`badge ${d.status}`}>{d.status}</span></td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {d.status === 'pending' && <>
                        <button className="btn" onClick={() => approve(d._id)}>Approve</button>
                        <button className="btn danger" onClick={() => reject(d._id)}>Reject</button>
                      </>}
                      {d.status === 'approved' && <button className="btn secondary" onClick={() => deactivate(d._id)}>Deactivate</button>}
                      <button className="btn secondary" onClick={() => viewQr(d._id)}>{qrFor?.id === d._id ? 'Hide QR' : 'View QR'}</button>
                    </td>
                  </tr>
                  {qrFor?.id === d._id && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 16 }}>
                        <img src={qrFor.qrCodeImage} alt="Driver QR code" style={{ width: 180, height: 180 }} />
                        <div className="muted" style={{ wordBreak: 'break-all' }}>{qrFor.qrCodeUrl}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'add' && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Add a new driver (admin-managed signup)</h3>
          <form onSubmit={addDriver}>
            <div><label>Full name</label><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></div>
            <div><label>Email</label><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></div>
            <div><label>Mobile</label><input value={form.mobile} onChange={(e) => update('mobile', e.target.value)} /></div>
            <div><label>License number</label><input value={form.licenseNumber} onChange={(e) => update('licenseNumber', e.target.value)} required /></div>
            <div>
              <label>Vehicle type</label>
              <select value={form.vehicleType} onChange={(e) => update('vehicleType', e.target.value)}>
                <option>Economy</option><option>Comfort</option><option>Premium</option>
              </select>
            </div>
            <div><label>Vehicle number</label><input value={form.vehicleNumber} onChange={(e) => update('vehicleNumber', e.target.value)} required /></div>
            <div><label>Rate per km ($)</label><input type="number" step="0.1" value={form.ratePerKm} onChange={(e) => update('ratePerKm', e.target.value)} /></div>
            {error && <p className="error-text">{error}</p>}
            <button className="btn">Add driver</button>
          </form>
          {createdInfo && (
            <div className="card" style={{ marginTop: 12, background: '#fef3c7' }}>
              <strong>Driver created.</strong> Temporary password: <code>{createdInfo.temporaryPassword}</code>
              <p className="muted">{createdInfo.note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
