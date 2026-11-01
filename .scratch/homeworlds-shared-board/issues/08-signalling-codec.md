# 08: Signalling codec

**What to build:** A pure, dependency-free codec that packages the connection blob into a shareable URL fragment and into a paste-box string (compress + base64), and decodes both back to the blob. It is the second unit-tested seam, independent of any UI or transport.

**Blocked by:** 01 (Initial board renders)

**Status:** ready-for-agent

- [ ] A connection blob can be encoded to a URL fragment and to a paste-box string, and decoded back
- [ ] The round-trip blob → string → blob is identical
- [ ] Malformed or truncated input is rejected rather than throwing
- [ ] Tests cover the round-trip and the rejection cases
