// app.js — wiring for the shared board page.
//
// Tickets so far: 01 paints the initial board, 02/03 add piece input, 04 adds
// Reset, 05 adds the camera, 06 adds autosave/resume. Later tickets extend this
// file with transports and presence.

import { createDocument, applyMessage, buildCameraMessage, buildPieceMessage, buildResetMessage } from './core/state.js';
import { createRenderer } from './render/svg.js';
import { createStore } from './storage/store.js';

const PEER_ID = 'local';
const SAVE_DEBOUNCE_MS = 300;

const svg = document.getElementById('board');
const store = createStore();

// Resume the game we were last in: an explicit `?game=` wins, then the
// remembered id, then the local default. With no storage this is just `local`.
const requestedGameId = new URLSearchParams(location.search).get('game');
const gameId = requestedGameId || store.lastGameId() || 'local';
store.rememberGameId(gameId);

const saved = store.loadDocument(gameId);
let doc = saved && saved.pieces && saved.camera ? saved : createDocument(gameId);

const renderer = createRenderer(svg, { onOperation: handleOperation });

// Autosave: every document change is persisted, debounced, with no Save button.
// When storage is unavailable `saveDocument` is a no-op and the document simply
// lives in memory for this session.
let saveTimer = null;
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  store.saveDocument(doc);
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
}

function setDocument(next) {
  doc = next;
  renderer.render(doc);
  scheduleSave();
}

function handleOperation(op) {
  switch (op.type) {
    case 'move': {
      const message = buildPieceMessage(doc, op.id, { x: op.x, y: op.y }, PEER_ID);
      if (message) setDocument(applyMessage(doc, message));
      break;
    }
    case 'rotate': {
      const piece = doc.pieces[op.id];
      if (!piece || piece.kind !== 'ship') break;
      const rotation = piece.rotation === 0 ? 180 : 0;
      const message = buildPieceMessage(doc, op.id, { rotation }, PEER_ID);
      if (message) setDocument(applyMessage(doc, message));
      break;
    }
    case 'flip': {
      const piece = doc.pieces[op.id];
      if (!piece) break;
      const kind = piece.kind === 'ship' ? 'star' : 'ship';
      const message = buildPieceMessage(doc, op.id, { kind }, PEER_ID);
      if (message) setDocument(applyMessage(doc, message));
      break;
    }
    case 'camera': {
      const message = buildCameraMessage(doc, op.camera, PEER_ID);
      setDocument(applyMessage(doc, message));
      break;
    }
    default:
      break;
  }
}

renderer.render(doc);
requestAnimationFrame(() => renderer.measure());

// A final flush on unload so a reload never loses the last debounced change.
addEventListener('pagehide', flushSave);

document.getElementById('zoom-in')?.addEventListener('click', () => renderer.zoomBy(1.25));
document.getElementById('zoom-out')?.addEventListener('click', () => renderer.zoomBy(0.8));

document.getElementById('reset')?.addEventListener('click', () => {
  const confirmed = window.confirm(
    'Wirklich zurücksetzen? Alle 36 Steine gehen in die Bank zurück und der Gegner sieht denselben Zustand.',
  );
  if (!confirmed) return;
  const message = buildResetMessage(doc, PEER_ID);
  setDocument(applyMessage(doc, message));
});
