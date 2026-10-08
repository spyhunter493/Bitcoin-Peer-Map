import assert from 'node:assert/strict';
import test from 'node:test';
import { create } from '../../src/static/js/distribution/selection.js';

function closeMapPeer(scope) {
    const state = {
        summarySelected: false, selectedProvider: null, activeNetwork: null,
        filterPeerIds: null, subSubFilterPeerIds: null, insightActiveAsNum: null,
        peerDetailActive: true, selectedPeerId: 1, ...scope,
    };
    let restored;
    const selection = create({
        state,
        getDashboard: () => ({ peers: [{ id: 1, network: 'ipv4' }, { id: 2, network: 'ipv4' }, { id: 3, network: 'ipv6' }] }),
        getPeerDetail: () => ({ close() {} }),
        getTooltips: () => ({ clearPeerHighlight() {} }),
        getSegments: () => [{ asNumber: 'AS64500', peerIds: [1, 2, 3], color: '#abcdef' }],
        actions: { renderCenter() {}, getPeerIdsForAnyAs: () => [1, 2, 3], getColorForAsNum: () => '#abcdef' },
        hooks: { filterPeerTable: ids => { restored = ids; } },
    }, () => ({ summaryPreviewSummaryLines: ids => { restored = ids; }, activateHoverAll() {} }));
    selection.closePeerPopup(true);
    assert.equal(state.peerDetailActive, false);
    assert.equal(state.selectedPeerId, null);
    assert.deepEqual(state.filterPeerIds, scope.filterPeerIds ?? null);
    assert.deepEqual(state.subSubFilterPeerIds, scope.subSubFilterPeerIds ?? null);
    return restored;
}

test('removing a map peer preserves the provider subgroup rather than broadening to the provider', () => {
    assert.deepEqual(closeMapPeer({ selectedProvider: 'AS64500', filterPeerIds: [1, 2] }), [1, 2]);
    assert.deepEqual(closeMapPeer({ selectedProvider: 'AS64500', filterPeerIds: [1, 2], subSubFilterPeerIds: [2] }), [2]);
});

test('removing a map peer preserves summary secondary scopes including empty results', () => {
    assert.deepEqual(closeMapPeer({ summarySelected: true, filterPeerIds: [1, 2], subSubFilterPeerIds: [2] }), [2]);
    assert.deepEqual(closeMapPeer({ summarySelected: true, filterPeerIds: [1, 2], subSubFilterPeerIds: [] }), []);
});

test('removing a map peer intersects a summary category or secondary scope with the active insight provider', () => {
    assert.deepEqual(closeMapPeer({ summarySelected: true, insightActiveAsNum: 'AS64500', filterPeerIds: [2, 4] }), [2]);
    assert.deepEqual(closeMapPeer({ summarySelected: true, insightActiveAsNum: 'AS64500', filterPeerIds: [1, 2, 4], subSubFilterPeerIds: [2] }), [2]);
});

test('removing a map peer restores the public network scope, or all peers when no scope remains', () => {
    assert.deepEqual(closeMapPeer({ summarySelected: true, activeNetwork: 'ipv4' }), [1, 2]);
    assert.deepEqual(closeMapPeer({ activeNetwork: 'ipv4' }), [1, 2]);
    assert.deepEqual(closeMapPeer({ summarySelected: true, activeNetwork: 'ipv4', filterPeerIds: [2] }), [2]);
    assert.equal(closeMapPeer({ summarySelected: true }), null);
});
