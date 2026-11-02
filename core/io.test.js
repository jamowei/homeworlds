// core/io.test.js — ticket 13: JSON export/import fallback + corrupt-message
// safety. The pure seam is `exportDocument` / `importDocument`; the reducer
// safety check reuses `applyMessage`. No DOM, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDocument,
  applyMessage,
  buildPieceMessage,
  buildCameraMessage,
  buildResetMessage,
  pieceId,
  WORLD,
} from './state.js';
import { exportDocument, importDocument } from './io.js';

function piecesOf(doc) {
  const out = {};
  for (const [id, p] of Object.entries(doc.pieces)) {
    out[id] = { id: p.id, color: p.color, size: p.size, kind: p.kind, x: p.x, y: p.y, rotation: p.rotation };
  }
  return out;
}

// --- Export / import round trip ----------------------------------------

test('a valid board round-trips through export and import', () => {
  let doc = createDocument('game-round');
  const id = pieceId('red', 3, 2);
  doc = applyMessage(doc, buildPieceMessage(doc, id, { x: 400, y: 500 }, 'a'));
  doc = applyMessage(doc, buildPieceMessage(doc, id, { rotation: 180 }, 'a'));
  doc = applyMessage(doc, buildPieceMessage(doc, pieceId('blue', 1, 1), { kind: 'star' }, 'a'));
  doc = applyMessage(doc, buildCameraMessage(doc, { x: 250, y: 350, zoom: 0.7 }, 'a'));

  const restored = importDocument(exportDocument(doc), { fallbackGameId: 'ignored' });

  assert.ok(restored, 'import returns a document');
  assert.equal(restored.gameId, 'game-round');
  assert.deepEqual(piecesOf(restored), piecesOf(doc));
  assert.equal(restored.camera.x, 250);
  assert.equal(restored.camera.y, 350);
  assert.equal(restored.camera.zoom, 0.7);
  assert.equal(restored.resetVersion, doc.resetVersion);
  assert.equal(restored.resetBy, doc.resetBy);
});

test('an exported document is valid JSON text', () => {
  const json = exportDocument(createDocument('g1'));
  assert.equal(typeof json, 'string');
  assert.doesNotThrow(() => JSON.parse(json));
});

// --- Malformed / corrupt input -----------------------------------------

test('importDocument rejects malformed JSON', () => {
  assert.equal(importDocument('{not json'), null);
  assert.equal(importDocument(''), null);
});

test('importDocument rejects non-object JSON', () => {
  assert.equal(importDocument('42'), null);
  assert.equal(importDocument('"hello"'), null);
  assert.equal(importDocument('null'), null);
  assert.equal(importDocument('[1,2,3]'), null);
});

test('importDocument rejects a structurally corrupt pieces map', () => {
  assert.equal(importDocument(JSON.stringify({ pieces: 7 })), null);
  assert.equal(importDocument(JSON.stringify({ pieces: [1, 2] })), null);
});

test('importDocument ignores a piece with an unknown id and keeps the initial slot', () => {
  const doc = createDocument('g1');
  const data = JSON.parse(exportDocument(doc));
  data.pieces['purple-huge-9'] = {
    id: 'purple-huge-9', color: 'purple', size: 9, kind: 'ship', x: 10, y: 10, rotation: 0, version: 5,
  };
  const restored = importDocument(JSON.stringify(data));
  assert.ok(restored);
  assert.equal(Object.keys(restored.pieces).length, 36, 'the board is still complete');
  assert.equal(restored.pieces['purple-huge-9'], undefined);
});

test('importDocument rejects bad colour/size/kind/rotation and falls back to the initial piece', () => {
  const id = pieceId('green', 2, 1);
  const initial = createDocument('g1');
  const data = JSON.parse(exportDocument(initial));

  data.pieces[id].color = 'purple';
  const badColor = importDocument(JSON.stringify(data));
  assert.deepEqual(piecesOf(badColor)[id], piecesOf(initial)[id]);

  const data2 = JSON.parse(exportDocument(initial));
  data2.pieces[id].size = 9;
  const badSize = importDocument(JSON.stringify(data2));
  assert.deepEqual(piecesOf(badSize)[id], piecesOf(initial)[id]);

  const data3 = JSON.parse(exportDocument(initial));
  data3.pieces[id].kind = 'blob';
  const badKind = importDocument(JSON.stringify(data3));
  assert.deepEqual(piecesOf(badKind)[id], piecesOf(initial)[id]);

  const data4 = JSON.parse(exportDocument(initial));
  data4.pieces[id].rotation = 45;
  const badRotation = importDocument(JSON.stringify(data4));
  assert.deepEqual(piecesOf(badRotation)[id], piecesOf(initial)[id]);
});

test('importDocument ignores a piece with non-finite coordinates', () => {
  const id = pieceId('yellow', 1, 1);
  const initial = createDocument('g1');
  const data = JSON.parse(exportDocument(initial));
  // JSON has no NaN literal, so send a string and a missing value.
  data.pieces[id].x = 'not-a-number';
  const restored = importDocument(JSON.stringify(data));
  assert.ok(restored);
  assert.deepEqual(piecesOf(restored)[id], piecesOf(initial)[id]);
});

test('importDocument clamps out-of-range coordinates into the world', () => {
  const id = pieceId('yellow', 2, 2);
  const data = JSON.parse(exportDocument(createDocument('g1')));
  data.pieces[id].x = 999999;
  data.pieces[id].y = -999999;
  const restored = importDocument(JSON.stringify(data));
  assert.ok(restored.pieces[id].x > 0 && restored.pieces[id].x < WORLD.width);
  assert.ok(restored.pieces[id].y > 0 && restored.pieces[id].y < WORLD.height);
});

test('importDocument falls back to the initial camera when the camera is corrupt', () => {
  const initial = createDocument('g1');
  const data = JSON.parse(exportDocument(initial));
  data.camera = { x: 'bad', y: null, zoom: 'huge' };
  const restored = importDocument(JSON.stringify(data));
  assert.equal(restored.camera.x, initial.camera.x);
  assert.equal(restored.camera.y, initial.camera.y);
  assert.equal(restored.camera.zoom, initial.camera.zoom);
});

test('importDocument falls back to a complete board when pieces are missing', () => {
  const restored = importDocument(JSON.stringify({ gameId: 'g1' }));
  assert.ok(restored);
  assert.equal(Object.keys(restored.pieces).length, 36);
});

test('importDocument uses the fallback game id when the payload has none', () => {
  const restored = importDocument(JSON.stringify({ pieces: {} }), { fallbackGameId: 'fallback-7' });
  assert.equal(restored.gameId, 'fallback-7');
});

test('importDocument does not mutate the parsed board of another caller', () => {
  const json = exportDocument(createDocument('g1'));
  const a = importDocument(json);
  const b = importDocument(json);
  a.pieces[pieceId('red', 1, 1)].x = 1;
  assert.notEqual(b.pieces[pieceId('red', 1, 1)].x, 1);
});

// --- Corrupt sync messages never break the local board ------------------

test('applyMessage ignores non-object messages', () => {
  const doc = createDocument('g1');
  assert.equal(applyMessage(doc, null), doc);
  assert.equal(applyMessage(doc, undefined), doc);
  assert.equal(applyMessage(doc, 'nonsense'), doc);
  assert.equal(applyMessage(doc, 42), doc);
});

test('applyMessage ignores an unknown message type', () => {
  const doc = createDocument('g1');
  assert.equal(applyMessage(doc, { type: 'nope', id: 'x' }), doc);
  assert.equal(applyMessage(doc, {}), doc);
});

test('applyMessage ignores piece messages with missing or corrupt fields', () => {
  const doc = createDocument('g1');
  assert.equal(applyMessage(doc, { type: 'piece', id: 'x', by: 'a' }), doc);
  assert.equal(applyMessage(doc, { type: 'piece', id: 'x', by: 'a', piece: null }), doc);
  assert.equal(
    applyMessage(doc, {
      type: 'piece', id: 'x', by: 'a',
      piece: { id: pieceId('red', 1, 1), color: 'red', size: 1, kind: 'ship', x: 'bad', y: 10, rotation: 0, version: 1 },
    }),
    doc,
  );
});

test('applyMessage ignores a camera message with non-finite values', () => {
  const doc = createDocument('g1');
  assert.equal(applyMessage(doc, { type: 'camera', id: 'x', by: 'a', camera: { x: Number.NaN, y: 0, zoom: 1, version: 1 } }), doc);
  assert.equal(applyMessage(doc, { type: 'camera', id: 'x', by: 'a', camera: null }), doc);
});

test('applyMessage ignores a reset message with a non-finite version', () => {
  const doc = createDocument('g1');
  assert.equal(applyMessage(doc, { type: 'reset', id: 'x', by: 'a', version: 'soon' }), doc);
});

test('a corrupt message between good ones leaves the board consistent', () => {
  let doc = createDocument('g1');
  const id = pieceId('blue', 3, 1);
  doc = applyMessage(doc, buildPieceMessage(doc, id, { x: 200, y: 300 }, 'a'));
  doc = applyMessage(doc, { type: 'garbage' });
  doc = applyMessage(doc, null);
  doc = applyMessage(doc, buildResetMessage(doc, 'a'));
  // after a good reset the board is exactly the initial bank again
  assert.equal(doc.pieces[id].x, createDocument('g1').pieces[id].x);
  assert.equal(doc.pieces[id].kind, 'ship');
});
