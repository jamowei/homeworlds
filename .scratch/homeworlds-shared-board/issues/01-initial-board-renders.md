# 01: Initial board renders

**What to build:** Opening the board page shows the full initial table immediately — all 36 Homeworlds pieces as triangles, arranged in the ordered Bank on the right edge of a bounded world with a visible boundary, in the existing German UI and dark/light theme. This ticket establishes the pure `core/state` seam (a deterministic initial document) and the `node --test` harness, and links the new page from the existing site navigation.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Opening the board page shows all 36 pieces as triangles; none is missing or duplicated
- [ ] The Bank is ordered 4 colour rows × 3 size columns, with the three copies of each piece grouped within their cell
- [ ] The Bank sits at the far-right edge of the world, and the world has a visible boundary
- [ ] Piece ids are deterministic (encode colour/size/copy) and identical on every load
- [ ] The page is reachable from the existing site navigation and matches the existing German UI and theme
- [ ] `node --test` runs green and covers the initial document and the Bank layout
