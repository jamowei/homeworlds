# 20: Leave the game and return to the gate

**What to build:** Once a player had created or joined a game there was no way
back to the create/join modal — the only route was clearing `localStorage` by
hand. Add a "Spiel verlassen" action that does a complete local reset and
returns to the gate.

**Blocked by:** 09 (Identity gate and handshake UI), 11 (Reconnect and merge)

**Status:** resolved

- [x] A "Spiel verlassen" button in the toolbar returns to the create/join modal
- [x] Leaving disconnects any peer and drops this game's saved board, role and remembered id
- [x] The player's name is kept (it is a preference, not game state)
- [x] After leaving, a reload still shows the gate (it does not auto-resume)
- [x] The action is explained in the "Steuerung" dialog

## Comments

`storage/store.js` gains `removeDocument`, `forgetGameId` and `removePreference`
(all never-throwing, like the rest of the adapter). `app.js` adds `leaveGame()`:
it tears down the WebRTC and BroadcastChannel transports, clears the current
game's saved document, role and remembered id, resets the peer registry, and
renders a fresh unsaved board under the gate. Whether the gate shows on load now
depends on an explicit `hw-active` flag (create/join and "without an opponent"
set it, leaving clears it), falling back to "a board is saved" so players
upgrading from the old behaviour keep resuming.
