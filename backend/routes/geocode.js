const express = require('express');
const router = express.Router();
const { auth, roleMiddleware } = require('../middleware/auth');

const NOMINATIM_HEADERS = { 'User-Agent': 'TaxiHub/1.0 (demo project)' };

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
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=6&countrycodes=nz&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, { headers: NOMINATIM_HEADERS });
    if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
    const results = await response.json();
    res.json(results.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) })));
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
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const response = await fetch(url, { headers: NOMINATIM_HEADERS });
    if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
    const result = await response.json();
    if (!result || result.error) return res.status(404).json({ error: 'Could not resolve an address for this location' });
    res.json({ label: result.display_name, lat: Number(lat), lng: Number(lng) });
  } catch (err) {
    res.status(502).json({ error: 'Reverse lookup failed, try again' });
  }
});

module.exports = router;
