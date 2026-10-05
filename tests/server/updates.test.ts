import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UpdateService, UPDATE_CHECK_INTERVAL_MS } from '../../src/server/services/updates.ts';
import { settings, temporaryDirectory, flush } from './helpers.ts';

const revision = 'abcdef0123456789abcdef0123456789abcdef01';
const comparison = (status = 'ahead', ahead = 3) => Response.json({ status, ahead_by: ahead });

test('checks once per 24 hours without a browser and preserves the cache across restarts', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const config = settings({ BPM_BUILD_REVISION: revision, BPM_DATA_DIR: temporaryDirectory(t) });
    let requests = 0;
    const fetcher: typeof fetch = async (url, options) => {
        requests++;
        assert.equal(url, `https://api.github.com/repos/spyhunter493/bitcoin-peer-map/compare/${revision}...main`);
        assert.ok(options?.signal);
        return comparison();
    };
    const first = new UpdateService(config, undefined, fetcher);
    first.start(); first.start(); t.mock.timers.tick(0); await flush();
    assert.equal(requests, 1);
    assert.equal(first.snapshot().commits_behind, 3);
    assert.equal(first.snapshot().update_available, true);
    assert.equal(first.snapshot().changes_url, `https://github.com/spyhunter493/bitcoin-peer-map/compare/${revision}...main`);
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

for (const status of ['identical', 'behind', 'diverged']) {
    test(`${status} builds do not report an update`, async t => {
        t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
        const service = new UpdateService(settings({ BPM_BUILD_REVISION: revision, BPM_DATA_DIR: temporaryDirectory(t) }), undefined, async () => comparison(status, status === 'diverged' ? 3 : 0));
        t.after(() => service.stop()); service.start(); t.mock.timers.tick(0); await flush();
        assert.equal(service.snapshot().update_available, false);
        assert.equal(service.snapshot().changes_url, null);
        assert.equal(service.snapshot().check_failed, false);
    });
}

test('failures retain a known update and do not retry for 24 hours, even after restart', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const config = settings({ BPM_BUILD_REVISION: revision, BPM_DATA_DIR: temporaryDirectory(t) });
    let requests = 0;
    const fetcher: typeof fetch = async () => ++requests === 1 ? comparison() : new Response('', { status: 403 });
    const service = new UpdateService(config, undefined, fetcher);
    service.start(); t.mock.timers.tick(0); await flush();
    t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS); await flush();
    assert.equal(service.snapshot().check_failed, true);
    assert.equal(service.snapshot().update_available, true);
    assert.equal(requests, 2);
    await service.stop();
    const restored = new UpdateService(config, undefined, fetcher);
    t.after(() => restored.stop()); restored.start();
    t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS - 1); await flush(); assert.equal(requests, 2);
});

test('a different installed revision or repository invalidates the saved comparison', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const dir = temporaryDirectory(t);
    const cached = { repository: 'spyhunter493/bitcoin-peer-map', revision, checked_at: Date.now() / 1000, commits_behind: 3, check_failed: false };
    writeFileSync(join(dir, 'update-check.json'), JSON.stringify(cached));
    let requests = 0;
    const overrides: Record<string, string>[] = [{ BPM_BUILD_REVISION: '7654321' }, { BPM_GITHUB_REPOSITORY: 'other/repository' }];
    for (const override of overrides) {
        const service = new UpdateService(settings({ BPM_BUILD_REVISION: revision, BPM_DATA_DIR: dir, ...override }), undefined, async () => { requests++; return comparison('identical', 0); });
        assert.equal(service.snapshot().checked_at, null);
        service.start(); t.mock.timers.tick(0); await flush(); await service.stop();
    }
    assert.equal(requests, 2);
});

test('unknown revisions skip external checks', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const service = new UpdateService(settings({ BPM_DATA_DIR: temporaryDirectory(t) }), undefined, async () => assert.fail('Unknown builds cannot be compared'));
    t.after(() => service.stop()); service.start(); t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS * 2); await flush();
    assert.equal(service.snapshot().checked_at, null);
});

test('invalid GitHub responses are cached as failed checks', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const dir = temporaryDirectory(t);
    const service = new UpdateService(settings({ BPM_BUILD_REVISION: revision, BPM_DATA_DIR: dir }), undefined, async () => Response.json({ status: 'ahead', ahead_by: '3' }));
    t.after(() => service.stop()); service.start(); t.mock.timers.tick(0); await flush();
    assert.equal(service.snapshot().check_failed, true);
    assert.equal(service.snapshot().update_available, false);
    assert.equal(JSON.parse(readFileSync(join(dir, 'update-check.json'), 'utf8')).check_failed, true);
});

test('shutdown cancels an in-flight check without recording a failure', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1700000000000 });
    const service = new UpdateService(settings({ BPM_BUILD_REVISION: revision, BPM_DATA_DIR: temporaryDirectory(t) }), undefined, async (_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
    }));
    service.start(); t.mock.timers.tick(0); await flush(); await service.stop();
    assert.equal(service.snapshot().checked_at, null);
    assert.equal(service.snapshot().check_failed, false);
});
