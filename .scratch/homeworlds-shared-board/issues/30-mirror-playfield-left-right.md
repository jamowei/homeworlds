# 30: Mirror the play field left-to-right too, so the guest sits opposite

**What to build:** The play field is already mirrored top-to-bottom for the
guest, so each player sees their own pieces at the bottom. It must also be
mirrored left-to-right: seen from the guest, the table is the host's table
turned by 180° about the play-field centre, as if the two players sat opposite
each other. A stone the host places left of another appears right of it for the
guest, and the host's top edge is the guest's bottom edge.

**Blocked by:** 27 (mirrored play field)

**Status:** resolved

- [x] `mirrorX(x, localRole)` mirrors the guest about the play-field centre (`playfieldWidth()`); the host is unchanged
- [x] The guest's view is the composition of `mirrorX` and `mirrorY`, i.e. a 180° turn
- [x] Piece positions, the opponent cursor, the shared camera and pointer→world input all use the x mirror too
- [x] The Bank panel stays fixed on the right and is not mirrored
- [x] The stored document and all sync/camera messages stay in world coordinates

## Comments

The change extends the existing `mirrorY` seam rather than adding a second
transform path. `render/svg.js` gains a pure, exported `mirrorX(x, localRole)`
that reflects about `playfieldWidth() / 2` — the play-field centre, not
`WORLD.width / 2`, so the Bank strip never enters the mirrored board view. The
renderer builds `toViewX`/`toWorldX` next to the existing y pair and feeds them
through the same boundary conversions: pieces and the opponent cursor on the
board, `viewCamera`/`fromViewCamera`, `toWorld` and `pieceScreen`. The Bank
layer keeps drawing raw world coordinates, so it stays fixed and unmirrored.

The ship direction is unchanged: `pieceFacing` still makes each player's own
ships point up. Only positions are mirrored; the triangle glyph is symmetric
about its vertical axis, so no extra rotation is needed.

`render/svg.test.js` now covers both axes: host identity, guest left↔right and
top↔bottom flips, involution on both axes, fixed centre, and that the guest is a
180° turn (a piece left of another for the host is to its right for the guest).
`node --test` passes 145 tests.
