// transport/peers.js
//
// A game is exactly two players. This tiny registry tracks the peer ids seen
// over the transports and refuses a third, so a later joiner can be rejected
// without the reducer ever hearing from them.

export function createPeerRegistry({ self = null, limit = 2 } = {}) {
  const peers = new Set();
  if (self) peers.add(self);

  return {
    register(id) {
      if (!id) return false;
      if (peers.has(id)) return true;
      if (peers.size >= limit) return false;
      peers.add(id);
      return true;
    },
    has(id) {
      return peers.has(id);
    },
    remove(id) {
      return peers.delete(id);
    },
    size() {
      return peers.size;
    },
    isFull() {
      return peers.size >= limit;
    },
    get ids() {
      return [...peers];
    },
  };
}
