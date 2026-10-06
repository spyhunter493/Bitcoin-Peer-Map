import test from 'node:test';
import assert from 'node:assert/strict';
import { configureAdminAuthentication, postJson, getJson, HttpError } from '../../src/static/js/core/api.js';

test('management challenge retries once with the same payload and preserves caller headers', async t => {
    let token = 'old', prompts = 0;
    const calls = [];
    configureAdminAuthentication({ getToken: () => token, clearToken: () => { token = ''; }, requestToken: async () => { prompts++; return token = 'new'; } });
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
