// app.js — wiring for the shared board page.
//
// 01 paints the board, 02/03 add piece input, 04 Reset, 05 the camera, 06
// autosave/resume, 07 same-browser sync, 08 the signalling codec, 09 the
// identity gate and the two-way invite/reply handshake. Later tickets extend
// this file with WebRTC hardening, merge, presence and fallbacks.

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
import { createPeerRegistry } from './transport/peers.js';
import { createWebRtcTransport, isWebRtcSupported } from './transport/webrtc.js';
import { encodeFragment, decodeFragment, encodePaste, decodePaste } from './signalling/codec.js';
import { exportDocument, importDocument } from './core/io.js';

const SAVE_DEBOUNCE_MS = 300;
const NAME_KEY = 'hw-name';

// A per-session peer id: it is the last-write-wins tiebreak between two peers.
const PEER_ID = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 12);

const $ = (id) => document.getElementById(id);
const svg = $('board');
const statusEl = $('status');
const store = createStore();

// --- Identity -----------------------------------------------------------

const nameInput = $('player-name');
const savedName = safeGetItem(NAME_KEY);
if (nameInput && savedName) nameInput.value = savedName;

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function requireName() {
  const name = (nameInput?.value || '').trim() || 'Gast';
  safeSetItem(NAME_KEY, name);
  if (nameInput) nameInput.value = name;
  return name;
}

// --- Document + resume --------------------------------------------------

const requestedGameId = new URLSearchParams(location.search).get('game');
let gameId = requestedGameId || store.lastGameId() || 'local';
store.rememberGameId(gameId);

const saved = store.loadDocument(gameId);
let doc = saved && saved.pieces && saved.camera ? saved : createDocument(gameId);

const renderer = createRenderer(svg, { onOperation: handleOperation });

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

let opponentName = null;
const transportStatus = new Map();
const peers = createPeerRegistry({ self: PEER_ID, limit: 2 });
const rejectedPeers = new Set();

const hub = createHub({
  onMessage: receiveRemote,
  onStatus: (status, transport) => {
    transportStatus.set(transport, status);
    updateStatus();
    if (status === 'connected') onConnected(transport);
  },
});

let broadcast = null;
function useBroadcast(id) {
  if (broadcast) hub.remove(broadcast);
  broadcast = createBroadcastTransport(`hw-board:${id}`);
  hub.add(broadcast);
}
useBroadcast(gameId);

function aggregateStatus() {
  const active = [...transportStatus.values()].filter((v) => v !== 'available');
  if (active.includes('connected')) return 'connected';
  if (active.includes('waiting')) return 'waiting';
  if (active.length > 0 && active.every((v) => v === 'unavailable')) return 'unavailable';
  if (active.length > 0) return 'disconnected';
  return 'offline';
}

function updateStatus() {
  if (!statusEl) return;
  const state = aggregateStatus();
  statusEl.dataset.state = state;
  let text = {
    connected: 'Verbunden',
    waiting: 'Warte auf Gegner',
    disconnected: 'Getrennt',
    unavailable: 'Kein Sync verfügbar',
    offline: 'Nicht verbunden',
  }[state];
  if (state === 'connected' && opponentName) text += ` mit ${opponentName}`;
  statusEl.textContent = text;
}

function onConnected() {
  hideHandshake();
  hub.send({ type: 'hello', id: `${PEER_ID}-hello-${Math.random().toString(36).slice(2)}`, by: PEER_ID, name: requireName() });
}

function dispatch(message) {
  if (!message) return;
  setDocument(applyMessage(doc, message));
  hub.send(message);
}

function receiveRemote(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'hello') {
    if (message.by === PEER_ID || !message.by) return;
    if (!peers.has(message.by) && !peers.register(message.by)) {
      // Exactly two players: reject and ignore a third.
      rejectedPeers.add(message.by);
      hub.send({ type: 'reject', id: `${PEER_ID}-reject-${message.by}`, by: PEER_ID });
      return;
    }
    if (message.name) opponentName = message.name;
    updateStatus();
    return;
  }
  if (message.type === 'reject') return;
  if (message.by && rejectedPeers.has(message.by)) return;
  const next = applyMessage(doc, message);
  if (next !== doc) setDocument(next);
}

function switchGame(nextGameId) {
  if (!nextGameId || nextGameId === gameId) return;
  gameId = nextGameId;
  store.rememberGameId(gameId);
  doc = { ...doc, gameId };
  useBroadcast(gameId);
  scheduleSave();
}

// --- Handshake UI -------------------------------------------------------

let webrtc = null;

function baseUrl() {
  return location.origin + location.pathname + location.search;
}
function linkFor(blob) {
  return baseUrl() + encodeFragment(blob);
}
function decodeAnyBlob(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (trimmed.startsWith('#') || trimmed.includes('hw=')) return decodeFragment(trimmed);
  return decodePaste(trimmed);
}

function showGate(show) {
  const gate = $('gate');
  if (gate) gate.hidden = !show;
}
function showHandshake(config) {
  const panel = $('handshake');
  if (!panel) return;
  panel.hidden = false;
  $('handshake-title').textContent = config.title;
  $('handshake-help').textContent = config.help || '';
  $('handshake-link').value = config.link || '';
  $('handshake-blob').value = config.blob || '';
  const replyBox = $('reply-box');
  if (replyBox) replyBox.hidden = !config.reply;
  showError('handshake-error', '');
}
function hideHandshake() {
  const panel = $('handshake');
  if (panel) panel.hidden = true;
}
function showError(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

function newGameId() {
  return (globalThis.crypto?.randomUUID?.() || `g-${Math.random().toString(36).slice(2)}`).slice(0, 16);
}

function attachWebRtc(transport) {
  webrtc = transport;
  transport.onError = (event) => console.warn('WebRTC-Fehler', event);
  hub.add(transport);
  return transport;
}

async function createGame() {
  requireName();
  if (!isWebRtcSupported()) {
    showError('gate-error', 'Dieser Browser kann kein WebRTC – Peer-Verbindungen sind nicht möglich.');
    return;
  }
  showError('gate-error', '');
  switchGame(newGameId());
  const transport = attachWebRtc(createWebRtcTransport({ role: 'host', gameId }));
  try {
    const offer = await transport.createOffer();
    showGate(false);
    showHandshake({
      title: 'Einladung teilen',
      help: 'Sende diesen Link an deine Mitspielerin oder deinen Mitspieler. Sobald du die Antwort erhältst, füge sie unten ein.',
      link: linkFor(offer),
      blob: encodePaste(offer),
      reply: true,
    });
  } catch (error) {
    showError('gate-error', error?.message || 'Verbindung konnte nicht aufgebaut werden.');
  }
}

async function joinAsGuest(offerBlob) {
  if (!isWebRtcSupported()) {
    showError('gate-error', 'Dieser Browser kann kein WebRTC – Peer-Verbindungen sind nicht möglich.');
    return;
  }
  requireName();
  switchGame(offerBlob.gameId);
  const transport = attachWebRtc(createWebRtcTransport({ role: 'guest', gameId: offerBlob.gameId }));
  try {
    const answer = await transport.createAnswer(offerBlob);
    showGate(false);
    showHandshake({
      title: 'Antwort senden',
      help: 'Schicke diesen Antwort-Link zurück an den Gastgeber. Danach seid ihr verbunden.',
      link: linkFor(answer),
      blob: encodePaste(answer),
      reply: false,
    });
  } catch (error) {
    showError('gate-error', error?.message || 'Einladung konnte nicht verarbeitet werden.');
  }
}

async function acceptReplyText(text) {
  const blob = decodeAnyBlob(text);
  if (!blob) {
    showError('handshake-error', 'Das ist kein gültiger Antwort-Code.');
    return;
  }
  if (!webrtc) {
    showError('handshake-error', 'Keine offene Einladung. Erstelle zuerst ein neues Spiel.');
    return;
  }
  try {
    await webrtc.acceptAnswer(blob);
    showError('handshake-error', '');
  } catch (error) {
    showError('handshake-error', error?.message || 'Antwort konnte nicht übernommen werden.');
  }
}

async function joinFromText(text) {
  const blob = decodeAnyBlob(text);
  if (!blob || !blob.sdp) {
    showError('gate-error', 'Das ist kein gültiger Einladungs-Code.');
    return;
  }
  requireName();
  if (blob.role === 'guest') {
    await acceptReplyText(text);
    return;
  }
  await joinAsGuest(blob);
}

// --- JSON export / import fallback (ticket 13) --------------------------
//
// The escape hatch when WebRTC is impossible: a pure JSON blob hand-copied
// through any chat. It never requires a peer connection. Kept in its own
// section so sibling tickets can merge without touching it.

function exportBoard() {
  const json = exportDocument(doc);
  const out = $('export-output');
  if (out) out.value = json;
  const copy = navigator.clipboard?.writeText?.(json);
  if (copy) {
    copy.catch(() => out?.select());
  } else {
    out?.select();
  }
  showError('import-error', '');
}

function downloadBoard() {
  const out = $('export-output');
  const json = out?.value || exportDocument(doc);
  if (out && !out.value) out.value = json;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `homeworlds-${gameId}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function importBoard() {
  const raw = $('import-input')?.value || '';
  const restored = importDocument(raw, { fallbackGameId: gameId });
  if (!restored) {
    showError('import-error', 'Ungültiges Board-JSON. Bitte den Code vollständig einfügen.');
    return;
  }
  showError('import-error', '');
  // Adopt the imported identity so a re-export keeps matching the opponent.
  if (restored.gameId && restored.gameId !== gameId) {
    gameId = restored.gameId;
    store.rememberGameId(gameId);
    useBroadcast(gameId);
  }
  setDocument(restored);
}

// --- Local operations ---------------------------------------------------

function handleOperation(op) {
  switch (op.type) {
    case 'move':
      dispatch(buildPieceMessage(doc, op.id, { x: op.x, y: op.y }, PEER_ID));
      break;
    case 'rotate': {
      const piece = doc.pieces[op.id];
      if (!piece || piece.kind !== 'ship') break;
      dispatch(buildPieceMessage(doc, op.id, { rotation: piece.rotation === 0 ? 180 : 0 }, PEER_ID));
      break;
    }
    case 'flip': {
      const piece = doc.pieces[op.id];
      if (!piece) break;
      dispatch(buildPieceMessage(doc, op.id, { kind: piece.kind === 'ship' ? 'star' : 'ship' }, PEER_ID));
      break;
    }
    case 'camera':
      dispatch(buildCameraMessage(doc, op.camera, PEER_ID));
      break;
    default:
      break;
  }
}

// --- Init ---------------------------------------------------------------

renderer.render(doc);
requestAnimationFrame(() => renderer.measure());

addEventListener('pagehide', flushSave);

$('zoom-in')?.addEventListener('click', () => renderer.zoomBy(1.25));
$('zoom-out')?.addEventListener('click', () => renderer.zoomBy(0.8));

$('reset')?.addEventListener('click', () => {
  const confirmed = window.confirm(
    'Wirklich zurücksetzen? Alle 36 Steine gehen in die Bank zurück und der Gegner sieht denselben Zustand.',
  );
  if (!confirmed) return;
  dispatch(buildResetMessage(doc, PEER_ID));
});

$('create-game')?.addEventListener('click', () => createGame());
$('join-game')?.addEventListener('click', () => joinFromText($('join-input')?.value));
$('accept-reply')?.addEventListener('click', () => acceptReplyText($('reply-input')?.value));
$('gate-skip')?.addEventListener('click', () => showGate(false));
$('handshake-close')?.addEventListener('click', () => hideHandshake());

// ticket 13: JSON export/import fallback
$('export-board')?.addEventListener('click', () => exportBoard());
$('download-board')?.addEventListener('click', () => downloadBoard());
$('import-board')?.addEventListener('click', () => importBoard());

$('copy-link')?.addEventListener('click', async () => {
  const value = $('handshake-link')?.value || '';
  try {
    await navigator.clipboard.writeText(value);
    const btn = $('copy-link');
    if (btn) {
      btn.textContent = 'Kopiert!';
      setTimeout(() => {
        btn.textContent = 'Kopieren';
      }, 1500);
    }
  } catch {
    $('handshake-link')?.select();
  }
});

// --- Fallback warnings (ticket 13) --------------------------------------

// Opening the page straight from disk means no secure context: WebRTC needs
// HTTPS, but same-browser tab sync (BroadcastChannel) and JSON exchange work.
if (location.protocol === 'file:') {
  const warn = $('file-warning');
  if (warn) warn.hidden = false;
}

// A browser without WebRTC can still use the board, the tab sync and JSON.
if (!isWebRtcSupported()) {
  const notice = $('gate-webrtc');
  if (notice) notice.hidden = false;
}

// Opening an invite link shows the board immediately and produces a reply.
if (location.hash && location.hash.includes('hw=')) {
  const blob = decodeFragment(location.hash);
  showGate(false);
  if (blob && blob.role === 'guest') {
    acceptReplyText(location.hash);
  } else if (blob) {
    joinAsGuest(blob);
  }
} else {
  showGate(!savedName);
}
