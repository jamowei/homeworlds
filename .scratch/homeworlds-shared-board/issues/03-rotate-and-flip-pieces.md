# 03: Rotate and flip pieces

**What to build:** A player can orient and reshape pieces. Right-clicking a triangle toggles it between pointing up and pointing down; right-clicking a square does nothing. Double-clicking flips a triangle into a square (star) and back, anchored in place and preserving position, colour and size, with a triangle remembering the orientation it had before the flip. Both shapes show their 1/2/3 size pips centred on the piece. On touch, double-tap rotates and long-press flips.

**Blocked by:** 01 (Initial board renders)

**Status:** resolved

- [x] Right-clicking a triangle toggles it between pointing up and pointing down
- [x] Right-clicking a square does nothing
- [x] Double-clicking a triangle turns it into a square in place, keeping position, colour and size; double-clicking a square turns it back into a triangle
- [x] A triangle flipped back to a triangle returns to the orientation it had before the flip
- [x] Both triangles and squares show 1/2/3 pips centred on the piece
- [x] On touch, double-tap rotates a piece and long-press flips it
- [x] Tests cover rotate, flip, orientation memory and preservation of position/colour/size

## Comments

Implemented on the integration branch. The renderer maps right-click
(`contextmenu`) on a triangle to a rotate and ignores squares; double-click
flips ship↔star. On touch, a still tap followed by a second within ~320 ms
rotates, and a ~500 ms long-press flips; a press that moves past a small
threshold becomes a drag instead. `buildPieceMessage` keeps the `rotation`
field untouched on a flip, so a triangle remembers the angle across the
flip and restores it on the flip back. Size pips (1/2/3, centred on the piece) render on
both triangles and squares. Tests cover rotate, flip, preservation and
orientation memory.
