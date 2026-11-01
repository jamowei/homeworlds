// core/state.js
//
// The single pure, dependency-free module of the shared board. It owns the
// document model and every rule about how a document changes. No DOM, no
// timers, no network, no storage live here.
//
// Public seam:
//   createDocument(gameId, meta)      -> deterministic initial document
//   applyMessage(document, message)   -> new document, or the same document
//                                        if the message is stale/invalid
//   mergeDocuments(local, remote)     -> per-piece merge
//   resetDocument(document, ...)      -> initial document, keeping identity
//
// A document looks like:
//   {
//     gameId, meta,
//     resetVersion, resetBy,
//     pieces: { [id]: { id, color, size, kind, x, y, rotation, version, by } },
//     camera: { x, y, zoom, version, by }
//   }
//
// `kind` is 'ship' (triangle) or 'star' (square). `rotation` is 0 or 180 (the
// angle a triangle remembers across a flip). Coordinates are world units.

export const COLORS = ['yellow', 'green', 'red', 'blue'];
export const SIZES = [1, 2, 3];
export const KINDS = ['ship', 'star'];
export const ROTATIONS = [0, 180];

export const SIZE_NAMES = { 1: 'small', 2: 'medium', 3: 'large' };

// One logical world, larger than a typical viewport, with a visible boundary.
export const WORLD = Object.freeze({ width: 2400, height: 1500 });

// The Bank is a fixed 4 colour rows x 3 size columns grid at the far-right
// edge of the world. Each cell holds `copies` identical pieces. Slots are
// static: a piece dragged out leaves its slot empty and nothing reflows.
export const BANK = Object.freeze({
  cellWidth: 180,
  cellHeight: 200,
  padding: 20,
  copies: 3,
});

const COPY_OFFSETS = [-54, 0, 54];
const HALF_EXTENT = 30; // clamping margin for a piece centre

const KNOWN_COLORS = new Set(COLORS);
const KNOWN_SIZES = new Set(SIZES);
const KNOWN_KINDS = new Set(KINDS);
const KNOWN_ROTATIONS = new Set(ROTATIONS);

export function pieceId(color, size, copy) {
  return `${color}-${SIZE_NAMES[size]}-${copy}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampX(x) {
  return clamp(x, HALF_EXTENT, WORLD.width - HALF_EXTENT);
}

export function clampY(y) {
  return clamp(y, HALF_EXTENT, WORLD.height - HALF_EXTENT);
}

export function clampZoom(zoom) {
  return clamp(zoom, 0.25, 4);
}

// Geometry of the Bank grid. Pure and deterministic; the renderer and the
// tests both derive the same layout from it.
export function bankLayout() {
  const rows = COLORS.length;
  const cols = SIZES.length;
  const width = cols * BANK.cellWidth;
  const height = rows * BANK.cellHeight;
  const x = WORLD.width - BANK.padding - width;
  const y = (WORLD.height - height) / 2;
  return {
    rows,
    cols,
    width,
    height,
    x,
    y,
    cellFor(color, size) {
      const r = COLORS.indexOf(color);
      const c = SIZES.indexOf(size);
      return {
        centerX: x + c * BANK.cellWidth + BANK.cellWidth / 2,
        centerY: y + r * BANK.cellHeight + BANK.cellHeight / 2,
        index: { row: r, col: c },
      };
    },
  };
}

const KNOWN_IDS = (() => {
  const ids = new Set();
  for (const color of COLORS) {
    for (const size of SIZES) {
      for (let copy = 1; copy <= BANK.copies; copy++) {
        ids.add(pieceId(color, size, copy));
      }
    }
  }
  return ids;
})();

export function isKnownId(id) {
  return KNOWN_IDS.has(id);
}

export function createDocument(gameId = 'local', meta = {}) {
  const layout = bankLayout();
  const pieces = {};
  COLORS.forEach((color) => {
    SIZES.forEach((size) => {
      const cell = layout.cellFor(color, size);
      for (let copy = 1; copy <= BANK.copies; copy++) {
        const id = pieceId(color, size, copy);
        pieces[id] = {
          id,
          color,
          size,
          kind: 'ship',
          x: cell.centerX + COPY_OFFSETS[copy - 1],
          y: cell.centerY,
          rotation: 0,
          version: 0,
          by: '',
        };
      }
    });
  });
  return {
    gameId,
    meta: { ...meta },
    resetVersion: 0,
    resetBy: '',
    pieces,
    camera: {
      x: WORLD.width / 2,
      y: WORLD.height / 2,
      zoom: 1,
      version: 0,
      by: '',
    },
  };
}

// Last-write-wins comparison. Strictly newer version wins; equal versions are
// tie-broken by peer id so both replicas agree on the same winner.
export function isNewer(aVersion, aBy, bVersion, bBy) {
  const av = Number(aVersion);
  const bv = Number(bVersion);
  if (!Number.isFinite(av)) return false;
  if (!Number.isFinite(bv)) return true;
  if (av !== bv) return av > bv;
  return String(aBy ?? '') > String(bBy ?? '');
}

export function isValidPiece(piece) {
  if (!piece || typeof piece !== 'object') return false;
  if (!isKnownId(piece.id)) return false;
  if (!KNOWN_COLORS.has(piece.color)) return false;
  if (!KNOWN_SIZES.has(piece.size)) return false;
  if (!KNOWN_KINDS.has(piece.kind)) return false;
  if (!KNOWN_ROTATIONS.has(piece.rotation)) return false;
  if (!Number.isFinite(piece.x) || !Number.isFinite(piece.y)) return false;
  if (!Number.isFinite(Number(piece.version))) return false;
  return true;
}

export function isValidCamera(camera) {
  if (!camera || typeof camera !== 'object') return false;
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)) return false;
  if (!Number.isFinite(camera.zoom)) return false;
  return true;
}

function withPiece(doc, piece) {
  return { ...doc, pieces: { ...doc.pieces, [piece.id]: piece } };
}

function maxPieceVersion(doc) {
  let max = 0;
  for (const p of Object.values(doc.pieces)) {
    if (Number.isFinite(p.version) && p.version > max) max = p.version;
  }
  return max;
}

function nextVersion(doc) {
  return Math.max(
    maxPieceVersion(doc),
    Number(doc.resetVersion) || 0,
    Number(doc.camera?.version) || 0,
  ) + 1;
}

// Build a local piece mutation. The caller applies the returned message with
// `applyMessage` and broadcasts it, so the local and remote paths are identical.
export function buildPieceMessage(doc, id, changes = {}, by = '') {
  const current = doc.pieces[id];
  if (!current) return null;
  const piece = {
    id,
    color: current.color,
    size: current.size,
    kind: changes.kind ?? current.kind,
    x: Number.isFinite(changes.x) ? changes.x : current.x,
    y: Number.isFinite(changes.y) ? changes.y : current.y,
    rotation: changes.rotation ?? current.rotation,
    version: nextVersion(doc),
    by,
  };
  return { type: 'piece', id: messageId(), by, piece };
}

export function buildCameraMessage(doc, camera, by = '') {
  return {
    type: 'camera',
    id: messageId(),
    by,
    camera: {
      x: camera.x,
      y: camera.y,
      zoom: clampZoom(camera.zoom),
      version: nextVersion(doc),
      by,
    },
  };
}

export function buildResetMessage(doc, by = '') {
  return { type: 'reset', id: messageId(), by, version: nextVersion(doc) };
}

function applyPieceMessage(doc, message) {
  const piece = message.piece;
  if (!isValidPiece(piece)) return doc;
  const current = doc.pieces[piece.id];
  if (!current) return doc;
  // Identity (colour/size) is immutable: reject any attempt to change it.
  if (piece.color !== current.color || piece.size !== current.size) return doc;
  const by = typeof message.by === 'string' ? message.by : '';
  if (!isNewer(piece.version, by, current.version, current.by)) return doc;
  return withPiece(doc, {
    ...current,
    kind: piece.kind,
    rotation: piece.rotation,
    x: clampX(piece.x),
    y: clampY(piece.y),
    version: Number(piece.version),
    by,
  });
}

function applyResetMessage(doc, message) {
  const version = Number(message.version);
  if (!Number.isFinite(version)) return doc;
  const by = typeof message.by === 'string' ? message.by : '';
  if (!isNewer(version, by, doc.resetVersion, doc.resetBy)) return doc;
  return resetDocument(doc, version, by);
}

function applyCameraMessage(doc, message) {
  const camera = message.camera;
  if (!isValidCamera(camera)) return doc;
  const by = typeof message.by === 'string' ? message.by : '';
  if (!isNewer(camera.version, by, doc.camera.version, doc.camera.by)) return doc;
  return {
    ...doc,
    camera: {
      x: camera.x,
      y: camera.y,
      zoom: clampZoom(camera.zoom),
      version: Number(camera.version),
      by,
    },
  };
}

export function applyMessage(doc, message) {
  if (!doc || !message || typeof message !== 'object') return doc;
  switch (message.type) {
    case 'piece':
      return applyPieceMessage(doc, message);
    case 'reset':
      return applyResetMessage(doc, message);
    case 'camera':
      return applyCameraMessage(doc, message);
    default:
      return doc;
  }
}

// Reset restores the exact initial document (all triangles, ordered Bank) while
// keeping the game identity. Every piece is stamped at the reset version so a
// stale pre-reset move can no longer win.
export function resetDocument(doc, version, by = '') {
  const fresh = createDocument(doc?.gameId ?? 'local', doc?.meta ?? {});
  const v = Number.isFinite(Number(version)) ? Number(version) : nextVersion(doc ?? fresh);
  fresh.resetVersion = v;
  fresh.resetBy = by;
  for (const id of Object.keys(fresh.pieces)) {
    fresh.pieces[id].version = v;
    fresh.pieces[id].by = by;
  }
  fresh.camera = { ...fresh.camera, version: v, by };
  return fresh;
}

export function mergeDocuments(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const out = { ...local, pieces: { ...local.pieces } };

  if (isNewer(remote.resetVersion, remote.resetBy, local.resetVersion, local.resetBy)) {
    out.resetVersion = remote.resetVersion;
    out.resetBy = remote.resetBy;
  }

  for (const id of Object.keys(local.pieces)) {
    const mine = local.pieces[id];
    const theirs = remote.pieces[id];
    if (!theirs) continue;
    out.pieces[id] = isNewer(theirs.version, theirs.by, mine.version, mine.by) ? theirs : mine;
  }

  if (isNewer(remote.camera.version, remote.camera.by, local.camera.version, local.camera.by)) {
    out.camera = remote.camera;
  }

  return out;
}

let idCounter = 0;
export function messageId() {
  idCounter += 1;
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${rand}`;
}
