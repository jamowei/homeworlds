// render/svg.test.js — the camera-clamp maths. `clampCamera` is pure and has
// no DOM, so it can be checked directly without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clampCamera, mirrorX, mirrorY } from './svg.js';
import { WORLD, MIN_ZOOM, MAX_ZOOM, playfieldWidth } from '../core/state.js';

const view = { w: 1000, h: 600 };

test('the host sees the play field unmirrored', () => {
  assert.equal(mirrorX(200, 'host'), 200);
  assert.equal(mirrorY(200, 'host'), 200);
  assert.equal(mirrorX(0, 'host'), 0);
  assert.equal(mirrorY(0, 'host'), 0);
});

test('the guest sees the play field mirrored left-to-right', () => {
  assert.equal(mirrorX(200, 'guest'), playfieldWidth() - 200);
  assert.equal(mirrorX(0, 'guest'), playfieldWidth());
  assert.equal(mirrorX(playfieldWidth(), 'guest'), 0);
});

test('the guest sees the play field mirrored top-to-bottom', () => {
  assert.equal(mirrorY(200, 'guest'), WORLD.height - 200);
  assert.equal(mirrorY(0, 'guest'), WORLD.height);
  assert.equal(mirrorY(WORLD.height, 'guest'), 0);
});

test('both mirrors are their own inverse, so world ↔ view round-trips', () => {
  for (const role of ['host', 'guest']) {
    assert.equal(mirrorX(mirrorX(437, role), role), 437);
    assert.equal(mirrorY(mirrorY(437, role), role), 437);
  }
});

test('the centre of the field is fixed under the mirror', () => {
  assert.equal(mirrorX(playfieldWidth() / 2, 'guest'), playfieldWidth() / 2);
  assert.equal(mirrorY(WORLD.height / 2, 'guest'), WORLD.height / 2);
});

test('the guest view is a 180° turn, so left becomes right', () => {
  const left = 400;
  const right = 900;
  assert.ok(
    mirrorX(left, 'guest') > mirrorX(right, 'guest'),
    'a piece left of another for the host is to the right of it for the guest',
  );
});

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
  // At 25% the 1000px viewport spans 4000 world units > 3730, so x centres;
  // the 600px height spans 2400 > 2200, so y centres too.
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
