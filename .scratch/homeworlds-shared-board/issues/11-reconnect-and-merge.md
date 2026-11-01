# 11: Reconnect and merge

**What to build:** After a disconnect, the two players exchange a fresh invite/reply pair to resume the same game. On reconnecting, both boards merge per-piece by newest version (tie-broken by peer id), so any offline divergence resolves automatically without a decision from either player. Reloading and reconnecting returns to the same game.

**Blocked by:** 10 (WebRTC peer sync)

**Status:** resolved

- [x] After a disconnect, a fresh invite/reply exchange reconnects the same game
- [x] On reconnect, the two boards merge per-piece by newest version, tie-broken by peer id
- [x] Offline divergence resolves automatically with no user decision
- [x] The gameId is preserved across reload and reconnect
- [x] Tests cover merge (newest wins, tiebreak, equal-version divergence)

## Comments

Implemented on the integration branch. On a transport reporting `connected`,
each peer sends its whole document once (`sync`); the receiver merges it with
`mergeDocuments` (per-piece newest-version, peer-id tiebreak) and never replies,
so there is no sync loop. A `Verbindung erneuern` control rebuilds the WebRTC
transport with a fresh invite/reply exchange while keeping the same `gameId`,
tearing the old transport down cleanly; reload returns to the same game via the
remembered id. Tests cover newest-wins, per-piece independence, tiebreak both
ways, deterministic equal-version divergence and tolerating a partial remote.
