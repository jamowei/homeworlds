# 19: Loading feedback for slow actions

**What to build:** Some actions take a moment — creating an offer or an answer
waits for ICE gathering (up to a few seconds) — but the screen just froze with
no sign that anything was happening. Add a visible loading animation so the
player knows to wait.

**Blocked by:** 09 (Identity gate and handshake UI)

**Status:** resolved

- [x] A spinner appears while a game is created and while an invite is answered
- [x] The spinner also covers a slow first board paint, without flashing on fast loads
- [x] The spinner is hidden again once the action finishes
- [x] A failed action still surfaces its error

## Comments

`play.html` gains a full-screen `.busy-overlay` (spinner + step label) plus an
inline timer that reveals it only if the board has not signalled ready within
120 ms, so a fast load does not flash. `app.js` adds `setBusy(busy, text)` and
calls it around `createOffer` / `createAnswer` / `acceptAnswer`; the first-paint
`requestAnimationFrame` clears the load timer and hides the overlay. Verified in
a real browser with a `MutationObserver` that the spinner appears during "Neues
Spiel erstellen" and is gone once the invite is ready.
