import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createBrowserSessions, BROWSER_SESSION_SECONDS } from '../../src/server/browser-sessions.ts';
import { createApplication } from '../../src/server/app.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from '../layout_server.ts';
import { temporaryDirectory } from './helpers.ts';

const VIEW_TOKEN = 'test-viewing-secret-'.padEnd(64, 'v');
type Sessions = ReturnType<typeof createBrowserSessions>;
type Role = 'view' | 'admin';
function browser(cookie = '', origin = 'https://bpm.example') {
    const req = { headers: { host: 'bpm.example', origin, cookie } } as IncomingMessage;
    const headers = new Map<string, string | string[]>();
    const res = { getHeader: (name: string) => headers.get(name), setHeader: (name: string, value: string | string[]) => headers.set(name, value) } as unknown as ServerResponse;
    return { req, res, headers };
}
function issue(sessions: Sessions, role: Role, previous = '') {
    const { req, res, headers } = browser(previous);
    sessions.issue(req, res, role);
    const setCookie = headers.get('Set-Cookie') as string[];
    return setCookie[0].split(';')[0];
}
async function application(t: TestContext, adminToken = FIXTURE_ADMIN_TOKEN) {
    const settings = { ...fixtureSettings(temporaryDirectory(t), adminToken), view_mode: 'authenticated' as const, view_token: VIEW_TOKEN };
    const runtime = new FixtureRuntime(settings), app = createApplication(settings, runtime);
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`;
    async function login(role: Role, token = role === 'view' ? VIEW_TOKEN : adminToken) {
        const response = await fetch(`${base}/api/${role}/verify`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: base, 'X-BPM-Remember': '1' } });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, remembered: true });
        return response.headers.getSetCookie()[0].split(';')[0];
    }
    const access = async (cookie = '') => (await fetch(base + '/api/access', { headers: { Cookie: cookie } })).json();
    return { base, app, runtime, login, access };
}
function privateHeaders(response: Response) {
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('vary') || '', /\bCookie\b/);
}

test('sessions use persistent HttpOnly opaque cookies, absolute expiry, and role separation', t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const sessions = createBrowserSessions();
    const cookie = issue(sessions, 'view'), { req } = browser(cookie);
    assert.match(cookie, /^bpm_view_session=[A-Za-z0-9_-]{43}$/);
    assert.equal(sessions.hasViewer(req), true);
    assert.equal(sessions.has(req, 'admin'), false);
    t.mock.timers.tick(BROWSER_SESSION_SECONDS * 1000 - 1);
    assert.equal(sessions.hasViewer(req), true, 'using the session never extends its absolute deadline');
    t.mock.timers.tick(1);
    assert.equal(sessions.hasViewer(req), false);
    assert.equal(createBrowserSessions().hasViewer(req), false, 'a restarted application rejects old cookies');
});

test('expiry watchers honor Node timer limits and close streams at the absolute deadline', t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const sessions = createBrowserSessions(), cookie = issue(sessions, 'view');
    let closed = 0;
    const stop = sessions.watchViewer(browser(cookie).req, () => closed++);
    t.after(stop);
    t.mock.timers.tick(2 ** 31 - 1);
    assert.equal(closed, 0, 'a 30-day session must not overflow Node timers');
    t.mock.timers.tick(BROWSER_SESSION_SECONDS * 1000 - (2 ** 31 - 1) - 1);
    assert.equal(closed, 0);
    t.mock.timers.tick(1);
    assert.equal(closed, 1);
});

test('session storage is bounded without evicting active logins and expires unused entries', t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const sessions = createBrowserSessions(), oldest = issue(sessions, 'view');
    for (let index = 1; index < 1024; index++) issue(sessions, 'view');
    assert.throws(() => issue(sessions, 'admin'), { status: 503, code: 'session_capacity' });
    assert.equal(sessions.hasViewer(browser(oldest).req), true);
    const replacement = issue(sessions, 'view', oldest);
    assert.equal(sessions.hasViewer(browser(oldest).req), false);
    assert.equal(sessions.hasViewer(browser(replacement).req), true);
    t.mock.timers.tick(BROWSER_SESSION_SECONDS * 1000);
    assert.doesNotThrow(() => issue(sessions, 'admin'));
});

test('duplicate, oversized, malformed, tampered, and wrong-role cookies fail closed', () => {
    const sessions = createBrowserSessions(), cookie = issue(sessions, 'view');
    const value = cookie.slice(cookie.indexOf('=') + 1);
    for (const invalid of [cookie + '; ' + cookie, cookie + '; tracking=' + 'x'.repeat(8192), 'bpm_view_session=bad', 'bpm_view_session=' + value.slice(0, -1) + (value.endsWith('a') ? 'b' : 'a'), 'bpm_admin_session=' + value]) {
        assert.equal(sessions.hasViewer(browser(invalid).req), false, invalid.slice(0, 100));
        assert.equal(sessions.hasCredentials(browser(invalid).req), true);
    }
});

test('remembered verification opts in explicitly and preserves bearer CLI compatibility', async t => {
    const { base } = await application(t);
    for (const role of ['view', 'admin'] as const) {
        const token = role === 'view' ? VIEW_TOKEN : FIXTURE_ADMIN_TOKEN;
        const cli = await fetch(`${base}/api/${role}/verify`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        assert.equal(cli.status, 200); assert.deepEqual(await cli.json(), { success: true });
        assert.deepEqual(cli.headers.getSetCookie(), []);
        for (const origin of [null, 'null', 'https://foreign.invalid']) {
            const response = await fetch(`${base}/api/${role}/verify`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-BPM-Remember': '1', ...(origin === null ? {} : { Origin: origin }) } });
            assert.equal(response.status, 403); assert.deepEqual(response.headers.getSetCookie(), []);
        }
        const browserLogin = await fetch(`${base}/api/${role}/verify`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-BPM-Remember': '1', Origin: base, 'X-Forwarded-Proto': 'https' } });
        assert.equal(browserLogin.status, 200);
        const cookie = browserLogin.headers.getSetCookie()[0];
        assert.match(cookie, /Path=\/api; Max-Age=2592000; HttpOnly; SameSite=Strict$/);
        assert.equal(cookie.includes(token), false);
        assert.doesNotMatch(cookie, /Domain=|Secure/);
        privateHeaders(browserLogin);
    }
});

test('HTTPS reverse-proxy origins issue Secure cookies without trusting forwarded protocol', async t => {
    const { base } = await application(t);
    const secureOrigin = base.replace('http:', 'https:');
    const response = await fetch(base + '/api/view/verify', { method: 'POST', headers: { Authorization: `Bearer ${VIEW_TOKEN}`, 'X-BPM-Remember': '1', Origin: secureOrigin, 'X-Forwarded-Proto': 'http' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.getSetCookie()[0], /; Secure$/);
});

test('session bootstrap flags and cookies authorize the correct viewing and management roles', async t => {
    const { base, login, access } = await application(t);
    assert.deepEqual(await access(), { mode: 'authenticated', authentication_available: true, viewing_authenticated: false, management_authenticated: false });
    const view = await login('view');
    assert.deepEqual(await access(view), { mode: 'authenticated', authentication_available: true, viewing_authenticated: true, management_authenticated: false });
    const privateRead = await fetch(base + '/api/peers', { headers: { Cookie: view } });
    assert.equal(privateRead.status, 200); privateHeaders(privateRead);
    const viewerMutation = await fetch(base + '/api/peer/connect', { method: 'POST', headers: { Cookie: view, Origin: base, 'Content-Type': 'application/json' }, body: '{"address":"8.8.8.8"}' });
    assert.equal(viewerMutation.status, 401);
    const adminAsView = await login('view', FIXTURE_ADMIN_TOKEN);
    assert.equal((await access(adminAsView)).management_authenticated, false, 'view login never grants management, even with an admin bearer');
    const admin = await login('admin');
    assert.equal((await access(admin)).viewing_authenticated, true);
    assert.equal((await access(admin)).management_authenticated, true);
    for (const method of ['GET', 'HEAD']) {
        const read = await fetch(base + '/api/info', { method, headers: { Cookie: admin } });
        assert.equal(read.status, 200); privateHeaders(read);
    }
    const mutation = await fetch(base + '/api/peer/connect', { method: 'POST', headers: { Cookie: admin, Origin: base, 'Content-Type': 'application/json' }, body: '{"address":"8.8.8.8"}' });
    assert.equal(mutation.status, 200); privateHeaders(mutation);
});

test('explicit incorrect bearer credentials never fall back to cookies, and cookie-only verification cannot renew sessions', async t => {
    const { base, login } = await application(t), admin = await login('admin');
    for (const authorization of ['', 'Bearer invalid', 'Basic invalid']) {
        const read = await fetch(base + '/api/peers', { headers: { Cookie: admin, Authorization: authorization } });
        assert.equal(read.status, 401);
        const mutation = await fetch(base + '/api/admin/verify', { method: 'POST', headers: { Cookie: admin, Authorization: authorization, Origin: base } });
        assert.equal(mutation.status, 401);
    }
    for (const role of ['view', 'admin']) {
        const renewal = await fetch(`${base}/api/${role}/verify`, { method: 'POST', headers: { Cookie: admin, Origin: base, 'X-BPM-Remember': '1' } });
        assert.equal(renewal.status, 401);
        assert.deepEqual(renewal.headers.getSetCookie(), []);
    }
});

test('cookie-authenticated POSTs require explicit same-origin Origin before calling management handlers', async t => {
    const { base, runtime, login } = await application(t), admin = await login('admin');
    const connect = t.mock.method(runtime.node, 'connect');
    for (const origin of [null, 'null', 'https://foreign.invalid']) {
        const response = await fetch(base + '/api/peer/connect', { method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json', ...(origin === null ? {} : { Origin: origin }) }, body: '{"address":"8.8.8.8"}' });
        assert.equal(response.status, 403);
    }
    assert.equal(connect.mock.callCount(), 0);
    const cli = await fetch(base + '/api/peer/connect', { method: 'POST', headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}`, 'Content-Type': 'application/json' }, body: '{"address":"8.8.8.8"}' });
    assert.equal(cli.status, 200); assert.equal(connect.mock.callCount(), 1);
});

test('logout rejects missing/foreign Origin and revokes server sessions, with management-only locking preserving a viewing session', async t => {
    const { base, login, access } = await application(t), view = await login('view'), admin = await login('admin'), cookie = view + '; ' + admin;
    for (const role of ['view', 'admin']) for (const origin of [null, 'https://foreign.invalid']) {
        const response = await fetch(`${base}/api/${role}/logout`, { method: 'POST', headers: { Cookie: cookie, ...(origin === null ? {} : { Origin: origin }) } });
        assert.equal(response.status, 403);
        assert.equal((await access(cookie)).management_authenticated, true);
    }
    const lockAdmin = await fetch(base + '/api/admin/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
    assert.equal(lockAdmin.status, 200); privateHeaders(lockAdmin);
    assert.equal(lockAdmin.headers.getSetCookie().length, 1);
    assert.match(lockAdmin.headers.getSetCookie()[0], /^bpm_admin_session=; Path=\/api; Max-Age=0;/);
    assert.equal((await access(cookie)).management_authenticated, false, 'replaying the old cookie cannot restore management');
    assert.equal((await access(cookie)).viewing_authenticated, true);
    const lockView = await fetch(base + '/api/view/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
    assert.equal(lockView.status, 200); assert.equal(lockView.headers.getSetCookie().length, 2);
    assert.equal((await access(cookie)).viewing_authenticated, false);
    assert.equal((await fetch(base + '/api/peers', { headers: { Cookie: view } })).status, 401);
    const alreadyLocked = await fetch(base + '/api/view/logout', { method: 'POST', headers: { Origin: base } });
    assert.equal(alreadyLocked.status, 200, 'logout works after a session expires or is cleared');
});

test('bootstrap and credential-bearing responses are private, including invalid cookies and conditional assets', async t => {
    const { base, login } = await application(t), cookie = await login('view');
    for (const credentials of ['', cookie, 'bpm_view_session=invalid']) {
        const response = await fetch(base + '/api/access', { headers: { Cookie: credentials } });
        assert.equal(response.status, 200); privateHeaders(response);
    }
    const asset = await fetch(base + '/static/js/app.js'), etag = asset.headers.get('etag')!;
    for (const path of ['/', '/openapi.json', '/static/js/app.js']) {
        const response = await fetch(base + path, { headers: { Cookie: cookie, 'If-None-Match': etag } });
        assert.equal(response.status, 200); privateHeaders(response);
    }
    const invalid = await fetch(base + '/api/peers', { headers: { Cookie: 'bpm_view_session=invalid' } });
    assert.equal(invalid.status, 401); privateHeaders(invalid);
});

test('cookie-authenticated streams close immediately on logout and discard in-flight private samples', async t => {
    const { base, runtime, login } = await application(t), cookie = await login('view');
    let release!: (value: Awaited<ReturnType<typeof runtime.metrics.summary>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof runtime.metrics.summary>>>(resolve => { release = resolve; });
    const sample = await runtime.metrics.summary();
    t.mock.method(runtime.metrics, 'summary', () => pending);
    const response = await fetch(base + '/api/stream/system', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200); privateHeaders(response);
    const reader = response.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /type":"connected"/);
    const logout = await fetch(base + '/api/view/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
    assert.equal(logout.status, 200);
    release(sample);
    assert.equal((await reader.read()).done, true, 'a pending sample cannot appear after server revocation');
});
