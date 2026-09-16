// Rendered off-screen at all times; only made visible by the @media print
// rules in index.css when window.print() is triggered, sized for A6 paper.
export default function PrintableQrCard({ qrCodeImage, driverName, vehicleLabel }) {
  return (
    <div className="printable-qr-card">
      <h2 style={{ margin: 0 }}>Scan me to book a ride</h2>
      {qrCodeImage && <img src={qrCodeImage} alt="Booking QR code" style={{ width: '65mm', height: '65mm' }} />}
      <div>
        <strong>{driverName}</strong>
        {vehicleLabel && <div>{vehicleLabel}</div>}
      </div>
      <p style={{ fontSize: '0.75rem', color: '#666' }}>TaxiHub</p>
    </div>
  );
}
