# 12: Presence

**What to build:** A player can see where the opponent is and what they are doing: the opponent's cursor on the board, the piece the opponent is currently dragging (highlighted), and the connection status (connected / waiting / disconnected) — all labelled with the opponent's name. Presence rides the existing transport, so it works as soon as any transport is connected.

**Blocked by:** 07 (Same-browser sync)

**Status:** resolved

- [x] The opponent's cursor is visible on the board
- [x] The piece the opponent is currently dragging is highlighted
- [x] Connection status (connected / waiting / disconnected) is shown
- [x] The opponent's cursor and status carry their name

## Comments

Implemented on the integration branch. `presence/messages.js` is the pure seam
(`buildCursorMessage`, `buildDragMessage`, `readPresence` with validation). The
renderer gained a presence layer and `setPresence({ cursor, draggingId, name })`
that draws the opponent's cursor in world coordinates (so it pans/zooms with the
board, labelled with their name) and highlights the piece they are dragging;
cursor presence is throttled (~25/s). `app.js` forwards renderer `cursor`/`drag`
operations over the same hub and applies incoming presence without ever touching
the document reducer. Status shows connected/waiting/disconnected and appends
the opponent's name; a `hello`/`hello-ack` exchange lets same-browser tabs learn
each other's name too. Tests cover the presence message round-trip and rejection.
