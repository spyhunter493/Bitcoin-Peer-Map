import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApplication } from '../../src/server/app.ts';
import { createViewingAuthentication } from '../../src/server/viewer-auth.ts';
import { HttpError } from '../../src/server/http.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from '../layout_server.ts';
import { temporaryDirectory } from './helpers.ts';

const VIEW_TOKEN = 'test-viewing-secret-'.padEnd(64, 'v');
const READS = ['/api/peers', '/api/peers?include_status=true', '/api/info', '/api/mempool', '/api/blockchain', '/api/blocks/recent', '/api/chain-tips', '/api/bans', '/api/connectivity', '/api/stats', '/api/rpc-info', '/api/config', '/api/config/outbound'];
function privateHeaders(response: Response) {
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('vary') || '', /\bAuthorization\b/);
    assert.match(response.headers.get('vary') || '', /\bAccept-Encoding\b/);
}

for (const mode of ['public', 'authenticated', 'redacted'] as const) {
    test(`viewing ${mode}: all detailed GET/HEAD routes separate anonymous, viewer and administrator`, async t => {
        const settings = { ...fixtureSettings(temporaryDirectory(t)), view_mode: mode, view_token: VIEW_TOKEN };
        const runtime = new FixtureRuntime(settings), app = createApplication(settings, runtime);
        const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
        t.after(() => app.close());
        const base = `http://127.0.0.1:${address.port}`;
        const access = await fetch(base + '/api/access');
        assert.deepEqual(await access.json(), { mode, authentication_available: true, viewing_authenticated: false, management_authenticated: false });
        let anonymousFailures = 0;
        for (const path of READS) for (const method of ['GET', 'HEAD']) for (const token of [null, VIEW_TOKEN, FIXTURE_ADMIN_TOKEN]) {
            const response = await fetch(base + path, { method, headers: token ? { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip', 'If-None-Match': '*' } : { 'If-None-Match': '*' } });
            const expectedStatus = mode !== 'public' && !token ? anonymousFailures++ < 10 ? 401 : 429 : 200;
            assert.equal(response.status, expectedStatus, `${method} ${path} ${token ? 'credential' : 'anonymous'}`);
            if (token || mode !== 'public') privateHeaders(response);
            if (method === 'HEAD') assert.equal(await response.text(), '');
            else await response.arrayBuffer();
        }
        const viewerVerify = await fetch(base + '/api/view/verify', { method: 'POST', headers: { Authorization: `Bearer ${VIEW_TOKEN}` } });
        assert.equal(viewerVerify.status, 200); privateHeaders(viewerVerify); assert.deepEqual(await viewerVerify.json(), { success: true });
        const mutation = await fetch(base + '/api/peer/connect', { method: 'POST', headers: { Authorization: `Bearer ${VIEW_TOKEN}`, 'Content-Type': 'application/json' }, body: '{"address":"8.8.8.8:8333"}' });
        assert.equal(mutation.status, 401);
        assert.equal((await mutation.json()).code, 'admin_required');
        const foreign = await fetch(base + '/api/view/verify', { method: 'POST', headers: { Authorization: `Bearer ${VIEW_TOKEN}`, Origin: 'https://foreign.invalid' } });
        assert.equal(foreign.status, 403);
    });
}

test('central private checks precede query errors, RPC work and direct stream headers/data', async t => {
    const settings = { ...fixtureSettings(temporaryDirectory(t)), view_mode: 'authenticated' as const, view_token: VIEW_TOKEN };
    const runtime = new FixtureRuntime(settings), app = createApplication(settings, runtime);
    t.mock.method(runtime.metrics, 'summary', async () => { assert.fail('Anonymous requests must not sample metrics'); });
    t.mock.method(runtime.peers, 'snapshot', () => { assert.fail('Anonymous requests must not inspect peers'); });
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`;
    for (const path of ['/api/peers?include_status=invalid', '/api/blocks/recent?limit=invalid', '/api/stream/system', '/api/unknown']) {
        const response = await fetch(base + path);
        assert.equal(response.status, 401); privateHeaders(response);
        assert.deepEqual(await response.json(), { detail: 'Enter a viewing or administrator token to view this dashboard.', code: 'view_required' });
    }
    for (const path of ['/healthz', '/', '/docs', '/redoc', '/openapi.json']) assert.equal((await fetch(base + path)).status, 200);
    const head = await fetch(base + '/api/stream/system', { method: 'HEAD', headers: { Authorization: `Bearer ${VIEW_TOKEN}` } });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal(head.headers.get('cache-control'), 'private, no-store');
    assert.match(head.headers.get('vary') || '', /Authorization/);
});

test('both valid viewing identities bypass anonymous saturation before resolving identity', () => {
    const requireViewer = createViewingAuthentication(VIEW_TOKEN, FIXTURE_ADMIN_TOKEN);
    const headers = new Map();
    const res = { setHeader: (name: string, value: string) => headers.set(name, value), getHeader: (name: string) => headers.get(name) } as unknown as ServerResponse;
    const anonymous = { headers: {}, socket: { remoteAddress: '192.0.2.1' }, rawHeaders: [] } as unknown as IncomingMessage;
    for (let index = 0; index < 10; index++) assert.throws(() => requireViewer(anonymous, res), error => error instanceof HttpError && error.status === 401);
    assert.throws(() => requireViewer(anonymous, res), error => error instanceof HttpError && error.status === 429 && error.code === 'view_rate_limited');
    for (const token of [VIEW_TOKEN, FIXTURE_ADMIN_TOKEN]) {
        const req = { headers: { authorization: `Bearer ${token}` }, get socket() { return assert.fail('Valid credentials must not resolve client identity'); } } as unknown as IncomingMessage;
        assert.doesNotThrow(() => requireViewer(req, res));
    }
    assert.throws(() => requireViewer(anonymous, res), error => error instanceof HttpError && error.status === 429);
});

test('private streams require credentials before producing samples and release the authenticated stream on disconnect', async t => {
    const settings = { ...fixtureSettings(temporaryDirectory(t)), view_mode: 'authenticated' as const, view_token: VIEW_TOKEN };
    const runtime = new FixtureRuntime(settings), app = createApplication(settings, runtime);
    let sampled = 0;
    const summary = runtime.metrics.summary;
    t.mock.method(runtime.metrics, 'summary', async () => { sampled++; return summary(); });
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`;
    const anonymous = await fetch(base + '/api/stream/system');
    assert.equal(anonymous.status, 401); assert.equal(sampled, 0);
    const stream = await fetch(base + '/api/stream/system', { headers: { Authorization: `Bearer ${VIEW_TOKEN}` } });
    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get('cache-control'), 'private, no-store');
    assert.match(stream.headers.get('vary') || '', /Authorization/);
    const reader = stream.body!.getReader();
    let text = '';
    while (!text.includes('event: system')) { const value = await reader.read(); assert.equal(value.done, false); text += new TextDecoder().decode(value.value); }
    assert.equal(sampled, 1); assert.doesNotMatch(text, new RegExp(VIEW_TOKEN));
    await reader.cancel();
});

test('credential-bearing shell/assets/schema responses cannot use an anonymous conditional304 representation', async t => {
    const settings = { ...fixtureSettings(temporaryDirectory(t)), view_mode: 'authenticated' as const, view_token: VIEW_TOKEN };
    const app = createApplication(settings, new FixtureRuntime(settings));
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`, path = '/static/js/app.js';
    const publicAsset = await fetch(base + path), etag = publicAsset.headers.get('etag');
    assert.equal((await fetch(base + path, { headers: { 'If-None-Match': etag! } })).status, 304);
    for (const target of ['/', '/openapi.json', path]) {
        const response = await fetch(base + target, { headers: { Authorization: `Bearer ${VIEW_TOKEN}`, 'If-None-Match': etag! } });
        assert.equal(response.status, 200); privateHeaders(response);
    }
});

test('outbound updates require an administrator and reject unknown fields, names and non-boolean values before changing policy', async t => {
    const settings = { ...fixtureSettings(temporaryDirectory(t)), view_mode: 'authenticated' as const, view_token: VIEW_TOKEN };
    const runtime = new FixtureRuntime(settings), app = createApplication(settings, runtime);
    const changed: unknown[] = [];
    const update = runtime.setOutboundPreference.bind(runtime);
    t.mock.method(runtime, 'setOutboundPreference', (...args: Parameters<typeof update>) => { changed.push(args); return update(...args); });
    const address = await app.listen(0, '127.0.0.1'); assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`;
    const post = (payload: unknown, token = FIXTURE_ADMIN_TOKEN) => fetch(base + '/api/config/outbound', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    for (const payload of [
        { preference: 'release_checks', enabled: true, unexpected: 'SECRET-EXTRA-FIELD' },
        { preference: '__proto__', enabled: true }, { preference: 'release_checks', enabled: 'true' },
        { enabled: true }, { preference: 'release_checks' }, [],
    ]) {
        const response = await post(payload);
        assert.equal(response.status, 422); privateHeaders(response);
        assert.equal(JSON.stringify(await response.json()).includes('SECRET-EXTRA-FIELD'), false);
    }
    assert.deepEqual(changed, []);
    assert.equal((await post({ preference: 'optional_outbound', enabled: true }, VIEW_TOKEN)).status, 401);
    assert.deepEqual(changed, []);
    const success = await post({ preference: 'optional_outbound', enabled: true });
    assert.equal(success.status, 200);
    assert.equal((await success.json()).preferences.optional_outbound, true);
    assert.deepEqual(changed, [['optional_outbound', true]]);
});
