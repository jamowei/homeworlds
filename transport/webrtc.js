// transport/webrtc.js
//
// Serverless, two-way-handshake WebRTC transport. It implements the same
// interface as the BroadcastChannel adapter (see transport/broadcast.js) and is
// driven by the app:
//
//   host:  const t = createWebRtcTransport({ role: 'host', gameId })
//          const offer = await t.createOffer()      // -> blob for the invite link
//          await t.acceptAnswer(replyBlob)          // -> the connection completes
//
//   guest: const t = createWebRtcTransport({ role: 'guest' })
//          const answer = await t.createAnswer(offerBlob) // -> blob for the reply
//
// STUN only: there is no TURN relay and no application server. The SDP never
// touches a server; it travels in the URL fragment or the paste box.

export const DEFAULT_ICE_SERVERS = Object.freeze([
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Extra public STUN servers: more chances to obtain a server-reflexive
  // candidate when one provider is unreachable or blocked on a given network.
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
]);

// --- Optional TURN relay (Metered) ---------------------------------------
//
// STUN alone cannot traverse a symmetric NAT; a TURN relay can. Metered exposes
// a REST endpoint that returns a ready `iceServers` array (STUN + TURN with
// username/credential) for a *credential-scoped* API key. That key is safe to
// ship in front-end code: it only unlocks the one credential, and the password
// is fetched at runtime rather than committed.

const METERED_CREDENTIALS_PATH = '/api/v1/turn/credentials';

// Build the Metered credentials URL from a bare domain (`app.metered.live`).
// Returns null when the config is incomplete, so callers fall back to STUN.
export function meteredCredentialsUrl(domain, apiKey) {
  const host = String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const key = String(apiKey || '').trim();
  if (!host || !key) return null;
  return `https://${host}${METERED_CREDENTIALS_PATH}?apiKey=${encodeURIComponent(key)}`;
}

// Keep only the fields `RTCPeerConnection` understands, and drop an entry that
// has no usable url.
function normaliseIceServer(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const urls = entry.urls;
  if (typeof urls !== 'string' || !urls) return null;
  const server = { urls };
  if (typeof entry.username === 'string' && entry.username) server.username = entry.username;
  if (typeof entry.credential === 'string' && entry.credential) server.credential = entry.credential;
  return server;
}

// Merge server lists, dropping duplicates by `urls` (first list wins). Public
// STUN servers are passed first, so a relay's own STUN entry never displaces
// them.
export function mergeIceServers(...lists) {
  const byUrls = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const server = normaliseIceServer(raw);
      if (server && !byUrls.has(server.urls)) byUrls.set(server.urls, server);
    }
  }
  return [...byUrls.values()];
}

// Fetch the Metered ICE array, or null on any problem (missing config, network
// error, timeout, malformed body). Never throws: the caller then uses STUN only.
export async function fetchMeteredIceServers({ domain, apiKey, fetchImpl, timeoutMs = 5000 } = {}) {
  const url = meteredCredentialsUrl(domain, apiKey);
  if (!url) return null;
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await doFetch(url, controller ? { signal: controller.signal } : undefined);
    if (!response || !response.ok) return null;
    const data = await response.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const GATHER_TIMEOUT_MS = 4000;

function waitForIceGathering(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    let timer = null;
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', done);
        if (timer) clearTimeout(timer);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', done);
    // Don't hang forever on a network that never finishes gathering.
    timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    }, GATHER_TIMEOUT_MS);
  });
}

export function isWebRtcSupported() {
  return typeof RTCPeerConnection !== 'undefined';
}

export function createWebRtcTransport(options = {}) {
  const role = options.role || 'host';
  const iceServers = options.iceServers || DEFAULT_ICE_SERVERS;
  const supported = isWebRtcSupported();

  let onMessage = null;
  let onStatus = null;
  let onError = null;
  let pc = null;
  let channel = null;
  let closed = false;
  let answered = false;
  const queue = [];

  function emitStatus(status) {
    if (onStatus) onStatus(status);
  }

  function flush() {
    while (queue.length && channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(queue.shift()));
    }
  }

  function attachChannel(nextChannel) {
    channel = nextChannel;
    channel.onopen = () => {
      emitStatus('connected');
      flush();
    };
    channel.onclose = () => emitStatus('disconnected');
    channel.onerror = (event) => onError?.(event);
    channel.onmessage = (event) => {
      let message = event.data;
      if (typeof message === 'string') {
        try {
          message = JSON.parse(message);
        } catch {
          return; // corrupt message: ignore safely
        }
      }
      if (onMessage) onMessage(message);
    };
  }

  function wireConnection(connection) {
    connection.onconnectionstatechange = () => {
      switch (connection.connectionState) {
        case 'connected':
          emitStatus('connected');
          break;
        // `failed` is terminal for this connection: report it distinctly so the
        // UI can say so instead of waiting forever on a handshake that will
        // never complete.
        case 'failed':
          emitStatus('failed');
          break;
        case 'disconnected':
        case 'closed':
          emitStatus('disconnected');
          break;
        default:
          break;
      }
    };
    connection.onicecandidateerror = () => {};
  }

  async function createOffer() {
    if (!supported) throw new Error('WebRTC wird von diesem Browser nicht unterstützt.');
    pc = new RTCPeerConnection({ iceServers });
    wireConnection(pc);
    attachChannel(pc.createDataChannel('board'));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    emitStatus('waiting');
    return { v: 1, role: 'host', gameId: options.gameId || 'local', sdp: pc.localDescription.toJSON() };
  }

  async function acceptAnswer(blob) {
    if (!pc) throw new Error('Kein Angebot vorhanden.');
    if (answered) throw new Error('Es sind bereits zwei Spieler verbunden.');
    if (!blob || !blob.sdp) throw new Error('Ungültige Antwort.');
    await pc.setRemoteDescription(blob.sdp);
    answered = true;
    emitStatus('waiting');
  }

  async function createAnswer(offerBlob) {
    if (!supported) throw new Error('WebRTC wird von diesem Browser nicht unterstützt.');
    if (!offerBlob || !offerBlob.sdp) throw new Error('Ungültige Einladung.');
    pc = new RTCPeerConnection({ iceServers });
    wireConnection(pc);
    pc.ondatachannel = (event) => attachChannel(event.channel);
    await pc.setRemoteDescription(offerBlob.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);
    emitStatus('waiting');
    return { v: 1, role: 'guest', gameId: offerBlob.gameId || 'local', sdp: pc.localDescription.toJSON() };
  }

  return {
    name: 'webrtc',
    kind: 'webrtc',
    role,
    supported,
    setHandlers(handlers = {}) {
      // Error reporting uses the *same* mechanism as onMessage/onStatus:
      // `setHandlers({ onError })`. Handlers merge, so the hub can wire
      // messages/status first and the app can add `onError` afterwards without
      // clearing them. There is deliberately no separate `onError` property.
      if ('onMessage' in handlers) onMessage = handlers.onMessage || null;
      if ('onStatus' in handlers) onStatus = handlers.onStatus || null;
      if ('onError' in handlers) onError = handlers.onError || null;
    },
    start() {
      if (!supported) emitStatus('unavailable');
    },
    send(message) {
      if (channel && channel.readyState === 'open') {
        channel.send(JSON.stringify(message));
      } else {
        queue.push(message);
      }
    },
    isConnected() {
      return !!channel && channel.readyState === 'open';
    },
    createOffer,
    acceptAnswer,
    createAnswer,
    close() {
      if (closed) return;
      closed = true;
      queue.length = 0;
      try {
        channel?.close();
      } catch {
        /* ignore */
      }
      try {
        pc?.close();
      } catch {
        /* ignore */
      }
      channel = null;
      pc = null;
      emitStatus('closed');
    },
  };
}
