import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWebRtcTransport, isWebRtcSupported, DEFAULT_ICE_SERVERS, meteredCredentialsUrl, mergeIceServers, fetchMeteredIceServers, candidateSummary, iceServerSummary, summariseConnectionStats, waitForIceGathering } from './webrtc.js';

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

test('a TURN failure is reported to onError, so a silent STUN fallback is visible', async () => {
  const reasons = [];
  const result = await fetchMeteredIceServers({
    domain: 'd',
    apiKey: 'k',
    fetchImpl: async () => ({ ok: false, status: 503 }),
    onError: (reason) => reasons.push(reason),
  });
  assert.equal(result, null);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /503/);
});

test('candidateSummary counts SDP candidates by type', () => {
  const sdp = [
    'v=0',
    'a=candidate:1 1 udp 1 10.0.0.1 5000 typ host generation 0',
    'a=candidate:2 1 udp 2 203.0.113.5 6000 typ srflx raddr 10.0.0.1 rport 5000',
    'a=candidate:3 1 udp 3 1.2.3.4 7000 typ relay raddr 0.0.0.0 rport 0',
    'a=candidate:4 1 tcp 4 1.2.3.4 443 typ relay raddr 0.0.0.0 rport 0',
  ].join('\r\n');
  const summary = candidateSummary(sdp);
  assert.equal(summary.count, 4);
  assert.deepEqual(summary.types, { host: 1, srflx: 1, relay: 2 });
  assert.deepEqual(summary.protocols.relay, ['udp', 'tcp']);
  assert.equal(summary.hasRelay, true);
  assert.equal(summary.hasReflexive, true);
  assert.equal(candidateSummary('').count, 0);
  assert.equal(candidateSummary('').hasReflexive, false);
});

test('iceServerSummary never exposes TURN credentials', () => {
  assert.deepEqual(
    iceServerSummary([
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:relay.example:80', username: 'user', credential: 'secret' },
    ]),
    [
      { urls: 'stun:stun.l.google.com:19302', authenticated: false },
      { urls: 'turn:relay.example:80', authenticated: true },
    ],
  );
});

test('summariseConnectionStats recognises a direct and a relayed path', () => {
  const makeReport = (localType, remoteType) => {
    const entries = new Map([
      ['pair', { id: 'pair', type: 'candidate-pair', selected: true, localCandidateId: 'l', remoteCandidateId: 'r', state: 'succeeded' }],
      ['l', { id: 'l', type: 'local-candidate', candidateType: localType, protocol: 'udp' }],
      ['r', { id: 'r', type: 'remote-candidate', candidateType: remoteType, protocol: 'udp' }],
    ]);
    return { forEach: (fn) => entries.forEach(fn) };
  };

  assert.equal(summariseConnectionStats(makeReport('srflx', 'srflx')).path, 'direct');
  assert.match(summariseConnectionStats(makeReport('srflx', 'srflx')).summary, /direkt/);
  assert.equal(summariseConnectionStats(makeReport('relay', 'srflx')).path, 'relay');
  assert.match(summariseConnectionStats(makeReport('relay', 'srflx')).summary, /TURN-Relay/);
  assert.equal(summariseConnectionStats(null), null);
});

function fakePeerConnection({ iceGatheringState = 'gathering', sdp = '' } = {}) {
  return {
    iceGatheringState,
    localDescription: { sdp },
    addEventListener() {},
    removeEventListener() {},
  };
}

test('ice gathering resolves early once reflexive candidates stop arriving', async () => {
  const pc = fakePeerConnection({
    sdp: 'a=candidate:2 1 udp 2 203.0.113.5 6000 typ srflx raddr 10.0.0.1 rport 5000\r\n',
  });
  const started = Date.now();
  const gathering = await waitForIceGathering(pc, { quietMs: 80, timeoutMs: 5000 });
  assert.equal(gathering.reason, 'idle');
  assert.ok(Date.now() - started < 2000, 'must not wait for the hard timeout');
  assert.equal(gathering.hasReflexive, true);
});

test('ice gathering reports a timeout when there are only local candidates', async () => {
  const pc = fakePeerConnection({
    sdp: 'a=candidate:1 1 udp 1 10.0.0.1 5000 typ host generation 0\r\n',
  });
  const gathering = await waitForIceGathering(pc, { quietMs: 50, timeoutMs: 150 });
  assert.equal(gathering.reason, 'timeout');
  assert.equal(gathering.hasReflexive, false);
  assert.equal(gathering.types.host, 1);
});

test('ice gathering resolves immediately when the browser reports complete', async () => {
  const pc = fakePeerConnection({ iceGatheringState: 'complete', sdp: '' });
  const gathering = await waitForIceGathering(pc, { quietMs: 5000, timeoutMs: 5000 });
  assert.equal(gathering.reason, 'complete');
});

test('with TURN configured, gathering waits for a relay candidate', async () => {
  const srflxOnly = fakePeerConnection({
    sdp: 'a=candidate:2 1 udp 2 203.0.113.5 6000 typ srflx raddr 10.0.0.1 rport 5000\r\n',
  });
  const noRelay = await waitForIceGathering(srflxOnly, { requireRelay: true, quietMs: 50, timeoutMs: 150 });
  assert.equal(noRelay.reason, 'timeout');
  assert.equal(noRelay.hasRelay, false);

  const withRelay = fakePeerConnection({
    sdp:
      'a=candidate:2 1 udp 2 203.0.113.5 6000 typ srflx raddr 10.0.0.1 rport 5000\r\n' +
      'a=candidate:3 1 udp 3 1.2.3.4 7000 typ relay raddr 0.0.0.0 rport 0\r\n',
  });
  const relay = await waitForIceGathering(withRelay, { requireRelay: true, quietMs: 50, timeoutMs: 5000 });
  assert.equal(relay.reason, 'idle');
  assert.equal(relay.hasRelay, true);
});
