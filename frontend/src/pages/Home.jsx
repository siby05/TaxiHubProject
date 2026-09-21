import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';

const HERO_IMAGE = 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?auto=format&fit=crop&w=1800&q=80';
const SHOWCASE_IMAGES = [
  {
    src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/BYD_Atto_3_front-left.jpg/960px-BYD_Atto_3_front-left.jpg',
    alt: 'BYD Atto 3 electric SUV',
    // CC BY 4.0 requires attribution, unlike the Unsplash photos below - see
    // https://commons.wikimedia.org/wiki/File:BYD_Atto_3_front-left.jpg
    credit: { text: 'Photo: Hubert Berberich / Wikimedia Commons (CC BY 4.0)', href: 'https://commons.wikimedia.org/wiki/File:BYD_Atto_3_front-left.jpg' },
  },
  { src: 'https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=900&q=80', alt: 'Driver behind the wheel on a trip' },
  { src: 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=900&q=80', alt: 'Open road heading toward the coast' },
];

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

export default function Home() {
  const [driverSignupEnabled, setDriverSignupEnabled] = useState(true);

  useEffect(() => {
    client.get('/driver-signup/enabled').then((r) => setDriverSignupEnabled(r.data.enabled)).catch(() => {});
  }, []);

  return (
    <div>
      <div className="hero-band" style={{ backgroundImage: `linear-gradient(rgba(7,26,44,0.82), rgba(7,26,44,0.92)), url(${HERO_IMAGE})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="hero-band-inner">
          <span className="eyebrow-pill">New Plymouth</span>
          <h1>A private taxi you can <span className="accent-word">actually see coming</span>.</h1>
          <p className="tagline">
            Scan the QR code on a driver's car, or book from the app - either way you get an upfront fare, a real
            admin-approved driver, and live updates from request to drop-off. No guessing, no surge pricing.
          </p>
          <div className="cta-row">
            <Link className="btn hero-primary" to="/register">Book a ride - sign up</Link>
            {driverSignupEnabled && <Link className="btn hero-secondary" to="/driver-signup">Drive with us</Link>}
          </div>
          <div className="trust-strip">
            <span>✅ Admin-approved drivers</span>
            <span>✅ NZTA compliant</span>
            <span>✅ Upfront fares</span>
            <span>✅ Cash or card</span>
          </div>
        </div>
      </div>

      <div className="home-section">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">How it works</div>
            <h2>Three ways to ride, one straightforward fare</h2>
            <p>No app-store hunt required - book straight from the browser, either as a specific driver or matched with whoever's nearest.</p>
          </div>
          <div className="step-grid">
            <div className="step-card">
              <div className="step-icon">📷</div>
              <h3>Scan &amp; ride</h3>
              <p>See a driver's car with an EasyRide QR code on it? Scan it, confirm the fare, and that driver gets your request directly - like flagging a cab, with a paper trail.</p>
            </div>
            <div className="step-card">
              <div className="step-icon">📲</div>
              <h3>Book from the app</h3>
              <p>No driver in sight? Request a ride and we broadcast it to every available driver nearby - whoever accepts first is on their way, with live status the whole trip.</p>
            </div>
            <div className="step-card">
              <div className="step-icon">🗓️</div>
              <h3>Schedule ahead</h3>
              <p>Pick a future date and time instead of "now" - useful for an early flight or a booking you don't want to think about again until the driver shows up.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="home-section alt">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Why EasyRide</div>
            <h2>Built around trust, not guesswork</h2>
          </div>
          <div className="trust-grid">
            <div className="trust-item">
              <div className="trust-icon">🪪</div>
              <div>
                <h4>Every driver vetted before they go live</h4>
                <p>License, Transport Service Licence, vehicle CoF and registration are checked by an admin before a driver can accept a single trip.</p>
              </div>
            </div>
            <div className="trust-item">
              <div className="trust-icon">💵</div>
              <div>
                <h4>See the fare before you confirm</h4>
                <p>Base fare plus distance, shown up front. No surge pricing, no surprise multiplier when demand spikes.</p>
              </div>
            </div>
            <div className="trust-item">
              <div className="trust-icon">📍</div>
              <div>
                <h4>Live status, request to drop-off</h4>
                <p>Know the moment a driver accepts, arrives at pickup, and completes the trip - not just a spinner.</p>
              </div>
            </div>
            <div className="trust-item">
              <div className="trust-icon">⭐</div>
              <div>
                <h4>Real ratings, both ways</h4>
                <p>Passengers rate drivers and drivers rate passengers after every trip, building a track record that's actually earned.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="home-section">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">On the road</div>
            <h2>Real drivers, real trips, right around New Plymouth</h2>
          </div>
          <div className="photo-grid">
            {SHOWCASE_IMAGES.map((img) => (
              <div className="photo-grid-item" key={img.src}>
                <img src={img.src} alt={img.alt} loading="lazy" />
                {img.credit && <a className="photo-credit" href={img.credit.href} target="_blank" rel="noreferrer">{img.credit.text}</a>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="home-section alt">
        <div className="container">
          <div className="pricing-card">
            <div>
              <h2>Pricing you can actually predict</h2>
              <p>Every fare is a small base fare plus a per-kilometre rate - and never below the platform's minimum fare, however short the trip. Paying by card adds a small, disclosed payment-gateway surcharge; cash never does.</p>
              <p>What you're quoted is what you pay. Platform fees are billed to the driver separately and never added to your fare.</p>
            </div>
            <ul>
              <li><strong>Upfront:</strong> the fare is confirmed before you request the ride.</li>
              <li><strong>No surge:</strong> the same pricing whether it's Tuesday morning or Friday night.</li>
              <li><strong>Your call:</strong> pay cash to the driver or card in the app.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="home-section">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Get started</div>
            <h2>Ride, or drive - pick a side</h2>
          </div>
          <div className="role-cards">
            <div className="role-card">
              <div className="step-icon">🧍</div>
              <h3>For passengers</h3>
              <p>
                Create a free account, then book a ride from the app or by scanning a driver's QR code. Pay by cash or
                card, rate your trip, and raise a complaint in-app if anything goes wrong - every complaint is tracked
                through to resolution.
              </p>
              <Link className="btn" to="/register">Sign up as a passenger</Link>
            </div>
            <div className="role-card">
              <div className="step-icon">🚘</div>
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
      </div>

      <div className="home-section alt">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Get in touch</div>
            <h2>Have a question? Send us an enquiry</h2>
            <p>Whether it's about booking, becoming a driver, or bringing EasyRide to another town - we read every message.</p>
          </div>
          <div className="card" style={{ maxWidth: 480, margin: '0 auto' }}>
            <EnquiryForm />
          </div>
        </div>
      </div>

      <footer className="home-footer">
        <p>© 2026 Easy Ride NZ</p>
        <p><a href="mailto:easyride@gmail.com">easyride@gmail.com</a> · New Plymouth, New Zealand</p>
      </footer>
    </div>
  );
}
