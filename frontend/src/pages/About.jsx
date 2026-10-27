import { useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useDriverSignupEnabled } from '../hooks/useDriverSignupEnabled';

export default function About() {
  const driverSignupEnabled = useDriverSignupEnabled();
  const [form, setForm] = useState({ name: '', email: '', message: '', rating: 0 });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submitFeedback(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await client.post('/feedback', form);
      setSent(true);
      setForm({ name: '', email: '', message: '', rating: 0 });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send feedback');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="hero" style={{ maxWidth: '100%' }}>
        <div className="eyebrow">About EasyRide</div>
        <h1>Local rides, booked straight from the driver in front of you.</h1>
        <p className="tagline">
          EasyRide started in New Plymouth as a simple idea: let a passenger book a specific driver directly - by
          scanning the QR code on their car - with an upfront price, instead of guessing who'll turn up. We're
          expanding to more towns across New Zealand as more drivers join.
        </p>
      </div>

      <div className="grid cols-2" style={{ marginTop: 24 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>How it works</h3>
          <ul className="muted" style={{ marginTop: 0 }}>
            <li>Scan a driver's QR code, or book from the app - either matches you with a real, admin-approved driver.</li>
            <li>See your fare before you confirm - a base fare plus a per-km rate, no surge pricing.</li>
            <li>Pay by cash or online, whichever suits you.</li>
            <li>Rate your trip, and raise a complaint in-app if something goes wrong - every complaint is tracked and, for serious incidents, escalated per NZ Transport Agency requirements.</li>
          </ul>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Where we operate</h3>
          <p className="muted">
            Currently serving <strong>New Plymouth</strong>, with drivers being added in more Taranaki and wider New
            Zealand towns as we grow. If you'd like EasyRide in your area - as a driver or on behalf of a local
            operator - get in touch below.
          </p>
          <h3>For drivers</h3>
          <p className="muted">
            Every driver holds their own NZTA licensing (passenger endorsement, Transport Service Licence, vehicle
            CoF) and is reviewed by an admin before going live. See our <Link to="/terms">Terms &amp; Conditions</Link>{driverSignupEnabled && <> or <Link to="/driver-signup">apply to drive</Link></>}.
          </p>
        </div>
      </div>

      <div id="feedback" className="card" style={{ marginTop: 24, maxWidth: 480, scrollMarginTop: 90 }}>
        <h3 style={{ marginTop: 0 }}>Share your experience with EasyRide</h3>
        <p className="muted">Leave a passenger review, star rating or suggestion. Reviews are checked by our team before any are shown on our homepage.</p>
        {sent ? (
          <p className="muted" style={{ color: 'var(--success)' }}>Thanks - your feedback has been sent.</p>
        ) : (
          <form onSubmit={submitFeedback}>
            <div><label>Name (optional)</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><label>Email (optional)</label><input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div>
              <label>Rating (optional)</label>
              <div style={{ fontSize: '1.4rem', cursor: 'pointer' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} onClick={() => setForm((f) => ({ ...f, rating: n }))} style={{ color: form.rating >= n ? '#f59e0b' : '#d1d5db' }}>★</span>
                ))}
              </div>
            </div>
            <div><label>Message</label><textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} required minLength={5} /></div>
            {error && <p className="error-text">{error}</p>}
            <button className="btn" disabled={loading}>{loading ? 'Sending...' : 'Send feedback'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
