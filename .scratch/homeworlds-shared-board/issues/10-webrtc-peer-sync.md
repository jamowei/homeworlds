# 10: WebRTC peer sync

**What to build:** Two players on different devices connect directly, peer-to-peer, over WebRTC DataChannels with STUN only — no application server relays or stores anything. Their board changes stream to each other in real time, and a third joiner is rejected so a game stays exactly two players.

**Blocked by:** 09 (Identity gate and handshake UI)

**Status:** ready-for-agent

- [ ] Two different devices connect directly, peer-to-peer, with no application server
- [ ] Board changes stream in real time in both directions
- [ ] Only two players are allowed; a third joiner is rejected
- [ ] The connection uses STUN only (no TURN relay)
