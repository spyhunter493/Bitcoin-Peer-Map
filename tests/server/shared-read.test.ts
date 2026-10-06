import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedRead, readDeadline } from '../../src/server/shared-read.ts';
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
    now = 5999;
    await assert.rejects(read.get(async () => assert.fail('Failure cache must share the failed read')), error);
    now = 6000;
    assert.equal(await read.get(async () => 2), 2);
});

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
