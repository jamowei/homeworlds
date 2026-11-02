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
  buildFlipMessage,
  buildPieceMessage,
  buildResetMessage,
  buildRotateMessage,
  messageId,
  mergeDocuments,
} from './core/state.js';
import { createRenderer } from './render/svg.js';
import { buildCursorMessage, buildDragMessage, readPresence } from './presence/messages.js';
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
const zoomEl = $('zoom-level');
const store = createStore();

// --- Identity -----------------------------------------------------------

const nameInput = $('player-name');
const savedName = store.getPreference(NAME_KEY);
if (nameInput && savedName) nameInput.value = savedName;

// The single place the name field is read. `ownName` falls back to "Gast" for
// presence labels; `requireName` refuses a blank name so creating or joining a
// game is never anonymous (the field still suggests "Gast" as its value).
function readName() {
  return (nameInput?.value || '').trim();
}
function ownName() {
  return readName() || 'Gast';
}
function requireName() {
  if (!readName()) return null;
  const name = ownName();
  store.setPreference(NAME_KEY, name);
  if (nameInput) nameInput.value = name;
  return name;
}

// --- Document + resume --------------------------------------------------

const requestedGameId = new URLSearchParams(location.search).get('game');
let gameId = requestedGameId || store.lastGameId() || 'local';
store.rememberGameId(gameId);

const saved = store.loadDocument(gameId);
const restored = saved && saved.pieces && saved.camera ? saved : null;
let doc = restored || createDocument(gameId);

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
  updateZoom();
  scheduleSave();
}

// --- Sync ---------------------------------------------------------------

let opponentName = null;
const transportStatus = new Map();
const peers = createPeerRegistry({ self: PEER_ID, limit: 2 });
const rejectedPeers = new Set();
// Transports that have already sent their one `sync` for this connection. It is
// cleared on disconnect so a reconnected transport syncs again.
const syncedTransports = new Set();

const hub = createHub({
  onMessage: receiveRemote,
  onStatus: (status, transport) => {
    transportStatus.set(transport, status);
    updateStatus();
    if (status === 'connected' || status === 'available') onConnected(transport);
    else if (status === 'disconnected' || status === 'closed') syncedTransports.delete(transport);
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
  if (active.some((v) => v === 'disconnected' || v === 'closed')) return 'disconnected';
  if (active.length > 0 && active.every((v) => v === 'unavailable')) return 'unavailable';
  // Same-browser tabs talk over BroadcastChannel, which cannot report a peer by
  // itself — a `hello` from another player is what makes us connected.
  if (peers.size() > 1) return 'connected';
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

// The zoom readout sits next to the status. Zoom lives on the document camera,
// so every camera change already flows through `setDocument`.
function updateZoom() {
  if (!zoomEl) return;
  const zoom = doc?.camera?.zoom;
  zoomEl.textContent = `Zoom ${Math.round((Number.isFinite(zoom) ? zoom : 1) * 100)}%`;
}

function onConnected(transport) {
  hideHandshake();
  // One hello + one document sync per connection. Receiving a `sync` never
  // triggers one in return, so the exchange cannot loop.
  if (transport && syncedTransports.has(transport)) return;
  if (transport) syncedTransports.add(transport);
  hub.send({ type: 'hello', id: messageId(), by: PEER_ID, name: ownName() });
  sendSync();
}

// Send the whole local document so the two boards can be merged per piece.
function sendSync() {
  hub.send({ type: 'sync', id: messageId(), by: PEER_ID, document: doc });
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
      hub.send({ type: 'reject', id: messageId(), by: PEER_ID });
      return;
    }
    if (message.name) opponentName = message.name;
    updateStatus();
    // Answer once so the other side also learns our name, without looping.
    hub.send({ type: 'hello-ack', id: messageId(), by: PEER_ID, name: ownName() });
    return;
  }
  if (message.type === 'hello-ack') {
    if (message.by && message.by !== PEER_ID && (peers.has(message.by) || peers.register(message.by))) {
      if (message.name) opponentName = message.name;
      updateStatus();
    }
    return;
  }
  if (message.type === 'reject') return;
  if (message.by && rejectedPeers.has(message.by)) return;
  // A reconnect sync carries a whole document; merge it per piece by newest
  // version (tie-broken by peer id) so offline divergence resolves itself.
  if (message.type === 'sync') {
    if (!message.by || message.by === PEER_ID || !message.document) return;
    setDocument(mergeDocuments(doc, message.document));
    return;
  }
  // Presence never mutates the document: it only updates the opponent overlay.
  if (message.type === 'cursor' || message.type === 'drag') {
    applyPresence(message);
    return;
  }
  const next = applyMessage(doc, message);
  if (next !== doc) setDocument(next);
}

function switchGame(nextGameId, { fresh = false } = {}) {
  if (!nextGameId || nextGameId === gameId) return;
  gameId = nextGameId;
  store.rememberGameId(gameId);
  useBroadcast(gameId);
  // A brand-new game starts from the deterministic initial table; joining an
  // existing game resumes its saved board when there is one. Always go through
  // `setDocument` so the renderer and autosave stay in sync.
  const savedDoc = fresh ? null : store.loadDocument(gameId);
  const next = savedDoc && savedDoc.pieces && savedDoc.camera ? savedDoc : createDocument(gameId);
  setDocument(next);
}

// --- Presence -----------------------------------------------------------
//
// Transient opponent cursor and drag highlight. Presence rides the same hub as
// board changes but is never fed through `applyMessage`: it does not mutate the
// document.

function sendPresence(message) {
  hub.send({ ...message, id: messageId(), by: PEER_ID, name: ownName() });
}

function applyPresence(message) {
  if (!message.by || message.by === PEER_ID) return;
  const patch = readPresence(message);
  if (!patch) return;
  if (patch.name && patch.name !== opponentName) {
    opponentName = patch.name;
    updateStatus();
  }
  renderer.setPresence({ ...patch, name: opponentName || patch.name || '' });
}

// --- Handshake UI -------------------------------------------------------

let webrtc = null;

// WebRTC needs a secure context and browser support. On `file://` the warning
// is shown and peer connections are refused outright (BroadcastChannel tab sync
// and JSON export/import keep working). Returns null when WebRTC is usable.
function webRtcBlockReason() {
  if (location.protocol === 'file:') {
    return 'Peer-Sync (WebRTC) benötigt HTTPS. Öffne die Seite über eine HTTPS-Adresse.';
  }
  if (!isWebRtcSupported()) {
    return 'Dieser Browser kann kein WebRTC – Peer-Verbindungen sind nicht möglich.';
  }
  return null;
}

// Name is mandatory before creating or joining: returns true (and shows the
// error) when the field is blank, so the caller can bail out.
function missingName() {
  if (requireName()) return false;
  showError('gate-error', 'Bitte gib zuerst deinen Namen ein.');
  return true;
}

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
  if ('open' in panel) panel.open = true;
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

// Drop the current WebRTC transport cleanly before building a new one. Closing
// it removes it from the hub, so a stale channel can never deliver messages
// into the fresh connection.
function teardownWebRtc() {
  if (!webrtc) return;
  const old = webrtc;
  webrtc = null;
  syncedTransports.delete(old);
  hub.remove(old);
}

function attachWebRtc(transport) {
  teardownWebRtc();
  webrtc = transport;
  hub.add(transport);
  // Errors use the same handler mechanism as messages/status (setHandlers).
  transport.setHandlers({ onError: (event) => console.warn('WebRTC-Fehler', event) });
  return transport;
}

// --- Reconnect (ticket 11) ----------------------------------------------
//
// WebRTC cannot silently reconnect, so resuming the *same* game needs a fresh
// invite/reply exchange. This keeps the current gameId (and therefore the
// saved board) and only rebuilds the transport; on connect the peers merge.

async function reconnect() {
  if (missingName()) return;
  const block = webRtcBlockReason();
  if (block) {
    showError('gate-error', block);
    return;
  }
  showError('gate-error', '');
  showGate(false);
  const transport = attachWebRtc(createWebRtcTransport({ role: 'host', gameId }));
  try {
    const offer = await transport.createOffer();
    showHandshake({
      title: 'Verbindung erneuern',
      help: 'Dieselbe Partie: Sende diesen neuen Einladungs-Link und füge danach die Antwort wieder unten ein.',
      link: linkFor(offer),
      blob: encodePaste(offer),
      reply: true,
    });
  } catch (error) {
    showError('gate-error', error?.message || 'Verbindung konnte nicht erneuert werden.');
  }
}

async function createGame() {
  if (missingName()) return;
  const block = webRtcBlockReason();
  if (block) {
    showError('gate-error', block);
    return;
  }
  showError('gate-error', '');
  switchGame(newGameId(), { fresh: true });
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
  if (missingName()) return;
  const block = webRtcBlockReason();
  if (block) {
    showError('gate-error', block);
    return;
  }
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
  const block = webRtcBlockReason();
  if (block) {
    showError('handshake-error', block);
    return;
  }
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
  const block = webRtcBlockReason();
  if (block) {
    showError('gate-error', block);
    return;
  }
  if (missingName()) return;
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
    case 'rotate':
      dispatch(buildRotateMessage(doc, op.id, PEER_ID));
      break;
    case 'flip':
      dispatch(buildFlipMessage(doc, op.id, PEER_ID));
      break;
    case 'camera':
      dispatch(buildCameraMessage(doc, op.camera, PEER_ID));
      break;
    case 'cursor':
      sendPresence(buildCursorMessage(op.cursor?.x, op.cursor?.y));
      break;
    case 'drag':
      sendPresence(buildDragMessage(op.phase === 'end' ? null : op.id));
      break;
    default:
      break;
  }
}

// --- Init ---------------------------------------------------------------

renderer.render(doc);
updateZoom();
requestAnimationFrame(() => {
  renderer.measure();
  // No saved board: fit the whole world (Bank included) on screen immediately.
  if (!restored) renderer.fitToWorld();
});

addEventListener('pagehide', flushSave);

$('reset')?.addEventListener('click', () => {
  const confirmed = window.confirm(
    'Wirklich zurücksetzen? Alle 36 Steine gehen in die Bank zurück und der Gegner sieht denselben Zustand.',
  );
  if (!confirmed) return;
  dispatch(buildResetMessage(doc, PEER_ID));
});

$('create-game')?.addEventListener('click', () => createGame());
$('reconnect')?.addEventListener('click', () => reconnect());
$('join-game')?.addEventListener('click', () => joinFromText($('join-input')?.value));
$('accept-reply')?.addEventListener('click', () => acceptReplyText($('reply-input')?.value));
$('gate-skip')?.addEventListener('click', () => showGate(false));

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

// A browser without WebRTC — or a page opened from `file://` — can still use
// the board, the tab sync and JSON, but not peer connections.
if (webRtcBlockReason()) {
  const notice = $('gate-webrtc');
  if (notice) notice.hidden = false;
}

// Opening an invite link shows the board immediately and produces a reply.
if (location.hash && location.hash.includes('hw=')) {
  const blob = decodeFragment(location.hash);
  showGate(false);
  // On `file://` (or without WebRTC) the warning is shown and no peer
  // connection is attempted; tab sync and JSON exchange still work.
  if (!webRtcBlockReason()) {
    if (blob && blob.role === 'guest') {
      acceptReplyText(location.hash);
    } else if (blob) {
      joinAsGuest(blob);
    }
  }
} else {
  showGate(!savedName);
}
