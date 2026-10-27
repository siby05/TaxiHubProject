import { Link } from 'react-router-dom';
import { AUCKLAND_RETURN_FAQ, PALMERSTON_FAQ } from '../seo/site';

// Two real route pages for specific travel needs, rather than duplicate
// keyword-stuffed doorway pages. Every booking remains subject to a driver.
const CONTENT = {
  auckland: {
    eyebrow: 'Auckland Airport & city pickups',
    title: 'Auckland to New Plymouth private transfers',
    intro: 'Need to get from Auckland to Taranaki without changing buses or hiring a car? Request a private door-to-door ride from Auckland Airport, the CBD or a suburban address to New Plymouth. See an estimated fare before you submit your booking request.',
    tipsTitle: 'Planning your Auckland pickup',
    tips: [
      ['Airport arrivals', 'Provide a practical pickup time after landing, luggage collection and immigration where relevant. Agree on the pickup point with your driver.'],
      ['Travel time', 'Allow roughly 4.5–5.5 hours for the journey, depending on your pickup point, Auckland traffic, weather and any stops.'],
      ['Luggage and passengers', 'Tell the driver about larger luggage or special requirements before confirming so the vehicle is suitable.'],
    ],
    routeTitle: 'Common pickup locations',
    routeText: 'You can request pickup at Auckland Airport, Auckland CBD or another address in the Auckland region. The exact route, available vehicle and fare depend on your chosen addresses.',
    relatedPath: '/new-plymouth-to-auckland', relatedName: 'New Plymouth to Auckland',
    faq: AUCKLAND_RETURN_FAQ,
  },
  palmerston: {
    eyebrow: 'Taranaki & Manawatū travel',
    title: 'New Plymouth to Palmerston North private transfers',
    intro: 'Travel between New Plymouth and Palmerston North with a pre-arranged private driver. Whether you are visiting family, attending an appointment or travelling for work, you can request a pickup at your address and an arrival point that suits your plans.',
    tipsTitle: 'Making the most of the trip',
    tips: [
      ['Choose the right time', 'Allow enough time for traffic and weather. For time-sensitive appointments, ask your driver about a suitable departure time.'],
      ['Stops along the way', 'Discuss optional stops in towns such as Hāwera or Whanganui while arranging the transfer.'],
      ['Return transfers', 'Need to come back to New Plymouth? Request a separate return journey and check any configured discount before you submit.'],
    ],
    routeTitle: 'Door-to-door travel between cities',
    routeText: 'Select a pickup point in New Plymouth and a destination in Palmerston North. EasyRide displays an estimated fare, subject to a driver accepting the booking.',
    relatedPath: '/airport-transfers', relatedName: 'New Plymouth Airport transfers',
    faq: PALMERSTON_FAQ,
  },
};

export default function TransferRoutes({ route }) {
  const info = CONTENT[route];
  if (!info) return null;
  return <div className="container" style={{ maxWidth: 960, margin: '0 auto' }}>
    <div className="hero" style={{ maxWidth: '100%' }}>
      <div className="eyebrow">{info.eyebrow}</div>
      <h1>{info.title}</h1>
      <p className="tagline">{info.intro}</p>
      <div className="cta-row"><Link className="btn" to="/">Get a fare estimate</Link><Link className="btn secondary" to="/register">Request a transfer</Link></div>
    </div>
    <section className="grid cols-2" style={{ marginTop: 24 }}>
      <div className="card">
        <h2 style={{ fontSize: '1.2rem', marginTop: 0 }}>{info.tipsTitle}</h2>
        {info.tips.map(([h,p]) => <div key={h}><h3 style={{ fontSize: '1rem' }}>{h}</h3><p className="muted">{p}</p></div>)}
      </div>
      <div className="card">
        <h2 style={{ fontSize: '1.2rem', marginTop: 0 }}>{info.routeTitle}</h2>
        <p className="muted">{info.routeText}</p>
        <p className="muted">Fares and discounts are calculated during the quote process. The displayed fare is an estimate until the booking is accepted; driver availability is not guaranteed.</p>
        <p className="muted">See also <Link to={info.relatedPath}>{info.relatedName}</Link> and <Link to="/about">About EasyRide</Link>.</p>
      </div>
    </section>
    <section className="card" style={{ marginTop: 22 }}>
      <h2 style={{ marginTop: 0, fontSize: '1.25rem' }}>Frequently asked questions</h2>
      {info.faq.map(({q,a}) => <details key={q} style={{ borderTop: '1px solid var(--border)', padding: '12px 0' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{q}</summary><p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>{a}</p>
      </details>)}
    </section>
    <p style={{ textAlign: 'center', margin: '28px 0' }}>Ready to travel? <Link to="/">Enter your pickup and destination to estimate your fare</Link>.</p>
  </div>;
}
