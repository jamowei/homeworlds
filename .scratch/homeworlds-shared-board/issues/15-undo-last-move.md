# 15: Undo the last move

**What to build:** A "revert" button that undoes the most recent board change, if
that is feasible without breaking sync. Requested by the maintainer alongside
issue 14 ("maybe there should be a revert button to undo the last move").

**Blocked by:** 14 (Piece ownership, orientation and "send home")

**Status:** needs-triage

- [ ] Decide the scope: undo only the local player's own last move, or the last move by either player?
- [ ] Decide whether undo is available after a peer has since moved, a Reset, or a reload
- [ ] Define how undo interacts with per-piece last-write-wins (an undo must win over the move it reverses)
- [ ] A visible control and/or keyboard shortcut
- [ ] Tests for the chosen semantics

## Comments

Placeholder ticket; the semantics are deliberately unspecified. The current
reducer resolves conflicts by per-piece last-write-wins, so a naive "revert"
needs care: reversing a move must be written as a *new* mutation (with a higher
version) rather than replaying the old state, or a peer could re-apply the very
move being undone. Scope to be agreed before implementation.
