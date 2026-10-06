import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAdminAuthentication } from '../../src/server/admin-auth.ts';
import { createApplication } from '../../src/server/app.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from '../layout_server.ts';
import { temporaryDirectory } from './helpers.ts';

const actions = ['/api/peer/connect', '/api/peer/disconnect', '/api/peer/ban', '/api/peer/unban', '/api/bans/clear', '/api/geodb/toggle-db-only', '/api/geodb/toggle-auto-update', '/api/geodb/update', '/api/connectivity/api-prompt-ack'];
async function application(t: TestContext, token = FIXTURE_ADMIN_TOKEN) {
    const settings = fixtureSettings(temporaryDirectory(t), token), runtime = new FixtureRuntime(settings);
    const calls: string[] = [];
    for (const name of ['connect', 'disconnect', 'ban', 'unban', 'clearBans'] as const) {
        const original = runtime.node[name];
        t.mock.method(runtime.node, name, (...args: never[]) => { calls.push(name); return Reflect.apply(original, runtime.node, args); });
    }
    t.mock.method(runtime, 'toggleGeoipApi', () => { calls.push('geoip-api'); return true; });
    t.mock.method(runtime, 'toggleGeoipAutoUpdate', () => { calls.push('geoip-update'); return true; });
    t.mock.method(runtime.geoDatabase, 'update', async () => { calls.push('geodb'); return { success: true, message: 'done' }; });
    t.mock.method(runtime.connectivity, 'acknowledgePrompt', () => { calls.push('ack'); });
    const app = createApplication(settings, runtime);
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{"peer_id":1,"address":"8.8.8.8"}' });
    return { base, post, calls };
}

for (const [name, header] of [['missing', ''], ['wrong', `Bearer ${'z'.repeat(64)}`], ['malformed', `Basic ${FIXTURE_ADMIN_TOKEN}`]]) {
    test(`${name} credentials cannot reach any management handler, including CLI requests without Origin`, async t => {
        const { post, calls } = await application(t);
        for (const path of actions) {
            const response = await post(path, header ? { Authorization: header } : {});
            assert.equal(response.status, 401, path);
            assert.match(response.headers.get('www-authenticate')!, /^Bearer /);
            assert.equal(response.headers.get('cache-control'), 'no-store');
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

test('token never appears in public responses and OpenAPI describes authentication on every POST', async t => {
    const { base } = await application(t);
    for (const path of ['/', '/api/config', '/api/info', '/api/rpc-info', '/openapi.json']) assert.equal((await (await fetch(base + path)).text()).includes(FIXTURE_ADMIN_TOKEN), false, path);
    const config = await (await fetch(base + '/api/config')).json();
    assert.deepEqual(config.management, { enabled: true });
    const schema = await (await fetch(base + '/openapi.json')).json();
    for (const [path, methods] of Object.entries(schema.paths)) {
        const post = (methods as { post?: { security: unknown; responses: Record<string, unknown> } }).post;
        if (!post) continue;
        assert.deepEqual(post.security, [{ AdminToken: [] }], path);
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

test('authentication cooldown rejects correct tokens, ignores forwarding headers, and never extends the first-failure window', async t => {
    let time = 1000;
    t.mock.method(Date, 'now', () => time);
    const { post, calls } = await application(t);
    for (let i = 0; i < 10; i++) assert.equal((await post('/api/admin/verify', { 'X-Forwarded-For': `192.0.2.${i}` })).status, 401);
    const limited = await post('/api/admin/verify', { 'X-Forwarded-For': '192.0.2.100' });
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
    assert.equal((await limited.json()).code, 'admin_rate_limited');
    time += 15_000;
    const validBlocked = await post('/api/peer/connect', { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` });
    assert.equal(validBlocked.status, 429);
    assert.equal(validBlocked.headers.get('retry-after'), '45');
    assert.deepEqual(calls, []);
    time += 45_000;
    assert.equal((await post('/api/peer/connect', { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` })).status, 200);
    // A success below the threshold resets history and starts a fresh window.
    for (let i = 0; i < 9; i++) assert.equal((await post('/api/admin/verify')).status, 401);
    assert.equal((await post('/api/admin/verify', { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` })).status, 200);
    for (let i = 0; i < 10; i++) assert.equal((await post('/api/admin/verify')).status, 401);
    assert.equal((await post('/api/admin/verify', { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` })).status, 429);
    assert.deepEqual(calls, ['connect']);
});

test('replacing the server token rejects the previous credential', async t => {
    const { post, calls } = await application(t, 'replacement-token-'.padEnd(64, 'y'));
    assert.equal((await post('/api/peer/connect', { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` })).status, 401);
    assert.deepEqual(calls, []);
    assert.equal((await post('/api/peer/connect', { Authorization: `Bearer ${'replacement-token-'.padEnd(64, 'y')}` })).status, 200);
});


test('full authentication storage rejects untracked clients without evicting or comparing tokens', t => {
    let time = 1000, comparisons = 0;
    t.mock.method(Date, 'now', () => time);
    const authenticate = createAdminAuthentication(FIXTURE_ADMIN_TOKEN);
    const headers = new Map<string, string>();
    const response = { setHeader: (name: string, value: string) => headers.set(name, value) } as unknown as ServerResponse;
    function request(address: string, valid = false) {
        return { socket: { remoteAddress: address }, headers: { get authorization() { comparisons++; return valid ? `Bearer ${FIXTURE_ADMIN_TOKEN}` : ''; } } } as IncomingMessage;
    }
    for (let i = 0; i < 1024; i++) {
        time = 1000 + i;
        assert.throws(() => authenticate(request(`client-${i}`), response), { status: 401 });
    }
    const before = comparisons;
    for (let i = 0; i < 100; i++) assert.throws(() => authenticate(request(`overflow-${i}`, true), response), { status: 429 });
    assert.equal(comparisons, before, 'full storage is checked before credentials');
    assert.equal(headers.get('Retry-After'), '59');
    // The first active window survives overflow and reaches its threshold.
    for (let i = 0; i < 9; i++) assert.throws(() => authenticate(request('client-0'), response), { status: 401 });
    assert.throws(() => authenticate(request('client-0', true), response), { status: 429 });
    assert.equal(comparisons, before + 9);
    time = 61_000;
    assert.doesNotThrow(() => authenticate(request('overflow', true), response));
    assert.throws(() => authenticate(request('overflow'), response), { status: 401 });
    assert.throws(() => authenticate(request('another'), response), { status: 429 }, 'only one expired slot is available');
});
