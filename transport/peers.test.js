import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPeerRegistry } from './peers.js';

test('a game holds exactly two players', () => {
  const peers = createPeerRegistry({ self: 'me', limit: 2 });
  assert.equal(peers.size(), 1, 'self counts as one');
  assert.equal(peers.register('opponent'), true);
  assert.equal(peers.size(), 2);
  assert.equal(peers.isFull(), true);
});

test('a third joiner is rejected', () => {
  const peers = createPeerRegistry({ self: 'me' });
  peers.register('a');
  assert.equal(peers.register('third'), false);
  assert.equal(peers.has('third'), false);
  assert.equal(peers.size(), 2);
});

test('re-registering a known peer is idempotent', () => {
  const peers = createPeerRegistry({ self: 'me' });
  assert.equal(peers.register('a'), true);
  assert.equal(peers.register('a'), true);
  assert.equal(peers.size(), 2);
});

test('an empty id is not a peer', () => {
  const peers = createPeerRegistry({ self: 'me' });
  assert.equal(peers.register(''), false);
  assert.equal(peers.register(null), false);
  assert.equal(peers.size(), 1);
});
