# 05: Camera pan and zoom

**What to build:** A player can explore a board larger than the screen. Zoom out and in with the mouse wheel and by pinch on touch; pan by dragging the empty background; the point under the cursor stays put while zooming. Zoom is bounded to 25%–100%. Board shapes keep a constant size — the camera moves the view, not the pieces.

**Blocked by:** 01 (Initial board renders)

**Status:** resolved

- [x] The board zooms with the mouse wheel and by pinch on touch
- [x] Zoom is limited to 25%–100%
- [x] The point under the cursor stays put while zooming
- [x] Dragging the empty background pans the camera
- [x] Pieces keep a constant on-screen size; zooming changes only the view
- [x] Tests cover camera bounds/limits

## Comments

Implemented on the integration branch. The camera is `{x, y, zoom}` where (x, y)
is the world point at the viewport centre; the renderer realises it through the
SVG `viewBox`, so zoom scales the whole board while the camera never mutates
piece state. Wheel zoom and two-finger pinch are wired, all anchored under the
pointer/midpoint via `zoomAround`, and panning drags the empty background. Zoom
is clamped to 25%–100% in `core/state.js` (`clampZoom`)
and again on message application; camera updates are a last-write-wins channel
tied by peer id. Tests cover bounds and camera LWW/stale/tiebreak.
