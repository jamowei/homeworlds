import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWebRtcTransport, isWebRtcSupported, DEFAULT_ICE_SERVERS, meteredCredentialsUrl, mergeIceServers, fetchMeteredIceServers } from './webrtc.js';

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

test('the Metered credentials URL is built from the domain and key', () => {
  assert.equal(
    meteredCredentialsUrl('myapp.metered.live', 'KEY123'),
    'https://myapp.metered.live/api/v1/turn/credentials?apiKey=KEY123',
  );
  assert.equal(
    meteredCredentialsUrl('https://myapp.metered.live/', 'KEY123'),
    'https://myapp.metered.live/api/v1/turn/credentials?apiKey=KEY123',
  );
  assert.equal(meteredCredentialsUrl('', 'KEY'), null, 'no domain');
  assert.equal(meteredCredentialsUrl('myapp.metered.live', ''), null, 'no key');
});

test('merging ICE servers keeps the first list and drops duplicates and junk', () => {
  const merged = mergeIceServers(
    [{ urls: 'stun:stun.l.google.com:19302' }],
    [
      { urls: 'stun:stun.l.google.com:19302' }, // duplicate url: ignored
      { urls: 'stun:stun.relay.metered.ca:80' },
      { urls: 'turn:standard.relay.metered.ca:80', username: 'u', credential: 'p' },
      { urls: 123 }, // malformed: dropped
      null,
    ],
  );
  assert.deepEqual(merged, [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:standard.relay.metered.ca:80', username: 'u', credential: 'p' },
  ]);
});

test('fetching Metered ICE servers returns the array, or null on any problem', async () => {
  const servers = [{ urls: 'turn:standard.relay.metered.ca:80', username: 'u', credential: 'p' }];
  const fakeFetch = (payload, ok = true) => async () => ({ ok, json: async () => payload });

  assert.deepEqual(
    await fetchMeteredIceServers({ domain: 'myapp.metered.live', apiKey: 'k', fetchImpl: fakeFetch(servers) }),
    servers,
  );
  assert.equal(await fetchMeteredIceServers({ domain: '', apiKey: 'k' }), null, 'incomplete config');
  assert.equal(
    await fetchMeteredIceServers({ domain: 'd', apiKey: 'k', fetchImpl: fakeFetch(servers, false) }),
    null,
    'non-ok response',
  );
  assert.equal(
    await fetchMeteredIceServers({ domain: 'd', apiKey: 'k', fetchImpl: fakeFetch({ not: 'an array' }) }),
    null,
    'malformed body',
  );
  assert.equal(
    await fetchMeteredIceServers({
      domain: 'd',
      apiKey: 'k',
      fetchImpl: async () => {
        throw new Error('network down');
      },
    }),
    null,
    'throwing fetch',
  );
});
