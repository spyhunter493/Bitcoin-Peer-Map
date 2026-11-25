import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../../src/server/app.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from '../layout_server.ts';
import { temporaryDirectory } from './helpers.ts';

const endpoints = [
    '/api/history/settings',
    '/api/history/events',
    '/api/history/trends',
    '/api/history/summary',
    '/api/diagnostics',
    '/api/alerts',
    '/api/alerts/settings',
    '/api/peer-policy/annotations',
    '/api/saved-views'
];
const writes = [
    '/api/history/settings',
    '/api/alerts',
    '/api/alerts/settings',
    '/api/peer-policy/annotations',
    '/api/saved-views'
];
const VIEW = 'view-only-monitoring';
function privateResponse(response: Response) {
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('vary') ?? '', /Authorization/);
    assert.match(response.headers.get('vary') ?? '', /Cookie/);
}

test('new history, diagnostics, alerts, annotations and views remain admin-only before query/body parsing in every viewing mode', async (t) => {
    for (const mode of ['public', 'redacted', 'authenticated'] as const) {
        const settings = { ...fixtureSettings(temporaryDirectory(t)), view_mode: mode, view_token: VIEW },
            runtime = new FixtureRuntime(settings),
            app = createApplication(settings, runtime);
        const address = await app.listen(0, '127.0.0.1');
        assert.ok(address && typeof address !== 'string');
        t.after(() => app.close());
        const base = `http://127.0.0.1:${address.port}`;
        const inspect = t.mock.method(runtime.monitoring, 'historyEvents');
        for (const token of [null, VIEW]) {
            const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
            for (const path of endpoints)
                for (const method of ['GET', 'HEAD']) {
                    const r = await fetch(base + path + '?limit=malformed', { method, headers });
                    assert.ok([401, 429].includes(r.status), path);
                    privateResponse(r);
                }
            for (const path of writes) {
                const r = await fetch(base + path, { method: 'POST', headers, body: '{' });
                assert.ok([401, 429].includes(r.status), path);
                privateResponse(r);
            }
        }
        assert.equal(inspect.mock.callCount(), 0);
        for (const path of endpoints) {
            const r = await fetch(base + path, { headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` } });
            assert.equal(r.status, 200, path);
            privateResponse(r);
            const head = await fetch(base + path, {
                method: 'HEAD',
                headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}` }
            });
            assert.equal(head.status, 200, path);
            assert.equal(await head.text(), '');
        }
    }
});
test('new management routes enforce cookie Origin and revoke remembered authority without exposing cached responses', async (t) => {
    const settings = { ...fixtureSettings(temporaryDirectory(t)), view_token: VIEW },
        runtime = new FixtureRuntime(settings),
        app = createApplication(settings, runtime);
    const address = await app.listen(0, '127.0.0.1');
    assert.ok(address && typeof address !== 'string');
    t.after(() => app.close());
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(base + '/api/admin/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}`, Origin: base, 'X-BPM-Remember': '1' }
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    for (const path of writes) {
        const r = await fetch(base + path, {
            method: 'POST',
            headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: '{}'
        });
        assert.equal(r.status, 403, path);
        privateResponse(r);
    }
    const enabled = await fetch(base + '/api/history/settings', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_revision: 0, enabled: true })
    });
    assert.equal(enabled.status, 200);
    privateResponse(enabled);
    await fetch(base + '/api/admin/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
    for (const path of endpoints) {
        const r = await fetch(base + path, { headers: { Cookie: cookie } });
        assert.equal(r.status, 401, path);
        privateResponse(r);
    }
    const health = await fetch(base + '/healthz');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
});
