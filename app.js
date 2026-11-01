// app.js — wiring for the shared board page.
//
// Tickets so far: 01 paints the initial board, 02/03 add piece input, 04 adds
// Reset, 05 adds the camera, 06 adds autosave/resume, 07 adds same-browser sync
// through the transport hub. Later tickets extend this file with WebRTC,
// identity/handshake, presence and fallbacks.

import {
  createDocument,
  applyMessage,
  buildCameraMessage,
  buildPieceMessage,
  buildResetMessage,
} from './core/state.js';
import { createRenderer } from './render/svg.js';
import { createStore } from './storage/store.js';
import { createHub } from './transport/hub.js';
import { createBroadcastTransport } from './transport/broadcast.js';

const PEER_ID = 'local';
const SAVE_DEBOUNCE_MS = 300;

const svg = document.getElementById('board');
const statusEl = document.getElementById('status');
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

// --- Sync ---------------------------------------------------------------

const hub = createHub({
  onMessage: receiveRemote,
  onStatus: updateStatus,
});

// Same-browser tabs always share one board with zero setup.
hub.add(createBroadcastTransport(`hw-board:${gameId}`));

function dispatch(message) {
  if (!message) return;
  setDocument(applyMessage(doc, message));
  hub.send(message);
}

function receiveRemote(message) {
  const next = applyMessage(doc, message);
  if (next !== doc) setDocument(next);
}

function updateStatus(status) {
  if (!statusEl) return;
  const known = ['connected', 'waiting', 'disconnected', 'unavailable'];
  const state = known.includes(status) ? status : 'offline';
  statusEl.dataset.state = state;
  statusEl.textContent = {
    connected: 'Verbunden',
    waiting: 'Warte auf Gegner',
    disconnected: 'Getrennt',
    unavailable: 'Kein Sync verfügbar',
    offline: 'Nicht verbunden',
  }[state];
}

// --- Local operations ---------------------------------------------------

function handleOperation(op) {
  switch (op.type) {
    case 'move': {
      dispatch(buildPieceMessage(doc, op.id, { x: op.x, y: op.y }, PEER_ID));
      break;
    }
    case 'rotate': {
      const piece = doc.pieces[op.id];
      if (!piece || piece.kind !== 'ship') break;
      const rotation = piece.rotation === 0 ? 180 : 0;
      dispatch(buildPieceMessage(doc, op.id, { rotation }, PEER_ID));
      break;
    }
    case 'flip': {
      const piece = doc.pieces[op.id];
      if (!piece) break;
      const kind = piece.kind === 'ship' ? 'star' : 'ship';
      dispatch(buildPieceMessage(doc, op.id, { kind }, PEER_ID));
      break;
    }
    case 'camera': {
      dispatch(buildCameraMessage(doc, op.camera, PEER_ID));
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
  dispatch(buildResetMessage(doc, PEER_ID));
});
