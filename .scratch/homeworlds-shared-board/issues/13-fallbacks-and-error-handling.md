# 13: Fallbacks and error handling

**What to build:** The board works even when peer sync is impossible. A player can export the board as a JSON blob and import an opponent's, hand-copying it through any chat. Browsers without WebRTC get a clear explanatory message, and opening the page from a `file://` path warns clearly that peer sync needs HTTPS (same-browser tab sync still works). Invalid or corrupt sync messages are rejected safely and never break the local board.

**Blocked by:** 09 (Identity gate and handshake UI)

**Status:** ready-for-agent

- [ ] The board can be exported as a JSON blob and a JSON blob can be imported
- [ ] A browser without WebRTC shows a clear message explaining why
- [ ] Opening the page from a `file://` path shows a clear warning that peer sync needs HTTPS, while same-browser tab sync still works
- [ ] Invalid or corrupt sync messages are rejected safely and never break the local board
- [ ] Tests cover importing malformed JSON
