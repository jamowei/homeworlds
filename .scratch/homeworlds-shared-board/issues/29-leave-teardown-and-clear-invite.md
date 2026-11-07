# 29: "Spiel verlassen" must disconnect the peer and clear the invite

**What to build:** After a real two-peer game, leaving returned to the gate but
the other side still showed "Verbunden mit …". The invite link also appeared to
stay in the handshake panel. Leaving must actually end the session for both
players and leave no stale invite behind.

**Blocked by:** 09 (handshake UI), 20 (leave game), 28 (connection diagnostics)

**Status:** resolved

- [x] The opponent's status flips to "Getrennt" when the other player leaves
- [x] WebRTC is closed and BroadcastChannel no longer receives the old session
- [x] A peer is only forgotten when no other transport still reaches it
- [x] The invite link, reply box, handshake error and gate join field are cleared immediately
- [x] The fresh gate starts with an empty handshake, even if the panel was mid-fold
- [x] Same-browser tabs also learn about the leave (BroadcastChannel has no close event)

## Comments

The root cause of the stuck "Verbunden" status was `aggregateStatus()`: any
registered peer made the status connected, but nothing removed the peer when its
transport disconnected. `app.js` now records which transports delivered each
peer (`peerSources`). On `disconnected`/`closed`, `forgetTransport()` drops only
that source and removes the peer from the registry when it was the last one, so a
peer reachable over both BroadcastChannel and WebRTC survives the loss of one
transport.

`leaveGame()` now sends a `bye` before closing, detaches both transports from the
hub (so the reset cannot send into the old connection), drops their handlers (so
a late message cannot touch the fresh board), and closes them one tick later.
The delay matters for BroadcastChannel: `close()` discards queued messages and
there is no close event for the other tab, so an immediate close would lose the
goodbye. The receiver handles `bye` by marking that transport disconnected and
forgetting the peer immediately.

The handshake inputs are cleared by `clearHandshakeInputs()` inside
`hideHandshake()` itself, not after the 260 ms fold. This fixes the stale invite
(and also clears the gate's join field on leave). `createPeerRegistry()` gains
`remove()` and `createHub()` gains `detach()`; both have unit tests.

Verified with Playwright: after the host leaves, the guest shows
`Getrennt`/`data-state="disconnected"`; the host returns to the gate with an
empty invite link and reply box. The normal, relay-only and forced-failure
scenarios still pass. `node --test` passes 142 tests.
