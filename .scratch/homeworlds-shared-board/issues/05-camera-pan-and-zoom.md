# 05: Camera pan and zoom

**What to build:** A player can explore a board larger than the screen. Zoom out and in with the mouse wheel, with +/− buttons, and by pinch on touch; pan by dragging the empty background; the point under the cursor stays put while zooming. Zoom is bounded to roughly 25%–400%. Board shapes keep a constant size — the camera moves the view, not the pieces.

**Blocked by:** 01 (Initial board renders)

**Status:** ready-for-agent

- [ ] The board zooms with the mouse wheel, with +/− buttons, and by pinch on touch
- [ ] Zoom is limited to roughly 25%–400%
- [ ] The point under the cursor stays put while zooming
- [ ] Dragging the empty background pans the camera
- [ ] Pieces keep a constant on-screen size; zooming changes only the view
- [ ] Tests cover camera bounds/limits
