// Shared with both the standalone /terms page and the driver signup popup.
// Content is a plain-language summary of NZTA Waka Kotahi Small Passenger
// Service (SPSV) rules as researched from nzta.govt.nz - not verified legal
// advice. Drivers should confirm current requirements directly with NZTA.
export default function TermsContent() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section>
        <h3>1. What TaxiHub is</h3>
        <p className="muted">
          TaxiHub is a booking platform that connects passengers with independent drivers. It is not a transport
          operator, does not employ drivers, and does not itself hold a Transport Service Licence for any vehicle.
          Each driver operates under their own licences and is solely responsible for complying with all applicable
          New Zealand transport law.
        </p>
      </section>

      <section>
        <h3>2. Driver legal requirements (NZTA Small Passenger Service)</h3>
        <p className="muted">To carry paying passengers in New Zealand, a driver must hold, and keep current:</p>
        <ul className="muted" style={{ marginTop: 0 }}>
          <li>A full NZ Class 1 driver licence with a valid <strong>passenger (P) endorsement</strong> (requires the licence held 2+ years, a medical check, and an NZTA "fit and proper person" police vet).</li>
          <li>A <strong>Transport Service Licence (TSL)</strong> covering the vehicle used.</li>
          <li>A current vehicle <strong>Certificate of Fitness (CoF)</strong> - small passenger service vehicles need a CoF, not just a standard WoF.</li>
          <li>Current vehicle registration (rego).</li>
        </ul>
        <p className="muted">
          Some regions require an approved in-vehicle security camera for certain service categories, unless the
          service only carries registered, pre-booked passengers. Since every TaxiHub trip requires a signed-in
          passenger account, drivers here operate under the <strong>Private Hire</strong> category by default (no
          camera required) - but you're responsible for confirming your own region's current rules with NZTA before
          driving.
        </p>
        <p className="muted">
          This is a plain-language summary, not legal advice. Always check{' '}
          <a href="https://www.nzta.govt.nz/commercial-driving/transport-service-licences/small-passenger-service" target="_blank" rel="noreferrer">nzta.govt.nz</a>{' '}
          for current requirements.
        </p>
      </section>

      <section>
        <h3>3. Documents &amp; approval</h3>
        <p className="muted">
          You'll be asked to upload your driver licence, TSL, vehicle CoF and registration. An admin reviews these
          before your account is approved - you won't receive trip requests or be able to go online until then.
          Submitting false, altered or expired documents may result in suspension.
        </p>
      </section>

      <section>
        <h3>4. Fees</h3>
        <p className="muted">
          A platform commission or access fee applies as configured by the admin, and is billed to you, not added to
          the passenger's fare. If your outstanding balance exceeds the configured limit, your account is
          automatically taken offline until it's settled.
        </p>
      </section>

      <section>
        <h3>5. Insurance &amp; tax</h3>
        <p className="muted">
          You are responsible for your own vehicle insurance (including confirming it covers paid passenger
          transport) and your own tax obligations, including GST registration if applicable.
        </p>
      </section>

      <section>
        <h3>6. Conduct &amp; complaints</h3>
        <p className="muted">
          Passenger complaints are handled through the in-app complaint system and may be escalated to NZTA or
          Police for serious incidents. TaxiHub is not liable for the conduct of any driver or passenger.
        </p>
      </section>
    </div>
  );
}
