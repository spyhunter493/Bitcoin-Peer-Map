import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GeoDatabase, GEO_COLUMNS, GEO_SAVE_RETRY_BUDGET_MS, isValidGeoData } from '../../src/server/services/geoip.ts';
import { GEO_SCHEMA } from '../../src/server/services/geoip-schema.ts';
import { temporaryDirectory, deferred, flush } from './helpers.ts';
import type { Data } from '../../src/server/types.ts';
import type { TestContext } from 'node:test';

function database(t: TestContext) {
    const dir = temporaryDirectory(t), geo = new GeoDatabase(dir, true);
    geo.initialize(); t.after(() => geo.close()); return { dir, geo };
}
function dataset(path: string, rows: Data[], columns: readonly string[] = GEO_COLUMNS) {
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE geo_cache (${columns.map(key => `"${key}"${key === 'ip' ? ' TEXT PRIMARY KEY' : ''}`).join(',')})`);
    const insert = db.prepare(`INSERT INTO geo_cache VALUES (${columns.map(() => '?').join(',')})`);
    for (const row of rows) insert.run(...columns.map(key => row[key] ?? null) as SQLInputValue[]);
    db.close();
    return async () => new Response(readFileSync(path));
}
function integerDataset(path: string, rows: Data[]) {
    const db = new DatabaseSync(path);
    db.exec(GEO_SCHEMA);
    const insert = db.prepare(`INSERT INTO geo_cache VALUES (${GEO_COLUMNS.map(() => '?').join(',')})`);
    for (const row of rows) insert.run(...GEO_COLUMNS.map(key => row[key] ?? null) as SQLInputValue[]);
    db.close();
    return async () => new Response(readFileSync(path));
}
test('geolocation validation rejects missing, infinite, and out-of-range coordinates', () => {
    assert.equal(isValidGeoData({ lat: -36.85, lon: 174.76, country: 'NZ' }), true);
    for (const value of [null, {}, { lat: 91, lon: 10, country: 'NZ' }, { lat: 0, lon: Infinity, country: 'NZ' }, { lat: 0, lon: 0, country: '' },
        { lat: [], lon: 0, country: 'NZ' }, { lat: 0, lon: false, country: 'NZ' }, { lat: 0, lon: 0, country: {} }]) assert.equal(isValidGeoData(value), false);
});
for (const [local, remote, update] of [[100, 200, true], [200, 100, false], [200, 200, false], [null, 200, true], [200, null, false], [null, null, false]] as const) {
    test(`worker merges only newer records (${local} -> ${remote}) and invalidates statistics`, async t => {
        const { dir, geo } = database(t);
        const localDb = new DatabaseSync(geo.path);
        localDb.prepare('INSERT INTO geo_cache (ip, city, country, lat, lon, last_updated) VALUES (?, ?, ?, ?, ?, ?)').run('8.8.8.8', 'Local', 'NZ', 1, 2, local);
        localDb.close();
        const fetcher = dataset(join(dir, 'remote.db'), [{ ip: '8.8.8.8', city: 'Remote', country: 'NZ', lat: 1, lon: 2, last_updated: remote }, { ip: '1.1.1.1', city: 'New', country: 'NZ', lat: 1, lon: 2, last_updated: 300 }]);
        assert.equal(geo.stats().entries, 1);
        assert.deepEqual(await geo.update(fetcher), { success: true, message: `+1 new entries, ${update ? 1 : 0} updated entries, 0 invalid rows skipped (2 total)`, added_rows: 1, updated_rows: update ? 1 : 0, skipped_rows: 0 });
        assert.equal(geo.get('8.8.8.8')?.city, update ? 'Remote' : 'Local');
        assert.equal(geo.get('8.8.8.8')?.last_updated, update ? remote : local);
        assert.equal(geo.stats().entries, 2); assert.equal(geo.generation, 1);
        assert.deepEqual(await geo.update(fetcher), { success: true, message: 'Already up to date (2 entries; 0 added, 0 updated, 0 skipped)', added_rows: 0, updated_rows: 0, skipped_rows: 0 });
        assert.deepEqual(readdirSync(geo.tempDir), []);
    });
}
test('updates to existing rows are reported without new IPs', async t => {
    const { dir, geo } = database(t);
    await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', city: 'Old' });
    const fetcher = dataset(join(dir, 'remote.db'), [{ ip: '8.8.8.8', city: 'New', country: 'NZ', lat: 1, lon: 2, last_updated: 4e9 }]);
    assert.deepEqual(await geo.update(fetcher), { success: true, message: '+0 new entries, 1 updated entries, 0 invalid rows skipped (1 total)', added_rows: 0, updated_rows: 1, skipped_rows: 0 });
    assert.equal(geo.get('8.8.8.8')?.city, 'New');
});
test('stream and declared size limits protect the database and clean temporary files', async t => {
    const { geo } = database(t);
    for (const response of [new Response('12345678901'), new Response('123', { headers: { 'Content-Length': '11' } })]) {
        const result = await geo.update(async () => response, 10);
        assert.equal(result.success, false); assert.match(result.message, /size limit/);
        assert.deepEqual(readdirSync(geo.tempDir), []); assert.equal(geo.generation, 0);
    }
});
test('invalid schema, corrupt, empty, and failed downloads cannot replace local data', async t => {
    const { dir, geo } = database(t);
    await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ' });
    const wrong = dataset(join(dir, 'wrong.db'), [], GEO_COLUMNS.slice(0, -1));
    const empty = dataset(join(dir, 'empty.db'), []);
    for (const fetcher of [wrong, empty, async () => new Response('not sqlite'), async () => new Response('', { status: 503 })]) {
        assert.equal((await geo.update(fetcher)).success, false);
        assert.equal(geo.stats().entries, 1); assert.equal(geo.generation, 0);
        assert.deepEqual(readdirSync(geo.tempDir), []);
    }
});
test('concurrent imports are rejected and the lock releases after failure', async t => {
    const { geo } = database(t), download = deferred<Response>();
    const first = geo.update(() => download.promise);
    assert.match((await geo.update()).message, /already in progress/);
    download.resolve(new Response('', { status: 500 }));
    assert.equal((await first).success, false);
    assert.match((await geo.update(async () => new Response('', { status: 503 }))).message, /503/);
});
test('saved SQLite records reopen with unchanged schema and statistics are independent copies', async t => {
    const { dir, geo } = database(t);
    await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', offset: 3600, as: 'AS123', mobile: true });
    geo.stats().entries = 999;
    assert.equal((await geo.save('bad', {})).status, 'failed');
    assert.equal(geo.stats().entries, 1); geo.close();
    const reopened = new GeoDatabase(dir, true); reopened.initialize(); t.after(() => reopened.close());
    assert.equal(reopened.get('8.8.8.8')?.utc_offset, 3600);
    assert.equal(reopened.get('8.8.8.8')?.as_info, 'AS123');
    assert.equal(reopened.get('8.8.8.8')?.mobile, 1);
});

test('imports skip malformed newer rows while preserving valid records and nullable legacy metadata', async t => {
    const { dir, geo } = database(t);
    await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', city: 'Keep' }, 100);
    const invalidFields = [
        { ip: 'not-an-ip' }, { country: ' ' }, { lat: 999 }, { lon: '' }, { mobile: 2 },
        { as_info: 42 }, { last_updated: -1 }, { last_updated: 1.5 }, { last_updated: 'later' },
        { last_updated: Number.MAX_SAFE_INTEGER + 1 }, { utc_offset: 1.5 },
    ];
    const invalid = invalidFields.map((fields, index) => ({ ip: `9.9.9.${index + 1}`, country: 'NZ', lat: 1, lon: 2, last_updated: 200, ...fields }));
    const fetcher = dataset(join(dir, 'mixed.db'), [
        { ip: '8.8.8.8', country: 'NZ', lat: 999, lon: 2, last_updated: 200 },
        { ip: '1.1.1.1', country: ' NZ ', lat: '-36.85', lon: '174.76', last_updated: null },
        ...invalid,
    ]);
    const result = await geo.update(fetcher);
    assert.equal(result.success, true); assert.equal(result.added_rows, 1); assert.equal(result.updated_rows, 0);
    assert.equal(result.skipped_rows, invalid.length + 1);
    assert.equal(result.message, `+1 new entries, 0 updated entries, ${invalid.length + 1} invalid rows skipped (2 total)`);
    assert.equal(geo.get('8.8.8.8')?.city, 'Keep'); assert.equal(geo.get('8.8.8.8')?.last_updated, 100);
    const imported = geo.get('1.1.1.1');
    assert.equal(imported?.country, 'NZ'); assert.equal(imported?.lat, -36.85); assert.equal(imported?.lon, 174.76);
    assert.equal(imported?.last_updated, null); assert.equal(imported?.city, null); assert.equal(imported?.mobile, null); assert.equal(imported?.utc_offset, null);
    assert.equal(geo.stats().entries, 2);
});
test('an all-invalid import fails without changing local records or generation', async t => {
    const { dir, geo } = database(t);
    await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', city: 'Keep' }, 100);
    const result = await geo.update(dataset(join(dir, 'invalid.db'), [{ ip: '8.8.8.8', country: 'NZ', lat: 999, lon: 2, last_updated: 200 }]));
    assert.equal(result.success, false); assert.equal(result.skipped_rows, 1); assert.match(result.message, /no valid geolocation/);
    assert.equal(geo.get('8.8.8.8')?.city, 'Keep'); assert.equal(geo.generation, 0);
    assert.deepEqual(readdirSync(geo.tempDir), []);
});
test('unsafe SQLite INTEGER fields are skipped without rejecting other valid dataset rows', async t => {
    const { dir, geo } = database(t);
    await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', city: 'Keep' }, 100);
    const unsafe = 9_007_199_254_740_992n;
    const result = await geo.update(integerDataset(join(dir, 'integer-mixed.db'), [
        { ip: '8.8.8.8', country: 'NZ', lat: 1, lon: 2, city: 'Invalid newer', last_updated: unsafe },
        { ip: '9.9.9.9', country: 'NZ', lat: 1, lon: 2, last_updated: 200n, utc_offset: unsafe },
        { ip: '1.1.1.1', country: 'NZ', lat: 1, lon: 2, last_updated: 200n, utc_offset: 43200n, mobile: 1n, proxy: 0n, hosting: 1n },
    ]));
    assert.deepEqual(result, { success: true, message: '+1 new entries, 0 updated entries, 2 invalid rows skipped (2 total)', added_rows: 1, updated_rows: 0, skipped_rows: 2 });
    assert.equal(geo.get('8.8.8.8')?.city, 'Keep'); assert.equal(geo.get('8.8.8.8')?.last_updated, 100);
    assert.equal(geo.get('9.9.9.9'), null);
    const imported = geo.get('1.1.1.1');
    assert.equal(imported?.last_updated, 200); assert.equal(imported?.utc_offset, 43200);
    assert.equal(imported?.mobile, 1); assert.equal(imported?.proxy, 0); assert.equal(imported?.hosting, 1);
    assert.deepEqual(readdirSync(geo.tempDir), []);
});
test('all unsafe SQLite INTEGER rows fail without changes and report their skipped count', async t => {
    const { dir, geo } = database(t);
    await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', city: 'Keep' }, 100);
    const unsafe = 9_007_199_254_740_992n;
    const result = await geo.update(integerDataset(join(dir, 'integer-invalid.db'), [
        { ip: '8.8.8.8', country: 'NZ', lat: 1, lon: 2, last_updated: unsafe },
        { ip: '9.9.9.9', country: 'NZ', lat: 1, lon: 2, last_updated: 200n, utc_offset: unsafe },
    ]));
    assert.equal(result.success, false); assert.equal(result.skipped_rows, 2); assert.match(result.message, /no valid geolocation/);
    assert.equal(geo.get('8.8.8.8')?.city, 'Keep'); assert.equal(geo.get('8.8.8.8')?.last_updated, 100);
    assert.equal(geo.stats().entries, 1); assert.equal(geo.generation, 0);
    assert.deepEqual(readdirSync(geo.tempDir), []);
});
test('API saves preserve observation ordering and return the winning row on older and equal writes', async t => {
    const { geo } = database(t);
    assert.equal((await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', city: 'First' }, 100)).status, 'saved');
    assert.equal((await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', city: 'Newest' }, 200)).status, 'saved');
    for (const observedAt of [199, 200]) {
        const result = await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', city: 'Delayed' }, observedAt);
        assert.equal(result.status, 'superseded');
        assert.ok('row' in result); assert.equal(result.row.city, 'Newest'); assert.equal(result.row.last_updated, 200);
    }
});
test('an invalid newer stored winner returns a permanent failure without replacing its timestamp', async t => {
    const { geo } = database(t), writer = new DatabaseSync(geo.path);
    writer.prepare('INSERT INTO geo_cache (ip, country, lat, lon, last_updated) VALUES (?, ?, ?, ?, ?)').run('8.8.8.8', 'NZ', 999, 2, 200);
    writer.close(); t.mock.method(console, 'error', () => {});
    const result = await geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ' }, 100);
    assert.equal(result.status, 'failed'); assert.ok('message' in result); assert.match(result.message, /invalid.*geolocation|geolocation.*invalid/i);
    assert.equal(geo.get('8.8.8.8')?.lat, 999); assert.equal(geo.get('8.8.8.8')?.last_updated, 200);
});
test('busy API saves yield to the event loop and persist once the worker-style writer lock releases', async t => {
    const { geo } = database(t), writer = new DatabaseSync(geo.path);
    t.after(() => writer.close()); t.mock.timers.enable({ apis: ['setTimeout'] });
    writer.exec('BEGIN IMMEDIATE');
    let settled = false;
    const pending = geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ' }, 100).then(result => { settled = true; return result; });
    await flush(); assert.equal(settled, false); assert.equal(geo.get('8.8.8.8'), null);
    writer.exec('COMMIT'); t.mock.timers.tick(50);
    assert.equal((await pending).status, 'saved'); assert.equal(geo.get('8.8.8.8')?.last_updated, 100);
});
test('a newer import wins against an API write delayed by its transaction', async t => {
    const { geo } = database(t), writer = new DatabaseSync(geo.path);
    t.after(() => writer.close()); t.mock.timers.enable({ apis: ['setTimeout'] });
    writer.exec('BEGIN IMMEDIATE');
    writer.prepare('INSERT INTO geo_cache (ip, country, lat, lon, city, last_updated) VALUES (?, ?, ?, ?, ?, ?)').run('8.8.8.8', 'NZ', 1, 2, 'Imported', 200);
    const pending = geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', city: 'API' }, 100);
    writer.exec('COMMIT'); t.mock.timers.tick(50);
    const result = await pending;
    assert.equal(result.status, 'superseded'); assert.ok('row' in result); assert.equal(result.row.city, 'Imported'); assert.equal(result.row.last_updated, 200);
});
test('SQLITE_LOCKED and extended contention codes receive asynchronous retries', async t => {
    const { geo } = database(t); t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const [index, errcode] of [6, 261, 262].entries()) {
        const prepare = t.mock.method(DatabaseSync.prototype, 'prepare', () => { throw Object.assign(new Error('locked'), { errcode }); });
        let settled = false;
        const pending = geo.save(`8.8.8.${index + 1}`, { lat: 1, lon: 2, country: 'NZ' }, 100).then(result => { settled = true; return result; });
        await flush(); assert.equal(settled, false);
        prepare.mock.restore(); t.mock.timers.tick(50);
        assert.equal((await pending).status, 'saved');
    }
});
test('busy saves stop after their retry budget and cancellation does not wait for it', async t => {
    const { geo } = database(t), writer = new DatabaseSync(geo.path);
    t.after(() => writer.close()); t.mock.timers.enable({ apis: ['setTimeout'] });
    let time = 0; t.mock.method(performance, 'now', () => time);
    const errors: string[] = []; t.mock.method(console, 'error', (message: string) => { errors.push(message); });
    writer.exec('BEGIN IMMEDIATE');
    const pending = geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ' }, 100);
    time = GEO_SAVE_RETRY_BUDGET_MS; t.mock.timers.tick(50);
    assert.equal((await pending).status, 'failed'); assert.equal(errors.length, 1);
    const cancellation = new AbortController();
    const cancelled = geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ' }, 100, cancellation.signal);
    cancellation.abort(); assert.equal((await cancelled).status, 'cancelled'); assert.equal(errors.length, 1);
    const closed = geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ' }, 100);
    geo.close(); assert.equal((await closed).status, 'cancelled');
    writer.exec('ROLLBACK');
});
