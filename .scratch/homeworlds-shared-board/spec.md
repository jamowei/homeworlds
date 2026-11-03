# Spec: Homeworlds Shared Board (serverless two-player tabletop)

**Status:** ready-for-agent
**Tracker:** local markdown, `.scratch/<feature-slug>/` (see `docs/agents/issue-tracker.md`)

---

## Problem Statement

Two people who want to play Homeworlds together — especially remotely — have no shared board. The existing site is a static rules reference (`index.html`, `guide.html`): it teaches the game but you cannot play on it. Setting up a physical board over a video call is clumsy, and any ready-made digital tabletop usually requires an account and a server, sends your data to a third party, and cannot be paused and resumed later without an account.

The players need a lightweight shared "digital table" where both can see and manipulate the same 36 Homeworlds pieces (banks, ships and stars) at the same time, over the network, **without any server** doing the synchronisation or storing anything, and where the local state survives a page reload so a game can be picked up later.

## Solution

A single static page, `play.html`, in this repository, served over HTTPS (GitHub Pages). It renders the 36 Homeworlds pyramids as an SVG board ("the Bank" on the right, play field to the left). Both players connect **directly, peer-to-peer, with no server** using WebRTC DataChannels whose handshake is exchanged by copy-pasting two shareable URLs. Every board change (drag, flip, send a piece home, Reset, camera pan/zoom) is applied locally and streamed to the other player in real time. A piece's **pointing direction shows who last moved it**: a ship always points away from its owner, towards the other player, so each player sees their own ships pointing up and the opponent's pointing down. Each player's browser persists the full board plus camera in `localStorage`, so reloading restores the table immediately — even with no opponent connected — and reconnecting merges the two boards. The app is a **free-form digital tabletop**: it does not enforce Homeworlds rules; the humans do.

Everything is German UI, matching the tone, colours and dark/light theme of the existing site. No accounts, no login, no server, no tracking.

## User Stories

**Getting into a game**
1. As a player, I want to open the board page and see the full initial table immediately, so that I understand what I am about to play on.
2. As a player, I want to be asked for my name before I can create or join a game, so that my opponent knows who they are playing with.
3. As a player, I want my name to be mandatory, so that games are never anonymous.
4. As a player, I want to create a game with one click, so that I can start without configuring anything.
5. As a player, I want the game to give me an invite link, so that I can send it to my opponent through any messaging app.
6. As a player, I want to open an invite link and have the board appear immediately, so that joining is effortless.
7. As a player, I want the app to produce a reply link after I open an invite, so that the connection completes when I send it back.
8. As a player, I want my state preserved while the handshake is happening, so that I can keep looking at the board meanwhile.
9. As a player, I want to copy the invite/reply blob from a text box as well as from the URL, so that it still works when the link is too long for a chat app.
10. As a player on a browser that cannot do WebRTC, I want a clear message explaining why, so that I am not left guessing.
11. As a player opening the page from a `file://` path, I want a clear warning that peer sync needs HTTPS, so that I know to serve it properly.
12. As a player, I want a second tab in the same browser to sync with zero setup, so that I can test the table locally.

**The board and the Bank**
13. As a player, I want to see all 36 pieces as triangles at the start, so that the table looks like a Homeworlds supply.
14. As a player, I want the pieces grouped in the Bank on the right edge of the world, so that the shared supply is in the familiar place.
15. As a player, I want the Bank ordered with colours in rows and sizes in columns (4 colour rows × 3 size columns, 3 copies per cell), so that I can find any piece by colour and size at a glance.
16. As a player, I want the three copies of a piece laid out together within their cell, so that I can grab one without hunting.
17. As a player, I want dragging a piece out of the Bank to leave an empty slot, so that the layout stays stable and I can see what has been taken.
18. As a player, I want the Bank to never reflow on its own, so that both players always see the same arrangement.
19. As a player, I want the play field to the left of the Bank to be unbounded in layout but bounded in extent, so that pieces have room but cannot be lost.
20. As a player, I want a visible world boundary, so that I can see where the table ends.

**Pieces: size, colour, shape**
21. As a player, I want small/medium/large shown both as 1/2/3 pips on the piece and as an increasingly larger shape, so that size is readable at a glance.
22. As a player, I want the pips centred on every piece, so that they are easy to see.
23. As a player, I want four colours (yellow, green, red, blue), so that the four technologies are distinguishable.
24. As a player, I want size and colour to be immutable, so that no action can accidentally change a piece's identity.

**Moving pieces**
25. As a player, I want to drag a piece with the mouse and drop it anywhere on the table, so that I can arrange formations.
26. As a player, I want to drag a piece with my finger on a touchscreen, so that I can play on a tablet.
27. As a player, I want pieces to be allowed to overlap, so that I can place ships next to and over stars as in the real game.
28. As a player, I want the piece I am dragging to come to the front, so that I can see what I am moving.
29. As a player, I want a piece to be clamped inside the world bounds, so that no piece can ever leave the table or be removed.

**Orientation, flipping and sending pieces home**
30. As a player, I want a ship I move to point towards my opponent, so that it is clear the piece is mine.
31. As a player, I want my opponent's ships to point towards me, so that I can tell which pieces they moved.
32. As a player, I want a piece's direction drawn relative to my own view (my ships point up), so that the table reads like the real one, where each player sits at their own edge.
33. As a player, I want untouched pieces in the Bank to point up for both players, so that unclaimed pieces look neutral.
34. As a player, I want right-clicking a piece to toggle it between triangle (ship) and square (star), so that I can build stars — on a touchscreen, long-press.
35. As a player, I want a flip to keep the piece's position, colour and size, so that only its shape changes; a flipped-to-star has no owner (shared by both), and a star flipped back becomes a ship of the player who flipped it.
36. As a player, I want a square to show its size pips too, so that star sizes are readable.
37. As a player, I want double-clicking a piece to send it home to its Bank slot as an upright ship, so that I can tidy the table — on a touchscreen, double-tap.
38. As a player, I want a piece sent home to become neutral (belonging to nobody), so that it points up for both players until one of us moves it again.

**Reset**
39. As a player, I want a Reset button, so that I can start a new round.
40. As a player, I want Reset to ask for confirmation first, so that I do not wipe the table by accident.
41. As a player, I want Reset to return all 36 pieces to the ordered Bank as neutral upright triangles, so that the table is exactly the initial state, owned by nobody.
42. As a player, I want Reset to apply on my opponent's side too, so that we stay in sync.

**Camera**
43. As a player, I want to zoom out when formations no longer fit, so that I can see the whole table without the shapes shrinking or growing.
44. As a player, I want to zoom with the mouse wheel, so that zooming is natural.
45. As a player, I want to zoom with +/− buttons, so that I have precise control.
46. As a player, I want to pinch-zoom on a touchscreen, so that I can zoom without a mouse.
47. As a player, I want to pan the camera by dragging the empty background, so that I can move around a zoomed-in board.
48. As a player, I want the camera anchored under my cursor when zooming, so that the point I am looking at stays put.
49. As a player, I want my camera pan and zoom synchronised with my opponent, so that we always look at the same part of the table.

**Live collaboration**
50. As a player, I want to see my opponent's cursor, so that I know where they are looking.
51. As a player, I want to see which piece my opponent is dragging, highlighted, so that I can follow their move.
52. As a player, I want to see the connection status (connected / waiting / disconnected), so that I know whether we are in sync.
53. As a player, I want my opponent's cursor and status to carry their name, so that I know who is who.

**Persistence and resuming**
54. As a player, I want every change saved automatically in my browser, so that I never have to press Save.
55. As a player, I want to reload the page and find my board exactly as I left it, so that a refresh is harmless.
56. As a player, I want my board to be available even with no opponent connected, so that I can set up while waiting.
57. As a player, I want to reconnect with my opponent after a disconnect by exchanging a fresh pair of links, so that we can resume the same game.
58. As a player, I want reconnect to merge our two boards automatically piece by piece, so that offline divergence resolves without a decision from me.
59. As a player, I want the game to remember which game I was in, so that reopening the page returns me to it.

**Fallbacks**
60. As a player, I want to export the board as a JSON blob, so that I can hand it to my opponent through a chat when WebRTC is impossible.
61. As a player, I want to import a board JSON, so that I can load my opponent's table.
62. As a player, I want invalid or corrupt sync messages to be rejected safely, so that one bad byte cannot break my board.

**Help**
63. As a new player, I want an in-app "Steuerung" dialog explaining every action, so that I can start playing without being told.

**Non-goals that shape UX**
64. As a player, I want it to be obvious that this app does not enforce rules, so that I know the humans are responsible for legality.

## Implementation Decisions

### Architecture and modules
- **No build step, no runtime dependencies.** Vanilla ES modules, plain HTML/CSS, loaded directly by the browser.
- **`core/state`** — the single pure, dependency-free module and the highest seam. Exposes:
  - `createDocument()` → a deterministic initial document (36 pieces + camera).
  - `applyMessage(document, message)` → new document, or the same document if the message is stale/invalid.
  - `mergeDocuments(local, remote)` → per-piece merge.
  - `resetDocument(document)` → initial document with the same gameId/identity metadata.
  - `buildPieceMessage` / `buildFlipMessage` / `buildSendHomeMessage` → the local mutations (move, ship↔star, send home).
  - `pieceFacing(piece, localRole)` → the only source of a piece's pointing direction (0 or 180), derived from the owner and the viewer's role.
  No DOM, no timers, no network, no storage in this module.
- **`transport/*`** — thin adapters implementing one interface (`send(message)`, `onmessage`, `onstatus`): a WebRTC adapter, a BroadcastChannel adapter, and a signalling codec. Both live transports feed the *same* reducer input and are deduped by message id.
- **`signalling`** — pure encode/decode of the connection blob to/from a URL fragment and a paste-box string (compress + base64).
- **`storage`** — thin `localStorage` adapter (load/save document under `hw-board:<gameId>`, remember last gameId, and the local role per game).
- **`render/svg`** — SVG renderer + pointer/keyboard input handling; maps user gestures to operations and calls the reducer, then repaints. Kept deliberately dumb.
- **`app`** — wiring: identity gate, transport setup, subscribe to reducer, autosave subscribe.

### Document model
- Piece: `{ id, color, size, kind: 'ship'|'star', x, y, owner }` where kind `ship` = triangle, `star` = square, and `owner ∈ {null, 'host', 'guest'}`.
- **No rotation is stored.** `owner` records which player last moved the piece (null = neutral, e.g. still in the Bank). The direction it is drawn in is a pure function of the owner and the *viewer's* role, so the same piece points up for one player and down for the other.
- `id` is deterministic and encodes colour/size/copy index (e.g. `red-large-2`), so both peers construct an identical base document without transmitting it. The Bank "home" slot for a piece is a pure function of its id.
- `color ∈ {yellow, green, red, blue}`, `size ∈ {1,2,3}`.
- Camera: `{ x, y, zoom }`, `zoom ∈ [0.25, 1]`.
- Document also carries `gameId` and metadata; the camera is a separate LWW channel from pieces.
- **Roles.** Each player is `host` (created the game, or playing alone) or `guest` (joined via an invite). The role is not part of the synced document: it is remembered locally (per tab, falling back to `localStorage`) and only the derived direction leaves the client. Both peers must hold opposite roles; create sets `host`, join sets `guest`.

### Layout (deterministic)
- One logical world with a fixed size larger than a typical viewport and a visible boundary.
- Bank occupies a strip at the **far-right edge of the world** (world coordinates, so it pans/zooms with everything).
- Bank grid: **4 colour rows × 3 size columns**, 3 identical copies laid out within each cell. Static slots — a vacated slot is not reflowed. The cell is sized for the largest piece.
- Piece size is drawn, not just counted: small/medium/large pieces increase in side length (see `PIECE_SIZES` in `render/svg.js`), so relative size reads at a glance.
- All 36 pieces start as `kind: 'ship'`, ordered in the Bank.

### Operations & conflict resolution
- Operations: move (drag), flip (right-click / long-press), send home (double-click / double-tap), reset, camera set, presence/cursor. There is no rotate operation.
- **Ownership follows the last mover.** A move sets `owner` to the mover's role; a flip to a ship sets it to the flipper, a flip to a star sets it to null (a star is shared); send-home and Reset set it to null.
- Every piece mutation carries a **per-piece logical version**; the receiver applies only if newer (**last-write-wins per piece**), with peer-id as tiebreak. No locking; simultaneous drags resolve by LWW and the loser's piece snaps on the next message.
- **Drag cadence:** throttled position updates (~20–30/s) while dragging, plus a final authoritative update on release. Flip/send-home/reset send immediately.
- **Camera** syncs as its own throttled LWW channel; messages are tagged with sender id to avoid echo loops.
- **Reset** is a synced operation and requires **explicit confirmation** before it is applied/broadcast. It restores the exact initial document (all upright ships, ordered, neutral).
- **Clamping:** piece positions are clamped to world bounds on both local input and on message application; out-of-range messages are rejected/clamped.
- **Validation:** incoming messages are validated (known id, valid colour/size/kind/owner, finite coordinates) before application; invalid messages are ignored.

### Transport & signalling
- **True serverless P2P.** WebRTC DataChannels for cross-device; a **two-way URL exchange**: host creates an offer link, guest opens it and produces a reply link, host opens the reply to connect. STUN only (public STUN servers; no TURN, no application server).
- The blob (compressed SDP + `gameId` + host/guest role) travels in the **URL fragment** (`#…`), never to any server.
- **Paste-box fallback** is always available for blobs too long for a URL.
- **BroadcastChannel always on** for same-browser tabs; deduped against WebRTC by message id.
- **Exactly two players.** Later joiners are rejected.
- **JSON board export/import** as an additional serverless fallback (no WebRTC).
- **HTTPS required.** `file://` shows a warning and disables WebRTC (BroadcastChannel fallback still works locally).

### Persistence & resume
- `localStorage` under `hw-board:<gameId>`, autosaved **debounced on every change**; the last-used gameId is remembered.
- Reload restores the board and camera instantly, online or not.
- WebRTC cannot silently reconnect: resuming requires a **fresh two-way exchange**. On connect, peers exchange documents and **merge per-piece by newest version**, tie-broken by peer-id. Equal-version, offline-divergence conflicts resolve automatically.

### Interaction details (settled)
- **Direction shows ownership.** A ship points away from its owner, towards the other player: on your screen your own ships point up and the opponent's point down; the same ship points the other way on your opponent's screen. Untouched/Bank ships point up for both.
- **Flip:** right-click toggles triangle↔square, anchored at the piece's centre, preserving colour/size — on a touchscreen, long-press. A star is neutral (shared by both); a star flipped back is a ship of the player who flipped it.
- **Send home:** double-click returns a piece to its original Bank slot as an upright, neutral ship — on a touchscreen, double-tap. No confirmation (it is undone by dragging the piece out again).
- Free drag, overlap allowed, dragged piece brought to front. No snapping, no true stacking, no multi-select (see Out of Scope).
- Camera: shared pan+zoom; wheel / pinch; anchored at cursor; 25%–100% (current level shown in the toolbar); independent of the per-player piece direction; no independent free-look.
- Touch: drag = move, **double-tap = send home**, **long-press = flip**, pinch = zoom, background drag = pan.
- Presence: opponent cursor, opponent drag highlight, connection status, all labelled with the opponent's name.
- **Name is mandatory** before creating or joining a game; default suggestion "Gast".

### Presentation
- German UI, reusing the existing `style.css` colour tokens and dark/light theme; `play.html` keeps its own JS/CSS so the reference pages are untouched.
- Header is just "Homeworlds" — no subheading and no bottom-nav links.
- Toolbar shows the connection status and the current zoom level, plus the "Steuerung", "Verbindung erneuern" and "Zurücksetzen" buttons.
- The invite panel and the JSON exchange panel collapse (fold) so the board gets the space; "Board als JSON austauschen" sits below the board.
- A "Steuerung" dialog lists every action (move, flip, send home, reset, zoom, pan, connect) so a new player learns the gestures.

## Testing Decisions

**What makes a good test:** test external behaviour of the pure modules — the visible consequences of inputs (documents in, documents out) — never their internals. A test should be able to change the SVG renderer, the WebRTC adapter, or `localStorage` wiring completely and still pass, because those are not where the logic lives.

**Seams (the primary seam is deliberately the only nontrivial one):**
- **`core/state`** — target of the bulk of the tests: deterministic initial document and Bank layout; move/clamp and ownership; flip preserving position/colour/size and ownership rules; `pieceFacing` (own/opponent/neutral, stars); send-home returning to slot as a neutral ship; Reset; per-piece LWW (newer wins, older ignored); tiebreak; camera LWW; `mergeDocuments`; message validation (bad id, bad colour, NaN coords, unknown kind/owner). Run with `node --test`.
- **`signalling`** — pure codec round-trip: blob → URL/paste string → blob is identity; malformed input is rejected.
- **Transport / storage / renderer** — thin shells over the reducer; verified by a small number of integration checks (BroadcastChannel end-to-end in one browser) and manual use, not unit tests.

**Prior art:** the repo has no tests and no test tooling today. This spec introduces a minimal `node --test` setup with **zero runtime dependencies** (dev-only), keeping the pure core importable in Node.

**Note on seams to confirm:** this layout was proposed to the user for review; the primary seam is `core/state`, the secondary is `signalling`, and no other module is unit-tested.

## Out of Scope

- **Homeworlds rules enforcement** of any kind: turn order, capture, build, trade, movement legality, forgetting, catastrophe, supernova, ownership, win conditions. The app is a free-form tabletop.
- **Spectators and more than two players.** Not covered by this spec and not planned.
- **A list of multiple saved games.** One slot per `gameId` only.
- **Undo / redo and move history.**
- **True stacking / snapping / grouping** of pieces.
- **Independent (non-synced) camera** or "free look".
- **Accounts, login, cloud save, any application server, TURN relay, or analytics.**
- **Multi-select / marquee / group drag.** (May be expanded later.)
- **Internationalisation** beyond the German UI.

## Further Notes

- **NAT caveat:** with no server there is no TURN relay; on strict or symmetric NATs WebRTC may fail to connect. The JSON export/import fallback is the escape hatch, and same-device tabs always work.
- **HTTPS caveat:** WebRTC requires a secure context; the app must be served over HTTPS (GitHub Pages), not opened as `file://`.
- **URL-length caveat:** large SDP blobs can exceed practical URL lengths in some chat apps; hence the always-available paste box and JSON export.
- **Language/theme:** German UI and existing dark/light palette are shared with `index.html`/`guide.html`, but `play.html` keeps its own script/styles to avoid disturbing the reference pages.
