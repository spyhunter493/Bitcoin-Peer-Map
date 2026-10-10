import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { DatabaseSync, type FunctionOptions, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { OutboundPolicy } from '../../src/server/outbound-policy.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { GeoDatabase, isValidGeoData } from '../../src/server/services/geoip.ts';
import { GEO_COLUMNS, GEO_SCHEMA } from '../../src/server/services/geoip-schema.ts';
import { MAX_GEOIP_RESPONSE_BYTES, MAX_GEOIP_STRING_BYTES } from '../../src/server/services/geoip-limits.ts';
import { readGeoipJson } from '../../src/server/services/geoip-response.ts';
import { createGeoipLookup } from '../../src/server/services/geoip-provider.ts';
import { PeerService } from '../../src/server/services/peers.ts';
import { normalizeDatasetRow } from '../../src/server/services/geoip-validation.ts';
import type { Data } from '../../src/server/types.ts';
import { FakeRpc, flush, temporaryDirectory } from './helpers.ts';

const allow = { geoip: true, dataset: true, updates: true, probe: true };
const location = { status: 'success', country: 'NZ', lat: 1, lon: 2 };
const signal = () => new AbortController().signal;
function bodyAt(bytes: number) {
    const json = JSON.stringify(location);
    return json + ' '.repeat(bytes - Buffer.byteLength(json));
}
type SqliteEncoding = 'UTF-16le' | 'UTF-16be';
function database(t: TestContext, encoding?: SqliteEncoding) {
    const dir = temporaryDirectory(t), geo = new GeoDatabase(dir, true);
    if (encoding) {
        const db = new DatabaseSync(geo.path);
        db.exec(`PRAGMA encoding = '${encoding}'`); db.exec(GEO_SCHEMA);
        assert.equal(db.prepare('PRAGMA encoding').get()?.encoding, encoding);
        db.close();
    }
    geo.initialize(); t.after(() => geo.close()); return { dir, geo };
}
function service(t: TestContext, fetcher: typeof fetch, mode: 'provider' | 'fallback' = 'provider') {
    const { geo } = database(t), policy = new OutboundPolicy(allow);
    const rpc = new FakeRpc(), connectivity = new ConnectivityService(false, undefined, fetcher, policy);
    const lookup = mode === 'provider' ? createGeoipLookup(connectivity, policy, fetcher) : undefined;
    const peers = new PeerService(rpc, geo, connectivity, undefined, fetcher, lookup);
    t.after(async () => { policy.close(); await peers.stop(); await connectivity.stop(); });
    t.mock.method(console, 'warn', () => {});
    return { geo, policy, rpc, connectivity, peers, lookup: (ownedSignal = signal()) => peers.fetchGeo('8.8.8.8', ownedSignal) };
}
function storedOversized(geo: GeoDatabase, field = 'city', value = 'x'.repeat(MAX_GEOIP_STRING_BYTES + 1)) {
    assert.ok(GEO_COLUMNS.includes(field));
    const db = new DatabaseSync(geo.path);
    db.prepare('INSERT INTO geo_cache (ip, country, lat, lon, last_updated) VALUES (?, ?, ?, ?, ?)')
        .run('8.8.8.8', 'NZ', 1, 2, 4_000_000_000);
    db.prepare(`UPDATE geo_cache SET "${field}" = ? WHERE ip = ?`).run(value, '8.8.8.8');
    db.prepare('INSERT INTO geo_provenance (ip, source, observed_at) VALUES (?, ?, ?)').run('8.8.8.8', 'dataset', 4_000_000_000);
    db.close();
}
function dataset(path: string, rows: Data[], encoding?: SqliteEncoding) {
    const db = new DatabaseSync(path);
    if (encoding) db.exec(`PRAGMA encoding = '${encoding}'`);
    db.exec(GEO_SCHEMA);
    const insert = db.prepare(`INSERT INTO geo_cache VALUES (${GEO_COLUMNS.map(() => '?').join(',')})`);
    for (const row of rows) insert.run(...GEO_COLUMNS.map(key => row[key] ?? null) as SQLInputValue[]);
    db.close();
    return async () => new Response(readFileSync(path));
}
function observeBoundedSqlResults(t: TestContext) {
    const prepare = DatabaseSync.prototype.prepare;
    let observed = 0;
    t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
        const statement = prepare.call(this, sql), get = statement.get;
        t.mock.method(statement, 'get', function (this: typeof statement, ...parameters: Parameters<typeof get>) {
            const row = get.apply(this, parameters);
            observed++;
            if (row) for (const value of Object.values(row)) assert.ok(typeof value !== 'string' || Buffer.byteLength(value) <= MAX_GEOIP_STRING_BYTES);
            return row;
        });
        return statement;
    });
    return () => observed;
}

test('streamed GeoIP JSON accepts exactly 65,536 decoded bytes and ignores an inaccurate Content-Length', async () => {
    const response = new Response(bodyAt(MAX_GEOIP_RESPONSE_BYTES), { headers: { 'Content-Length': '1' } });
    assert.deepEqual(await readGeoipJson(response, signal()), location);
    assert.equal(response.body?.locked, false);
});

test('streamed GeoIP JSON cancels a chunked response crossing the limit without reading the remaining payload', async () => {
    let cancelled = 0, pulls = 0;
    const bytes = new TextEncoder().encode(bodyAt(MAX_GEOIP_RESPONSE_BYTES + 1));
    const response = new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
            pulls++;
            if (pulls === 1) controller.enqueue(bytes.slice(0, MAX_GEOIP_RESPONSE_BYTES));
            else if (pulls === 2) controller.enqueue(bytes.slice(MAX_GEOIP_RESPONSE_BYTES));
            else assert.fail('reader consumed data after the limit');
        },
        cancel() { cancelled++; },
    }, { highWaterMark: 0 }), { headers: { 'Content-Length': '1' } });
    await assert.rejects(readGeoipJson(response, signal()), /size|limit|large/i);
    assert.equal(cancelled, 1); assert.equal(pulls, 2); assert.equal(response.body?.locked, false);
});

test('the response byte limit counts UTF-8 rather than JavaScript characters', async () => {
    const prefix = JSON.stringify({ ...location, extra: 'é' });
    const exact = prefix + ' '.repeat(MAX_GEOIP_RESPONSE_BYTES - Buffer.byteLength(prefix));
    assert.deepEqual(await readGeoipJson(new Response(exact), signal()), { ...location, extra: 'é' });
    await assert.rejects(readGeoipJson(new Response(exact + ' '), signal()), /size|limit|large/i);
});

test('malformed, empty, and absent JSON response bodies fail without retaining stream locks', async () => {
    for (const response of [new Response('{"country":'), new Response(''), new Response(null)]) {
        await assert.rejects(readGeoipJson(response, signal()));
        assert.equal(response.body?.locked ?? false, false);
    }
});

test('owner cancellation interrupts a stalled GeoIP stream and cancels its reader', async () => {
    const owner = new AbortController(); let cancelled = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('{')); },
        cancel() { cancelled++; },
    }));
    const pending = readGeoipJson(response, owner.signal);
    await flush(); owner.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(cancelled, 1); assert.equal(response.body?.locked, false);
});

test('an already cancelled reader releases the unread GeoIP response body', async () => {
    const owner = new AbortController(); owner.abort(); let cancelled = 0;
    const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }));
    await assert.rejects(readGeoipJson(response, owner.signal), { name: 'AbortError' });
    assert.equal(cancelled, 1); assert.equal(response.body?.locked, false);
});

for (const mode of ['provider', 'fallback'] as const) {
    test(`${mode} lookup accepts an exact response limit and rejects one decoded byte over`, async t => {
        let calls = 0;
        const { lookup, connectivity } = service(t, async () => new Response(bodyAt(MAX_GEOIP_RESPONSE_BYTES + calls++)), mode);
        assert.deepEqual(await lookup(), location);
        assert.equal(await lookup(), null);
        const health = connectivity.snapshot().providers.geoip;
        assert.equal(health.consecutive_failures, 1); assert.equal(health.state, 'unavailable');
        assert.ok(health.last_success_at); assert.ok(health.last_error);
    });

    test(`${mode} lookup enforces UTF-8 field limits for success and provider miss records`, async t => {
        const responses = [
            { ...location, city: 'é'.repeat(MAX_GEOIP_STRING_BYTES / 2) },
            { ...location, city: 'é'.repeat(MAX_GEOIP_STRING_BYTES / 2) + 'x' },
            { ...location, unused: 'x'.repeat(MAX_GEOIP_STRING_BYTES + 1) },
            { status: 'fail', message: 'SECRET-SENTINEL'.repeat(400) },
        ];
        let calls = 0;
        const { lookup, connectivity } = service(t, async () => Response.json(responses[calls++]), mode);
        assert.deepEqual(await lookup(), responses[0]);
        for (let index = 1; index < responses.length; index++) assert.equal(await lookup(), null);
        assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 3);
        assert.equal(connectivity.snapshot().providers.geoip.last_error?.includes('SECRET-SENTINEL'), false);
    });

    test(`${mode} lookup records sanitized malformed, empty and absent response failures`, async t => {
        const responses = [new Response('SECRET-SENTINEL{'), new Response(''), new Response(null)];
        const { lookup, connectivity } = service(t, async () => responses.shift()!, mode);
        for (let index = 0; index < 3; index++) assert.equal(await lookup(), null);
        assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 3);
        assert.equal(connectivity.snapshot().providers.geoip.last_error?.includes('SECRET-SENTINEL'), false);
    });

    test(`${mode} lookup timeout cancels a stalled body and reports a provider failure`, async t => {
        const timeout = new AbortController(); let cancelled = 0;
        t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
        const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }));
        const { lookup, connectivity } = service(t, async () => response, mode);
        const pending = lookup(); await flush();
        timeout.abort(new DOMException('SECRET-SENTINEL', 'TimeoutError'));
        assert.equal(await pending, null); assert.equal(cancelled, 1); assert.equal(response.body?.locked, false);
        assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 1);
        assert.equal(connectivity.snapshot().providers.geoip.last_error?.includes('SECRET-SENTINEL'), false);
    });

    test(`${mode} lookup owner cancellation cancels its body without recording a provider failure`, async t => {
        const owner = new AbortController(); let cancelled = 0;
        const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }));
        const { lookup, connectivity } = service(t, async () => response, mode);
        const pending = lookup(owner.signal); await flush(); owner.abort();
        assert.equal(await pending, null); assert.equal(cancelled, 1); assert.equal(response.body?.locked, false);
        assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 0);
        assert.equal(connectivity.snapshot().providers.geoip.last_success_at, null);
    });

    for (const encoding of ['chunked', 'gzip'] as const) {
        test(`${mode} lookup bounds actual ${encoding} HTTP responses by decoded bytes`, async t => {
            let requests = 0;
            const server = createServer((_request, response) => {
                const payload = bodyAt(MAX_GEOIP_RESPONSE_BYTES + requests++);
                if (encoding === 'gzip') {
                    const compressed = gzipSync(payload);
                    response.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'application/json', 'Content-Length': compressed.length });
                    response.end(compressed);
                } else {
                    response.writeHead(200, { 'Transfer-Encoding': 'chunked', 'Content-Type': 'application/json' });
                    response.write(payload.slice(0, 37)); response.end(payload.slice(37));
                }
            });
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            t.after(() => new Promise<void>((resolve, reject) => {
                server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
            }));
            const address = server.address(); assert.ok(address && typeof address !== 'string');
            const { lookup, connectivity } = service(t, async (_url, options) => {
                const response = await fetch(`http://127.0.0.1:${address.port}/geo`, options);
                if (encoding === 'gzip') assert.ok(Number(response.headers.get('Content-Length')) < MAX_GEOIP_RESPONSE_BYTES);
                else assert.equal(response.headers.get('Content-Length'), null);
                return response;
            }, mode);
            assert.deepEqual(await lookup(), location); assert.equal(await lookup(), null);
            assert.equal(requests, 2); assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 1);
        });
    }

    test(`${mode} rejected provider metadata never enters cache or SQLite and retains an older valid location`, async t => {
        const { rpc, geo, peers, connectivity } = service(t, async () => Response.json({ ...location, city: 'x'.repeat(MAX_GEOIP_STRING_BYTES + 1) }), mode);
        await geo.save('8.8.8.8', { ...location, city: 'Keep' }, 100);
        rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }, { id: 2, addr: '1.1.1.1:8333', network: 'ipv4' }];
        await peers.refreshOnce(); await peers.resolveGeo('8.8.8.8', 'ipv4');
        await peers.persistGeo('8.8.8.8');
        assert.equal(peers.listPeers()[0].location, 'Keep, NZ');
        assert.equal(peers.listPeers()[0].geo.freshness, 'stale');
        assert.equal(geo.get('8.8.8.8')?.city, 'Keep'); assert.equal(geo.get('8.8.8.8')?.last_updated, 100);
        // Resolve the second host without waiting for the real provider spacing timer.
        t.mock.method(performance, 'now', () => Number.MAX_SAFE_INTEGER);
        await peers.resolveGeo('1.1.1.1', 'ipv4'); await peers.persistGeo('1.1.1.1');
        assert.equal(peers.listPeers()[1].location_status, 'unavailable');
        assert.equal(peers.listPeers()[1].geo.freshness, 'unavailable');
        assert.equal(geo.get('1.1.1.1'), null); assert.equal(peers.saveQueue.length, 0);
        assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 2);
        assert.ok([...peers.geoCache.values()].every(entry => Object.values(entry.data).every(value => typeof value !== 'string' || Buffer.byteLength(value) <= MAX_GEOIP_STRING_BYTES)));
    });
}

test('disabling provider policy cancels an in-progress reader without recording failures', async t => {
    let cancelled = 0;
    const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }));
    const { policy, connectivity, lookup } = service(t, async () => response);
    const pending = lookup(); await flush(); policy.update({ ...allow, geoip: false });
    assert.equal(await pending, null); assert.equal(cancelled, 1); assert.equal(response.body?.locked, false);
    assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 0);
    assert.equal(connectivity.snapshot().providers.geoip.state, 'disabled');
});

test('all top-level provider string fields are bounded before coordinate conversion or trimming', async t => {
    const { geo } = database(t);
    assert.equal(isValidGeoData({ ...location, city: 'é'.repeat(2048) }), true);
    const oversized = [
        { city: 'é'.repeat(2048) + 'x' }, { country: ' '.repeat(4096) + 'NZ' },
        { lat: ' '.repeat(4096) + '1' }, { lon: ' '.repeat(4096) + '2' },
        { unused: 'x'.repeat(4097) }, { status: 'x'.repeat(4097) },
    ];
    for (const fields of oversized) {
        const data = { ...location, ...fields };
        assert.equal(isValidGeoData(data), false);
        assert.equal((await geo.save('8.8.8.8', data, 100)).status, 'failed');
        assert.equal(geo.get('8.8.8.8'), null);
    }
    assert.equal((await geo.save('8.8.8.8', { ...location, city: 'é'.repeat(2048) }, 100)).status, 'saved');
    assert.equal(Buffer.byteLength(String(geo.get('8.8.8.8')?.city)), 4096);
    const row = Object.fromEntries(GEO_COLUMNS.map(key => [key, key in location ? location[key as keyof typeof location] : null]));
    assert.equal(normalizeDatasetRow({ ...row, ip: '8.8.8.8', country: ' '.repeat(4096) + 'NZ' }), null);
});

for (const [field, value] of [
    ['city', 'x'.repeat(4097)], ['country', ' '.repeat(4096) + 'NZ'], ['org', 'é'.repeat(2049)],
    ['lat', 'x'.repeat(4097)], ['last_updated', 'x'.repeat(4097)],
] as const) {
    test(`stored oversized ${field} is rejected without exposing fields or deleting its future-dated disk record`, async t => {
        const { geo } = database(t); storedOversized(geo, field, value);
        assert.deepEqual(geo.read('8.8.8.8'), { status: 'rejected', reason: 'oversized' });
        assert.equal(geo.get('8.8.8.8'), null);
        assert.deepEqual(geo.read('1.1.1.1'), { status: 'miss' });
        const db = new DatabaseSync(geo.path); t.after(() => db.close());
        const persisted = db.prepare(`SELECT length(CAST("${field}" AS BLOB)) AS bytes FROM geo_cache WHERE ip = ?`).get('8.8.8.8');
        assert.equal(persisted?.bytes, Buffer.byteLength(value)); assert.equal(geo.stats().entries, 1);
        if (field !== 'last_updated') assert.equal(db.prepare('SELECT last_updated FROM geo_cache WHERE ip = ?').get('8.8.8.8')?.last_updated, 4_000_000_000);
    });
}

test('rejected stored fields never cross the SQLite result boundary during a database read', async t => {
    const { geo } = database(t); storedOversized(geo);
    const observed = observeBoundedSqlResults(t);
    assert.deepEqual(geo.read('8.8.8.8'), { status: 'rejected', reason: 'oversized' });
    assert.ok(observed() > 0);
});

test('native SQL guards prevent giant TEXT and BLOB fields from reaching the JavaScript size callback', async t => {
    const registration = DatabaseSync.prototype.function;
    type SqlCallback = (...values: SQLOutputValue[]) => SQLInputValue;
    let callbacks = 0, maximumBytes = 0, sawBoundedString = false;
    t.mock.method(DatabaseSync.prototype, 'function', function (
        this: DatabaseSync, name: string, optionsOrCallback: FunctionOptions | SqlCallback, suppliedCallback?: SqlCallback,
    ) {
        const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : suppliedCallback;
        assert.ok(callback);
        const monitored = name === 'bpm_geoip_string_bytes' ? (value: SQLOutputValue) => {
            const bytes = typeof value === 'string' ? Buffer.byteLength(value) : value instanceof Uint8Array ? value.byteLength : 0;
            callbacks++; maximumBytes = Math.max(maximumBytes, bytes);
            assert.ok(bytes <= 8192, `SQL callback received ${bytes} bytes before the native size guard`);
            if (value === 'Bounded sentinel') sawBoundedString = true;
            return callback(value);
        } : callback;
        if (typeof optionsOrCallback === 'function') registration.call(this, name, monitored);
        else Reflect.apply(registration, this, [name, optionsOrCallback, monitored]);
    });
    const { geo } = database(t);
    const db = new DatabaseSync(geo.path); t.after(() => db.close());
    const insert = db.prepare('INSERT INTO geo_cache (ip, country, lat, lon, city, last_updated) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('8.8.8.8', 'NZ', 1, 2, 'x'.repeat(1024 * 1024), 4_000_000_000);
    insert.run('1.1.1.1', 'NZ', 1, 2, Buffer.alloc(1024 * 1024, 120), 4_000_000_000);
    assert.deepEqual(geo.read('8.8.8.8'), { status: 'rejected', reason: 'oversized' });
    assert.deepEqual(geo.read('1.1.1.1'), { status: 'rejected', reason: 'oversized' });
    assert.equal((await geo.save('9.9.9.9', { ...location, city: 'Bounded sentinel' }, 100)).status, 'saved');
    assert.ok(callbacks > 0); assert.equal(sawBoundedString, true); assert.ok(maximumBytes <= 8192);
});

test('statistics do not return rejected oversized timestamp fields through aggregates', async t => {
    const { geo } = database(t); storedOversized(geo, 'last_updated');
    const stats = geo.stats();
    assert.equal(stats.entries, 1);
    assert.equal(stats.last_updated, null); assert.equal(stats.oldest_updated, null);
    assert.ok(Object.values(stats).every(value => typeof value !== 'string' || Buffer.byteLength(value) <= MAX_GEOIP_STRING_BYTES));
    await geo.save('1.1.1.1', location, 200);
    assert.equal(geo.stats().entries, 2);
    assert.equal(geo.stats().last_updated, 200); assert.equal(geo.stats().oldest_updated, 200);
});

test('database errors remain distinct from oversize rejection and misses', async t => {
    const { geo } = database(t);
    t.mock.method(DatabaseSync.prototype, 'prepare', () => { throw new Error('database unavailable'); });
    assert.deepEqual(geo.read('8.8.8.8'), { status: 'error', message: 'database unavailable' });
});

test('rejected stored rows hydrate as unavailable and recover through an opted-in bounded provider result', async t => {
    const { rpc, geo, peers, connectivity } = service(t, async () => Response.json({ ...location, city: 'Recovered' }));
    storedOversized(geo);
    connectivity.setGeoipApiDisabled(true);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }];
    await peers.refreshOnce(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    const unavailable = peers.listPeers()[0];
    assert.equal(unavailable.location_status, 'unavailable'); assert.equal(unavailable.geo.freshness, 'unavailable');
    assert.equal(unavailable.geo.source, null); assert.equal(unavailable.geo.observed_at, null);
    assert.equal(unavailable.lat, 0); assert.equal(unavailable.lon, 0);
    assert.equal(geo.read('8.8.8.8').status, 'rejected');
    connectivity.setGeoipApiDisabled(false);
    t.mock.method(performance, 'now', () => Number.MAX_SAFE_INTEGER);
    await peers.resolveGeo('8.8.8.8', 'ipv4'); await peers.persistGeo('8.8.8.8');
    assert.equal(peers.listPeers()[0].location, 'Recovered, NZ');
    assert.equal(peers.listPeers()[0].geo.source, 'ip_api'); assert.equal(peers.listPeers()[0].geo.freshness, 'fresh');
    assert.equal(geo.get('8.8.8.8')?.city, 'Recovered'); assert.equal(geo.get('8.8.8.8')?.geo_source, 'ip_api');
});

test('oversized cached metadata is discarded as a whole before peer serialization', async t => {
    const { rpc, geo, peers, connectivity } = service(t, async () => assert.fail('database-only cache repair must not request the provider'));
    connectivity.setGeoipApiDisabled(true);
    await geo.save('8.8.8.8', { ...location, city: 'Keep' }, 100);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }];
    await peers.refreshOnce();
    const entry = peers.geoCache.get('8.8.8.8'); assert.ok(entry);
    entry.data.org = 'x'.repeat(MAX_GEOIP_STRING_BYTES + 1);
    const peer = peers.listPeers()[0];
    assert.equal(peer.location_status, 'unavailable'); assert.equal(peer.geo.freshness, 'unavailable');
    assert.equal(peer.geo.source, null); assert.equal(peer.geo.observed_at, null);
    assert.equal(peers.cachedGeo('8.8.8.8')?.org, '');
    assert.equal(geo.get('8.8.8.8')?.city, 'Keep', 'discarding an old oversized cache entry does not delete its bounded database record');
});

test('a bounded API replacement stays available while its save retries against a rejected disk record', async t => {
    const { rpc, geo, peers } = service(t, async () => Response.json({ ...location, city: 'Recovered' }));
    storedOversized(geo);
    const save = t.mock.method(geo, 'save', async () => ({ status: 'failed' as const, message: 'fixture writer is busy' }));
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }];
    await peers.refreshOnce(); await peers.resolveGeo('8.8.8.8', 'ipv4'); await peers.persistGeo('8.8.8.8');
    assert.equal(geo.read('8.8.8.8').status, 'rejected');
    geo.datasetChanged(); await peers.refreshOnce();
    assert.equal(peers.listPeers()[0].location, 'Recovered, NZ'); assert.equal(peers.listPeers()[0].geo.source, 'ip_api');
    assert.ok(peers.geoCache.get('8.8.8.8')?.pendingSave);
    save.mock.restore(); t.mock.method(performance, 'now', () => Number.MAX_SAFE_INTEGER);
    await peers.persistGeo('8.8.8.8');
    assert.equal(geo.get('8.8.8.8')?.city, 'Recovered'); assert.equal(geo.get('8.8.8.8')?.geo_source, 'ip_api');
    assert.equal(peers.geoCache.get('8.8.8.8')?.pendingSave, undefined);
});

test('bounded API replacement overrides only the size-rejected future winner, then resumes ordering and provenance', async t => {
    const { geo } = database(t); storedOversized(geo);
    const saved = await geo.save('8.8.8.8', { ...location, city: 'Recovered' }, 100);
    assert.equal(saved.status, 'saved'); assert.ok('row' in saved);
    assert.equal(saved.row.city, 'Recovered'); assert.equal(saved.row.last_updated, 100); assert.equal(saved.row.geo_source, 'ip_api');
    for (const time of [99, 100]) {
        const older = await geo.save('8.8.8.8', { ...location, city: 'Older' }, time);
        assert.equal(older.status, 'superseded'); assert.ok('row' in older);
        assert.equal(older.row.city, 'Recovered'); assert.equal(older.row.geo_source, 'ip_api');
    }
    assert.equal((await geo.save('8.8.8.8', { ...location, city: 'Newer' }, 101)).status, 'saved');
    assert.equal(geo.get('8.8.8.8')?.city, 'Newer');
});

test('bounded dataset replacement overrides a size-rejected future winner and preserves source on older/equal imports', async t => {
    const { dir, geo } = database(t); storedOversized(geo);
    for (const [time, city, changes] of [[100, 'Recovered', 1], [99, 'Older', 0], [100, 'Equal', 0], [101, 'Newer', 1]] as const) {
        const result = await geo.update(dataset(join(dir, `${city}.db`), [{ ...location, ip: '8.8.8.8', city, last_updated: time }]));
        assert.equal(result.success, true); assert.equal(result.updated_rows, changes); assert.equal(result.added_rows, 0);
        assert.equal(geo.get('8.8.8.8')?.city, time > 100 ? 'Newer' : 'Recovered');
        assert.equal(geo.get('8.8.8.8')?.geo_source, 'dataset');
    }
});

test('replacement of a size-rejected row remains atomic when provenance cannot be written', async t => {
    const { dir, geo } = database(t); storedOversized(geo);
    const db = new DatabaseSync(geo.path); t.after(() => db.close());
    db.exec("CREATE TRIGGER reject_recovery BEFORE INSERT ON geo_provenance BEGIN SELECT RAISE(ABORT, 'provenance unavailable'); END");
    t.mock.method(console, 'error', () => {});
    assert.equal((await geo.save('8.8.8.8', { ...location, city: 'API' }, 100)).status, 'failed');
    assert.equal(geo.read('8.8.8.8').status, 'rejected');
    const imported = await geo.update(dataset(join(dir, 'atomic.db'), [{ ...location, ip: '8.8.8.8', city: 'Imported', last_updated: 100 }]));
    assert.equal(imported.success, false); assert.equal(geo.read('8.8.8.8').status, 'rejected');
    assert.equal(db.prepare('SELECT last_updated FROM geo_cache WHERE ip = ?').get('8.8.8.8')?.last_updated, 4_000_000_000);
    assert.equal(db.prepare('SELECT observed_at FROM geo_provenance WHERE ip = ?').get('8.8.8.8')?.observed_at, 4_000_000_000);
});

test('dataset imports skip oversized byte fields, accept the exact limit, and report mixed and all-invalid batches', async t => {
    const { dir, geo } = database(t);
    await geo.save('8.8.8.8', { ...location, city: 'Keep' }, 100);
    const oversizedRows = [
        { ...location, ip: '8.8.8.8', city: 'é'.repeat(2049), last_updated: 4_000_000_000 },
        { ...location, ip: '9.9.9.9', country: ' '.repeat(4096) + 'NZ', last_updated: 200 },
        { ...location, ip: '4.4.4.4', org: 'x'.repeat(4097), last_updated: 200 },
    ];
    const mixed = await geo.update(dataset(join(dir, 'mixed.db'), [
        ...oversizedRows, { ...location, ip: '1.1.1.1', city: 'é'.repeat(2048), last_updated: 200 },
    ]));
    assert.equal(mixed.success, true); assert.equal(mixed.skipped_rows, 3); assert.equal(mixed.added_rows, 1); assert.equal(mixed.updated_rows, 0);
    assert.equal(geo.get('8.8.8.8')?.city, 'Keep'); assert.equal(geo.get('8.8.8.8')?.geo_source, 'ip_api');
    assert.equal(Buffer.byteLength(String(geo.get('1.1.1.1')?.city)), 4096); assert.equal(geo.get('1.1.1.1')?.geo_source, 'dataset');
    const generation = geo.generation;
    const invalid = await geo.update(dataset(join(dir, 'invalid.db'), oversizedRows));
    assert.equal(invalid.success, false); assert.equal(invalid.skipped_rows, 3); assert.match(invalid.message, /no valid geolocation/);
    assert.equal(geo.generation, generation); assert.equal(geo.stats().entries, 2);
    assert.deepEqual(readdirSync(geo.tempDir), []);
});

const exactUtf8Strings = [
    'x'.repeat(4096), 'é'.repeat(2048), '漢'.repeat(1365) + 'x', '😀'.repeat(1024), '\0' + '漢'.repeat(1365),
];
const oversizedUtf8Strings = ['漢'.repeat(1366), '\0' + '漢'.repeat(1365) + 'x'];
for (const encoding of ['UTF-16le', 'UTF-16be'] as const) {
    test(`${encoding} local records accept exact UTF-8 boundaries for ASCII, multibyte characters and embedded NUL`, async t => {
        const { geo } = database(t, encoding);
        for (const [index, city] of exactUtf8Strings.entries()) {
            assert.equal(Buffer.byteLength(city), MAX_GEOIP_STRING_BYTES);
            const ip = `8.8.8.${index + 1}`;
            const saved = await geo.save(ip, { ...location, city }, 100);
            assert.equal(saved.status, 'saved'); assert.ok('row' in saved);
            assert.equal(saved.row.city, city); assert.equal(geo.get(ip)?.city, city);
        }
    });

    test(`${encoding} oversized UTF-8 records are rejected before projection and allow older bounded API recovery`, async t => {
        const observed = observeBoundedSqlResults(t);
        for (const city of oversizedUtf8Strings) {
            const { geo } = database(t, encoding); storedOversized(geo, 'city', city);
            assert.ok(Buffer.byteLength(city, 'utf8') > MAX_GEOIP_STRING_BYTES);
            assert.ok(Buffer.byteLength(city, 'utf16le') < MAX_GEOIP_STRING_BYTES, 'native storage bytes would miss this record');
            assert.deepEqual(geo.read('8.8.8.8'), { status: 'rejected', reason: 'oversized' });
            assert.equal(geo.get('8.8.8.8'), null);
            const saved = await geo.save('8.8.8.8', { ...location, city: exactUtf8Strings[0] }, 100);
            assert.equal(saved.status, 'saved'); assert.ok('row' in saved);
            assert.equal(saved.row.last_updated, 100); assert.equal(saved.row.geo_source, 'ip_api');
            assert.equal(saved.row.city, exactUtf8Strings[0]);
        }
        assert.ok(observed() > 0);
    });

    test(`${encoding} dataset imports apply UTF-8 limits and recover a rejected future row transactionally`, async t => {
        const { dir, geo } = database(t, encoding); storedOversized(geo, 'city', oversizedUtf8Strings[0]);
        const valid = exactUtf8Strings.map((city, index) => ({ ...location, ip: `1.1.1.${index + 1}`, city, last_updated: 200 }));
        const invalid = oversizedUtf8Strings.map((city, index) => ({ ...location, ip: `9.9.9.${index + 1}`, city, last_updated: 200 }));
        const mixed = await geo.update(dataset(join(dir, 'utf16-mixed.db'), [
            { ...location, ip: '8.8.8.8', city: exactUtf8Strings[0], last_updated: 100 }, ...valid, ...invalid,
        ], encoding));
        assert.equal(mixed.success, true); assert.equal(mixed.added_rows, exactUtf8Strings.length);
        assert.equal(mixed.updated_rows, 1); assert.equal(mixed.skipped_rows, oversizedUtf8Strings.length);
        assert.equal(geo.get('8.8.8.8')?.city, exactUtf8Strings[0]);
        assert.equal(geo.get('8.8.8.8')?.last_updated, 100); assert.equal(geo.get('8.8.8.8')?.geo_source, 'dataset');
        for (const row of valid) assert.equal(geo.get(row.ip)?.city, row.city);
        for (const row of invalid) assert.equal(geo.get(row.ip), null);
        const generation = geo.generation;
        const rejected = await geo.update(dataset(join(dir, 'utf16-invalid.db'), invalid, encoding));
        assert.equal(rejected.success, false); assert.equal(rejected.skipped_rows, oversizedUtf8Strings.length);
        assert.equal(geo.generation, generation); assert.deepEqual(readdirSync(geo.tempDir), []);
    });
}
