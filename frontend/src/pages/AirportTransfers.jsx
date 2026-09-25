import { Link } from 'react-router-dom';
import { AIRPORT_FAQ } from '../seo/site';

// Landing page for "New Plymouth airport taxi"-type searches. The FAQ text
// comes from seo/site.js so the visible answers and the FAQPage structured
// data can never disagree (Google requires them to match).
const DESTINATIONS = ['New Plymouth Airport (NPL)', 'Bell Block', 'Waitara', 'Inglewood', 'Ōakura', 'Stratford', 'Hāwera', 'Whanganui'];

export default function AirportTransfers() {
  return (
    <div className="container" style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="hero" style={{ maxWidth: '100%' }}>
        <div className="eyebrow">Airport &amp; long-distance</div>
        <h1>New Plymouth Airport transfers</h1>
        <p className="tagline">
          Pre-book a local driver to or from New Plymouth Airport (NPL). You see the fare upfront, your driver is
          confirmed before the day, and you can pay by card or cash.
        </p>
        <div className="cta-row">
          <Link className="btn" to="/register">Pre-book your airport ride</Link>
          <Link className="btn secondary" to="/login">Log in</Link>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 24 }}>
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>How airport booking works</h2>
          <ol className="muted" style={{ marginTop: 0, paddingLeft: 20 }}>
            <li>Enter your pickup address and New Plymouth Airport as the drop-off (or the other way round).</li>
            <li>Choose <strong>Schedule for later</strong> and pick a time at least 12 hours from now.</li>
            <li>Check the upfront fare and confirm. There's no surge pricing.</li>
            <li>Your driver is confirmed ahead of time, and you get live updates on the day.</li>
          </ol>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>Where we drive</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Anywhere in New Plymouth, plus long-distance trips across Taranaki and beyond, with stops along the way if
            you need them:
          </p>
          <ul className="muted" style={{ columns: 2, marginTop: 0, paddingLeft: 20 }}>
            {DESTINATIONS.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>Airport transfer questions</h2>
        {AIRPORT_FAQ.map(({ q, a }) => (
          <details key={q} style={{ borderTop: '1px solid var(--border)', padding: '12px 0' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{q}</summary>
            <p className="muted" style={{ marginBottom: 0 }}>{a}</p>
          </details>
        ))}
      </div>

      <p className="muted" style={{ textAlign: 'center' }}>
        Heading further? See <Link to="/new-plymouth-to-auckland">New Plymouth to Auckland</Link> transfers. Need a ride right now instead? <Link to="/register">Book a private ride in New Plymouth</Link>. Read more{' '}
        <Link to="/about">about EasyRide</Link>.
      </p>
    </div>
  );
}
