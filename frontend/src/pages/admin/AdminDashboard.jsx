import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client, { fileOrigin } from '../../api/client';
import PhoneField from '../../components/PhoneField';
import { useAuthStore } from '../../store/authStore';
import { waLink } from '../../utils/whatsapp';
import { formatNzDate, formatNzDateTime } from '../../utils/nzTime';

const DOC_STATUS_CLASS = { verified: 'approved', rejected: 'rejected', pending: 'pending' };

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, token, setSession } = useAuthStore();
  const [accountForm, setAccountForm] = useState({ name: user?.name || '', email: user?.email || '', currentPassword: '', newPassword: '' });
  const [accountMsg, setAccountMsg] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [stats, setStats] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [tab, setTab] = useState('drivers');
  const [driverView, setDriverView] = useState('list');
  const [form, setForm] = useState({
    name: '', email: '', mobile: '', licenseNumber: '', vehicleType: 'Economy', vehicleNumber: '', ratePerKm: 1.8,
    serviceCategory: 'private-hire', hasSecurityCamera: false, tslNumber: '', passengerEndorsementNumber: '', passengerEndorsementExpiry: '', vehicleCofExpiry: '',
  });
  const [createdInfo, setCreatedInfo] = useState(null);
  const [resetPasswordInfo, setResetPasswordInfo] = useState(null);
  const [error, setError] = useState('');
  const [qrFor, setQrFor] = useState(null);
  const [docsFor, setDocsFor] = useState(null);
  const [editFor, setEditFor] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState('');
  const [settings, setSettings] = useState(null);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [backupMsg, setBackupMsg] = useState('');
  const [passengers, setPassengers] = useState([]);
  const [trips, setTrips] = useState([]);
  const [tripFilter, setTripFilter] = useState('');
  const [tripDriverFilter, setTripDriverFilter] = useState('');
  const [tripDateFrom, setTripDateFrom] = useState('');
  const [tripDateTo, setTripDateTo] = useState('');
  const [feedback, setFeedback] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [vehicleDocuments, setVehicleDocuments] = useState([]);
  const [docError, setDocError] = useState('');
  const tabContentRef = useRef(null);

  function load() {
    client.get('/booking/vehicle-types').then((r) => setVehicleTypes(r.data)).catch(() => {});
    client.get('/admin/document-types').then((r) => setVehicleDocuments(r.data)).catch(() => {});
    client.get('/admin/stats').then((r) => setStats(r.data));
    client.get('/admin/drivers').then((r) => setDrivers(r.data));
    client.get('/admin/settings').then((r) => setSettings(r.data));
    client.get('/admin/passengers').then((r) => setPassengers(r.data));
    client.get('/admin/feedback').then((r) => setFeedback(r.data));
    client.get('/admin/enquiries').then((r) => setEnquiries(r.data)).catch(() => {});
    client.get('/admin/bookings').then((r) => setTrips(r.data));
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
      setForm({
        name: '', email: '', mobile: '', licenseNumber: '', vehicleType: 'Economy', vehicleNumber: '', ratePerKm: 1.8,
        serviceCategory: 'private-hire', hasSecurityCamera: false, tslNumber: '', passengerEndorsementNumber: '', passengerEndorsementExpiry: '', vehicleCofExpiry: '',
      });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add driver');
    }
  }

  async function approve(id) {
    setError('');
    try {
      await client.put(`/admin/drivers/${id}/approve`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not approve driver');
      setDocsFor(id);
    }
    load();
  }
  async function reject(id) { await client.put(`/admin/drivers/${id}/reject`); load(); }

  async function reviewDocument(driverId, documentKey, status) {
    setDocError('');
    let reason;
    if (status === 'rejected') {
      reason = window.prompt('Why is this document being rejected? The driver sees this reason.');
      if (!reason?.trim()) return;
    }
    try {
      await client.put(`/admin/drivers/${driverId}/verify-document`, { documentKey, status, reason });
      load();
    } catch (err) {
      setDocError(err.response?.data?.error || 'Could not update this document');
    }
  }
  async function deactivate(id) { await client.put(`/admin/drivers/${id}/deactivate`); load(); }
  async function reactivate(id) { await client.put(`/admin/drivers/${id}/reactivate`); load(); }

  async function deleteDriver(d) {
    if (!window.confirm(`Permanently delete ${d.userId?.name || 'this driver'}? This removes their account entirely and can't be undone.`)) return;
    try {
      await client.delete(`/admin/drivers/${d._id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this driver');
    }
  }
  async function approveRate(id) { await client.put(`/admin/drivers/${id}/rate/approve`); load(); }
  async function rejectRate(id) { await client.put(`/admin/drivers/${id}/rate/reject`); load(); }

  async function toggleBookingBlock(p) {
    await client.put(`/admin/users/${p._id}/${p.bookingBlocked ? 'unblock-booking' : 'block-booking'}`);
    load();
  }

  async function resetPassword(userId, name, mobile) {
    if (!window.confirm(`Reset ${name || 'this user'}'s password? They'll need the new temporary password to log in.`)) return;
    try {
      const { data } = await client.put(`/admin/users/${userId}/reset-password`);
      setResetPasswordInfo({ name, mobile, ...data });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset password');
    }
  }

  async function deletePassenger(p) {
    if (!window.confirm(`Permanently delete ${p.name}? This removes their account entirely and can't be undone.`)) return;
    try {
      await client.delete(`/admin/users/${p._id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this passenger');
    }
  }

  async function viewQr(id) {
    setEditFor(null);
    if (qrFor?.id === id) { setQrFor(null); return; }
    const { data } = await client.get(`/admin/drivers/${id}/qr-code`);
    setQrFor({ id, ...data });
  }

  function startEdit(d) {
    setQrFor(null);
    setEditError('');
    if (editFor === d._id) { setEditFor(null); return; }
    setEditFor(d._id);
    setEditForm({
      name: d.userId?.name || '', email: d.userId?.email || '', mobile: d.userId?.mobile || '', licenseNumber: d.licenseNumber, vehicleType: d.vehicleType, vehicleNumber: d.vehicleNumber,
      ratePerKm: d.ratePerKm,
      serviceCategory: d.serviceCategory || 'private-hire',
      hasSecurityCamera: !!d.hasSecurityCamera,
      tslNumber: d.tslNumber || '',
      passengerEndorsementNumber: d.passengerEndorsementNumber || '',
      passengerEndorsementExpiry: d.passengerEndorsementExpiry ? d.passengerEndorsementExpiry.slice(0, 10) : '',
      vehicleCofExpiry: d.vehicleCofExpiry ? d.vehicleCofExpiry.slice(0, 10) : '',
    });
  }

  async function saveEdit(id) {
    setEditError('');
    try {
      await client.put(`/admin/drivers/${id}`, editForm);
      setEditFor(null);
      load();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Could not save changes');
    }
  }

  async function saveAccount(e) {
    e.preventDefault();
    setAccountMsg('');
    setAccountSaving(true);
    try {
      const { data } = await client.put('/auth/me', accountForm);
      setSession(token, data);
      setAccountForm((f) => ({ ...f, email: data.email, currentPassword: '', newPassword: '' }));
      setAccountMsg('Saved.');
    } catch (err) {
      setAccountMsg(err.response?.data?.error || 'Could not save your account');
    } finally {
      setAccountSaving(false);
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    setSettingsMsg('');
    try {
      const { data } = await client.put('/admin/settings', settings);
      setSettings(data);
      setSettingsMsg('Saved.');
    } catch (err) {
      setSettingsMsg(err.response?.data?.error || 'Could not save settings');
    }
  }

  async function runBackupNow() {
    setBackupMsg('Sending...');
    try {
      const { data } = await client.post('/admin/backup/run');
      setBackupMsg(`Sent: ${data.counts.passengers} passengers, ${data.counts.bookings} trips, ${data.counts.complaints} complaints.`);
      client.get('/admin/settings').then((r) => setSettings(r.data));
    } catch (err) {
      setBackupMsg(err.response?.data?.error || 'Could not send backup');
    }
  }

  const filteredTrips = trips.filter((t) => {
    if (tripFilter === 'open' ? !['accepted', 'in-progress'].includes(t.status) : tripFilter && t.status !== tripFilter) return false;
    if (tripDriverFilter && String(t.driverId?._id) !== tripDriverFilter) return false;
    const created = new Date(t.createdAt);
    if (tripDateFrom && created < new Date(`${tripDateFrom}T00:00:00`)) return false;
    if (tripDateTo && created > new Date(`${tripDateTo}T23:59:59`)) return false;
    return true;
  });

  function scrollToDetails() {
    setTimeout(() => tabContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  function focusTab(tabName) {
    setTab(tabName);
    scrollToDetails();
  }

  function goToTrips(filterValue) {
    setTab('trips');
    setTripFilter(filterValue);
    scrollToDetails();
  }

  return (
    <div className="container">
      <h1>Admin dashboard</h1>

      {resetPasswordInfo && (
        <div className="card" style={{ background: '#fef3c7' }}>
          <strong>Password reset for {resetPasswordInfo.name}.</strong>{' '}
          {settings?.tempPasswordVisible !== false
            ? <>Temporary password: <code>{resetPasswordInfo.temporaryPassword}</code></>
            : 'Temporary password generated (hidden - see admin settings to show it here).'}
          <p className="muted">{resetPasswordInfo.note}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {settings?.tempPasswordVisible !== false && waLink(resetPasswordInfo.mobile, `Hi ${resetPasswordInfo.name}, your EasyRide password was reset. Temporary password: ${resetPasswordInfo.temporaryPassword} - please log in and change it.`) && (
              <a className="btn whatsapp" target="_blank" rel="noreferrer"
                href={waLink(resetPasswordInfo.mobile, `Hi ${resetPasswordInfo.name}, your EasyRide password was reset. Temporary password: ${resetPasswordInfo.temporaryPassword} - please log in and change it.`)}>
                Send via WhatsApp
              </a>
            )}
            <button className="btn secondary" onClick={() => setResetPasswordInfo(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {stats && (
        <div className="grid cols-4">
          <div className="card stat clickable" onClick={() => focusTab('passengers')}>
            <div className="icon">🧍</div><div className="value">{stats.totalPassengers}</div><div className="label">Passengers</div>
          </div>
          <div className="card stat clickable" onClick={() => focusTab('drivers')}>
            <div className="icon">🚘</div><div className="value">{stats.totalDrivers}</div><div className="label">Drivers</div>
            {stats.pendingDriverApprovals > 0 && <div className="sub-note">{stats.pendingDriverApprovals} pending approval</div>}
          </div>
          <div className="card stat clickable" onClick={() => goToTrips('pending')}>
            <div className="icon">⏳</div><div className="value">{stats.pendingTrips}</div><div className="label">Pending trips</div>
          </div>
          <div className="card stat clickable" onClick={() => goToTrips('open')}>
            <div className="icon">🚗</div><div className="value">{stats.openTrips}</div><div className="label">Open trips</div>
          </div>
          <div className="card stat clickable" onClick={() => goToTrips('completed')}>
            <div className="icon">✅</div><div className="value">{stats.completedTrips}</div><div className="label">Completed trips</div>
          </div>
          <div className="card stat">
            <div className="icon">💰</div><div className="value">${stats.totalRevenue.toFixed(2)}</div><div className="label">Revenue</div>
          </div>
          <div className="card stat clickable" onClick={() => navigate('/admin/complaints?status=open')}>
            <div className="icon">⚠️</div><div className="value">{stats.openComplaints}</div><div className="label">Open complaints</div>
          </div>
          <div className="card stat clickable" onClick={() => navigate('/admin/complaints?serious=true')}>
            <div className="icon">🚨</div><div className="value">{stats.seriousComplaints}</div><div className="label">Serious complaints</div>
          </div>
          <div className="card stat clickable" onClick={() => focusTab('settings')}>
            <div className="icon">⚙️</div><div className="label">Settings</div>
          </div>
          <div className="card stat clickable" onClick={() => focusTab('feedback')}>
            <div className="icon">💬</div><div className="value">{feedback.length}</div><div className="label">Feedback</div>
          </div>
          <div className="card stat clickable" onClick={() => focusTab('enquiries')}>
            <div className="icon">✉️</div><div className="value">{enquiries.length}</div><div className="label">Enquiries</div>
          </div>
        </div>
      )}

      <div ref={tabContentRef} />

      {tab === 'drivers' && (
        <div>
          <div className="tabs">
            <button className={driverView === 'list' ? 'active' : ''} onClick={() => setDriverView('list')}>Driver list</button>
            <button className={driverView === 'add' ? 'active' : ''} onClick={() => setDriverView('add')}>+ Add driver</button>
          </div>

          {driverView === 'list' && (
          <div className="card">
          <table>
            <thead><tr><th>Driver</th><th>Vehicle</th><th>Rate/km</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {drivers.map((d) => (
                <Fragment key={d._id}>
                  <tr>
                    <td>{d.userId?.name}<div className="muted">{d.userId?.email}</div></td>
                    <td>{d.vehicleType} · {d.vehicleNumber}<div className="muted">Lic: {d.licenseNumber}</div></td>
                    <td>
                      ${d.ratePerKm}
                      {d.pendingRatePerKm != null && (
                        <div className="muted">
                          → ${d.pendingRatePerKm} requested
                          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                            <button className="btn" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => approveRate(d._id)}>Approve</button>
                            <button className="btn danger" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => rejectRate(d._id)}>Reject</button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${d.status}`}>{d.status}</span>
                      {d.compliance && !d.compliance.compliant && (
                        <div className="muted" title={d.compliance.issues.join('; ')}><span className="badge cancelled">NZTA: incomplete</span></div>
                      )}
                    </td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {d.status === 'pending' && <>
                        <button className="btn" onClick={() => approve(d._id)}>Approve</button>
                        <button className="btn danger" onClick={() => reject(d._id)}>Reject</button>
                      </>}
                      {d.status === 'approved' && <button className="btn secondary" onClick={() => deactivate(d._id)}>Deactivate</button>}
                      {d.status === 'rejected' && <button className="btn" onClick={() => reactivate(d._id)}>Reactivate</button>}
                      <button className="btn secondary" onClick={() => startEdit(d)}>{editFor === d._id ? 'Cancel' : 'Edit'}</button>
                      <button className="btn secondary" onClick={() => resetPassword(d.userId?._id, d.userId?.name, d.userId?.mobile)}>Reset password</button>
                      <button className="btn secondary" onClick={() => viewQr(d._id)}>{qrFor?.id === d._id ? 'Hide QR' : 'View QR'}</button>
                      {d.documents && (
                        <button className="btn secondary" onClick={() => setDocsFor(docsFor === d._id ? null : d._id)}>{docsFor === d._id ? 'Hide docs' : 'Review docs'}</button>
                      )}
                      <Link className="btn secondary" to={`/admin/drivers/${d._id}/report`}>Report</Link>
                      <button className="btn danger" onClick={() => deleteDriver(d)}>Delete</button>
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
                  {docsFor === d._id && (
                    <tr>
                      <td colSpan={5} style={{ padding: 16 }}>
                        <strong>Documents</strong> (self-signup on {d.termsAcceptedAt ? formatNzDate(d.termsAcceptedAt) : '-'}, T&amp;Cs accepted)
                        <p className="muted" style={{ marginTop: 4 }}>Every document must be verified before this driver can be approved.</p>
                        {docError && <p className="error-text">{docError}</p>}
                        <table>
                          <tbody>
                            {vehicleDocuments.map((doc) => {
                              const record = d.documents?.[doc.key];
                              return (
                                <tr key={doc.key}>
                                  <td>
                                    <strong>{doc.label}</strong>
                                    {record?.status === 'rejected' && <div className="error-text">Rejected: {record.rejectionReason}</div>}
                                    {record?.uploadedAt && <div className="muted">Uploaded {formatNzDate(record.uploadedAt)}</div>}
                                  </td>
                                  <td><span className={`badge ${DOC_STATUS_CLASS[record?.status] || 'closed'}`}>{record?.status || 'not supplied'}</span></td>
                                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {record?.url && <a className="btn secondary" href={`${fileOrigin}${record.url}`} target="_blank" rel="noreferrer">View</a>}
                                    {record?.url && record.status !== 'verified' && (
                                      <button className="btn" onClick={() => reviewDocument(d._id, doc.key, 'verified')}>Verify</button>
                                    )}
                                    {record?.url && record.status !== 'rejected' && (
                                      <button className="btn danger" onClick={() => reviewDocument(d._id, doc.key, 'rejected')}>Reject</button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                  {editFor === d._id && (
                    <tr>
                      <td colSpan={5} style={{ padding: 16 }}>
                        <div className="grid cols-2">
                          <div><label>Name</label><input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} /></div>
                          <div><label>Email</label><input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} /></div>
                          <PhoneField value={editForm.mobile} onChange={(v) => setEditForm((f) => ({ ...f, mobile: v }))} />
                          <div><label>License number</label><input value={editForm.licenseNumber} onChange={(e) => setEditForm((f) => ({ ...f, licenseNumber: e.target.value }))} /></div>
                          <div><label>Rate per km ($)</label><input type="number" step="0.1" min="0.1" value={editForm.ratePerKm} onChange={(e) => setEditForm((f) => ({ ...f, ratePerKm: e.target.value }))} /></div>
                          <div>
                            <label>Vehicle type</label>
                            <select value={editForm.vehicleType} onChange={(e) => setEditForm((f) => ({ ...f, vehicleType: e.target.value }))}>
                              {vehicleTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                          </div>
                          <div><label>Vehicle number</label><input value={editForm.vehicleNumber} onChange={(e) => setEditForm((f) => ({ ...f, vehicleNumber: e.target.value }))} /></div>
                        </div>
                        <h4 style={{ marginBottom: 4 }}>NZTA compliance (SPSV)</h4>
                        <p className="muted" style={{ marginTop: 0 }}>Private Hire needs no in-vehicle camera; Taxi category does.</p>
                        <div className="grid cols-2">
                          <div>
                            <label>Service category</label>
                            <select value={editForm.serviceCategory} onChange={(e) => setEditForm((f) => ({ ...f, serviceCategory: e.target.value }))}>
                              <option value="private-hire">Private Hire (no camera)</option>
                              <option value="taxi">Taxi (camera required)</option>
                            </select>
                          </div>
                          {editForm.serviceCategory === 'taxi' && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 20 }}>
                              <input type="checkbox" style={{ width: 'auto' }} checked={editForm.hasSecurityCamera} onChange={(e) => setEditForm((f) => ({ ...f, hasSecurityCamera: e.target.checked }))} />
                              Has approved security camera
                            </label>
                          )}
                          <div><label>TSL number</label><input value={editForm.tslNumber} onChange={(e) => setEditForm((f) => ({ ...f, tslNumber: e.target.value }))} /></div>
                          <div><label>Passenger (P) endorsement #</label><input value={editForm.passengerEndorsementNumber} onChange={(e) => setEditForm((f) => ({ ...f, passengerEndorsementNumber: e.target.value }))} /></div>
                          <div><label>Endorsement expiry</label><input type="date" value={editForm.passengerEndorsementExpiry} onChange={(e) => setEditForm((f) => ({ ...f, passengerEndorsementExpiry: e.target.value }))} /></div>
                          <div><label>Vehicle CoF expiry</label><input type="date" value={editForm.vehicleCofExpiry} onChange={(e) => setEditForm((f) => ({ ...f, vehicleCofExpiry: e.target.value }))} /></div>
                        </div>
                        {editError && <p className="error-text">{editError}</p>}
                        <button className="btn" style={{ marginTop: 8 }} onClick={() => saveEdit(d._id)}>Save changes</button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
          )}

          {driverView === 'add' && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Add a new driver (admin-managed signup)</h3>
          <form onSubmit={addDriver}>
            <div><label>Full name</label><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></div>
            <div><label>Email</label><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></div>
            <PhoneField value={form.mobile} onChange={(v) => update('mobile', v)} hint="Trip requests are sent here on WhatsApp." />
            <div><label>License number</label><input value={form.licenseNumber} onChange={(e) => update('licenseNumber', e.target.value)} required /></div>
            <div>
              <label>Vehicle type</label>
              <select value={form.vehicleType} onChange={(e) => update('vehicleType', e.target.value)}>
                {vehicleTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div><label>Vehicle number</label><input value={form.vehicleNumber} onChange={(e) => update('vehicleNumber', e.target.value)} required /></div>
            <div><label>Rate per km ($)</label><input type="number" step="0.1" value={form.ratePerKm} onChange={(e) => update('ratePerKm', e.target.value)} /></div>

            <h4 style={{ marginBottom: 4 }}>NZTA compliance (SPSV)</h4>
            <p className="muted" style={{ marginTop: 0 }}>Private Hire needs no in-vehicle camera; Taxi category does.</p>
            <div>
              <label>Service category</label>
              <select value={form.serviceCategory} onChange={(e) => update('serviceCategory', e.target.value)}>
                <option value="private-hire">Private Hire (no camera)</option>
                <option value="taxi">Taxi (camera required)</option>
              </select>
            </div>
            {form.serviceCategory === 'taxi' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={form.hasSecurityCamera} onChange={(e) => update('hasSecurityCamera', e.target.checked)} />
                Has approved security camera
              </label>
            )}
            <div><label>TSL number</label><input value={form.tslNumber} onChange={(e) => update('tslNumber', e.target.value)} /></div>
            <div><label>Passenger (P) endorsement #</label><input value={form.passengerEndorsementNumber} onChange={(e) => update('passengerEndorsementNumber', e.target.value)} /></div>
            <div><label>Endorsement expiry</label><input type="date" value={form.passengerEndorsementExpiry} onChange={(e) => update('passengerEndorsementExpiry', e.target.value)} /></div>
            <div><label>Vehicle CoF expiry</label><input type="date" value={form.vehicleCofExpiry} onChange={(e) => update('vehicleCofExpiry', e.target.value)} /></div>

            {error && <p className="error-text">{error}</p>}
            <button className="btn">Add driver</button>
          </form>
          {createdInfo && (
            <div className="card" style={{ marginTop: 12, background: '#fef3c7' }}>
              <strong>Driver created.</strong>{' '}
              {settings?.tempPasswordVisible !== false
                ? <>Temporary password: <code>{createdInfo.temporaryPassword}</code></>
                : 'Temporary password generated (hidden - see admin settings to show it here).'}
              <p className="muted">{createdInfo.note}</p>
            </div>
          )}
        </div>
          )}
        </div>
      )}

      {tab === 'passengers' && (
        <div className="grid cols-2">
          {passengers.map((p) => (
            <div className="card" key={p._id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted">{p.email}</div>
                  {p.mobile && <div className="muted">{p.mobile}</div>}
                </div>
                {p.bookingBlocked && <span className="badge cancelled">booking blocked</span>}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>{p.totalBookings} bookings · {p.completedTrips} completed · {p.ratingAvg ? `⭐ ${p.ratingAvg}` : 'no rating yet'}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button
                  className={`btn ${p.bookingBlocked ? '' : 'danger'}`}
                  onClick={() => toggleBookingBlock(p)}
                >
                  {p.bookingBlocked ? 'Unblock booking' : 'Block from booking'}
                </button>
                <button className="btn secondary" onClick={() => resetPassword(p._id, p.name, p.mobile)}>Reset password</button>
                <button className="btn danger" onClick={() => deletePassenger(p)}>Delete</button>
              </div>
            </div>
          ))}
          {passengers.length === 0 && <p className="muted">No passengers yet.</p>}
        </div>
      )}

      {tab === 'trips' && (
        <div>
          <div className="tabs">
            {['', 'pending', 'accepted', 'in-progress', 'open', 'completed', 'cancelled'].map((s) => (
              <button key={s || 'all'} className={tripFilter === s ? 'active' : ''} onClick={() => setTripFilter(s)}>{s === 'open' ? 'Open (accepted/in-progress)' : (s || 'All')}</button>
            ))}
          </div>
          <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label>Driver</label>
              <select value={tripDriverFilter} onChange={(e) => setTripDriverFilter(e.target.value)}>
                <option value="">All drivers</option>
                {drivers.map((d) => <option key={d._id} value={d._id}>{d.userId?.name}</option>)}
              </select>
            </div>
            <div><label>From</label><input type="date" value={tripDateFrom} onChange={(e) => setTripDateFrom(e.target.value)} /></div>
            <div><label>To</label><input type="date" value={tripDateTo} onChange={(e) => setTripDateTo(e.target.value)} /></div>
            {(tripDriverFilter || tripDateFrom || tripDateTo) && (
              <button className="btn secondary" onClick={() => { setTripDriverFilter(''); setTripDateFrom(''); setTripDateTo(''); }}>Clear</button>
            )}
          </div>
          <div className="card">
            <table>
              <thead><tr><th>Trip</th><th>Passenger</th><th>Driver</th><th>Fare</th><th>Status</th><th>When</th></tr></thead>
              <tbody>
                {filteredTrips.map((t) => (
                  <tr key={t._id}>
                    <td>
                      <div className="muted">{t.bookingId}</div>
                      {t.pickupAddress}{t.stops?.map((s, i) => <span key={i}> → {s.address}</span>)} → {t.dropAddress}
                      {t.scheduledFor && <div className="muted">Scheduled: {formatNzDateTime(t.scheduledFor)}</div>}
                    </td>
                    <td>{t.passengerId?.name}{t.passengerRatingAvg ? <div className="muted">⭐ {t.passengerRatingAvg}</div> : ''}</td>
                    <td>{t.driverId?.userId?.name || '-'}</td>
                    <td>${t.actualFare ?? t.estimatedFare}{t.rating && <div className="muted">⭐ {t.rating} (driver)</div>}</td>
                    <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                    <td className="muted">{formatNzDateTime(t.createdAt)}</td>
                  </tr>
                ))}
                {filteredTrips.length === 0 && <tr><td colSpan={6} className="muted">No trips match this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'settings' && settings && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Booking fee / platform access fee</h3>
          <p className="muted">Choose how drivers pay to use the platform: a % commission per completed trip, or a fixed weekly access fee.</p>
          <form onSubmit={saveSettings}>
            <div>
              <label>Model</label>
              <select value={settings.commissionType} onChange={(e) => setSettings((s) => ({ ...s, commissionType: e.target.value }))}>
                <option value="per-trip-percent">% commission per trip (tallied weekly)</option>
                <option value="weekly-flat">Fixed weekly access fee</option>
              </select>
            </div>
            {settings.commissionType === 'per-trip-percent' ? (
              <div><label>Commission (%)</label><input type="number" step="0.5" min="0" max="100" value={settings.commissionPercent} onChange={(e) => setSettings((s) => ({ ...s, commissionPercent: e.target.value }))} /></div>
            ) : (
              <div><label>Weekly fee ($)</label><input type="number" step="1" min="0" value={settings.weeklyFlatFee} onChange={(e) => setSettings((s) => ({ ...s, weeklyFlatFee: e.target.value }))} /></div>
            )}
            <div>
              <label>Default outstanding-fee limit ($)</label>
              <input type="number" step="1" min="0" value={settings.outstandingFeeLimit} onChange={(e) => setSettings((s) => ({ ...s, outstandingFeeLimit: e.target.value }))} />
              <p className="muted" style={{ marginTop: 4 }}>A driver whose unpaid balance exceeds this is blocked from going online (auto-disabled if it happens mid-session). Override per driver from their report page.</p>
            </div>
            <div>
              <label>Card payment surcharge (%)</label>
              <input type="number" step="0.1" min="0" max="20" value={settings.cardSurchargePercent} onChange={(e) => setSettings((s) => ({ ...s, cardSurchargePercent: e.target.value }))} />
              <p className="muted" style={{ marginTop: 4 }}>Disclosed to the passenger and added on top of the fare only when they pay online (covers the payment gateway's processing cost). Cash trips are unaffected.</p>
            </div>
            {settingsMsg && <p className="muted">{settingsMsg}</p>}
            <button className="btn">Save</button>
          </form>
        </div>
      )}

      {tab === 'settings' && settings && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Fare floors</h3>
          <p className="muted">
            Every trip is quoted at the <strong>highest</strong> of: the driver's per-km rate, the minimum fare
            below, and (if the trip's distance falls inside one) the matching range price. This stops a short or
            low per-km trip from underpricing the ride.
          </p>
          <form onSubmit={saveSettings}>
            <div>
              <label>Minimum fare ($)</label>
              <input type="number" step="0.5" min="0" value={settings.minimumFare}
                onChange={(e) => setSettings((s) => ({ ...s, minimumFare: e.target.value }))} />
              <p className="muted" style={{ marginTop: 4 }}>No trip is ever quoted below this, regardless of distance.</p>
            </div>

            <div>
              <label>Range-based prices</label>
              <p className="muted" style={{ marginTop: 0 }}>
                E.g. "up to 5 km = $12" - a flat price for any trip whose distance falls at or under that km figure.
                Leave empty to rely on the minimum fare and per-km rate alone.
              </p>
              {settings.fareRanges.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <input type="number" step="0.5" min="0.1" placeholder="up to km" style={{ maxWidth: 110 }}
                    value={r.maxKm}
                    onChange={(e) => setSettings((s) => ({ ...s, fareRanges: s.fareRanges.map((row, j) => (j === i ? { ...row, maxKm: e.target.value } : row)) }))} />
                  <span className="muted">km → $</span>
                  <input type="number" step="0.5" min="0" placeholder="price" style={{ maxWidth: 110 }}
                    value={r.price}
                    onChange={(e) => setSettings((s) => ({ ...s, fareRanges: s.fareRanges.map((row, j) => (j === i ? { ...row, price: e.target.value } : row)) }))} />
                  <button type="button" className="btn danger" style={{ padding: '4px 10px' }}
                    onClick={() => setSettings((s) => ({ ...s, fareRanges: s.fareRanges.filter((_, j) => j !== i) }))}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn secondary"
                onClick={() => setSettings((s) => ({ ...s, fareRanges: [...s.fareRanges, { maxKm: '', price: '' }] }))}>Add range</button>
            </div>

            {settingsMsg && <p className="muted">{settingsMsg}</p>}
            <button className="btn" style={{ marginTop: 12 }}>Save</button>
          </form>
        </div>
      )}

      {tab === 'settings' && settings && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Driver sign-up</h3>
          <p className="muted">Turn off to hide "Drive with us" from the site and stop new applications - existing drivers are unaffected.</p>
          <form onSubmit={saveSettings}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={settings.driverSignupEnabled !== false}
                onChange={(e) => setSettings((s) => ({ ...s, driverSignupEnabled: e.target.checked }))} />
              Accepting new driver applications
            </label>
            {settingsMsg && <p className="muted">{settingsMsg}</p>}
            <button className="btn" style={{ marginTop: 12 }}>Save</button>
          </form>
        </div>
      )}

      {tab === 'settings' && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>My account</h3>
          <p className="muted">Your own admin login. Changing email or password requires your current password.</p>
          <form onSubmit={saveAccount}>
            <div><label>Name</label><input value={accountForm.name} onChange={(e) => setAccountForm((f) => ({ ...f, name: e.target.value }))} required /></div>
            <div><label>Email</label><input type="email" value={accountForm.email} onChange={(e) => setAccountForm((f) => ({ ...f, email: e.target.value }))} required /></div>
            <div><label>Current password</label><input type="password" value={accountForm.currentPassword} onChange={(e) => setAccountForm((f) => ({ ...f, currentPassword: e.target.value }))} placeholder="Required to change email or password" /></div>
            <div><label>New password (optional)</label><input type="password" value={accountForm.newPassword} onChange={(e) => setAccountForm((f) => ({ ...f, newPassword: e.target.value }))} placeholder="Leave blank to keep current password" /></div>
            {accountMsg && <p className="muted">{accountMsg}</p>}
            <button className="btn" disabled={accountSaving}>{accountSaving ? 'Saving...' : 'Save'}</button>
          </form>
        </div>
      )}

      {tab === 'settings' && settings && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Vehicle selection</h3>
          <p className="muted">Turn off to hide the vehicle-type selector on the booking form - every booking then broadcasts to any available driver regardless of vehicle type.</p>
          <form onSubmit={saveSettings}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={settings.vehicleSelectionEnabled !== false}
                onChange={(e) => setSettings((s) => ({ ...s, vehicleSelectionEnabled: e.target.checked }))} />
              Passengers can choose a vehicle type when booking
            </label>
            {settingsMsg && <p className="muted">{settingsMsg}</p>}
            <button className="btn" style={{ marginTop: 12 }}>Save</button>
          </form>
        </div>
      )}

      {tab === 'settings' && settings && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Temporary password visibility</h3>
          <p className="muted">
            Controls whether the one-time temporary password is shown on screen right after a new driver is
            created (Add driver tab). Turn off if the screen is shared - you'll still need another way to get the
            password to the driver.
          </p>
          <form onSubmit={saveSettings}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={settings.tempPasswordVisible !== false}
                onChange={(e) => setSettings((s) => ({ ...s, tempPasswordVisible: e.target.checked }))} />
              Show temporary password after creating a driver
            </label>
            {settingsMsg && <p className="muted">{settingsMsg}</p>}
            <button className="btn" style={{ marginTop: 12 }}>Save</button>
          </form>
        </div>
      )}

      {tab === 'settings' && settings && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Admin contact &amp; data backups</h3>
          <p className="muted">
            Serious-complaint alerts and scheduled backups go to this address. A CSV export of passengers, trips and
            complaints is emailed here automatically on the schedule below. Both fields also power the "Contact
            admin" links shown to a passenger when no driver is available.
          </p>
          <form onSubmit={saveSettings}>
            <div>
              <label>Admin email</label>
              <input type="email" value={settings.adminEmail || ''} onChange={(e) => setSettings((s) => ({ ...s, adminEmail: e.target.value }))} required />
            </div>
            <PhoneField label="Admin WhatsApp number (optional)" value={settings.adminMobile || ''} onChange={(v) => setSettings((s) => ({ ...s, adminMobile: v }))} />
            <div>
              <label>Backup frequency</label>
              <select value={settings.backupFrequency} onChange={(e) => setSettings((s) => ({ ...s, backupFrequency: e.target.value }))}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {settingsMsg && <p className="muted">{settingsMsg}</p>}
            <button className="btn" style={{ marginTop: 12 }}>Save</button>
          </form>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <p className="muted" style={{ marginTop: 0 }}>
              {settings.lastBackupAt ? `Last backup: ${formatNzDateTime(settings.lastBackupAt)}` : 'No backup has been sent yet.'}
            </p>
            <button type="button" className="btn secondary" onClick={runBackupNow}>Run backup now</button>
            {backupMsg && <p className="muted" style={{ marginTop: 8 }}>{backupMsg}</p>}
          </div>
        </div>
      )}

      {tab === 'settings' && settings && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3>Data retention</h3>
          <p className="muted">
            Complaints are always kept for 2 years (NZ Transport Agency requirement) and removed automatically
            after that - not configurable here. Completed/cancelled trip records have no such requirement; set a
            limit below only if you need to manage database space. A trip still referenced by a complaint is never
            deleted early, regardless of this setting.
          </p>
          <form onSubmit={saveSettings}>
            <div>
              <label>Delete finished trips older than (days)</label>
              <input type="number" step="1" min="0" placeholder="Leave blank to keep forever"
                value={settings.tripRetentionDays ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, tripRetentionDays: e.target.value === '' ? null : Number(e.target.value) }))} />
            </div>
            {settingsMsg && <p className="muted">{settingsMsg}</p>}
            <button className="btn" style={{ marginTop: 12 }}>Save</button>
          </form>
        </div>
      )}

      {tab === 'feedback' && (
        <div className="card">
          <h3>Feedback submissions</h3>
          {feedback.length === 0 && <p className="muted">No feedback yet.</p>}
          <table>
            <tbody>
              {feedback.map((f) => (
                <tr key={f._id}>
                  <td>
                    <strong>{f.name}</strong>{f.email && <span className="muted"> · {f.email}</span>}
                    {f.rating ? <span> · {'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}</span> : ''}
                    <div className="muted">{f.message}</div>
                  </td>
                  <td className="muted">{formatNzDateTime(f.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'enquiries' && (
        <div className="card">
          <h3>Website enquiries</h3>
          <p className="muted">Submitted from the "Get in touch" form on the homepage - each one is also emailed to the admin inbox.</p>
          {enquiries.length === 0 && <p className="muted">No enquiries yet.</p>}
          <table>
            <tbody>
              {enquiries.map((e) => (
                <tr key={e._id}>
                  <td>
                    <strong>{e.name}</strong>
                    <span className="muted"> · {e.email}{e.phone ? ` · ${e.phone}` : ''}</span>
                    <div className="muted">{e.message}</div>
                  </td>
                  <td className="muted">{formatNzDateTime(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
