# 17: Compact Bank and a separate Bank panel

**What to build:** Stop the Bank from eating play-field space. Stack the three
identical copies of a piece so a Bank cell is one small group instead of three
side-by-side pieces, and move the Bank out of the world into its own fixed
panel on the right (5/7 board, 2/7 Bank) so it never covers the game board.

- Compact the Bank to **4 colour rows × 3 size columns** at ~150×140 world units
  per cell, with the three copies fanned out by a small `[dx, dy]` offset so the
  stack still reads as three pieces (they overlap a lot).
- Give the Bank its own SVG panel on the right; the layout is 5/7 board and
  2/7 Bank. The Bank panel is **fixed**: it does not pan or zoom with the board.
- Clamp the board camera (and the visible table edge) to the play field, which
  excludes the Bank strip and a gap, so the Bank never appears on the board.
- Dragging still crosses the seam: pull a piece out of the Bank onto the board,
  and drop a piece onto the Bank panel to send it home.
- Re-home Bank pieces saved against the old Bank geometry (both the narrow
  2400-wide world and the current 3600-wide world).

**Blocked by:** 01 (Initial board renders), 05 (Camera pan and zoom), 16 (Wider world, bounded camera and a visible table edge)

**Status:** resolved

- [x] `BANK` is a compact 4×3 grid with overlapping copies; `bankLayout` takes a Bank spec
- [x] `bankStrip` / `playfieldWidth` expose the Bank region and table width
- [x] `migrateBoard` re-homes pieces from every known legacy Bank layout (idempotent)
- [x] `render/svg.js` renders the board and the Bank into two SVGs sharing one document
- [x] The Bank viewBox is fixed; the board camera is clamped to the play field
- [x] Screen-space drag crosses the board ↔ Bank seam; dropping on the Bank sends home
- [x] `play.html` / `play.css` lay out a 5/7 board + 2/7 Bank panel, responsive on narrow screens
- [x] Tests updated; `npm test` green (118 passing)

## Comments

The document model is unchanged: Bank pieces keep their world coordinates and
their slot is still a pure function of the piece id. Each SVG is a different
window onto the same world (the board pans/zooms, the Bank is pinned to the Bank
strip), so sync, merge and JSON export/import need no new fields.

`core/state.js`: `BANK` is now 150×140 cells with `copyOffsets` `[-18,12] / [0,0]
/ [18,-12]`; `bankLayout(worldWidth, bank)`, `bankStrip`, `playfieldWidth` and
`BANK_GAP` were added. `migrateWorldWidth` became `migrateBoard`, which re-homes
pieces from both the old narrow world and the old Bank geometry in the current
world. The initial camera now centres on the play field.

`render/svg.js`: `createRenderer` takes `{ bankSvg }` and paints both windows
from the one document. The board camera (and the table-edge rect) is clamped to
the play field, a clip keeps Bank pieces off the board when zoomed out, and
drags are tracked in screen space so a piece can cross the seam; releasing over
the Bank panel sends it home.

`play.html` / `play.css`: a `.table-layout` holds a 5/7 `.board-frame` and a
2/7 `.bank-frame` (stacked on narrow screens). `app.js` wires the second SVG and
clamps a restored camera to the current play field on load.

### Follow-up: drag bugs (reported after first cut)

Two symptoms — "the second piece of a group cannot be moved" and "pieces jump to
the top-left of the board" — shared one cause. A press-and-drag on a piece let
the browser start a **native HTML5 drag** (and a text selection); that fired
`pointercancel`, whose coordinates are `(0,0)`. `endPointer` treated the cancel
exactly like a release, so the drop was computed at world `(0,0)` → clamped to
the top-left corner; and a swallowed cancel could leave the drag state set, so
the next piece would not move.

Fixes:
- `dragstart` and `selectstart` are now `preventDefault()`ed on both SVGs, and
  `.board` / `.bank` / `.piece` disable user selection and WebKit element drag.
- `endPointer` distinguishes `pointercancel` from `pointerup`: a cancel ends the
  gesture at the last emitted position and never drops at `(0,0)`.

Verified with pure `page.mouse` sequences: four consecutive same-group drags, a
double-click send-home and a right-click flip all behave.

