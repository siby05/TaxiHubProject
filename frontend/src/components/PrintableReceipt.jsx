import { formatNzDate } from '../utils/nzTime';

// One row of the details table - mirrors backend/services/emailService.js's
// invoiceRow() so the printed and emailed invoices stay in step.
function Row(label, value) {
  if (!value) return null;
  return (
    <tr>
      <td style={{ padding: '8px 0', color: '#64748b', fontSize: 13, borderBottom: '1px solid #e2e8f0' }}>{label}</td>
      <td style={{ padding: '8px 0', color: '#0f172a', fontSize: 13, textAlign: 'right', borderBottom: '1px solid #e2e8f0' }}>{value}</td>
    </tr>
  );
}

// Rendered off-screen at all times; only made visible by the @media print
// rules in index.css when window.print() is triggered (see
// pages/passenger/PassengerDashboard.jsx's "Print receipt" button), sized
// for regular paper (A4/Letter) rather than the A6 QR card.
//
// Deliberately styled to match buildInvoiceHtml() in
// backend/services/emailService.js field-for-field and section-for-section
// (branded header, Invoice/date/booking id, Billed to, trip details,
// totalled fare breakdown, EasyRide contact footer) so a passenger sees the
// same document whether they print it or have it emailed to them.
export default function PrintableReceipt({ booking, passenger, adminContact }) {
  if (!booking) return null;
  const vehicleMake = [booking.driverId?.vehicleBrand, booking.driverId?.vehicleModel].filter(Boolean).join(' ');
  const vLabel = vehicleMake ? `${vehicleMake} (${booking.driverId?.vehicleType})` : booking.driverId?.vehicleType;
  const vehicleLabel = vLabel && booking.driverId?.vehicleNumber ? `${vLabel} · ${booking.driverId.vehicleNumber}` : vLabel;
  const fare = booking.actualFare ?? booking.estimatedFare;
  const total = fare + (booking.cardSurchargeAmount || 0);

  return (
    <div className="printable-receipt">
      <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', maxWidth: 560, margin: '0 auto', background: '#ffffff' }}>
        <div style={{ background: '#0B2942', padding: '24px 32px', borderRadius: '10px 10px 0 0' }}>
          <table style={{ borderCollapse: 'collapse' }} cellPadding={0} cellSpacing={0}>
            <tbody>
              <tr>
                <td style={{ width: 40, verticalAlign: 'middle' }}>
                  <div style={{ width: 34, height: 34, background: '#38BDF8', borderRadius: 9, textAlign: 'center', lineHeight: '34px' }}>
                    <span style={{ color: '#ffffff', fontSize: 18, fontWeight: 800, fontFamily: 'Georgia, serif' }}>&rsaquo;</span>
                  </div>
                </td>
                <td style={{ verticalAlign: 'middle', paddingLeft: 10 }}>
                  <span style={{ fontSize: 22, fontWeight: 800 }}><span style={{ color: '#ffffff' }}>Easy</span><span style={{ color: '#38BDF8' }}>Ride</span></span>
                  <div style={{ color: '#94a3b8', fontSize: 11, letterSpacing: '0.08em', marginTop: 2 }}>PREMIUM TRANSPORT · NEW PLYMOUTH, NZ</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 32 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <tbody>
              <tr>
                <td style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Invoice</td>
                <td style={{ textAlign: 'right', color: '#64748b', fontSize: 13 }}>{formatNzDate(booking.completedAt || booking.requestedAt)}</td>
              </tr>
              <tr><td colSpan={2} style={{ color: '#64748b', fontSize: 13, paddingTop: 2 }}>{booking.bookingId}</td></tr>
            </tbody>
          </table>

          {passenger?.name && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Billed to</div>
              <div style={{ color: '#0f172a', fontSize: 14, fontWeight: 600 }}>{passenger.name}</div>
              {passenger.address && <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>{passenger.address}</div>}
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <tbody>
              {Row('Pickup', booking.pickupAddress)}
              {booking.stops?.map((s, i) => (
                <tr key={i}>
                  <td style={{ padding: '8px 0', color: '#64748b', fontSize: 13, borderBottom: '1px solid #e2e8f0' }}>Stop {i + 1}</td>
                  <td style={{ padding: '8px 0', color: '#0f172a', fontSize: 13, textAlign: 'right', borderBottom: '1px solid #e2e8f0' }}>{s.address}</td>
                </tr>
              ))}
              {Row('Drop-off', booking.dropAddress)}
              {Row('Distance', `${booking.distanceKm} km`)}
              {Row('Driver', booking.driverContact?.name)}
              {Row('Vehicle', vehicleLabel)}
              {Row('Payment method', booking.paymentMethod === 'card' ? 'Card (online)' : 'Cash')}
              {Row('Payment status', booking.paymentStatus === 'paid' ? 'Paid' : 'Unpaid')}
            </tbody>
          </table>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <tbody>
              <tr><td colSpan={2} style={{ borderTop: '2px solid #0B2942', paddingTop: 10 }} /></tr>
              <tr>
                <td style={{ padding: '4px 0', color: '#64748b', fontSize: 13 }}>Fare</td>
                <td style={{ padding: '4px 0', color: '#0f172a', fontSize: 13, textAlign: 'right' }}>${fare.toFixed(2)}</td>
              </tr>
              {booking.cardSurchargeAmount > 0 && (
                <tr>
                  <td style={{ padding: '4px 0', color: '#64748b', fontSize: 13 }}>Online payment surcharge</td>
                  <td style={{ padding: '4px 0', color: '#0f172a', fontSize: 13, textAlign: 'right' }}>${booking.cardSurchargeAmount.toFixed(2)}</td>
                </tr>
              )}
              <tr>
                <td style={{ padding: '12px 0 0', color: '#0f172a', fontSize: 16, fontWeight: 700 }}>Total</td>
                <td style={{ padding: '12px 0 0', color: '#0EA5E9', fontSize: 16, fontWeight: 700, textAlign: 'right' }}>${total.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #e2e8f0', color: '#64748b', fontSize: 12, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>EasyRide</div>
            {adminContact?.email && <div>Email: <a href={`mailto:${adminContact.email}`} style={{ color: '#0EA5E9', textDecoration: 'none' }}>{adminContact.email}</a></div>}
            {adminContact?.mobile && <div>Phone: {adminContact.mobile}</div>}
            <div style={{ marginTop: 8 }}>Thanks for riding with EasyRide.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
