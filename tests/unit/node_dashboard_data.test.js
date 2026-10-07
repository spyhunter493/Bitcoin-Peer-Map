import test from 'node:test';
import assert from 'node:assert/strict';
import { networkCounts, networkStats, formatNodeAddress, shortNodeAddress, formatBps, locationStatus } from '../../src/static/js/node/dashboard-data.js';
import fixture from '../fixtures/dashboard.json' with { type: 'json' };
const seed = fixture.peers[0];
const peer = (id, changes = {}) => ({ ...seed, id, ...changes });

test('network summary excludes missing ping and keeps zero as a measured value', () => {
    const peers = [peer(1, { network: 'onion', direction: 'IN', ping_ms: 0 }),
        peer(2, { network: 'onion', direction: 'OUT', ping_ms: null }),
        peer(3, { network: 'ipv4', direction: 'OUT', ping_ms: 40 })];
    const counts = networkCounts(peers);
    assert.deepEqual(counts.onion, { in: 1, out: 1 });
    assert.deepEqual(counts.ipv4, { in: 0, out: 1 });
    const tor = networkStats(peers, 'onion');
    assert.equal(tor.label, 'Tor');
    assert.equal(tor.avgPing, 0);
    assert.equal(tor.total, 2);
    assert.equal(networkStats(peers, 'all').avgPing, 20);
    assert.equal(networkStats([], 'i2p'), null);
    assert.equal(networkStats([], 'i2p', { reachable: true, localaddresses: [] }).total, 0);
    assert.equal(networkStats([], 'all').avgPing, null);
});
test('node identity keeps IPv6 brackets and overlay host format', () => {
    assert.equal(formatNodeAddress({ address: '::1', port: 8333 }), '[::1]:8333');
    assert.equal(formatNodeAddress({ address: 'node.onion', port: 8333 }), 'node.onion:8333');
    assert.equal(formatNodeAddress({ address: 'node.b32.i2p', port: 0 }), 'node.b32.i2p');
    assert.equal(shortNodeAddress('a'.repeat(37)), `${'a'.repeat(16)}...${'a'.repeat(15)}`);
    assert.equal(formatBps(0), '0 B/s');
    assert.equal(formatBps(1024), '1.0 KB/s');
    assert.equal(formatBps(1048576), '1.0 MB/s');
});
test('location HUD distinguishes pending, provider failure, backoff and database-only snapshots', () => {
    const peers = [peer(1, { location_status: 'pending' }), peer(2, { location_status: 'pending' })];
    assert.equal(locationStatus(peers, null, 100).text, 'Locating 2 peers...');
    assert.equal(locationStatus(peers, { geo_db_only_mode: true }, 100).text, 'API lookup off');
    assert.equal(locationStatus(peers, { providers: { geoip: { state: 'rate_limited', retry_at: 103.2 } } }, 100).text, 'GeoIP rate limited (4s)');
    assert.equal(locationStatus(peers, { api_available: false }, 100).text, 'GeoIP provider unavailable');
    assert.deepEqual(locationStatus([peer(3, { location_status: 'known' })], null, 100), { text: 'Map Loaded!', loaded: true, color: '' });
    assert.equal(locationStatus([], null, 100).text, null);
});
