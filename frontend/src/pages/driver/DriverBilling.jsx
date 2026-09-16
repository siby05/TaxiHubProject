import { useEffect, useState } from 'react';
import client from '../../api/client';

export default function DriverBilling() {
  const [billing, setBilling] = useState(null);

  useEffect(() => {
    client.get('/driver/billing').then((r) => setBilling(r.data));
  }, []);

  if (!billing) return <div className="container"><p className="muted">Loading...</p></div>;

  return (
    <div className="container">
      <h1>Platform fees</h1>
      <p className="muted">
        {billing.commissionType === 'weekly-flat'
          ? 'A fixed weekly fee keeps your account able to go online.'
          : 'A percentage of each completed trip is owed to the platform, tallied weekly.'}
        {' '}Settle overdue weeks with the admin to keep going online.
      </p>

      <div className="grid cols-4">
        <div className="card stat"><div className="value">${billing.totalOwed.toFixed(2)}</div><div className="label">Total owed</div></div>
        <div className="card stat"><div className="value">${billing.totalPaid.toFixed(2)}</div><div className="label">Total paid</div></div>
        <div className="card stat"><div className="value">${billing.totalPending.toFixed(2)}</div><div className="label">Outstanding</div></div>
      </div>

      {billing.hasOverdue && <div className="card" style={{ background: '#fee2e2' }}>You have overdue fees - going online is blocked until these are settled.</div>}

      <div className="card">
        <table>
          <thead><tr><th>Week</th><th>Trips</th><th>Revenue</th><th>Owed</th><th>Paid</th><th>Status</th></tr></thead>
          <tbody>
            {billing.weeks.map((w) => (
              <tr key={w.weekStart}>
                <td>{new Date(w.weekStart).toLocaleDateString()}</td>
                <td>{w.tripsCount}</td>
                <td>${w.tripsRevenue.toFixed(2)}</td>
                <td>${w.amountOwed.toFixed(2)}</td>
                <td>${w.amountPaid.toFixed(2)}</td>
                <td><span className={`badge ${w.status === 'overdue' ? 'cancelled' : w.status === 'paid' ? 'completed' : 'pending'}`}>{w.status}</span></td>
              </tr>
            ))}
            {billing.weeks.length === 0 && <tr><td colSpan={6} className="muted">No charges yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
