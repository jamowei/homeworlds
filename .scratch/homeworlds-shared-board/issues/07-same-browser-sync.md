# 07: Same-browser sync

**What to build:** Two tabs in the same browser share one board with zero setup. Every board change — moves, rotations, flips, resets and camera changes — appears in the other tab. This introduces the single transport interface, the BroadcastChannel adapter, and message-id deduplication, plus the app wiring that feeds all local operations into the transport and applies received messages through the same reducer.

**Blocked by:** 05 (Camera pan and zoom)

**Status:** resolved

- [x] Two tabs in the same browser sync board changes automatically with no setup
- [x] Moves, rotations, flips, resets and camera changes all appear in the other tab
- [x] Duplicate messages are applied only once (deduped by message id)
- [x] A change made in one tab does not corrupt the board in the other
- [x] An integration check exercises the BroadcastChannel path end-to-end in one browser

## Comments

Implemented on the integration branch. `transport/hub.js` defines the single
transport interface (`setHandlers`/`start`/`send`/`close`), fans several
transports into one stream and deduplicates by message id (including dropping
the sender's own echo). `transport/broadcast.js` is the BroadcastChannel
adapter, always on per game (`hw-board:<gameId>`). `app.js` builds every local
operation as a message, applies it locally through the reducer, then sends it
via the hub; received messages go through the *same* `applyMessage`, so a change
in one tab is never applied twice and never corrupts the board. Tests include a
Node `BroadcastChannel` end-to-end check between two hubs plus dedup cases.
