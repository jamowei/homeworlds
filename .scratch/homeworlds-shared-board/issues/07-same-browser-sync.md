# 07: Same-browser sync

**What to build:** Two tabs in the same browser share one board with zero setup. Every board change — moves, rotations, flips, resets and camera changes — appears in the other tab. This introduces the single transport interface, the BroadcastChannel adapter, and message-id deduplication, plus the app wiring that feeds all local operations into the transport and applies received messages through the same reducer.

**Blocked by:** 05 (Camera pan and zoom)

**Status:** ready-for-agent

- [ ] Two tabs in the same browser sync board changes automatically with no setup
- [ ] Moves, rotations, flips, resets and camera changes all appear in the other tab
- [ ] Duplicate messages are applied only once (deduped by message id)
- [ ] A change made in one tab does not corrupt the board in the other
- [ ] An integration check exercises the BroadcastChannel path end-to-end in one browser
