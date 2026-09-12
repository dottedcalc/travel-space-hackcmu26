import test from 'node:test';
import assert from 'node:assert/strict';
import { heatSurfacePixels, smoothHeatField, heatColor } from '../lib/heat-surface.ts';

const grid = (w, h) => ({ w, h, cell: 0.5, blocked: new Uint8Array(w * h) });

test('heat transitions gradually while retaining hotspot peaks and source values', () => {
  const room = grid(15, 15), values = new Array(225).fill(0);
  values[7 * 15 + 7] = 6;
  const before = [...values], field = smoothHeatField(values, room);
  assert.deepEqual(values, before);
  assert.equal(field[7 * 15 + 7], 6);
  assert.ok(field[7 * 15 + 8] > field[7 * 15 + 9]);
  assert.ok(field[7 * 15 + 9] > 0);
  const raster = heatSurfacePixels(field, room);
  const colors = new Set();
  for (let i = 0; i < raster.pixels.length; i += 4)
    if (raster.pixels[i + 3]) colors.add([...raster.pixels.slice(i, i + 4)].join(','));
  assert.equal(colors.size, 4, 'The curved surface should use exactly four discrete colors');
});

test('a wall blocks both smoothing and interpolation into the opposite aisle', () => {
  const room = grid(9, 7), values = new Array(63).fill(0);
  for (let y = 0; y < room.h; y++) room.blocked[y * room.w + 4] = 1;
  values[3 * room.w + 3] = 8;
  const field = smoothHeatField(values, room);
  for (let y = 0; y < room.h; y++) for (let x = 4; x < room.w; x++)
    assert.equal(field[y * room.w + x], 0);
  const raster = heatSurfacePixels(field, room);
  for (let y = 0; y < raster.height; y++) for (let x = 4 * 6; x < raster.width; x++)
    assert.equal(raster.pixels[(y * raster.width + x) * 4 + 3], 0);
});

test('smoothing cannot cross an obstacle corner or fill outside an irregular hall', () => {
  const room = grid(4, 4), values = new Array(16).fill(0);
  room.blocked[1] = 1;
  room.blocked[4] = 1;
  values[0] = 5;
  const field = smoothHeatField(values, room);
  assert.equal(field[5], 0);
  const raster = heatSurfacePixels(field, room);
  assert.equal(raster.pixels[(8 * raster.width + 8) * 4 + 3], 0);
});

test('empty areas are transparent and four soft bands have exact density boundaries', () => {
  assert.equal(heatColor(0)[3], 0);
  assert.equal(heatColor(0.049)[3], 0);
  const levels = [heatColor(0.5), heatColor(1), heatColor(2), heatColor(4)];
  assert.equal(new Set(levels.map((color) => color.join(','))).size, 4);
  assert.deepEqual(heatColor(0.999), levels[0]);
  assert.deepEqual(heatColor(1.999), levels[1]);
  assert.deepEqual(heatColor(3.999), levels[2]);
  assert.deepEqual(heatColor(1000), levels[3]);
  assert.deepEqual(levels.map((color) => color.slice(0, 3)), Array(4).fill([233, 162, 59]),
    'Every heat level should use the same yellow-orange tone');
  const opacities = levels.map((color) => color[3]);
  assert.deepEqual(opacities, [26, 52, 78, 104].map((opacity, index) =>
    Math.round(opacity * (index < 2 ? 0.8 : 1.2))),
    'Lower bands should be about 20% lighter and higher bands about 20% darker');
  assert.ok(opacities[2] - opacities[1] > opacities[1] - opacities[0]);
  const room = grid(3, 3);
  const raster = heatSurfacePixels(new Float32Array(9), room);
  for (let i = 3; i < raster.pixels.length; i += 4) assert.equal(raster.pixels[i], 0);
});

test('large hall raster stays bounded for playback and does not depend on map zoom', () => {
  const room = grid(500, 334);
  const raster = heatSurfacePixels(new Float32Array(500 * 334), room);
  assert.equal(raster.width, 1200);
  assert.ok(raster.height <= 1200);
});
