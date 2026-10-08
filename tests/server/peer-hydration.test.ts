import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { writeFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { GeoDatabase, type GeoReadResult, type GeoSaveResult } from '../../src/server/services/geoip.ts';
import { PeerService, GEO_HYDRATION_BATCH_SIZE, GEO_PROVIDER_SPACING_MS, GEO_PERSISTENCE_RETRY_MS, GEO_STALE_AFTER_SECONDS } from '../../src/server/services/peers.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import type { Data } from '../../src/server/types.ts';
import { FakeRpc, temporaryDirectory, deferred, flush } from './helpers.ts';

const now = 1_800_000_000;
const row = (city: string, timestamp: number | null = now, source = 'dataset') => ({ country: 'NZ', city, lat: 1, lon: 2, last_updated: timestamp, geo_source: source });
const response = (city = 'API') => Response.json({ status: 'success', country: 'NZ', city, lat: 3, lon: 4 });
const peer = (host: string, id = 1) => ({ id, addr: `${host}:8333`, network: 'ipv4' });
function fixture(t: TestContext, fetcher: typeof fetch = async () => response()) {
    let elapsed = 0;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(Date, 'now', () => now * 1000 + elapsed);
    t.mock.method(performance, 'now', () => elapsed);
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), true), connectivity = new ConnectivityService();
    geo.initialize();
    const rows = new Map<string, Data>(), reads: string[] = [], cleanup: (() => void)[] = [];
    t.mock.method(geo, 'read', (host: string): GeoReadResult => { reads.push(host); const stored = rows.get(host); return stored ? { status: 'hit', row: stored } : { status: 'miss' }; });
    const peers = new PeerService(rpc, geo, connectivity, undefined, fetcher);
    t.after(async () => { for (const finish of cleanup) finish(); await peers.stop(); await connectivity.stop(); geo.close(); });
    return { rpc, geo, connectivity, peers, rows, reads, cleanup,
        advance: async (milliseconds: number) => { elapsed += milliseconds; t.mock.timers.tick(milliseconds); await flush(); } };
}

for (const [name, timestamp] of [['fresh', now], ['stale', now - GEO_STALE_AFTER_SECONDS], ['unknown', null]] as const) {
    test(`a later ${name} local location hydrates during an unresolved provider request and reloads on generation changes`, async t => {
        const gate = deferred<Response>(); let calls = 0;
        const f = fixture(t, () => { calls++; return gate.promise; });
        f.cleanup.push(() => gate.resolve(Response.json({ status: 'fail' })));
        f.rpc.values.getpeerinfo = [peer('8.8.8.8')];
        await f.peers.refreshOnce(); const pending = f.peers.resolveGeo('8.8.8.8', 'ipv4'); await flush();
        f.rows.set('1.1.1.1', row('Local', timestamp));
        f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2), peer('1.1.1.1', 3)];
        await f.peers.refreshOnce();
        assert.equal(f.peers.listPeers()[1].location, 'Local, NZ');
        assert.equal(f.peers.listPeers()[2].location_status, 'ok');
        assert.equal(f.reads.filter(host => host === '1.1.1.1').length, 1, 'duplicate connections share one refresh read');
        assert.equal(calls, 1, 'hydration does not fan out provider requests');
        f.rows.set('1.1.1.1', row('Imported', now + 1)); f.geo.datasetChanged();
        await f.peers.refreshOnce(); assert.equal(f.peers.listPeers()[1].location, 'Imported, NZ');
        gate.resolve(Response.json({ status: 'fail' })); await pending;
    });
}

test('the actual provider and persistence workers continue independently of a busy save', async t => {
    const save = deferred<GeoSaveResult>(); let calls = 0, saves = 0;
    const f = fixture(t, async () => response(`API ${++calls}`));
    f.cleanup.push(() => save.resolve({ status: 'failed', message: 'fixture released' }));
    t.mock.method(f.geo, 'save', () => { saves++; return save.promise; });
    f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2)];
    await f.peers.start(); await flush(); await f.advance(500);
    assert.equal(f.peers.listPeers()[0].location, 'API 1, NZ', 'provider locations publish before writes start');
    await f.advance(500); assert.equal(saves, 1);
    await f.advance(1000);
    assert.equal(calls, 2, 'the second request proceeds after provider spacing while the first save is held');
    assert.equal(f.peers.listPeers()[1].location, 'API 2, NZ');
    assert.equal(saves, 1, 'only one save is in flight');
    f.rows.set('9.9.9.9', row('Local'));
    f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2), peer('9.9.9.9', 3)];
    await f.peers.refreshOnce(); assert.equal(f.peers.listPeers()[2].location, 'Local, NZ');
    assert.deepEqual(f.peers.saveQueue, ['1.1.1.1']);
    await f.advance(60_000);
    assert.equal(calls, 2, 'refreshes never repeat lookups for either host awaiting persistence');
    assert.equal(saves, 1, 'the busy save remains the only outstanding write');
    save.resolve({ status: 'failed', message: 'fixture released' }); await flush();
    assert.equal(f.peers.geoCache.get('8.8.8.8')?.saveRetryAt, 62_000 + GEO_PERSISTENCE_RETRY_MS);
});

test('failed persistence retries retain the original observation and do not repeat provider lookup', async t => {
    let calls = 0;
    const f = fixture(t, async () => { calls++; return response(); });
    const observations: number[] = [];
    t.mock.method(f.geo, 'save', async (_host: string, _data: Data, timestamp?: number): Promise<GeoSaveResult> => { observations.push(timestamp!); return observations.length === 1 ? { status: 'failed', message: 'busy' } : { status: 'saved', row: row('API', timestamp, 'ip_api') }; });
    f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce();
    await f.peers.resolveGeo('8.8.8.8', 'ipv4'); await f.peers.persistGeo('8.8.8.8');
    await f.advance(GEO_PERSISTENCE_RETRY_MS - 1); await f.peers.refreshOnce(); assert.deepEqual(f.peers.saveQueue, []);
    await f.advance(1); await f.peers.refreshOnce(); assert.deepEqual(f.peers.saveQueue, ['8.8.8.8']);
    await f.peers.persistGeo('8.8.8.8');
    assert.deepEqual(observations, [now, now]); assert.equal(calls, 1);
    assert.equal(f.peers.geoCache.get('8.8.8.8')?.pendingSave, undefined);
});

for (const scenario of ['older', 'equal', 'newer', 'missing', 'error'] as const) {
    test(`${scenario} local data during a pending save preserves the winning location and save identity`, async t => {
        const save = deferred<GeoSaveResult>(), f = fixture(t);
        f.cleanup.push(() => save.resolve({ status: 'failed', message: 'fixture released' }));
        t.mock.method(f.geo, 'save', () => save.promise);
        f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce(); await f.peers.resolveGeo('8.8.8.8', 'ipv4');
        const pending = f.peers.persistGeo('8.8.8.8'), observation = f.peers.geoCache.get('8.8.8.8')?.pendingSave;
        const timestamp = scenario === 'older' ? now - 1 : scenario === 'newer' ? now + 1 : now;
        if (scenario !== 'missing' && scenario !== 'error') f.rows.set('8.8.8.8', row('Imported', timestamp));
        if (scenario === 'error') t.mock.method(f.geo, 'read', (): GeoReadResult => ({ status: 'error', message: 'local read failed' }));
        f.geo.datasetChanged(); await f.peers.refreshOnce();
        assert.equal(f.peers.cachedGeo('8.8.8.8')?.city, scenario === 'equal' || scenario === 'newer' ? 'Imported' : 'API');
        assert.equal(f.peers.geoCache.get('8.8.8.8')?.source, scenario === 'equal' || scenario === 'newer' ? 'dataset' : 'ip_api');
        assert.equal(f.peers.geoCache.get('8.8.8.8')?.pendingSave, observation);
        assert.equal(f.connectivity.apiConsecutiveFailures, 0);
        save.resolve({ status: 'superseded', row: row(scenario === 'equal' ? 'Imported' : 'Stored', now, scenario === 'equal' ? 'dataset' : 'ip_api') }); await pending;
        assert.equal(f.peers.cachedGeo('8.8.8.8')?.city, scenario === 'newer' || scenario === 'equal' ? 'Imported' : 'Stored');
        assert.equal(f.peers.geoCache.get('8.8.8.8')?.source, scenario === 'newer' || scenario === 'equal' ? 'dataset' : 'ip_api');
        assert.equal(f.peers.geoCache.get('8.8.8.8')?.pendingSave, undefined);
    });
}

test('a fresh import suppresses an obsolete queued lookup and consumes no provider spacing', async t => {
    let calls = 0;
    const f = fixture(t, async () => { calls++; return response(); });
    f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2)]; await f.peers.refreshOnce();
    f.rows.set('8.8.8.8', row('Imported'));
    assert.equal(await f.peers.resolveGeo('8.8.8.8', 'ipv4'), false);
    assert.equal(await f.peers.resolveGeo('1.1.1.1', 'ipv4'), true);
    assert.equal(calls, 1); assert.equal(f.peers.listPeers()[0].location, 'Imported, NZ');
});

test('a failed provider lookup re-reads an import committed while the request was pending', async t => {
    const gate = deferred<Response>(), f = fixture(t, () => gate.promise);
    f.cleanup.push(() => gate.resolve(Response.json({ status: 'fail' })));
    f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce();
    const pending = f.peers.resolveGeo('8.8.8.8', 'ipv4'); await flush();
    f.rows.set('8.8.8.8', row('Imported')); gate.resolve(Response.json({ status: 'fail', message: 'no location' })); await pending;
    assert.equal(f.peers.listPeers()[0].location, 'Imported, NZ');
    assert.equal(f.peers.geoCache.get('8.8.8.8')?.refreshRetryAt, null);
});

test('a departed provider job cannot repopulate a reconnected host or clear its replacement marker', async t => {
    const old = deferred<Response>(); let calls = 0, signal: AbortSignal | undefined;
    const f = fixture(t, (_url, options) => { signal = options?.signal ?? undefined; return ++calls === 1 ? old.promise : Promise.resolve(response('Replacement')); });
    f.cleanup.push(() => old.resolve(response('Departed')));
    f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2)]; await f.peers.refreshOnce();
    const pending = f.peers.resolveGeo('8.8.8.8', 'ipv4'); await flush();
    f.rpc.values.getpeerinfo = []; await f.peers.refreshOnce();
    assert.equal(signal?.aborted, true); assert.deepEqual(f.peers.geoQueue, []); assert.equal(f.peers.pending.size, 0);
    f.rpc.values.getpeerinfo = [peer('8.8.8.8', 3)]; await f.peers.refreshOnce();
    assert.equal(await f.peers.resolveGeo('8.8.8.8', 'ipv4'), false, 'replacement waits while cancellation settles');
    old.resolve(response('Departed')); await pending;
    assert.equal(f.peers.cachedGeo('8.8.8.8'), null);
    assert.equal(f.peers.pending.has('8.8.8.8'), true, 'old completion cannot clear replacement deduplication');
    await f.advance(GEO_PROVIDER_SPACING_MS); await f.peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(f.peers.cachedGeo('8.8.8.8')?.city, 'Replacement');
    assert.equal(f.connectivity.apiConsecutiveFailures, 0);
});

test('a departed save cannot overwrite a replacement location or remove its queued save', async t => {
    const old = deferred<GeoSaveResult>(); let calls = 0, saves = 0, signal: AbortSignal | undefined;
    const f = fixture(t, async () => response(`API ${++calls}`));
    f.cleanup.push(() => old.resolve({ status: 'saved', row: row('Departed', now, 'ip_api') }));
    t.mock.method(f.geo, 'save', async (_host: string, _data: Data, timestamp?: number, cancellation?: AbortSignal): Promise<GeoSaveResult> => {
        signal = cancellation;
        return ++saves === 1 ? old.promise : { status: 'saved', row: row('API 2', timestamp, 'ip_api') };
    });
    f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce(); await f.peers.resolveGeo('8.8.8.8', 'ipv4');
    const pending = f.peers.persistGeo('8.8.8.8'); await flush();
    f.rpc.values.getpeerinfo = []; await f.peers.refreshOnce(); assert.equal(signal?.aborted, true);
    f.rpc.values.getpeerinfo = [peer('8.8.8.8', 2)]; await f.peers.refreshOnce(); await f.advance(GEO_PROVIDER_SPACING_MS);
    await f.peers.resolveGeo('8.8.8.8', 'ipv4');
    const replacement = f.peers.geoCache.get('8.8.8.8')?.pendingSave;
    old.resolve({ status: 'saved', row: row('Departed', now + 100, 'ip_api') }); await pending;
    assert.equal(f.peers.cachedGeo('8.8.8.8')?.city, 'API 2');
    assert.equal(f.peers.geoCache.get('8.8.8.8')?.pendingSave, replacement);
    assert.deepEqual(f.peers.saveQueue, ['8.8.8.8']);
    await f.peers.persistGeo('8.8.8.8'); assert.equal(saves, 2);
});

test('provider cancellation invalidates old results while local hydration continues', async t => {
    const gate = deferred<Response>(); let signal: AbortSignal | undefined;
    const f = fixture(t, (_url, options) => { signal = options?.signal ?? undefined; return gate.promise; });
    f.cleanup.push(() => gate.resolve(response('Cancelled')));
    f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce();
    const pending = f.peers.resolveGeo('8.8.8.8', 'ipv4'); await flush(); f.peers.cancelProviderWork();
    assert.equal(signal?.aborted, true); assert.equal(f.peers.pending.size, 0);
    f.connectivity.setGeoipApiDisabled(true);
    f.rows.set('1.1.1.1', row('Local')); f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2)];
    await f.peers.refreshOnce(); assert.equal(f.peers.listPeers()[1].location, 'Local, NZ');
    gate.resolve(response('Cancelled')); await pending;
    assert.equal(f.peers.cachedGeo('8.8.8.8'), null); assert.equal(f.connectivity.apiConsecutiveFailures, 0);
});

test('large unique-host hydration yields to handlers and queues stay bounded by active hosts', async t => {
    const f = fixture(t), count = GEO_HYDRATION_BATCH_SIZE * 3 + 1;
    f.rpc.values.getpeerinfo = Array.from({ length: count * 2 }, (_, index) => peer(`8.8.8.${index % count + 1}`, index));
    let handledAfterReads = -1;
    const handler = setImmediate().then(() => { handledAfterReads = f.reads.length; });
    await f.peers.refreshOnce(); await handler;
    assert.ok(handledAfterReads >= 0 && handledAfterReads <= GEO_HYDRATION_BATCH_SIZE, 'a handler runs before the whole synchronous read batch');
    assert.equal(f.reads.length, count); assert.equal(f.peers.geoQueue.length, count); assert.equal(f.peers.pending.size, count);
    await f.peers.refreshOnce(); assert.equal(f.reads.length, count, 'unexpired misses are not re-read for duplicate connections');
    f.rpc.values.getpeerinfo = [peer('8.8.8.1')]; await f.peers.refreshOnce();
    assert.deepEqual(f.peers.geoQueue, [['8.8.8.1', 'ipv4']]); assert.equal(f.peers.pending.size, 1);
});

test('local read failures retain locations and differ from confirmed misses without a provider outage', async t => {
    let calls = 0;
    const f = fixture(t, async () => { calls++; return response(); });
    f.rows.set('8.8.8.8', row('Retained')); f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce();
    const read = t.mock.method(f.geo, 'read', (): GeoReadResult => ({ status: 'error', message: 'busy read' }));
    f.geo.datasetChanged(); f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2)]; await f.peers.refreshOnce();
    assert.equal(f.peers.listPeers()[0].location, 'Retained, NZ'); assert.deepEqual(f.peers.geoQueue, []);
    assert.equal(f.peers.cachedGeo('1.1.1.1'), null); assert.equal(calls, 0); assert.equal(f.connectivity.apiConsecutiveFailures, 0);
    read.mock.restore(); await f.advance(60_000); await f.peers.refreshOnce();
    assert.deepEqual(f.peers.geoQueue, [['1.1.1.1', 'ipv4']]);
});

test('read distinguishes disabled, missing, corrupt, and stored data while get keeps its row/null contract', async t => {
    const disabled = new GeoDatabase(temporaryDirectory(t), false); t.after(() => disabled.close());
    assert.deepEqual(disabled.read('8.8.8.8'), { status: 'disabled' }); assert.equal(disabled.get('8.8.8.8'), null);
    const geo = new GeoDatabase(temporaryDirectory(t), true); t.after(() => geo.close());
    assert.deepEqual(geo.read('8.8.8.8'), { status: 'miss' });
    writeFileSync(geo.path, 'not sqlite'); assert.equal(geo.read('8.8.8.8').status, 'error'); assert.equal(geo.get('8.8.8.8'), null);
    const hit = new GeoDatabase(temporaryDirectory(t), true); hit.initialize(); t.after(() => hit.close());
    await hit.save('8.8.8.8', row('Saved'), now); assert.equal(hit.read('8.8.8.8').status, 'hit'); assert.equal(hit.get('8.8.8.8')?.city, 'Saved');
});

test('concurrent starts share startup before its first RPC await and create only one worker set', async t => {
    const gate = deferred<unknown[]>(), f = fixture(t);
    f.cleanup.push(() => gate.resolve([]));
    f.rpc.values.getnodeaddresses = () => gate.promise;
    f.rpc.values.getpeerinfo = [peer('8.8.8.8')];
    const first = f.peers.start(), second = f.peers.start();
    assert.equal(first, second); assert.equal(f.rpc.count('getnodeaddresses'), 1);
    gate.resolve([]); await Promise.all([first, second]); await flush();
    assert.equal(f.rpc.count('getpeerinfo'), 1); assert.equal(f.peers.geoQueue.length, 1);
});

test('shutdown joins pending RPC startup and ignores its late metadata', async t => {
    const gate = deferred<unknown[]>(), f = fixture(t);
    f.cleanup.push(() => gate.resolve([])); f.rpc.values.getnodeaddresses = () => gate.promise;
    const started = f.peers.start(); let stopped = false;
    const stopping = f.peers.stop().then(() => { stopped = true; }); await flush(); assert.equal(stopped, false);
    gate.resolve([{ address: '8.8.8.8', port: 8333 }]); await started; await stopping;
    assert.equal(f.rpc.count('getpeerinfo'), 0); assert.equal(f.peers.knownAddresses.size, 0); assert.equal(f.peers.geoQueue.length, 0);
});

test('shutdown joins a pending peer RPC and cannot publish a late snapshot', async t => {
    const gate = deferred<unknown[]>(), f = fixture(t);
    f.cleanup.push(() => gate.resolve([])); f.rpc.values.getpeerinfo = () => gate.promise;
    const refreshing = f.peers.refreshOnce(); let stopped = false;
    const stopping = f.peers.stop().then(() => { stopped = true; }); await flush(); assert.equal(stopped, false);
    gate.resolve([peer('8.8.8.8')]); assert.equal(await refreshing, false); await stopping;
    assert.equal(f.peers.lastSuccessAt, null); assert.deepEqual(f.peers.listPeers(), []); assert.equal(f.peers.geoCache.size, 0);
});

test('shutdown joins a late provider completion without repopulating cache or reporting an outage', async t => {
    const gate = deferred<Response>(); let signal: AbortSignal | undefined;
    const f = fixture(t, (_url, options) => { signal = options?.signal ?? undefined; return gate.promise; });
    f.cleanup.push(() => gate.resolve(response('Late'))); f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce();
    const pending = f.peers.resolveGeo('8.8.8.8', 'ipv4'); let stopped = false;
    const stopping = f.peers.stop().then(() => { stopped = true; }); await flush();
    assert.equal(signal?.aborted, true); assert.equal(stopped, false);
    gate.resolve(response('Late')); await pending; await stopping;
    assert.equal(f.peers.geoCache.size, 0); assert.equal(f.peers.saveQueue.length, 0); assert.equal(f.connectivity.apiConsecutiveFailures, 0);
});

test('a save committed immediately before cancellation may remain on disk but cannot revive active cache', async t => {
    const gate = deferred<GeoSaveResult>(), f = fixture(t), originalSave = f.geo.save.bind(f.geo);
    f.cleanup.push(() => gate.resolve({ status: 'cancelled' }));
    t.mock.method(f.geo, 'save', async (host: string, data: Data, timestamp?: number, signal?: AbortSignal) => {
        const result = await originalSave(host, data, timestamp, signal);
        assert.equal(result.status, 'saved'); await gate.promise; return result;
    });
    f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce(); await f.peers.resolveGeo('8.8.8.8', 'ipv4');
    const pending = f.peers.persistGeo('8.8.8.8'); await flush(); let stopped = false;
    const stopping = f.peers.stop().then(() => { stopped = true; }); await flush(); assert.equal(stopped, false);
    gate.resolve({ status: 'cancelled' }); await pending; await stopping;
    assert.equal(f.peers.geoCache.size, 0); assert.equal(f.peers.saveQueue.length, 0);
    const disk = new DatabaseSync(f.geo.path);
    try { assert.equal(disk.prepare('SELECT city FROM geo_cache WHERE ip = ?').get('8.8.8.8')?.city, 'API'); }
    finally { disk.close(); }
});

test('independent service instances do not share queues or deduplication', async t => {
    const f = fixture(t), other = new PeerService(f.rpc, f.geo, f.connectivity); t.after(() => other.stop());
    f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce(); await other.refreshOnce();
    f.peers.cancelProviderWork(); assert.equal(f.peers.pending.size, 0); assert.equal(other.pending.size, 1);
    assert.deepEqual(other.geoQueue, [['8.8.8.8', 'ipv4']]);
});

test('failed provider attempts reserve spacing from completion and never overlap the next request', async t => {
    const gate = deferred<Response>(); let calls = 0;
    const f = fixture(t, () => ++calls === 1 ? gate.promise : Promise.resolve(response('Next')));
    f.cleanup.push(() => gate.resolve(new Response(null, { status: 503 })));
    f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2)]; await f.peers.refreshOnce();
    const first = f.peers.resolveGeo('8.8.8.8', 'ipv4'); await f.advance(5000);
    assert.equal(await f.peers.resolveGeo('1.1.1.1', 'ipv4'), false); assert.equal(calls, 1);
    gate.resolve(new Response(null, { status: 503 })); await first;
    const second = f.peers.resolveGeo('1.1.1.1', 'ipv4'); await f.advance(GEO_PROVIDER_SPACING_MS - 1); assert.equal(calls, 1);
    await f.advance(1); await second; assert.equal(calls, 2); assert.equal(f.peers.listPeers()[1].location, 'Next, NZ');
});

for (const policy of ['database-only', 'quota', 'import'] as const) {
    test(`${policy} is rechecked after provider spacing and suppresses obsolete queued dispatch`, async t => {
        let calls = 0;
        const f = fixture(t, async () => { calls++; return response(); });
        f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2)]; await f.peers.refreshOnce();
        await f.peers.resolveGeo('8.8.8.8', 'ipv4');
        const second = f.peers.resolveGeo('1.1.1.1', 'ipv4'); await flush();
        if (policy === 'database-only') f.connectivity.setGeoipApiDisabled(true);
        else if (policy === 'quota') f.connectivity.providerFailure('geoip', new Error('quota'), new Response(null, { status: 429, headers: { 'Retry-After': '120', 'X-Rl': '0', 'X-Ttl': '180' } }));
        else f.rows.set('1.1.1.1', row('Imported'));
        await f.advance(GEO_PROVIDER_SPACING_MS); assert.equal(await second, false); assert.equal(calls, 1);
        if (policy === 'import') assert.equal(f.peers.listPeers()[1].location, 'Imported, NZ');
        if (policy === 'quota') assert.equal(f.connectivity.snapshot().providers.geoip.retry_at, now + 180);
    });
}

test('the provider retains its ten-second timeout and a timeout is an attempted request', async t => {
    const timeout = new AbortController(); let calls = 0;
    const f = fixture(t, async (_url, options) => {
        if (++calls > 1) return response('Recovered');
        await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true }));
        return response();
    });
    f.cleanup.push(() => timeout.abort());
    const timeouts: number[] = [];
    t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { timeouts.push(milliseconds); return timeout.signal; });
    f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2)]; await f.peers.refreshOnce();
    const first = f.peers.resolveGeo('8.8.8.8', 'ipv4'); await flush(); assert.deepEqual(timeouts, [10_000]);
    await f.advance(10_000); timeout.abort(); await first; assert.equal(f.connectivity.apiConsecutiveFailures, 1);
    const second = f.peers.resolveGeo('1.1.1.1', 'ipv4'); await f.advance(GEO_PROVIDER_SPACING_MS - 1); assert.equal(calls, 1);
    await f.advance(1); await second; assert.equal(calls, 2); assert.equal(f.connectivity.apiConsecutiveFailures, 0);
});

test('private, reserved, overlay and non-IP hosts cannot reach the provider even through direct dispatch', async t => {
    const f = fixture(t, async () => assert.fail('ineligible address was disclosed'));
    const samples = [['10.0.0.1', 'ipv4'], ['192.0.2.1', 'ipv4'], ['2001:db8::1', 'ipv6'], ['abcdef.onion', 'onion'], ['abcdef.b32.i2p', 'i2p'], ['fc00::1', 'cjdns'], ['example.org', 'ipv4']] as const;
    f.rpc.values.getpeerinfo = samples.map(([host, network], id) => ({ id, addr: host.includes(':') ? `[${host}]:8333` : `${host}:8333`, network }));
    await f.peers.refreshOnce(); assert.equal(f.reads.length, 0); assert.deepEqual(f.peers.geoQueue, []);
    for (const [host, network] of samples) assert.equal(await f.peers.resolveGeo(host, network), false);
});

test('a public-to-private host transition invalidates owned work and retains private metadata', async t => {
    const gate = deferred<Response>(), f = fixture(t, () => gate.promise);
    f.cleanup.push(() => gate.resolve(response('Late')));
    f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce(); const pending = f.peers.resolveGeo('8.8.8.8', 'ipv4');
    f.rpc.values.getpeerinfo = [{ ...peer('8.8.8.8'), network: 'onion' }]; await f.peers.refreshOnce();
    gate.resolve(response('Late')); await pending;
    assert.equal(f.peers.listPeers()[0].location_status, 'private'); assert.equal(f.peers.listPeers()[0].geo.source, null);
    assert.deepEqual(f.peers.saveQueue, []);
});

test('provider cancellation preserves an independent pending save and its original timestamp', async t => {
    const gate = deferred<Response>(); let calls = 0;
    const f = fixture(t, () => ++calls === 1 ? Promise.resolve(response('Save me')) : gate.promise);
    f.cleanup.push(() => gate.resolve(response('Cancelled')));
    f.rpc.values.getpeerinfo = [peer('8.8.8.8'), peer('1.1.1.1', 2)]; await f.peers.refreshOnce();
    await f.peers.resolveGeo('8.8.8.8', 'ipv4'); await f.advance(GEO_PROVIDER_SPACING_MS);
    const pending = f.peers.resolveGeo('1.1.1.1', 'ipv4'); await flush();
    f.peers.cancelProviderWork(); f.connectivity.setGeoipApiDisabled(true);
    await f.peers.persistGeo('8.8.8.8');
    assert.equal(f.peers.geoCache.get('8.8.8.8')?.pendingSave, undefined);
    const disk = new DatabaseSync(f.geo.path);
    try { assert.equal(disk.prepare('SELECT last_updated FROM geo_cache WHERE ip = ?').get('8.8.8.8')?.last_updated, now); }
    finally { disk.close(); }
    gate.resolve(response('Cancelled')); await pending; assert.equal(f.peers.cachedGeo('1.1.1.1'), null);
});

test('an injected lookup receives the owned cancellation signal and preserves result validation', async t => {
    const f = fixture(t, async () => assert.fail('legacy fallback called'));
    const gate = deferred<Data | null>(); let signal: AbortSignal | undefined;
    const peers = new PeerService(f.rpc, f.geo, f.connectivity, undefined, f.peers.fetcher, (_host, cancellation) => { signal = cancellation; return gate.promise; });
    t.after(() => peers.stop()); f.cleanup.push(() => gate.resolve(null));
    f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await peers.refreshOnce(); const pending = peers.resolveGeo('8.8.8.8', 'ipv4'); await flush();
    peers.cancelProviderWork(); assert.equal(signal?.aborted, true); gate.resolve(row('Late')); await pending;
    assert.equal(peers.cachedGeo('8.8.8.8'), null); assert.equal(peers.saveQueue.length, 0);
    const invalid = new PeerService(f.rpc, f.geo, f.connectivity, undefined, f.peers.fetcher, async () => ({ country: 'NZ', lat: 999, lon: 0 }));
    t.after(() => invalid.stop()); await invalid.refreshOnce(); await invalid.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(invalid.listPeers()[0].location_status, 'unavailable'); assert.deepEqual(invalid.saveQueue, []);
});

for (const enabled of [false, true]) {
    test(`database-only mode with a ${enabled ? 'missing' : 'disabled'} database never dispatches a provider request`, async t => {
        const f = fixture(t, async () => assert.fail('database-only peer disclosed'));
        const geo = new GeoDatabase(temporaryDirectory(t), enabled), peers = new PeerService(f.rpc, geo, f.connectivity, undefined, f.peers.fetcher);
        t.after(async () => { await peers.stop(); geo.close(); });
        f.connectivity.setGeoipApiDisabled(true); f.rpc.values.getpeerinfo = [peer('8.8.8.8')];
        await peers.refreshOnce(); assert.equal(await peers.resolveGeo('8.8.8.8', 'ipv4'), false);
        assert.equal(peers.listPeers()[0].location_status, 'unavailable'); assert.deepEqual(peers.saveQueue, []);
    });
}

for (const method of ['getpeerinfo', 'getnodeaddresses']) {
    test(`shutdown passes owned cancellation to an active ${method} RPC`, async t => {
        const f = fixture(t); let signal: AbortSignal | undefined;
        t.mock.method(f.rpc, 'call', async (_method: string, _params?: unknown[], _timeout?: number, cancellation?: AbortSignal) => {
            assert.equal(_method, method); signal = cancellation;
            return new Promise((_resolve, reject) => cancellation?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
        });
        const pending = method === 'getpeerinfo' ? f.peers.refreshOnce() : f.peers.refreshKnownAddresses(); await flush();
        assert.equal(signal?.aborted, false); await f.peers.stop(); await pending;
        assert.equal(signal?.aborted, true); assert.equal(f.peers.lastError, null); assert.equal(f.peers.geoCache.size, 0);
    });
}

for (const timestamp of [null, 0]) {
    test(`equal zero-time provider saves preserve a legacy ${timestamp} timestamp winner and unknown provenance`, async t => {
        const f = fixture(t); t.mock.method(Date, 'now', () => 0);
        const legacy = row('Legacy', timestamp); delete (legacy as Data).geo_source;
        f.rows.set('8.8.8.8', legacy);
        const writer = new DatabaseSync(f.geo.path);
        writer.prepare('INSERT INTO geo_cache (ip, country, city, lat, lon, last_updated) VALUES (?, ?, ?, ?, ?, ?)')
            .run('8.8.8.8', 'NZ', 'Legacy', 1, 2, timestamp); writer.close();
        f.rpc.values.getpeerinfo = [peer('8.8.8.8')]; await f.peers.refreshOnce(); await f.peers.resolveGeo('8.8.8.8', 'ipv4');
        assert.equal(f.peers.geoCache.get('8.8.8.8')?.pendingSave?.observedAt, 0);
        assert.equal(f.peers.listPeers()[0].location, 'Legacy, NZ');
        await f.peers.persistGeo('8.8.8.8');
        assert.equal(f.peers.geoCache.get('8.8.8.8')?.source, 'unknown');
        assert.equal(f.peers.geoCache.get('8.8.8.8')?.observedAt, timestamp);
        assert.equal(f.peers.listPeers()[0].geo.freshness, 'unknown');
        assert.equal(f.peers.geoCache.get('8.8.8.8')?.pendingSave, undefined);
        await f.peers.refreshOnce(); assert.deepEqual(f.peers.geoQueue, []);
    });
}
