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

test('a connection blob round-trips through a URL fragment', () => {
  const fragment = encodeFragment(BLOB);
  assert.equal(typeof fragment, 'string');
  assert.ok(fragment.startsWith('#'));
  assert.deepEqual(decodeFragment(fragment), BLOB);
});

test('a connection blob round-trips through a paste-box string', () => {
  const paste = encodePaste(BLOB);
  assert.equal(typeof paste, 'string');
  assert.deepEqual(decodePaste(paste), BLOB);
});

test('a blob also round-trips through the raw payload helpers', () => {
  assert.deepEqual(decodeBlob(encodeBlob(BLOB)), BLOB);
});

test('the fragment decoder accepts a full URL and the paste decoder tolerates whitespace', () => {
  const url = `https://example.test/play.html#${encodeFragment(BLOB).slice(1)}`;
  assert.deepEqual(decodeFragment(url), BLOB);
  assert.deepEqual(decodePaste(`\n  ${encodePaste(BLOB)}  \n`), BLOB);
});

test('non-ASCII and unicode survive the round-trip', () => {
  const blob = {
    v: 1,
    role: 'guest',
    gameId: 'grüße-世界-🎲',
    sdp: 'v=0\r\na=ice-ufrag:hügel\r\na=identity:naïve café — 日本語\r\n',
  };
  assert.deepEqual(decodeFragment(encodeFragment(blob)), blob);
  assert.deepEqual(decodePaste(encodePaste(blob)), blob);
});

test('a long repetitive blob is compressed below its raw JSON length', () => {
  const blob = { v: 1, role: 'host', gameId: 'g', sdp: 'a=mid:0\r\n'.repeat(200) };
  const payload = encodeBlob(blob);
  assert.ok(payload.length < JSON.stringify(blob).length, `payload ${payload.length}`);
  assert.deepEqual(decodeBlob(payload), blob);
});

test('blobs with nested structures round-trip identically', () => {
  const blob = {
    v: 2,
    role: 'host',
    gameId: 'g',
    sdp: 'x',
    candidates: [{ host: '10.0.0.1', port: 1234 }, { host: '::1', port: 5678 }],
    flags: { trickle: true, relay: false },
  };
  assert.deepEqual(decodeFragment(encodeFragment(blob)), blob);
});

test('truncated fragments are rejected without throwing', () => {
  const fragment = encodeFragment(BLOB);
  for (const cut of [1, 2, 3, fragment.length - 2, fragment.length - 1]) {
    const truncated = fragment.slice(0, cut);
    assert.equal(decodeFragment(truncated), null, `cut at ${cut}`);
  }
});

test('garbage and missing input are rejected without throwing', () => {
  const bad = [
    '',
    '   ',
    '#hw=',
    'HW1:',
    'nonsense',
    '#hw=!!!not base64!!!',
    '#hw===',
    'HW1:@@@@',
    '#',
    '#other=abc',
  ];
  for (const input of bad) {
    assert.equal(decodeFragment(input), null, `fragment ${JSON.stringify(input)}`);
    assert.equal(decodePaste(input), null, `paste ${JSON.stringify(input)}`);
  }
});

test('non-string input is rejected without throwing', () => {
  for (const input of [null, undefined, 0, 42, {}, [], true]) {
    assert.equal(decodeBlob(input), null);
    assert.equal(decodeFragment(input), null);
    assert.equal(decodePaste(input), null);
  }
});

test('decoding a valid payload that is not a JSON object is rejected', () => {
  assert.equal(decodeBlob(encodeBlob([1, 2, 3])), null);
  assert.equal(decodeBlob(encodeBlob('a string')), null);
  assert.equal(decodeBlob(encodeBlob(null)), null);
});
