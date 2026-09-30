const express = require('express');
const router = express.Router();
const NOMINATIM_HEADERS = { 'User-Agent': 'EasyRide/1.0 (demo project)' };

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

// Photon (photon.komoot.io) uses the same OpenStreetMap data as Nominatim
// but is built for search-as-you-type: it matches partial words ("12
// karam", "kfc new ply") where Nominatim only matches whole words, so
// Nominatim alone showed "No matches" until each word was fully typed.
// The bbox covers New Zealand; results are also filtered on countrycode
// since the bbox doesn't strictly exclude everything outside it.
const NZ_BBOX = '165.8,-47.4,179,-34';
const inNz = (lat, lng) => lat >= -47.4 && lat <= -34 && lng >= 165.8 && lng <= 179;

// Where results are ranked around when the caller doesn't say: central New
// Plymouth, where the service runs. "kfc" then lists the New Plymouth KFC
// first instead of Auckland's.
const DEFAULT_NEAR = { lat: -39.06, lng: 174.08 };

// Airport codes people type as shorthand. Photon fuzzy-matches "npl" to
// "NPD" (the fuel company), so New Plymouth Airport never came up. The
// airport's name is searched too and its results lead the list.
const PLACE_ALIASES = {
  npl: 'New Plymouth Airport',
  akl: 'Auckland Airport',
  wlg: 'Wellington Airport',
  pmr: 'Palmerston North Airport',
  hlz: 'Hamilton Airport',
  wag: 'Whanganui Airport',
  trg: 'Tauranga Airport',
  rot: 'Rotorua Airport',
  npe: "Hawke's Bay Airport",
  nsn: 'Nelson Airport',
  chc: 'Christchurch Airport',
  zqn: 'Queenstown Airport',
  dud: 'Dunedin Airport',
};

function photonLabel(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  // For roads `name` is the road itself and for places it's the town -
  // only lead with it for real venues/POIs.
  const isVenue = p.name && p.osm_key !== 'highway' && p.osm_key !== 'place';
  const suburb = p.district || p.locality;
  const city = p.city || p.town || p.village || p.county;

  const parts = [];
  parts.push(isVenue ? p.name : street || p.name);
  if (suburb && suburb !== city && suburb !== parts[0]) parts.push(suburb);
  if (city && city !== parts[0]) parts.push(p.postcode ? `${city} ${p.postcode}` : city);
  return parts.filter(Boolean).join(', ');
}

async function photonSearch(q, near) {
  const url = `https://photon.komoot.io/api/?limit=10&lang=en&bbox=${NZ_BBOX}&lat=${near.lat}&lon=${near.lng}&q=${encodeURIComponent(q)}`;
  const response = await fetch(url, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`Photon responded ${response.status}`);
  const { features = [] } = await response.json();
  return features
    .filter((f) => (f.properties?.countrycode || '').toUpperCase() === 'NZ')
    .map((f) => ({ label: photonLabel(f.properties), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }))
    .filter((r) => inNz(r.lat, r.lng));
}

async function nominatimSearch(q, near) {
  // A viewbox without bounded=1 prefers results around `near` without
  // excluding the rest of the country.
  const viewbox = [near.lng - 1, near.lat + 1, near.lng + 1, near.lat - 1].join(',');
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&countrycodes=nz&viewbox=${viewbox}&q=${encodeURIComponent(q)}`;
  const response = await fetch(url, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
  const results = await response.json();
  return results
    .map((r) => ({ label: shortLabel(r), lat: Number(r.lat), lng: Number(r.lon) }))
    .filter((r) => inNz(r.lat, r.lng));
}

// The free public geocoders rate-limit, and the same prefixes get typed
// over and over across booking forms - cache results for a while.
const searchCache = new Map();
const SEARCH_CACHE_MAX = 500;
const SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function dedupeByLabel(results) {
  const seen = new Set();
  return results.filter((r) => {
    const key = (r.label || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Address search, proxied instead of called from the browser: the
 * geocoders' usage policies want a real User-Agent identifying the app,
 * which browsers won't let client-side code set, and proxying lets
 * results be cached. Photon first, Nominatim as a fallback when Photon is
 * down or finds nothing. Restricted to New Zealand, where this service
 * currently operates.
 *
 * Public (no auth) - needed by the passenger and driver signup pages
 * before a token exists, as well as the logged-in booking flows.
 *
 * ?lat=&lng= (optional, inside NZ) ranks results near that point - the
 * frontend sends the last address the user picked; otherwise central New
 * Plymouth.
 */
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (q.length < 3) return res.json([]);
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  // Rounded to ~1 km so nearby callers share cache entries.
  const near = Number.isFinite(lat) && Number.isFinite(lng) && inNz(lat, lng)
    ? { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 }
    : DEFAULT_NEAR;
  const alias = PLACE_ALIASES[q.toLowerCase()];

  const cacheKey = `${q.toLowerCase()}|${near.lat},${near.lng}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) return res.json(cached.results);

  let results = [];
  let failures = 0;
  if (alias) {
    try {
      results = await photonSearch(alias, near);
    } catch (err) {
      console.error(`[geocode] photon alias search failed: ${err.message}`);
    }
  }
  try {
    results = [...results, ...(await photonSearch(q, near))];
  } catch (err) {
    failures++;
    console.error(`[geocode] photon search failed: ${err.message}`);
  }
  if (results.length === 0) {
    try {
      results = await nominatimSearch(alias || q, near);
    } catch (err) {
      failures++;
      console.error(`[geocode] nominatim search failed: ${err.message}`);
    }
  }
  // 503, not 502: a 502 is what Render's proxy returns while the server is
  // still asleep, and the frontend treats that as "waking up".
  if (failures === 2) return res.status(503).json({ error: 'Address lookup failed, try again' });

  results = dedupeByLabel(results).slice(0, 6);
  if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
  searchCache.set(cacheKey, { at: Date.now(), results });
  res.json(results);
});

// GET /api/geocode/reverse?lat=&lng= - turns "use my current location" GPS
// coordinates into a human-readable address for the pickup field. Public,
// same reasoning as /search above.
router.get('/reverse', async (req, res) => {
  const { lat, lng } = req.query;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const response = await fetch(url, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
    const result = await response.json();
    if (!result || result.error) return res.status(404).json({ error: 'Could not resolve an address for this location' });
    res.json({ label: shortLabel(result), lat: Number(lat), lng: Number(lng) });
  } catch (err) {
    console.error(`[geocode] reverse failed: ${err.message}`);
    res.status(503).json({ error: 'Reverse lookup failed, try again' });
  }
});

module.exports = router;
