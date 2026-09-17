import { useEffect, useState } from 'react';
import client from '../../api/client';

export default function DriverReports() {
  const [trips, setTrips] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [section, setSection] = useState('trips');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [passengerFilter, setPassengerFilter] = useState('');

  useEffect(() => {
    client.get('/booking/driver', { params: { all: true } }).then((r) => setTrips(r.data));
    client.get('/complaints/driver/complaints-against-me').then((r) => setComplaints(r.data));
  }, []);

  function inRange(dateStr) {
    const d = new Date(dateStr);
    if (dateFrom && d < new Date(`${dateFrom}T00:00:00`)) return false;
    if (dateTo && d > new Date(`${dateTo}T23:59:59`)) return false;
    return true;
  }

  const filteredTrips = trips.filter((t) => {
    if (!inRange(t.createdAt)) return false;
    if (passengerFilter && !t.passengerId?.name?.toLowerCase().includes(passengerFilter.toLowerCase())) return false;
    return true;
  });

  const filteredComplaints = complaints.filter((c) => {
    if (!inRange(c.createdAt)) return false;
    if (passengerFilter && !c.complainantId?.name?.toLowerCase().includes(passengerFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="container">
      <h1>Reports</h1>

      <div className="tabs">
        <button className={section === 'trips' ? 'active' : ''} onClick={() => setSection('trips')}>Trips ({filteredTrips.length})</button>
        <button className={section === 'complaints' ? 'active' : ''} onClick={() => setSection('complaints')}>Complaints ({filteredComplaints.length})</button>
      </div>

      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><label>From</label><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div><label>To</label><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <div><label>Passenger name</label><input value={passengerFilter} onChange={(e) => setPassengerFilter(e.target.value)} placeholder="Filter by passenger" /></div>
        {(dateFrom || dateTo || passengerFilter) && (
          <button className="btn secondary" onClick={() => { setDateFrom(''); setDateTo(''); setPassengerFilter(''); }}>Clear</button>
        )}
      </div>

      {section === 'trips' && (
        <div className="card">
          <table>
            <thead><tr><th>Trip</th><th>Passenger</th><th>Fare</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {filteredTrips.map((t) => (
                <tr key={t._id}>
                  <td>
                    <div className="muted">{t.bookingId}</div>
                    {t.pickupAddress} → {t.dropAddress}
                  </td>
                  <td>{t.passengerId?.name}</td>
                  <td>${t.actualFare ?? t.estimatedFare}</td>
                  <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                  <td className="muted">{new Date(t.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {filteredTrips.length === 0 && <tr><td colSpan={5} className="muted">No trips match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {section === 'complaints' && (
        <div className="card">
          <table>
            <thead><tr><th>Complaint</th><th>Passenger</th><th>Type</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {filteredComplaints.map((c) => (
                <tr key={c._id}>
                  <td>{c.complaintId}<div className="muted">{c.description?.slice(0, 60)}{c.description?.length > 60 ? '...' : ''}</div></td>
                  <td>{c.complainantId?.name}</td>
                  <td className="muted">{c.complaintType?.replace(/-/g, ' ')}</td>
                  <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                  <td className="muted">{new Date(c.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {filteredComplaints.length === 0 && <tr><td colSpan={5} className="muted">No complaints match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
