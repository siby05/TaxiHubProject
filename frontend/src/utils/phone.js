// A tel: link that opens the phone's dialler with the number filled in, or
// null when there's no usable number. Keeps a leading + (international
// format) and drops spaces, dashes and brackets.
export function telLink(mobile) {
  if (!mobile) return null;
  const trimmed = String(mobile).trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return null;
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}
