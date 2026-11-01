# 06: Autosave and resume

**What to build:** Every change to the board (pieces and camera) is saved automatically in the player's browser — debounced, with no Save button. Reloading the page restores the exact board and camera, even with no opponent connected, and the app remembers which game it was in so reopening returns to it.

**Blocked by:** 05 (Camera pan and zoom)

**Status:** ready-for-agent

- [ ] Every board change (pieces and camera) is saved automatically and debounced, with no Save button
- [ ] Reloading the page restores the board and camera exactly as left, with no opponent connected
- [ ] The app remembers which game it was in and returns to it on reload
- [ ] Storage is keyed per game, so a different gameId does not overwrite the current one
- [ ] Tests cover the storage adapter's load/save round-trip
