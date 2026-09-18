import { useEffect, useRef, useState } from 'react';
import client from '../api/client';

// Free-text address search backed by the backend's Nominatim (OpenStreetMap)
// proxy, restricted to New Zealand - no Google Maps key needed. Calls
// onSelect(null) while the user is still typing (no confirmed coordinates
// yet) and onSelect({label,lat,lng}) once they pick a suggestion or use
// their current location.
export default function AddressAutocomplete({ label, placeholder, onSelect, required, allowLocate, defaultValue }) {
  const [query, setQuery] = useState(defaultValue || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');
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

  function useCurrentLocation() {
    setLocateError('');
    if (!navigator.geolocation) {
      setLocateError('Location isn\'t supported in this browser');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { data } = await client.get('/geocode/reverse', { params: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
          pick(data);
        } catch {
          setLocateError('Could not find an address for your location');
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocateError('Location permission denied');
        setLocating(false);
      },
      { timeout: 10000 },
    );
  }

  return (
    <div className="autocomplete-wrap" ref={wrapRef}>
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={query}
          required={required}
          autoComplete="off"
          placeholder={placeholder || 'Start typing an address...'}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
        {allowLocate && (
          <button type="button" className="btn secondary" style={{ whiteSpace: 'nowrap', flexShrink: 0 }} onClick={useCurrentLocation} disabled={locating}>
            {locating ? '...' : '📍 Locate'}
          </button>
        )}
      </div>
      {locateError && <p className="error-text" style={{ margin: '4px 0 0' }}>{locateError}</p>}
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
