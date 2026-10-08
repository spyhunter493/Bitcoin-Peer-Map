import test from 'node:test';
import assert from 'node:assert/strict';
import { viewingAggregate } from '../../src/server/viewer-summary.ts';
import { FixtureRuntime, fixtureSettings } from '../layout_server.ts';

test('redaction emits only fixed availability and five-wide ranges, including zero and boundary groups', () => {
    const snapshot = new FixtureRuntime(fixtureSettings()).peers.snapshot();
    const source = snapshot.peers[0];
    snapshot.peers = Array.from({ length: 6 }, (_, index) => ({ ...source, id: index, addr: 'SECRET-ENDPOINT', lat: 1.2345,
        network: 'ipv4' as const, direction: index ? 'OUT' as const : 'IN' as const,
        secret_extension: 'SECRET-CREDENTIAL', as: 'SECRET-PROVIDER', country: 'SECRET-COUNTRY' }));
    const output = viewingAggregate(snapshot);
    assert.deepEqual(output, { availability: 'available', networks: {
        ipv4: { min: 5, max: 9 }, ipv6: { min: 0, max: 4 }, onion: { min: 0, max: 4 }, i2p: { min: 0, max: 4 }, cjdns: { min: 0, max: 4 },
    }, directions: { inbound: { min: 0, max: 4 }, outbound: { min: 5, max: 9 } } });
    assert.doesNotMatch(JSON.stringify(output), /SECRET|addr|country|lat|timestamp|last_success|extension|total/);
    snapshot.peers = [];
    assert.deepEqual(viewingAggregate(snapshot).networks.ipv4, { min: 0, max: 4 });
});

test('redacted availability distinguishes failed, unknown and stale cached snapshots without exposing errors', () => {
    const snapshot = new FixtureRuntime(fixtureSettings()).peers.snapshot();
    assert.equal(viewingAggregate(snapshot).availability, 'available');
    snapshot.status.connected = false;
    assert.equal(viewingAggregate(snapshot).availability, 'unavailable');
    snapshot.status.connected = true;
    snapshot.status.age_seconds = snapshot.status.stale_after_seconds + 1;
    assert.equal(viewingAggregate(snapshot).availability, 'unknown');
    const missing = { ...snapshot, status: { ...snapshot.status, connected: null, last_success_at: null, age_seconds: null } };
    assert.equal(viewingAggregate(missing).availability, 'unknown');
});
