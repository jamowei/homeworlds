# 02: Drag and move pieces

**What to build:** A player can drag any piece with the mouse or with a finger and drop it anywhere on the table. The piece follows the pointer, comes to the front while dragged, may overlap other pieces freely, and can never leave the world bounds. This introduces the move operation with a per-piece version, last-write-wins resolution, and message validation.

**Blocked by:** 01 (Initial board renders)

**Status:** resolved

- [x] A piece can be dragged with the mouse and with a finger and dropped anywhere inside the world
- [x] The piece being dragged is drawn above the others, and pieces may overlap freely
- [x] No piece can be dragged outside the world bounds (its position is clamped)
- [x] A move carries a per-piece version; a newer version wins and an older one is ignored
- [x] Invalid moves (unknown id, non-finite coordinates) are ignored rather than corrupting the board
- [x] Tests cover move, clamping, last-write-wins and validation

## Comments

Implemented on the integration branch. The renderer turns a pointer down on a
`.piece` into a drag: the piece follows the pointer, is re-rendered last so it
sits above the others, and emits `move` operations (a final one on release).
The app applies each move through `buildPieceMessage` + `applyMessage`, so the
same reducer path is used locally and later for the network. `core/state.js`
already clamps to the world bounds and rejects unknown ids, non-finite
coordinates and any colour/size change; per-piece last-write-wins drops stale
moves. Tests cover move, clamping, LWW, stale replay and validation.
