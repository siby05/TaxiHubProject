const express = require('express');
const router = express.Router();

const NOMINATIM_HEADERS = { 'User-Agent': 'TaxiHub/1.0 (demo project)' };

// Nominatim's display_name is the full administrative chain (e.g. "50,
// Karamea Street, Whalers Gate, New Plymouth, New Plymouth District,
// Taranaki, 4310, New Zealand / Aotearoa") - too long for a booking list,
// but a bare street name isn't enough to identify an address either. Build
// "123 Street, Suburb, City 1234" from the structured address - enough
// detail to be unambiguous without the district/region/country tail. When
// the result is a named place (a business/POI like "KFC" searched as
// "kfc new plymouth"), Nominatim returns a top-level `name` - lead with
// that instead of the street, so results are actually recognizable.
function shortLabel(result) {
  const addr = result.address || {};
  const venueName = result.name || addr.amenity || addr.shop || addr.office || addr.tourism || addr.leisure;
  const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
  const suburb = addr.suburb || addr.quarter;
  const city = addr.city || addr.town || addr.village || addr.county;

  const parts = [];
  parts.push(venueName || street);
  if (suburb && suburb !== city) parts.push(suburb);
  if (city) parts.push(addr.postcode ? `${city} ${addr.postcode}` : city);

  const label = parts.filter(Boolean).join(', ');
  return label || result.display_name;
}

/**
 * Proxies OpenStreetMap Nominatim (free, no API key) instead of calling it
 * from the browser: Nominatim's usage policy wants a real User-Agent
 * identifying the app, which browsers won't let client-side code set, and
 * proxying avoids CORS/rate-limit surprises on the client.
 *
 * countrycodes=nz restricts results to New Zealand, matching where this
 * service currently operates.
 *
 * Public (no auth) - needed by the passenger and driver signup pages
 * before a token exists, as well as the logged-in booking flows.
 */
router.get('/search', async (req, res) => {
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
// coordinates into a human-readable address for the pickup field. Public,
// same reasoning as /search above.
router.get('/reverse', async (req, res) => {
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
