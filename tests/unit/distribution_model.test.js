import assert from 'node:assert/strict';
import test from 'node:test';
import { create as createDashboard } from '../../src/static/js/core/dashboard-state.js';
import { create as createModel } from '../../src/static/js/distribution/model.js';
import { create as createDistribution } from '../../src/static/js/distribution/controller.js';
import fixture from '../fixtures/dashboard.json' with { type: 'json' };

const base = fixture.peers.find(peer => peer.is_public);
const peers = [
    { ...base, id: 1, as: 'AS1 Alpha', countryCode: 'NZ', country: 'New Zealand', conntime: 900 },
    { ...base, id: 2, as: 'AS2 Beta', countryCode: 'AU', country: 'Australia', conntime: 800 },
    { ...base, id: 3, as: '', countryCode: 'NZ', country: 'New Zealand' },
    { ...base, id: 4, is_public: false, as: 'AS3 Private', countryCode: 'US', country: 'United States' },
];

function modelFixture() {
    const dashboard = createDashboard();
    const model = createModel({
        dashboard, palette: ['red', 'blue', 'gray'], maxSegments: 1,
        connectionTypeLabels: {}, nowSeconds: () => 1000,
    });
    return { dashboard, model };
}

test('independent models process identical snapshots and maintain separate lenses', () => {
    const first = modelFixture(), second = modelFixture();
    assert.equal(first.model.update(peers), true);
    assert.equal(second.model.update(peers), true);
    assert.equal(first.model.providerTotal, 2);
    assert.equal(first.model.countryTotal, 3);
    assert.equal(first.model.providerScore, 5);
    assert.equal(first.model.providerGroups[0].avgDurationSecs, 100);
    assert.notEqual(first.model.providerGroups, second.model.providerGroups);
    assert.notEqual(first.model.providerSegments, second.model.providerSegments);
    assert.equal(first.model.providerSegments[1].isOthers, true);
    assert.deepEqual(first.model.getPeerIdsForAnyAs('AS2'), [2]);
    assert.equal(first.model.getColorForAsNum('AS2'), 'gray');

    first.dashboard.distribution.setLens('country');
    assert.equal(first.model.getActiveEntityKind(), 'Country');
    assert.equal(first.model.getActiveTotalPeers(), 3);
    assert.equal(second.model.getActiveEntityKind(), 'ISP');
    assert.equal(second.model.getActiveTotalPeers(), 2);
    // Map-provider colors remain provider-based while the country lens is active.
    assert.equal(first.model.getColorForAs('AS1'), 'red');
    assert.equal(first.model.getColorForAs('AS2'), null);
    assert.deepEqual(first.model.computeCountrySummaryData().coverage, {
        eligible: 3, known: 3, unknown: 0, lens: 'country',
        inbound: { eligible: 3, known: 3, unknown: 0 },
        outbound: { eligible: 0, known: 0, unknown: 0 },
    });
    assert.match(first.model.buildActiveScoreTooltip(first.model.countryScore), /Country known for 3\/3 public peers/);
});

test('deduplication still replaces current peer objects and refreshes changed data', () => {
    const { dashboard, model } = modelFixture();
    model.update(peers);
    const replacement = structuredClone(peers);
    const groups = model.providerGroups;
    assert.equal(model.update(replacement), false);
    assert.equal(dashboard.byId.get(1), replacement[0]);
    assert.equal(model.providerGroups, groups);

    replacement[0].as = 'AS4 Replacement';
    assert.equal(model.update(replacement), true);
    assert.equal(model.getColorForAs('AS1'), null);
    assert.deepEqual(model.getPeerIdsForAnyAs('AS4'), [1]);
    assert.equal(model.update([]), true);
    assert.equal(dashboard.peers.length, 0);
    assert.equal(model.providerTotal, 0);
    assert.equal(model.countryTotal, 0);
    assert.equal(model.computeSummaryData().quality.word, 'Unavailable');
    assert.equal(model.computeCountrySummaryData().quality.word, 'Unavailable');
});

function documentFixture() {
    return {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        body: { classList: { add() {}, remove() {} } },
    };
}

test('controller instances share neither cached data, selection nor live hooks', t => {
    const document = documentFixture();
    const previousDocument = globalThis.document;
    globalThis.document = document;
    t.after(() => { globalThis.document = previousDocument; });
    const firstDashboard = createDashboard(), secondDashboard = createDashboard();
    const calls = [];
    const first = createDistribution({ dashboard: firstDashboard, document,
        hooks: { clearAsLines: () => calls.push('first') } });
    const second = createDistribution({ dashboard: secondDashboard, document,
        hooks: { clearAsLines: () => calls.push('second') } });
    t.after(() => { first.dispose(); second.dispose(); });
    first.update(peers);
    second.update(peers);
    assert.equal(first.getColorForAs('AS1'), second.getColorForAs('AS1'));
    assert.notEqual(first.getColorForAs('AS1'), null);
    firstDashboard.distribution.selectedProvider = 'AS1';
    firstDashboard.distribution.panelHistory.push({ type: 'summary', scrollTop: 42 });
    assert.equal(first.getSelectedAs(), 'AS1');
    assert.equal(second.getSelectedAs(), null);
    assert.deepEqual(secondDashboard.distribution.panelHistory, []);

    first.deselect();
    second.deselect();
    assert.deepEqual(calls, ['first', 'second']);
    first.setHooks({ clearAsLines: () => calls.push('replacement'),
        dimMapPeers: ids => calls.push(ids) });
    first.deselect();
    assert.deepEqual(calls, ['first', 'second', null, 'replacement']);
    first.setHooks({});
    first.deselect();
    assert.equal(calls.length, 4, 'replacing hooks removes callbacks omitted by the new registration');
    second.update([{ ...peers[0], as: 'AS9 Separate' }]);
    assert.equal(second.getColorForAs('AS1'), null);
    assert.notEqual(first.getColorForAs('AS1'), null);
});

test('disposal is idempotent and prevents later initialization and snapshot effects', () => {
    const dashboard = createDashboard();
    const distribution = createDistribution({ dashboard, document: documentFixture() });
    distribution.update(peers);
    distribution.dispose();
    distribution.dispose();
    distribution.init();
    distribution.update([]);
    distribution.enterFocusedMode();
    distribution.openNetworkPanel('ipv4');
    distribution.openPeerDetailPanel(peers[0]);
    assert.equal(distribution.onMapClick(), false);
    distribution.deselect();
    distribution.closePeerPopup();
    assert.equal(dashboard.peers, peers);
    assert.equal(dashboard.distribution.donutFocused, false);
    assert.equal(distribution.getSelectedAs(), null);
    assert.equal(distribution.isPeerDetailActive(), false);
    assert.notEqual(distribution.getColorForAs('AS1'), null);
});

test('disposal removes only that instance’s reduced-motion listener', t => {
    const callbacks = new Set();
    const previous = globalThis.matchMedia;
    globalThis.matchMedia = () => ({
        matches: false,
        addEventListener: (_event, callback) => callbacks.add(callback),
        removeEventListener: (_event, callback) => callbacks.delete(callback),
    });
    t.after(() => { globalThis.matchMedia = previous; });
    const first = createDistribution({ dashboard: createDashboard(), document: documentFixture() });
    const second = createDistribution({ dashboard: createDashboard(), document: documentFixture() });
    t.after(() => { first.dispose(); second.dispose(); });
    assert.equal(callbacks.size, 2);
    first.dispose();
    assert.equal(callbacks.size, 1);
    second.dispose();
    assert.equal(callbacks.size, 0);
});
