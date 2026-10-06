import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { GeoDatabase, GEO_SAVE_RETRY_BUDGET_MS } from '../../src/server/services/geoip.ts';
import { PeerService, GEO_PERSISTENCE_RETRY_MS } from '../../src/server/services/peers.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { FakeRpc, temporaryDirectory, deferred, flush } from './helpers.ts';

function setup(t: TestContext, fetcher: typeof fetch) {
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), true);
    geo.initialize();
    const connectivity = new ConnectivityService(), peers = new PeerService(rpc, geo, connectivity, undefined, fetcher);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }];
    t.after(async () => { await peers.stop(); await connectivity.stop(); geo.close(); });
    return { rpc, geo, peers, connectivity };
}
const location = () => Response.json({ status: 'success', country: 'NZ', city: 'API', lat: 1, lon: 2 });

test('failed busy persistence retains a visible location and retries its original data without another provider lookup', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let time = 0, calls = 0;
    t.mock.method(performance, 'now', () => time);
    t.mock.method(Date, 'now', () => 1_700_000_000_000 + time);
    t.mock.method(console, 'error', () => {});
    const { geo, peers, connectivity } = setup(t, async () => { calls++; return location(); });
    const writer = new DatabaseSync(geo.path); t.after(() => writer.close());
    writer.exec('BEGIN IMMEDIATE');
    await peers.refreshOnce(); assert.deepEqual(peers.geoQueue.shift(), ['8.8.8.8', 'ipv4']);
    const pending = peers.resolveGeo('8.8.8.8', 'ipv4');
    await flush();
    assert.equal(peers.listPeers()[0].location, 'API, NZ', 'a writer lock must not hide a known location');
    time = GEO_SAVE_RETRY_BUDGET_MS; t.mock.timers.tick(50); await pending;
    assert.equal(calls, 1); assert.equal(geo.get('8.8.8.8'), null);
    assert.ok(peers.geoCache.get('8.8.8.8')?.pendingSave);
    time += GEO_PERSISTENCE_RETRY_MS - 1; await peers.refreshOnce(); assert.deepEqual(peers.geoQueue, []);
    time++; await peers.refreshOnce(); assert.deepEqual(peers.geoQueue.shift(), ['8.8.8.8', 'ipv4']);
    connectivity.setGeoipApiDisabled(true);
    writer.exec('COMMIT');
    await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 1); assert.equal(geo.get('8.8.8.8')?.last_updated, 1_700_000_000);
    assert.equal(peers.geoCache.get('8.8.8.8')?.pendingSave, undefined);
});

test('retained persistence survives a dataset generation change and adopts the newer stored row', async t => {
    let time = 0;
    t.mock.method(Date, 'now', () => 100_000 + time);
    t.mock.method(performance, 'now', () => time);
    let calls = 0;
    const { geo, peers } = setup(t, async () => { calls++; return location(); });
    const save = t.mock.method(geo, 'save', async () => ({ status: 'failed' as const, message: 'Disk full' }));
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.ok(peers.geoCache.get('8.8.8.8')?.pendingSave);
    save.mock.restore();
    const writer = new DatabaseSync(geo.path);
    writer.prepare('INSERT INTO geo_cache (ip, country, lat, lon, city, last_updated) VALUES (?, ?, ?, ?, ?, ?)').run('8.8.8.8', 'NZ', 3, 4, 'Imported', 200);
    writer.close(); geo.datasetChanged();
    assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'API');
    await peers.refreshOnce(); assert.deepEqual(peers.geoQueue, [], 'generation changes preserve the separate persistence retry deadline');
    time = GEO_PERSISTENCE_RETRY_MS;
    await peers.refreshOnce(); assert.deepEqual(peers.geoQueue.shift(), ['8.8.8.8', 'ipv4']);
    await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 1); assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Imported');
    assert.equal(peers.geoCache.get('8.8.8.8')?.generation, geo.generation);
    assert.equal(peers.geoCache.get('8.8.8.8')?.pendingSave, undefined);
});
test('an invalid newer stored row cannot replace a valid API cache and persistence retries reuse that API result', async t => {
    let time = 0, calls = 0;
    t.mock.method(Date, 'now', () => 100_000);
    t.mock.method(performance, 'now', () => time);
    t.mock.method(console, 'error', () => {});
    const { geo, peers } = setup(t, async () => { calls++; return location(); });
    const writer = new DatabaseSync(geo.path);
    writer.prepare('INSERT INTO geo_cache (ip, country, lat, lon, city, last_updated) VALUES (?, ?, ?, ?, ?, ?)').run('8.8.8.8', 'NZ', 999, 2, 'Invalid newer', 200);
    writer.close();
    await peers.refreshOnce(); peers.geoQueue.shift(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'API'); assert.equal(peers.cachedGeo('8.8.8.8')?.lat, 1);
    assert.ok(peers.geoCache.get('8.8.8.8')?.pendingSave); assert.equal(calls, 1);
    time = GEO_PERSISTENCE_RETRY_MS; await peers.refreshOnce();
    assert.deepEqual(peers.geoQueue.shift(), ['8.8.8.8', 'ipv4']); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(calls, 1); assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'API');
    assert.ok(peers.geoCache.get('8.8.8.8')?.pendingSave); assert.equal(geo.get('8.8.8.8')?.last_updated, 200);
});

test('a fresh API result across an import uses timestamp arbitration and only publishes for active peers', async t => {
    t.mock.method(Date, 'now', () => 100_000);
    const response = deferred<Response>();
    const { geo, peers, rpc } = setup(t, () => response.promise);
    await peers.refreshOnce(); peers.geoQueue.shift();
    const pending = peers.resolveGeo('8.8.8.8', 'ipv4');
    geo.datasetChanged(); response.resolve(location()); await pending;
    assert.equal(geo.get('8.8.8.8')?.city, 'API'); assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'API');
    const departedResponse = deferred<Response>();
    const departed = new PeerService(rpc, geo, new ConnectivityService(), undefined, () => departedResponse.promise);
    t.after(() => departed.stop());
    rpc.values.getpeerinfo = [{ id: 2, addr: '1.1.1.1:8333', network: 'ipv4' }];
    await departed.refreshOnce();
    const departedLookup = departed.resolveGeo('1.1.1.1', 'ipv4');
    rpc.values.getpeerinfo = []; await departed.refreshOnce();
    departedResponse.resolve(location()); await departedLookup;
    assert.equal(departed.cachedGeo('1.1.1.1'), null);
});

test('shutdown cancels an active busy save promptly without counting it as an outage', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const errors: string[] = []; t.mock.method(console, 'error', (message: string) => { errors.push(message); });
    const { geo, peers } = setup(t, async () => location());
    const writer = new DatabaseSync(geo.path); t.after(() => writer.close());
    writer.exec('BEGIN IMMEDIATE');
    await peers.refreshOnce();
    const pending = peers.resolveGeo('8.8.8.8', 'ipv4'); await flush();
    await peers.stop(); await pending; geo.close(); writer.exec('ROLLBACK');
    assert.deepEqual(errors, []);
});
