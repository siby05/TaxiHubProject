import { useEffect, useState } from 'react';
import client from '../api/client';
import { waLink } from '../utils/whatsapp';

// Shown alongside a "no driver available" error so the passenger isn't
// just stuck - lets them reach the admin directly instead of only seeing
// a dead end. Pulls from GET /api/booking/admin-contact (public, since
// this renders on the QR-scan guest checkout too, before/without login) -
// renders nothing if the admin hasn't set either contact field.
export default function ContactAdmin({ context }) {
  const [contact, setContact] = useState(null);

  useEffect(() => {
    client.get('/booking/admin-contact').then((r) => setContact(r.data)).catch(() => {});
  }, []);

  if (!contact || (!contact.email && !contact.mobile)) return null;

  const message = `Hi, I'm having trouble booking a ride on EasyRide${context ? ` (${context})` : ''} - no driver seems to be available. Can you help?`;
  const mailtoLink = contact.email ? `mailto:${contact.email}?subject=${encodeURIComponent('EasyRide - no driver available')}&body=${encodeURIComponent(message)}` : null;
  const whatsappLink = waLink(contact.mobile, message);

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
      <span className="muted">Need help?</span>
      {whatsappLink && <a className="btn whatsapp" target="_blank" rel="noreferrer" href={whatsappLink}>Contact admin on WhatsApp</a>}
      {mailtoLink && <a className="btn secondary" href={mailtoLink}>Email admin</a>}
    </div>
  );
}
