import Logo from './Logo';

// Rendered off-screen at all times; only made visible by the @media print
// rules in index.css when window.print() is triggered, sized for A6 paper.
// Deliberately shows the vehicle number rather than the driver's name - the
// card stays valid if the vehicle changes hands, and a passenger checking
// they're getting into the right car reads the plate, not a name.
export default function PrintableQrCard({ qrCodeImage, vehicleNumber, vehicleType }) {
  return (
    <div className="printable-qr-card">
      <Logo size={40} tagline gap={8} />
      <h2 style={{ margin: 0 }}>Scan me to book a ride</h2>
      {qrCodeImage && <img src={qrCodeImage} alt="Booking QR code" style={{ width: '62mm', height: '62mm' }} />}
      {vehicleNumber && (
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '0.08em' }}>{vehicleNumber}</div>
          {vehicleType && <div style={{ fontSize: '0.85rem', color: '#666' }}>{vehicleType}</div>}
        </div>
      )}
    </div>
  );
}
