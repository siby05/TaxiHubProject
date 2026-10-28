import { useEffect, useRef, useState } from 'react';
import client from '../api/client';
import MapPinPicker from './MapPinPicker';

// Free-text address search backed by the backend's Nominatim (OpenStreetMap)
// proxy, restricted to New Zealand - no Google Maps key needed. Calls
// onSelect(null) while the user is still typing (no confirmed coordinates
// yet) and onSelect({label,lat,lng}) once they pick a suggestion or use
// their current location.
// The last address picked in any field this visit. Searches rank results
// near it (the backend defaults to New Plymouth), so after choosing a
// pickup, "kfc" as the drop-off finds the closest KFC first.
let lastPicked = null;

function getPosition(options) {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
}

// A precise message per failure - these used to all say "permission
// denied", even when the GPS was just slow to get a fix.
function locateErrorMessage(err) {
  if (err?.code === 1) {
    return 'Location is blocked for this site or browser. Allow location in your browser\'s site settings '
      + '(and for the browser app in your phone\'s location settings), or type the address instead.';
  }
  if (err?.code === 2) return 'Couldn\'t get your location - check your phone\'s location (GPS) is on, or type the address.';
  return 'Finding your location took too long - try again, or type the address.';
}

export default function AddressAutocomplete({ label, placeholder, onSelect, required, allowLocate, compactLocate = false, allowManualPin = false, defaultValue }) {
  const [query, setQuery] = useState(defaultValue || '');

  // defaultValue only seeded the initial state above - a caller that
  // resolves it asynchronously after mount (e.g. the QR-scan guest
  // checkout's returning-passenger lookup by mobile number, which sets
  // the saved address once the lookup responds) needs this to actually
  // show up in the field, not just in the parent's own state.
  useEffect(() => {
    if (defaultValue) setQuery(defaultValue);
  }, [defaultValue]);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const [showManualPin, setShowManualPin] = useState(false);
  const [manualNotice, setManualNotice] = useState('');
  const timer = useRef(null);
  const inflight = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function cancelPending() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inflight.current?.abort();
    inflight.current = null;
  }

  useEffect(() => cancelPending, []);

  function onInput(value) {
    setQuery(value);
    onSelect(null);
    cancelPending();
    setHighlight(-1);
    setSearchError('');
    setLocateError('');
    setManualNotice('');
    if (value.trim().length < 3) {
      setResults([]);
      setLoading(false);
      setOpen(false);
      return;
    }
    // Show "Searching..." straight away rather than a dead field while the
    // debounce and request run.
    setLoading(true);
    setOpen(true);
    timer.current = setTimeout(async () => {
      // Abort the previous search so a slow response for "12 Kar" can't
      // land after, and overwrite, the results for "12 Karamea".
      const controller = new AbortController();
      inflight.current = controller;
      try {
        const params = lastPicked ? { q: value, lat: lastPicked.lat, lng: lastPicked.lng } : { q: value };
        const { data } = await client.get('/geocode/search', { params, signal: controller.signal });
        if (inflight.current !== controller) return;
        setResults(data);
      } catch (err) {
        if (inflight.current !== controller || err.code === 'ERR_CANCELED') return;
        setResults([]);
        setSearchError(err.response?.data?.error || 'Address search is temporarily unavailable. Try again or choose the location on the map.');
        setOpen(false);
      }
      inflight.current = null;
      setLoading(false);
    }, 300);
  }

  function pick(result) {
    // A debounced search still pending would otherwise reopen the list
    // right after the user has chosen an address.
    cancelPending();
    setLoading(false);
    setQuery(result.label);
    setResults([]);
    setOpen(false);
    setHighlight(-1);
    setShowManualPin(false);
    setSearchError('');
    setLocateError('');
    setManualNotice(result.manualPin ? 'Location chosen manually. Check the pin and street address before confirming.' : '');
    if (Number.isFinite(result.lat) && Number.isFinite(result.lng)) lastPicked = { lat: result.lat, lng: result.lng };
    onSelect(result);
  }

  function onKeyDown(e) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? results.length - 1 : h - 1));
    } else if (e.key === 'Enter' && highlight >= 0) {
      // Pick the highlighted suggestion instead of submitting the form.
      e.preventDefault();
      pick(results[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  async function useCurrentLocation() {
    setLocateError('');
    setSearchError('');
    setOpen(false);
    if (!navigator.geolocation) {
      setLocateError('Location isn\'t supported in this browser - type the address instead');
      return;
    }
    setLocating(true);
    let pos;
    try {
      // A quick network-based fix (or one from the last few minutes)
      // first; only if that fails, wait for the GPS. A single 10s
      // high-accuracy-less attempt used to time out indoors.
      pos = await getPosition({ enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 });
    } catch (err) {
      if (err?.code === 1) {
        setLocateError(locateErrorMessage(err));
        setLocating(false);
        return;
      }
      try {
        pos = await getPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
      } catch (err2) {
        setLocateError(locateErrorMessage(err2));
        setLocating(false);
        return;
      }
    }
    try {
      const { data } = await client.get('/geocode/reverse', { params: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
      pick(data);
    } catch {
      // The phone has supplied a real GPS fix, even if the reverse-address
      // service is offline. Keep the coordinates rather than discarding the
      // pickup entirely. Do not pretend a street address was verified.
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      pick({ label: `Current GPS position (${lat.toFixed(5)}, ${lng.toFixed(5)})`, lat, lng, manualPin: true });
      setManualNotice('Your GPS coordinates were selected, but the street address could not be verified. Please check the pickup location before booking.');
    } finally {
      setLocating(false);
    }
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
          onKeyDown={onKeyDown}
          onFocus={() => (results.length || loading) && setOpen(true)}
        />
        {allowLocate && (
          <button type="button" className="btn secondary" style={{ whiteSpace: 'nowrap', flexShrink: 0 }} aria-label={compactLocate ? 'Use my current location' : undefined} title={compactLocate ? 'Use my current location' : undefined} onClick={useCurrentLocation} disabled={locating}>
            {locating ? '…' : compactLocate ? '📍' : '📍 Locate'}
          </button>
        )}
      </div>
      {locateError && <p className="error-text" role="status" style={{ margin: '6px 0 0' }}>{locateError}</p>}
      {manualNotice && <p className="muted" role="status" style={{ margin: '6px 0 0', fontSize: '0.83rem' }}>{manualNotice}</p>}
      {searchError && <p className="error-text" role="status" style={{ margin: '6px 0 0' }}>{searchError}</p>}
      {open && (loading || results.length > 0) && (
        <div className="autocomplete-list">
          {loading && <div className="autocomplete-item muted">Searching...</div>}
          {!loading && results.map((r, i) => (
            // mousedown (with preventDefault) rather than click: on phones
            // the tap otherwise first blurs the input and closes the
            // keyboard, the list shifts, and the click can miss the item.
            <div
              key={`${r.label}-${i}`}
              className={`autocomplete-item${i === highlight ? ' active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              onMouseEnter={() => setHighlight(i)}
            >
              {r.label}
            </div>
          ))}
        </div>
      )}
      {allowManualPin && <div className="address-manual-fallback">
        <button type="button" className="address-map-open" onClick={() => { setShowManualPin(v => !v); setOpen(false); }}>
          {showManualPin ? 'Close map' : 'Can’t find the address? Set the pin on a map'}
        </button>
        {showManualPin && <MapPinPicker address={query} near={lastPicked} onPick={pick} onCancel={() => setShowManualPin(false)} />}
      </div>}
    </div>
  );
}
