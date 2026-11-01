import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCursorMessage, buildDragMessage, readPresence } from './messages.js';

// Presence messages are transient: they carry a cursor position (world coords)
// or the id of the piece currently being dragged, plus the sender's name. They
// are never fed through applyMessage and never mutate the document.

test('a cursor message round-trips through readPresence', () => {
  const message = buildCursorMessage({ id: 'm1', by: 'peer-a', name: 'Ada', x: 120, y: 40 });
  assert.equal(message.type, 'cursor');
  assert.equal(message.by, 'peer-a');
  assert.equal(message.id, 'm1');
  assert.deepEqual(readPresence(message), { cursor: { x: 120, y: 40 }, name: 'Ada' });
});

test('a drag message carries the dragged piece, and null on release', () => {
  const start = buildDragMessage({ id: 'm2', by: 'peer-a', name: 'Ada', pieceId: 'red-large-1' });
  assert.deepEqual(readPresence(start), { draggingId: 'red-large-1', name: 'Ada' });
  const end = buildDragMessage({ id: 'm3', by: 'peer-a', name: 'Ada', pieceId: null });
  assert.deepEqual(readPresence(end), { draggingId: null, name: 'Ada' });
});

test('readPresence rejects non-presence and malformed messages', () => {
  assert.equal(readPresence({ type: 'piece', id: 'x' }), null);
  assert.equal(readPresence({ type: 'cursor', id: 'x', cursor: { x: NaN, y: 1 } }), null);
  assert.equal(readPresence({ type: 'cursor', id: 'x' }), null);
  assert.equal(readPresence(null), null);
  assert.equal(readPresence('nope'), null);
});
