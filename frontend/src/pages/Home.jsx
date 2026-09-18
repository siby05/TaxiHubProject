import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div>
      <div className="hero-band">
        <div className="hero-band-inner">
          <span className="eyebrow-pill">New Plymouth · expanding across NZ</span>
          <h1>A private taxi you can <span className="accent-word">actually see coming</span>.</h1>
          <p className="tagline">
            Scan the QR code on a driver's car, or book from the app - either way you get an upfront fare, a real
            admin-approved driver, and live updates from request to drop-off. No guessing, no surge pricing.
          </p>
          <div className="cta-row">
            <Link className="btn hero-primary" to="/register">Book a ride - sign up</Link>
            <Link className="btn hero-secondary" to="/driver-signup">Drive with us</Link>
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

      <div className="home-section alt">
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
              <Link className="btn secondary" to="/driver-signup">Apply to drive</Link>
            </div>
          </div>
          <p className="muted" style={{ textAlign: 'center', marginTop: 28 }}>
            Want the full story? Read <Link to="/about">About EasyRide</Link>, or check our <Link to="/terms">Terms &amp; Conditions</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
