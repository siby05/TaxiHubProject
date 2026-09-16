import { useEffect, useRef, useState } from 'react';
import client from '../api/client';

// Free-text address search backed by the backend's Nominatim (OpenStreetMap)
// proxy - no Google Maps key needed. Calls onSelect(null) while the user is
// still typing (no confirmed coordinates yet) and onSelect({label,lat,lng})
// once they pick a suggestion.
export default function AddressAutocomplete({ label, placeholder, onSelect, required }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function onInput(value) {
    setQuery(value);
    onSelect(null);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await client.get('/geocode/search', { params: { q: value } });
        setResults(data);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 450);
  }

  function pick(result) {
    setQuery(result.label);
    setResults([]);
    setOpen(false);
    onSelect(result);
  }

  return (
    <div className="autocomplete-wrap" ref={wrapRef}>
      <label>{label}</label>
      <input
        value={query}
        required={required}
        autoComplete="off"
        placeholder={placeholder || 'Start typing an address...'}
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
      />
      {open && (
        <div className="autocomplete-list">
          {loading && <div className="autocomplete-item muted">Searching...</div>}
          {!loading && results.length === 0 && <div className="autocomplete-item muted">No matches - keep typing</div>}
          {results.map((r, i) => (
            <div key={i} className="autocomplete-item" onClick={() => pick(r)}>{r.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}
