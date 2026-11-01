// core/io.js
//
// Ticket 13: the pure JSON export/import fallback. This is the escape hatch
// when WebRTC is impossible (no server, no TURN, chat-only handoff): a player
// exports the board as a JSON blob and the opponent imports it.
//
// It reuses the very same validation as the sync reducer (`isValidPiece` /
// `isValidCamera`), so a hand-copied board obeys exactly the rules a network
// message does: only known ids, valid colour/size/kind/rotation and finite
// coordinates survive, and corrupt JSON is refused outright. No DOM, no
// storage, no network live here.
//
// Public seam:
//   exportDocument(doc)                       -> JSON string
//   importDocument(json, { fallbackGameId })  -> validated document, or null

import {
  createDocument,
  isKnownId,
  isValidPiece,
  isValidCamera,
  clampX,
  clampY,
  clampZoom,
} from './state.js';

export const BOARD_FORMAT_VERSION = 1;

// Serialise the full board state a peer would need: identity, reset marker,
// every known piece (with its LWW version) and the camera. Deterministic.
export function exportDocument(doc) {
  return JSON.stringify({
    v: BOARD_FORMAT_VERSION,
    gameId: doc?.gameId ?? 'local',
    resetVersion: Number.isFinite(Number(doc?.resetVersion)) ? Number(doc.resetVersion) : 0,
    resetBy: typeof doc?.resetBy === 'string' ? doc.resetBy : '',
    pieces: doc?.pieces ?? {},
    camera: doc?.camera
      ? {
          x: doc.camera.x,
          y: doc.camera.y,
          zoom: doc.camera.zoom,
          version: Number.isFinite(Number(doc.camera.version)) ? Number(doc.camera.version) : 0,
          by: typeof doc.camera.by === 'string' ? doc.camera.by : '',
        }
      : undefined,
  });
}

// Rebuild a complete document from a pasted JSON blob. The result always has
// all 36 pieces: valid ones from the blob are overlaid, anything invalid falls
// back to the deterministic initial slot, so a bad byte can never break the
// board. Structural corruption (unparseable / non-object / a malformed pieces
// map) returns null; the caller then keeps its current board.
export function importDocument(json, { fallbackGameId = 'local' } = {}) {
  if (typeof json !== 'string') return null;
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const gameId = typeof data.gameId === 'string' && data.gameId ? data.gameId : fallbackGameId || 'local';
  const base = createDocument(gameId);

  if (data.pieces != null) {
    if (typeof data.pieces !== 'object' || Array.isArray(data.pieces)) return null;
    for (const [id, piece] of Object.entries(data.pieces)) {
      if (!isValidPiece(piece)) continue;
      if (piece.id !== id || !isKnownId(id)) continue;
      const known = base.pieces[id];
      // Identity is immutable, exactly as on the sync path.
      if (!known || piece.color !== known.color || piece.size !== known.size) continue;
      base.pieces[id] = {
        id,
        color: piece.color,
        size: piece.size,
        kind: piece.kind,
        x: clampX(piece.x),
        y: clampY(piece.y),
        rotation: piece.rotation,
        version: Number(piece.version),
        by: typeof piece.by === 'string' ? piece.by : '',
      };
    }
  }

  if (isValidCamera(data.camera)) {
    base.camera = {
      x: data.camera.x,
      y: data.camera.y,
      zoom: clampZoom(data.camera.zoom),
      version: Number.isFinite(Number(data.camera.version)) ? Number(data.camera.version) : 0,
      by: typeof data.camera.by === 'string' ? data.camera.by : '',
    };
  }

  if (Number.isFinite(Number(data.resetVersion))) base.resetVersion = Number(data.resetVersion);
  if (typeof data.resetBy === 'string') base.resetBy = data.resetBy;

  return base;
}
