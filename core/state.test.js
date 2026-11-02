import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COLORS,
  SIZES,
  WORLD,
  BANK,
  MIN_ZOOM,
  MAX_ZOOM,
  createDocument,
  pieceId,
  bankLayout,
  applyMessage,
  buildCameraMessage,
  buildPieceMessage,
  buildFlipMessage,
  buildResetMessage,
  buildRotateMessage,
  clampZoom,
  mergeDocuments,
  normalisePiece,
  resetDocument,
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

test('zoom is clamped to roughly 25%–100%', () => {
  assert.equal(clampZoom(0.01), 0.25);
  assert.equal(clampZoom(100), 1);
  assert.equal(clampZoom(0.5), 0.5);
});

test('clampZoom uses the exported zoom bounds', () => {
  assert.equal(MIN_ZOOM, 0.25);
  assert.equal(MAX_ZOOM, 1);
  assert.equal(clampZoom(MIN_ZOOM / 100), MIN_ZOOM);
  assert.equal(clampZoom(MAX_ZOOM * 100), MAX_ZOOM);
});

test('BANK exposes the copy offsets shared with the renderer', () => {
  assert.deepEqual([...BANK.copyOffsets], [-100, 0, 100]);
});

test('applying a camera message clamps its zoom', () => {
  const doc = createDocument('g1');
  const message = buildCameraMessage(doc, { x: 100, y: 200, zoom: 99 }, 'a');
  const next = applyMessage(doc, message);
  assert.equal(next.camera.zoom, 1);
  assert.equal(next.camera.x, 100);
  assert.equal(next.camera.y, 200);
});

test('camera is last-write-wins: a newer version wins', () => {
  const doc = createDocument('g1');
  const first = applyMessage(doc, buildCameraMessage(doc, { x: 10, y: 10, zoom: 0.3 }, 'a'));
  const second = applyMessage(first, buildCameraMessage(first, { x: 50, y: 50, zoom: 0.9 }, 'a'));
  assert.equal(second.camera.x, 50);
  assert.equal(second.camera.zoom, 0.9);
});

test('camera ignores a stale (older) update', () => {
  const doc = createDocument('g1');
  const first = applyMessage(doc, buildCameraMessage(doc, { x: 10, y: 10, zoom: 0.8 }, 'a'));
  const stale = { type: 'camera', id: 'x', by: 'b', camera: { x: 999, y: 999, zoom: 0.5, version: 0 } };
  const next = applyMessage(first, stale);
  assert.equal(next.camera.x, 10);
  assert.equal(next.camera.zoom, 0.8);
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

test('rotating a triangle toggles 0 and 180 and keeps position/colour/size', () => {
  const doc = createDocument('g1');
  const id = pieceId('red', 3, 2);
  const before = doc.pieces[id];
  const rotated = applyMessage(doc, buildPieceMessage(doc, id, { rotation: 180 }, 'a'));
  assert.equal(rotated.pieces[id].rotation, 180);
  assert.equal(rotated.pieces[id].x, before.x);
  assert.equal(rotated.pieces[id].y, before.y);
  assert.equal(rotated.pieces[id].color, 'red');
  assert.equal(rotated.pieces[id].size, 3);
  assert.equal(rotated.pieces[id].kind, 'ship');
});

test('a flip turns a ship into a star in place, preserving colour and size', () => {
  const doc = createDocument('g1');
  const id = pieceId('blue', 1, 3);
  const before = doc.pieces[id];
  const flipped = applyMessage(doc, buildPieceMessage(doc, id, { kind: 'star' }, 'a'));
  assert.equal(flipped.pieces[id].kind, 'star');
  assert.equal(flipped.pieces[id].x, before.x);
  assert.equal(flipped.pieces[id].y, before.y);
  assert.equal(flipped.pieces[id].color, 'blue');
  assert.equal(flipped.pieces[id].size, 1);
});

test('a flipped-back triangle remembers its previous orientation', () => {
  const doc = createDocument('g1');
  const id = pieceId('green', 2, 1);
  let next = applyMessage(doc, buildPieceMessage(doc, id, { rotation: 180 }, 'a'));
  next = applyMessage(next, buildPieceMessage(next, id, { kind: 'star' }, 'a'));
  assert.equal(next.pieces[id].kind, 'star');
  assert.equal(next.pieces[id].rotation, 180, 'the angle survives the flip');
  next = applyMessage(next, buildPieceMessage(next, id, { kind: 'ship' }, 'a'));
  assert.equal(next.pieces[id].kind, 'ship');
  assert.equal(next.pieces[id].rotation, 180, 'and is restored on the flip back');
});

test('buildRotateMessage toggles a ship 0<->180 in place', () => {
  const doc = createDocument('g1');
  const id = pieceId('red', 3, 2);
  const rotated = applyMessage(doc, buildRotateMessage(doc, id, 'a'));
  assert.equal(rotated.pieces[id].rotation, 180);
  const back = applyMessage(rotated, buildRotateMessage(rotated, id, 'a'));
  assert.equal(back.pieces[id].rotation, 0);
  // position, colour, size and shape are untouched
  assert.equal(back.pieces[id].x, doc.pieces[id].x);
  assert.equal(back.pieces[id].color, 'red');
  assert.equal(back.pieces[id].size, 3);
  assert.equal(back.pieces[id].kind, 'ship');
});

test('buildRotateMessage refuses a square and an unknown piece', () => {
  const doc = createDocument('g1');
  const id = pieceId('blue', 2, 1);
  const starDoc = applyMessage(doc, buildFlipMessage(doc, id, 'a'));
  assert.equal(starDoc.pieces[id].kind, 'star');
  assert.equal(buildRotateMessage(starDoc, id, 'a'), null, 'rotating a square does nothing');
  assert.equal(buildRotateMessage(doc, 'not-a-piece', 'a'), null);
});

test('buildFlipMessage toggles ship<->star in place, preserving identity', () => {
  const doc = createDocument('g1');
  const id = pieceId('green', 1, 2);
  const flipped = applyMessage(doc, buildFlipMessage(doc, id, 'a'));
  assert.equal(flipped.pieces[id].kind, 'star');
  assert.equal(flipped.pieces[id].x, doc.pieces[id].x);
  assert.equal(flipped.pieces[id].color, 'green');
  assert.equal(flipped.pieces[id].size, 1);
  const back = applyMessage(flipped, buildFlipMessage(flipped, id, 'a'));
  assert.equal(back.pieces[id].kind, 'ship');
  assert.equal(buildFlipMessage(doc, 'not-a-piece', 'a'), null);
});

// --- normalisePiece (shared by the sync reducer and JSON import) --------

test('normalisePiece rejects an unknown id or mismatched identity', () => {
  const doc = createDocument('g1');
  const id = pieceId('red', 1, 1);
  const piece = { ...doc.pieces[id], x: 5, y: 5, version: 3 };
  assert.equal(normalisePiece(piece, doc.pieces[id]).id, id);
  // unknown id: `isValidPiece` refuses it
  assert.equal(normalisePiece({ ...piece, id: 'purple-huge-9' }, doc.pieces[id]), null);
  // same colour/size but a different copy must not pass as its identity
  assert.equal(normalisePiece({ ...piece, id: pieceId('red', 1, 2) }, doc.pieces[id]), null);
  // mutable identity is refused
  assert.equal(normalisePiece({ ...piece, color: 'blue' }, doc.pieces[id]), null);
  assert.equal(normalisePiece({ ...piece, size: 3 }, doc.pieces[id]), null);
  assert.equal(normalisePiece(piece, null), null);
});

test('normalisePiece clamps coordinates and stamps a finite version', () => {
  const doc = createDocument('g1');
  const id = pieceId('yellow', 2, 2);
  const normalised = normalisePiece(
    { ...doc.pieces[id], x: 999999, y: -999999, kind: 'star', rotation: 180, version: '4', by: 'a' },
    doc.pieces[id],
  );
  assert.ok(normalised.x > 0 && normalised.x < WORLD.width);
  assert.ok(normalised.y > 0 && normalised.y < WORLD.height);
  assert.equal(normalised.kind, 'star');
  assert.equal(normalised.rotation, 180);
  assert.equal(normalised.version, 4);
  assert.equal(normalised.by, 'a');
});

function stripDocument(doc) {
  const pieces = {};
  for (const [key, p] of Object.entries(doc.pieces)) {
    pieces[key] = { id: p.id, color: p.color, size: p.size, kind: p.kind, x: p.x, y: p.y, rotation: p.rotation };
  }
  return {
    pieces,
    camera: { x: doc.camera.x, y: doc.camera.y, zoom: doc.camera.zoom },
  };
}

test('reset returns a document equal to the initial one', () => {
  const initial = createDocument('g1');
  let doc = createDocument('g1');
  const id = pieceId('red', 1, 1);
  doc = applyMessage(doc, buildPieceMessage(doc, id, { x: 123, y: 456 }, 'a'));
  doc = applyMessage(doc, buildPieceMessage(doc, id, { kind: 'star' }, 'a'));
  doc = applyMessage(doc, buildPieceMessage(doc, pieceId('blue', 3, 3), { rotation: 180 }, 'a'));
  doc = applyMessage(doc, buildResetMessage(doc, 'a'));
  assert.deepEqual(stripDocument(doc), stripDocument(initial));
});

test('reset keeps the game identity', () => {
  let doc = createDocument('game-7');
  doc = applyMessage(doc, buildPieceMessage(doc, pieceId('green', 2, 2), { x: 10, y: 10 }, 'a'));
  doc = applyMessage(doc, buildResetMessage(doc, 'a'));
  assert.equal(doc.gameId, 'game-7');
});

test('a stale reset is ignored', () => {
  let doc = createDocument('g1');
  const first = applyMessage(doc, buildResetMessage(doc, 'a'));
  const stale = { type: 'reset', id: 'r', by: 'b', version: 0 };
  assert.equal(applyMessage(first, stale), first);
});

// --- mergeDocuments (reconnect) -----------------------------------------
//
// When two players reconnect after being offline they exchange whole
// documents. `mergeDocuments` resolves every conflict without a user
// decision: the newest per-piece version wins, and equal versions are
// tie-broken by peer id so both replicas agree on the same result.

function documentWithPiece(id, changes, version, by) {
  const doc = createDocument('g1');
  doc.pieces[id] = { ...doc.pieces[id], ...changes, version, by };
  return doc;
}

test('mergeDocuments keeps the newest version of each piece', () => {
  const id = pieceId('red', 3, 1);
  const local = documentWithPiece(id, { x: 100, y: 100 }, 1, 'a');
  const remote = documentWithPiece(id, { x: 200, y: 200 }, 5, 'b');
  assert.equal(mergeDocuments(local, remote).pieces[id].x, 200, 'newer remote wins');
  assert.equal(mergeDocuments(remote, local).pieces[id].x, 200, 'newer local wins');
});

test('mergeDocuments resolves each piece independently', () => {
  const a = pieceId('yellow', 1, 1);
  const b = pieceId('blue', 2, 2);
  let local = createDocument('g1');
  local.pieces[a] = { ...local.pieces[a], x: 100, y: 100, version: 4, by: 'a' };
  local.pieces[b] = { ...local.pieces[b], x: 100, y: 100, version: 2, by: 'a' };
  let remote = createDocument('g1');
  remote.pieces[a] = { ...remote.pieces[a], x: 900, y: 900, version: 3, by: 'b' };
  remote.pieces[b] = { ...remote.pieces[b], x: 900, y: 900, version: 8, by: 'b' };
  const merged = mergeDocuments(local, remote);
  assert.equal(merged.pieces[a].x, 100, 'local has the newer version for a');
  assert.equal(merged.pieces[b].x, 900, 'remote has the newer version for b');
});

test('mergeDocuments breaks a version tie by peer id, same both ways', () => {
  const id = pieceId('green', 2, 2);
  const a = documentWithPiece(id, { x: 10, y: 10 }, 7, 'aaa');
  const b = documentWithPiece(id, { x: 20, y: 20 }, 7, 'bbb');
  assert.equal(mergeDocuments(a, b).pieces[id].x, 20, 'higher peer id wins');
  assert.equal(mergeDocuments(b, a).pieces[id].x, 20, 'and wins from either side');
});

test('equal-version divergence resolves deterministically', () => {
  const id = pieceId('blue', 1, 3);
  const a = documentWithPiece(id, { x: 10, y: 10, kind: 'star' }, 9, 'peer-a');
  const b = documentWithPiece(id, { x: 20, y: 20, kind: 'ship' }, 9, 'peer-b');
  const first = mergeDocuments(a, b).pieces[id];
  const second = mergeDocuments(b, a).pieces[id];
  assert.deepEqual(first, second, 'both peers compute the same winner');
  assert.equal(first.by, 'peer-b');
});

test('mergeDocuments carries a newer remote reset', () => {
  const local = createDocument('g1');
  const remote = resetDocument(local, 42, 'b');
  const merged = mergeDocuments(local, remote);
  assert.equal(merged.resetVersion, 42);
  assert.equal(merged.resetBy, 'b');
});

test('mergeDocuments tolerates a remote without pieces or camera', () => {
  const local = createDocument('g1');
  const merged = mergeDocuments(local, { gameId: 'g1' });
  assert.equal(Object.keys(merged.pieces).length, 36);
  assert.deepEqual(merged.camera, local.camera);
});

test('mergeDocuments keeps the local game identity', () => {
  const local = createDocument('game-7');
  const remote = createDocument('game-9');
  assert.equal(mergeDocuments(local, remote).gameId, 'game-7');
});

test('mergeDocuments includes a piece that only the remote has', () => {
  const id = pieceId('yellow', 3, 3);
  const local = createDocument('g1');
  const remote = createDocument('g1');
  remote.pieces[id] = { ...remote.pieces[id], x: 123, y: 234, version: 5, by: 'b' };
  // The local replica never saw this piece at all.
  delete local.pieces[id];

  const merged = mergeDocuments(local, remote);
  assert.ok(merged.pieces[id], 'the remote-only piece survives the merge');
  assert.equal(merged.pieces[id].x, 123);
  assert.equal(merged.pieces[id].by, 'b');
  // merging the other way round keeps it too
  const reverse = mergeDocuments(remote, local);
  assert.equal(reverse.pieces[id].x, 123);
});

test('mergeDocuments ignores a corrupt remote-only piece', () => {
  const local = createDocument('g1');
  const remote = createDocument('g1');
  remote.pieces['purple-huge-9'] = {
    id: 'purple-huge-9', color: 'purple', size: 9, kind: 'ship', x: 1, y: 1, rotation: 0, version: 5, by: 'b',
  };
  const merged = mergeDocuments(local, remote);
  assert.equal(merged.pieces['purple-huge-9'], undefined);
});
