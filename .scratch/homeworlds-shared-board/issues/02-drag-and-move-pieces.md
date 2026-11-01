# 02: Drag and move pieces

**What to build:** A player can drag any piece with the mouse or with a finger and drop it anywhere on the table. The piece follows the pointer, comes to the front while dragged, may overlap other pieces freely, and can never leave the world bounds. This introduces the move operation with a per-piece version, last-write-wins resolution, and message validation.

**Blocked by:** 01 (Initial board renders)

**Status:** ready-for-agent

- [ ] A piece can be dragged with the mouse and with a finger and dropped anywhere inside the world
- [ ] The piece being dragged is drawn above the others, and pieces may overlap freely
- [ ] No piece can be dragged outside the world bounds (its position is clamped)
- [ ] A move carries a per-piece version; a newer version wins and an older one is ignored
- [ ] Invalid moves (unknown id, non-finite coordinates) are ignored rather than corrupting the board
- [ ] Tests cover move, clamping, last-write-wins and validation
