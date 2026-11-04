// signalling/codec.js
//
// Pure, dependency-free codec for the WebRTC connection blob. It packages a
// blob (e.g. { v, role, gameId, sdp }) into a shareable URL fragment and into a
// paste-box string, and decodes either back to the blob.
//
// Pipeline (both directions): compact JSON -> UTF-8 -> deflate-raw -> base64url.
// `CompressionStream`/`DecompressionStream` are available in every browser that
// can also do WebRTC (and in Node), and deflate shrinks an SDP several times
// better than a hand-rolled LZW did — which matters because the whole blob has
// to fit in a chat message. The original LZW codec is kept for two reasons: as
// a fallback when CompressionStream is missing, and to decode links produced by
// older versions of the app (`#hw=` / `HW1:`), so an invite that is already in
// flight keeps working.
//
// No DOM, no storage, no network. Malformed input returns null; nothing throws.
//
// The public encode/decode functions are async because CompressionStream is
// stream-based. Callers simply await them.

// A payload is `"z" + base64url(deflate)` or `"l" + base64url(LZW)`. The one
// character marker keeps `decodeBlob` self-describing, while the fragment/paste
// prefixes carry a version so a new link can never be mistaken for a legacy
// one (whose payload starts directly with base64url, with no marker).
const MARKER_DEFLATE = 'z';
const MARKER_LZW = 'l';

const FRAGMENT_PREFIX = 'hw2=';
const LEGACY_FRAGMENT_PREFIX = 'hw=';
const PASTE_PREFIX = 'HW2:';
const LEGACY_PASTE_PREFIX = 'HW1:';

const SUPPORTS_DEFLATE =
  typeof CompressionStream === 'function' &&
  typeof DecompressionStream === 'function' &&
  typeof Blob === 'function' &&
  typeof Response === 'function';

// ---------------------------------------------------------------------------
// base64url (RFC 4648 §5), hand-rolled so there is no dependency on btoa/Buffer
// ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_LOOKUP = (() => {
  const map = new Map();
  for (let i = 0; i < B64.length; i++) map.set(B64[i], i);
  return map;
})();

function bytesToBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 0x3f];
  }
  return out;
}

function base64UrlToBytes(text) {
  // Accept optional padding and either url-safe or standard alphabet.
  const s = text.replace(/=+$/u, '');
  if (s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const c0 = B64_LOOKUP.get(s[i]);
    const c1 = B64_LOOKUP.get(s[i + 1]);
    if (c0 === undefined || c1 === undefined) return null;
    const c2 = s[i + 2] === undefined ? undefined : B64_LOOKUP.get(s[i + 2]);
    const c3 = s[i + 3] === undefined ? undefined : B64_LOOKUP.get(s[i + 3]);
    if (c2 === undefined && s[i + 2] !== undefined) return null;
    if (c3 === undefined && s[i + 3] !== undefined) return null;
    out[o++] = (c0 << 2) | (c1 >> 4);
    if (c2 === undefined) break;
    out[o++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (c3 === undefined) break;
    out[o++] = ((c2 & 0x03) << 6) | c3;
  }
  return out.subarray(0, o);
}

// ---------------------------------------------------------------------------
// LZW over a byte stream. Codes are 16-bit big-endian; 0-255 are literals and
// 256 is CLEAR (used to reset a full dictionary). 257+ are dictionary entries.
// Kept for the fallback encoder and, above all, for decoding legacy payloads.
// ---------------------------------------------------------------------------

const CLEAR = 256;
const DICT_LIMIT = 65536;

function bytesToBinaryString(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function binaryStringToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function codesToBytes(codes) {
  const out = new Uint8Array(codes.length * 2);
  for (let i = 0; i < codes.length; i++) {
    out[i * 2] = codes[i] >> 8;
    out[i * 2 + 1] = codes[i] & 0xff;
  }
  return out;
}

function bytesToCodes(bytes) {
  if (bytes.length % 2 !== 0) return null;
  const codes = new Array(bytes.length / 2);
  for (let i = 0; i < codes.length; i++) {
    codes[i] = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
  }
  return codes;
}

function lzwCompress(bytes) {
  const input = bytesToBinaryString(bytes);
  const codes = [CLEAR];
  const dict = new Map();
  let next = CLEAR + 1;

  if (input.length > 0) {
    let w = input[0];
    for (let i = 1; i < input.length; i++) {
      const c = input[i];
      const wc = w + c;
      if (dict.has(wc)) {
        w = wc;
        continue;
      }
      codes.push(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
      if (next < DICT_LIMIT) {
        dict.set(wc, next);
        next++;
      } else {
        codes.push(CLEAR);
        dict.clear();
        next = CLEAR + 1;
      }
      w = c;
    }
    codes.push(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
  }
  return codesToBytes(codes);
}

function lzwDecompress(bytes) {
  const codes = bytesToCodes(bytes);
  if (!codes) return null;

  let dict = null;
  let next = CLEAR + 1;
  const reset = () => {
    dict = new Map();
    next = CLEAR + 1;
  };
  reset();

  let out = '';
  let prev = null;
  for (const code of codes) {
    if (code === CLEAR) {
      reset();
      prev = null;
      continue;
    }
    let entry;
    if (code < 256) {
      entry = String.fromCharCode(code);
    } else if (dict.has(code)) {
      entry = dict.get(code);
    } else if (prev !== null && code === next) {
      entry = prev + prev[0];
    } else {
      return null;
    }
    out += entry;
    if (prev !== null && next < DICT_LIMIT) {
      dict.set(next, prev + entry[0]);
      next++;
    }
    prev = entry;
  }
  return binaryStringToBytes(out);
}

// ---------------------------------------------------------------------------
// deflate-raw, via the platform streams (no dependency)
// ---------------------------------------------------------------------------

async function deflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// UTF-8 bytes -> JSON object, or null. Rejects anything that is not a plain
// object (arrays, primitives, null) so a valid-but-wrong payload is ignored.
function parseBlobBytes(bytes) {
  if (!bytes) return null;
  let blob;
  try {
    blob = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (blob === null || typeof blob !== 'object' || Array.isArray(blob)) return null;
  return blob;
}

// ---------------------------------------------------------------------------
// Blob -> payload and back
// ---------------------------------------------------------------------------

// Compact JSON -> UTF-8 -> deflate-raw -> base64url (or LZW when the platform
// has no CompressionStream). The returned string starts with a format marker.
export async function encodeBlob(blob) {
  const utf8 = new TextEncoder().encode(JSON.stringify(blob));
  if (SUPPORTS_DEFLATE) {
    try {
      return MARKER_DEFLATE + bytesToBase64Url(await deflateBytes(utf8));
    } catch {
      // Deflate failed for some reason; fall back to the LZW path below.
    }
  }
  return MARKER_LZW + bytesToBase64Url(lzwCompress(utf8));
}

// Marker-prefixed payload -> blob. Returns null on any malformed input.
export async function decodeBlob(payload) {
  if (typeof payload !== 'string' || payload.length === 0) return null;
  const marker = payload[0];
  const bytes = base64UrlToBytes(payload.slice(1));
  if (!bytes) return null;
  if (marker === MARKER_DEFLATE) {
    if (!SUPPORTS_DEFLATE) return null;
    try {
      return parseBlobBytes(await inflateBytes(bytes));
    } catch {
      return null;
    }
  }
  if (marker === MARKER_LZW) {
    return parseBlobBytes(lzwDecompress(bytes));
  }
  return null;
}

// Legacy payloads (before deflate) were base64url(LZW) with no marker.
function decodeLegacyPayload(base64) {
  const bytes = base64UrlToBytes(base64);
  if (!bytes) return null;
  return parseBlobBytes(lzwDecompress(bytes));
}

// ---------------------------------------------------------------------------
// Packaging: URL fragment and paste-box string
// ---------------------------------------------------------------------------

// A URL fragment string, e.g. `#hw2=AQID...`, ready to append to the page URL.
export async function encodeFragment(blob) {
  return '#' + FRAGMENT_PREFIX + (await encodeBlob(blob));
}

// Decodes a new fragment, a legacy `#hw=` fragment, a full URL, or a bare
// `hw2=`/`hw=` token. Null if absent or malformed.
export async function decodeFragment(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  const hash = s.indexOf('#');
  if (hash !== -1) s = s.slice(hash + 1);
  if (s.startsWith(FRAGMENT_PREFIX)) return decodeBlob(s.slice(FRAGMENT_PREFIX.length));
  if (s.startsWith(LEGACY_FRAGMENT_PREFIX)) return decodeLegacyPayload(s.slice(LEGACY_FRAGMENT_PREFIX.length));
  return null;
}

// A paste-box string, e.g. `HW2:AQID...`, for when the link is too long.
export async function encodePaste(blob) {
  return PASTE_PREFIX + (await encodeBlob(blob));
}

// Decodes a new `HW2:` code or a legacy `HW1:` code (surrounding whitespace
// tolerated). Null if absent or malformed.
export async function decodePaste(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  if (s.startsWith(PASTE_PREFIX)) return decodeBlob(s.slice(PASTE_PREFIX.length));
  if (s.startsWith(LEGACY_PASTE_PREFIX)) return decodeLegacyPayload(s.slice(LEGACY_PASTE_PREFIX.length));
  return null;
}
