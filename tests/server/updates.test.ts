import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UpdateService, UPDATE_CHECK_INTERVAL_MS } from '../../src/server/services/updates.ts';
import { GITHUB_REPOSITORY, REPOSITORY_URL } from '../../src/server/build.ts';
import { settings, temporaryDirectory, flush } from './helpers.ts';

const revision = 'abcdef0123456789abcdef0123456789abcdef01';
const version = 'v1.3.0';
const release = (tag = 'v1.4.0') => Response.json({ tag_name: tag, draft: false, prerelease: false });
const cache = (overrides = {}) => ({ repository: GITHUB_REPOSITORY, version, checked_at: Date.now() / 1000, latest_version: 'v1.4.0', check_failed: false, ...overrides });

test('checks the latest release once per 24 hours without a browser and preserves the cache across restarts', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const config = settings({ BPM_BUILD_VERSION: version, BPM_BUILD_REVISION: revision, BPM_DATA_DIR: temporaryDirectory(t) });
    let requests = 0;
    const fetcher: typeof fetch = async (url, options) => {
        requests++;
        assert.equal(url, `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`);
        assert.ok(options?.signal);
        return release();
    };
    const first = new UpdateService(config, undefined, fetcher);
    first.start(); first.start(); t.mock.timers.tick(0); await flush();
    assert.equal(requests, 1);
    assert.equal(first.snapshot().latest_version, 'v1.4.0');
    assert.equal(first.snapshot().update_available, true);
    assert.equal(first.snapshot().changes_url, `${REPOSITORY_URL}/releases/tag/v1.4.0`);
    for (let i = 0; i < 100; i++) first.snapshot();
    assert.equal(requests, 1);
    const changed = first.snapshot(); changed.update_available = false;
    assert.equal(first.snapshot().update_available, true);
    await first.stop();
    const restored = new UpdateService(config, undefined, fetcher);
    t.after(() => restored.stop()); restored.start();
    assert.deepEqual(restored.snapshot(), first.snapshot());
    t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS - 1); await flush(); assert.equal(requests, 1);
    t.mock.timers.tick(1); await flush(); assert.equal(requests, 2);
    await restored.stop(); t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS); await flush(); assert.equal(requests, 2);
});

for (const [installed, latest, available] of [
    ['v1.3.0', 'v1.3.0', false],
    ['v1.3.0', 'v1.4.0', true],
    ['v1.3.0', 'v1.3.1', true],
    ['v1.3.0', 'v2.0.0', true],
    ['v1.4.0', 'v1.3.0', false],
    ['v1.9.0', 'v1.10.0', true],
    ['v1.10.0', 'v1.9.0', false],
    ['v1.3.9', 'v1.3.10', true],
    ['v9.99.99', 'v10.0.0', true],
    ['v2.0.0', 'v1.99.99', false],
    ['v1.9007199254740992.0', 'v1.9007199254740993.0', true],
] as const) {
    test(`${installed} with latest ${latest}: update=${available}`, async t => {
        t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
        // Version checks work even without known source provenance.
        const service = new UpdateService(settings({ BPM_BUILD_VERSION: installed, BPM_DATA_DIR: temporaryDirectory(t) }), undefined, async () => release(latest));
        t.after(() => service.stop()); service.start(); t.mock.timers.tick(0); await flush();
        assert.equal(service.snapshot().update_available, available);
        assert.equal(service.snapshot().latest_version, latest);
        assert.equal(service.snapshot().changes_url, available ? `${REPOSITORY_URL}/releases/tag/${latest}` : null);
        assert.equal(service.snapshot().check_failed, false);
    });
}

test('failures retain a known release update and do not retry for 24 hours, even after restart', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const config = settings({ BPM_BUILD_VERSION: version, BPM_DATA_DIR: temporaryDirectory(t) });
    let requests = 0;
    const fetcher: typeof fetch = async () => ++requests === 1 ? release() : new Response('', { status: 403 });
    const service = new UpdateService(config, undefined, fetcher);
    service.start(); t.mock.timers.tick(0); await flush();
    t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS); await flush();
    assert.equal(service.snapshot().check_failed, true);
    assert.equal(service.snapshot().update_available, true);
    assert.equal(service.snapshot().latest_version, 'v1.4.0');
    assert.equal(requests, 2);
    await service.stop();
    const restored = new UpdateService(config, undefined, fetcher);
    t.after(() => restored.stop()); restored.start();
    t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS - 1); await flush(); assert.equal(requests, 2);
});

test('new installed versions and old commit-comparison caches require a fresh release check', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const dir = temporaryDirectory(t);
    let requests = 0;
    for (const cached of [cache({ version: 'v1.2.0' }), { repository: GITHUB_REPOSITORY, revision, checked_at: Date.now() / 1000, commits_behind: 3, check_failed: false }]) {
        writeFileSync(join(dir, 'update-check.json'), JSON.stringify(cached));
        const service = new UpdateService(settings({ BPM_BUILD_VERSION: version, BPM_BUILD_REVISION: revision, BPM_DATA_DIR: dir }), undefined, async () => { requests++; return release(version); });
        assert.equal(service.snapshot().checked_at, null);
        service.start(); t.mock.timers.tick(0); await flush(); await service.stop();
        assert.equal(service.snapshot().update_available, false);
    }
    assert.equal(requests, 2);
});

test('cached availability and links are derived from versions, never trusted from disk', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const dir = temporaryDirectory(t);
    writeFileSync(join(dir, 'update-check.json'), JSON.stringify(cache({ update_available: false, changes_url: 'https://example.test/untrusted' })));
    const service = new UpdateService(settings({ BPM_BUILD_VERSION: version, BPM_DATA_DIR: dir }), undefined, async () => assert.fail('Recent caches need no request'));
    t.after(() => service.stop()); service.start(); t.mock.timers.tick(0); await flush();
    assert.equal(service.snapshot().update_available, true);
    assert.equal(service.snapshot().changes_url, `${REPOSITORY_URL}/releases/tag/v1.4.0`);
});

test('development builds skip external checks and ignore saved release notices even with a known revision', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const dir = temporaryDirectory(t);
    writeFileSync(join(dir, 'update-check.json'), JSON.stringify(cache({ version: 'dev' })));
    const service = new UpdateService(settings({ BPM_BUILD_REVISION: revision, BPM_DATA_DIR: dir }), undefined, async () => assert.fail('Development builds must skip release checks'));
    t.after(() => service.stop()); service.start(); t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS * 2); await flush();
    assert.equal(service.snapshot().checked_at, null);
    assert.equal(service.snapshot().update_available, false);
});

test('no published release is a successful check with no update, cached across restarts', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const config = settings({ BPM_BUILD_VERSION: version, BPM_DATA_DIR: temporaryDirectory(t) });
    const service = new UpdateService(config, undefined, async () => new Response('', { status: 404 }));
    service.start(); t.mock.timers.tick(0); await flush(); await service.stop();
    assert.deepEqual(service.snapshot(), { update_available: false, latest_version: null, changes_url: null, checked_at: Date.now() / 1000, check_failed: false });
    const restored = new UpdateService(config, undefined, async () => assert.fail('No-release results are cached'));
    t.after(() => restored.stop()); restored.start(); t.mock.timers.tick(0); await flush();
    assert.deepEqual(restored.snapshot(), service.snapshot());
});

for (const payload of [null, {}, { tag_name: '1.4.0' }, { tag_name: 'v01.4.0' }, { tag_name: 'v1.4.0-rc.1' }, { tag_name: 'v1.4.0', draft: true }, { tag_name: 'v1.4.0', prerelease: true }]) {
    test(`invalid or unpublished GitHub release is cached as a failed check: ${JSON.stringify(payload)}`, async t => {
        t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
        const dir = temporaryDirectory(t);
        const service = new UpdateService(settings({ BPM_BUILD_VERSION: version, BPM_DATA_DIR: dir }), undefined, async () => Response.json(payload === null ? null : { draft: false, prerelease: false, ...payload }));
        t.after(() => service.stop()); service.start(); t.mock.timers.tick(0); await flush();
        assert.equal(service.snapshot().check_failed, true);
        assert.equal(service.snapshot().update_available, false);
        assert.equal(JSON.parse(readFileSync(join(dir, 'update-check.json'), 'utf8')).check_failed, true);
    });
}

test('shutdown cancels an in-flight release check without recording a failure', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const service = new UpdateService(settings({ BPM_BUILD_VERSION: version, BPM_DATA_DIR: temporaryDirectory(t) }), undefined, async (_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
    }));
    service.start(); t.mock.timers.tick(0); await flush(); await service.stop();
    assert.equal(service.snapshot().checked_at, null);
    assert.equal(service.snapshot().check_failed, false);
});
