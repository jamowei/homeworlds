# 11: Reconnect and merge

**What to build:** After a disconnect, the two players exchange a fresh invite/reply pair to resume the same game. On reconnecting, both boards merge per-piece by newest version (tie-broken by peer id), so any offline divergence resolves automatically without a decision from either player. Reloading and reconnecting returns to the same game.

**Blocked by:** 10 (WebRTC peer sync)

**Status:** ready-for-agent

- [ ] After a disconnect, a fresh invite/reply exchange reconnects the same game
- [ ] On reconnect, the two boards merge per-piece by newest version, tie-broken by peer id
- [ ] Offline divergence resolves automatically with no user decision
- [ ] The gameId is preserved across reload and reconnect
- [ ] Tests cover merge (newest wins, tiebreak, equal-version divergence)
