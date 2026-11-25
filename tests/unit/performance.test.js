import test from 'node:test';
import assert from 'node:assert/strict';
import { create, STORAGE_KEY } from '../../src/static/js/core/performance.js';

function fixture(saved = null, fail = false) {
    const dataset = {}, mediaListeners = new Set(), storageListeners = new Set(), writes = [];
    let reduced = false;
    const media = { get matches() { return reduced; },
        addEventListener(_type, listener) { mediaListeners.add(listener); },
        removeEventListener(_type, listener) { mediaListeners.delete(listener); } };
    const storage = { getItem() { if (fail) throw Error('unavailable'); return saved; },
        setItem(key, value) { if (fail) throw Error('unavailable'); writes.push([key, value]); } };
    const policy = create({ document: { documentElement: { dataset } }, storage,
        view: { matchMedia: () => media,
            addEventListener(_type, listener) { storageListeners.add(listener); },
            removeEventListener(_type, listener) { storageListeners.delete(listener); } } });
    return { policy, dataset, writes, mediaListeners, storageListeners,
        reduce(value) { reduced = value; for (const listener of mediaListeners) listener(); },
        receive(value) { for (const listener of storageListeners) listener({ key: STORAGE_KEY, newValue: value }); } };
}

test('performance presets preserve Full by default and enforce the operating-system motion ceiling', () => {
    const f = fixture();
    assert.equal(f.policy.getState().preset, 'full');
    assert.equal(f.policy.getState().heavyEffects, true);
    assert.strictEqual(f.policy.getState(), f.policy.getState(), 'per-node reads reuse an immutable policy snapshot');
    f.policy.setPreset('reduced');
    assert.equal(f.policy.getState().heavyEffects, false);
    assert.equal(f.policy.getState().idleFps, 15);
    assert.equal(f.policy.getState().interactionFps, 30);
    assert.equal(f.policy.getState().staticMap, false);
    f.reduce(true);
    assert.equal(f.policy.getState().staticMap, true);
    f.policy.setPreset('full');
    assert.equal(f.policy.getState().preset, 'full');
    assert.equal(f.policy.getState().staticMap, true);
    assert.equal(f.policy.getState().heavyEffects, false);
    f.reduce(false);
    assert.equal(f.policy.getState().staticMap, false);
    assert.equal(f.policy.getState().heavyEffects, true);
    assert.deepEqual(f.writes.map(([key]) => key), [STORAGE_KEY, STORAGE_KEY], 'presets never rewrite Advanced settings');
    f.policy.dispose();
});

test('stored Static mode and browser-tab changes update effective rendering without extra writes', () => {
    const f = fixture('static');
    const calls = [];
    const stop = f.policy.subscribe(state => calls.push(state));
    assert.equal(f.dataset.performanceMotion, 'static');
    assert.equal(f.dataset.performancePreset, 'static');
    f.receive('reduced');
    assert.equal(f.policy.getState().preset, 'reduced');
    assert.equal(f.dataset.performanceEffects, 'reduced');
    assert.equal(f.dataset.performanceMotion, 'animated');
    assert.equal(calls.length, 1);
    assert.deepEqual(f.writes, []);
    stop();
    f.receive('full');
    assert.equal(calls.length, 1, 'feature disposal releases its subscription');
    f.policy.dispose();
    assert.equal(f.mediaListeners.size, 0);
    assert.equal(f.storageListeners.size, 0);
});

test('invalid preferences and unavailable browser storage keep the display usable', () => {
    const f = fixture('not-a-preset', true);
    assert.equal(f.policy.getState().preset, 'full');
    assert.equal(f.policy.setPreset('static').staticMap, true);
    assert.equal(f.policy.getState().persistent, false);
    assert.equal(f.dataset.performancePreset, 'static');
    assert.throws(() => f.policy.setPreset('unknown'), RangeError);
    assert.equal(f.policy.getState().preset, 'static');
    f.policy.dispose();
});
