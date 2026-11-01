# 04: Reset with confirmation

**What to build:** A player can start a new round with a Reset button. Reset asks for confirmation first, then returns all 36 pieces to the ordered Bank as triangles — exactly the initial state — so the table can be wiped without accidental loss.

**Blocked by:** 03 (Rotate and flip pieces)

**Status:** resolved

- [x] A Reset button is visible in the UI
- [x] Pressing Reset asks for confirmation before anything changes
- [x] Confirming returns all 36 pieces to the ordered Bank as triangles, identical to the initial state
- [x] Cancelling leaves the board completely untouched
- [x] Tests cover reset producing a document equal to the initial one

## Comments

Implemented on the integration branch. A "Zurücksetzen" button asks for
confirmation (`window.confirm`) before anything changes; cancelling leaves the
board untouched. Confirming builds a reset message, applies it through the
shared reducer and repaints, so all 36 pieces return to the ordered Bank as
upright triangles and the document matches the initial one. `core/state.js`
stamps every piece at the reset version so a stale pre-reset move can no longer
win, and ignores a stale reset. Tests cover reset equality, identity and stale
resets.
