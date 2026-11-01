// transport/hub.js
//
// Fans several transports (BroadcastChannel, WebRTC, …) into one stream and
// deduplicates by message id, so a change that arrives over two paths is
// applied once. Both live transports feed the *same* reducer input; the hub is
// where echo loops and duplicates are stopped.

const SEEN_LIMIT = 4000;

export function createHub({ onMessage, onStatus } = {}) {
  const transports = new Set();
  const seen = new Set();
  const order = [];

  function remember(id) {
    if (typeof id !== 'string' || id.length === 0) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    order.push(id);
    if (order.length > SEEN_LIMIT) {
      seen.delete(order.shift());
    }
    return true;
  }

  function deliver(message, source) {
    if (!message || typeof message !== 'object') return;
    if (!remember(message.id)) return;
    if (onMessage) onMessage(message, source);
  }

  function add(transport) {
    transport.setHandlers({
      onMessage: (message) => deliver(message, transport),
      onStatus: (status) => {
        if (onStatus) onStatus(status, transport);
      },
    });
    transport.start?.();
    transports.add(transport);
    return transport;
  }

  function send(message) {
    // Remember our own message so an echo is never re-applied.
    if (message && typeof message.id === 'string') remember(message.id);
    for (const transport of transports) transport.send(message);
  }

  function remove(transport) {
    transport.close?.();
    transports.delete(transport);
  }

  function close() {
    for (const transport of transports) transport.close?.();
    transports.clear();
  }

  return {
    add,
    remove,
    send,
    close,
    get transports() {
      return [...transports];
    },
  };
}
