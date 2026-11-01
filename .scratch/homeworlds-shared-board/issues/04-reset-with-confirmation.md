# 04: Reset with confirmation

**What to build:** A player can start a new round with a Reset button. Reset asks for confirmation first, then returns all 36 pieces to the ordered Bank as triangles — exactly the initial state — so the table can be wiped without accidental loss.

**Blocked by:** 03 (Rotate and flip pieces)

**Status:** ready-for-agent

- [ ] A Reset button is visible in the UI
- [ ] Pressing Reset asks for confirmation before anything changes
- [ ] Confirming returns all 36 pieces to the ordered Bank as triangles, identical to the initial state
- [ ] Cancelling leaves the board completely untouched
- [ ] Tests cover reset producing a document equal to the initial one
