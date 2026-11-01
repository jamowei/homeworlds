// presence/messages.js
//
// Pure helpers for the presence channel. Presence is transient UI state — a
// cursor position in world coordinates, or the id of the piece a peer is
// currently dragging. It rides the same transport hub as board changes, but it
// is never fed through `applyMessage`: it must not mutate the document.

export function buildCursorMessage({ id, by, name = '', x, y }) {
  return { type: 'cursor', id, by, name, cursor: { x, y } };
}

export function buildDragMessage({ id, by, name = '', pieceId }) {
  return { type: 'drag', id, by, name, pieceId: pieceId || null };
}

// Normalise an incoming presence message into the patch shape the renderer
// consumes (`{ cursor }` or `{ draggingId }`, both with `name`). Returns null
// for anything that is not a well-formed presence message, so a bad byte can
// never reach the renderer.
export function readPresence(message) {
  if (!message || typeof message !== 'object') return null;
  const name = typeof message.name === 'string' ? message.name : '';
  if (message.type === 'cursor') {
    const cursor = message.cursor;
    if (!cursor || typeof cursor !== 'object') return null;
    if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null;
    return { cursor: { x: cursor.x, y: cursor.y }, name };
  }
  if (message.type === 'drag') {
    const pieceId = typeof message.pieceId === 'string' && message.pieceId ? message.pieceId : null;
    return { draggingId: pieceId, name };
  }
  return null;
}
