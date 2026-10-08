import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchema, ValidateFunction } from 'ajv';
import type { TestContext } from 'node:test';
import { createApplication } from '../../src/server/app.ts';
import { NodeService } from '../../src/server/services/node.ts';
import { PeerService } from '../../src/server/services/peers.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { RpcBusyError } from '../../src/server/rpc.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from '../layout_server.ts';
import { temporaryDirectory, FakeRpc } from './helpers.ts';

type Schema = Record<string, unknown>;
interface ResponseContract { $ref?: string; content?: Record<string, { schema: Schema }> }
interface Operation {
    responses: Record<string, ResponseContract>;
    requestBody?: { content: Record<string, { schema: Schema }> };
    'x-events'?: Record<string, Schema>;
}
interface Specification {
    paths: Record<string, Partial<Record<'get' | 'post', Operation>>>;
    components: { schemas: Record<string, Schema>; responses: Record<string, ResponseContract> };
}
const specification: Specification = JSON.parse(readFileSync(new URL('../../src/server/openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validators = new Map<string, ValidateFunction>();

// OpenAPI components use document-local references; adapt only their locations for Ajv.
function schemaReferences(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(schemaReferences);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
        key === '$ref' && typeof child === 'string' ? child.replace('#/components/schemas/', '#/$defs/') : schemaReferences(child),
    ]));
    return value;
}
function compile(schema: Schema): ValidateFunction {
    const adapted = schemaReferences({ ...schema, $defs: specification.components.schemas }) as AnySchema;
    return ajv.compile(adapted);
}
function responseSchema(path: string, method: 'get' | 'post', status: number, contentType = 'application/json'): Schema {
    const operation = specification.paths[path]?.[method];
    assert.ok(operation, `${method.toUpperCase()} ${path} must be documented`);
    let response = operation.responses[status] || operation.responses.default;
    assert.ok(response, `${method.toUpperCase()} ${path} ${status} must be documented`);
    if (response.$ref) response = specification.components.responses[response.$ref.split('/').at(-1)!];
    const schema = response.content?.[contentType]?.schema;
    assert.ok(schema, `${method.toUpperCase()} ${path} ${status} needs a ${contentType} schema`);
    return schema;
}
function validateResponse(path: string, method: 'get' | 'post', status: number, body: unknown): void {
    const key = `${method} ${path} ${status}`;
    let validate = validators.get(key);
    if (!validate) { validate = compile(responseSchema(path, method, status)); validators.set(key, validate); }
    assert.equal(validate(body), true, `${key}: ${ajv.errorsText(validate.errors, { dataVar: 'response' })}`);
}
async function application(t: TestContext, real = false, token = FIXTURE_ADMIN_TOKEN) {
    const settings = fixtureSettings(temporaryDirectory(t), token);
    const runtime = new FixtureRuntime(settings), rpc = new FakeRpc();
    const geo = new GeoDatabase(settings.data_dir, false), connectivity = new ConnectivityService();
    const node = new NodeService(rpc, connectivity, geo, () => false);
    const peers = new PeerService(rpc, geo, connectivity, undefined, async () => Response.json({
        status: 'success', country: 'NZ', lat: '1.5', lon: '2.5', city: { provider_extension: true },
        isp: ['retained'], offset: 'provider-offset', mobile: 1, proxy: false, hosting: 0,
    }));
    if (real) {
        rpc.values.getblockchaininfo = { chain: 'main', blocks: 1, bestblockhash: 'block-1', size_on_disk: 1e9, extra: { retained: true } };
        rpc.values.getblockheader = { height: 1, time: 1000 };
        rpc.values.getblock = (params: unknown[]) => ({ height: params[0] === 'block-1' ? 1 : 0, time: 1000, size: 100, nTx: 1, previousblockhash: params[0] === 'block-1' ? 'block-0' : undefined });
        rpc.values.getchaintips = [{ height: 1, hash: 'block-1', branchlen: 0, status: 'active' }];
        rpc.values.listbanned = [{ address: '192.0.2.0/24', ban_created: 1000, banned_until: 2000, extension: true }];
        rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333' }, { id: 2, addr: 'peer.onion', network: 'onion' }];
        await peers.refreshOnce(); await peers.resolveGeo('8.8.8.8', 'ipv4');
        Object.assign(runtime, { node, peers, metrics: node.metrics, connectivity, geoDatabase: geo });
    }
    const app = createApplication(settings, runtime);
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(async () => { await app.close(); await peers.stop(); await connectivity.stop(); geo.close(); });
    const base = `http://127.0.0.1:${address.port}`;
    async function json(path: string, method: 'get' | 'post' = 'get', body?: unknown, options: RequestInit = {}) {
        const headers = new Headers(options.headers);
        if (method === 'post' && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${FIXTURE_ADMIN_TOKEN}`);
        if (body !== undefined) headers.set('Content-Type', 'application/json');
        const response = await fetch(base + path, { ...options, method: method.toUpperCase(), headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const value: unknown = await response.json();
        validateResponse(path.split('?')[0], method, response.status, value);
        return { response, value };
    }
    return { base, json, runtime, rpc, node, peers, connectivity };
}
const bodies: Record<string, unknown> = {
    '/api/peer/connect': { address: '8.8.8.8' }, '/api/peer/disconnect': { peer_id: '1' },
    '/api/peer/ban': { peer_id: 1 }, '/api/peer/unban': { address: '8.8.8.8' },
    '/api/geodb/db-only': { enabled: true }, '/api/geodb/auto-update': { enabled: true },
    '/api/config/outbound': { preference: 'release_checks', enabled: false },
};

test('all documented JSON routes validate real serialized service responses and browser fixtures', async t => {
    for (const real of [false, true]) {
        const { json } = await application(t, real);
        for (const [path, operations] of Object.entries(specification.paths)) for (const method of ['get', 'post'] as const) {
            const operation = operations[method];
            if (!operation?.responses['200']?.content?.['application/json']) continue;
            if (operation.requestBody) {
                const validate = compile(operation.requestBody.content['application/json'].schema);
                assert.equal(validate(bodies[path]), true, `${method} ${path} request: ${ajv.errorsText(validate.errors)}`);
            }
            const result = await json(path, method, method === 'post' ? bodies[path] : undefined);
            assert.equal(result.response.status, 200, `${real ? 'real serializers' : 'fixture'} ${method} ${path}`);
        }
        await json('/api/peers?include_status=true');
    }
});

test('contracts preserve string peer ports, nullable first metrics, raw provider metadata and RPC extensions', async t => {
    const { json } = await application(t, true);
    const { value } = await json('/api/peers');
    assert.ok(Array.isArray(value));
    assert.equal(value[0].port, '8333'); assert.equal(value[1].port, '');
    assert.deepEqual(value[0].city, { provider_extension: true }); assert.deepEqual(value[0].isp, ['retained']);
    assert.equal(value[0].offset, 'provider-offset'); assert.equal(value[0].mobile, 1); assert.equal(value[0].hosting, 0);
    assert.equal(value[0].lat, 1.5); assert.equal(value[0].lon, 2.5);
    const info = (await json('/api/info')).value as { node_metrics: { rx_bps: null; tx_bps: null }; updates: unknown };
    assert.equal(info.node_metrics.rx_bps, null); assert.equal(info.node_metrics.tx_bps, null); assert.ok(info.updates);
    const blockchain = (await json('/api/blockchain')).value as { blockchain: { extra: unknown; initialblockdownload: null } };
    assert.deepEqual(blockchain.blockchain.extra, { retained: true }); assert.equal(blockchain.blockchain.initialblockdownload, null);
});

test('stale snapshots, partial RPC reads, complete failures and application action failures match contracts', async t => {
    const { json, rpc, peers } = await application(t, true);
    rpc.failed.add('getpeerinfo'); await peers.refreshOnce();
    const snapshot = (await json('/api/peers?include_status=true')).value as { peers: unknown[]; status: { connected: boolean } };
    assert.equal(snapshot.status.connected, false); assert.equal(snapshot.peers.length, 2);
    rpc.failed.add('getnetworkinfo'); rpc.failed.add('getnettotals');
    const info = (await json('/api/info')).value as { connected: null; node_metrics: { rx_bps: null }; last_block: unknown };
    assert.equal(info.connected, null); assert.equal(info.node_metrics.rx_bps, null); assert.ok(info.last_block);
    const failures = await application(t, true);
    for (const method of ['getblockchaininfo', 'getchaintips', 'getmempoolinfo', 'listbanned', 'addnode', 'disconnectnode', 'setban', 'clearbanned']) failures.rpc.failed.add(method);
    for (const path of ['/api/mempool', '/api/blockchain', '/api/blocks/recent', '/api/chain-tips', '/api/bans']) {
        const result = (await failures.json(path)).value as { error: string; summary?: null };
        assert.equal(typeof result.error, 'string');
        if ('summary' in result) assert.equal(result.summary, null);
    }
    for (const path of ['/api/peer/connect', '/api/peer/disconnect', '/api/peer/ban', '/api/peer/unban', '/api/bans/clear']) {
        assert.equal(((await failures.json(path, 'post', bodies[path])).value as { success: boolean }).success, false);
    }
});

test('request compatibility and HTTP validation, retired, authentication, throttle and RPC-busy errors match contracts', async t => {
    const { json, runtime } = await application(t);
    for (const peer_id of [1, '1', null, undefined]) await json('/api/peer/disconnect', 'post', { peer_id });
    for (const enabled of ['true', '1', 'YES', 'on', 'false', '0', 'No', 'OFF']) await json(`/api/peers?include_status=${enabled}`);
    for (const path of ['/api/geodb/toggle-db-only', '/api/geodb/toggle-auto-update']) assert.equal((await json(path, 'post')).response.status, 410);
    for (const body of [{ enabled: 1 }, {}, []]) assert.equal((await json('/api/geodb/db-only', 'post', body)).response.status, 422);
    assert.equal((await json('/api/peer/disconnect', 'post', { peer_id: false })).response.status, 422);
    assert.equal((await json('/api/peer/connect', 'post', { address: 'x'.repeat(65536) })).response.status, 413);
    assert.equal((await json('/api/peer/connect', 'post', {}, { headers: { Origin: 'https://elsewhere.example' } })).response.status, 403);
    assert.equal((await json('/api/peers?include_status=invalid')).response.status, 422);
    assert.equal((await json('/api/blocks/recent?limit=0')).response.status, 422);
    t.mock.method(runtime.node, 'mempool', async () => { throw new RpcBusyError(); });
    assert.equal((await json('/api/mempool')).response.status, 503);
    for (let index = 0; index < 10; index++) assert.equal((await json('/api/admin/verify', 'post', undefined, { headers: { Authorization: 'Bearer invalid' } })).response.status, 401);
    assert.equal((await json('/api/admin/verify', 'post', undefined, { headers: { Authorization: 'Bearer invalid' } })).response.status, 429);
    const disabled = await application(t, false, '');
    assert.equal((await disabled.json('/api/admin/verify', 'post')).response.status, 403);
});

test('Addrman uncertainty stays explicit in both peer API response forms across refreshes', async t => {
    const { json, peers, rpc } = await application(t, true);
    async function check(status: string) {
        const list = (await json('/api/peers')).value as Record<string, unknown>[];
        const snapshot = (await json('/api/peers?include_status=true')).value as { peers: Record<string, unknown>[] };
        for (const result of [list, snapshot.peers]) {
            assert.equal(result[0].addrman_status, status);
            assert.equal(result[0].in_addrman, status === 'present');
            assert.equal(result[1].addrman_status, 'unavailable', 'A peer without an explicit port has no usable endpoint identity');
        }
    }
    await check('unavailable');
    rpc.values.getnodeaddresses = [{ address: '8.8.8.8', port: 8334 }];
    await peers.refreshKnownAddresses(); await check('not_returned');
    rpc.values.getnodeaddresses = [{ address: '8.8.8.8', port: 8333 }];
    await peers.refreshKnownAddresses(); await check('present');
    rpc.failed.add('getnodeaddresses');
    await peers.refreshKnownAddresses(); await check('unavailable');
    rpc.failed.clear(); rpc.values.getnodeaddresses = [];
    await peers.refreshKnownAddresses(); await check('not_returned');
    rpc.values.getnodeaddresses = [{ address: '8.8.8.8', port: 8333 }];
    await peers.refreshKnownAddresses(); await check('present');
});

test('SSE connected and system event payloads validate against the documented event schemas', async t => {
    const { base } = await application(t, true);
    const controller = new AbortController(); t.after(() => controller.abort());
    const response = await fetch(base + '/api/stream/system', { signal: controller.signal });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const reader = response.body!.getReader(); let buffer = '', count = 0;
    const events = specification.paths['/api/stream/system'].get!['x-events']!;
    while (count < 2) {
        const { done, value } = await reader.read(); assert.equal(done, false);
        buffer += new TextDecoder().decode(value);
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const name = /^event: (.+)$/m.exec(frame)![1], payload: unknown = JSON.parse(/^data: (.+)$/m.exec(frame)![1]);
            const validate = compile(events[name]); assert.equal(validate(payload), true, ajv.errorsText(validate.errors));
            count++;
        }
    }
    await reader.cancel(); controller.abort();
});

test('schema validation rejects drift in field types, required fields and nullable envelopes', async t => {
    const { json } = await application(t, true);
    const peers = (await json('/api/peers')).value as Record<string, unknown>[];
    const peer = compile(specification.components.schemas.Peer);
    assert.equal(peer({ ...peers[0], port: 8333 }), false);
    assert.equal(peer({ ...peers[0], ping_ms: '5' }), false);
    for (const addrman_status of ['present', 'not_returned', 'unavailable']) {
        assert.equal(peer({ ...peers[0], addrman_status }), true);
    }
    for (const addrman_status of ['absent', '', null, true]) {
        assert.equal(peer({ ...peers[0], addrman_status }), false);
    }
    const missingStatus = { ...peers[0] }; delete missingStatus.addrman_status;
    assert.equal(peer(missingStatus), false, 'Every peer response carries its Addrman uncertainty status');
    const missing = { ...peers[0] }; delete missing.id; assert.equal(peer(missing), false);
    const info = (await json('/api/info')).value as Record<string, unknown>; delete info.node_metrics;
    assert.equal(compile(specification.components.schemas.DashboardInfo)(info), false);
    const blocks = compile(specification.components.schemas.RecentBlocksResponse);
    assert.equal(blocks({ success: false, blocks: [], error: 'offline', summary: null }), true);
    assert.equal(blocks({ success: false, blocks: [], error: 12, summary: null }), false);
    assert.equal(blocks({ success: false, blocks: [], error: 'offline' }), false);
    const enabled = compile(specification.components.schemas.EnabledRequest);
    assert.equal(enabled({ enabled: 'true' }), false); assert.equal(enabled({}), false);
    const address = compile(specification.components.schemas.AddressRequest);
    assert.equal(address({}), true); assert.equal(address({ address: null }), true); assert.equal(address({ address: false }), false);
    const peerId = compile(specification.components.schemas.PeerIdRequest);
    for (const peer_id of [1, '1', null, undefined]) assert.equal(peerId({ peer_id }), true);
    assert.equal(peerId({ peer_id: false }), false); assert.equal(peerId({ peer_id: 1.5 }), false);
});

test('code generation is reproducible and check:api detects stale artifacts without modifying them', t => {
    const generator = fileURLToPath(new URL('../../scripts/api-codegen/generate.js', import.meta.url));
    const output = join(temporaryDirectory(t), 'api.generated.d.ts');
    const run = (...arguments_: string[]) => spawnSync(process.execPath, [generator, '--output', output, ...arguments_], { encoding: 'utf8' });
    const generated = run(); assert.equal(generated.status, 0, generated.stderr);
    const declarations = readFileSync(output, 'utf8');
    assert.equal(declarations, readFileSync(new URL('../../src/shared/api.generated.d.ts', import.meta.url), 'utf8'));
    assert.equal(run('--check').status, 0);
    writeFileSync(output, declarations + '// stale\n');
    const stale = run('--check'); assert.equal(stale.status, 1); assert.match(stale.stderr, /out of date/);
    assert.equal(readFileSync(output, 'utf8'), declarations + '// stale\n');
});
