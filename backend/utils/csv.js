// Minimal CSV serializer - no external dependency needed for a handful of
// flat export columns. columns: [{ header, key }] where key can be a dot
// path ('a.b') for a nested field, or a function(row) for a computed value.
function cell(row, key) {
  if (typeof key === 'function') return key(row);
  return key.split('.').reduce((v, k) => (v == null ? v : v[k]), row);
}

function escapeCell(value) {
  if (value == null) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns) {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCell(cell(row, c.key))).join(','));
  return [header, ...lines].join('\n');
}

module.exports = { toCsv };
