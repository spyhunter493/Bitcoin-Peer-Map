import test from 'node:test';
import assert from 'node:assert/strict';
import { configureAdminAuthentication, postJson, getJson, HttpError } from '../../src/static/js/core/api.js';

test('management challenge retries once with the same payload and preserves caller headers', async t => {
    let token = 'old', prompts = 0;
    const calls = [];
    configureAdminAuthentication({ getToken: () => token, clearToken: () => { token = ''; }, requestToken: async (_signal, cooldownDeadline) => { assert.equal(cooldownDeadline, undefined); prompts++; return token = 'new'; } });
    t.after(() => configureAdminAuthentication(null));
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, body: options.body, headers: new Headers(options.headers) });
        return Response.json(calls.length === 1 ? { detail: 'Token required', code: 'admin_required' } : { success: true }, { status: calls.length === 1 ? 401 : 200 });
    });
    await postJson('/api/peer/disconnect', { peer_id: 7 }, { headers: new Headers({ 'X-Test': 'preserved' }) });
    assert.equal(prompts, 1); assert.equal(calls.length, 2);
    assert.equal(calls[0].headers.get('authorization'), 'Bearer old');
    assert.equal(calls[1].headers.get('authorization'), 'Bearer new');
    assert.equal(calls[1].headers.get('x-test'), 'preserved');
    assert.equal(calls[0].body, calls[1].body);
});

test('tokens are confined to same-origin management requests and never added to reads', async t => {
    const calls = [];
    configureAdminAuthentication({ getToken: () => 'secret', clearToken() {}, requestToken: async () => assert.fail('Unexpected authentication') });
    t.after(() => configureAdminAuthentication(null));
    t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push(new Headers(options?.headers)); return Response.json({}); });
    await getJson('/api/info');
    await postJson('https://external.example/api/update', {});
    await postJson('/unrelated', {});
    for (const headers of calls) assert.equal(headers.has('authorization'), false);
});

test('cancellation or source-dialog abort prevents a challenged action from being retried', async t => {
    let requests = 0;
    const controller = new AbortController();
    configureAdminAuthentication({ getToken: () => '', clearToken() {}, requestToken: async () => { controller.abort(); return 'new'; } });
    t.after(() => configureAdminAuthentication(null));
    t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ detail: 'Token required' }, { status: 401 }); });
    await assert.rejects(postJson('/api/geodb/update', undefined, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(requests, 1);
    configureAdminAuthentication({ getToken: () => '', clearToken() {}, requestToken: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
    await assert.rejects(postJson('/api/geodb/update'), { name: 'AbortError' });
    assert.equal(requests, 2);
});

test('read-only, server failure, and revoked retry do not cause repeated mutation requests', async t => {
    let status = 403, requests = 0, prompts = 0, clears = 0;
    configureAdminAuthentication({ getToken: () => 'token', clearToken: () => { clears++; }, requestToken: async () => { prompts++; return 'token'; } });
    t.after(() => configureAdminAuthentication(null));
    t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ detail: 'Rejected' }, { status }); });
    for (status of [403, 429, 500]) await assert.rejects(postJson('/api/geodb/toggle-auto-update'), HttpError);
    assert.equal(prompts, 0); assert.equal(requests, 3);
    status = 401;
    await assert.rejects(postJson('/api/geodb/toggle-auto-update'), HttpError);
    assert.equal(prompts, 1); assert.equal(requests, 5); assert.equal(clears, 2);
});

test('authentication cooldown exposes Retry-After and preserves the token without prompting or retrying', async t => {
    let requests = 0, prompts = 0, clears = 0;
    configureAdminAuthentication({ getToken: () => 'stored', clearToken() { clears++; }, requestToken: async () => { prompts++; return 'valid'; } });
    t.after(() => configureAdminAuthentication(null));
    t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        return Response.json({ detail: 'Authentication cooldown active.', code: 'admin_rate_limited' }, { status: 429, headers: { 'Retry-After': '42' } });
    });
    await assert.rejects(postJson('/api/peer/connect', { address: '8.8.8.8' }), error => {
        assert.equal(error.retryAfterSeconds, 42);
        assert.match(error.message, /42 seconds/);
        return error instanceof HttpError;
    });
    assert.equal(prompts, 0); assert.equal(requests, 1); assert.equal(clears, 0);
});

test('an anonymous authentication cooldown prompts and replays the action once', async t => {
    let token = '', prompts = 0, clears = 0;
    const calls = [];
    configureAdminAuthentication({ getToken: () => token, clearToken() { clears++; token = ''; }, requestToken: async () => { prompts++; return token = 'valid'; } });
    t.after(() => configureAdminAuthentication(null));
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, body: options.body, headers: new Headers(options.headers) });
        return calls.length === 1
            ? Response.json({ code: 'admin_rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } })
            : Response.json({ success: true });
    });
    assert.deepEqual(await postJson('/api/peer/connect', { address: '8.8.8.8' }, { headers: { 'X-Test': 'preserved' } }), { success: true });
    assert.equal(prompts, 1); assert.equal(clears, 0); assert.equal(calls.length, 2);
    assert.equal(calls[0].headers.has('authorization'), false);
    assert.equal(calls[1].headers.get('authorization'), 'Bearer valid');
    assert.equal(calls[1].headers.get('x-test'), 'preserved');
    assert.equal(calls[0].body, calls[1].body);
});

test('anonymous unrelated cooldowns are not authentication challenges', async t => {
    let requests = 0;
    configureAdminAuthentication({ getToken: () => '', clearToken: () => assert.fail('Unexpected token clear'), requestToken: async () => assert.fail('Unexpected authentication') });
    t.after(() => configureAdminAuthentication(null));
    for (const body of [{ code: 'rpc_rate_limited' }, {}, null, 'admin_rate_limited']) {
        t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json(body, { status: 429 }); });
        await assert.rejects(postJson('/api/peer/connect'), { status: 429 });
    }
    assert.equal(requests, 4);
});

test('an initial anonymous cooldown hands its deadline and cancellation signal to the prompt', async t => {
    const controller = new AbortController();
    t.mock.method(Date, 'now', () => 5000);
    t.after(() => configureAdminAuthentication(null));
    for (const [retryAfter, expectedDeadline] of [['42', 47000], [new Date(70000).toUTCString(), 70000], [null, 65000], ['invalid', 65000], ['0', 5000]]) {
        let requests = 0, prompts = 0;
        configureAdminAuthentication({ getToken: () => '', clearToken() {}, requestToken: async (signal, cooldownDeadline) => {
            assert.equal(signal, controller.signal);
            assert.equal(cooldownDeadline, expectedDeadline);
            prompts++;
            return 'valid';
        } });
        t.mock.method(globalThis, 'fetch', async () => ++requests === 1
            ? Response.json({ code: 'admin_rate_limited' }, { status: 429, headers: retryAfter === null ? {} : { 'Retry-After': retryAfter } })
            : Response.json({ success: true }));
        await postJson('/api/peer/connect', { address: '8.8.8.8' }, { signal: controller.signal });
        assert.equal(prompts, 1);
        assert.equal(requests, 2, 'authentication replays only the challenged action');
    }
});

test('an anonymous cooldown cancellation or failed replay never retries the management action again', async t => {
    let token = '', requests = 0, prompts = 0;
    const controller = new AbortController();
    configureAdminAuthentication({ getToken: () => token, clearToken() { token = ''; }, requestToken: async () => { controller.abort(); return 'valid'; } });
    t.after(() => configureAdminAuthentication(null));
    t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ code: 'admin_rate_limited' }, { status: 429 }); });
    await assert.rejects(postJson('/api/peer/connect', undefined, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(requests, 1);
    configureAdminAuthentication({ getToken: () => token, clearToken() { token = ''; }, requestToken: async () => { prompts++; return token = 'valid'; } });
    await assert.rejects(postJson('/api/peer/connect'), { status: 429 });
    assert.equal(requests, 3); assert.equal(prompts, 1); assert.equal(token, 'valid');
});

test('a cooldown on the authenticated retry preserves the newly verified token', async t => {
    let token = 'old', requests = 0, prompts = 0;
    configureAdminAuthentication({ getToken: () => token, clearToken() { token = ''; }, requestToken: async () => { prompts++; return token = 'new'; } });
    t.after(() => configureAdminAuthentication(null));
    t.mock.method(globalThis, 'fetch', async () => ++requests === 1
        ? Response.json({ code: 'admin_required' }, { status: 401 })
        : Response.json({ code: 'admin_rate_limited' }, { status: 429, headers: { 'Retry-After': '5' } }));
    await assert.rejects(postJson('/api/peer/connect'), { status: 429, retryAfterSeconds: 5 });
    assert.equal(token, 'new'); assert.equal(prompts, 1); assert.equal(requests, 2);
});

test('an already canceled management action sends no request and opens no prompt', async t => {
    const controller = new AbortController();
    controller.abort();
    configureAdminAuthentication({ getToken: () => '', clearToken: () => assert.fail('Unexpected token clear'), requestToken: async () => assert.fail('Unexpected prompt') });
    t.after(() => configureAdminAuthentication(null));
    t.mock.method(globalThis, 'fetch', async () => assert.fail('Canceled action reached fetch'));
    await assert.rejects(postJson('/api/peer/ban', { peer_id: 1 }, { signal: controller.signal }), { name: 'AbortError' });
});

test('cancellation rejects late management bodies without prompting, retrying, or clearing tokens', async t => {
    t.after(() => configureAdminAuthentication(null));
    for (const status of [200, 401, 429, 500]) {
        const controller = new AbortController();
        let release, calls = 0;
        const body = new Promise(resolve => { release = resolve; });
        configureAdminAuthentication({ getToken: () => status === 429 ? '' : 'stored', clearToken: () => assert.fail('Canceled response cleared token'), requestToken: async () => assert.fail('Canceled response opened prompt') });
        t.mock.method(globalThis, 'fetch', async () => {
            calls++;
            // Deliberately ignore abort, as a late parsed body must still be rejected.
            return { ok: status === 200, status, headers: new Headers(), json: () => body };
        });
        const pending = postJson('/api/peer/ban', { peer_id: 1 }, { signal: controller.signal });
        controller.abort();
        release({ success: true, banned_ip: 'PRIVATE-ADDRESS', code: 'admin_rate_limited' });
        await assert.rejects(pending, { name: 'AbortError' });
        assert.equal(calls, 1);
    }
});

test('cancellation rejects late authenticated retries without clearing the replacement token', async t => {
    t.after(() => configureAdminAuthentication(null));
    for (const status of [200, 401, 500]) {
        const controller = new AbortController();
        let release, calls = 0, prompts = 0, token = 'old', clears = 0;
        const body = new Promise(resolve => { release = resolve; });
        configureAdminAuthentication({ getToken: () => token, clearToken() { token = ''; clears++; }, requestToken: async () => { prompts++; return token = 'replacement'; } });
        let receivedRetry;
        const retry = new Promise(resolve => { receivedRetry = resolve; });
        t.mock.method(globalThis, 'fetch', async () => {
            if (++calls === 1) return Response.json({ detail: 'Token required' }, { status: 401 });
            receivedRetry();
            return { ok: status === 200, status, headers: new Headers(), json: () => body };
        });
        const pending = postJson('/api/peer/disconnect', { peer_id: 1 }, { signal: controller.signal });
        await retry;
        controller.abort();
        release({ success: true, detail: 'PRIVATE-RETRY-ERROR' });
        await assert.rejects(pending, { name: 'AbortError' });
        assert.equal(token, 'replacement');
        assert.equal(clears, 1, 'only the active initial authentication challenge clears a token');
        assert.equal(prompts, 1);
        assert.equal(calls, 2);
    }
});
