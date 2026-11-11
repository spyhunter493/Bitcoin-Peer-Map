import test from 'node:test';
import assert from 'node:assert/strict';
import { create as createManagement } from '../../src/static/js/core/admin-auth.js';
import { configureAdminAuthentication, configureViewingAuthentication, getAdminJson, postAdminJson } from '../../src/static/js/core/api.js';

function authentication(t, overrides = {}) {
    const scope = new AbortController();
    const state = { revision: 1, cleared: 0, authenticated: true };
    configureAdminAuthentication({ getToken: () => '', isAuthenticated: () => state.authenticated,
        getRevision: () => state.revision, getSignal: () => scope.signal,
        clearToken() { state.cleared++; state.authenticated = false; scope.abort(); },
        requestToken: () => assert.fail('Wallet polling opened a management prompt'), ...overrides });
    configureViewingAuthentication({ getToken: () => 'VIEWER-SECRET', getSignal: () => new AbortController().signal,
        onAuthenticationFailure: () => assert.fail('Wallet polling locked the viewer') });
    t.after(() => { configureAdminAuthentication(null); configureViewingAuthentication(null); });
    return { state, scope };
}

test('wallet reads require management and never send a viewing token or caller bearer', async t => {
    const { state } = authentication(t);
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, ...options }); return Response.json({ wallets: [] }); });
    await getAdminJson('/api/wallets', { headers: { Authorization: 'Bearer VIEWER-SECRET', 'X-Test': 'kept' } });
    assert.equal(calls[0].headers.has('Authorization'), false);
    assert.equal(calls[0].headers.get('X-Test'), 'kept');
    assert.equal(calls[0].cache, 'no-store');
    assert.equal(calls[0].credentials, 'same-origin');
    assert.equal(calls[0].redirect, 'error');
    state.authenticated = false;
    await assert.rejects(getAdminJson('/api/wallets'), { status: 401 });
    await assert.rejects(getAdminJson('https://outside.example/api/wallets'), TypeError);
    assert.equal(calls.length, 1);
});

test('explicit wallet selection posts use only the unlocked management bearer', async t => {
    authentication(t, { getToken: () => 'ADMIN-SECRET' });
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.get('Authorization'), 'Bearer ADMIN-SECRET');
        assert.equal(options.headers.get('Content-Type'), 'application/json');
        assert.deepEqual(JSON.parse(options.body), { wallet_ids: ['opaque-wallet'] });
        return Response.json({ ok: true });
    });
    await postAdminJson('/api/wallets/summary', { wallet_ids: ['opaque-wallet'] });
});

test('management rejection clears wallet access without retrying or prompting, while RPC errors preserve it', async t => {
    let response, calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(response.body, { status: response.status }); });
    for (response of [
        { status: 401, body: { code: 'admin_required' } },
        { status: 403, body: { code: 'management_disabled' } },
        { status: 429, body: { code: 'admin_rate_limited' } },
        { status: 429, body: { code: 'rpc_rate_limited' } },
        { status: 503, body: { code: 'rpc_busy' } },
    ]) {
        const { state } = authentication(t);
        await assert.rejects(getAdminJson('/api/wallets'), { status: response.status });
        assert.equal(state.cleared, response.body.code.startsWith('admin_') || response.body.code === 'management_disabled' ? 1 : 0);
    }
    assert.equal(calls, 5);
});

test('late wallet bodies and stale authentication errors cannot cross a management generation', async t => {
    for (const status of [200, 401]) {
        const { scope, state } = authentication(t);
        let release;
        const body = new Promise(resolve => { release = resolve; });
        t.mock.method(globalThis, 'fetch', async () => ({ ok: status === 200, status, headers: new Headers(), json: () => body }));
        const pending = getAdminJson('/api/wallets');
        scope.abort(new DOMException('Management locked', 'AbortError'));
        state.revision++;
        release({ private: 'OLD-WALLET-BALANCE', code: 'admin_required' });
        await assert.rejects(pending, { name: 'AbortError' });
        assert.equal(state.cleared, 0);
    }
});

test('a stale management denial cannot clear a newly restored session even if transport cancellation is missed', async t => {
    const { state } = authentication(t);
    let release;
    const body = new Promise(resolve => { release = resolve; });
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 401, headers: new Headers(), json: () => body }));
    const pending = getAdminJson('/api/wallets');
    state.revision++;
    release({ code: 'admin_required' });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(state.cleared, 0);
    assert.equal(state.authenticated, true);
});

test('management subscriptions invalidate synchronously and honor long absolute session deadlines', t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const management = createManagement(), snapshots = [];
    const stop = management.subscribe(state => snapshots.push(state));
    assert.equal(snapshots[0].authenticated, false);
    assert.equal(snapshots[0].signal.aborted, true);
    const seconds = 30 * 24 * 60 * 60;
    management.restore({ management_authenticated: true, management_available: true, management_expires_in_seconds: seconds }, 100);
    const active = management.getState();
    assert.equal(active.authenticated, true);
    t.mock.timers.tick(2 ** 31 - 1);
    assert.equal(management.getState().authenticated, true);
    t.mock.timers.tick(seconds * 1000 - 100 - (2 ** 31 - 1) - 1);
    assert.equal(management.getState().authenticated, true);
    t.mock.timers.tick(1);
    assert.equal(management.getState().authenticated, false);
    assert.equal(active.signal.aborted, true);
    assert.equal(snapshots.at(-1).authenticated, false);
    stop();
    const length = snapshots.length;
    management.reset();
    assert.equal(snapshots.length, length);
});

test('an old access revalidation cannot overwrite a replacement management session', async t => {
    const management = createManagement();
    let release;
    const body = new Promise(resolve => { release = resolve; });
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: () => body }));
    const pending = management.revalidate();
    management.restore({ management_authenticated: true, management_available: true });
    release({ management_authenticated: false, management_available: true });
    assert.equal(await pending, false);
    assert.equal(management.getState().authenticated, true);
    management.reset();
});

function browserEnvironment(t) {
    const windowEvents = new EventTarget(), documentEvents = new EventTarget(), lockButton = new EventTarget(), channels = [];
    const values = {
        addEventListener: windowEvents.addEventListener.bind(windowEvents),
        document: { hidden: false, querySelector: () => lockButton, addEventListener: documentEvents.addEventListener.bind(documentEvents) },
        BroadcastChannel: class {
            constructor() { channels.push(this); }
            postMessage(data) { for (const other of channels) if (other !== this) other.onmessage?.({ data }); }
        },
    };
    for (const [key, value] of Object.entries(values)) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
        t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
    }
    t.after(() => configureAdminAuthentication(null));
    return { windowEvents, documentEvents, document: values.document, channels };
}

test('explicit locking invalidates other tabs before logout, while pagehide stays local and failed logout stays closed', async t => {
    const { windowEvents, channels } = browserEnvironment(t);
    const first = createManagement(), second = createManagement();
    first.init(); second.init();
    first.restore(true); second.restore(true);
    let messages = 0;
    for (const channel of channels) {
        const post = channel.postMessage.bind(channel);
        channel.postMessage = data => { messages++; assert.deepEqual(Object.keys(data).sort(), ['nonce', 'type']); post(data); };
    }
    windowEvents.dispatchEvent(new Event('pagehide'));
    assert.equal(messages, 0, 'pagehide never publishes a browser-wide lock');
    first.restore(true); second.restore(true);
    let release;
    t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { release = resolve; }));
    const locking = first.lock();
    assert.equal(first.getState().authenticated, false);
    assert.equal(second.getState().authenticated, false);
    release(Response.json({}, { status: 500 }));
    await locking;
    t.mock.method(globalThis, 'fetch', async () => assert.fail('An incomplete logout revalidated management'));
    assert.equal(await first.revalidate(), false);
    assert.equal(await second.revalidate(), false);
    first.reset(); second.reset();
});

test('returning focus revalidates the management cookie before publishing an unlocked wallet generation', async t => {
    const { windowEvents } = browserEnvironment(t);
    const management = createManagement();
    management.init(); management.restore(true);
    t.after(() => management.reset());
    const prior = management.getState();
    windowEvents.dispatchEvent(new Event('blur'));
    assert.equal(prior.signal.aborted, true);
    assert.equal(management.getState().authenticated, false);
    assert.equal(management.getState().suspended, true, 'blur invalidates credentials while identifying temporary suspension');
    let release;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(url, '/api/access');
        assert.equal(options.cache, 'no-store');
        assert.equal(new Headers(options.headers).has('Authorization'), false);
        return new Promise(resolve => { release = resolve; });
    });
    windowEvents.dispatchEvent(new Event('focus'));
    assert.equal(management.getState().authenticated, false);
    const validated = management.revalidate();
    release(Response.json({ management_available: true, management_authenticated: true, management_expires_in_seconds: 3600 }));
    assert.equal(await validated, true);
    assert.equal(management.getState().authenticated, true);
    assert.equal(management.getState().suspended, false);
});


test('hidden management preserves only suspension until revalidation; explicit reset and expiry end it', t => {
    const { windowEvents, documentEvents, document } = browserEnvironment(t);
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const management = createManagement();
    management.init();
    management.restore({ management_authenticated: true, management_available: true, management_expires_in_seconds: 5 });
    document.hidden = true;
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    assert.equal(management.getState().authenticated, false);
    assert.equal(management.getState().suspended, true);
    t.mock.timers.tick(5000);
    assert.equal(management.getState().suspended, false, 'the original absolute expiry still invalidates a suspended shell');
    management.restore(true);
    windowEvents.dispatchEvent(new Event('blur'));
    assert.equal(management.getState().suspended, true);
    management.reset();
    assert.equal(management.getState().suspended, false, 'explicit lock/reset is not a resumable suspension');
});

test('a second blur rejects in-flight revalidation and a later focus obtains a fresh generation', async t => {
    const { windowEvents } = browserEnvironment(t);
    const management = createManagement();
    management.init(); management.restore(true);
    t.after(() => management.reset());
    const releases = [];
    t.mock.method(globalThis, 'fetch', () => new Promise(resolve => releases.push(resolve)));
    windowEvents.dispatchEvent(new Event('blur'));
    windowEvents.dispatchEvent(new Event('focus'));
    const first = management.revalidate();
    windowEvents.dispatchEvent(new Event('blur'));
    releases.shift()(Response.json({ management_available: true, management_authenticated: true }));
    assert.equal(await first, false);
    assert.equal(management.getState().authenticated, false, 'late focus response cannot restore access after another blur');
    assert.equal(management.getState().suspended, true);
    windowEvents.dispatchEvent(new Event('focus'));
    const second = management.revalidate();
    releases.shift()(Response.json({ management_available: true, management_authenticated: true }));
    assert.equal(await second, true);
    assert.equal(management.getState().suspended, false);
});

test('a failed focus revalidation ends suspension rather than retaining an authorized shell', async t => {
    const { windowEvents } = browserEnvironment(t);
    const management = createManagement();
    management.init(); management.restore(true);
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
    windowEvents.dispatchEvent(new Event('blur'));
    assert.equal(management.getState().suspended, true);
    assert.equal(await management.revalidate(), false);
    assert.equal(management.getState().suspended, false);
    management.reset();
});
