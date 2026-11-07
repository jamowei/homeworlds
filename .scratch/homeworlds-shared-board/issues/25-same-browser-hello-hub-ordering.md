# 25: Same-browser tabs never announce themselves (hub ordering)

**What to build:** Fix same-browser peer discovery. `createHub`'s `add()` called
`transport.start()` *before* adding the transport to its set. A
`BroadcastChannel` transport reports `available` synchronously from `start()`,
and the app announces itself with a `hello` on that status — but `hub.send`
then fanned the `hello` out to an empty set, so it went nowhere. Two tabs on the
same game therefore never registered each other: the status stayed
"Nicht verbunden"/"Warte auf Gegner" and the invite panel never folded, even
though board changes still synced once someone moved a piece.

**Blocked by:** 07 (Same-browser sync), 20 (Leave the game and return to the gate)

**Status:** resolved

- [x] A transport is part of the hub *before* `start()` runs
- [x] A status emitted during `start()` can be answered with a send that reaches that transport
- [x] Two same-browser tabs register each other and report "Verbunden"
- [x] The invite panel folds on that connection

## Comments

`transport/hub.js`: `add()` now calls `transports.add(transport)` before
`transport.start?.()`, with a comment explaining why. `transport/hub.test.js`
gains a regression test: a fake transport whose `start()` emits `available`
while the hub's `onStatus` sends a message must end up with that message in
`sent`.

Two related app changes make the result coherent: `aggregateStatus()` checks
`peers.size() > 1` first, so a registered peer wins over a lingering WebRTC
`waiting` status (same-browser tabs have two transports, only one of which
reports `connected`); and the handshake fold is animated (ticket 24).

Verified in a real browser (two tabs, one context): before the fix the second
tab stayed "Nicht verbunden" and the first kept its invite panel; after, the
second tab shows "Verbunden mit Gast" and the first tab's panel folds smoothly
from 308px to 0 over ~240ms. `node --test` stays green (128 tests).
