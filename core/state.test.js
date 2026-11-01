import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COLORS,
  SIZES,
  WORLD,
  BANK,
  createDocument,
  pieceId,
  bankLayout,
  applyMessage,
  buildCameraMessage,
  buildPieceMessage,
  clampZoom,
} from './state.js';

test('createDocument yields exactly 36 pieces', () => {
  const doc = createDocument('g1');
  assert.equal(Object.keys(doc.pieces).length, 36);
});

test('every colour/size/copy combination exists exactly once', () => {
  const doc = createDocument('g1');
  for (const color of COLORS) {
    for (const size of SIZES) {
      for (let copy = 1; copy <= BANK.copies; copy++) {
        assert.ok(doc.pieces[pieceId(color, size, copy)], `${color} ${size} copy ${copy}`);
      }
    }
  }
});

test('piece ids are deterministic across loads', () => {
  const a = createDocument('g1');
  const b = createDocument('g1');
  assert.deepEqual(Object.keys(a.pieces).sort(), Object.keys(b.pieces).sort());
  assert.deepEqual(a.pieces, b.pieces);
});

test('all pieces start as upright ships', () => {
  const doc = createDocument('g1');
  for (const piece of Object.values(doc.pieces)) {
    assert.equal(piece.kind, 'ship');
    assert.equal(piece.rotation, 0);
  }
});

test('piece ids encode colour, size and copy', () => {
  assert.equal(pieceId('red', 3, 2), 'red-large-2');
  assert.equal(pieceId('yellow', 1, 1), 'yellow-small-1');
});

test('the Bank is ordered 4 colour rows by 3 size columns', () => {
  const layout = bankLayout();
  assert.equal(layout.rows, 4);
  assert.equal(layout.cols, 3);
  // each copy of a cell shares a cell centre in the layout
  const doc = createDocument('g1');
  for (const color of COLORS) {
    for (const size of SIZES) {
      const copies = [1, 2, 3].map((c) => doc.pieces[pieceId(color, size, c)]);
      // copies of one cell share the same row/column cell
      const cell = layout.cellFor(color, size);
      for (const p of copies) {
        assert.ok(Math.abs(p.x - cell.centerX) <= BANK.cellWidth / 2 + 1);
        assert.ok(Math.abs(p.y - cell.centerY) <= BANK.cellHeight / 2 + 1);
      }
    }
  }
});

test('the Bank sits at the far-right edge of the world', () => {
  const doc = createDocument('g1');
  const minX = Math.min(...Object.values(doc.pieces).map((p) => p.x));
  assert.ok(minX > WORLD.width * 0.6, `bank starts at ${minX}`);
  const maxX = Math.max(...Object.values(doc.pieces).map((p) => p.x));
  assert.ok(maxX < WORLD.width);
});

test('every piece lies within the bounded world', () => {
  const doc = createDocument('g1');
  for (const p of Object.values(doc.pieces)) {
    assert.ok(p.x > 0 && p.x < WORLD.width, `${p.id} x=${p.x}`);
    assert.ok(p.y > 0 && p.y < WORLD.height, `${p.id} y=${p.y}`);
  }
});

test('the document carries a game id and a camera', () => {
  const doc = createDocument('game-42');
  assert.equal(doc.gameId, 'game-42');
  assert.ok(doc.camera);
  assert.equal(doc.camera.zoom, 1);
});

test('zoom is clamped to roughly 25%–400%', () => {
  assert.equal(clampZoom(0.01), 0.25);
  assert.equal(clampZoom(100), 4);
  assert.equal(clampZoom(1.5), 1.5);
});

test('applying a camera message clamps its zoom', () => {
  const doc = createDocument('g1');
  const message = buildCameraMessage(doc, { x: 100, y: 200, zoom: 99 }, 'a');
  const next = applyMessage(doc, message);
  assert.equal(next.camera.zoom, 4);
  assert.equal(next.camera.x, 100);
  assert.equal(next.camera.y, 200);
});

test('camera is last-write-wins: a newer version wins', () => {
  const doc = createDocument('g1');
  const first = applyMessage(doc, buildCameraMessage(doc, { x: 10, y: 10, zoom: 2 }, 'a'));
  const second = applyMessage(first, buildCameraMessage(first, { x: 50, y: 50, zoom: 1 }, 'a'));
  assert.equal(second.camera.x, 50);
  assert.equal(second.camera.zoom, 1);
});

test('camera ignores a stale (older) update', () => {
  const doc = createDocument('g1');
  const first = applyMessage(doc, buildCameraMessage(doc, { x: 10, y: 10, zoom: 2 }, 'a'));
  const stale = { type: 'camera', id: 'x', by: 'b', camera: { x: 999, y: 999, zoom: 3, version: 0 } };
  const next = applyMessage(first, stale);
  assert.equal(next.camera.x, 10);
  assert.equal(next.camera.zoom, 2);
});

test('camera ties are broken by peer id', () => {
  const doc = createDocument('g1');
  const mine = { ...doc, camera: { x: 1, y: 1, zoom: 1, version: 5, by: 'a' } };
  const tie = { type: 'camera', id: 't', by: 'b', camera: { x: 2, y: 2, zoom: 1, version: 5 } };
  const next = applyMessage(mine, tie);
  assert.equal(next.camera.x, 2, 'higher peer id wins the tie');
});

test('a move updates the piece position', () => {
  const doc = createDocument('g1');
  const id = pieceId('red', 3, 1);
  const message = buildPieceMessage(doc, id, { x: 400, y: 500 }, 'a');
  const next = applyMessage(doc, message);
  assert.equal(next.pieces[id].x, 400);
  assert.equal(next.pieces[id].y, 500);
});

test('a move is clamped inside the world bounds', () => {
  const doc = createDocument('g1');
  const id = pieceId('red', 3, 1);
  const far = applyMessage(doc, buildPieceMessage(doc, id, { x: 99999, y: -99999 }, 'a'));
  assert.ok(far.pieces[id].x < WORLD.width, 'x clamped in');
  assert.ok(far.pieces[id].x > WORLD.width - 100, 'x clamped near the edge');
  assert.ok(far.pieces[id].y > 0 && far.pieces[id].y < 100, 'y clamped near the edge');
});

test('a newer move wins and an older one is ignored', () => {
  const doc = createDocument('g1');
  const id = pieceId('yellow', 1, 1);
  const first = applyMessage(doc, buildPieceMessage(doc, id, { x: 100, y: 100 }, 'a'));
  const second = applyMessage(first, buildPieceMessage(first, id, { x: 200, y: 200 }, 'a'));
  assert.equal(second.pieces[id].x, 200);
  // Replaying the first (older) message must not move it back.
  const stale = { ...buildPieceMessage(doc, id, { x: 100, y: 100 }, 'a'), piece: { ...first.pieces[id] } };
  const replayed = applyMessage(second, stale);
  assert.equal(replayed.pieces[id].x, 200);
});

test('a move with an unknown piece id is ignored', () => {
  const doc = createDocument('g1');
  const message = {
    type: 'piece',
    id: 'm',
    by: 'a',
    piece: { id: 'purple-huge-9', color: 'purple', size: 9, kind: 'ship', x: 10, y: 10, rotation: 0, version: 1 },
  };
  assert.equal(applyMessage(doc, message), doc);
});

test('a move with non-finite coordinates is ignored', () => {
  const doc = createDocument('g1');
  const id = pieceId('blue', 2, 1);
  const message = buildPieceMessage(doc, id, { x: 10, y: 10 }, 'a');
  message.piece.x = Number.NaN;
  assert.equal(applyMessage(doc, message), doc);
});

test('a move cannot change a piece colour or size', () => {
  const doc = createDocument('g1');
  const id = pieceId('green', 2, 1);
  const message = buildPieceMessage(doc, id, { x: 10, y: 10 }, 'a');
  message.piece.color = 'red';
  message.piece.size = 3;
  const next = applyMessage(doc, message);
  assert.equal(next.pieces[id].color, 'green');
  assert.equal(next.pieces[id].size, 2);
});
