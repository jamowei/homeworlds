# 21: Connection reliability and handshake feedback

**What to build:** Peer connections that failed left the status stuck on "Warte
auf Gegner" with no explanation, and same-browser tab sync was asymmetric.
Broaden ICE gathering and surface failures.

**Blocked by:** 10 (WebRTC peer sync), 11 (Reconnect and merge)

**Status:** resolved

- [x] Several independent STUN servers are offered (still STUN-only, no TURN)
- [x] A failed connection reports "Verbindung fehlgeschlagen" instead of waiting forever
- [x] Same-browser tabs exchange boards symmetrically
- [x] Handshake errors are visible even when the gate is hidden

## Comments

`transport/webrtc.js` adds Cloudflare and Twilio STUN servers alongside Google's
and emits a distinct `failed` status on a terminal `connectionstatechange`; the
toolbar maps it to "Verbindung fehlgeschlagen" and the handshake panel shows a
retry hint. The same-browser asymmetry was that `onConnected` sends its one-time
`sync` when BroadcastChannel reports `available` — before any peer exists — so a
second tab never received the first tab's board; a peer now also answers a
`hello` with a sync, so both boards always cross (receiving a sync still never
triggers one, so the exchange cannot loop). Create/join errors now call
`showGate(true)` so they are readable.

The NAT caveat is unchanged: without TURN, symmetric NATs still fail, and the
JSON export/import fallback remains the escape hatch.
