# 16: Wider world, bounded camera and a visible table edge

**What to build:** Give the play field more horizontal room, stop players losing
it off-screen, and draw the table edge.

- Widen the world from 2400×1500 to **3600×1500** so large formations fit.
- Clamp the camera so the visible region stays inside the world; when the
  viewport is larger than the world on an axis (zoomed out), centre that axis.
  Applied to every camera the renderer emits *and* to cameras arriving from the
  peer, so each player's own view is always inside the field.
- Draw the **world boundary as a fixed rectangle in world coordinates** instead
  of framing the screen, so the table edge is visible; the dashed stroke uses
  `vector-effect: non-scaling-stroke` to stay readable at any zoom.
- Re-home Bank pieces on boards saved before the world was widened, so they line
  up with the current Bank instead of floating off their slots.

**Blocked by:** 01 (Initial board renders), 05 (Camera pan and zoom)

**Status:** resolved

- [x] World is 3600 × 1500; the Bank stays on the right edge
- [x] The camera cannot pan the field off-screen; zoomed-out axes stay centred
- [x] A peer's camera is clamped to the local viewport too
- [x] The table edge is drawn at the real world rectangle and pans/zooms with it
- [x] Boards saved against the old 2400-wide world re-home their Bank pieces (idempotent)
- [x] Tests cover `clampCamera` and `migrateWorldWidth`

## Comments

`core/state.js` gains `LEGACY_WORLD_WIDTH`, a width-aware `bankLayout` /
`homePosition`, and `migrateWorldWidth` (idempotent: it only moves pieces sitting
exactly on an old Bank slot). `render/svg.js` adds the pure `clampCamera(camera,
view, world)` — used for every emitted camera and exposed so `app.js` can clamp
an incoming peer camera — and pins the boundary rect to the world. `play.css`
restyles that rect as the table edge. Spec updated (layout, camera story,
interaction details, tests).
