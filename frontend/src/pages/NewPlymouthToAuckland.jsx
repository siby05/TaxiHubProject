import { Link } from 'react-router-dom';
import { AUCKLAND_FAQ } from '../seo/site';

// Landing page for "New Plymouth to Auckland" searches. FAQ text comes from
// seo/site.js so the visible answers and the FAQPage structured data always
// match (Google requires them to).
const STOPS = ['Waitara', 'Urenui', 'Mōkau', 'Piopio', 'Te Kūiti', 'Ōtorohanga', 'Hamilton', 'Auckland Airport (AKL)', 'Auckland CBD'];

export default function NewPlymouthToAuckland() {
  return (
    <div className="container" style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="hero" style={{ maxWidth: '100%' }}>
        <div className="eyebrow">Long-distance private transfer</div>
        <h1>New Plymouth to Auckland by private taxi</h1>
        <p className="tagline">
          Door-to-door from your New Plymouth address to anywhere in Auckland, or straight to Auckland Airport. You get
          one fixed fare upfront, a vetted local driver confirmed ahead of time, and no bus or connecting flight to catch.
        </p>
        <div className="cta-row">
          <Link className="btn" to="/register">Pre-book New Plymouth to Auckland</Link>
          <Link className="btn secondary" to="/login">Log in</Link>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 24 }}>
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>The trip at a glance</h2>
          <ul className="muted" style={{ marginTop: 0, paddingLeft: 20 }}>
            <li><strong>Distance:</strong> about 350-360 km via State Highway 3</li>
            <li><strong>Travel time:</strong> around 4.5-5 hours, plus any stops you ask for</li>
            <li><strong>Price:</strong> a fixed upfront fare for the whole trip, shown before you book</li>
            <li><strong>Booking:</strong> at least 12 hours ahead, so a driver can commit to your time</li>
            <li><strong>Payment:</strong> card online or cash to the driver</li>
          </ul>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>Stops along the way</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Add stops when you book, and they're included in your fare. Common ones:
          </p>
          <ul className="muted" style={{ columns: 2, marginTop: 0, paddingLeft: 20 }}>
            {STOPS.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>Why travel with Easy Ride</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Easy Ride is a private taxi service based in New Plymouth. Every driver holds NZTA passenger licensing and is
          checked by us before they can take a trip. For a long run like New Plymouth to Auckland, that means one
          driver, one car and one agreed price, from your door to theirs. It suits early flights out of Auckland
          Airport, hospital appointments, family visits, or moving between cities with luggage.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>New Plymouth to Auckland questions</h2>
        {AUCKLAND_FAQ.map(({ q, a }) => (
          <details key={q} style={{ borderTop: '1px solid var(--border)', padding: '12px 0' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{q}</summary>
            <p className="muted" style={{ marginBottom: 0 }}>{a}</p>
          </details>
        ))}
      </div>

      <p className="muted" style={{ textAlign: 'center' }}>
        Flying from New Plymouth instead? See <Link to="/airport-transfers">New Plymouth Airport transfers</Link>. Just
        need a ride around town? <Link to="/">Book a private taxi in New Plymouth</Link>.
      </p>
    </div>
  );
}
