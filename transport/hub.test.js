import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHub } from './hub.js';

function fakeTransport(name = 'fake') {
  return {
    name,
    sent: [],
    closed: false,
    started: false,
    setHandlers(handlers) {
      this.handlers = handlers;
    },
    start() {
      this.started = true;
    },
    send(message) {
      this.sent.push(message);
    },
    close() {
      this.closed = true;
    },
    emit(message) {
      this.handlers.onMessage(message);
    },
  };
}

test('the hub deduplicates messages by id', () => {
  const got = [];
  const hub = createHub({ onMessage: (m) => got.push(m) });
  const t = fakeTransport();
  hub.add(t);
  t.emit({ id: 'a', type: 'piece' });
  t.emit({ id: 'a', type: 'piece' });
  assert.equal(got.length, 1);
});

test('the hub never re-applies its own echo', () => {
  const got = [];
  const hub = createHub({ onMessage: (m) => got.push(m) });
  const t = fakeTransport();
  hub.add(t);
  const message = { id: 'b', type: 'camera' };
  hub.send(message);
  t.emit(message);
  assert.equal(got.length, 0);
  assert.equal(t.sent.length, 1);
});

test('messages without an id are ignored', () => {
  const got = [];
  const hub = createHub({ onMessage: (m) => got.push(m) });
  const t = fakeTransport();
  hub.add(t);
  t.emit({ type: 'piece' });
  assert.equal(got.length, 0);
});

test('the hub fans a send out to every transport', () => {
  const hub = createHub({});
  const a = fakeTransport('a');
  const b = fakeTransport('b');
  hub.add(a);
  hub.add(b);
  hub.send({ id: 'x', type: 'piece' });
  assert.equal(a.sent.length, 1);
  assert.equal(b.sent.length, 1);
});
