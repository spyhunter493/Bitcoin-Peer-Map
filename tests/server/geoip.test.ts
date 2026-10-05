import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GeoDatabase, GEO_COLUMNS, isValidGeoData } from '../../src/server/services/geoip.ts';
import { temporaryDirectory, deferred } from './helpers.ts';
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
test('geolocation validation rejects missing, infinite, and out-of-range coordinates', () => {
    assert.equal(isValidGeoData({ lat: -36.85, lon: 174.76, country: 'NZ' }), true);
    for (const value of [null, {}, { lat: 91, lon: 10, country: 'NZ' }, { lat: 0, lon: Infinity, country: 'NZ' }, { lat: 0, lon: 0, country: '' },
        { lat: [], lon: 0, country: 'NZ' }, { lat: 0, lon: false, country: 'NZ' }, { lat: 0, lon: 0, country: {} }]) assert.equal(isValidGeoData(value), false);
});
for (const [local, remote, update] of [[100, 200, true], [200, 100, false], [200, 200, false], [null, 200, true], [200, null, false], [null, null, false]] as const) {
    test(`worker merges only newer records (${local} -> ${remote}) and invalidates statistics`, async t => {
        const { dir, geo } = database(t);
        const localDb = new DatabaseSync(geo.path);
        localDb.prepare('INSERT INTO geo_cache (ip, city, last_updated) VALUES (?, ?, ?)').run('8.8.8.8', 'Local', local);
        localDb.close();
        const fetcher = dataset(join(dir, 'remote.db'), [{ ip: '8.8.8.8', city: 'Remote', last_updated: remote }, { ip: '1.1.1.1', city: 'New', last_updated: 300 }]);
        assert.equal(geo.stats().entries, 1);
        assert.deepEqual(await geo.update(fetcher), { success: true, message: update ? '+1 new entries, 1 updated entries (2 total)' : '+1 new entries (2 total)' });
        assert.equal(geo.get('8.8.8.8')?.city, update ? 'Remote' : 'Local');
        assert.equal(geo.get('8.8.8.8')?.last_updated, update ? remote : local);
        assert.equal(geo.stats().entries, 2); assert.equal(geo.generation, 1);
        assert.deepEqual(await geo.update(fetcher), { success: true, message: 'Already up to date (2 entries)' });
        assert.deepEqual(readdirSync(geo.tempDir), []);
    });
}
test('updates to existing rows are reported without new IPs', async t => {
    const { dir, geo } = database(t);
    geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', city: 'Old' });
    const fetcher = dataset(join(dir, 'remote.db'), [{ ip: '8.8.8.8', city: 'New', last_updated: 4e9 }]);
    assert.deepEqual(await geo.update(fetcher), { success: true, message: '1 updated entries (1 total)' });
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
    geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ' });
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
test('saved SQLite records reopen with unchanged schema and statistics are independent copies', t => {
    const { dir, geo } = database(t);
    geo.save('8.8.8.8', { lat: 1, lon: 2, country: 'NZ', offset: 3600, as: 'AS123', mobile: true });
    geo.stats().entries = 999;
    geo.save('bad', {});
    assert.equal(geo.stats().entries, 1); geo.close();
    const reopened = new GeoDatabase(dir, true); reopened.initialize(); t.after(() => reopened.close());
    assert.equal(reopened.get('8.8.8.8')?.utc_offset, 3600);
    assert.equal(reopened.get('8.8.8.8')?.as_info, 'AS123');
    assert.equal(reopened.get('8.8.8.8')?.mobile, 1);
});
