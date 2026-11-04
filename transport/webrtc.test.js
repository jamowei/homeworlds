import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWebRtcTransport, isWebRtcSupported, DEFAULT_ICE_SERVERS } from './webrtc.js';

test('the ICE configuration is STUN only (no TURN relay)', () => {
  for (const server of DEFAULT_ICE_SERVERS) {
    assert.ok(!String(server.urls).includes('turn:'), `${server.urls} must not be a TURN server`);
    assert.ok(String(server.urls).includes('stun:'));
  }
});

test('several independent STUN servers are offered, so one blocked provider is survivable', () => {
  const hosts = DEFAULT_ICE_SERVERS.map((server) => String(server.urls));
  assert.ok(hosts.length >= 3, `expected at least 3 STUN servers, got ${hosts.length}`);
  assert.ok(hosts.some((url) => url.includes('google')), 'keeps the original Google servers');
  assert.ok(hosts.some((url) => url.includes('cloudflare')), 'adds Cloudflare');
  assert.equal(new Set(hosts).size, hosts.length, 'no duplicate servers');
});

test('WebRTC is reported unsupported in Node', () => {
  assert.equal(isWebRtcSupported(), false);
});

test('creating an offer without WebRTC fails with a clear message', async () => {
  const transport = createWebRtcTransport({ role: 'host', gameId: 'g' });
  await assert.rejects(() => transport.createOffer(), /WebRTC/);
});

test('accepting an answer without an offer fails', async () => {
  const transport = createWebRtcTransport({ role: 'host', gameId: 'g' });
  await assert.rejects(() => transport.acceptAnswer({ sdp: {} }), /Angebot/);
});

test('an invalid invite is rejected', async () => {
  const transport = createWebRtcTransport({ role: 'guest' });
  await assert.rejects(() => transport.createAnswer(null), /Ungültig|WebRTC/);
});

test('a transport is not connected before the handshake', () => {
  const transport = createWebRtcTransport({ role: 'host', gameId: 'g' });
  assert.equal(transport.isConnected(), false);
  assert.equal(transport.role, 'host');
  transport.close();
});
