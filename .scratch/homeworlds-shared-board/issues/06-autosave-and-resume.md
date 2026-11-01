# 06: Autosave and resume

**What to build:** Every change to the board (pieces and camera) is saved automatically in the player's browser — debounced, with no Save button. Reloading the page restores the exact board and camera, even with no opponent connected, and the app remembers which game it was in so reopening returns to it.

**Blocked by:** 05 (Camera pan and zoom)

**Status:** resolved

- [x] Every board change (pieces and camera) is saved automatically and debounced, with no Save button
- [x] Reloading the page restores the board and camera exactly as left, with no opponent connected
- [x] The app remembers which game it was in and returns to it on reload
- [x] Storage is keyed per game, so a different gameId does not overwrite the current one
- [x] Tests cover the storage adapter's load/save round-trip

## Comments

Implemented on the integration branch as `storage/store.js`: a dependency-free
`localStorage` adapter (`createStore({ storage })`) with
`loadDocument`/`saveDocument` (key `hw-board:<gameId>`), `rememberGameId`/
`lastGameId`, and an `isAvailable()` probe. It never throws and falls back
safely when storage is missing or disabled. `app.js` resumes the last game
(`?game=` → remembered id → `local`), restores the saved board and camera, and
autosaves debounced (300 ms) on every change through a single `setDocument`
helper — with a `pagehide` flush and no Save button. Storage is keyed per game,
so a different gameId never clobbers the current one. Tests cover the
round-trip, per-game keying, the remembered id and throwing backends.
