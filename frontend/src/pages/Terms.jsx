import TermsContent from '../components/TermsContent';

export default function Terms() {
  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1>Terms &amp; Conditions</h1>
        <p className="muted">For drivers operating on TaxiHub. Last reviewed September 2026.</p>
        <TermsContent />
      </div>
    </div>
  );
}
