import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useDriverSignupEnabled } from '../hooks/useDriverSignupEnabled';
import './home.css';

const FALLBACK_VEHICLE_TYPES = ['Economy', 'Comfort', 'Comfort Electric', 'Electric', 'Premium'];

// The mock status screen in the hero cycles through a real trip's states
// in step with the CSS route/car animation (9s loop in home.css).
const TRIP_STATES = [
  { at: 0, chip: 'pending', label: 'Finding your driver' },
  { at: 900, chip: 'blue', label: 'Driver accepted' },
  { at: 3200, chip: 'blue', label: 'Driver on the way' },
  { at: 5000, chip: 'ok', label: 'Trip completed' },
];

// Long-distance routes shown in the airport & long-distance section - both
// directions, since passengers also need getting back to Taranaki.
const INTERCITY_ROUTES = [
  {
    from: 'New Plymouth', to: 'Palmerston North', meta: 'About 230 km · around 3 hours',
    blurb: 'Down SH3 via Stratford, Hāwera and Whanganui - stop at any of them on the way.',
  },
  {
    from: 'New Plymouth', to: 'Auckland', meta: 'About 350 km · 4.5-5 hours', link: '/new-plymouth-to-auckland',
    blurb: 'Door to door, including Auckland Airport, with stops in Te Kūiti or Hamilton if you need them.',
  },
  {
    from: 'Palmerston North', to: 'New Plymouth', meta: 'About 230 km · around 3 hours',
    blurb: 'Heading home to Taranaki - or drop off in Whanganui, Hāwera or Stratford on the way.',
  },
  {
    from: 'Auckland', to: 'New Plymouth', meta: 'About 350 km · 4.5-5 hours',
    blurb: 'Pick-up from anywhere in Auckland, including the airport - or finish in Hamilton or Te Kūiti on the way.',
  },
];

const Icon = {
  check: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5" /></svg>,
  qr: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 14h3v3M21 14v3h-4M14 21h7" /></svg>,
  phone: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>,
  calendar: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  shield: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
  tag: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13 13 20a2 2 0 0 1-2.8 0L3 12.8V4h8.8L20 12.2a2 2 0 0 1 0 .8z" /><circle cx="7.5" cy="8.5" r="1.5" /></svg>,
  pin: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>,
  star: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z" /></svg>,
  user: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>,
  plane: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /></svg>,
  road: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21 9 3M20 21 15 3M12 5v2M12 11v2M12 17v2" /></svg>,
  clock: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  car: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11" /><rect x="3" y="11" width="18" height="7" rx="2" /><circle cx="7.5" cy="18" r="1.8" /><circle cx="16.5" cy="18" r="1.8" /></svg>,
};

function CarSide() {
  return (
    <svg viewBox="0 0 120 44" aria-hidden="true">
      <path d="M8 30c0-4 2-6 6-7l10-9c1.5-1.5 3-2 5-2h32c3 0 5 1 7 3l9 8h20c5 0 8 3 8 8v5H8z" fill="#38bdf8" />
      <path d="M28 21l8-7h14v7zM54 14h13c1.5 0 2.5.5 3.5 1.5l5.5 5.5H54z" fill="#0b2942" opacity="0.85" />
      <rect x="8" y="30" width="97" height="5" fill="#0ea5e9" />
      <circle className="hm-wheel" cx="28" cy="35" r="7" fill="#0b2942" stroke="#94a3b8" strokeWidth="2" />
      <circle className="hm-wheel" cx="84" cy="35" r="7" fill="#0b2942" stroke="#94a3b8" strokeWidth="2" />
      <path className="hm-wheel" d="M28 29v12M22 35h12" stroke="#cbd5e1" strokeWidth="1.5" />
      <path className="hm-wheel" d="M84 29v12M78 35h12" stroke="#cbd5e1" strokeWidth="1.5" />
      <rect x="101" y="23" width="5" height="3" rx="1" fill="#fef3c7" />
    </svg>
  );
}

// `active` is false while the hero is scrolled off screen: the car and the
// status cycle pause (the CSS pauses the rest), so nothing keeps redrawing
// or re-rendering where nobody can see it.
function TripCard({ active }) {
  const [state, setState] = useState(TRIP_STATES[0]);
  const mapRef = useRef(null);

  // The status chip follows the SMIL clock rather than its own timers, so
  // it stays in step with the car through pauses and background-tab
  // throttling. The car keeps driving even with reduced motion on (see
  // home.css) - it's small and slow, and on many phones battery saver
  // turns that setting on, which left the hero looking broken.
  useEffect(() => {
    const svg = mapRef.current;
    if (!svg?.getCurrentTime) return undefined;
    if (!active) {
      svg.pauseAnimations();
      return undefined;
    }
    svg.unpauseAnimations();
    const tick = () => {
      const t = (svg.getCurrentTime() * 1000) % 9000;
      setState(TRIP_STATES.reduce((cur, s) => (t >= s.at ? s : cur), TRIP_STATES[0]));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="hm-visual">
      <div className="hm-trip" aria-hidden="true">
        <div className="hm-trip-head">
          <span className="hm-id">TRIP-20260922-00042</span>
          <span className={`hm-chip ${state.chip === 'ok' ? '' : state.chip}`}>
            <span className="hm-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
            {state.label}
          </span>
        </div>
        <svg className="hm-map" viewBox="0 0 420 220" ref={mapRef}>
          <defs>
            <pattern id="hm-blocks" width="42" height="42" patternUnits="userSpaceOnUse">
              <rect x="4" y="4" width="34" height="34" rx="4" fill="rgba(255,255,255,0.035)" />
            </pattern>
          </defs>
          <rect width="420" height="220" fill="url(#hm-blocks)" />
          <path d="M0 60H420M0 140H420M120 0V220M300 0V220" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <path className="hm-route-bg" d="M46 178 C 110 150, 120 80, 200 92 S 330 130, 372 46" fill="none" strokeWidth="6" strokeLinecap="round" />
          <path id="hm-route-path" className="hm-route" d="M46 178 C 110 150, 120 80, 200 92 S 330 130, 372 46" fill="none" strokeWidth="4" strokeLinecap="round" />
          <circle cx="46" cy="178" r="7" fill="#0b2942" stroke="#38bdf8" strokeWidth="3" />
          <circle className="hm-pin-pulse" cx="372" cy="46" r="9" fill="none" stroke="#22c55e" strokeWidth="2" />
          <circle cx="372" cy="46" r="7" fill="#22c55e" stroke="#0b2942" strokeWidth="3" />
          {/* SMIL rather than CSS offset-path: motion paths on SVG elements
              are still unsupported in iOS Safari, which left the car stuck
              in the corner on iPhones; animateMotion works everywhere. */}
          <g className="hm-car">
            <rect x="-13" y="-7" width="26" height="14" rx="4" fill="#fff" />
            <rect x="-8" y="-4" width="9" height="8" rx="1.5" fill="#0b2942" opacity="0.8" />
            <rect x="9" y="-3" width="3" height="6" rx="1" fill="#fbbf24" />
            <animateMotion dur="9s" repeatCount="indefinite" rotate="auto" calcMode="spline"
              keyPoints="0;1;1;0" keyTimes="0;0.55;0.85;1" keySplines="0.42 0 0.58 1;0 0 1 1;0.42 0 0.58 1">
              <mpath href="#hm-route-path" />
            </animateMotion>
          </g>
        </svg>
        <div className="hm-trip-rows">
          <div className="hm-trip-row"><span>Pickup</span><strong>Devon St West</strong></div>
          <div className="hm-trip-row"><span>Drop-off</span><strong>New Plymouth Airport</strong></div>
          <div className="hm-trip-row"><span>Upfront fare</span><span className="hm-fare">$38.20</span></div>
        </div>
      </div>
      <div className="hm-toast" aria-hidden="true">
        <span className="hm-toast-icon"><Icon.car /></span>
        <span>Your driver has arrived<small>Silver BYD Atto 3 · ABC123</small></span>
      </div>
    </div>
  );
}

function EnquiryForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await client.post('/enquiry', form);
      setSent(true);
      setForm({ name: '', email: '', phone: '', message: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send your enquiry - please try again');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return <p className="muted" style={{ color: 'var(--success)' }}>Thanks - we've received your enquiry and will be in touch soon.</p>;
  }

  return (
    <form onSubmit={submit}>
      <div><label>Name</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
      <div><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required /></div>
      <div><label>Phone (optional)</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
      <div><label>Message</label><textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} required minLength={5} /></div>
      {error && <p className="error-text">{error}</p>}
      <button className="btn" disabled={loading}>{loading ? 'Sending...' : 'Send enquiry'}</button>
    </form>
  );
}

// "YYYY-MM-DD" (an NZ calendar date from the API) -> "Thu 8 Oct". Noon
// keeps it on the same day whatever the viewer's own timezone.
function dealDate(key) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
}

// "YYYY-MM-DD" -> { weekday: 'Thu', day: '15', month: 'Oct' } for the
// date tile on each return-trip opening.
function dealDateParts(key) {
  const d = new Date(`${key}T12:00:00`);
  const part = (opts) => d.toLocaleDateString('en-NZ', opts);
  return { weekday: part({ weekday: 'short' }), day: part({ day: 'numeric' }), month: part({ month: 'short' }) };
}

// ISO instant -> NZ clock time, e.g. "3:30 pm", rounded to a quarter hour
// on the side that still qualifies: up for "pickup from", down for
// "leaving by".
function dealTime(iso, roundDown = false) {
  const q = 15 * 60 * 1000;
  const t = new Date(Math[roundDown ? 'floor' : 'ceil'](new Date(iso).getTime() / q) * q);
  return t.toLocaleTimeString('en-NZ', { timeZone: 'Pacific/Auckland', hour: 'numeric', minute: '2-digit', hour12: true });
}

const DIRECTION_LABEL = {
  'np-akl': 'New Plymouth → Auckland',
  'akl-np': 'Auckland → New Plymouth',
  'np-pmr': 'New Plymouth → Palmerston North',
  'pmr-np': 'Palmerston North → New Plymouth',
};

// Admin-set discounts (see backend utils/discounts.js): the date-range
// promotion, and same-day Auckland / Palmerston North return trips - each open day links to
// the driver who already has the other leg, since booking with them is
// what earns the discount. Renders nothing when neither is on.
function Deals() {
  const [deals, setDeals] = useState(null);
  useEffect(() => {
    let cancelled = false;
    client.get('/booking/promotions').then((r) => { if (!cancelled) setDeals(r.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const { promo, returnTrip } = deals || {};
  if (!promo && !returnTrip) return null;

  return (
    <section className="hm-deals">
      <div className="container hm-deals-grid">
        {promo && (
          <div className="hm-deal">
            <div className="hm-deal-pct">{promo.percent}%<small>off</small></div>
            <div>
              <h3>{promo.active ? 'On now' : 'Coming up'}: {promo.percent}% off every ride</h3>
              <p>
                {promo.startDate === promo.endDate
                  ? <>For trips on {dealDate(promo.startDate)}.</>
                  : <>For trips from {dealDate(promo.startDate)} to {dealDate(promo.endDate)}.</>}
                {' '}Applied automatically - the discounted fare is what you see when you book.
              </p>
              <Link className="btn hm-deal-btn" to="/register">Book a ride</Link>
            </div>
          </div>
        )}
        {returnTrip && (
          <div className="hm-deal">
            <div className="hm-deal-pct">{returnTrip.percent}%<small>off</small></div>
            <div>
              <h3>Travelling between New Plymouth and Auckland or Palmerston North?</h3>
              <p>
                Our drivers are based in New Plymouth. When one is already heading to Auckland or Palmerston North, the trip
                back with them later that day is {returnTrip.percent}% off - and so is the trip there, for whoever books it.
              </p>
              {returnTrip.openings.length > 0 ? (
                <ul className="hm-deal-list">
                  {returnTrip.openings.map((o) => {
                    const d = dealDateParts(o.date);
                    return (
                      <li key={`${o.date}-${o.direction}`}>
                        <div className="hm-deal-date" aria-label={dealDate(o.date)}>
                          <span>{d.weekday}</span><strong>{d.day}</strong><span>{d.month}</span>
                        </div>
                        <div className="hm-deal-info">
                          <strong>{DIRECTION_LABEL[o.direction]}</strong>
                          <span className="hm-deal-time">
                            🕒 {o.after ? <>Pickup from <b>{dealTime(o.after)}</b></> : <>Pickup by <b>{dealTime(o.before, true)}</b></>}
                          </span>
                        </div>
                        <Link to={`/book/${o.driverId}`}>Book {returnTrip.percent}% off</Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="hm-deal-note">No return seats open right now - check back, new ones appear as trips are booked.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// Adds .is-in to every .hm-reveal element as it scrolls into view (the
// CSS does the actual fade/slide). Elements already on screen at mount
// get it immediately, so nothing is ever stuck invisible.
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.hm-reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('is-in')); return undefined; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}


function Testimonials() {
  const [items,setItems]=useState([]);
  useEffect(()=>{client.get('/feedback/testimonials').then((r)=>setItems(r.data||[])).catch(()=>{});},[]);
  if (!items.length) return null;
  return <section className="hm-section alt"><div className="container"><div className="hm-head"><div className="hm-kicker">Passenger experiences</div><h2>What our passengers say</h2></div><div className="hm-testimonials">{items.map((f,i)=><blockquote key={i}><div aria-label={`${f.rating} out of 5 stars`}>{'★'.repeat(Math.max(0,Math.min(5,f.rating)))}</div><p>“{f.message}”</p><strong>— {f.name}</strong></blockquote>)}</div></div></section>;
}
export default function Home() {
  const driverSignupEnabled = useDriverSignupEnabled();
  const [vehicleTypes, setVehicleTypes] = useState(FALLBACK_VEHICLE_TYPES);
  const heroRef = useRef(null);
  const [heroOnScreen, setHeroOnScreen] = useState(true);
  useReveal();

  useEffect(() => {
    let cancelled = false;
    client.get('/booking/vehicle-types')
      .then((r) => { if (!cancelled && r.data?.length) setVehicleTypes(r.data.map((t) => t.label)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Pause the hero's animations while it's scrolled out of view.
  useEffect(() => {
    if (!heroRef.current || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([entry]) => setHeroOnScreen(entry.isIntersecting));
    io.observe(heroRef.current);
    return () => io.disconnect();
  }, []);

  return (
    <div className="hm">
      <section className="hm-hero hm-approved">
        <div className="hm-hero-inner">
          <div className="hm-approved-copy">
            <span className="hm-approved-kicker">TAXI &amp; PRIVATE TRANSFERS</span>
            <h1>Your Local Ride<br/>in New Plymouth</h1>
            <p className="hm-tagline">Airport transfers, local trips and private transport — safe, comfortable and on time.</p>
            <div className="hm-approved-highlights"><span>✓ Safe &amp; reliable</span><span>◷ Flexible bookings</span><span>⌖ Local service</span></div>
            <Link className="btn hm-primary" to="/register">Get a Quote &amp; Book →</Link>
          </div>
          <div className="hm-approved-booking">
            <div className="hm-booking-tabs"><strong>🚕 Book a Ride</strong><Link to="/airport-transfers">✈ Airport Transfer</Link></div>
            <h2>Where can we take you?</h2>
            <p>Get an upfront fare estimate in our secure booking form.</p>
            <div className="hm-booking-fields"><div>⌖ Pickup location</div><div>⌖ Destination</div><div>▦ Date &amp; time</div></div>
            <Link className="btn hm-primary" to="/register">Get a Quote &amp; Book →</Link>
            <small>Secure booking · Subject to driver confirmation</small>
          </div>
        </div>
      </section>

      <Deals />
      <Testimonials />

      <section className="hm-section">
        <div className="container">
          <div className="hm-head hm-reveal">
            <div className="hm-kicker">How it works</div>
            <h2>Three ways to ride, one straightforward fare</h2>
            <p>No app-store hunt required - book straight from the browser, either with a specific driver or matched with whoever's nearest.</p>
          </div>
          <div className="hm-steps">
            <div className="hm-step hm-reveal" data-delay="1">
              <span className="hm-num">01</span>
              <div className="hm-icon"><Icon.qr /></div>
              <h3>Scan &amp; ride</h3>
              <p>See a driver's car with an EasyRide QR code on it? Scan it, confirm the fare, and that driver gets your request directly - like hailing a ride in person, with a paper trail.</p>
            </div>
            <div className="hm-step hm-reveal" data-delay="2">
              <span className="hm-num">02</span>
              <div className="hm-icon"><Icon.phone /></div>
              <h3>Book from the app</h3>
              <p>No driver in sight? Request a ride and we broadcast it to every available driver nearby - whoever accepts first is on their way, with live status the whole trip.</p>
            </div>
            <div className="hm-step hm-reveal" data-delay="3">
              <span className="hm-num">03</span>
              <div className="hm-icon"><Icon.calendar /></div>
              <h3>Schedule ahead</h3>
              <p>Pick a future date and time instead of "now" - useful for an early flight or a booking you don't want to think about again until the driver shows up.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="hm-section alt" id="airport-transfers">
        <div className="container">
          <div className="hm-head hm-reveal">
            <div className="hm-kicker">Airport &amp; long-distance</div>
            <h2>Airport drops and out-of-town trips, booked ahead</h2>
            <p>Catching a flight or heading out of town? Pre-book at least 12 hours ahead and we'll have a confirmed driver lined up for you - no waiting to see who's free on the day.</p>
          </div>
          <div className="hm-features">
            <div className="hm-feature hm-reveal">
              <div className="hm-icon"><Icon.plane /></div>
              <div>
                <h4>Airport drop-offs and pick-ups</h4>
                <p>To and from New Plymouth Airport (NPL). Book it around your flight time and your driver is confirmed well before you need to leave.</p>
              </div>
            </div>
            <div className="hm-feature hm-reveal" data-delay="1">
              <div className="hm-icon"><Icon.road /></div>
              <div>
                <h4>Long-distance trips</h4>
                <p>Stratford, Hāwera, Whanganui, Palmerston North, Wellington or <Link to="/new-plymouth-to-auckland">New Plymouth to Auckland</Link> - one upfront fare for the whole journey, with stops along the way if you need them.</p>
              </div>
            </div>
            <div className="hm-feature hm-reveal" data-delay="2">
              <div className="hm-icon"><Icon.clock /></div>
              <div>
                <h4>Book 12 hours ahead</h4>
                <p>Airport and long trips need at least 12 hours' notice so a driver can commit to your time. Just pick a date and time instead of "now" when you book.</p>
              </div>
            </div>
          </div>
          <h3 className="hm-ic-title hm-reveal">Popular intercity routes</h3>
          <div className="hm-ic-grid">
            {INTERCITY_ROUTES.map((r, i) => (
              <div key={`${r.from}-${r.to}`} className="hm-ic hm-reveal" data-delay={i % 4}>
                <div className="hm-ic-ends">
                  <span>{r.from}</span>
                  <span className="hm-ic-arrow" aria-label="to">→</span>
                  <span>{r.to}</span>
                </div>
                <div className="hm-ic-meta">{r.meta}</div>
                <p>{r.blurb}</p>
                {r.link && <Link to={r.link}>Route details</Link>}
              </div>
            ))}
          </div>
          <div className="hm-reveal" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 26 }}>
            <Link className="btn" to="/register">Pre-book your trip</Link>
            <Link className="btn secondary" to="/airport-transfers">Airport transfer details</Link>
          </div>
        </div>
      </section>

      <section className="hm-section">
        <div className="container">
          <div className="hm-head hm-reveal">
            <div className="hm-kicker">Why EasyRide</div>
            <h2>Built around trust, not guesswork</h2>
          </div>
          <div className="hm-features">
            <div className="hm-feature hm-reveal">
              <div className="hm-icon"><Icon.shield /></div>
              <div>
                <h4>Every driver vetted before they go live</h4>
                <p>License, Transport Service Licence, vehicle CoF and registration are checked by an admin before a driver can accept a single trip.</p>
              </div>
            </div>
            <div className="hm-feature hm-reveal" data-delay="1">
              <div className="hm-icon"><Icon.tag /></div>
              <div>
                <h4>See the fare before you confirm</h4>
                <p>Base fare plus distance, shown up front. No surge pricing, no surprise multiplier when demand spikes.</p>
              </div>
            </div>
            <div className="hm-feature hm-reveal" data-delay="2">
              <div className="hm-icon"><Icon.pin /></div>
              <div>
                <h4>Live status, request to drop-off</h4>
                <p>Know the moment a driver accepts, arrives at pickup, and completes the trip - not just a spinner.</p>
              </div>
            </div>
            <div className="hm-feature hm-reveal" data-delay="3">
              <div className="hm-icon"><Icon.star /></div>
              <div>
                <h4>Real ratings, both ways</h4>
                <p>Passengers rate drivers and drivers rate passengers after every trip, building a track record that's actually earned.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="hm-section alt">
        <div className="container">
          <div className="hm-fleet hm-reveal">
            <div className="hm-fleet-img">
              <img src="/images/byd-atto3.png" alt="BYD Atto 3 electric SUV" loading="lazy" />
            </div>
            <div>
              <div className="hm-kicker" style={{ color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', fontSize: '0.76rem', letterSpacing: '0.08em' }}>The fleet</div>
              <h2>Pick the car that fits the trip</h2>
              <p>Every driver's vehicle is classed when they're approved, so you can ask for exactly what you need - from a budget-friendly Economy car to a quiet EV or an executive Premium ride - and see the driver's car and plate before it arrives.</p>
              <div className="hm-types">
                {vehicleTypes.map((t) => <span key={t}>{t}</span>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="hm-section">
        <div className="container">
          <div className="hm-pricing hm-reveal">
            <div>
              <h2>Pricing you can actually predict</h2>
              <p>Every fare is a small base fare plus a per-kilometre rate - and never below the platform's minimum fare, however short the trip. Paying by card adds a small, disclosed payment-gateway surcharge; cash never does.</p>
              <p>What you're quoted is what you pay. Platform fees are billed to the driver separately and never added to your fare.</p>
            </div>
            <ul>
              <li><Icon.check /><span><strong>Upfront:</strong> the fare is confirmed before you request the ride.</span></li>
              <li><Icon.check /><span><strong>No surge:</strong> the same pricing whether it's Tuesday morning or Friday night.</span></li>
              <li><Icon.check /><span><strong>Your call:</strong> pay cash to the driver or card in the app.</span></li>
            </ul>
          </div>
        </div>
      </section>

      <section className="hm-section alt">
        <div className="container">
          <div className="hm-head hm-reveal">
            <div className="hm-kicker">Get started</div>
            <h2>{driverSignupEnabled ? 'Ride, or drive - pick a side' : 'Ready when you are'}</h2>
          </div>
          <div className="hm-roles" style={driverSignupEnabled ? undefined : { maxWidth: 560, margin: '0 auto' }}>
            <div className="hm-role hm-reveal" data-delay="1">
              <div className="hm-icon"><Icon.user /></div>
              <h3>For passengers</h3>
              <p>
                Create a free account, then book a ride from the app or by scanning a driver's QR code. Pay by cash or
                card, rate your trip, and raise a complaint in-app if anything goes wrong - every complaint is tracked
                through to resolution.
              </p>
              <Link className="btn" to="/register">Sign up as a passenger</Link>
            </div>
            {driverSignupEnabled && (
            <div className="hm-role hm-reveal is-in" data-delay="2">
              <div className="hm-icon"><Icon.car /></div>
              <h3>For drivers</h3>
              <p>
                Apply with your license, Transport Service Licence, vehicle CoF and registration - an admin reviews and
                approves your account before you go live. Set your own rate, your own weekly schedule, and get notified
                the moment a trip comes in.
              </p>
              <Link className="btn secondary" to="/driver-signup">Apply to drive</Link>
            </div>
            )}
          </div>
          <p className="muted" style={{ textAlign: 'center', marginTop: 28 }}>
            Want the full story? Read <Link to="/about">About EasyRide</Link>, see <Link to="/airport-transfers">New Plymouth Airport transfers</Link> and <Link to="/new-plymouth-to-auckland">New Plymouth to Auckland trips</Link>, or check our <Link to="/terms">Terms &amp; Conditions</Link>.
          </p>
        </div>
      </section>

      <section className="hm-section">
        <div className="container">
          <div className="hm-head hm-reveal">
            <div className="hm-kicker">Get in touch</div>
            <h2>Have a question? Send us an enquiry</h2>
            <p>Whether it's about booking, becoming a driver, or bringing EasyRide to another town - we read every message.</p>
          </div>
          <div className="card hm-reveal" style={{ maxWidth: 480, margin: '0 auto' }}>
            <EnquiryForm />
          </div>
        </div>
      </section>

      <footer className="hm-footer">
        <p>© 2026 EasyRide NZ</p>
        <p><a href="mailto:easyridenz@gmail.com">easyridenz@gmail.com</a> · New Plymouth, New Zealand</p>
      </footer>
    </div>
  );
}
