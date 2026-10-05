import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApplication, assetRevision } from '../../src/server/app.ts';
import { FixtureRuntime, fixtureSettings } from '../layout_server.ts';
import { temporaryDirectory, deferred, flush } from './helpers.ts';
import type { TestContext } from 'node:test';

async function application(t: TestContext) {
    const settings = fixtureSettings(temporaryDirectory(t)), runtime = new FixtureRuntime(settings);
    const app = createApplication(settings, runtime);
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`;
    return { app, runtime, base, get: (path: string, options?: RequestInit) => fetch(base + path, options) };
}
test('application serves health, configuration without credentials, and revisioned dashboard HTML', async t => {
    const { runtime, get } = await application(t);
    assert.equal(runtime.started, true);
    assert.deepEqual(await (await get('/healthz')).json(), { status: 'ok' });
    const config = await (await get('/api/config')).json();
    assert.equal(JSON.stringify(config).includes('secret'), false);
    assert.equal(config.bitcoin_rpc.endpoint, 'http://bitcoin:8332');
    assert.equal(config.build.revision, 'abcdef0123456789');
    const response = await get('/'), html = await response.text();
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.match(html, /data-asset-revision="abcdef0123456789"/);
    assert.match(html, /<script type="module" src="\/static\/v\/abcdef0123456789\/js\/app.js"/);
    assert.match(html, /class="revision"[^>]*>abcdef0<\/a>/);
    assert.match(html, /id="revision-update"[^>]*hidden/);
    assert.equal(html.includes('{{'), false);
    assert.equal((html.match(/<script/g) || []).length, 1);
});
test('dashboard and configuration share cached update status', async t => {
    const { runtime, get } = await application(t);
    const status = { update_available: true, commits_behind: 3, changes_url: 'https://github.com/spyhunter493/bitcoin-peer-map/compare/abcdef0123456789...main', checked_at: 1700000000, check_failed: false };
    t.mock.method(runtime.updates, 'snapshot', () => status);
    const info = await (await get('/api/info?include_price=false')).json();
    const config = await (await get('/api/config')).json();
    assert.deepEqual(info.updates, status);
    assert.deepEqual(config.build.updates, status);
});
test('peer list, optional status, and separate price delivery keep their API contracts', async t => {
    const { get } = await application(t);
    const peers = await get('/api/peers'); assert.equal(peers.headers.get('cache-control'), 'no-store');
    assert.ok(Array.isArray(await peers.json()));
    const snapshot = await (await get('/api/peers?include_status=true')).json();
    assert.ok(Array.isArray(snapshot.peers)); assert.equal(snapshot.status.connected, true);
    const defaultInfo = await (await get('/api/info?currency=nzd')).json();
    const price = await (await get('/api/price?currency=nzd')).json();
    for (const [key, value] of Object.entries(price)) assert.deepEqual(defaultInfo[key], value);
    assert.equal(price.btc_currency, 'NZD');
    const withoutPrice = await (await get('/api/info?include_price=false')).json();
    assert.equal('btc_price' in withoutPrice, false);
});
test('static files support cache revalidation, immutable revisions, compression, and HEAD', async t => {
    const { get } = await application(t);
    const asset = '/static/js/map/controller.js';
    const plain = await get(asset, { headers: { 'Accept-Encoding': 'identity' } }); await plain.arrayBuffer();
    assert.equal(plain.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.equal((await get(asset, { headers: { 'If-None-Match': plain.headers.get('etag')! } })).status, 304);
    const compressed = await get(`${asset}?v=abcdef0123456789`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(compressed.headers.get('content-encoding'), 'gzip'); assert.ok((await compressed.text()).length > 500);
    assert.match(compressed.headers.get('cache-control')!, /immutable/);
    assert.equal((await get(asset, { headers: { 'Accept-Encoding': 'gzip;q=0.5' } })).headers.get('content-encoding'), 'gzip');
    assert.equal((await get(asset, { headers: { 'Accept-Encoding': 'gzip;q=0' } })).headers.get('content-encoding'), null);
    assert.equal((await get(`${asset}?v=wrong`)).headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    const head = await get(asset, { method: 'HEAD' }); assert.equal(await head.text(), ''); assert.equal(head.status, 200);
});
test('every relative frontend dependency is available in the revision namespace', async t => {
    const { base, get } = await application(t), prefix = '/static/v/abcdef0123456789/';
    const pending = [`${prefix}js/app.js`], visited = new Set<string>();
    while (pending.length) {
        const path = pending.pop()!; if (visited.has(path)) continue; visited.add(path);
        assert.ok(path.startsWith(prefix));
        const response = await get(path); assert.equal(response.status, 200, path);
        assert.match(response.headers.get('content-type')!, /javascript/); assert.match(response.headers.get('cache-control')!, /immutable/);
        for (const match of (await response.text()).matchAll(/from\s+['"]([^'"]+\.js)['"]/g)) pending.push(new URL(match[1], base + path).pathname);
    }
    const modules = readdirSync(new URL('../../src/static/js/', import.meta.url), { recursive: true }).filter(path => String(path).endsWith('.js'));
    assert.equal(visited.size, modules.length);
});
test('static traversal and invalid namespaces are rejected before serving files', async t => {
    const { base } = await application(t);
    for (const path of ['/static/v/wrong/js/app.js', '/static/v/abcdef0123456789', '/static/v/abcdef0123456789/%2e%2e/%2e%2e/js/app.js', '/static/%2e%2e/server/settings.ts', '/static/%2Fetc/passwd', '/static/js/%00', '/static/js/%5c..%5cserver', '/static/js/%ZZ']) {
        const status = await new Promise<number | undefined>((resolve, reject) => {
            const req = request(base, { path }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end();
        });
        assert.equal(status, 404, path);
    }
});
test('unknown revisions hash dependencies and known revisions remain stable', t => {
    const dir = temporaryDirectory(t); writeFileSync(join(dir, 'app.js'), "import './feature.js';");
    writeFileSync(join(dir, 'feature.js'), 'export const value = 1;'); const before = assetRevision(dir, 'unknown');
    writeFileSync(join(dir, 'feature.js'), 'export const value = 2;'); assert.notEqual(assetRevision(dir, 'unknown'), before);
    assert.equal(assetRevision(dir, 'abcdef0'), 'abcdef0');
});
test('all documented JSON endpoints are wired and removed endpoints stay absent', async t => {
    const { get } = await application(t);
    const schema = await (await get('/openapi.json')).json();
    for (const [path, methods] of Object.entries(schema.paths)) {
        if (!path.startsWith('/api/') || path === '/api/stream/system') continue;
        for (const method of Object.keys(methods as object)) {
            const response = await get(path, { method: method.toUpperCase(), ...(method === 'post' ? { body: '{"address":"8.8.8.8","peer_id":1}', headers: { 'Content-Type': 'application/json' } } : {}) });
            assert.equal(response.status, 200, `${method} ${path}`); assert.ok(await response.json());
        }
    }
    for (const path of ['/api/changes', '/api/netspeed', '/api/update-check']) assert.equal((await get(path)).status, 404);
});
test('HTTP validation rejects malformed inputs and unsupported methods', async t => {
    const { get } = await application(t);
    const schema = await (await get('/openapi.json')).json();
    const invalid = await get('/api/peer/connect', { method: 'POST', body: 'broken' });
    assert.equal(invalid.status, 422);
    const reference = schema.paths['/api/peer/connect'].post.responses['422'].content['application/json'].schema.$ref;
    const errorSchema = schema.components.schemas[reference.split('/').at(-1)];
    assert.equal(typeof (await invalid.json()).detail, errorSchema.properties.detail.type);
    for (const path of ['/api/blocks/recent?limit=0', '/api/blocks/recent?limit=101', '/api/blocks/recent?limit=1.5', '/api/peers?include_status=maybe', '/api/info?include_price=maybe']) assert.equal((await get(path)).status, 422, path);
    for (const body of ['broken', '[]', '{"address":1}']) assert.equal((await get('/api/peer/connect', { method: 'POST', body })).status, 422);
    assert.equal((await get('/api/peer/ban', { method: 'POST', body: '{"peer_id":1.5}' })).status, 422);
    assert.equal((await get('/api/peer/connect', { method: 'POST', body: 'a'.repeat(65537) })).status, 413);
    const wrong = await get('/api/peers', { method: 'POST' }); assert.equal(wrong.status, 405); assert.match(wrong.headers.get('allow')!, /GET/);
});
test('cross-origin browser requests cannot change settings or manage peers', async t => {
    const { base, runtime, get } = await application(t);
    t.mock.method(runtime.node, 'clearBans', () => assert.fail('Cross-origin action reached the node'));
    for (const origin of ['https://example.com', 'null', `${base}.example.com`, 'not a URL']) {
        const response = await get('/api/bans/clear', { method: 'POST', headers: { Origin: origin } });
        assert.equal(response.status, 403, origin);
    }
    const sameOrigin = await get('/api/geodb/toggle-auto-update', { method: 'POST', headers: { Origin: base } });
    assert.equal(sameOrigin.status, 200);
    const proxied = await get('/api/geodb/toggle-auto-update', { method: 'POST', headers: { Origin: base.replace('http:', 'https:') } });
    assert.equal(proxied.status, 200, 'TLS termination can preserve the external Host header');
    const defaultPort = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(`${base}/api/geodb/toggle-auto-update`, {
            method: 'POST', headers: { Host: 'bpm.example:443', Origin: 'https://bpm.example' },
        }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.end();
    });
    assert.equal(defaultPort, 200, 'default ports are normalized using the external protocol');
    assert.equal((await get('/api/geodb/toggle-auto-update', { method: 'POST' })).status, 200, 'CLI clients need no Origin header');
});
test('SSE emits metrics without blocking HTTP and closes with the application', async t => {
    const { app, runtime, get } = await application(t);
    const schema = await (await get('/openapi.json')).json();
    assert.ok(schema.paths['/api/stream/system'].get.responses['200'].content['text/event-stream']);
    const response = await get('/api/stream/system'); assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const reader = response.body!.getReader(), initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /"type":"connected"/); assert.match(initial, /event: system/);
    assert.equal((await get('/healthz')).status, 200);
    assert.equal((await get('/api/stream/system', { method: 'HEAD' })).status, 200);
    await app.close(); assert.equal(runtime.stopped, true); assert.equal((await reader.read()).done, true);
});
test('shutdown during startup cannot leave an HTTP listener running', async t => {
    const settings = fixtureSettings(temporaryDirectory(t)), runtime = new FixtureRuntime(settings), gate = deferred<void>();
    t.mock.method(runtime, 'start', () => gate.promise);
    const app = createApplication(settings, runtime), starting = app.listen(0, '127.0.0.1');
    await flush(); await app.close(); gate.resolve();
    await assert.rejects(starting, /stopping/); assert.equal(app.server.listening, false);
});
