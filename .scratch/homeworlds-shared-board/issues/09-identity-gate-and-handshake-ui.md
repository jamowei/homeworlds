# 09: Identity gate and handshake UI

**What to build:** A player must enter a name (default suggestion "Gast") before creating or joining a game, so games are never anonymous. Creating a game with one click produces an invite link to send through any chat app; opening an invite shows the board immediately and produces a reply link; the host opens the reply to complete the connection. A text box always lets the player copy/paste the blob when a link is too long for the chat app, and the player's board state is preserved throughout the handshake. Connection status is visible.

**Blocked by:** 07 (Same-browser sync), 08 (Signalling codec)

**Status:** resolved

- [x] A name is mandatory before creating or joining, with "Gast" offered as a default suggestion
- [x] Creating a game with one click produces an invite link
- [x] Opening an invite link shows the board immediately and produces a reply link
- [x] Opening the reply link on the host side completes the connection
- [x] A text box always allows copying/pasting the blob when a link is too long
- [x] The board is visible and preserved while the handshake is in progress
- [x] Connection status is visible

## Comments

Implemented on the integration branch. A modal gate asks for a name (prefilled
"Gast", persisted, so games are never anonymous) before "Neues Spiel erstellen"
or "Beitreten"; "Ohne Gegner weiterarbeiten" dismisses it for solo/local play.
`transport/webrtc.js` implements the serverless two-way handshake: the host
creates an offer link, the guest opens it (the URL fragment is decoded with the
codec, the board shows immediately) and produces a reply link, and the host
pastes/opens the reply to complete the connection. Every link is also offered as
a paste-box code for chat apps with URL limits. The board stays rendered and
preserved throughout, and the connection status (waiting / connected / …) is
shown in the toolbar. STUN-only ICE servers are declared here; ticket 10 hardens
and verifies the peer path.
