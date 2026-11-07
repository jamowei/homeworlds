# 26: Toolbar layout and a red "Spiel verlassen"

**What to build:** Regroup the toolbar: "Steuerung" moves to the left edge, and
the right side reads "Verbindung erneuern", "Zurücksetzen", "Spiel verlassen".
"Spiel verlassen" is destructive, so make it visibly red.

**Blocked by:** 20 (Leave the game and return to the gate)

**Status:** resolved

- [x] "Steuerung" is the leftmost toolbar control
- [x] The right-hand buttons are ordered "Verbindung erneuern", "Zurücksetzen", "Spiel verlassen"
- [x] "Spiel verlassen" is red
- [x] "Zurücksetzen" keeps its existing look (neutral, red border only on hover)

## Comments

`play.html`: moved `#controls-open` before the status/zoom chips and reordered
the right-hand buttons. `play.css` adds `.btn.danger-solid` (red text + border,
red border on hover) and the leave button uses it. `.btn.danger` — still on
"Zurücksetzen" — is left untouched so only the leave button turns red, as
requested.

Verified in a browser: the toolbar DOM order is `controls-open, status,
zoom-level, spacer, reconnect, reset, leave-game`, and `#leave-game` computes to
`color: var(--red)` while `#reset` stays neutral. `node --test` stays green
(128 tests).
