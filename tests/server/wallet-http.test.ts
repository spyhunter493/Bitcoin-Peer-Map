import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../../src/server/app.ts';
import { createBrowserSessions, BROWSER_SESSION_SECONDS } from '../../src/server/browser-sessions.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from '../layout_server.ts';
import { temporaryDirectory, deferred } from './helpers.ts';

const VIEW_TOKEN = 'wallet-test-view-token';
const paths = ['/api/wallets', '/api/wallets/preferences'];
const selected = { selected_wallets: ['watch-descriptor'], unit: 'BTC', rotation_seconds: 8, paused: false };

async function application(t: TestContext, mode: 'public' | 'authenticated' | 'redacted' = 'public', adminToken = FIXTURE_ADMIN_TOKEN) {
    const settings = { ...fixtureSettings(temporaryDirectory(t), adminToken), view_mode: mode, view_token: VIEW_TOKEN };
    const runtime = new FixtureRuntime(settings), app = createApplication(settings, runtime);
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`;
    async function login(role: 'view' | 'admin', token = role === 'view' ? VIEW_TOKEN : adminToken) {
        const response = await fetch(`${base}/api/${role}/verify`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: base, 'X-BPM-Remember': '1' } });
        assert.equal(response.status, 200);
        return response.headers.getSetCookie()[0].split(';')[0];
    }
    return { base, runtime, login };
}
function privateHeaders(response: Response) {
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('vary') || '', /\bAuthorization\b/);
    assert.match(response.headers.get('vary') || '', /\bCookie\b/);
}

test('wallet GET, HEAD and POST require administrator authentication before data or parsing in every viewing mode', async t => {
    for (const mode of ['public', 'authenticated', 'redacted'] as const) for (const token of [null, VIEW_TOKEN]) {
        const { base, runtime } = await application(t, mode);
        const snapshot = t.mock.method(runtime.wallets, 'snapshot'), preferences = t.mock.method(runtime.wallets, 'preferences'), save = t.mock.method(runtime.wallets, 'setPreferences');
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        for (const path of paths) for (const method of ['GET', 'HEAD']) {
            const response = await fetch(base + path, { method, headers });
            assert.equal(response.status, 401, `${mode}: ${method} ${path}`); privateHeaders(response);
            if (method === 'GET') assert.equal((await response.json()).code, 'admin_required');
        }
        const invalidBody = await fetch(base + '/api/wallets/preferences', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{' });
        assert.equal(invalidBody.status, 401); privateHeaders(invalidBody);
        assert.equal(snapshot.mock.callCount(), 0); assert.equal(preferences.mock.callCount(), 0); assert.equal(save.mock.callCount(), 0);
        for (const path of paths) for (const method of ['GET', 'HEAD']) {
            const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` } });
            assert.equal(response.status, 200); privateHeaders(response);
        }
    }
});

test('wallet cookies require management rather than viewing login, and explicit wrong bearer cannot fall back', async t => {
    const { base, login } = await application(t, 'authenticated');
    for (const cookie of [await login('view'), await login('view', FIXTURE_ADMIN_TOKEN)]) {
        const response = await fetch(base + '/api/wallets', { headers: { Cookie: cookie } });
        assert.equal(response.status, 401); assert.equal((await response.json()).code, 'admin_required'); privateHeaders(response);
    }
    const admin = await login('admin');
    const valid = await fetch(base + '/api/wallets', { headers: { Cookie: admin } });
    assert.equal(valid.status, 200); privateHeaders(valid);
    for (const bearer of ['Bearer invalid', `Bearer ${VIEW_TOKEN}`]) {
        const invalid = await fetch(base + '/api/wallets', { headers: { Cookie: admin, Authorization: bearer } });
        assert.equal(invalid.status, 401); privateHeaders(invalid);
    }
    const saved = await fetch(base + '/api/wallets/preferences', { method: 'POST', headers: { Cookie: admin, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(selected) });
    assert.equal(saved.status, 200); privateHeaders(saved);
    const read = await fetch(base + '/api/wallets/preferences', { headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` } });
    assert.deepEqual((await read.json()).preferences, selected);
});

test('revoking a management session aborts wallet work and discards a delayed balance response', async t => {
    const { base, runtime, login } = await application(t, 'public');
    const cookie = await login('admin'), original = await runtime.wallets.snapshot();
    original.wallets[0].name = 'private-wallet-must-not-return';
    const started = deferred<AbortSignal>(), pending = deferred<typeof original>();
    t.mock.method(runtime.wallets, 'snapshot', (signal?: AbortSignal) => {
        assert.ok(signal); started.resolve(signal); return pending.promise;
    });
    const request = fetch(base + '/api/wallets', { headers: { Cookie: cookie } });
    const signal = await started.promise;
    const logout = await fetch(base + '/api/admin/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
    assert.equal(logout.status, 200); assert.equal(signal.aborted, true);
    pending.resolve(original);
    const response = await request;
    assert.equal(response.status, 401); privateHeaders(response);
    assert.doesNotMatch(await response.text(), /private-wallet-must-not-return|12345678/);
});

test('revoking management during gzip discards the encoded wallet response before success headers are installed', async () => {
    // Install the gzip gate before the application's promisified compressor is
    // imported. A separate process keeps that built-in mock out of other tests.
    const script = `
        import assert from 'node:assert/strict';
        import zlib from 'node:zlib';
        import { syncBuiltinESMExports } from 'node:module';
        const originalGzip = zlib.gzip;
        let beginCompression, releaseCompression;
        const compressing = new Promise(resolve => { beginCompression = resolve; });
        zlib.gzip = (bytes, options, callback) => {
            if (String(bytes).includes('private-wallet-compression-sentinel')) {
                beginCompression();
                releaseCompression = () => originalGzip(bytes, options, callback);
            } else originalGzip(bytes, options, callback);
        };
        syncBuiltinESMExports();
        const { createApplication } = await import('./src/server/app.ts');
        const { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } = await import('./tests/layout_server.ts');
        const settings = fixtureSettings(), runtime = new FixtureRuntime(settings);
        runtime.wallets.snapshot = async () => ({ state: 'ready', network: 'main', generated_at: 1, reason: null,
            wallets: Array.from({ length: 20 }, (_, index) => ({ name: 'private-wallet-compression-sentinel-' + index,
                state: 'ready', balance_sats: 12345678, pending_incoming_sats: 0, immature_sats: 0, scanning_progress: null, updated_at: 1 })) });
        const app = createApplication(settings, runtime);
        try {
            const address = await app.listen(0, '127.0.0.1'), base = 'http://127.0.0.1:' + address.port;
            const login = await fetch(base + '/api/admin/verify', { method: 'POST', headers: {
                Authorization: 'Bearer ' + FIXTURE_ADMIN_TOKEN, Origin: base, 'X-BPM-Remember': '1' } });
            assert.equal(login.status, 200);
            const cookie = login.headers.getSetCookie()[0].split(';')[0];
            const walletResponse = fetch(base + '/api/wallets', { headers: { Cookie: cookie, 'Accept-Encoding': 'gzip' } });
            await compressing;
            const logout = await fetch(base + '/api/admin/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
            assert.equal(logout.status, 200);
            releaseCompression();
            const response = await walletResponse;
            assert.equal(response.status, 401);
            assert.equal(response.headers.get('cache-control'), 'private, no-store');
            assert.match(response.headers.get('vary'), /Cookie/);
            assert.match(response.headers.get('vary'), /Authorization/);
            assert.equal(response.headers.get('content-encoding'), null, 'success gzip metadata must not reach the error response');
            const body = await response.text();
            assert.doesNotMatch(body, /private-wallet-compression-sentinel|12345678/);
            assert.equal(JSON.parse(body).code, 'admin_required');
        } finally { await app.close(); }
    `;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)), timeout: 15_000,
    });
});

test('wallet routes fail closed without management and sanitize unexpected wallet errors', async t => {
    const disabled = await application(t, 'public', '');
    const noAdmin = await fetch(disabled.base + '/api/wallets');
    assert.equal(noAdmin.status, 403); privateHeaders(noAdmin);
    assert.equal((await noAdmin.json()).code, 'management_disabled');
    const { base, runtime } = await application(t);
    t.mock.method(runtime.wallets, 'snapshot', async () => { throw new Error('secret-wallet /private/data/node password'); });
    const response = await fetch(base + '/api/wallets', { headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` } });
    assert.equal(response.status, 503); privateHeaders(response);
    const text = await response.text(); assert.doesNotMatch(text, /secret-wallet|private\/data|password/); assert.match(text, /wallet_unavailable/);
    for (const path of ['/api/access', '/api/config', '/api/info', '/api/view/aggregate']) {
        const ordinary = await fetch(base + path);
        assert.doesNotMatch(await ordinary.text(), /watch-descriptor|balance_sats|selected_wallets|wallet-ticker\.json/);
    }
});

test('management lifetime metadata remains absolute and cannot be extended by inspection', t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const sessions = createBrowserSessions(), headers = new Map<string, unknown>();
    const request = { headers: { host: 'bpm.example', origin: 'https://bpm.example' } } as IncomingMessage;
    const response = { getHeader: (key: string) => headers.get(key), setHeader: (key: string, value: unknown) => headers.set(key, value) } as unknown as ServerResponse;
    assert.equal(sessions.issue(request, response, 'admin'), BROWSER_SESSION_SECONDS);
    const cookie = (headers.get('Set-Cookie') as string[])[0].split(';')[0];
    request.headers.cookie = cookie;
    assert.equal(sessions.remainingSeconds(request, 'admin'), BROWSER_SESSION_SECONDS);
    assert.equal(sessions.remainingSeconds(request, 'view'), null);
    let revoked = 0;
    const stop = sessions.watchAdmin(request, () => revoked++); t.after(stop);
    t.mock.timers.tick(1234);
    assert.equal(sessions.remainingSeconds(request, 'admin'), BROWSER_SESSION_SECONDS - 1.234);
    t.mock.timers.tick(BROWSER_SESSION_SECONDS * 1000 - 1234);
    assert.equal(sessions.remainingSeconds(request, 'admin'), null); assert.equal(revoked, 1);
});
