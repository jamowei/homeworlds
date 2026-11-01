import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCursorMessage, buildDragMessage, readPresence } from './messages.js';

// Presence messages are transient: they carry a cursor position (world coords)
// or the id of the piece currently being dragged. The builders are pure payload
// builders — the app stamps `id`, `by` and `name` onto them before sending, and
// they are never fed through applyMessage, so they never mutate the document.

test('buildCursorMessage is a bare payload the app can stamp', () => {
  assert.deepEqual(buildCursorMessage(120, 40), { type: 'cursor', x: 120, y: 40 });
});

test('a cursor message round-trips through readPresence', () => {
  const payload = buildCursorMessage(120, 40);
  const message = { ...payload, id: 'm1', by: 'peer-a', name: 'Ada' };
  assert.equal(message.id, 'm1');
  assert.equal(message.by, 'peer-a');
  assert.deepEqual(readPresence(message), { cursor: { x: 120, y: 40 }, name: 'Ada' });
});

test('buildDragMessage is a bare payload, null on release', () => {
  assert.deepEqual(buildDragMessage('red-large-1'), { type: 'drag', pieceId: 'red-large-1' });
  assert.deepEqual(buildDragMessage(null), { type: 'drag', pieceId: null });
});

test('a drag message carries the dragged piece, and null on release', () => {
  const start = buildDragMessage('red-large-1');
  assert.deepEqual(readPresence({ ...start, id: 'm2', by: 'peer-a', name: 'Ada' }), {
    draggingId: 'red-large-1',
    name: 'Ada',
  });
  const end = buildDragMessage(null);
  assert.deepEqual(readPresence({ ...end, id: 'm3', by: 'peer-a', name: 'Ada' }), {
    draggingId: null,
    name: 'Ada',
  });
});

test('readPresence rejects non-presence and malformed messages', () => {
  assert.equal(readPresence({ type: 'piece', id: 'x' }), null);
  assert.equal(readPresence({ type: 'cursor', id: 'x', x: NaN, y: 1 }), null);
  assert.equal(readPresence({ type: 'cursor', id: 'x' }), null);
  assert.equal(readPresence(null), null);
  assert.equal(readPresence('nope'), null);
});
