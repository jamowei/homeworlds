# 09: Identity gate and handshake UI

**What to build:** A player must enter a name (default suggestion "Gast") before creating or joining a game, so games are never anonymous. Creating a game with one click produces an invite link to send through any chat app; opening an invite shows the board immediately and produces a reply link; the host opens the reply to complete the connection. A text box always lets the player copy/paste the blob when a link is too long for the chat app, and the player's board state is preserved throughout the handshake. Connection status is visible.

**Blocked by:** 07 (Same-browser sync), 08 (Signalling codec)

**Status:** ready-for-agent

- [ ] A name is mandatory before creating or joining, with "Gast" offered as a default suggestion
- [ ] Creating a game with one click produces an invite link
- [ ] Opening an invite link shows the board immediately and produces a reply link
- [ ] Opening the reply link on the host side completes the connection
- [ ] A text box always allows copying/pasting the blob when a link is too long
- [ ] The board is visible and preserved while the handshake is in progress
- [ ] Connection status is visible
