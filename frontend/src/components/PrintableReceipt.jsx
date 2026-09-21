import Logo from './Logo';
import { formatNzDateTime } from '../utils/nzTime';

// Rendered off-screen at all times; only made visible by the @media print
// rules in index.css when window.print() is triggered (see
// pages/passenger/PassengerDashboard.jsx's "Print receipt" button), sized
// for regular paper (A4/Letter) rather than the A6 QR card.
export default function PrintableReceipt({ booking }) {
  if (!booking) return null;
  const vehicleMake = [booking.driverId?.vehicleBrand, booking.driverId?.vehicleModel].filter(Boolean).join(' ');
  const vehicleLabel = vehicleMake ? `${vehicleMake} (${booking.driverId?.vehicleType})` : booking.driverId?.vehicleType;
  const fare = booking.actualFare ?? booking.estimatedFare;
  const total = fare + (booking.cardSurchargeAmount || 0);

  return (
    <div className="printable-receipt">
      <div style={{ textAlign: 'center' }}>
        <Logo size={36} tagline gap={8} />
        <h2 style={{ margin: '20px 0 4px' }}>Trip receipt</h2>
        <p className="muted" style={{ margin: 0 }}>{booking.bookingId}</p>
      </div>

      <table style={{ width: '100%', marginTop: 20, borderCollapse: 'collapse' }}>
        <tbody>
          <tr><td style={{ padding: '6px 0', color: '#666' }}>Date</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{formatNzDateTime(booking.completedAt || booking.requestedAt)}</td></tr>
          <tr><td style={{ padding: '6px 0', color: '#666' }}>Pickup</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{booking.pickupAddress}</td></tr>
          {booking.stops?.map((s, i) => (
            <tr key={i}><td style={{ padding: '6px 0', color: '#666' }}>Stop {i + 1}</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{s.address}</td></tr>
          ))}
          <tr><td style={{ padding: '6px 0', color: '#666' }}>Drop-off</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{booking.dropAddress}</td></tr>
          <tr><td style={{ padding: '6px 0', color: '#666' }}>Distance</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{booking.distanceKm} km</td></tr>
          {booking.driverContact?.name && (
            <tr><td style={{ padding: '6px 0', color: '#666' }}>Driver</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{booking.driverContact.name}</td></tr>
          )}
          {vehicleLabel && (
            <tr><td style={{ padding: '6px 0', color: '#666' }}>Vehicle</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{vehicleLabel}{booking.driverId?.vehicleNumber ? ` · ${booking.driverId.vehicleNumber}` : ''}</td></tr>
          )}
          <tr><td style={{ padding: '6px 0', color: '#666' }}>Payment method</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{booking.paymentMethod === 'card' ? 'Card (online)' : 'Cash'}</td></tr>
          <tr><td style={{ padding: '6px 0', color: '#666' }}>Payment status</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{booking.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}</td></tr>
        </tbody>
      </table>

      <table style={{ width: '100%', marginTop: 12, borderTop: '2px solid #222', paddingTop: 8, borderCollapse: 'collapse' }}>
        <tbody>
          <tr><td style={{ padding: '6px 0', color: '#666' }}>Fare</td><td style={{ padding: '6px 0', textAlign: 'right' }}>${fare.toFixed(2)}</td></tr>
          {booking.cardSurchargeAmount > 0 && (
            <tr><td style={{ padding: '6px 0', color: '#666' }}>Online payment surcharge</td><td style={{ padding: '6px 0', textAlign: 'right' }}>${booking.cardSurchargeAmount.toFixed(2)}</td></tr>
          )}
          <tr><td style={{ padding: '10px 0 0', fontWeight: 700, fontSize: '1.1rem' }}>Total</td><td style={{ padding: '10px 0 0', textAlign: 'right', fontWeight: 700, fontSize: '1.1rem' }}>${total.toFixed(2)}</td></tr>
        </tbody>
      </table>

      <p className="muted" style={{ marginTop: 24, fontSize: '0.8rem', textAlign: 'center' }}>Thanks for riding with EasyRide.</p>
    </div>
  );
}
