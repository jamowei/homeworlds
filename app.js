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
  buildSendHomeMessage,
  messageId,
  mergeDocuments,
  migrateBoard,
} from './core/state.js';
import { createRenderer } from './render/svg.js';
import { buildCursorMessage, buildDragMessage, readPresence } from './presence/messages.js';
import { createStore } from './storage/store.js';
import { createHub } from './transport/hub.js';
import { createBroadcastTransport } from './transport/broadcast.js';
import { createPeerRegistry } from './transport/peers.js';
import { createWebRtcTransport, isWebRtcSupported, DEFAULT_ICE_SERVERS, fetchMeteredIceServers, mergeIceServers } from './transport/webrtc.js';
import { encodeFragment, decodeFragment, decodePaste } from './signalling/codec.js';
import { exportDocument, importDocument } from './core/io.js';
import { TURN_CONFIG } from './turn.config.js';

const SAVE_DEBOUNCE_MS = 300;
const NAME_KEY = 'hw-name';
// Whether the player is currently in a game. It is what decides if the
// create/join gate is shown on load, so "Spiel verlassen" can bring it back
// without the player clearing storage by hand.
const ACTIVE_KEY = 'hw-active';
// How long the invite panel takes to fold closed. Kept in step with the
// `.handshake` transition in play.css.
const HANDSHAKE_FOLD_MS = 260;
let handshakeHideTimer = null;

// A per-session peer id: it is the last-write-wins tiebreak between two peers.
const PEER_ID = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 12);

const $ = (id) => document.getElementById(id);
const svg = $('board');
const bankSvg = $('bank');
const statusEl = $('status');
const zoomEl = $('zoom-level');
const store = createStore();

// --- ICE servers (STUN always, optional Metered TURN) -------------------
//
// Public STUN servers connect most peers directly. When a Metered TURN relay is
// configured in `turn.config.js`, its credential-scoped API key fetches a full
// ICE array; the fetch happens just before a peer connection is created (and is
// cached briefly) so a long-open tab never uses stale relay credentials, and
// any failure falls back to STUN only. The fallback is logged: a silent switch
// to STUN is exactly what makes a symmetric-NAT failure hard to diagnose.
const ICE_CACHE_MS = 10 * 60 * 1000;
let cachedIceServers = null;
let cachedIceServersAt = 0;

async function getIceServers() {
  if (cachedIceServers && Date.now() - cachedIceServersAt < ICE_CACHE_MS) {
    return cachedIceServers;
  }

  const turn = await fetchMeteredIceServers({
    ...(TURN_CONFIG || {}),
    onError: (reason) =>
      console.warn(
        '[Homeworlds WebRTC] TURN-Zugangsdaten konnten nicht geladen werden – es wird nur STUN verwendet.',
        reason,
      ),
  });

  cachedIceServers = turn && turn.length ? mergeIceServers(DEFAULT_ICE_SERVERS, turn) : DEFAULT_ICE_SERVERS;
  cachedIceServersAt = Date.now();

  const turnCount = cachedIceServers.filter((server) => /^turns?:/iu.test(server.urls)).length;
  const turnConfigured = Boolean((TURN_CONFIG || {}).domain && (TURN_CONFIG || {}).apiKey);
  console.info('[Homeworlds WebRTC] ICE-Konfiguration', {
    stun: cachedIceServers.length - turnCount,
    turn: turnCount,
    turnConfigured,
  });
  if (turnConfigured && turnCount === 0) {
    console.warn(
      '[Homeworlds WebRTC] TURN ist konfiguriert, aber es kamen keine TURN-Server zurück. ' +
        'Verbindungen hinter einem symmetrischen NAT werden wahrscheinlich scheitern.',
    );
  }
  return cachedIceServers;
}

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

// Which player am I: 'host' (created the game, or playing alone) or 'guest'
// (joined via an invite). A piece's `owner` is one of these two roles, and the
// direction it is drawn in is derived from the owner and this local role, so no
// absolute rotation is ever stored or synced. The role is kept per tab
// (sessionStorage) so two tabs in the same browser stay distinct, falling back
// to localStorage so it survives a browser restart.
const ROLE_PREFIX = 'hw-role:';
function readRole(id) {
  try {
    const perTab = globalThis.sessionStorage?.getItem(ROLE_PREFIX + id);
    if (perTab) return perTab;
  } catch {
    // sessionStorage can be unavailable (private mode); fall through.
  }
  return store.getPreference(ROLE_PREFIX + id) || 'host';
}
function writeRole(id, role) {
  store.setPreference(ROLE_PREFIX + id, role);
  try {
    globalThis.sessionStorage?.setItem(ROLE_PREFIX + id, role);
  } catch {
    // ignore
  }
}
let localRole = readRole(gameId);

const saved = store.loadDocument(gameId);
// A board saved before the world was widened keeps its Bank pieces at the old
// coordinates; re-home them so they line up with the current Bank.
const restored = saved && saved.pieces && saved.camera ? migrateBoard(saved) : null;
let doc = restored || createDocument(gameId);

// Are we mid-game? An explicit flag wins; with no flag, an existing saved board
// counts as active (so upgrading players keep resuming their game). A `?game=`
// parameter is an explicit request to open that game.
const storedActive = store.getPreference(ACTIVE_KEY);
const isActive = requestedGameId ? true : storedActive === null ? !!restored : storedActive === '1';

const renderer = createRenderer(svg, {
  bankSvg,
  onOperation: handleOperation,
  getLocalRole: () => localRole,
});

// Switch the local role (create/join) and repaint, since every ship's direction
// depends on it.
function setLocalRole(role) {
  localRole = role;
  writeRole(gameId, role);
  renderer.render(doc);
}

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
// How the peer connection runs: "direct" (host/srflx) or "relay" (TURN). Shown
// as a suffix in the status once WebRTC has selected a candidate pair.
let connectionPath = null;
const transportStatus = new Map();
let peers = createPeerRegistry({ self: PEER_ID, limit: 2 });
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
    if (status === 'failed') {
      showError(
        'handshake-error',
        'Die Verbindung konnte nicht hergestellt werden. Das Netzwerk blockiert vermutlich die direkte ' +
          'Verbindung (NAT/Firewall). Details stehen in der Browser-Konsole unter „[Homeworlds WebRTC]“; ' +
          'mit „Diagnose kopieren“ kannst du sie weitergeben. Klicke „Verbindung erneuern“ für einen neuen Versuch.',
      );
    }
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
  // A registered peer is the strongest signal: same-browser tabs sync over
  // BroadcastChannel, which never reports a `connected` transport, so a
  // pending WebRTC offer must not hide the fact that we are already talking to
  // the opponent.
  if (peers.size() > 1) return 'connected';
  if (active.includes('connected')) return 'connected';
  if (active.includes('failed')) return 'failed';
  if (active.includes('waiting')) return 'waiting';
  if (active.some((v) => v === 'disconnected' || v === 'closed')) return 'disconnected';
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
    failed: 'Verbindung fehlgeschlagen',
    disconnected: 'Getrennt',
    unavailable: 'Kein Sync verfügbar',
    offline: 'Nicht verbunden',
  }[state];
  if (state === 'connected' && opponentName) text += ` mit ${opponentName}`;
  if (state === 'connected' && connectionPath) {
    text += connectionPath.path === 'relay' ? ' · über Relay' : ' · direkt';
  }
  statusEl.textContent = text;
}

// The zoom readout sits next to the status. Zoom lives on the document camera,
// so every camera change already flows through `setDocument`.
function updateZoom() {
  if (!zoomEl) return;
  const zoom = doc?.camera?.zoom;
  zoomEl.textContent = `Zoom ${Math.round((Number.isFinite(zoom) ? zoom : 1) * 100)}%`;
}

// `getStats()` has the selected candidate pair a moment after `connected`, so
// poll a few times instead of reading it once too early. The status then says
// "· direkt" or "· über Relay", which answers "was STUN enough?" without DevTools.
function recordConnectionPath(transport, attempt = 0) {
  if (!transport || transport.kind !== 'webrtc') return;
  if (transport.getDiagnostics?.().path) {
    connectionPath = transport.getDiagnostics().path;
    updateStatus();
    return;
  }
  if (attempt < 5) setTimeout(() => recordConnectionPath(transport, attempt + 1), 400);
}

function onConnected(transport) {
  hideHandshake();
  recordConnectionPath(transport);
  // One hello + one document sync per connection. A peer that hears our hello
  // answers with a sync of its own, so both boards always cross — this matters
  // for BroadcastChannel, whose `available` fires before any peer exists, so
  // the sync sent here can be lost. Receiving a `sync` never triggers one in
  // return, so the exchange cannot loop.
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
    // A registered peer means the handshake is done. WebRTC also fires a
    // `connected` status, but BroadcastChannel connects same-browser tabs
    // without one, so fold the invite panel here for both transports.
    hideHandshake();
    updateStatus();
    // Answer once so the other side also learns our name, without looping.
    hub.send({ type: 'hello-ack', id: messageId(), by: PEER_ID, name: ownName() });
    // Send our board in answer too: a BroadcastChannel peer's own connect-sync
    // happened before we existed, so this is the only copy it will receive.
    sendSync();
    return;
  }
  if (message.type === 'hello-ack') {
    if (message.by && message.by !== PEER_ID && (peers.has(message.by) || peers.register(message.by))) {
      if (message.name) opponentName = message.name;
      hideHandshake();
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
  // Clamp an incoming camera to our own viewport, so a peer on a different
  // screen size can never leave the field off our screen.
  if (message.type === 'camera' && message.camera) {
    message = { ...message, camera: { ...message.camera, ...renderer.clampCamera(message.camera) } };
  }
  const next = applyMessage(doc, message);
  if (next !== doc) setDocument(next);
}

function switchGame(nextGameId, { fresh = false } = {}) {
  if (!nextGameId || nextGameId === gameId) return;
  gameId = nextGameId;
  store.rememberGameId(gameId);
  // A different game means a different role: start from that game's saved role
  // (the caller then overrides it for create/join).
  localRole = readRole(gameId);
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
async function linkFor(blob) {
  return baseUrl() + (await encodeFragment(blob));
}
// Accept either a link/fragment or a paste-box code. The codec functions are
// async (deflate runs through the platform streams), so this is too.
async function decodeAnyBlob(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  return (await decodeFragment(trimmed)) || (await decodePaste(trimmed)) || null;
}

function showGate(show) {
  const gate = $('gate');
  if (gate) gate.hidden = !show;
}
// The "Steuerung" dialog: a static how-to-play card. Shown from the toolbar,
// dismissed by its button, a click on the backdrop, or Escape.
function showControls(show) {
  const el = $('controls');
  if (el) el.hidden = !show;
}
function showHandshake(config) {
  const panel = $('handshake');
  if (!panel) return;
  // Re-opening during a fold must expand again rather than stay half-collapsed.
  clearTimeout(handshakeHideTimer);
  panel.classList.remove('is-folded');
  panel.style.removeProperty('--handshake-max');
  panel.hidden = false;
  if ('open' in panel) panel.open = true;
  $('handshake-title').textContent = config.title;
  $('handshake-help').textContent = config.help || '';
  $('handshake-link').value = config.link || '';
  const replyBox = $('reply-box');
  if (replyBox) replyBox.hidden = !config.reply;
  showError('handshake-error', '');
}
// Fold the invite panel closed, then take it out of the layout and clear its
// inputs. Clearing here also covers "Spiel verlassen": hiding the panel alone
// kept the pasted reply in the DOM, so the next handshake offered a stale
// answer. The inputs are cleared only once the fold has finished, so the link
// does not blank out mid-animation.
function hideHandshake() {
  const panel = $('handshake');
  if (panel && !panel.hidden && !panel.classList.contains('is-folded')) {
    // Pin the exact current height first, so the transition runs from the real
    // size instead of snapping from an over-large default max-height.
    panel.style.setProperty('--handshake-max', `${panel.offsetHeight}px`);
    void panel.offsetHeight;
    panel.classList.add('is-folded');
    clearTimeout(handshakeHideTimer);
    handshakeHideTimer = setTimeout(() => resetHandshake(panel), HANDSHAKE_FOLD_MS);
  } else if (panel && panel.hidden) {
    resetHandshake(panel);
  }
}
function resetHandshake(panel) {
  if (panel) {
    panel.hidden = true;
    panel.classList.remove('is-folded');
    panel.style.removeProperty('--handshake-max');
  }
  const reply = $('reply-input');
  if (reply) reply.value = '';
  const link = $('handshake-link');
  if (link) link.value = '';
  showError('handshake-error', '');
}
function showError(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
  // The diagnostic copy button only makes sense next to a handshake failure.
  if (id === 'handshake-error') {
    const copy = $('copy-diagnostics');
    if (copy) copy.hidden = !message;
  }
}

// --- Busy / loading indicator -------------------------------------------
//
// One full-screen spinner for the operations that can take a moment: creating
// an offer or an answer waits for ICE gathering (up to a few seconds), and the
// first board paint measures the layout. Without it the screen just freezes.

function setBusy(busy, text) {
  const overlay = $('busy');
  if (!overlay) return;
  if (text) {
    const label = $('busy-text');
    if (label) label.textContent = text;
  }
  overlay.hidden = !busy;
  if (busy) document.body.setAttribute('aria-busy', 'true');
  else document.body.removeAttribute('aria-busy');
}

// Give the browser one frame to paint the spinner before awaiting something
// slow. The timer is a fallback for background tabs, where requestAnimationFrame
// is throttled or paused.
function nextPaint() {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done);
    setTimeout(done, 50);
  });
}

// Remember whether the player is in a game (drives whether the gate shows on
// the next load). "Spiel verlassen" clears it; create/join set it.
function setActive(active) {
  store.setPreference(ACTIVE_KEY, active ? '1' : '0');
}

function newGameId() {
  return (globalThis.crypto?.randomUUID?.() || `g-${Math.random().toString(36).slice(2)}`).slice(0, 16);
}

// Drop the current WebRTC transport cleanly before building a new one. Closing
// it removes it from the hub, so a stale channel can never deliver messages
// into the fresh connection.
function teardownWebRtc() {
  connectionPath = null;
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
  transport.setHandlers({ onError: (event) => console.warn('[Homeworlds WebRTC] Datenkanal-Fehler', event) });
  return transport;
}

// A support-friendly snapshot. The transport logs the same object to the
// console on failure; this makes it available to the "Diagnose kopieren"
// button without asking the player to dig through DevTools.
globalThis.__hwDiagnostics = () => {
  try {
    return {
      time: new Date().toISOString(),
      page: location.origin + location.pathname,
      gameId,
      localRole,
      opponent: opponentName || null,
      status: aggregateStatus(),
      userAgent: navigator.userAgent,
      transport: webrtc?.getDiagnostics?.() || null,
    };
  } catch (error) {
    return { time: new Date().toISOString(), error: String(error) };
  }
};

// --- Leave game ---------------------------------------------------------
//
// A complete local reset that returns to the create/join gate without the
// player having to clear storage by hand: disconnect any peer, drop this game's
// saved board and remembered role, and start again from a clean table. The
// player's name is deliberately kept — it is a preference, not game state.

function leaveGame() {
  const confirmed = window.confirm(
    'Spiel verlassen? Die lokale Partie auf diesem Gerät wird gelöscht und du kommst zurück zur Auswahl. Eine bestehende Verbindung zum Gegner wird getrennt.',
  );
  if (!confirmed) return;
  teardownWebRtc();
  if (broadcast) {
    hub.remove(broadcast);
    broadcast = null;
  }
  // Forget this game locally: board, remembered id and role.
  store.removeDocument(gameId);
  store.forgetGameId();
  store.removePreference(ROLE_PREFIX + gameId);
  try {
    globalThis.sessionStorage?.removeItem(ROLE_PREFIX + gameId);
  } catch {
    // sessionStorage can be unavailable (private mode); ignore.
  }
  setActive(false);
  // Start over on a clean, unsaved table so the gate sits over the initial
  // board. A fresh peer registry means a new game is not blocked by old peers.
  gameId = 'local';
  localRole = 'host';
  peers = createPeerRegistry({ self: PEER_ID, limit: 2 });
  rejectedPeers.clear();
  transportStatus.clear();
  opponentName = null;
  useBroadcast(gameId);
  doc = createDocument(gameId);
  renderer.render(doc);
  updateZoom();
  updateStatus();
  hideHandshake();
  showError('gate-error', '');
  showGate(true);
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
  setBusy(true, 'Neue Einladung wird vorbereitet …');
  try {
    const transport = attachWebRtc(createWebRtcTransport({ role: 'host', gameId, iceServers: await getIceServers() }));
    const offer = await transport.createOffer();
    showGate(false);
    showHandshake({
      title: 'Verbindung erneuern',
      help: 'Dieselbe Partie: Sende diesen neuen Einladungs-Link und füge danach die Antwort wieder unten ein.',
      link: await linkFor(offer),
      reply: true,
    });
  } catch (error) {
    // Surface the error where it can be read, even though the gate was hidden.
    showGate(true);
    showError('gate-error', error?.message || 'Verbindung konnte nicht erneuert werden.');
  } finally {
    setBusy(false);
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
  setBusy(true, 'Neues Spiel wird vorbereitet …');
  try {
    switchGame(newGameId(), { fresh: true });
    setLocalRole('host');
    setActive(true);
    const transport = attachWebRtc(createWebRtcTransport({ role: 'host', gameId, iceServers: await getIceServers() }));
    const offer = await transport.createOffer();
    showGate(false);
    showHandshake({
      title: 'Einladung teilen',
      help: 'Sende diesen Link an deine Mitspielerin oder deinen Mitspieler. Sobald du die Antwort erhältst, füge sie unten ein.',
      link: await linkFor(offer),
      reply: true,
    });
  } catch (error) {
    showGate(true);
    showError('gate-error', error?.message || 'Verbindung konnte nicht aufgebaut werden.');
  } finally {
    setBusy(false);
  }
}

async function joinAsGuest(offerBlob) {
  if (missingName()) return;
  const block = webRtcBlockReason();
  if (block) {
    showError('gate-error', block);
    return;
  }
  setBusy(true, 'Einladung wird verarbeitet …');
  try {
    switchGame(offerBlob.gameId);
    setLocalRole('guest');
    setActive(true);
    const transport = attachWebRtc(createWebRtcTransport({ role: 'guest', gameId: offerBlob.gameId, iceServers: await getIceServers() }));
    const answer = await transport.createAnswer(offerBlob);
    showGate(false);
    showHandshake({
      title: 'Antwort senden',
      help: 'Schicke diesen Antwort-Link zurück an den Gastgeber. Danach seid ihr verbunden.',
      link: await linkFor(answer),
      reply: false,
    });
  } catch (error) {
    showGate(true);
    showError('gate-error', error?.message || 'Einladung konnte nicht verarbeitet werden.');
  } finally {
    setBusy(false);
  }
}

async function acceptReplyText(text) {
  const block = webRtcBlockReason();
  if (block) {
    showError('handshake-error', block);
    return;
  }
  const blob = await decodeAnyBlob(text);
  if (!blob) {
    showError('handshake-error', 'Das ist kein gültiger Antwort-Code.');
    return;
  }
  if (!webrtc) {
    showError('handshake-error', 'Keine offene Einladung. Erstelle zuerst ein neues Spiel.');
    return;
  }
  showError('handshake-error', '');
  setBusy(true, 'Verbindung wird hergestellt …');
  // Let the browser paint the spinner before the (possibly multi-second) wait.
  await nextPaint();
  try {
    await webrtc.acceptAnswer(blob);
    // Keep the spinner up until ICE/DTLS actually connected (or failed with a
    // readable reason). Without this, the panel looked frozen while the
    // connection attempt ran in the background.
    await webrtc.waitForConnection?.({ timeoutMs: 25000 });
    showError('handshake-error', '');
  } catch (error) {
    showError('handshake-error', error?.message || 'Antwort konnte nicht übernommen werden.');
    // Keep the full object in the console as well, for a copyable diagnosis.
    console.error('[Homeworlds] Verbindungsaufbau fehlgeschlagen', {
      error: error?.message || String(error),
      diagnostics: globalThis.__hwDiagnostics?.(),
    });
  } finally {
    setBusy(false);
  }
}

async function joinFromText(text) {
  const blob = await decodeAnyBlob(text);
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
  // An imported board from before the world was widened needs re-homing too.
  setDocument(migrateBoard(restored));
}

// --- Local operations ---------------------------------------------------

function handleOperation(op) {
  switch (op.type) {
    case 'move':
      // Moving a piece claims it: it will point away from this player.
      dispatch(buildPieceMessage(doc, op.id, { x: op.x, y: op.y, owner: localRole }, PEER_ID));
      break;
    case 'flip':
      dispatch(buildFlipMessage(doc, op.id, PEER_ID, localRole));
      break;
    case 'send-home':
      dispatch(buildSendHomeMessage(doc, op.id, PEER_ID));
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
  if (!restored) {
    // No saved board: fit the play field on screen immediately.
    renderer.fitToWorld();
  } else {
    // A restored camera may predate the current play field (the world or the
    // Bank may have changed); keep it inside so the Bank stays off the board.
    const camera = renderer.clampCamera(doc.camera);
    if (camera.x !== doc.camera.x || camera.y !== doc.camera.y || camera.zoom !== doc.camera.zoom) {
      setDocument({ ...doc, camera: { ...doc.camera, ...camera } });
    }
  }
  // The first paint is done: cancel the slow-load spinner and hide it.
  clearTimeout(globalThis.__hwLoadTimer);
  const overlay = $('busy');
  if (overlay) overlay.dataset.ready = '1';
  setBusy(false);
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
$('leave-game')?.addEventListener('click', () => leaveGame());
$('join-game')?.addEventListener('click', () => joinFromText($('join-input')?.value));
$('accept-reply')?.addEventListener('click', () => acceptReplyText($('reply-input')?.value));
$('copy-diagnostics')?.addEventListener('click', async () => {
  const text = JSON.stringify(globalThis.__hwDiagnostics?.() || {}, null, 2);
  // Always print it, so it can be selected by hand if the clipboard is blocked.
  console.info('[Homeworlds] Diagnose', text);
  try {
    await navigator.clipboard.writeText(text);
    const btn = $('copy-diagnostics');
    if (btn) {
      btn.textContent = 'Diagnose kopiert!';
      setTimeout(() => {
        btn.textContent = 'Diagnose kopieren';
      }, 1500);
    }
  } catch {
    // The console line above is the fallback.
  }
});
$('gate-skip')?.addEventListener('click', () => {
  setActive(true);
  showGate(false);
});

// "Steuerung" dialog: open from the toolbar, close by button, backdrop or Esc.
$('controls-open')?.addEventListener('click', () => showControls(true));
$('controls-close')?.addEventListener('click', () => showControls(false));
$('controls')?.addEventListener('click', (event) => {
  if (event.target === $('controls')) showControls(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') showControls(false);
});

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
const hasInvite = /#hw2?=/.test(location.hash || '');
if (hasInvite) {
  showGate(false);
  // Decoding runs through the async codec, so answer outside the sync flow.
  (async () => {
    const blob = await decodeFragment(location.hash);
    if (!blob) {
      showError('gate-error', 'Der Einladungs-Link ist ungültig oder unvollständig.');
      showGate(true);
      return;
    }
    // On `file://` (or without WebRTC) the warning is shown and no peer
    // connection is attempted; tab sync and JSON exchange still work.
    if (webRtcBlockReason()) return;
    if (blob.role === 'guest') {
      await acceptReplyText(location.hash);
    } else {
      await joinAsGuest(blob);
    }
  })();
} else {
  showGate(!isActive);
}
