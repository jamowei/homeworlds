# 22: Optional TURN relay for symmetric NATs

**What to build:** STUN-only peer connections cannot traverse a symmetric NAT.
Add an optional TURN relay so two players behind difficult networks can still
connect — without turning the app into a server-backed one: the relay is
configured by the operator and only used when a direct connection fails.

**Blocked by:** 10 (WebRTC peer sync), 21 (Connection reliability and handshake feedback)

**Status:** resolved

- [x] A TURN relay can be enabled from a small config without code changes
- [x] The credential password is fetched at runtime and never committed
- [x] Public STUN servers stay first, so a direct connection is tried before the relay
- [x] Any config/network/timeout failure falls back to STUN only
- [x] Tests cover URL building, merging/dedup and the fetch failure paths

## Comments

`transport/webrtc.js` gains `meteredCredentialsUrl`, `mergeIceServers` and
`fetchMeteredIceServers` (injectable `fetch`, 5 s timeout, never throws).
`app.js` fetches the Metered ICE array once at load and merges it behind
`DEFAULT_ICE_SERVERS`, awaiting the result just before the first peer
connection. `turn.config.js` holds the Metered domain and the
**credential-scoped** API key (safe in front-end code; it unlocks only that one
credential). The username/password are fetched at runtime, so rotating a
credential in the dashboard needs no redeploy. Leave the config empty to stay
STUN-only.

Verified end-to-end in a browser with a mocked Metered endpoint: the peer
connection receives the TURN servers (with credentials) *and* the public STUN
servers, with no duplicate URLs; with an empty config the full two-peer flow
still connects over STUN.
