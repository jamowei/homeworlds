# 23: Clear the pasted reply when leaving a game

**What to build:** "Spiel verlassen" must leave the handshake genuinely clean.
Hiding the panel (`hideHandshake`) left the pasted answer in the
`reply-input` textarea, so returning to the gate still showed the textbox
"Füge die Antwort deines Gegenübers ein:" filled with the previous game's
answer — and the next handshake would offer that stale reply.

**Blocked by:** 20 (Leave the game and return to the gate)

**Status:** resolved

- [x] "Spiel verlassen" clears the "Füge die Antwort deines Gegenübers ein:" textbox
- [x] Closing the handshake drops the old invite link/blob too, so no stale handshake state lingers
- [x] The next handshake starts from empty inputs

## Comments

`hideHandshake()` now empties `reply-input`, `handshake-link` and
`handshake-blob` before/while hiding the panel. `leaveGame()` already calls
`hideHandshake()`, so the local reset reaches a clean gate without any
leave-specific code. The player's name is untouched. `node --test` stays green
(127 tests).
