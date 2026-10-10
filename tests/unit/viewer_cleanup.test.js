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

test('an explicit view lock waits for cookie revocation and leaves private data wiped when logout fails', async t => {
    const originalDocument = globalThis.document, originalLocation = globalThis.location;
    const children = [{ textContent: 'PRIVATE-PEER-ADDRESS' }], navigations = [], requests = [];
    globalThis.document = { body: {
        replaceChildren() { children.length = 0; }, append(child) { children.push(child); },
    }, createElement() { return { textContent: '', addEventListener() {} }; },
    getElementById(id) { return children.find(child => child.id === id); } };
    globalThis.location = { replace(path) { navigations.push(path); } };
    t.after(() => {
        if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
        if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
    });
    let failing = true;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, method: options.method });
        assert.equal(JSON.stringify(children).includes('PRIVATE-PEER-ADDRESS'), false);
        return Response.json({ success: !failing }, { status: failing ? 500 : 200 });
    });
    const viewing = createViewing({ onAuthorized() {}, onLock() {} });
    await viewing.lock();
    assert.deepEqual(navigations, []);
    assert.ok(children.some(child => child.textContent === 'Retry lock'));
    assert.equal(JSON.stringify(children).includes('PRIVATE-PEER-ADDRESS'), false);
    failing = false;
    await viewing.lock();
    assert.deepEqual(navigations, ['/']);
    assert.deepEqual(requests, [{ url: '/api/view/logout', method: 'POST' }, { url: '/api/view/logout', method: 'POST' }]);
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
