import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine, defaultAlertSettings } from '../../src/server/monitoring/alerts.ts';
const conditions = { peer_data: false, low_outbound: false, policy_failure: false, recording_failure: false };
test('one incident per rule survives acknowledgement and long active periods, then resolves after recovery', () => {
    const engine = new AlertEngine();
    let changed = engine.tick(100, { ...conditions, peer_data: true });
    assert.equal(changed.length, 1);
    const id = changed[0].id;
    engine.acknowledge(id, 101);
    assert.equal(engine.tick(110, { ...conditions, peer_data: true }).length, 0);
    engine.tick(100 + 40 * 86400, { ...conditions, peer_data: true });
    assert.equal(engine.snapshot().length, 1);
    assert.equal(engine.snapshot()[0].id, id);
    assert.equal(engine.tick(100 + 40 * 86400, conditions).length, 0);
    assert.equal(engine.tick(129 + 40 * 86400, conditions).length, 0);
    changed = engine.tick(130 + 40 * 86400, conditions);
    assert.equal(changed[0].state, 'resolved');
    assert.equal(changed[0].acknowledged_at, 101);
    assert.equal(engine.tick(131 + 40 * 86400, { ...conditions, peer_data: true }).length, 1);
});
test('disabled rules do not raise and restoration does not duplicate an active incident', () => {
    const engine = new AlertEngine(),
        settings = defaultAlertSettings();
    settings.rules.low_outbound = false;
    engine.settings = settings;
    engine.tick(100, { ...conditions, low_outbound: true });
    assert.deepEqual(engine.snapshot(), []);
    engine.tick(101, { ...conditions, policy_failure: true });
    const restored = new AlertEngine();
    restored.restore(engine.snapshot(), engine.settings);
    assert.equal(restored.tick(102, { ...conditions, policy_failure: true }).length, 0);
    assert.equal(restored.snapshot().length, 1);
});
