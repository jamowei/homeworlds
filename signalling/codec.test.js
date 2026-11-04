import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeBlob,
  decodeBlob,
  encodeFragment,
  decodeFragment,
  encodePaste,
  decodePaste,
} from './codec.js';

const BLOB = {
  v: 1,
  role: 'host',
  gameId: 'game-42',
  sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n',
};

test('a connection blob round-trips through a URL fragment', async () => {
  const fragment = await encodeFragment(BLOB);
  assert.equal(typeof fragment, 'string');
  assert.ok(fragment.startsWith('#'));
  assert.deepEqual(await decodeFragment(fragment), BLOB);
});

test('a connection blob round-trips through a paste-box string', async () => {
  const paste = await encodePaste(BLOB);
  assert.equal(typeof paste, 'string');
  assert.deepEqual(await decodePaste(paste), BLOB);
});

test('a blob also round-trips through the raw payload helpers', async () => {
  assert.deepEqual(await decodeBlob(await encodeBlob(BLOB)), BLOB);
});

test('the fragment decoder accepts a full URL and the paste decoder tolerates whitespace', async () => {
  const url = `https://example.test/play.html${await encodeFragment(BLOB)}`;
  assert.deepEqual(await decodeFragment(url), BLOB);
  assert.deepEqual(await decodePaste(`\n  ${await encodePaste(BLOB)}  \n`), BLOB);
});

test('non-ASCII and unicode survive the round-trip', async () => {
  const blob = {
    v: 1,
    role: 'guest',
    gameId: 'grüße-世界-🎲',
    sdp: 'v=0\r\na=ice-ufrag:hügel\r\na=identity:naïve café — 日本語\r\n',
  };
  assert.deepEqual(await decodeFragment(await encodeFragment(blob)), blob);
  assert.deepEqual(await decodePaste(await encodePaste(blob)), blob);
});

test('a long repetitive blob is compressed below its raw JSON length', async () => {
  const blob = { v: 1, role: 'host', gameId: 'g', sdp: 'a=mid:0\r\n'.repeat(200) };
  const payload = await encodeBlob(blob);
  assert.ok(payload.length < JSON.stringify(blob).length, `payload ${payload.length}`);
  assert.deepEqual(await decodeBlob(payload), blob);
});

test('a realistic offer SDP encodes to a chat-friendly length', async () => {
  // ~1.2 KB of representative Chrome SDP; the old LZW codec turned this into a
  // ~2000-character URL. deflate keeps the whole invite well under 1000.
  const sdp = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 54321 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 203.0.113.5',
    'a=candidate:842163049 1 udp 1677729535 203.0.113.5 54321 typ srflx raddr 10.0.0.5 rport 54321 generation 0 ufrag abcd network-id 1',
    'a=candidate:1510613869 1 udp 2113937151 192.168.1.5 54321 typ host generation 0 ufrag abcd network-id 1',
    'a=candidate:1510613869 1 udp 2113937151 10.0.0.5 54321 typ host generation 0 ufrag abcd network-id 2',
    'a=ice-ufrag:abcd',
    'a=ice-pwd:abcdefghijklmnopqrstuvwxyz',
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 8F:1A:2B:3C:4D:5E:6F:70:81:92:A3:B4:C5:D6:E7:F8:09:1A:2B:3C:4D:5E:6F:70:81:92:A3:B4:C5:D6:E7:F8',
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ].join('\r\n');
  const blob = { v: 1, role: 'host', gameId: 'a1b2c3d4e5f6a7b8', sdp };
  const url = `https://jamowei.github.io/homeworlds/play.html${await encodeFragment(blob)}`;
  assert.ok(url.length < 1000, `URL was ${url.length} characters`);
  assert.deepEqual(await decodeFragment(url), blob);
});

test('blobs with nested structures round-trip identically', async () => {
  const blob = {
    v: 2,
    role: 'host',
    gameId: 'g',
    sdp: 'x',
    candidates: [{ host: '10.0.0.1', port: 1234 }, { host: '::1', port: 5678 }],
    flags: { trickle: true, relay: false },
  };
  assert.deepEqual(await decodeFragment(await encodeFragment(blob)), blob);
});

test('legacy LZW links still decode (invites already in flight keep working)', async () => {
  // Produced by the pre-deflate codec (`#hw=` + base64url(LZW)); a new codec
  // must still read these so an invite sent before an update is not stranded.
  const legacyFragment =
    '#hw=AQAAewAiAHYAIgA6ADEALAAiAHIAbwBsAGUBBAAiAGgAbwBzAHQAIgEHAGcAYQBtAGUASQBkAQ0BFQEXAC0ANAAyARMAIgBzAGQAcAENAHYAPQAwAFwAcgBcAG4AbwA9AC0AIAAxATEAIABJAE4BNABQADQBMQAyADcALgAwAT0ALgAxASoBLABzAS8BQgBuAHQBKAAgASkBKwBuAGEAPQBnAQkAdQBwADoAQgBVAE4ARABMAEUBSgFGACIAfQ';
  assert.deepEqual(await decodeFragment(legacyFragment), BLOB);
  // A legacy fragment is never mistaken for a new one, and vice versa.
  assert.equal(await decodePaste(legacyFragment), null);
  assert.equal(await decodeFragment(await encodePaste(BLOB)), null);
});

test('truncated fragments are rejected without throwing', async () => {
  const fragment = await encodeFragment(BLOB);
  for (const cut of [1, 2, 3, fragment.length - 2, fragment.length - 1]) {
    const truncated = fragment.slice(0, cut);
    assert.equal(await decodeFragment(truncated), null, `cut at ${cut}`);
  }
});

test('garbage and missing input are rejected without throwing', async () => {
  const bad = [
    '',
    '   ',
    '#hw2=',
    '#hw=',
    'HW2:',
    'HW1:',
    'nonsense',
    '#hw2=!!!not base64!!!',
    '#hw=!!!not base64!!!',
    '#hw2===',
    'HW2:@@@@',
    'HW1:@@@@',
    '#',
    '#other=abc',
  ];
  for (const input of bad) {
    assert.equal(await decodeFragment(input), null, `fragment ${JSON.stringify(input)}`);
    assert.equal(await decodePaste(input), null, `paste ${JSON.stringify(input)}`);
  }
});

test('non-string input is rejected without throwing', async () => {
  for (const input of [null, undefined, 0, 42, {}, [], true]) {
    assert.equal(await decodeBlob(input), null);
    assert.equal(await decodeFragment(input), null);
    assert.equal(await decodePaste(input), null);
  }
});

test('decoding a valid payload that is not a JSON object is rejected', async () => {
  assert.equal(await decodeBlob(await encodeBlob([1, 2, 3])), null);
  assert.equal(await decodeBlob(await encodeBlob('a string')), null);
  assert.equal(await decodeBlob(await encodeBlob(null)), null);
});
