// Slippy-map coordinate helpers for the manual pin fallback. No geocoder
// dependency: the driver selects the location on the map themselves.
const MAX_LAT = 85.05112878;
const TILE = 256;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function toWorld(lat, lng, zoom) {
  const n = 2 ** zoom;
  const safe = clamp(Number(lat), -MAX_LAT, MAX_LAT);
  const radians = safe * Math.PI / 180;
  return {
    x: (Number(lng) + 180) / 360 * n * TILE,
    y: (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * n * TILE,
  };
}
export function fromWorld(x, y, zoom) {
  const extent = (2 ** zoom) * TILE;
  const normalizedY = clamp(y, 0, extent);
  return {
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * normalizedY / extent))) * 180 / Math.PI,
    lng: ((x % extent + extent) % extent) / extent * 360 - 180,
  };
}
export function visibleTiles(center, zoom, width, height) {
  const px = toWorld(center.lat, center.lng, zoom);
  const left = px.x - width / 2, top = px.y - height / 2;
  const total = 2 ** zoom, tiles = [];
  const x0 = Math.floor(left / TILE), x1 = Math.floor((left + width) / TILE);
  const y0 = Math.max(0, Math.floor(top / TILE));
  const y1 = Math.min(total - 1, Math.floor((top + height) / TILE));
  for (let x=x0; x<=x1; x++) for (let y=y0; y<=y1; y++) {
    tiles.push({
      key: x + '-' + y,
      x: x * TILE - left, y: y * TILE - top,
      url: 'https://tile.openstreetmap.org/' + zoom + '/' + ((x % total + total) % total) + '/' + y + '.png',
    });
  }
  return tiles;
}
export function moveCenter(center, zoom, deltaX, deltaY) {
  const px = toWorld(center.lat, center.lng, zoom);
  return fromWorld(px.x - deltaX, px.y - deltaY, zoom);
}
export function selectedPoint(center, zoom, clickX, clickY, width, height) {
  const px = toWorld(center.lat, center.lng, zoom);
  return fromWorld(px.x + clickX - width/2, px.y + clickY - height/2, zoom);
}
