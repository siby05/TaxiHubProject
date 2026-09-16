import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import client from '../../api/client';

export default function AdminDriverReport() {
  const { driverId } = useParams();
  const [trips, setTrips] = useState([]);
  const [billing, setBilling] = useState(null);
  const [driver, setDriver] = useState(null);
  const [payForm, setPayForm] = useState({ weekStart: '', amount: '', note: '' });
  const [error, setError] = useState('');
  const [feeOverrideOn, setFeeOverrideOn] = useState(false);
  const [feeForm, setFeeForm] = useState({ commissionType: 'per-trip-percent', commissionPercent: 15, weeklyFlatFee: 50 });
  const [feeMsg, setFeeMsg] = useState('');

  function load() {
    client.get(`/admin/drivers/${driverId}/trips`).then((r) => setTrips(r.data));
    client.get(`/admin/drivers/${driverId}/billing`).then((r) => setBilling(r.data));
    client.get(`/admin/drivers/${driverId}`).then((r) => {
      setDriver(r.data);
      setFeeOverrideOn(!!r.data.feeOverride);
      if (r.data.feeOverride) setFeeForm((f) => ({ ...f, ...r.data.feeOverride }));
    });
  }

  useEffect(() => { load(); }, [driverId]);

  async function recordPayment(e) {
    e.preventDefault();
    setError('');
    try {
      await client.post(`/admin/drivers/${driverId}/billing/pay`, payForm);
      setPayForm({ weekStart: '', amount: '', note: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record payment');
    }
  }

  async function saveFeeOverride(e) {
    e.preventDefault();
    setFeeMsg('');
    try {
      if (feeOverrideOn) {
        await client.put(`/admin/drivers/${driverId}/fee-settings`, feeForm);
      } else {
        await client.delete(`/admin/drivers/${driverId}/fee-settings`);
      }
      setFeeMsg('Saved.');
      load();
    } catch (err) {
      setFeeMsg(err.response?.data?.error || 'Could not save');
    }
  }

  const completedTrips = trips.filter((t) => t.status === 'completed');

  return (
    <div className="container">
      <Link to="/admin">← Back to dashboard</Link>
      <h1>Driver report{driver ? `: ${driver.userId?.name}` : ''}</h1>

      {billing && (
        <div className="grid cols-4">
          <div className="card stat"><div className="value">{completedTrips.length}</div><div className="label">Completed trips</div></div>
          <div className="card stat"><div className="value">${billing.totalOwed.toFixed(2)}</div><div className="label">Total owed</div></div>
          <div className="card stat"><div className="value">${billing.totalPaid.toFixed(2)}</div><div className="label">Total paid</div></div>
          <div className="card stat"><div className="value">${billing.totalPending.toFixed(2)}</div><div className="label">Outstanding</div></div>
        </div>
      )}

      <div className="card" style={{ maxWidth: 420 }}>
        <h3>Fee override for this driver</h3>
        <p className="muted">Currently using: {billing?.commissionType === 'weekly-flat' ? 'fixed weekly fee' : '% commission per trip'} {driver?.feeOverride ? '(custom for this driver)' : '(platform default)'}</p>
        <form onSubmit={saveFeeOverride}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={feeOverrideOn} onChange={(e) => setFeeOverrideOn(e.target.checked)} />
            Use a custom fee for this driver
          </label>
          {feeOverrideOn && (
            <>
              <div>
                <label>Model</label>
                <select value={feeForm.commissionType} onChange={(e) => setFeeForm((f) => ({ ...f, commissionType: e.target.value }))}>
                  <option value="per-trip-percent">% commission per trip</option>
                  <option value="weekly-flat">Fixed weekly access fee</option>
                </select>
              </div>
              {feeForm.commissionType === 'per-trip-percent' ? (
                <div><label>Commission (%)</label><input type="number" step="0.5" min="0" max="100" value={feeForm.commissionPercent} onChange={(e) => setFeeForm((f) => ({ ...f, commissionPercent: e.target.value }))} /></div>
              ) : (
                <div><label>Weekly fee ($)</label><input type="number" step="1" min="0" value={feeForm.weeklyFlatFee} onChange={(e) => setFeeForm((f) => ({ ...f, weeklyFlatFee: e.target.value }))} /></div>
              )}
            </>
          )}
          {feeMsg && <p className="muted">{feeMsg}</p>}
          <button className="btn">Save</button>
        </form>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Weekly billing ledger</h3>
          <table>
            <thead><tr><th>Week</th><th>Trips</th><th>Revenue</th><th>Owed</th><th>Paid</th><th>Status</th></tr></thead>
            <tbody>
              {billing?.weeks.map((w) => (
                <tr key={w.weekStart}>
                  <td>{new Date(w.weekStart).toLocaleDateString()}</td>
                  <td>{w.tripsCount}</td>
                  <td>${w.tripsRevenue.toFixed(2)}</td>
                  <td>${w.amountOwed.toFixed(2)}</td>
                  <td>${w.amountPaid.toFixed(2)}</td>
                  <td><span className={`badge ${w.status === 'overdue' ? 'cancelled' : w.status === 'paid' ? 'completed' : 'pending'}`}>{w.status}</span></td>
                </tr>
              ))}
              {billing && billing.weeks.length === 0 && <tr><td colSpan={6} className="muted">No charges yet.</td></tr>}
            </tbody>
          </table>

          <h4 style={{ marginTop: 16 }}>Record a payment</h4>
          <form onSubmit={recordPayment}>
            <div>
              <label>Week</label>
              <select value={payForm.weekStart} onChange={(e) => setPayForm((f) => ({ ...f, weekStart: e.target.value }))} required>
                <option value="">Select a week...</option>
                {billing?.weeks.filter((w) => w.status !== 'paid').map((w) => (
                  <option key={w.weekStart} value={w.weekStart}>
                    {new Date(w.weekStart).toLocaleDateString()} - owed ${w.amountOwed.toFixed(2)}, paid ${w.amountPaid.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
            <div><label>Amount received ($)</label><input type="number" step="0.01" min="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} required /></div>
            <div><label>Note</label><input value={payForm.note} onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. bank transfer, cash" /></div>
            {error && <p className="error-text">{error}</p>}
            <button className="btn">Record payment</button>
          </form>
        </div>

        <div className="card">
          <h3>Trip history</h3>
          <table>
            <tbody>
              {trips.map((t) => (
                <tr key={t._id}>
                  <td>
                    <div>{t.pickupAddress} → {t.dropAddress}</div>
                    <div className="muted">{t.passengerId?.name} · {new Date(t.createdAt).toLocaleDateString()}</div>
                  </td>
                  <td>${t.actualFare ?? t.estimatedFare}</td>
                  <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                </tr>
              ))}
              {trips.length === 0 && <tr><td className="muted">No trips yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
