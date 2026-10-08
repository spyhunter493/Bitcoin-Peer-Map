import test from 'node:test';
import assert from 'node:assert/strict';
import { create as createViewing } from '../../src/static/js/core/viewer-auth.js';
import { create as createDashboard } from '../../src/static/js/core/dashboard-state.js';

test('locking wipes private DOM even if a component disposal callback throws', t => {
    const original = globalThis.document;
    const children = [{ textContent: 'PRIVATE-PEER-ADDRESS' }];
    globalThis.document = { body: {
        replaceChildren() { children.length = 0; }, append(child) { children.push(child); },
    }, createElement() { return { textContent: '' }; } };
    t.after(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
    const viewing = createViewing({ onAuthorized() {}, onLock() { throw new Error('Failed component cleanup'); } });
    assert.doesNotThrow(() => viewing.lock(false));
    assert.equal(children.length, 1);
    assert.equal(children[0].id, 'view-reset-notice');
    assert.equal(JSON.stringify(children).includes('PRIVATE-PEER-ADDRESS'), false);
});

test('dashboard clearing releases peer records and all public/private selection and insight references', () => {
    const dashboard = createDashboard();
    const peer = { id: 1, addr: 'PRIVATE-PEER' };
    dashboard.replace([peer]);
    dashboard.interaction.pinnedNode = { peerId: 1, peer };
    dashboard.interaction.groupedNodes = [{ peerId: 1, peer }];
    dashboard.interaction.asFilterPeerIds = new Set([1]);
    dashboard.distribution.selectedPeerId = 1;
    dashboard.distribution.insightActiveData = { peerIds: [1], private: 'PRIVATE-PEER' };
    dashboard.privateNetwork.pnInsightActiveData = { private: 'PRIVATE-PEER' };
    dashboard.privateNetwork.pnFilter = { filter: { kind: 'software', key: 'PRIVATE-PEER' }, label: 'PRIVATE-PEER' };
    dashboard.clear();
    assert.deepEqual(dashboard.peers, []);
    assert.equal(dashboard.byId.size, 0);
    assert.equal(dashboard.interaction.pinnedNode, null);
    assert.equal(dashboard.interaction.groupedNodes, null);
    assert.equal(dashboard.interaction.asFilterPeerIds, null);
    assert.equal(dashboard.distribution.selectedPeerId, null);
    assert.equal(dashboard.distribution.insightActiveData, null);
    assert.equal(dashboard.privateNetwork.pnInsightActiveData, null);
    assert.equal(dashboard.privateNetwork.pnFilter, null);
});
