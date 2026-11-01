// app.js — wiring for the shared board page.
//
// Tickets so far: 01 paints the initial board, 05 adds the camera (pan, wheel
// zoom, pinch, +/− buttons), 06 adds autosave/resume. Later tickets extend this
// file with piece input, transports and presence.

import { createDocument, applyMessage, buildCameraMessage, buildPieceMessage } from './core/state.js';
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
