# 13: Fallbacks and error handling

**What to build:** The board works even when peer sync is impossible. A player can export the board as a JSON blob and import an opponent's, hand-copying it through any chat. Browsers without WebRTC get a clear explanatory message, and opening the page from a `file://` path warns clearly that peer sync needs HTTPS (same-browser tab sync still works). Invalid or corrupt sync messages are rejected safely and never break the local board.

**Blocked by:** 09 (Identity gate and handshake UI)

**Status:** resolved

- [x] The board can be exported as a JSON blob and a JSON blob can be imported
- [x] A browser without WebRTC shows a clear message explaining why
- [x] Opening the page from a `file://` path shows a clear warning that peer sync needs HTTPS, while same-browser tab sync still works
- [x] Invalid or corrupt sync messages are rejected safely and never break the local board
- [x] Tests cover importing malformed JSON

## Comments

Implemented on the integration branch. `core/io.js` adds `exportDocument` and a
validating `importDocument` (rejects unparseable/structurally corrupt JSON and
sanitises each piece: known id, immutable colour/size, valid kind/rotation,
finite clamped coordinates). The UI exposes an export panel (copy/download JSON)
and an import textarea that loads a pasted board with no WebRTC. A `file://` page
shows an HTTPS warning while BroadcastChannel tab sync still works, and a browser
without WebRTC shows an explanatory notice. Tests cover malformed/partial JSON,
bad fields, a valid round-trip and corrupt sync messages never breaking the board.
