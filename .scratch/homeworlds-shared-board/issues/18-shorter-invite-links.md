# 18: Shorter invite links and codes

**What to build:** An invite link has to be short enough to survive a chat app.
The hand-rolled LZW codec did not compress an SDP — it *expanded* it, producing
~2000-character links and codes that were easily truncated or mangled. Replace
it with `deflate-raw`, and keep reading the old format so an invite that is
already in flight still works.

**Blocked by:** 08 (Signalling codec), 09 (Identity gate and handshake UI)

**Status:** resolved

- [x] A realistic offer SDP encodes to a link well under 1000 characters
- [x] New links use a versioned `#hw2=` fragment / `HW2:` paste code
- [x] Legacy `#hw=` / `HW1:` (LZW) links still decode
- [x] Malformed and truncated input is rejected without throwing
- [x] Tests cover the round-trip, the shorter size and a real legacy payload

## Comments

`signalling/codec.js` now compresses with `deflate-raw` through
`CompressionStream`/`DecompressionStream` (present in every WebRTC-capable
browser and in Node). The LZW codec is kept only as a fallback encoder and to
decode legacy payloads. A payload is `"z" + base64url(deflate)` or
`"l" + base64url(LZW)`, and the fragment/paste prefixes carry a version
(`#hw2=` / `HW2:`), so a new link can never be mistaken for a legacy one.

Measured on a ~1.2 KB Chrome offer SDP: the old codec produced a 2064-character
URL, deflate produces ~750. The public encode/decode helpers are now `async`
(streams), so `app.js` and the tests await them; `decodeAnyBlob` now simply tries
the fragment decoder and then the paste decoder.
