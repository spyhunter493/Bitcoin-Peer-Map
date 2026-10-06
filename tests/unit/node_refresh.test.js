import test from 'node:test';
import assert from 'node:assert/strict';
import { getJson } from '../../src/static/js/core/api.js';
import { create as createPolling } from '../../src/static/js/core/polling.js';
import { syncStatus, renderNodeDetails } from '../../src/static/js/node/monitor.js';

for (const [ibd, label] of [[true, 'Syncing (IBD)'], [false, 'Synced'], [null, 'Unknown'], [undefined, 'Unknown']]) {
    test(`sync status ${ibd} renders as ${label} in Node Info`, () => {
        assert.equal(syncStatus(ibd).label, label);
        const rendered = renderNodeDetails({ blockchain: { ibd } }, { stale: false, lastSuccessfulRefresh: 1000 });
        assert.ok(rendered.includes(`>${label}</span>`));
        assert.ok(!rendered.includes('Cached node'));
    });
}
test('unavailable blockchain remains Unknown and cached details identify their last successful refresh', () => {
    assert.ok(renderNodeDetails({ blockchain: null }, { stale: false, lastSuccessfulRefresh: 1000 }).includes('>Unknown</span>'));
    const rendered = renderNodeDetails({ blockchain: { ibd: false }, subversion: 'node-version' }, { stale: true, lastSuccessfulRefresh: 1000 });
    for (const text of ['Cached node information', '>Stale</span>', 'Last successful refresh', new Date(1000).toLocaleString(), 'node-version']) assert.ok(rendered.includes(text), text);
});

for (const stage of ['fetch', 'body']) {
    test(`a stalled ${stage} aborts at 35 seconds and releases polling for a successful next request`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let requests = 0, signal;
        t.mock.method(globalThis, 'fetch', async (_url, options) => {
            requests++;
            signal = options.signal;
            if (requests > 1) return Response.json({ recovered: true });
            const stalled = () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
            if (stage === 'fetch') return stalled();
            return { ok: true, status: 200, json: stalled };
        });
        const poller = createPolling({ intervalMs: 5000, task: () => getJson('/api/info', undefined, 35_000) });
        const pending = poller.run();
        await Promise.resolve();
        assert.equal(poller.run(), pending);
        t.mock.timers.tick(34_999);
        assert.equal(signal.aborted, false);
        // Let the body read start before advancing its deadline.
        await Promise.resolve();
        t.mock.timers.tick(1);
        await assert.rejects(pending, { name: 'TimeoutError' });
        assert.equal(signal.aborted, true);
        assert.deepEqual(await poller.run(), { recovered: true });
        assert.equal(requests, 2);
        t.mock.timers.tick(35_000);
        assert.equal(signal.aborted, false, 'successful requests clear their deadline');
    });
}
for (const mode of ['success', 'http error', 'invalid JSON', 'network error']) {
    test(`${mode} clears the JSON request deadline`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let signal;
        t.mock.method(globalThis, 'fetch', async (_url, options) => {
            signal = options.signal;
            if (mode === 'network error') throw new Error('Offline');
            if (mode === 'invalid JSON') return new Response('broken JSON');
            return Response.json({ ok: true }, { status: mode === 'http error' ? 502 : 200 });
        });
        if (mode === 'success') await getJson('/api/info', undefined, 35_000);
        else await assert.rejects(getJson('/api/info', undefined, 35_000));
        t.mock.timers.tick(35_000);
        assert.equal(signal.aborted, false);
    });
}
