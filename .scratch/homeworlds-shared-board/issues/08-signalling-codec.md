# 08: Signalling codec

**What to build:** A pure, dependency-free codec that packages the connection blob into a shareable URL fragment and into a paste-box string (compress + base64), and decodes both back to the blob. It is the second unit-tested seam, independent of any UI or transport.

**Blocked by:** 01 (Initial board renders)

**Status:** resolved

- [x] A connection blob can be encoded to a URL fragment and to a paste-box string, and decoded back
- [x] The round-trip blob → string → blob is identical
- [x] Malformed or truncated input is rejected rather than throwing
- [x] Tests cover the round-trip and the rejection cases

## Comments

Implemented on the integration branch as `signalling/codec.js` (pure, zero
dependencies): compact JSON → UTF-8 → a self-contained LZW codec → hand-rolled
base64url, deliberately avoiding `CompressionStream` so it runs identically in
the browser and in Node. Exposes `encodeBlob`/`decodeBlob`,
`encodeFragment`/`decodeFragment` (`#hw=…`, accepts full URLs) and
`encodePaste`/`decodePaste` (`HW1:…`). Malformed/truncated/garbage input returns
`null` and never throws. 11 tests cover both round-trips, unicode, compression
and rejection cases.
