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
//     pieces: { [id]: { id, color, size, kind, x, y, owner, version, by } },
//     camera: { x, y, zoom, version, by }
//   }
//
// `kind` is 'ship' (triangle) or 'star' (square). Coordinates are world units.
//
// A piece's `owner` records which player last moved it: null (neutral — nobody
// has touched it, e.g. it is still in the Bank), 'host' or 'guest'. It is NOT a
// stored rotation: the pointing direction is derived per viewer in
// `pieceFacing`, so a ship always points away from its owner, towards the other
// player. A star has no owner (it has no point and is shared by both players).

export const COLORS = ['yellow', 'green', 'red', 'blue'];
export const SIZES = [1, 2, 3];
export const KINDS = ['ship', 'star'];
// The two players. A piece's `owner` is one of these, or null when neutral.
export const ROLES = ['host', 'guest'];

export const SIZE_NAMES = { 1: 'small', 2: 'medium', 3: 'large' };

// One logical world, larger than a typical viewport, with a visible boundary.
export const WORLD = Object.freeze({ width: 3600, height: 1500 });

// The world used to be narrower. Boards saved back then keep their Bank pieces
// at the old coordinates (the Bank is anchored to the right edge), so
// `migrateBoard` re-homes them for the current world.
export const LEGACY_WORLD_WIDTH = 2400;

// The Bank is a fixed 4 colour rows x 3 size columns grid at the far-right
// edge of the world. Each cell holds `copies` identical pieces, fanned out by a
// small `[dx, dy]` offset so the stack reads as several pieces without the cell
// having to fit them side by side. Slots are static: a piece dragged out leaves
// its slot empty and nothing reflows. The cell is sized for the largest piece
// (see render/svg.js PIECE_SIZES).
export const BANK = Object.freeze({
  cellWidth: 150,
  cellHeight: 140,
  padding: 20,
  copies: 3,
  // Offsets of the three copies within a Bank cell, shared with the renderer
  // so the slots and the pieces line up. Deliberately small: the copies overlap.
  copyOffsets: Object.freeze([
    Object.freeze([-18, 12]),
    Object.freeze([0, 0]),
    Object.freeze([18, -12]),
  ]),
});

// The Bank as it was before it was compacted and given its own panel: 300x150
// cells with the three copies laid out horizontally. Boards saved against it
// are re-homed by `migrateBoard`.
export const LEGACY_BANK = Object.freeze({
  cellWidth: 300,
  cellHeight: 150,
  padding: 20,
  copies: 3,
  copyOffsets: Object.freeze([
    Object.freeze([-100, 0]),
    Object.freeze([0, 0]),
    Object.freeze([100, 0]),
  ]),
});

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1;
export const INITIAL_ZOOM = 0.4;

const HALF_EXTENT = 30; // clamping margin for a piece centre

const KNOWN_COLORS = new Set(COLORS);
const KNOWN_SIZES = new Set(SIZES);
const KNOWN_KINDS = new Set(KINDS);
const KNOWN_ROLES = new Set(ROLES);

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
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

// Geometry of the Bank grid. Pure and deterministic; the renderer and the
// tests both derive the same layout from it. `worldWidth` defaults to the
// current world and `bank` to the current Bank spec, but both can be
// overridden — e.g. to read an older board's layout during migration.
export function bankLayout(worldWidth = WORLD.width, bank = BANK) {
  const rows = COLORS.length;
  const cols = SIZES.length;
  const width = cols * bank.cellWidth;
  const height = rows * bank.cellHeight;
  const x = worldWidth - bank.padding - width;
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
        centerX: x + c * bank.cellWidth + bank.cellWidth / 2,
        centerY: y + r * bank.cellHeight + bank.cellHeight / 2,
        index: { row: r, col: c },
      };
    },
  };
}

// The rectangle the Bank occupies at the right edge of the world. The Bank has
// its own fixed panel in the UI (see render/svg.js); this is the world region
// that panel looks at, and the region Bank pieces sit in.
export function bankStrip(worldWidth = WORLD.width, bank = BANK) {
  const layout = bankLayout(worldWidth, bank);
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}

// A gap between the table edge and the Bank strip, so the two never touch.
export const BANK_GAP = 60;

// Width of the table: the world minus the Bank strip and that gap. The board
// camera is clamped to this, so the Bank never appears on the board itself.
export function playfieldWidth(worldWidth = WORLD.width) {
  return bankStrip(worldWidth).x - BANK_GAP;
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

// The deterministic Bank slot every piece starts in and returns to. Derived
// from the Bank layout, so "send home" never needs to store the origin: the
// slot is a pure function of the piece id. Cached per world width so the
// migration below can also ask for an older world's slots.
function homesFor(worldWidth, bank) {
  const layout = bankLayout(worldWidth, bank);
  const homes = {};
  for (const color of COLORS) {
    for (const size of SIZES) {
      const cell = layout.cellFor(color, size);
      for (let copy = 1; copy <= bank.copies; copy++) {
        const [dx, dy] = bank.copyOffsets[copy - 1];
        homes[pieceId(color, size, copy)] = {
          x: cell.centerX + dx,
          y: cell.centerY + dy,
        };
      }
    }
  }
  return homes;
}

const HOME_CACHE = new Map();
function homePositions(worldWidth) {
  let homes = HOME_CACHE.get(worldWidth);
  if (homes) return homes;
  homes = homesFor(worldWidth, BANK);
  HOME_CACHE.set(worldWidth, homes);
  return homes;
}

export function homePosition(id, worldWidth = WORLD.width) {
  return homePositions(worldWidth)[id] || null;
}

// Re-home Bank pieces saved against an older layout. A piece sitting exactly on
// a legacy Bank slot moves to its current slot; every other piece (i.e. anything
// out on the play field) is left alone. Two legacy layouts are known: the
// original Bank in the narrow world, and that same Bank in the current world.
// Idempotent: after one pass no piece is on a legacy slot any more.
const LEGACY_BANK_LAYOUTS = [
  { worldWidth: LEGACY_WORLD_WIDTH, bank: LEGACY_BANK },
  { worldWidth: WORLD.width, bank: LEGACY_BANK },
];

export function migrateBoard(doc) {
  if (!doc || !doc.pieces) return doc;
  const newHomes = homePositions(WORLD.width);
  const legacyHomes = LEGACY_BANK_LAYOUTS.map(({ worldWidth, bank }) => homesFor(worldWidth, bank));
  let changed = false;
  const pieces = { ...doc.pieces };
  for (const [id, piece] of Object.entries(pieces)) {
    const newHome = newHomes[id];
    if (!newHome) continue;
    const onLegacySlot = legacyHomes.some((homes) => {
      const oldHome = homes[id];
      return oldHome && piece.x === oldHome.x && piece.y === oldHome.y;
    });
    if (onLegacySlot && (piece.x !== newHome.x || piece.y !== newHome.y)) {
      pieces[id] = { ...piece, x: newHome.x, y: newHome.y };
      changed = true;
    }
  }
  return changed ? { ...doc, pieces } : doc;
}

export function createDocument(gameId = 'local', meta = {}) {
  const pieces = {};
  COLORS.forEach((color) => {
    SIZES.forEach((size) => {
      for (let copy = 1; copy <= BANK.copies; copy++) {
        const id = pieceId(color, size, copy);
        const home = homePosition(id);
        pieces[id] = {
          id,
          color,
          size,
          kind: 'ship',
          x: home.x,
          y: home.y,
          owner: null,
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
      x: playfieldWidth() / 2,
      y: WORLD.height / 2,
      zoom: INITIAL_ZOOM,
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
  if (piece.owner != null && !KNOWN_ROLES.has(piece.owner)) return false;
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

// The one place a piece is normalised, shared by the sync reducer and the JSON
// import. `known` is the piece the document already holds for that id; it fixes
// the immutable identity. Returns a clean piece (finite clamped coordinates, a
// numeric version, a string author) or null when the input is not a valid,
// identity-preserving piece. Keeps identical semantics on both paths: known id,
// immutable colour/size, valid kind/owner, finite clamped coords.
export function normalisePiece(piece, known) {
  if (!isValidPiece(piece)) return null;
  if (!known || piece.id !== known.id) return null;
  if (piece.color !== known.color || piece.size !== known.size) return null;
  return {
    id: piece.id,
    color: piece.color,
    size: piece.size,
    kind: piece.kind,
    x: clampX(piece.x),
    y: clampY(piece.y),
    owner: piece.owner == null ? null : piece.owner,
    version: Number(piece.version),
    by: typeof piece.by === 'string' ? piece.by : '',
  };
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
// `changes.owner` may be null (neutral); an undefined owner keeps the current
// one.
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
    owner: changes.owner !== undefined ? changes.owner : current.owner,
    version: nextVersion(doc),
    by,
  };
  return { type: 'piece', id: messageId(), by, piece };
}

// Flip a piece between triangle (ship) and square (star), in place, preserving
// colour and size. `owner` is the role of the player flipping: the resulting
// ship belongs to whoever made it, while a star has no owner (it is shared).
export function buildFlipMessage(doc, id, by = '', owner = null) {
  const piece = doc?.pieces?.[id];
  if (!piece) return null;
  const kind = piece.kind === 'ship' ? 'star' : 'ship';
  return buildPieceMessage(doc, id, { kind, owner: kind === 'ship' ? owner : null }, by);
}

// Send a piece home: back to its deterministic Bank slot as an upright ship.
// It becomes neutral (belongs to nobody), so both players see it pointing up
// until one of them moves it again.
export function buildSendHomeMessage(doc, id, by = '') {
  const piece = doc?.pieces?.[id];
  const home = homePosition(id);
  if (!piece || !home) return null;
  return buildPieceMessage(doc, id, { kind: 'ship', x: home.x, y: home.y, owner: null }, by);
}

// How a piece should read to one player. A ship points up unless the *other*
// player owns it, in which case it points down towards the viewer; a neutral
// piece (nobody's) and one's own ship both point up. Stars have no point, so
// they always return 0. `localRole` is 'host' or 'guest'.
export function pieceFacing(piece, localRole) {
  if (!piece || piece.kind !== 'ship') return 0;
  return piece.owner && piece.owner !== localRole ? 180 : 0;
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
  const normalised = normalisePiece(piece, piece ? doc.pieces[piece.id] : null);
  if (!normalised) return doc;
  const current = doc.pieces[normalised.id];
  const by = typeof message.by === 'string' ? message.by : '';
  if (!isNewer(normalised.version, by, current.version, current.by)) return doc;
  return withPiece(doc, { ...normalised, by });
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

// Merge two whole documents after a reconnect. Every conflict is resolved the
// same way on both peers, without asking the user: per piece, the newest
// `version` wins and equal versions are tie-broken by peer id. The camera and
// the Reset baselines follow the same last-write-wins rule. The local document
// always keeps its own game identity, and a remote missing pieces or a camera
// (a corrupt or partial sync) can never break the local board.
export function mergeDocuments(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const remotePieces = remote.pieces && typeof remote.pieces === 'object' ? remote.pieces : {};
  const localPieces = local.pieces && typeof local.pieces === 'object' ? local.pieces : {};
  const out = { ...local, pieces: { ...localPieces } };

  if (isNewer(remote.resetVersion, remote.resetBy, local.resetVersion, local.resetBy)) {
    out.resetVersion = remote.resetVersion;
    out.resetBy = remote.resetBy;
  }

  for (const id of Object.keys(localPieces)) {
    const mine = localPieces[id];
    const theirs = remotePieces[id];
    if (!theirs) continue;
    out.pieces[id] = isNewer(theirs.version, theirs.by, mine.version, mine.by) ? theirs : mine;
  }

  // Pieces the local replica has never seen still arrive, still per-piece LWW.
  // A corrupt remote-only piece is dropped rather than trusted.
  for (const id of Object.keys(remotePieces)) {
    if (id in out.pieces) continue;
    const theirs = remotePieces[id];
    if (isValidPiece(theirs) && theirs.id === id) {
      out.pieces[id] = theirs;
    }
  }

  const localCamera = local.camera;
  const remoteCamera = remote.camera;
  if (localCamera && remoteCamera && isNewer(remoteCamera.version, remoteCamera.by, localCamera.version, localCamera.by)) {
    out.camera = remoteCamera;
  }

  return out;
}

let idCounter = 0;
export function messageId() {
  idCounter += 1;
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${rand}`;
}
