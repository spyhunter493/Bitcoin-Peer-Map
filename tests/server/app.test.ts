import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApplication, assetRevision } from '../../src/server/app.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from '../layout_server.ts';
import { temporaryDirectory, deferred, flush, FakeRpc } from './helpers.ts';
import { NodeService } from '../../src/server/services/node.ts';
import { PeerService } from '../../src/server/services/peers.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { RpcBusyError } from '../../src/server/rpc.ts';
import type { TestContext } from 'node:test';

async function application(t: TestContext, version = 'dev') {
    const settings = { ...fixtureSettings(temporaryDirectory(t)), build_version: version }, runtime = new FixtureRuntime(settings);
    const app = createApplication(settings, runtime);
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`;
    return { app, runtime, base, get: (path: string, options?: RequestInit) => {
        const headers = new Headers(options?.headers);
        if (options?.method === 'POST') headers.set('Authorization', `Bearer ${FIXTURE_ADMIN_TOKEN}`);
        return fetch(base + path, { ...options, headers });
    } };
}
test('application serves health, configuration without credentials, and revisioned dashboard HTML', async t => {
    const { runtime, get } = await application(t);
    assert.equal(runtime.started, true);
    assert.deepEqual(await (await get('/healthz')).json(), { status: 'ok' });
    const config = await (await get('/api/config')).json();
    assert.equal(JSON.stringify(config).includes('secret'), false);
    assert.equal(config.bitcoin_rpc.endpoint, 'http://bitcoin:8332');
    assert.equal(config.build.revision, 'abcdef0123456789');
    assert.equal(config.build.version, 'dev');
    assert.equal(config.repository.github, 'spyhunter493/Bitcoin-Peer-Map');
    const response = await get('/'), html = await response.text();
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.match(html, /data-asset-revision="abcdef0123456789"/);
    assert.match(html, /<script type="module" src="\/static\/v\/abcdef0123456789\/js\/app.js"/);
    const header = html.match(/<header id="topbar">([\s\S]*?)<\/header>/)![1];
    assert.doesNotMatch(header, /abcdef0|View commit|\/commit\//);
    assert.match(html, /class="revision build-version"[^>]*>dev<\/span>/);
    assert.match(html, /id="revision-update"[^>]*hidden/);
    assert.equal(html.includes('{{'), false);
    assert.equal((html.match(/<script/g) || []).length, 1);
});
test('header displays only the release version while internal source and cache metadata stay exact', async t => {
    const { get } = await application(t, 'v1.3.0');
    assert.match(await (await get('/')).text(), /class="revision build-version"[^>]*>v1\.3\.0<\/span>/);
    const config = await (await get('/api/config')).json();
    assert.equal(config.build.version, 'v1.3.0');
    assert.equal(config.build.revision, 'abcdef0123456789');
    assert.equal(config.build.asset_revision, 'abcdef0123456789');
    assert.equal(config.build.revision_url, 'https://github.com/spyhunter493/Bitcoin-Peer-Map/commit/abcdef0123456789');
    assert.equal((await (await get('/openapi.json')).json()).info.version, 'v1.3.0');
});
test('dashboard and configuration share cached update status', async t => {
    const { runtime, get } = await application(t);
    const status = { update_available: true, latest_version: 'v1.4.0', changes_url: 'https://github.com/spyhunter493/Bitcoin-Peer-Map/releases/tag/v1.4.0', checked_at: 1700000000, check_failed: false };
    t.mock.method(runtime.updates, 'snapshot', () => status);
    const info = await (await get('/api/info')).json();
    const config = await (await get('/api/config')).json();
    assert.deepEqual(info.updates, status);
    assert.deepEqual(config.build.updates, status);
});
test('peer list and optional status keep their API contracts', async t => {
    const { get } = await application(t);
    const peers = await get('/api/peers'); assert.equal(peers.headers.get('cache-control'), 'no-store');
    assert.ok(Array.isArray(await peers.json()));
    const snapshot = await (await get('/api/peers?include_status=true')).json();
    assert.ok(Array.isArray(snapshot.peers)); assert.equal(snapshot.status.connected, true);
});
test('price endpoint is removed and node responses do not contain market prices', async t => {
    const { get } = await application(t);
    assert.equal((await get('/api/price')).status, 404);
    const schema = await (await get('/openapi.json')).json();
    assert.equal('/api/price' in schema.paths, false);
    for (const endpoint of ['/api/info', '/api/mempool', '/api/connectivity']) {
        const response = await (await get(endpoint)).json();
        assert.equal(/btc_price|btc_currency|last_known_price|last_price_error|coinbase/.test(JSON.stringify(response)), false);
    }
});
test('HTTP responses preserve partial RPC failures and provider health without returning 500', async t => {
    const { runtime, get } = await application(t);
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), false);
    const connectivity = new ConnectivityService(false, undefined, async () => new Response('', { status: 503 }));
    const node = new NodeService(rpc, connectivity, geo, () => false);
    const peers = new PeerService(rpc, geo, connectivity);
    t.after(() => connectivity.stop());
    t.mock.method(runtime.node, 'dashboardInfo', node.dashboardInfo.bind(node));
    t.mock.method(runtime.peers, 'snapshot', peers.snapshot.bind(peers));
    t.mock.method(runtime.connectivity, 'snapshot', connectivity.snapshot.bind(connectivity));
    rpc.record('getnetworkinfo').localaddresses = [{ address: {}, score: 1 }];
    const response = await get('/api/info');
    assert.equal(response.status, 200);
    const info = await response.json();
    assert.equal(info.connected, 100); assert.equal(info.network_details, null); assert.equal(info.network_scores, null);
    assert.equal(info.last_block.height, 100); assert.equal(info.node_traffic.download_bytes, 2048);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333' }]; await peers.refreshOnce();
    rpc.values.getpeerinfo = [{ id: 1, addr: [] }]; await peers.refreshOnce();
    const snapshotResponse = await get('/api/peers?include_status=true'); assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshot.status.connected, false); assert.equal(snapshot.peers[0].addr, '8.8.8.8:8333');
    const health = await (await get('/api/connectivity')).json();
    assert.equal(health.internet_state, 'green'); assert.equal(health.api_available, true);
    assert.deepEqual(Object.keys(health.providers), ['geoip']); assert.equal(health.providers.geoip.state, 'unknown');
    assert.deepEqual(info.providers, health.providers, 'dashboard exposes independent provider health');
});
test('dashboard and legacy stats share RPC node metrics without reporting host resources', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { runtime, get } = await application(t);
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), false);
    const connectivity = new ConnectivityService(false, undefined, async () => new Response('', { status: 503 }));
    const node = new NodeService(rpc, connectivity, geo, () => false);
    t.after(() => connectivity.stop());
    t.mock.method(runtime.node, 'dashboardInfo', node.dashboardInfo.bind(node));
    t.mock.method(runtime.metrics, 'summary', node.metrics.summary.bind(node.metrics));
    const [infoResponse, statsResponse] = await Promise.all([get('/api/info'), get('/api/stats')]);
    const info = await infoResponse.json(), stats = await statsResponse.json();
    assert.deepEqual(info.node_metrics, stats.system_stats);
    assert.equal(info.node_metrics.uptime_sec, 183840); assert.equal(info.node_metrics.rx_bps, null);
    assert.equal(rpc.count('getnettotals'), 1); assert.equal(rpc.count('uptime'), 1);
    time = 5000; rpc.values.getnettotals = { totalbytesrecv: 4608, totalbytessent: 5376 };
    const next = await (await get('/api/info')).json();
    assert.equal(next.node_metrics.rx_bps, 512); assert.equal(next.node_metrics.tx_bps, 256);
    assert.equal(next.node_traffic.download_bytes, next.node_metrics.download_bytes);
    assert.equal(rpc.count('getnettotals'), 2); assert.equal(rpc.count('uptime'), 2);
    for (const key of ['cpu_pct', 'mem_pct', 'load_1', 'disk_pct']) assert.equal(key in next.node_metrics, false);
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
            const response = await get(path, { method: method.toUpperCase(), ...(method === 'post' ? { body: '{"address":"8.8.8.8","peer_id":1,"enabled":true}', headers: { 'Content-Type': 'application/json' } } : {}) });
            assert.equal(response.status, (methods as Record<string, {deprecated?: boolean}>)[method].deprecated ? 410 : 200, `${method} ${path}`); assert.ok(await response.json());
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
    for (const path of ['/api/blocks/recent?limit=0', '/api/blocks/recent?limit=101', '/api/blocks/recent?limit=1.5', '/api/peers?include_status=maybe']) assert.equal((await get(path)).status, 422, path);
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
    const body = '{"enabled":true}';
    const sameOrigin = await get('/api/geodb/auto-update', { method: 'POST', body, headers: { Origin: base } });
    assert.equal(sameOrigin.status, 200);
    const proxied = await get('/api/geodb/auto-update', { method: 'POST', body, headers: { Origin: base.replace('http:', 'https:') } });
    assert.equal(proxied.status, 200, 'TLS termination can preserve the external Host header');
    const defaultPort = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(`${base}/api/geodb/auto-update`, {
            method: 'POST', headers: { Host: 'bpm.example:443', Origin: 'https://bpm.example', Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` },
        }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.end(body);
    });
    assert.equal(defaultPort, 200, 'default ports are normalized using the external protocol');
    assert.equal((await get('/api/geodb/auto-update', { method: 'POST', body })).status, 200, 'CLI clients need no Origin header');
});
test('GeoIP setters require explicit booleans and return authoritative values', async t => {
    const { runtime, get } = await application(t);
    for (const [path, field] of [['db-only', 'geo_db_only_mode'], ['auto-update', 'auto_update']]) {
        for (const body of ['{}', '{"enabled":null}', '{"enabled":1}', '{"enabled":"true"}', '[]']) {
            assert.equal((await get(`/api/geodb/${path}`, { method: 'POST', body })).status, 422, body);
        }
        for (const enabled of [true, true, false, false]) {
            const response = await get(`/api/geodb/${path}`, { method: 'POST', body: JSON.stringify({ enabled }) });
            assert.equal(response.status, 200);
            assert.equal((await response.json())[field], enabled);
        }
    }
    t.mock.method(runtime, 'setGeoipDbOnly', () => { throw new Error('Settings disk is full'); });
    assert.equal((await get('/api/geodb/db-only', { method: 'POST', body: '{"enabled":true}' })).status, 500);
    assert.equal(runtime.connectivity.snapshot().geo_db_only_mode, false);
});
test('RPC overload returns a retry hint without retrying a mutation', async t => {
    const { runtime, get } = await application(t);
    let attempts = 0;
    t.mock.method(runtime.node, 'connect', () => { attempts++; throw new RpcBusyError(); });
    const response = await get('/api/peer/connect', { method: 'POST', body: '{"address":"8.8.8.8"}' });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.equal((await response.json()).code, 'rpc_busy');
    assert.equal(attempts, 1);
});
test('response disconnection cancels a pending read without mistaking a finished request body for disconnection', async t => {
    const { runtime, base } = await application(t);
    const started = deferred<AbortSignal>(), cancelled = deferred<void>();
    t.mock.method(runtime.node, 'chainTips', (signal?: AbortSignal) => {
        assert.ok(signal); started.resolve(signal);
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
            cancelled.resolve(undefined); reject(signal.reason);
        }, { once: true }));
    });
    const req = request(`${base}/api/chain-tips`);
    req.on('error', () => {});
    req.end();
    const signal = await started.promise;
    await flush();
    assert.equal(signal.aborted, false, 'request completion leaves the response subscriber active');
    req.destroy();
    await cancelled.promise;
    assert.equal(signal.aborted, true);
});
test('SSE emits metrics without blocking HTTP and closes with the application', async t => {
    const { app, runtime, get } = await application(t);
    const schema = await (await get('/openapi.json')).json();
    assert.ok(schema.paths['/api/stream/system'].get.responses['200'].content['text/event-stream']);
    const response = await get('/api/stream/system'); assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const reader = response.body!.getReader();
    let initial = '';
    while (!initial.includes('event: system')) initial += new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /"type":"connected"/); assert.match(initial, /event: system/);
    assert.match(initial, /"uptime_sec":183840/);
    assert.equal(/cpu_pct|mem_pct|disk_pct/.test(initial), false);
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


for (const [chain, port] of [['main', 8333], ['test', 18333], ['testnet4', 48333], ['signet', 38333], ['regtest', 18444]] as const) {
    test(`/api/info exposes configured ${chain} metadata even without blockchain data`, async t => {
        const config = { ...fixtureSettings(temporaryDirectory(t)), bitcoin_network: chain };
        const runtime = new FixtureRuntime(config), app = createApplication(config, runtime);
        const original = runtime.node.dashboardInfo.bind(runtime.node);
        t.mock.method(runtime.node, 'dashboardInfo', async () => ({ ...await original(), blockchain: null }));
        const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
        t.after(() => app.close());
        const base = `http://127.0.0.1:${address.port}`;
        const info = await (await fetch(base + '/api/info')).json();
        assert.equal(info.blockchain, null);
        assert.deepEqual(info.bitcoin_network, { chain, default_peer_port: port });
        const schema = await (await fetch(base + '/openapi.json')).json();
        const response = schema.paths['/api/info'].get.responses['200'].content['application/json'].schema;
        assert.equal(response.$ref, '#/components/schemas/DashboardInfo');
        const fields = schema.components.schemas.DashboardInfo.properties;
        assert.deepEqual(schema.components.schemas.DashboardBlockchain.properties.ibd.type, ['boolean', 'null']);
        assert.equal(fields.bitcoin_network.$ref, '#/components/schemas/BitcoinNetwork');
        assert.deepEqual(schema.components.schemas.BitcoinNetwork.properties.chain.enum, ['main', 'test', 'testnet4', 'signet', 'regtest']);
    });
}
