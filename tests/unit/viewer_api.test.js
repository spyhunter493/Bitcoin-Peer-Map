import test from 'node:test';
import assert from 'node:assert/strict';
import { configureViewingAuthentication, configureAdminAuthentication, getJson, postJson } from '../../src/static/js/core/api.js';

test('view tokens authorize only same-origin reads, preserving headers and caller cancellation', async t => {
    const readScope = new AbortController(), caller = new AbortController(), calls = [];
    configureViewingAuthentication({ getToken: () => 'viewer-secret', getSignal: () => readScope.signal, onAuthenticationFailure() {} });
    configureAdminAuthentication(null);
    t.after(() => configureViewingAuthentication(null));
    t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, ...options, headers: new Headers(options.headers) }); return Response.json({ ok: true }); });
    await getJson('/api/peers', { headers: { 'X-Test': 'kept' }, signal: caller.signal });
    assert.equal(calls[0].headers.get('authorization'), 'Bearer viewer-secret');
    assert.equal(calls[0].headers.get('x-test'), 'kept');
    assert.equal(calls[0].cache, 'no-store');
    caller.abort();
    assert.equal(calls[0].signal.aborted, true);
    await getJson('https://external.example/api/info');
    await getJson('/static/assets/map.json');
    await postJson('/api/peer/connect', { address: '8.8.8.8:8333' });
    for (const call of calls.slice(1)) assert.equal(call.headers.has('authorization'), false);
});

test('locking rejects late successful read bodies even when a transport ignores abort', async t => {
    const scope = new AbortController();
    let release;
    const body = new Promise(resolve => { release = resolve; });
    configureViewingAuthentication({ getToken: () => 'viewer', getSignal: () => scope.signal, onAuthenticationFailure() {} });
    t.after(() => configureViewingAuthentication(null));
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: () => body }));
    const pending = getJson('/api/info');
    scope.abort(new DOMException('Viewing locked', 'AbortError'));
    release({ private: 'late-node-detail' });
    await assert.rejects(pending, { name: 'AbortError' });
});

test('authentication failure locks viewing once without retrying protected reads or surfacing private bodies', async t => {
    const scope = new AbortController();
    let calls = 0, locks = 0;
    configureViewingAuthentication({ getToken: () => 'revoked', getSignal: () => scope.signal, onAuthenticationFailure() { locks++; scope.abort(); } });
    t.after(() => configureViewingAuthentication(null));
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ detail: 'View token required', code: 'view_required' }, { status: 401 }); });
    await assert.rejects(getJson('/api/info'), { status: 401 });
    assert.equal(calls, 1);
    assert.equal(locks, 1);
});
