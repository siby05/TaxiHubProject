import { useEffect, useState } from 'react';
import client from '../../api/client';

export default function DriverQrCode() {
  const [qr, setQr] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/driver/qr-code').then((r) => setQr(r.data)).catch((err) => setError(err.response?.data?.error || 'Could not load QR code'));
  }, []);

  return (
    <div className="container">
      <h1>My QR code</h1>
      <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
        <p className="muted">
          Display this in your vehicle. When a passenger scans it, they land on a page to book you directly - the
          request reaches you the same way any other ride request does, and you accept or decline it from your
          dashboard.
        </p>
        {error && <p className="error-text">{error}</p>}
        {qr && (
          <>
            <img src={qr.qrCodeImage} alt="Driver booking QR code" style={{ width: 260, height: 260, margin: '12px auto' }} />
            <p className="muted" style={{ wordBreak: 'break-all' }}>{qr.qrCodeUrl}</p>
            <a className="btn" href={qr.qrCodeImage} target="_blank" rel="noreferrer">Open full size to print</a>
          </>
        )}
        {!qr && !error && <p className="muted">Loading...</p>}
      </div>
    </div>
  );
}
