import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
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

function TripCard() {
  const [state, setState] = useState(TRIP_STATES[0]);
  const mapRef = useRef(null);

  // SMIL ignores prefers-reduced-motion, so park the car at the
  // destination ourselves, matching what the CSS does for everything else.
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && mapRef.current) {
      mapRef.current.pauseAnimations();
      mapRef.current.setCurrentTime(5);
    }
  }, []);

  useEffect(() => {
    let timers = [];
    function run() {
      timers = TRIP_STATES.map((s) => setTimeout(() => setState(s), s.at));
    }
    run();
    const loop = setInterval(run, 9000);
    return () => { clearInterval(loop); timers.forEach(clearTimeout); };
  }, []);

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

export default function Home() {
  const [driverSignupEnabled, setDriverSignupEnabled] = useState(true);
  const [vehicleTypes, setVehicleTypes] = useState(FALLBACK_VEHICLE_TYPES);
  useReveal();

  useEffect(() => {
    client.get('/driver-signup/enabled').then((r) => setDriverSignupEnabled(r.data.enabled)).catch(() => {});
    client.get('/booking/vehicle-types').then((r) => { if (r.data?.length) setVehicleTypes(r.data.map((t) => t.label)); }).catch(() => {});
  }, []);

  return (
    <div className="hm">
      <section className="hm-hero">
        <div className="hm-aurora" aria-hidden="true"><span /><span /><span /></div>
        <div className="hm-grid" aria-hidden="true" />
        <div className="hm-hero-inner">
          <div>
            <span className="hm-eyebrow"><span className="hm-dot" />Now driving in New Plymouth</span>
            <h1>A private taxi you can <span className="hm-grad">actually see coming</span>.</h1>
            <p className="hm-tagline">
              Scan the QR code on a driver's car, or book from the app - either way you get an upfront fare, a real
              admin-approved driver, and live updates from request to drop-off. No guessing, no surge pricing.
            </p>
            <div className="hm-cta">
              <Link className="btn hm-primary" to="/register">Book a ride</Link>
              {driverSignupEnabled && <Link className="btn hm-ghost" to="/driver-signup">Drive with us</Link>}
            </div>
            <div className="hm-trust">
              <span><Icon.check /> Admin-approved drivers</span>
              <span><Icon.check /> NZTA compliant</span>
              <span><Icon.check /> Upfront fares</span>
              <span><Icon.check /> Cash or card</span>
            </div>
          </div>
          <TripCard />
          <div className="hm-trust hm-trust-mobile">
            <span><Icon.check /> Admin-approved drivers</span>
            <span><Icon.check /> NZTA compliant</span>
            <span><Icon.check /> Upfront fares</span>
            <span><Icon.check /> Cash or card</span>
          </div>
        </div>
        <div className="hm-road" aria-hidden="true"><CarSide /></div>
      </section>

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
              <p>See a driver's car with an EasyRide QR code on it? Scan it, confirm the fare, and that driver gets your request directly - like flagging a cab, with a paper trail.</p>
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

      <section className="hm-section alt">
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

      <section className="hm-section">
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

      <section className="hm-section alt">
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

      <section className="hm-section">
        <div className="container">
          <div className="hm-head hm-reveal">
            <div className="hm-kicker">Get started</div>
            <h2>Ride, or drive - pick a side</h2>
          </div>
          <div className="hm-roles">
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
            <div className="hm-role hm-reveal" data-delay="2">
              <div className="hm-icon"><Icon.car /></div>
              <h3>For drivers</h3>
              <p>
                Apply with your license, Transport Service Licence, vehicle CoF and registration - an admin reviews and
                approves your account before you go live. Set your own rate, your own weekly schedule, and get notified
                the moment a trip comes in.
              </p>
              {driverSignupEnabled
                ? <Link className="btn secondary" to="/driver-signup">Apply to drive</Link>
                : <p className="muted">We're not accepting new driver applications right now.</p>}
            </div>
          </div>
          <p className="muted" style={{ textAlign: 'center', marginTop: 28 }}>
            Want the full story? Read <Link to="/about">About EasyRide</Link>, or check our <Link to="/terms">Terms &amp; Conditions</Link>.
          </p>
        </div>
      </section>

      <section className="hm-section alt">
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
        <p>© 2026 Easy Ride NZ</p>
        <p><a href="mailto:easyridenz@gmail.com">easyridenz@gmail.com</a> · New Plymouth, New Zealand</p>
      </footer>
    </div>
  );
}
