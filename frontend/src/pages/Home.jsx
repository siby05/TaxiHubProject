import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="container">
      <div className="hero">
        <div className="eyebrow">New Plymouth · expanding across NZ</div>
        <h1>A private taxi service you can actually see coming.</h1>
        <p className="tagline">
          Scan the QR code on a driver's car, or book from the app - either way you get an upfront fare, a real
          admin-approved driver, and live updates from request to drop-off. No guessing, no surge pricing.
        </p>

        <ul className="feature-list">
          <li>✅ See your fare before you confirm</li>
          <li>✅ Book a specific driver directly, or let us match one</li>
          <li>✅ Cash or online payment, your choice</li>
          <li>✅ Every driver is licensed and admin-approved</li>
        </ul>

        <div className="cta-row">
          <Link className="btn" to="/register">Book a ride - sign up</Link>
          <Link className="btn secondary" to="/driver-signup">Drive with us</Link>
          <Link className="btn secondary" to="/login">Log in</Link>
        </div>

        <div className="grid cols-2" style={{ marginTop: 32, textAlign: 'left' }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>For passengers</h3>
            <p className="muted">
              Create a free account, then book a ride from the app or by scanning a driver's QR code. Pay by cash or
              card, rate your trip, and raise a complaint in-app if anything goes wrong - every complaint is tracked
              through to resolution.
            </p>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>For drivers</h3>
            <p className="muted">
              Apply with your license, Transport Service Licence, vehicle CoF and registration - an admin reviews and
              approves your account before you go live. Set your own rate, your own weekly schedule, and get notified
              the moment a trip comes in.
            </p>
          </div>
        </div>

        <p className="muted" style={{ marginTop: 24 }}>
          Want the full story? Read <Link to="/about">About TaxiHub</Link>, or check our <Link to="/terms">Terms &amp; Conditions</Link>.
        </p>
      </div>
    </div>
  );
}
