import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApplication } from '../../src/server/app.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from '../layout_server.ts';
import { temporaryDirectory } from './helpers.ts';

const VIEW_TOKEN = 'policy-view-only-token';
const configuration = { expected_revision: 0, config: { mode: 'preview', listener_allowance: 0, keep_addresses: [] } };
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

test('policy reads, HEAD, and writes require management before parsing in every viewing mode', async t => {
    for (const mode of ['public', 'authenticated', 'redacted'] as const) {
        const { base, runtime } = await application(t, mode);
        const inspect = t.mock.method(runtime.peerPolicy, 'snapshot'), status = t.mock.method(runtime.peerPolicy, 'status'), save = t.mock.method(runtime.peerPolicy, 'configure');
        for (const token of [null, VIEW_TOKEN]) {
            const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
            for (const method of ['GET', 'HEAD', 'POST']) {
                const response = await fetch(base + '/api/peer-policy', { method, headers, ...(method === 'POST' ? { body: '{' } : {}) });
                assert.equal(response.status, 401); privateHeaders(response);
            }
            for (const method of ['GET', 'HEAD']) {
                const response = await fetch(base + '/api/peer-policy/status', { method, headers });
                assert.equal(response.status, 401); privateHeaders(response);
            }
        }
        assert.equal(inspect.mock.callCount(), 0); assert.equal(status.mock.callCount(), 0); assert.equal(save.mock.callCount(), 0);
        for (const method of ['GET', 'HEAD']) {
            const response = await fetch(base + '/api/peer-policy', { method, headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` } });
            assert.equal(response.status, 200); privateHeaders(response);
        }
    }
});

test('compact policy status stays private and never builds connection evidence or returns addresses', async t => {
    const { base, runtime, login } = await application(t);
    const inspect = t.mock.method(runtime.peerPolicy, 'snapshot', () => { throw new Error('Full policy inspection must not run'); });
    const cookie = await login('admin');
    for (const headers of [new Headers({ Cookie: cookie }), new Headers({ Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` })]) {
        const response = await fetch(base + '/api/peer-policy/status', { headers });
        assert.equal(response.status, 200); privateHeaders(response);
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ['available', 'effective_state', 'mode', 'reason', 'revision']);
        assert.equal(body.mode, 'off'); assert.equal(body.effective_state, 'disabled');
        const head = await fetch(base + '/api/peer-policy/status', { method: 'HEAD', headers });
        assert.equal(head.status, 200); privateHeaders(head); assert.equal(await head.text(), '');
    }
    assert.equal(inspect.mock.callCount(), 0);
    await fetch(base + '/api/admin/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
    const revoked = await fetch(base + '/api/peer-policy/status', { headers: { Cookie: cookie } });
    assert.equal(revoked.status, 401); privateHeaders(revoked);
});

test('management cookies authorize policy updates, enforce Origin, and reject stale revisions', async t => {
    const { base, login } = await application(t, 'authenticated');
    for (const cookie of [await login('view'), await login('view', FIXTURE_ADMIN_TOKEN)]) {
        const response = await fetch(base + '/api/peer-policy', { headers: { Cookie: cookie } });
        assert.equal(response.status, 401); privateHeaders(response);
    }
    const admin = await login('admin');
    const send = (headers: Record<string, string>, body: unknown = configuration) => fetch(base + '/api/peer-policy', {
        method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    assert.equal((await send({})).status, 403);
    assert.equal((await send({ Origin: 'https://elsewhere.example' })).status, 403);
    const saved = await send({ Origin: base }); assert.equal(saved.status, 200); privateHeaders(saved);
    const result = await saved.json(); assert.equal(result.config.mode, 'preview'); assert.equal(result.revision, 1);
    assert.equal((await send({ Origin: base })).status, 409);
    const wrongBearer = await fetch(base + '/api/peer-policy', { headers: { Cookie: admin, Authorization: `Bearer ${VIEW_TOKEN}` } });
    assert.equal(wrongBearer.status, 401);
    const invalid = await send({ Origin: base }, { expected_revision: 1, config: { ...configuration.config, listener_allowance: 21 } });
    assert.equal(invalid.status, 422); privateHeaders(invalid);
});

test('revoking management while a policy body is streaming prevents configuration changes', async t => {
    const { base, runtime, login } = await application(t);
    const cookie = await login('admin'), save = t.mock.method(runtime.peerPolicy, 'configure');
    const body = JSON.stringify(configuration);
    const request = http.request(base + '/api/peer-policy', { method: 'POST', headers: {
        Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
    } });
    t.after(() => request.destroy());
    request.flushHeaders(); request.write(body.slice(0, 1));
    // The request is on the wire before revocation; the remaining body arrives later.
    const logout = await fetch(base + '/api/admin/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
    assert.equal(logout.status, 200);
    const responsePromise = once(request, 'response'); request.end(body.slice(1));
    const [response] = await responsePromise;
    assert.equal((response as http.IncomingMessage).statusCode, 401);
    (response as http.IncomingMessage).resume();
    assert.equal(save.mock.callCount(), 0);
});

test('policy failures are private and sanitized; ordinary monitoring never exposes policy state', async t => {
    const disabled = await application(t, 'public', '');
    const denied = await fetch(disabled.base + '/api/peer-policy');
    assert.equal(denied.status, 403); privateHeaders(denied);
    const { base, runtime } = await application(t);
    t.mock.method(runtime.peerPolicy, 'snapshot', () => { throw new Error('secret-peer 192.0.2.12 private-policy-path'); });
    const response = await fetch(base + '/api/peer-policy', { headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` } });
    assert.equal(response.status, 503); privateHeaders(response);
    const text = await response.text(); assert.match(text, /peer_policy_unavailable/); assert.doesNotMatch(text, /secret-peer|192\.0\.2|private-policy-path/);
    t.mock.method(runtime.peerPolicy, 'status', () => { throw new Error('secret-peer 192.0.2.12 private-policy-path'); });
    const statusFailure = await fetch(base + '/api/peer-policy/status', { headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` } });
    assert.equal(statusFailure.status, 503); privateHeaders(statusFailure);
    assert.doesNotMatch(await statusFailure.text(), /secret-peer|192\.0\.2|private-policy-path/);
    for (const path of ['/api/config', '/api/info', '/api/peers', '/api/view/aggregate']) {
        const ordinary = await fetch(base + path);
        assert.doesNotMatch(await ordinary.text(), /keep_addresses|listener_allowance|would_disconnect|peer-policy\.json/);
    }
});
