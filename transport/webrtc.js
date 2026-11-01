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
]);

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
        case 'disconnected':
        case 'failed':
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
    if (!blob || !blob.sdp) throw new Error('Ungültige Antwort.');
    await pc.setRemoteDescription(blob.sdp);
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
      onMessage = handlers.onMessage || null;
      onStatus = handlers.onStatus || null;
      if (handlers.onError) onError = handlers.onError;
    },
    set onError(fn) {
      onError = fn;
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
