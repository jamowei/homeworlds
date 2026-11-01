// storage/store.js
//
// Thin, dependency-free `localStorage` adapter for the shared board. It owns
// exactly one concern: persisting a document under `hw-board:<gameId>` and
// remembering the last game id. It has no DOM assumptions, so it imports and
// runs in Node, and it degrades safely (never throws) when `localStorage` is
// missing or unavailable — private mode, disabled cookies or a `file://` page.
//
// Public seam:
//   createStore({ storage } = {}) -> { loadDocument, saveDocument,
//                                      rememberGameId, lastGameId,
//                                      getPreference, setPreference,
//                                      isAvailable }
//
// `storage` defaults to `globalThis.localStorage`; pass `null` (or any object
// with get/set/remove) to test or to force the in-memory fallback.

export const DOCUMENT_KEY_PREFIX = 'hw-board:';
export const LAST_GAME_KEY = 'hw-last-game';

function defaultStorage() {
  // Reading the property itself can throw in some locked-down browsers.
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Does the backend actually work? A set/read/remove probe catches the private
// mode case where the object exists but every call throws.
function probe(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return false;
  }
  const key = `${DOCUMENT_KEY_PREFIX}__probe__`;
  try {
    storage.setItem(key, '1');
    const ok = storage.getItem(key) === '1';
    storage.removeItem?.(key);
    return ok;
  } catch {
    return false;
  }
}

export function createStore(options = {}) {
  const storage = options.storage !== undefined ? options.storage : defaultStorage();

  function read(key) {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function documentKey(gameId) {
    return `${DOCUMENT_KEY_PREFIX}${gameId}`;
  }

  function loadDocument(gameId) {
    if (!gameId) return null;
    const raw = read(documentKey(gameId));
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveDocument(document) {
    const gameId = document?.gameId;
    if (!gameId) return false;
    try {
      return write(documentKey(gameId), JSON.stringify(document));
    } catch {
      // JSON.stringify can throw on cyclic structures; never propagate.
      return false;
    }
  }

  function rememberGameId(gameId) {
    if (!gameId) return false;
    return write(LAST_GAME_KEY, String(gameId));
  }

  function lastGameId() {
    return read(LAST_GAME_KEY);
  }

  // Generic preference access through the same never-throwing seam as the
  // document: used for the player name (and any future UI preference).
  function getPreference(key) {
    if (!key) return null;
    return read(String(key));
  }

  function setPreference(key, value) {
    if (!key) return false;
    return write(String(key), String(value));
  }

  function isAvailable() {
    return probe(storage);
  }

  return {
    loadDocument,
    saveDocument,
    rememberGameId,
    lastGameId,
    getPreference,
    setPreference,
    isAvailable,
  };
}
