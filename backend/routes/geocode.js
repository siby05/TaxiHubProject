const express = require('express');
const router = express.Router();
const { haversineKm } = require('../utils/distance');
const NOMINATIM_HEADERS = { 'User-Agent': 'EasyRideNZ/1.0 (https://easyridenz.com; contact: easyridenz@gmail.com)' };

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

// The geocoders only lean towards `near` - a stronger text match in
// another city ("Cowling Road", "Devon Street") could still come first or
// push the New Plymouth one off the list. So more results are fetched
// and re-ranked here: New Plymouth / Taranaki first (where pickups almost
// always are), then near the caller's last-picked address, then the rest,
// each group keeping the geocoder's own order.
const SERVICE_AREA_KM = 60;
const NEAR_LAST_PICKED_KM = 40;
const FETCH_LIMIT = 20;
function rankLocalFirst(results, near) {
  const tier = (r) => {
    if (haversineKm(DEFAULT_NEAR.lat, DEFAULT_NEAR.lng, r.lat, r.lng) <= SERVICE_AREA_KM) return 0;
    if (haversineKm(near.lat, near.lng, r.lat, r.lng) <= NEAR_LAST_PICKED_KM) return 1;
    return 2;
  };
  return results
    .map((r, i) => ({ r, i, t: tier(r) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.r);
}

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

async function geoapifySearch(q, near) {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) throw new Error('GEOAPIFY_API_KEY not configured');
  const params = new URLSearchParams({
    text: q, filter: 'countrycode:nz', bias: `proximity:${near.lng},${near.lat}`,
    limit: String(FETCH_LIMIT), format: 'json', apiKey: key,
  });
  const response = await fetch('https://api.geoapify.com/v1/geocode/autocomplete?' + params, {
    signal: AbortSignal.timeout(6500),
  });
  if (!response.ok) throw new Error('Geoapify responded ' + response.status);
  const data = await response.json();
  return (data.results || [])
    .map(r => ({
      label: r.formatted || [r.address_line1, r.address_line2].filter(Boolean).join(', '),
      lat: Number(r.lat), lng: Number(r.lon),
    }))
    .filter(r => r.label && inNz(r.lat, r.lng));
}

async function photonSearch(q, near) {
  const url = `https://photon.komoot.io/api/?limit=${FETCH_LIMIT}&lang=en&bbox=${NZ_BBOX}&lat=${near.lat}&lon=${near.lng}&q=${encodeURIComponent(q)}`;
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
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=${FETCH_LIMIT}&countrycodes=nz&viewbox=${viewbox}&q=${encodeURIComponent(q)}`;
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
  let aliasResults = [];
  let failures = 0;
  // Geoapify is the primary provider when configured. If unavailable,
  // automatically try Photon, then Nominatim. No map selection needed.
  if (process.env.GEOAPIFY_API_KEY) {
    try { results = await geoapifySearch(alias || q, near); }
    catch (err) { failures++; console.warn('[geocode] Geoapify unavailable: ' + err.message); }
  }
  if (results.length === 0) {
    try {
      results = await photonSearch(alias || q, near);
    } catch (err) {
      failures++;
      console.warn('[geocode] Photon unavailable: ' + err.message);
    }
  }
  if (results.length === 0) {
    try { results = await nominatimSearch(alias || q, near); }
    catch (err) {
      failures++;
      console.warn('[geocode] Nominatim unavailable: ' + err.message);
    }
  }
  // Don't cache a transient outage as an empty address result.
  if (results.length === 0 && failures > 0) {
    return res.status(503).json({ error: 'Address providers temporarily unavailable. Please try again.' });
  }
  if (alias && results.length) aliasResults = results;
  // An airport code's own results stay on top (the user asked for that
  // airport); everything else is ranked New Plymouth first.
  results = dedupeByLabel([...aliasResults, ...rankLocalFirst(results, near)]).slice(0, 6);
  if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
  searchCache.set(cacheKey, { at: Date.now(), results });
  res.json(results);
});

// GET /api/geocode/reverse?lat=&lng= - reverse address lookup.
const reverseCache = new Map();
router.get('/reverse', async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (req.query.lat == null || req.query.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || !inNz(lat, lng)) {
    return res.status(400).json({ error: 'Valid New Zealand lat and lng are required' });
  }
  const cacheKey = lat.toFixed(5) + ',' + lng.toFixed(5);
  const cached = reverseCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return res.json(cached.result);

  let label = null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const response = await fetch(url, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
    const result = await response.json();
    if (!result || result.error) throw new Error('Nominatim found no address');
    label = shortLabel(result);
  } catch (err) {
    // A Nominatim timeout or 429 should not throw away the user's GPS fix.
    // Photon also offers reverse lookup with its OpenStreetMap index.
    console.warn(`[geocode] Nominatim reverse unavailable: ${err.message}`);
    try {
      const url = `https://photon.komoot.io/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&lang=en`;
      const response = await fetch(url, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`Photon responded ${response.status}`);
      const json = await response.json();
      const features = json.features || [];
      const nearby = features.find((f) => f?.properties && f.geometry?.coordinates?.length >= 2);
      if (nearby) label = photonLabel(nearby.properties);
    } catch (photonError) {
      console.warn(`[geocode] Photon reverse unavailable: ${photonError.message}`);
    }
  }
  if (!label) return res.status(503).json({ error: 'Reverse lookup temporarily unavailable. GPS coordinates can still be selected.' });
  const result = { label, lat, lng };
  if (reverseCache.size >= 200) reverseCache.delete(reverseCache.keys().next().value);
  reverseCache.set(cacheKey, { at: Date.now(), result });
  return res.json(result);
});

module.exports = router;
