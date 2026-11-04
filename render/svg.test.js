// render/svg.test.js — the camera-clamp maths. `clampCamera` is pure and has
// no DOM, so it can be checked directly without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clampCamera } from './svg.js';
import { WORLD, MIN_ZOOM, MAX_ZOOM } from '../core/state.js';

const view = { w: 1000, h: 600 };

test('a camera inside the world is left where it is', () => {
  const clamped = clampCamera({ x: WORLD.width / 2, y: WORLD.height / 2, zoom: 1 }, view, WORLD);
  assert.equal(clamped.x, WORLD.width / 2);
  assert.equal(clamped.y, WORLD.height / 2);
});

test('the view is pulled back inside the world on every edge', () => {
  const halfW = view.w / 2;
  const halfH = view.h / 2;
  assert.deepEqual(
    clampCamera({ x: 0, y: 0, zoom: 1 }, view, WORLD),
    { x: halfW, y: halfH, zoom: 1 },
    'top-left is clamped to keep the view inside',
  );
  assert.deepEqual(
    clampCamera({ x: WORLD.width * 2, y: WORLD.height * 2, zoom: 1 }, view, WORLD),
    { x: WORLD.width - halfW, y: WORLD.height - halfH, zoom: 1 },
    'bottom-right is clamped to keep the view inside',
  );
});

test('a viewport wider than the world is centred on that axis instead', () => {
  // At 25% the 1000px viewport spans 4000 world units > 3600, so x centres;
  // the 600px height spans 2400 > 1500, so y centres too.
  const clamped = clampCamera({ x: 0, y: 0, zoom: MIN_ZOOM }, view, WORLD);
  assert.equal(clamped.x, WORLD.width / 2);
  assert.equal(clamped.y, WORLD.height / 2);
  assert.equal(clamped.zoom, MIN_ZOOM);
});

test('the zoom is clamped to the allowed range', () => {
  assert.equal(clampCamera({ x: 0, y: 0, zoom: 99 }, view, WORLD).zoom, MAX_ZOOM);
  assert.equal(clampCamera({ x: 0, y: 0, zoom: 0.0001 }, view, WORLD).zoom, MIN_ZOOM);
});

test('non-finite coordinates fall back to the world centre', () => {
  const clamped = clampCamera({ x: Number.NaN, y: Number.NaN, zoom: 1 }, view, WORLD);
  assert.equal(clamped.x, WORLD.width / 2);
  assert.equal(clamped.y, WORLD.height / 2);
});
