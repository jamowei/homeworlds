# 14: Piece ownership, orientation and "send home"

**What to build:** A piece's pointing direction shows who last moved it, and a
double-click (double-tap) sends a piece home to its Bank slot. The manual rotate
gesture is removed. A ship points away from its owner, so each player sees their
own ships pointing up and the opponent's pointing down; untouched/Bank ships
point up for both. Right-click (long-press) flips ship↔star; a star has no owner
(shared by both). Double-click (double-tap) returns a piece to its deterministic
Bank slot as an upright, neutral ship, with no confirmation.

**Blocked by:** 03 (Rotate and flip pieces), 04 (Reset with confirmation)

**Status:** resolved

- [x] A move sets the piece's owner to the mover's role; the ship points up for the owner and down for the other player
- [x] A neutral piece (Bank / untouched / sent home) points up for both players
- [x] Right-click flips ship↔star (touch long-press); a flip to a star clears the owner, a flip back to a ship claims it for the flipper
- [x] Double-click (touch double-tap) sends a piece home to its slot as an upright, neutral ship; no confirmation
- [x] The manual rotate gesture and the stored `rotation` field are gone
- [x] Roles (`host`/`guest`) are remembered locally so both peers agree who owns what, and survive reload
- [x] Tests cover ownership on move/flip/send-home, `pieceFacing`, reset neutralising owners, and validation of a bad owner

## Comments

Implemented on `main`. `core/state.js` drops `rotation` and adds `owner`
(`null | 'host' | 'guest'`) plus `homePosition`, `pieceFacing`,
`buildSendHomeMessage`; `buildFlipMessage` now takes the flipper's role.
`render/svg.js` derives each ship's direction from `pieceFacing(piece,
localRole)` and remaps the gestures (right-click → flip, double-click →
send-home, touch long-press → flip, double-tap → send-home).
`app.js` remembers the local role per tab (sessionStorage, falling back to
localStorage) and stamps it as the owner on move/flip. Reset restores neutral
upright ships. The German "Steuerung" dialog was updated. Supersedes the
behaviour described in issue 03 (rotate / double-click-flip).
