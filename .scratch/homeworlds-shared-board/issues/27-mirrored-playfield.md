# 27: Mirror the play field so each player sees their own pieces at the bottom

**What to build:** The play field is drawn mirrored top-to-bottom for one role,
so "my bottom" is the opponent's top. A piece the host drops low appears high
for the guest, and vice versa. The mapping is a pure reflection (left stays
left, right stays right), the Bank panel is not mirrored, and the opponent's
cursor and the shared camera are carried along.

**Blocked by:** 01 (Initial board), 14 (Ownership/orientation), 17 (Bounded camera)

**Status:** resolved

- [x] A vertical reflection (`y' = WORLD.height − y`) is applied for the `guest`; the `host` is unchanged
- [x] Piece positions are mirrored on the board; the Bank panel is untouched
- [x] Pointer input (drag/move/drop) maps back to world coordinates through the same mirror
- [x] The opponent's cursor and the shared camera/view are mirrored too
- [x] The stored document and all sync/camera messages stay in world coordinates

## Comments

The direction of a ship was already derived per viewer (`pieceFacing`: own ships
point up, the opponent's down), which only makes geometric sense if the opponent
is *above* — the mirrored layout is what was missing.

`render/svg.js` gains a pure, exported `mirrorY(y, localRole)`. Inside the
renderer, `toViewY`/`toWorldY` use it: the board draws pieces, the boundary and
the opponent cursor at view coordinates; the Bank layer is drawn raw. The board
camera is converted at the boundary (`viewCamera`/`fromViewCamera`), so pan,
pinch and wheel all emit a world `camera` message while the local view is
mirrored. `toWorld`/`pieceScreen` apply the same map, so a drag lands under the
pointer. The Bank panel, world-bounds clamping (symmetric about the middle) and
all messages/persistence are unchanged.

`render/svg.test.js` covers the reflection directly (host identity, guest flip,
involution, fixed centre). Verified in a browser: a host piece at world
`y=1400` renders at `y=1400` for the host and `y=100` for the guest; the same
Bank piece stays put in both; the camera centre flips `600 → 900`; and a real
mouse drag in the guest tab dropped the piece at world `y≈279.9`, which rendered
back at view `y≈1220` under the cursor. `node --test` stays green (132 tests).
