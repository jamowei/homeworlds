# 03: Rotate and flip pieces

**What to build:** A player can orient and reshape pieces. Right-clicking a triangle toggles it between pointing up and pointing down; right-clicking a square does nothing. Double-clicking flips a triangle into a square (star) and back, anchored in place and preserving position, colour and size, with a triangle remembering the orientation it had before the flip. Both shapes show their 1/2/3 size pips in the bottom-left corner. On touch, double-tap rotates and long-press flips.

**Blocked by:** 01 (Initial board renders)

**Status:** ready-for-agent

- [ ] Right-clicking a triangle toggles it between pointing up and pointing down
- [ ] Right-clicking a square does nothing
- [ ] Double-clicking a triangle turns it into a square in place, keeping position, colour and size; double-clicking a square turns it back into a triangle
- [ ] A triangle flipped back to a triangle returns to the orientation it had before the flip
- [ ] Both triangles and squares show 1/2/3 pips in the bottom-left corner
- [ ] On touch, double-tap rotates a piece and long-press flips it
- [ ] Tests cover rotate, flip, orientation memory and preservation of position/colour/size
