import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';
import { useBookingStore } from '../../store/bookingStore';
import { useSocket } from '../../hooks/useSocket';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import ScheduleField from '../../components/ScheduleField';
import StarRating from '../../components/StarRating';
import StripePaymentModal from '../../components/StripePaymentModal';

export default function PassengerDashboard() {
  const { bookings, fetchMine, createBooking } = useBookingStore();
  const [stats, setStats] = useState(null);
  const [pickup, setPickup] = useState(null);
  const [drop, setDrop] = useState(null);
  const [scheduledFor, setScheduledFor] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [previousDrivers, setPreviousDrivers] = useState([]);
  const [preferredDriverId, setPreferredDriverId] = useState('');
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [vehicleType, setVehicleType] = useState('');
  const [formKey, setFormKey] = useState(0); // bump to reset the autocomplete inputs after booking
  const [payingId, setPayingId] = useState(null);
  const [payError, setPayError] = useState('');
  const [payModal, setPayModal] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  function refresh() {
    fetchMine();
    client.get('/passenger/stats').then((r) => setStats(r.data)).catch(() => {});
    client.get('/booking/previous-drivers').then((r) => setPreviousDrivers(r.data)).catch(() => {});
  }

  useEffect(() => {
    refresh();
    client.get('/booking/vehicle-types').then((r) => setVehicleTypes(r.data)).catch(() => {});
  }, []);

  useSocket({
    'booking:accepted': () => { setNotice('A driver accepted your ride!'); refresh(); },
    'booking:arrived': () => { setNotice('Your driver has arrived at the pickup point.'); refresh(); },
    'booking:started': () => { setNotice('Your trip has started.'); refresh(); },
    'booking:completed': () => { setNotice('Your trip is complete.'); refresh(); },
    'booking:cancelled': () => { setNotice('A booking was cancelled.'); refresh(); },
    'booking:declined': () => { setNotice('Your driver couldn\'t take the trip - finding you another one.'); refresh(); },
  });

  useEffect(() => {
    setQuote(null);
    setError('');
    if (!pickup || !drop) return;
    let cancelled = false;
    setQuoteLoading(true);
    client.post('/booking/quote', { driverId: preferredDriverId || undefined, pickupLat: pickup.lat, pickupLng: pickup.lng, dropLat: drop.lat, dropLng: drop.lng, paymentMethod, vehicleType: vehicleType || undefined })
      .then((r) => { if (!cancelled) setQuote(r.data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'Could not calculate fare'); })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [pickup, drop, preferredDriverId, paymentMethod, vehicleType]);

  async function rateDriver(bookingId, rating, review) {
    await client.put(`/booking/${bookingId}/rate`, { rating, review });
    refresh();
  }

  async function confirmBooking() {
    setError('');
    setLoading(true);
    try {
      await createBooking({
        driverId: preferredDriverId || undefined,
        vehicleType: vehicleType || undefined,
        pickupAddress: pickup.label, pickupLat: pickup.lat, pickupLng: pickup.lng,
        dropAddress: drop.label, dropLat: drop.lat, dropLng: drop.lng,
        scheduledFor,
        paymentMethod,
      });
      setPickup(null);
      setDrop(null);
      setScheduledFor(null);
      setQuote(null);
      setFormKey((k) => k + 1);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create booking');
    } finally {
      setLoading(false);
    }
  }

  // Card bookings can be paid as soon as they exist (immediate) or only
  // once the driver has accepted (scheduled-for-later) - matches "later
  // bookings pay online after confirmation". A real Stripe key configured
  // opens an actual card-entry form (mock:false); without one, the backend
  // auto-marks it paid immediately so the flow still works for testing.
  async function payNow(booking) {
    setPayError('');
    setPayingId(booking._id);
    try {
      const { data } = await client.post('/payment/create-intent', { bookingId: booking._id });
      if (data.mock === false) {
        setPayModal({ bookingId: booking._id, clientSecret: data.clientSecret });
      } else {
        refresh();
      }
    } catch (err) {
      setPayError(err.response?.data?.error || 'Payment failed');
    } finally {
      setPayingId(null);
    }
  }

  return (
    <div className="container">
      <h1>Passenger dashboard</h1>
      {notice && <div className="card" style={{ background: '#dcfce7' }}>{notice} <button className="btn secondary" onClick={() => setNotice('')}>Dismiss</button></div>}

      {stats && (
        <div className="grid cols-4">
          <div className="card stat"><div className="value">{stats.totalTrips}</div><div className="label">Completed trips</div></div>
          <div className="card stat"><div className="value">{stats.activeBookings}</div><div className="label">Active bookings</div></div>
          <div className="card stat"><div className="value">${stats.totalSpent.toFixed(2)}</div><div className="label">Total spent</div></div>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <h3>Book a ride</h3>
          <div key={formKey} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <AddressAutocomplete label="Pickup address" onSelect={setPickup} required allowLocate />
            <AddressAutocomplete label="Drop address" onSelect={setDrop} required />
            <ScheduleField onChange={setScheduledFor} />

            {vehicleTypes.length > 0 && !preferredDriverId && (
              <div>
                <label>Vehicle type</label>
                <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                  <option value="">Any vehicle</option>
                  {vehicleTypes.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {vehicleType && (
                  <p className="muted" style={{ marginTop: 4 }}>{vehicleTypes.find((t) => t.value === vehicleType)?.description}</p>
                )}
              </div>
            )}

            {previousDrivers.length > 0 && (
              <div>
                <label>Driver</label>
                <select value={preferredDriverId} onChange={(e) => setPreferredDriverId(e.target.value)}>
                  <option value="">Any available driver (auto-match)</option>
                  {previousDrivers.map((d) => (
                    <option key={d._id} value={d._id}>{d.name} · {d.vehicleType} · ⭐ {d.rating || 'new'}</option>
                  ))}
                </select>
                <p className="muted" style={{ marginTop: 4 }}>Pick a driver you've ridden with before, or leave on auto-match to broadcast to every available driver.</p>
              </div>
            )}

            <div>
              <label>Payment</label>
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" style={{ width: 'auto' }} checked={paymentMethod === 'cash'} onChange={() => setPaymentMethod('cash')} /> Cash to driver
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" style={{ width: 'auto' }} checked={paymentMethod === 'card'} onChange={() => setPaymentMethod('card')} /> Pay online
                </label>
              </div>
              {paymentMethod === 'card' && (
                <p className="muted">Online payment includes a small payment-gateway surcharge (≈2.6%), added on top of the fare - shown below before you confirm.</p>
              )}
              {paymentMethod === 'card' && scheduledFor && (
                <p className="muted">You'll be able to pay once the driver accepts.</p>
              )}
            </div>

            {quoteLoading && <p className="muted">Calculating fare...</p>}

            {quote && !quoteLoading && (
              <div className="card fare-confirm">
                {quote.requestedCashOnly && (
                  <p className="muted" style={{ color: '#b45309' }}>⚠️ {quote.requestedName || 'That driver'} is cash-only - matching you with another driver for online payment.</p>
                )}
                <strong>Estimated fare: ${quote.estimatedFare.toFixed(2)}</strong>
                {quote.cardSurchargeAmount > 0 && (
                  <div className="muted">+ ${quote.cardSurchargeAmount.toFixed(2)} online payment surcharge = <strong>${quote.total.toFixed(2)} total</strong></div>
                )}
                <div className="muted">{quote.distanceKm} km{scheduledFor && ` · scheduled for ${new Date(scheduledFor).toLocaleString()}`}</div>
                {error && <p className="error-text">{error}</p>}
                <button className="btn" style={{ marginTop: 8 }} onClick={confirmBooking} disabled={loading}>
                  {loading ? 'Booking...' : 'Confirm & request ride'}
                </button>
              </div>
            )}

            {!quote && !quoteLoading && error && <p className="error-text">{error}</p>}
          </div>
        </div>

        <div className="card">
          <h3>My bookings</h3>
          {payError && <p className="error-text">{payError}</p>}
          {bookings.length === 0 && <p className="muted">No bookings yet.</p>}
          <table>
            <tbody>
              {bookings.map((b) => (
                <tr key={b._id}>
                  <td>
                    <div className="muted">{b.bookingId}</div>
                    <div>{b.pickupAddress} → {b.dropAddress}</div>
                    <div className="muted">
                      {b.distanceKm} km · ${b.actualFare ?? b.estimatedFare} · {b.paymentMethod === 'card' ? (b.paymentStatus === 'paid' ? 'paid online' : 'unpaid (online)') : 'cash'}
                    </div>
                    {b.scheduledFor && <div className="muted">Scheduled: {new Date(b.scheduledFor).toLocaleString()}</div>}
                    {b.arrivedAt && b.status === 'accepted' && (
                      <div style={{ color: '#16a34a', fontWeight: 600 }}>🚕 Your driver has arrived - head out to the car.</div>
                    )}
                    {b.paymentMethod === 'card' && b.paymentStatus !== 'paid' && (!b.scheduledFor || b.status !== 'pending') && !['cancelled'].includes(b.status) && (
                      <button className="btn secondary" style={{ marginTop: 4 }} onClick={() => payNow(b)} disabled={payingId === b._id}>
                        {payingId === b._id ? 'Paying...' : 'Pay now'}
                      </button>
                    )}
                    {b.status === 'completed' && !b.rating && (
                      <StarRating label="Rate this driver" submitLabel="Rate" onSubmit={(rating, review) => rateDriver(b._id, rating, review)} />
                    )}
                    {b.rating && <div className="muted">You rated: {'★'.repeat(b.rating)}{'☆'.repeat(5 - b.rating)}</div>}
                  </td>
                  <td><span className={`badge ${b.status}`}>{b.status}</span></td>
                  <td>{b.status === 'completed' && <Link to="/passenger/complaints/new" state={{ bookingId: b._id, driverName: b.driverId?.userId?.name }}>Lodge complaint</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {payModal && (
        <StripePaymentModal
          bookingId={payModal.bookingId}
          clientSecret={payModal.clientSecret}
          onClose={() => setPayModal(null)}
          onSuccess={() => { setPayModal(null); refresh(); }}
        />
      )}
    </div>
  );
}
