import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from './store.js';

// A tiny in-memory stand-in for `localStorage`. It exposes the same get/set/
// remove surface the adapter relies on, plus the raw map so tests can assert on
// the exact keys that were written.
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

// A backend that fails the way private mode / file:// does: every access throws.
function throwingStorage() {
  const boom = () => {
    throw new Error('storage is not available');
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

test('a saved document loads back unchanged', () => {
  const store = createStore({ storage: memoryStorage() });
  const document = { gameId: 'g1', pieces: { a: { id: 'a', x: 3 } }, camera: { x: 1, y: 2, zoom: 2 } };

  store.saveDocument(document);

  assert.deepEqual(store.loadDocument('g1'), document);
});

test('loading a game that was never saved yields null', () => {
  const store = createStore({ storage: memoryStorage() });
  assert.equal(store.loadDocument('never-seen'), null);
});

test('documents are keyed per game and do not overwrite each other', () => {
  const storage = memoryStorage();
  const store = createStore({ storage });

  store.saveDocument({ gameId: 'alpha', camera: { zoom: 1 } });
  store.saveDocument({ gameId: 'beta', camera: { zoom: 3 } });

  assert.ok(storage.map.has('hw-board:alpha'), 'alpha uses its own key');
  assert.ok(storage.map.has('hw-board:beta'), 'beta uses its own key');
  assert.deepEqual(store.loadDocument('alpha'), { gameId: 'alpha', camera: { zoom: 1 } });
  assert.deepEqual(store.loadDocument('beta'), { gameId: 'beta', camera: { zoom: 3 } });
});

test('the last game id is remembered and read back', () => {
  const store = createStore({ storage: memoryStorage() });
  assert.equal(store.lastGameId(), null, 'nothing remembered yet');

  store.rememberGameId('game-42');

  assert.equal(store.lastGameId(), 'game-42');
  assert.equal(store.lastGameId(), store.lastGameId(), 'stable across reads');
});

test('a corrupt stored document is rejected without throwing', () => {
  const storage = memoryStorage({ 'hw-board:g1': '{not valid json' });
  const store = createStore({ storage });
  assert.equal(store.loadDocument('g1'), null);
});

test('saveDocument ignores a document without a game id', () => {
  const storage = memoryStorage();
  const store = createStore({ storage });
  assert.equal(store.saveDocument({ camera: { zoom: 1 } }), false);
  assert.equal(storage.map.size, 0, 'nothing was written');
});

test('a throwing backend degrades safely: load, save and remember never throw', () => {
  const store = createStore({ storage: throwingStorage() });

  assert.equal(store.isAvailable(), false);
  assert.equal(store.loadDocument('g1'), null);
  assert.equal(store.saveDocument({ gameId: 'g1', camera: { zoom: 1 } }), false);
  assert.doesNotThrow(() => store.rememberGameId('g1'));
  assert.equal(store.lastGameId(), null);
});

test('isAvailable reflects whether the backend can be used', () => {
  assert.equal(createStore({ storage: memoryStorage() }).isAvailable(), true);
  assert.equal(createStore({ storage: null }).isAvailable(), false);
  assert.equal(createStore({ storage: throwingStorage() }).isAvailable(), false);
});

test('the store works with no storage at all (Node default)', () => {
  const store = createStore({ storage: null });
  assert.equal(store.loadDocument('g1'), null);
  assert.equal(store.saveDocument({ gameId: 'g1', camera: { zoom: 1 } }), false);
  assert.equal(store.lastGameId(), null);
});
