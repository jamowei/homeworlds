# 10: WebRTC peer sync

**What to build:** Two players on different devices connect directly, peer-to-peer, over WebRTC DataChannels with STUN only — no application server relays or stores anything. Their board changes stream to each other in real time, and a third joiner is rejected so a game stays exactly two players.

**Blocked by:** 09 (Identity gate and handshake UI)

**Status:** resolved

- [x] Two different devices connect directly, peer-to-peer, with no application server
- [x] Board changes stream in real time in both directions
- [x] Only two players are allowed; a third joiner is rejected
- [x] The connection uses STUN only (no TURN relay)

## Comments

Implemented on the integration branch. `transport/webrtc.js` opens a real
RTCPeerConnection with `stun:`-only ICE servers (no TURN, no application
server); the data channel carries the same JSON messages as BroadcastChannel,
buffered until the channel opens, and parsed defensively. Because the hub treats
the WebRTC adapter exactly like the BroadcastChannel adapter, board changes
stream in both directions with one reducer path. `transport/peers.js` enforces
exactly two players: a third `hello` is answered with `reject` and its messages
are ignored; the host also refuses a second answer. Tests cover the two-player
registry and the STUN-only/no-WebRTC paths.
