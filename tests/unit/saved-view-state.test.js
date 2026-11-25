import test from 'node:test';
import assert from 'node:assert/strict';
import { captureFilter, resolveSavedFilter, validateFilter } from '../../src/static/js/peers/view-state.js';
import { create } from '../../src/static/js/core/dashboard-state.js';

const peer = (id, asNumber = 42) => ({ id, network: 'ipv4', is_public: true, direction: 'OUT', as: `AS${asNumber} Example`, asname: `Provider ${asNumber}`, isp: `Provider ${asNumber}`, countryCode: 'NZ', country: 'New Zealand', ping_ms: 12, bytessent: 0, bytesrecv: 0, conntime: 1, services: [] });
test('saved provider views resolve against current peers after IDs and connections change', () => {
    const dashboard = create();
    dashboard.interaction.asFilterPeerIds = new Set([1]); dashboard.distribution.selectedProvider = 'AS42';
    const filter = captureFilter(dashboard);
    assert.deepEqual(filter, { kind: 'provider', key: 'AS42' });
    assert.deepEqual(resolveSavedFilter([peer(200), peer(300, 99)], filter).map(p => p.id), [200]);
    assert.deepEqual(resolveSavedFilter([peer(300, 99)], filter), [], 'zero matches do not broaden the filter');
    dashboard.interaction.mapFilterPeerIds = new Set([200]);
    assert.throws(() => captureFilter(dashboard), /Individual peer selections are not saved/);
});
test('saved Others filters follow the current top-eight providers without recording IDs', () => {
    const peers = Array.from({ length: 9 }, (_, i) => peer(i + 1, i + 1));
    const filter = { kind: 'others', key: 'provider' };
    assert.deepEqual(resolveSavedFilter(peers, filter).map(p => p.id), [9]);
    const changed = [...peers, peer(20, 9), peer(21, 9)];
    assert.deepEqual(resolveSavedFilter(changed, filter).map(p => p.id), [8]);
});
test('unsupported and excessively nested saved filters are rejected before application', () => {
    assert.throws(() => validateFilter({ kind: 'future-filter', key: 'anything' }), /unsupported filter/);
    let filter = { kind: 'network', key: 'onion' };
    for (let i = 0; i < 6; i++) filter = { kind: 'all', filters: [filter] };
    assert.throws(() => validateFilter(filter), /unsupported filter/);
});
