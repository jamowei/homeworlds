// transport/broadcast.js
//
// BroadcastChannel adapter. Every transport in this app implements the same
// tiny interface:
//
//   {
//     name,
//     setHandlers({ onMessage, onStatus }),
//     start(),            // begin delivering, once handlers are attached
//     send(message),      // fire-and-forget
//     close(),
//   }
//
// A transport never decides what a message means — it only moves messages.
// Deduplication across transports happens in `transport/hub.js`.

export function createBroadcastTransport(name) {
  let onMessage = null;
  let onStatus = null;
  let channel = null;
  const supported = typeof BroadcastChannel !== 'undefined';

  function emitStatus(status) {
    if (onStatus) onStatus(status);
  }

  function start() {
    if (!supported) {
      emitStatus('unavailable');
      return;
    }
    if (channel) return;
    channel = new BroadcastChannel(name);
    channel.addEventListener('message', (event) => {
      if (onMessage) onMessage(event.data);
    });
    channel.addEventListener('messageerror', () => {});
    emitStatus('connected');
  }

  return {
    name,
    kind: 'broadcast',
    supported,
    setHandlers(handlers = {}) {
      onMessage = handlers.onMessage || null;
      onStatus = handlers.onStatus || null;
    },
    start,
    send(message) {
      if (channel) channel.postMessage(message);
    },
    close() {
      if (channel) {
        channel.close();
        channel = null;
      }
      emitStatus('closed');
    },
  };
}
