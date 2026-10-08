import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedRead, KeyedSharedReads, readDeadline } from '../../src/server/shared-read.ts';
import { deferred, flush } from './helpers.ts';

test('shared readers get independent values and one cancellation preserves the others', async () => {
    const read = new SharedRead<{ values: number[] }>(5000), gate = deferred<{ values: number[] }>();
    const controller = new AbortController();
    let calls = 0, loadSignal: AbortSignal | undefined;
    const load = (signal: AbortSignal) => { calls++; loadSignal = signal; return gate.promise; };
    const cancelled = read.get(load, controller.signal), first = read.get(load), second = read.get(load);
    const rejected = assert.rejects(cancelled, { name: 'AbortError' });
    await flush(); controller.abort(); await rejected;
    assert.equal(loadSignal!.aborted, false); assert.equal(calls, 1);
    gate.resolve({ values: [1] });
    const values = await Promise.all([first, second]);
    values[0].values[0] = -1;
    assert.deepEqual(values[1], { values: [1] });
    assert.deepEqual(await read.get(load), { values: [1] });
});

test('the last reader cancels a load and its late result cannot poison the next flight', async () => {
    const read = new SharedRead<number>(5000), old = deferred<number>(), controller = new AbortController();
    let signal: AbortSignal | undefined;
    const cancelled = read.get(value => { signal = value; return old.promise; }, controller.signal);
    const rejected = assert.rejects(cancelled, { name: 'AbortError' });
    await flush(); controller.abort(); await rejected;
    assert.equal(signal!.aborted, true);
    assert.equal(await read.get(async () => 2), 2);
    old.resolve(1); await flush();
    assert.equal(await read.get(async () => 3), 2);
});

test('failed refreshes are cached briefly and never revive a previous success', async t => {
    let now = 0; t.mock.method(performance, 'now', () => now);
    const read = new SharedRead<number>(5000), error = new Error('offline');
    assert.equal(await read.get(async () => 1), 1);
    now = 5000;
    await assert.rejects(read.get(async () => { throw error; }), error);
    assert.equal(read.cachedFailureExpires, 6000);
    now = 5999;
    await assert.rejects(read.get(async () => assert.fail('Failure cache must share the failed read')), error);
    now = 6000;
    assert.equal(await read.get(async () => 2), 2);
    assert.equal(read.cachedFailureExpires, null);
});

test('keyed failures share sequential and concurrent reads until exactly one second after completion', async t => {
    let now = 0, calls = 0; t.mock.method(performance, 'now', () => now);
    const reads = new KeyedSharedReads<string, number>(), gate = deferred<number>(), error = new Error('offline');
    const load = () => { calls++; return gate.promise; };
    const concurrent = Array.from({ length: 20 }, () => assert.rejects(reads.get('block', load), error));
    await flush(); assert.equal(calls, 1);
    now = 5000; gate.reject(error); await Promise.all(concurrent);
    for (let i = 0; i < 20; i++) await assert.rejects(reads.get('block', load), error);
    now = 5999; await assert.rejects(reads.get('block', load), error);
    assert.equal(calls, 1, 'Slow failures receive the full interval from completion');
    now = 6000;
    assert.equal(await reads.get('block', async () => { calls++; return 2; }), 2);
    assert.equal(calls, 2);
    assert.equal(await reads.get('block', async () => { calls++; return 3; }), 3);
    assert.equal(calls, 3, 'Successful readers leave keyed storage immediately');
});

test('failure expiry between owner access and reader access promotes the retry to active ownership', async t => {
    let now = 0, calls = 0; const clocks: number[] = [];
    t.mock.method(performance, 'now', () => clocks.shift() ?? now);
    const reads = new KeyedSharedReads<string, number>(), gate = deferred<number>(), error = new Error('offline');
    await assert.rejects(reads.get('block', async () => { calls++; throw error; }), error);
    now = 1000; clocks.push(999, 1000);
    const load = () => { calls++; return gate.promise; };
    const first = reads.get('block', load), second = reads.get('block', load);
    const failedFirst = assert.rejects(first, error), failedSecond = assert.rejects(second, error);
    await flush(); assert.equal(calls, 2, 'Both retry subscribers share one transport at the boundary');
    gate.reject(error); await Promise.all([failedFirst, failedSecond]);
    now = 1999; await assert.rejects(reads.get('block', load), error);
    assert.equal(calls, 2, 'The retry failure remains retained by the owner');
});

test('keyed failure eviction is FIFO, does not refresh on access, and keeps other keys independent', async t => {
    let now = 0; t.mock.method(performance, 'now', () => now);
    const reads = new KeyedSharedReads<number, number>(), calls = new Map<number, number>(), error = new Error('offline');
    const load = (key: number) => async () => { calls.set(key, (calls.get(key) || 0) + 1); throw error; };
    for (let key = 0; key < 256; key++) await assert.rejects(reads.get(key, load(key)), error);
    now = 500;
    await assert.rejects(reads.get(0, load(0)), error);
    await assert.rejects(reads.get(256, load(256)), error);
    await assert.rejects(reads.get(1, load(1)), error);
    assert.equal(calls.get(1), 1, 'The second oldest failure remains retained');
    await assert.rejects(reads.get(0, load(0)), error);
    assert.equal(calls.get(0), 2, 'Access does not reorder the oldest retained failure');
    now = 1000;
    await assert.rejects(reads.get(2, load(2)), error);
    assert.equal(calls.get(2), 2, 'Expired failures are pruned at the exact boundary');
    await assert.rejects(reads.get(256, load(256)), error);
    assert.equal(calls.get(256), 1, 'Fresh failures remain isolated from expired keys');
});

test('failure capacity and lazy cleanup never evict active keyed reads', async t => {
    let now = 0; t.mock.method(performance, 'now', () => now);
    const reads = new KeyedSharedReads<string, number>(), active = Array.from({ length: 300 }, () => deferred<number>());
    let calls = 0;
    const pending = active.map((gate, key) => reads.get(`active-${key}`, () => { calls++; return gate.promise; }));
    await flush(); assert.equal(calls, 300);
    const error = new Error('offline');
    for (let key = 0; key < 257; key++) await assert.rejects(reads.get(`failed-${key}`, async () => { throw error; }), error);
    const joined = reads.get('active-0', async () => assert.fail('Failure eviction cannot remove an active read'));
    now = 1000;
    active[0].resolve(0); await Promise.all([pending[0], joined]);
    // Settlement prunes expired failures even when no new access triggers cleanup.
    const state = reads as unknown as { active: Map<string, unknown>; failures: Map<string, unknown> };
    assert.equal(state.failures.size, 0);
    assert.equal(state.active.size, 299);
    for (let key = 1; key < active.length; key++) active[key].resolve(key);
    await Promise.all(pending);
    assert.equal(state.active.size, 0);
});

test('keyed cancellation preserves other subscribers and cancels the last underlying read', async () => {
    const reads = new KeyedSharedReads<string, number>(), gate = deferred<number>();
    const first = new AbortController(), second = new AbortController();
    let loadSignal: AbortSignal | undefined, calls = 0;
    const load = (signal: AbortSignal) => { calls++; loadSignal = signal; return gate.promise; };
    const a = reads.get('block', load, first.signal), b = reads.get('block', load, second.signal);
    const rejectedA = assert.rejects(a, { name: 'AbortError' }), rejectedB = assert.rejects(b, { name: 'AbortError' });
    await flush(); first.abort(); await rejectedA;
    assert.equal(loadSignal!.aborted, false); assert.equal(calls, 1);
    second.abort(); await rejectedB; assert.equal(loadSignal!.aborted, true);
    assert.equal(await reads.get('block', async () => 2), 2, 'Cancellation is removed immediately instead of retained as a failure');
    gate.reject(new Error('Cancelled transport failed late')); await flush();
    assert.equal(await reads.get('block', async () => 3), 3);
});

for (const late of ['success', 'failure'] as const) {
    test(`a cancelled keyed reader's late ${late} cannot remove a pending replacement`, async () => {
        const reads = new KeyedSharedReads<string, number>(), old = deferred<number>(), replacement = deferred<number>();
        const controller = new AbortController(); let calls = 0;
        const abandoned = reads.get('block', () => { calls++; return old.promise; }, controller.signal);
        const cancelled = assert.rejects(abandoned, { name: 'AbortError' });
        await flush(); controller.abort(); await cancelled;
        const fresh = reads.get('block', () => { calls++; return replacement.promise; }); await flush();
        if (late === 'success') old.resolve(1); else old.reject(new Error('Late abandoned failure'));
        await flush();
        const joined = reads.get('block', async () => { calls++; return 3; }); await flush();
        assert.equal(calls, 2, 'Late settlement cannot remove the current active reader');
        replacement.resolve(2);
        assert.deepEqual(await Promise.all([fresh, joined]), [2, 2]);
    });
}

test('invalidation prevents an older in-flight result from overwriting a newer value', async () => {
    const read = new SharedRead<number>(5000), old = deferred<number>();
    const previous = read.get(() => old.promise); await flush();
    read.invalidate(); assert.equal(await read.get(async () => 2), 2);
    old.resolve(1); assert.equal(await previous, 1);
    assert.equal(await read.get(async () => 3), 2);
});

test('read deadlines abort at the budget and can be disposed', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const parent = new AbortController(), deadline = readDeadline(5000, parent.signal);
    t.mock.timers.tick(4999); assert.equal(deadline.signal.aborted, false);
    t.mock.timers.tick(1); assert.equal(deadline.signal.reason.name, 'TimeoutError'); deadline.dispose();
    const cancelled = readDeadline(1, parent.signal); cancelled.dispose();
    t.mock.timers.tick(1); assert.equal(cancelled.signal.aborted, false);
    const expired = readDeadline(0, parent.signal);
    assert.equal(expired.signal.reason.name, 'TimeoutError'); expired.dispose();
});
