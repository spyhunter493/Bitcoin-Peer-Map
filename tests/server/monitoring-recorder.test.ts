import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryRecorder } from '../../src/server/monitoring/recorder.ts';
import { parsePeerInfo } from '../../src/server/rpc-types.ts';

const peer = (id: number, address = '198.51.100.1:8333', conntime = 1) =>
    parsePeerInfo([{ id, addr: address, conntime, inbound: true, network: 'ipv4', connection_type: 'inbound' }])[0];
test('history uses successful baselines and does not invent arrivals or departures across outages', () => {
    const r = new HistoryRecorder();
    r.observe([peer(1)], 1000, 100);
    assert.deepEqual(r.drain(), []);
    r.setEnabled(true, 100);
    r.observe([peer(1)], 1000, 100);
    assert.deepEqual(
        r.drain().map((e) => e.kind),
        ['recording_started']
    );
    r.observe([peer(1), peer(2, '198.51.100.2:8333')], 2000, 101);
    assert.deepEqual(
        r.drain().map((e) => e.kind),
        ['arrived']
    );
    r.observe(null, 3000, 102);
    r.observe(null, 4000, 103);
    assert.deepEqual(
        r.drain().map((e) => e.kind),
        ['monitoring_gap']
    );
    r.observe([peer(3)], 5000, 104);
    assert.deepEqual(
        r.drain().map((e) => e.kind),
        ['monitoring_recovered']
    );
    r.observe([], 6000, 105);
    const events = r.drain();
    assert.deepEqual(
        events.map((e) => e.kind),
        ['departed']
    );
    assert.match(events[0].reason, /cause is unknown/);
});
test('changed connection identity and same-address return are separate observations, not client identity claims', () => {
    const r = new HistoryRecorder();
    r.setEnabled(true, 100);
    r.observe([peer(1)], 1000, 100);
    r.drain();
    r.observe([], 2000, 101);
    r.drain();
    r.observe([peer(1, '198.51.100.1:8333', 2)], 3000, 102);
    assert.deepEqual(
        r.drain().map((e) => e.kind),
        ['arrived', 'same_address_return']
    );
});
test('clock anomalies and oversized observations reset the baseline without a mass departure', () => {
    const r = new HistoryRecorder();
    r.setEnabled(true, 100);
    r.observe([peer(1)], 1000, 100);
    r.drain();
    r.observe([], 2000, 50);
    assert.deepEqual(
        r.drain().map((e) => e.kind),
        ['clock_gap']
    );
    r.observe(
        Array.from({ length: 2001 }, (_, i) => peer(i)),
        3000,
        51
    );
    assert.deepEqual(
        r.drain().map((e) => e.kind),
        ['monitoring_gap']
    );
    assert.equal(r.baselineValid(), false);
});
test('disabling recording stops events and reenabling starts a fresh baseline', () => {
    const r = new HistoryRecorder();
    r.setEnabled(true, 100);
    r.observe([peer(1)], 1000, 100);
    r.drain();
    r.setEnabled(false, 101);
    r.observe([], 2000, 101);
    assert.deepEqual(r.drain(), []);
    r.setEnabled(true, 102);
    r.observe([peer(2)], 3000, 102);
    assert.deepEqual(
        r.drain().map((e) => e.kind),
        ['recording_started']
    );
});
