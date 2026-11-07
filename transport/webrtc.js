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
// STUN/TURN only: there is no application server. The SDP never touches a
// server; it travels in the URL fragment or the paste box.
//
// Diagnostics: every peer connection logs what it is doing under the prefix
// `[Homeworlds WebRTC]` — configured ICE servers, gathered candidates by type,
// ICE/signalling/connection state changes, STUN/TURN errors, and the selected
// candidate pair (direct vs. relay). A failure also prints a one-line JSON
// report that can be copied into a bug report.

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
// `onError` receives a short human-readable reason, which the app logs so a
// silent fallback to STUN is visible in the console.
export async function fetchMeteredIceServers({ domain, apiKey, fetchImpl, timeoutMs = 5000, onError } = {}) {
  const fail = (reason) => {
    try {
      onError?.(reason);
    } catch {
      /* a broken logger must never break the fallback */
    }
    return null;
  };
  const url = meteredCredentialsUrl(domain, apiKey);
  if (!url) return fail('TURN-Konfiguration ist unvollständig.');
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') return fail('fetch ist in diesem Browser nicht verfügbar.');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await doFetch(url, controller ? { signal: controller.signal } : undefined);
    if (!response || !response.ok) return fail(`TURN-Server antwortet mit HTTP ${response?.status ?? '?'}.`);
    const data = await response.json();
    if (!Array.isArray(data)) return fail('TURN-Server liefert keine ICE-Server-Liste.');
    return data;
  } catch (error) {
    const timeout = error?.name === 'AbortError';
    return fail(timeout ? `TURN-Server antwortet nicht innerhalb von ${timeoutMs} ms.` : error?.message || String(error));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// --- Diagnostics helpers ------------------------------------------------

const LOG_PREFIX = '[Homeworlds WebRTC]';

function logInfo(message, details) {
  if (details === undefined) console.info(LOG_PREFIX, message);
  else console.info(LOG_PREFIX, message, details);
}
function logWarn(message, details) {
  if (details === undefined) console.warn(LOG_PREFIX, message);
  else console.warn(LOG_PREFIX, message, details);
}
function logError(message, details) {
  if (details === undefined) console.error(LOG_PREFIX, message);
  else console.error(LOG_PREFIX, message, details);
}

// Count the `a=candidate:` lines in an SDP by candidate type. This is what
// tells us whether STUN (srflx) and/or TURN (relay) actually did their job.
export function candidateSummary(sdp) {
  const types = {};
  const protocols = {};
  let count = 0;
  for (const line of String(sdp || '').split(/\r?\n/u)) {
    if (!line.startsWith('a=candidate:')) continue;
    // foundation component transport priority address port typ type ...
    const parts = line.slice('a=candidate:'.length).split(' ');
    const protocol = parts[2] || null;
    const type = parts[7] || null;
    if (!type) continue;
    count += 1;
    types[type] = (types[type] || 0) + 1;
    if (protocol) {
      const list = protocols[type] || (protocols[type] = []);
      if (!list.includes(protocol)) list.push(protocol);
    }
  }
  return {
    count,
    types,
    protocols,
    hasRelay: Boolean(types.relay),
    hasReflexive: Boolean(types.srflx || types.relay),
  };
}

// A credential-free view of the ICE configuration. The TURN username/password
// must never end up in a bug report.
export function iceServerSummary(servers) {
  return (Array.isArray(servers) ? servers : []).map((server) => ({
    urls: server?.urls || null,
    authenticated: Boolean(server?.username || server?.credential),
  }));
}

function hasTurnServers(servers) {
  return (Array.isArray(servers) ? servers : []).some((server) => /^turns?:/iu.test(String(server?.urls || '')));
}

// Read the selected candidate pair out of `RTCPeerConnection.getStats()`.
// `path` is 'relay' when either side is a TURN relay candidate, otherwise
// 'direct' (host/srflx/prflx). Works with an RTCStatsReport (it has forEach).
export function summariseConnectionStats(report) {
  if (!report || typeof report.forEach !== 'function') return null;
  const byId = new Map();
  report.forEach((entry) => {
    if (entry && typeof entry === 'object' && entry.id) byId.set(entry.id, entry);
  });

  let pair = null;
  for (const entry of byId.values()) {
    if (entry.type === 'candidate-pair' && (entry.selected === true || entry.nominated === true)) {
      pair = entry;
      break;
    }
  }
  if (!pair) {
    for (const entry of byId.values()) {
      if (entry.type === 'candidate-pair' && entry.state === 'succeeded') {
        pair = entry;
        break;
      }
    }
  }
  if (!pair) {
    for (const entry of byId.values()) {
      if (entry.type === 'candidate-pair') {
        pair = entry;
        break;
      }
    }
  }
  if (!pair) return null;

  const local = byId.get(pair.localCandidateId);
  const remote = byId.get(pair.remoteCandidateId);
  const localType = local?.candidateType || null;
  const remoteType = remote?.candidateType || null;
  const relay = localType === 'relay' || remoteType === 'relay';
  return {
    path: relay ? 'relay' : 'direct',
    localType,
    remoteType,
    protocol: local?.protocol || pair.protocol || null,
    state: pair.state || null,
    bytesSent: pair.bytesSent,
    bytesReceived: pair.bytesReceived,
    summary: relay
      ? 'über TURN-Relay'
      : localType && remoteType
        ? `direkt (${localType} → ${remoteType})`
        : 'direkt',
  };
}

// ICE gathering with two bounds rather than one blunt timeout:
//  - resolve as soon as the browser reports `complete`, or
//  - resolve once at least one STUN/TURN candidate exists and no new candidate
//    has arrived for `quietMs` (gathering against several public STUN servers
//    often never reaches `complete` because one provider stays silent), or
//  - hard-stop after `timeoutMs`.
// Waiting for the quiet period matters: a candidate that arrives after we read
// `localDescription.toJSON()` is lost, because this transport does not trickle.
const GATHER_TIMEOUT_MS = 10000;
const GATHER_QUIET_MS = 800;

export function waitForIceGathering(
  pc,
  { timeoutMs = GATHER_TIMEOUT_MS, quietMs = GATHER_QUIET_MS, requireRelay = false } = {},
) {
  return new Promise((resolve) => {
    const started = Date.now();
    let lastCandidateAt = started;
    let settled = false;
    let timer = null;

    const onCandidate = (event) => {
      if (event?.candidate) lastCandidateAt = Date.now();
    };

    const finish = (reason) => {
      if (settled) return;
      settled = true;
      pc.removeEventListener?.('icecandidate', onCandidate);
      clearTimeout(timer);
      const summary = candidateSummary(pc.localDescription?.sdp);
      resolve({ reason, elapsedMs: Date.now() - started, ...summary });
    };

    pc.addEventListener?.('icecandidate', onCandidate);

    const poll = () => {
      if (settled) return;
      const elapsed = Date.now() - started;
      const summary = candidateSummary(pc.localDescription?.sdp);
      // With a TURN relay configured, wait for a relay candidate before the
      // quiet period can end the gathering: a direct/STUN candidate alone is
      // not enough on a symmetric NAT, and a relay allocation may take longer
      // than the STUN round-trip.
      const usable = requireRelay ? summary.hasRelay : summary.hasReflexive;
      if (pc.iceGatheringState === 'complete') return finish('complete');
      if (elapsed >= timeoutMs) return finish('timeout');
      if (usable && Date.now() - lastCandidateAt >= quietMs) return finish('idle');
      timer = setTimeout(poll, 100);
    };
    poll();
  });
}

function logGathering(label, gathering, requireRelay = false) {
  const details = {
    reason: gathering.reason,
    elapsedMs: gathering.elapsedMs,
    candidates: gathering.types,
    protocols: gathering.protocols,
  };
  if (requireRelay && !gathering.hasRelay) {
    logWarn(
      `${label}: TURN ist konfiguriert, aber kein Relay-Kandidat wurde gesammelt. ` +
        'Hinter einem symmetrischen NAT wird die Verbindung wahrscheinlich scheitern.',
      details,
    );
  } else if (gathering.hasReflexive) {
    logInfo(`${label}: ICE-Kandidaten gesammelt.`, details);
  } else {
    logWarn(
      `${label}: nur lokale Kandidaten – STUN/TURN hat nicht geantwortet. ` +
        'Eine Verbindung über verschiedene Netzwerke wird damit wahrscheinlich scheitern.',
      details,
    );
  }
}

export function isWebRtcSupported() {
  return typeof RTCPeerConnection !== 'undefined';
}

export function createWebRtcTransport(options = {}) {
  const role = options.role || 'host';
  const iceServers = options.iceServers || DEFAULT_ICE_SERVERS;
  const supported = isWebRtcSupported();
  // A configured relay is only useful if it produced a candidate; wait for one
  // before freezing the SDP.
  const gatherRequiresRelay = hasTurnServers(iceServers);

  let onMessage = null;
  let onStatus = null;
  let onError = null;
  let pc = null;
  let channel = null;
  let closed = false;
  let answered = false;
  let iceErrors = [];
  let selectedPath = null;
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
      logInfo('Datenkanal ist offen.');
      emitStatus('connected');
      flush();
    };
    channel.onclose = () => {
      logInfo('Datenkanal wurde geschlossen.');
      emitStatus('disconnected');
    };
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

  // A compact, credential-free snapshot for the console and the "Diagnose
  // kopieren" button. Never include the TURN username/password.
  function diagnostics() {
    return {
      role,
      iceServers: iceServerSummary(iceServers),
      connectionState: pc?.connectionState || null,
      iceConnectionState: pc?.iceConnectionState || null,
      iceGatheringState: pc?.iceGatheringState || null,
      signalingState: pc?.signalingState || null,
      answered,
      localCandidates: candidateSummary(pc?.localDescription?.sdp),
      remoteCandidates: candidateSummary(pc?.remoteDescription?.sdp),
      iceErrors: [...iceErrors],
      path: selectedPath,
    };
  }

  async function describeSelectedPath(connection) {
    try {
      const stats = summariseConnectionStats(await connection.getStats());
      if (!stats) return;
      selectedPath = stats;
      logInfo(`Verbindung steht: ${stats.summary}.`, stats);
    } catch {
      /* diagnostics must never break the connection */
    }
  }

  async function reportFailure(connection) {
    let stats = null;
    try {
      stats = summariseConnectionStats(await connection.getStats());
      if (stats) selectedPath = stats;
    } catch {
      /* ignore */
    }
    const report = diagnostics();
    logError('Verbindung fehlgeschlagen. Diagnose siehe unten.', report);
    logError(`Diagnose als JSON: ${JSON.stringify(report)}`);
    logError(
      'Weitere Details: chrome://webrtc-internals (Chrome/Edge) bzw. about:webrtc (Firefox). ' +
        'Häufigste Ursachen: symmetrisches NAT ohne erreichbares TURN-Relay oder eine blockierende Firewall.',
    );
  }

  function wireConnection(connection) {
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      logInfo(`connectionState: ${state}`);
      switch (state) {
        case 'connected':
          emitStatus('connected');
          describeSelectedPath(connection);
          break;
        // `failed` is terminal for this connection: report it distinctly so the
        // UI can say so instead of waiting forever on a handshake that will
        // never complete.
        case 'failed':
          emitStatus('failed');
          reportFailure(connection);
          break;
        case 'disconnected':
        case 'closed':
          emitStatus('disconnected');
          break;
        default:
          break;
      }
    };
    connection.oniceconnectionstatechange = () => {
      logInfo(`iceConnectionState: ${connection.iceConnectionState}`);
    };
    connection.onsignalingstatechange = () => {
      logInfo(`signalingState: ${connection.signalingState}`);
    };
    connection.onicegatheringstatechange = () => {
      logInfo(`iceGatheringState: ${connection.iceGatheringState}`);
    };
    connection.onicecandidate = (event) => {
      const candidate = event?.candidate;
      if (!candidate) return;
      console.debug(LOG_PREFIX, 'ICE-Kandidat', {
        type: candidate.type,
        protocol: candidate.protocol,
        address: candidate.address,
        port: candidate.port,
      });
    };
    // This is the callback the browser uses for failed STUN/TURN requests. It
    // used to be swallowed, which is why the console stayed empty on a network
    // that blocks the relay.
    connection.onicecandidateerror = (event) => {
      const info = {
        url: event?.url,
        address: event?.address,
        port: event?.port,
        errorCode: event?.errorCode,
        errorText: event?.errorText,
        hostCandidate: event?.hostCandidate,
      };
      iceErrors.push(info);
      logWarn('ICE-Kandidatenfehler (STUN/TURN).', info);
    };
  }

  async function createOffer() {
    if (!supported) throw new Error('WebRTC wird von diesem Browser nicht unterstützt.');
    iceErrors = [];
    selectedPath = null;
    logInfo('Erzeuge Angebot …', { iceServers: iceServerSummary(iceServers) });
    pc = new RTCPeerConnection({ iceServers });
    wireConnection(pc);
    attachChannel(pc.createDataChannel('board'));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const gathering = await waitForIceGathering(pc, { requireRelay: gatherRequiresRelay });
    logGathering('Angebot', gathering, gatherRequiresRelay);
    emitStatus('waiting');
    return { v: 1, role: 'host', gameId: options.gameId || 'local', sdp: pc.localDescription.toJSON() };
  }

  async function acceptAnswer(blob) {
    if (!pc) throw new Error('Kein Angebot vorhanden.');
    if (answered) {
      if (pc.connectionState === 'connected') throw new Error('Es sind bereits zwei Spieler verbunden.');
      throw new Error(
        'Diese Antwort wurde bereits übernommen, aber die Verbindung ist fehlgeschlagen. ' +
          'Klicke „Verbindung erneuern“, um eine neue Einladung zu erzeugen.',
      );
    }
    if (!blob || !blob.sdp) throw new Error('Ungültige Antwort.');
    if (blob.role && blob.role !== 'guest') {
      throw new Error('Das ist eine Einladung, keine Antwort. Bitte den Antwort-Link deines Gegenübers einfügen.');
    }
    logInfo('Übernehme Antwort …', { remoteCandidates: candidateSummary(blob?.sdp?.sdp) });
    await pc.setRemoteDescription(blob.sdp);
    answered = true;
    emitStatus('waiting');
  }

  async function createAnswer(offerBlob) {
    if (!supported) throw new Error('WebRTC wird von diesem Browser nicht unterstützt.');
    if (!offerBlob || !offerBlob.sdp) throw new Error('Ungültige Einladung.');
    iceErrors = [];
    selectedPath = null;
    logInfo('Erzeuge Antwort …', {
      iceServers: iceServerSummary(iceServers),
      remoteCandidates: candidateSummary(offerBlob?.sdp?.sdp),
    });
    pc = new RTCPeerConnection({ iceServers });
    wireConnection(pc);
    pc.ondatachannel = (event) => attachChannel(event.channel);
    await pc.setRemoteDescription(offerBlob.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const gathering = await waitForIceGathering(pc, { requireRelay: gatherRequiresRelay });
    logGathering('Antwort', gathering, gatherRequiresRelay);
    emitStatus('waiting');
    return { v: 1, role: 'guest', gameId: offerBlob.gameId || 'local', sdp: pc.localDescription.toJSON() };
  }

  // Resolve once the data channel is open; reject on a terminal failure or a
  // timeout. The app shows a spinner while this is pending, so a connection
  // attempt never looks like a frozen page.
  function waitForConnection({ timeoutMs = 25000 } = {}) {
    return new Promise((resolve, reject) => {
      if (channel && channel.readyState === 'open') {
        resolve();
        return;
      }
      if (!pc) {
        reject(new Error('Keine offene Einladung. Erstelle zuerst ein neues Spiel.'));
        return;
      }

      let settled = false;
      let timer = null;

      const cleanup = () => {
        clearTimeout(timer);
        pc?.removeEventListener('connectionstatechange', onStateChange);
        channel?.removeEventListener('open', onOpen);
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onOpen = () => finish(null);
      const onStateChange = () => {
        if (!pc) return finish(new Error('Die Verbindung wurde geschlossen.'));
        if (pc.connectionState === 'connected') return finish(null);
        if (pc.connectionState === 'failed') {
          return finish(
            new Error(
              'Die Verbindung konnte nicht hergestellt werden. Das Netzwerk blockiert vermutlich die ' +
                'direkte Verbindung (NAT/Firewall). Details stehen in der Browser-Konsole unter ' +
                '„[Homeworlds WebRTC]“. Klicke „Verbindung erneuern“ für einen neuen Versuch.',
            ),
          );
        }
        if (pc.connectionState === 'closed') return finish(new Error('Die Verbindung wurde geschlossen.'));
        return undefined;
      };

      channel?.addEventListener('open', onOpen);
      pc.addEventListener('connectionstatechange', onStateChange);
      timer = setTimeout(
        () => {
          // No answer from ICE/DTLS after a generous wait: reflect that in the
          // toolbar instead of leaving it on "Warte auf Gegner" forever.
          emitStatus('failed');
          finish(
            new Error(
              'Zeitüberschreitung beim Verbindungsaufbau. Prüfe, ob die Gegenseite die Seite noch ' +
                'geöffnet hat. Details stehen in der Browser-Konsole unter „[Homeworlds WebRTC]“. ' +
                'Klicke „Verbindung erneuern“ für einen neuen Versuch.',
            ),
          );
        },
        timeoutMs,
      );
      onStateChange();
    });
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
    getDiagnostics() {
      return diagnostics();
    },
    createOffer,
    acceptAnswer,
    createAnswer,
    waitForConnection,
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
