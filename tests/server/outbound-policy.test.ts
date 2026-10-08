import test from 'node:test';
import assert from 'node:assert/strict';
import { OutboundPolicy } from '../../src/server/outbound-policy.ts';
import type { OutboundFeature } from '../../src/server/outbound-policy.ts';

const allowed = { geoip: true, dataset: true, updates: true, probe: true };
test('feature denial aborts only its owned work and re-enabling cannot revive old callbacks', () => {
    const policy = new OutboundPolicy(allowed);
    const old = policy.signal('geoip'), dataset = policy.signal('dataset');
    let changes = 0;
    policy.subscribe((feature, enabled) => {
        changes++;
        assert.equal(feature, 'geoip');
        assert.equal(policy.allowed(feature), enabled);
        assert.equal(policy.signal(feature).aborted, !enabled);
    });
    policy.update({ ...allowed, geoip: false });
    assert.equal(old.aborted, true);
    assert.equal(dataset.aborted, false);
    policy.update({ ...allowed, geoip: false });
    assert.equal(changes, 1, 'idempotent updates preserve generation and listeners');
    policy.update(allowed);
    assert.notEqual(policy.signal('geoip'), old);
    assert.equal(old.aborted, true, 'late work keeps its cancelled generation');
    assert.equal(policy.signal('geoip').aborted, false);
    assert.equal(policy.signal('dataset'), dataset);
    policy.close();
});

test('global denial publishes all cancelled generations before notifying subscribers', () => {
    const policy = new OutboundPolicy(allowed);
    let changes = 0;
    const unsubscribe = policy.subscribe(() => {
        changes++;
        for (const feature of Object.keys(allowed) as OutboundFeature[]) {
            assert.equal(policy.allowed(feature), false);
            assert.equal(policy.signal(feature).aborted, true);
        }
    });
    policy.update({ geoip: false, dataset: false, updates: false, probe: false });
    assert.equal(changes, 4);
    unsubscribe();
    policy.update(allowed);
    assert.equal(changes, 4);
    policy.close();
    policy.update(allowed);
    for (const feature of Object.keys(allowed) as OutboundFeature[]) {
        assert.equal(policy.allowed(feature), false);
        assert.equal(policy.signal(feature).aborted, true);
    }
});

test('initial denied features never expose a usable network signal and instances are independent', () => {
    const first = new OutboundPolicy({ ...allowed, probe: false }), second = new OutboundPolicy(allowed);
    assert.equal(first.allowed('probe'), false);
    assert.equal(first.signal('probe').aborted, true);
    first.close();
    assert.equal(second.allowed('geoip'), true);
    assert.equal(second.signal('geoip').aborted, false);
    second.close();
});
