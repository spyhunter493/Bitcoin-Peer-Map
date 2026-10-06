import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { PeerService, GEO_STALE_AFTER_SECONDS, GEO_REFRESH_RETRY_MS } from '../../src/server/services/peers.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { FakeRpc, temporaryDirectory, deferred, flush } from './helpers.ts';

const response = () => Response.json({ status: 'success', country: 'NZ', city: 'Updated', lat: 3, lon: 4 });
function setup(t: TestContext, fetcher: typeof fetch) {
    let elapsed = 0;
    t.mock.method(Date, 'now', () => 1_800_000_000_000 + elapsed);
    t.mock.method(performance, 'now', () => elapsed);
    t.mock.method(console, 'warn', () => {});
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), true);
    geo.initialize();
    const connectivity = new ConnectivityService(), peers = new PeerService(rpc, geo, connectivity, undefined, fetcher);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }];
    t.after(async () => { await peers.stop(); await connectivity.stop(); geo.close(); });
    return { rpc, geo, peers, connectivity, advance: (milliseconds: number) => { elapsed += milliseconds; } };
}
async function seed(geo: GeoDatabase, age = GEO_STALE_AFTER_SECONDS) {
    await geo.save('8.8.8.8', { country: 'NZ', city: 'Cached', lat: 1, lon: 2 }, Math.floor(Date.now() / 1000) - age);
}

test('locations become stale at exactly 30 days and remain visible throughout a background refresh', async t => {
    const pending = deferred<Response>(); let calls = 0;
    const { geo, peers, connectivity, advance } = setup(t, () => { calls++; return pending.promise; });
    await seed(geo, GEO_STALE_AFTER_SECONDS - 1);
    connectivity.setGeoipApiDisabled(true);
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal((peers.listPeers()[0].geo as { freshness: string }).freshness, 'fresh');
    advance(1000); connectivity.setGeoipApiDisabled(false);
    await peers.refreshOnce(); assert.deepEqual(peers.geoQueue.shift(), ['8.8.8.8', 'ipv4']);
    const refreshing = peers.resolveGeo('8.8.8.8', 'ipv4'); await flush();
    assert.equal(calls, 1);
    assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Cached');
    assert.equal(peers.listPeers()[0].location_status, 'ok');
    assert.deepEqual(peers.listPeers()[0].geo, { source: 'ip_api', observed_at: 1_800_000_000 - GEO_STALE_AFTER_SECONDS + 1,
        age_seconds: GEO_STALE_AFTER_SECONDS, freshness: 'stale', stale_after_seconds: GEO_STALE_AFTER_SECONDS });
    pending.resolve(response()); await refreshing;
    assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Updated');
    assert.deepEqual(peers.listPeers()[0].geo, { source: 'ip_api', observed_at: 1_800_000_001,
        age_seconds: 0, freshness: 'fresh', stale_after_seconds: GEO_STALE_AFTER_SECONDS });
});

test('failed stale refresh retries after an hour and unchanged imports preserve that deadline', async t => {
    let calls = 0;
    const { geo, peers, advance } = setup(t, async () => { calls++; throw new Error('offline'); });
    await seed(geo);
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 1); assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Cached');
    advance(GEO_REFRESH_RETRY_MS - 1); await peers.refreshOnce(); assert.deepEqual(peers.geoQueue, []);
    geo.datasetChanged(); await peers.refreshOnce();
    assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Cached', 'generation changes retain usable coordinates');
    peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 1, 'unchanged record reloads do not reset retry timing');
    advance(1); await peers.refreshOnce(); assert.deepEqual(peers.geoQueue.shift(), ['8.8.8.8', 'ipv4']);
    await peers.resolveGeo('8.8.8.8', 'ipv4'); assert.equal(calls, 2);
});

test('newer records reset stale retry timing and keep their winning source', async t => {
    let calls = 0;
    const { geo, peers } = setup(t, async () => { calls++; throw new Error('offline'); });
    await seed(geo);
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    await geo.save('8.8.8.8', { country: 'NZ', city: 'Newer', lat: 5, lon: 6 });
    geo.datasetChanged(); await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 1); assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Newer');
    assert.equal((peers.listPeers()[0].geo as { freshness: string }).freshness, 'fresh');
    assert.equal(peers.geoCache.get('8.8.8.8')?.refreshRetryAt, null);
});

test('a successful lookup superseded by a future record cannot repeatedly refresh that unknown-age winner', async t => {
    let calls = 0;
    const { geo, peers, advance } = setup(t, async () => { calls++; return response(); });
    const future = Math.floor(Date.now() / 1000) + 86400;
    await geo.save('8.8.8.8', { country: 'NZ', city: 'Future winner', lat: 1, lon: 2 }, future);
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 1); assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Future winner');
    assert.equal((peers.listPeers()[0].geo as { freshness: string }).freshness, 'unknown');
    assert.equal(peers.geoCache.get('8.8.8.8')?.refreshRetryAt, GEO_REFRESH_RETRY_MS);
    await peers.refreshOnce(); assert.deepEqual(peers.geoQueue, []);
    advance(GEO_REFRESH_RETRY_MS - 1); await peers.refreshOnce(); assert.deepEqual(peers.geoQueue, []);
    advance(1); await peers.refreshOnce(); assert.deepEqual(peers.geoQueue.shift(), ['8.8.8.8', 'ipv4']);
    await peers.resolveGeo('8.8.8.8', 'ipv4'); assert.equal(calls, 2);
});

test('delayed persistence superseded by an unknown-age winner starts its refresh cooldown at completion', async t => {
    let calls = 0;
    const { geo, peers, advance } = setup(t, async () => { calls++; return response(); });
    const save = t.mock.method(geo, 'save', async () => ({ status: 'failed' as const, message: 'Disk full' }));
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.ok(peers.geoCache.get('8.8.8.8')?.pendingSave);
    save.mock.restore();
    await geo.save('8.8.8.8', { country: 'NZ', city: 'Future winner', lat: 1, lon: 2 }, Math.floor(Date.now() / 1000) + 86400);
    advance(60_000); await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 1); assert.equal(peers.geoCache.get('8.8.8.8')?.pendingSave, undefined);
    assert.equal(peers.geoCache.get('8.8.8.8')?.refreshRetryAt, 60_000 + GEO_REFRESH_RETRY_MS);
    await peers.refreshOnce(); assert.deepEqual(peers.geoQueue, []);
    advance(GEO_REFRESH_RETRY_MS - 1); await peers.refreshOnce(); assert.deepEqual(peers.geoQueue, []);
    advance(1); await peers.refreshOnce(); assert.deepEqual(peers.geoQueue.shift(), ['8.8.8.8', 'ipv4']);
    await peers.resolveGeo('8.8.8.8', 'ipv4'); assert.equal(calls, 2);
});

test('database-only retains stale locations and Google probe failures do not block healthy GeoIP', async t => {
    let calls = 0;
    const { geo, peers, connectivity } = setup(t, async () => { calls++; return response(); });
    await seed(geo); connectivity.setGeoipApiDisabled(true); connectivity.internetState = 'red';
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 0); assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Cached');
    await peers.refreshOnce(); assert.deepEqual(peers.geoQueue, []);
    connectivity.setGeoipApiDisabled(false);
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 1); assert.equal(connectivity.snapshot().providers.geoip.state, 'healthy');
    assert.equal(connectivity.snapshot().internet_state, 'red');
});

for (const timestamp of [null, 0, 1_800_000_001]) {
    test(`unknown-age cached location (${timestamp}) refreshes without hiding its location`, async t => {
        let calls = 0;
        const { geo, peers } = setup(t, async () => { calls++; throw new Error('offline'); });
        const writer = new DatabaseSync(geo.path);
        writer.prepare('INSERT INTO geo_cache (ip, country, city, lat, lon, last_updated) VALUES (?, ?, ?, ?, ?, ?)')
            .run('8.8.8.8', 'NZ', 'Legacy', 1, 2, timestamp); writer.close();
        await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
        assert.equal(calls, 1); assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Legacy');
        const meta = peers.listPeers()[0].geo as { source: string; age_seconds: number | null; freshness: string };
        assert.equal(meta.source, 'unknown'); assert.equal(meta.age_seconds, null); assert.equal(meta.freshness, 'unknown');
    });
}

test('missing locations retry after one minute while provider cooldown keeps stale coordinates usable', async t => {
    let calls = 0;
    const { geo, peers, connectivity, advance } = setup(t, async () => { calls++; return Response.json({ status: 'fail', message: 'no location' }); });
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    advance(59_999); await peers.refreshOnce(); assert.deepEqual(peers.geoQueue, []);
    advance(1); await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4'); assert.equal(calls, 2);
    await seed(geo); geo.datasetChanged();
    connectivity.providerFailure('geoip', new Error('quota'), new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 2); assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Cached');
    assert.equal(peers.geoCache.get('8.8.8.8')?.refreshRetryAt, null, 'a skipped request is not a failed refresh');
    advance(120_000); await peers.refreshOnce(); assert.deepEqual(peers.geoQueue.shift(), ['8.8.8.8', 'ipv4']);
    await peers.resolveGeo('8.8.8.8', 'ipv4'); assert.equal(calls, 3);
});

test('private peers never refresh and have unavailable location metadata', async t => {
    const { rpc, peers } = setup(t, async () => assert.fail('private peer disclosed'));
    rpc.values.getpeerinfo = [{ id: 1, addr: '10.0.0.1:8333', network: 'ipv4' }, { id: 2, addr: 'abcdef.onion:8333', network: 'onion' }];
    await peers.refreshOnce(); assert.deepEqual(peers.geoQueue, []);
    for (const peer of peers.listPeers()) assert.deepEqual(peer.geo,
        { source: null, observed_at: null, age_seconds: null, freshness: 'unavailable', stale_after_seconds: GEO_STALE_AFTER_SECONDS });
});
