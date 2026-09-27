// 12-hour (AM/PM) time picker. The native <input type="time"> follows the
// device locale, so NZ phones set to 24-hour show 24-hour times; this always
// shows hour / minute / AM-PM dropdowns instead. value and onChange still use
// the same "HH:MM" 24-hour string as <input type="time">, so callers and the
// backend don't change. Picking any part of an empty time fills the rest with
// defaults (:00, AM) so the value is always complete once touched.
const HOURS = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

function parse(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(value || '');
  if (!m) return { hour: '', minute: '', period: '' };
  const h = Number(m[1]);
  return { hour: String(h % 12 || 12), minute: m[2], period: h < 12 ? 'AM' : 'PM' };
}

function toValue({ hour, minute, period }) {
  let h = Number(hour) % 12;
  if (period === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${minute}`;
}

export default function TimeSelect({ value, onChange, required, ariaLabel, style }) {
  const parts = parse(value);
  // Keep an existing off-step minute (e.g. a seeded 23:59 shift end) selectable.
  const minutes = parts.minute && !MINUTE_STEPS.includes(parts.minute)
    ? [...MINUTE_STEPS, parts.minute].sort()
    : MINUTE_STEPS;

  function set(field, v) {
    const next = { hour: parts.hour || '12', minute: parts.minute || '00', period: parts.period || 'AM', [field]: v };
    onChange(toValue(next));
  }

  const selectStyle = { width: 'auto', flex: '1 1 0', minWidth: 0 };
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, ...style }}>
      <select value={parts.hour} required={required} aria-label="Hour" style={selectStyle} onChange={(e) => set('hour', e.target.value)}>
        {!parts.hour && <option value="" disabled>Hour</option>}
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span>:</span>
      <select value={parts.minute} required={required} aria-label="Minute" style={selectStyle} onChange={(e) => set('minute', e.target.value)}>
        {!parts.minute && <option value="" disabled>Min</option>}
        {minutes.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select value={parts.period} required={required} aria-label="AM or PM" style={selectStyle} onChange={(e) => set('period', e.target.value)}>
        {!parts.period && <option value="" disabled>AM/PM</option>}
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
