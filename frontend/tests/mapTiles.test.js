import test from 'node:test';
import assert from 'node:assert/strict';
import { toWorld, fromWorld, selectedPoint, moveCenter, visibleTiles } from '../src/utils/mapTiles.js';

test('map coordinates roundtrip for New Plymouth and Auckland', () => {
  for (const point of [{ lat: -39.057, lng: 174.077 }, { lat: -36.85, lng: 174.765 }]) {
    const world = toWorld(point.lat, point.lng, 15);
    const result = fromWorld(world.x, world.y, 15);
    assert.ok(Math.abs(result.lat - point.lat) < 0.00001);
    assert.ok(Math.abs(result.lng - point.lng) < 0.00001);
  }
});

test('tap selects exact central map position; tap to the right selects easterly location', () => {
  const center = { lat: -39.057, lng: 174.077 };
  const middle = selectedPoint(center, 15, 170, 130, 340, 260);
  assert.ok(Math.abs(middle.lat - center.lat) < 0.00001);
  assert.ok(Math.abs(middle.lng - center.lng) < 0.00001);
  const right = selectedPoint(center, 15, 230, 130, 340, 260);
  assert.ok(right.lng > center.lng);
  const moved = moveCenter(center, 15, 80, 0);
  assert.ok(moved.lng < center.lng);
});

test('map tiles have valid OpenStreetMap URLs and local pixel positions', () => {
  const tiles = visibleTiles({ lat: -39.057, lng: 174.077 }, 15, 380, 260);
  assert.ok(tiles.length >= 4 && tiles.length <= 12);
  for (const tile of tiles) {
    assert.match(tile.url, /^https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png$/);
    assert.ok(Number.isFinite(tile.x) && Number.isFinite(tile.y));
  }
});
