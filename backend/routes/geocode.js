const express = require('express');
const router = express.Router();
const { auth, roleMiddleware } = require('../middleware/auth');

const NOMINATIM_HEADERS = { 'User-Agent': 'TaxiHub/1.0 (demo project)' };

// Nominatim's display_name is the full administrative chain (e.g. "50,
// Karamea Street, Whalers Gate, New Plymouth, New Plymouth District,
// Taranaki, 4310, New Zealand / Aotearoa") - too long for a booking list.
// Build a short "123 Street, Suburb/City" label from the structured
// address instead, falling back to display_name if that's missing.
function shortLabel(result) {
  const addr = result.address || {};
  const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
  const locality = addr.suburb || addr.city || addr.town || addr.village || addr.county;
  const short = [street, locality].filter(Boolean).join(', ');
  return short || result.display_name;
}

/**
 * Proxies OpenStreetMap Nominatim (free, no API key) instead of calling it
 * from the browser: Nominatim's usage policy wants a real User-Agent
 * identifying the app, which browsers won't let client-side code set, and
 * proxying avoids CORS/rate-limit surprises on the client.
 *
 * countrycodes=nz restricts results to New Zealand, matching where this
 * service currently operates.
 */
router.get('/search', auth, roleMiddleware(['passenger', 'driver']), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json([]);

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&countrycodes=nz&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, { headers: NOMINATIM_HEADERS });
    if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
    const results = await response.json();
    res.json(results.map((r) => ({ label: shortLabel(r), lat: Number(r.lat), lng: Number(r.lon) })));
  } catch (err) {
    res.status(502).json({ error: 'Address lookup failed, try again' });
  }
});

// GET /api/geocode/reverse?lat=&lng= - turns "use my current location" GPS
// coordinates into a human-readable address for the pickup field.
router.get('/reverse', auth, roleMiddleware(['passenger', 'driver']), async (req, res) => {
  const { lat, lng } = req.query;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const response = await fetch(url, { headers: NOMINATIM_HEADERS });
    if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
    const result = await response.json();
    if (!result || result.error) return res.status(404).json({ error: 'Could not resolve an address for this location' });
    res.json({ label: shortLabel(result), lat: Number(lat), lng: Number(lng) });
  } catch (err) {
    res.status(502).json({ error: 'Reverse lookup failed, try again' });
  }
});

module.exports = router;
