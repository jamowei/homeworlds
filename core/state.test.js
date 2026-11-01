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
