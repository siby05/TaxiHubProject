import { useEffect, useState } from 'react';

// Country dialling codes offered in the picker. NZ first since that's the
// operating market; the rest cover where most NZ passengers/drivers come
// from. Add to this list rather than letting users type a raw prefix - the
// value is stored in E.164 ("+64211234567") so WhatsApp can deliver to it
// (see backend/services/whatsappService.js).
const COUNTRIES = [
  { code: '+64', label: 'NZ +64' },
  { code: '+61', label: 'AU +61' },
  { code: '+44', label: 'UK +44' },
  { code: '+1', label: 'US/CA +1' },
  { code: '+91', label: 'IN +91' },
  { code: '+63', label: 'PH +63' },
  { code: '+86', label: 'CN +86' },
  { code: '+27', label: 'ZA +27' },
  { code: '+679', label: 'FJ +679' },
];

const DEFAULT_CODE = '+64';

function split(value) {
  if (!value) return { code: DEFAULT_CODE, number: '' };
  // Longest prefix first so +679 isn't mistaken for +6.
  const match = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length).find((c) => value.startsWith(c.code));
  if (match) return { code: match.code, number: value.slice(match.code.length) };
  return { code: DEFAULT_CODE, number: value.replace(/^\+/, '') };
}

// Emits the full E.164 number ("+64211234567") through onChange, or '' when
// no local number has been typed yet - so a blank optional field stays blank
// rather than saving a bare country code.
export default function PhoneField({ label = 'Mobile', value, onChange, required, hint }) {
  const [code, setCode] = useState(() => split(value).code);
  const [number, setNumber] = useState(() => split(value).number);

  useEffect(() => {
    const local = number.replace(/\D/g, '').replace(/^0+/, '');
    onChange(local ? `${code}${local}` : '');
  }, [code, number]);

  return (
    <div>
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <select style={{ maxWidth: 130 }} value={code} onChange={(e) => setCode(e.target.value)}>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <input
          type="tel"
          inputMode="tel"
          placeholder="21 123 4567"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          required={required}
        />
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        {hint || 'Used for WhatsApp trip updates. Leave off the leading 0 - the country code replaces it.'}
      </p>
    </div>
  );
}
