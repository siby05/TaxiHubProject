const express = require('express');
const router = express.Router();
const { auth, roleMiddleware } = require('../middleware/auth');

/**
 * Proxies OpenStreetMap Nominatim (free, no API key) instead of calling it
 * from the browser: Nominatim's usage policy wants a real User-Agent
 * identifying the app, which browsers won't let client-side code set, and
 * proxying avoids CORS/rate-limit surprises on the client.
 */
router.get('/search', auth, roleMiddleware(['passenger']), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json([]);

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=6&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'TaxiHub/1.0 (demo project)' } });
    if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
    const results = await response.json();
    res.json(results.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) })));
  } catch (err) {
    res.status(502).json({ error: 'Address lookup failed, try again' });
  }
});

module.exports = router;
