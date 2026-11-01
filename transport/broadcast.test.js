import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHub } from './hub.js';
import { createBroadcastTransport } from './broadcast.js';

// End-to-end check of the same-browser path: two hubs, each with its own
// BroadcastChannel transport on one channel, exchange a board message. Node's
// global BroadcastChannel stands in for the browser's.
test('two hubs sync over BroadcastChannel', async (t) => {
  if (typeof BroadcastChannel === 'undefined') {
    t.skip('BroadcastChannel unavailable');
    return;
  }
  const name = `hw-test-${Math.random().toString(36).slice(2)}`;
  const received = [];
  const hubB = createHub({ onMessage: (m) => received.push(m) });
  hubB.add(createBroadcastTransport(name));

  const hubA = createHub({});
  hubA.add(createBroadcastTransport(name));

  await new Promise((resolve) => setTimeout(resolve, 20));
  hubA.send({ id: 'm1', type: 'piece', by: 'a' });
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(received.length, 1);
  assert.equal(received[0].id, 'm1');

  hubA.close();
  hubB.close();
});

test('a duplicate arriving twice is applied once', async (t) => {
  if (typeof BroadcastChannel === 'undefined') {
    t.skip('BroadcastChannel unavailable');
    return;
  }
  const name = `hw-test-${Math.random().toString(36).slice(2)}`;
  const received = [];
  const hubB = createHub({ onMessage: (m) => received.push(m) });
  hubB.add(createBroadcastTransport(name));

  const hubA = createHub({});
  hubA.add(createBroadcastTransport(name));
  await new Promise((resolve) => setTimeout(resolve, 20));

  const message = { id: 'dup', type: 'camera', by: 'a' };
  hubA.send(message);
  hubA.send(message);
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(received.length, 1);

  hubA.close();
  hubB.close();
});
