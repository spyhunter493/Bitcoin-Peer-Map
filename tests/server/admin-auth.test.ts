import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createAdminAuthentication } from '../../src/server/admin-auth.ts';
import { parseTrustedProxies } from '../../src/server/trusted-proxies.ts';
import { createApplication } from '../../src/server/app.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from '../layout_server.ts';
import { temporaryDirectory } from './helpers.ts';

const actions = ['/api/peer/connect', '/api/peer/disconnect', '/api/peer/ban', '/api/peer/unban', '/api/bans/clear', '/api/geodb/db-only', '/api/geodb/auto-update', '/api/geodb/update', '/api/connectivity/api-prompt-ack', '/api/config/outbound'];
async function application(t: TestContext, token = FIXTURE_ADMIN_TOKEN, proxies = '') {
    const settings = { ...fixtureSettings(temporaryDirectory(t), token), trusted_proxies: parseTrustedProxies(proxies) }, runtime = new FixtureRuntime(settings);
    const calls: string[] = [];
    for (const name of ['connect', 'disconnect', 'ban', 'unban', 'clearBans'] as const) {
        const original = runtime.node[name];
        t.mock.method(runtime.node, name, (...args: never[]) => { calls.push(name); return Reflect.apply(original, runtime.node, args); });
    }
    t.mock.method(runtime, 'setGeoipDbOnly', () => { calls.push('geoip-api'); return true; });
    t.mock.method(runtime, 'setGeoipAutoUpdate', () => { calls.push('geoip-update'); return true; });
    const updateOutbound = runtime.setOutboundPreference.bind(runtime);
    t.mock.method(runtime, 'setOutboundPreference', (...args: Parameters<typeof updateOutbound>) => { calls.push('outbound'); return updateOutbound(...args); });
    t.mock.method(runtime.geoDatabase, 'update', async () => { calls.push('geodb'); return { success: true, message: 'done' }; });
    t.mock.method(runtime.connectivity, 'acknowledgePrompt', () => { calls.push('ack'); });
    const app = createApplication(settings, runtime);
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: path === '/api/config/outbound' ? '{"preference":"release_checks","enabled":true}' : '{"peer_id":1,"address":"8.8.8.8","enabled":true}' });
    return { base, post, calls };
}

for (const [name, header] of [['missing', ''], ['wrong', `Bearer ${'z'.repeat(64)}`], ['malformed', `Basic ${FIXTURE_ADMIN_TOKEN}`]]) {
    test(`${name} credentials cannot reach any management handler, including CLI requests without Origin`, async t => {
        const { post, calls } = await application(t);
        for (const path of actions) {
            const response = await post(path, header ? { Authorization: header } : {});
            assert.equal(response.status, 401, path);
            assert.match(response.headers.get('www-authenticate')!, /^Bearer /);
            assert.equal(response.headers.get('cache-control'), header ? 'private, no-store' : 'no-store');
            if (header) assert.match(response.headers.get('vary')!, /Authorization/);
            assert.equal((await response.json()).code, 'admin_required');
        }
        assert.deepEqual(calls, []);
    });
}

for (const [name, token] of [['short', 'admin'], ['long', FIXTURE_ADMIN_TOKEN]]) {
    test(`a ${name} configured token authorizes each management route without requiring an Origin header`, async t => {
        const { post, calls } = await application(t, token);
        assert.equal((await post('/api/peer/connect', { Authorization: `Bearer ${token}wrong` })).status, 401);
        assert.deepEqual(calls, [], 'incorrect credentials cannot reach management handlers');
        for (const path of actions) assert.equal((await post(path, { Authorization: `Bearer ${token}` })).status, 200, path);
        assert.equal(calls.length, actions.length);
        const before = calls.length;
        assert.equal((await post('/api/admin/verify', { Authorization: `Bearer ${token}` })).status, 200);
        assert.equal(calls.length, before, 'verification itself never changes settings or calls RPC');
    });
}

test('unset tokens disable every management route and leave dashboard reads available', async t => {
    const { base, post, calls } = await application(t, '');
    for (const path of [...actions, '/api/admin/verify']) {
        const response = await post(path, { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` });
        assert.equal(response.status, 403, path);
        assert.equal((await response.json()).code, 'management_disabled');
    }
    assert.deepEqual(calls, []);
    for (const path of ['/', '/healthz', '/api/peers', '/api/info', '/api/bans', '/api/config']) assert.equal((await fetch(base + path)).status, 200, path);
    assert.deepEqual((await (await fetch(base + '/api/config')).json()).management, { enabled: false });
});

test('retired toggles retain authentication and origin guards without executing a setter', async t => {
    const { post, calls } = await application(t);
    for (const path of ['/api/geodb/toggle-db-only', '/api/geodb/toggle-auto-update']) {
        assert.equal((await post(path)).status, 401);
        assert.equal((await post(path, { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}`, Origin: 'https://other.example' })).status, 403);
        const retired = await post(path, { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` });
        assert.equal(retired.status, 410);
        assert.equal((await retired.json()).code, 'endpoint_retired');
    }
    assert.deepEqual(calls, []);
});

test('token never appears in public responses and OpenAPI describes authentication on every POST', async t => {
    const { base } = await application(t);
    for (const path of ['/', '/api/config', '/api/info', '/api/rpc-info', '/openapi.json']) assert.equal((await (await fetch(base + path)).text()).includes(FIXTURE_ADMIN_TOKEN), false, path);
    const config = await (await fetch(base + '/api/config')).json();
    assert.deepEqual(config.management, { enabled: true });
    const schema = await (await fetch(base + '/openapi.json')).json();
    for (const [path, methods] of Object.entries(schema.paths)) {
        const post = (methods as { post?: { security: unknown; responses: Record<string, unknown> } }).post;
        if (!post) continue;
        if (path === '/api/view/logout' || path === '/api/admin/logout') {
            assert.deepEqual(post.security, [], path);
            assert.ok(post.responses['403'], `${path}: 403`);
            continue;
        }
        assert.deepEqual(post.security, path === '/api/view/verify'
            ? [{ ViewToken: [] }, { AdminToken: [] }, { ViewSession: [] }, { AdminSession: [] }]
            : [{ AdminToken: [] }, { AdminSession: [] }], path);
        for (const status of ['401', '403', '429']) assert.ok(post.responses[status], `${path}: ${status}`);
    }
});

test('the Origin guard remains enforced with valid tokens and tokens in URLs are ignored', async t => {
    const { base, post, calls } = await application(t);
    assert.equal((await post('/api/peer/connect', { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}`, Origin: 'https://other.example' })).status, 403);
    assert.equal((await post('/api/peer/connect?token=' + FIXTURE_ADMIN_TOKEN)).status, 401);
    assert.deepEqual(calls, []);
    assert.equal((await post('/api/peer/connect', { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}`, Origin: base })).status, 200);
});

test('anonymous cooldown ignores untrusted forwarding headers and valid credentials preserve the fixed window', async t => {
    let time = 1000;
    t.mock.method(Date, 'now', () => time);
    const { post, calls } = await application(t);
    for (let i = 0; i < 10; i++) assert.equal((await post('/api/admin/verify', { 'X-Forwarded-For': `192.0.2.${i}` })).status, 401);
    const limited = await post('/api/admin/verify', { 'X-Forwarded-For': '192.0.2.100' });
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
    assert.equal((await limited.json()).code, 'admin_rate_limited');
    time += 15_000;
    for (const path of [...actions, '/api/admin/verify']) {
        const valid = await post(path, { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` });
        assert.equal(valid.status, 200, path);
        assert.equal(valid.headers.get('cache-control'), 'private, no-store');
        assert.match(valid.headers.get('vary')!, /Authorization/);
    }
    assert.equal(calls.length, actions.length);
    const stillLimited = await post('/api/admin/verify');
    assert.equal(stillLimited.status, 429);
    assert.equal(stillLimited.headers.get('retry-after'), '45');
    time += 44_001;
    const lastSecond = await post('/api/admin/verify');
    assert.equal(lastSecond.status, 429);
    assert.equal(lastSecond.headers.get('retry-after'), '1');
    time += 999;
    // Success below the threshold also preserves the remaining anonymous history.
    for (let i = 0; i < 9; i++) assert.equal((await post('/api/admin/verify')).status, 401);
    assert.equal((await post('/api/admin/verify', { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` })).status, 200);
    assert.equal((await post('/api/admin/verify')).status, 401);
    assert.equal((await post('/api/admin/verify')).status, 429);
    assert.equal((await post('/api/admin/verify', { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` })).status, 200);
    assert.equal(calls.length, actions.length);
});

test('replacing the server token rejects the previous credential', async t => {
    const { post, calls } = await application(t, 'replacement-token-'.padEnd(64, 'y'));
    assert.equal((await post('/api/peer/connect', { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` })).status, 401);
    assert.deepEqual(calls, []);
    assert.equal((await post('/api/peer/connect', { Authorization: `Bearer ${'replacement-token-'.padEnd(64, 'y')}` })).status, 200);
});


test('full authentication storage compares credentials and never evicts anonymous windows', t => {
    let time = 1000, comparisons = 0;
    t.mock.method(Date, 'now', () => time);
    const authenticate = createAdminAuthentication(FIXTURE_ADMIN_TOKEN);
    const headers = new Map<string, string>();
    const response = { setHeader: (name: string, value: string) => headers.set(name, value) } as unknown as ServerResponse;
    function request(address: string, valid = false) {
        return { socket: { remoteAddress: address }, rawHeaders: [], headers: { get authorization() { comparisons++; return valid ? `Bearer ${FIXTURE_ADMIN_TOKEN}` : ''; } } } as unknown as IncomingMessage;
    }
    for (let i = 0; i < 1024; i++) {
        time = 1000 + i;
        assert.throws(() => authenticate(request(`192.0.${Math.floor(i / 256)}.${i % 256}`), response), { status: 401 });
    }
    const before = comparisons;
    for (let i = 0; i < 100; i++) {
        assert.doesNotThrow(() => authenticate(request(`198.51.100.${i}`, true), response));
        assert.throws(() => authenticate(request(`198.51.100.${i}`), response), { status: 429 });
    }
    assert.equal(comparisons, before + 200, 'every request checks credentials before full storage');
    assert.equal(headers.get('Retry-After'), '59');
    // The first active window survives overflow and reaches its threshold.
    for (let i = 0; i < 9; i++) assert.throws(() => authenticate(request('192.0.0.0'), response), { status: 401 });
    assert.doesNotThrow(() => authenticate(request('192.0.0.0', true), response));
    assert.throws(() => authenticate(request('192.0.0.0'), response), { status: 429 });
    time = 61_000;
    assert.doesNotThrow(() => authenticate(request('198.51.100.200', true), response));
    assert.throws(() => authenticate(request('198.51.100.200'), response), { status: 401 });
    assert.throws(() => authenticate(request('198.51.100.201'), response), { status: 429 }, 'only one expired slot is available');
});

test('valid credentials short circuit clock, socket and forwarding identity work', t => {
    const authenticate = createAdminAuthentication(FIXTURE_ADMIN_TOKEN, parseTrustedProxies('127.0.0.1'));
    t.mock.method(Date, 'now', () => assert.fail('Valid credentials do not consult anonymous windows'));
    const req = { headers: { authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` }, get socket() { return assert.fail('Valid credentials do not resolve identity'); } } as unknown as IncomingMessage;
    const response = { setHeader() {} } as unknown as ServerResponse;
    assert.doesNotThrow(() => authenticate(req, response));
});

test('supplied bearer tokens are bounded and never truncated to the configured token', () => {
    const token = 'a'.repeat(256), authenticate = createAdminAuthentication(token);
    const response = { setHeader() {} } as unknown as ServerResponse;
    for (const authorization of [`Bearer ${token}a`, `Bearer ${token}=`, `Bearer ${'a'.repeat(8192)}`, `Basic ${token}`, `Bearer ${token} `]) {
        const req = { socket: { remoteAddress: '192.0.2.1' }, rawHeaders: [], headers: { authorization } } as unknown as IncomingMessage;
        assert.throws(() => authenticate(req, response), { status: 401, code: 'admin_required' });
    }
    const req = { headers: { authorization: `bEaReR ${token}` } } as IncomingMessage;
    assert.doesNotThrow(() => authenticate(req, response));
});

test('every management route remains usable when all anonymous windows are occupied', async t => {
    const { post, calls } = await application(t, FIXTURE_ADMIN_TOKEN, '127.0.0.1');
    for (let i = 0; i < 1024; i++) {
        assert.equal((await post('/api/admin/verify', { 'X-Forwarded-For': `192.0.${Math.floor(i / 256)}.${i % 256}` })).status, 401);
    }
    for (const client of ['192.0.0.0', '198.51.100.10']) {
        for (const path of [...actions, '/api/admin/verify']) {
            assert.equal((await post(path, { 'X-Forwarded-For': client, Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` })).status, 200, `${client}: ${path}`);
        }
    }
    assert.equal(calls.length, actions.length * 2);
    const rejected = await post('/api/peer/connect', { 'X-Forwarded-For': '198.51.100.10' });
    assert.equal(rejected.status, 429);
    assert.equal((await rejected.json()).code, 'admin_rate_limited');
    assert.equal(calls.length, actions.length * 2);
});

test('a trusted reverse proxy keeps verified visitors independent despite injected XFF prefixes', async t => {
    const { base, calls } = await application(t, FIXTURE_ADMIN_TOKEN, '127.0.0.1');
    const proxy = createServer((req, res) => {
        const incoming = req.headers['x-forwarded-for'];
        const upstream = httpRequest(base + (req.url || '/'), { method: req.method, headers: { ...req.headers, 'x-forwarded-for': [incoming, req.socket.remoteAddress].filter(Boolean).join(', ') } }, reply => {
            res.writeHead(reply.statusCode!, reply.headers); reply.pipe(res);
        });
        upstream.on('error', () => { res.writeHead(502); res.end(); });
        req.pipe(upstream);
    });
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
    t.after(() => new Promise<void>(resolve => proxy.close(() => resolve())));
    const address = proxy.address(); assert.ok(address && typeof address !== 'string');
    const port = address.port;
    function throughProxy(client: string, path = '/api/admin/verify', valid = false) {
        return new Promise<{ status: number; code?: string }>((resolve, reject) => {
            const req = httpRequest(`http://127.0.0.1:${port}${path}`, { method: 'POST', localAddress: client, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.222', ...(valid ? { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` } : {}) } }, response => {
                let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
                response.on('end', () => resolve({ status: response.statusCode!, code: JSON.parse(body).code }));
            });
            req.on('error', reject); req.end('{"address":"8.8.8.8"}');
        });
    }
    for (let i = 0; i < 10; i++) assert.equal((await throughProxy('127.0.0.2')).status, 401);
    assert.equal((await throughProxy('127.0.0.2')).status, 429);
    assert.equal((await throughProxy('127.0.0.3')).status, 401);
    assert.equal((await throughProxy('127.0.0.2', '/api/peer/connect', true)).status, 200);
    assert.equal((await throughProxy('127.0.0.2')).status, 429);
    assert.deepEqual(calls, ['connect']);
});
