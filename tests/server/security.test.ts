import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../../src/server/app.ts';
import { CONTENT_SECURITY_POLICY } from '../../src/server/security.ts';
import { FixtureRuntime, fixtureSettings } from '../layout_server.ts';

test('security headers cover documents, APIs, errors, HEAD, 304, and event streams', async t => {
    const settings = fixtureSettings(), runtime = new FixtureRuntime(settings);
    const app = createApplication(settings, runtime);
    const address = await app.listen(0, '127.0.0.1');
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    t.after(() => app.close());
    const check = (response: Response) => {
        assert.equal(response.headers.get('Content-Security-Policy'), CONTENT_SECURITY_POLICY);
        assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
        assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    };
    for (const [path, method, status] of [
        ['/', 'GET', 200], ['/docs', 'GET', 200], ['/redoc', 'GET', 200],
        ['/openapi.json', 'GET', 200], ['/api/peers', 'GET', 200],
        ['/missing', 'GET', 404], ['/api/blocks/recent?limit=0', 'GET', 422],
        ['/api/admin/verify', 'POST', 401], ['/', 'HEAD', 200],
        ['/api/stream/system', 'HEAD', 200],
    ] as const) {
        const response = await fetch(base + path, { method });
        assert.equal(response.status, status); check(response);
        await response.arrayBuffer();
    }
    const asset = `${base}/static/v/${app.assetRevision}/js/app.js`;
    const first = await fetch(asset); check(first); await first.arrayBuffer();
    const conditional = await fetch(asset, { headers: { 'If-None-Match': first.headers.get('etag')! } });
    assert.equal(conditional.status, 304); check(conditional);
    const stream = await fetch(base + '/api/stream/system'); check(stream);
    assert.match(stream.headers.get('content-type')!, /text\/event-stream/);
    await stream.body!.cancel();
    t.mock.method(runtime.node, 'dashboardInfo', async () => { throw new Error('Fixture request failure'); });
    t.mock.method(console, 'error', () => {});
    const failed = await fetch(base + '/api/info');
    assert.equal(failed.status, 500); check(failed); await failed.arrayBuffer();
});

test('dashboard and both documentation routes use versioned local assets without inline scripts', async t => {
    const settings = fixtureSettings(), app = createApplication(settings, new FixtureRuntime(settings));
    const address = await app.listen(0, '127.0.0.1');
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    t.after(() => app.close());
    const dashboard = await (await fetch(base)).text();
    assert.match(dashboard, /\/static\/v\/abcdef0123456789\/vendor\/cinzel\/index\.css/);
    assert.doesNotMatch(dashboard, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    for (const path of ['/docs', '/redoc']) {
        const html = await (await fetch(base + path)).text();
        assert.doesNotMatch(html, /https?:\/\/|<script[^>]*>\s*[^<\s]/);
        const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
        assert.equal(assets.length, 3);
        for (const path of assets) {
            assert.ok(path.startsWith('/static/v/abcdef0123456789/'));
            const response = await fetch(base + path);
            assert.equal(response.status, 200);
            assert.match(response.headers.get('cache-control')!, /immutable/);
            await response.arrayBuffer();
        }
    }
    const font = await fetch(`${base}/static/v/${app.assetRevision}/vendor/cinzel/files/cinzel-latin-wght-normal.woff2`);
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.match(font.headers.get('cache-control')!, /immutable/);
    await font.arrayBuffer();
});
