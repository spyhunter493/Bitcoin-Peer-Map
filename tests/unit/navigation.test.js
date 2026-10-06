import assert from 'node:assert/strict';
import test from 'node:test';
import { create as createDashboard } from '../../src/static/js/core/dashboard-state.js';
import { create } from '../../src/static/js/map/navigation.js';

function fixture({ popup = true, latitude = 0 } = {}) {
    const dashboard = createDashboard();
    let peers = [1, 2].map((id) => ({ id, network: 'ipv4', lat: latitude, lon: 0, as: 'AS1 Example' }));
    dashboard.replace(peers);
    let nodes = peers.map((peer) => ({ peerId: peer.id, peer, lat: peer.lat, lon: peer.lon, alive: true }));
    let collapsed = false;
    const view = { x: 0, y: 0, zoom: 1 },
        target = { ...view };
    const opened = [],
        shown = [],
        refreshed = [],
        events = [];
    const timers = new Map();
    let nextTimer = 0;
    const navigation = create({
        interaction: dashboard.interaction,
        view,
        target,
        maxZoom: 18,
        getNodes: () => nodes,
        getPeer: (id) => dashboard.byId.get(id),
        getSize: () => ({ width: 1200, height: 900 }),
        isPanelCollapsed: () => collapsed,
        collapsePanel: () => {
            collapsed = true;
        },
        getWrapOffsets: () => [0],
        worldToScreen: () => ({ x: 600, y: 450 }),
        screenToWorld: () => ({ lon: 0, lat: latitude }),
        findNodesAtScreen: () => nodes.filter((node) => node.alive),
        tooltips: {
            hide() {},
            showGroupHoverTooltip() {},
            showGroupSelectionList() {},
            showPinnedPeerDetail: (node) => shown.push(node),
            refreshGroup: (group) => refreshed.push(group.map((node) => node.peerId)),
        },
        renderTable: () => events.push('table'),
        highlightRow() {},
        openPeerDetail: (peer, source, ids) => {
            opened.push({ id: peer.id, source, ids });
            return popup;
        },
        closePeerPopup() {},
        isPeerDetailActive: () => false,
        onMapClick: () => true,
        getProviderColor: () => '#123456',
        isPrivateMode: () => false,
        enterPrivateMode() {},
        selectPrivatePeer() {},
        clearPrivatePeer() {},
        schedule: (callback) => {
            timers.set(++nextTimer, callback);
            return nextTimer;
        },
        cancelScheduled: (timer) => timers.delete(timer),
    });
    return {
        navigation,
        dashboard,
        target,
        opened,
        shown,
        refreshed,
        events,
        timers,
        get collapsed() {
            return collapsed;
        },
        collapse() {
            collapsed = true;
        },
        replace(nextPeers) {
            peers = nextPeers;
            dashboard.replace(peers);
            nodes = peers.map((peer) => ({ peerId: peer.id, peer, lat: peer.lat, lon: peer.lon, alive: true }));
        },
        get peers() {
            return peers;
        },
        get nodes() {
            return nodes;
        },
        tick() {
            const callbacks = [...timers.values()];
            timers.clear();
            callbacks.forEach((callback) => callback());
        },
    };
}

test('table, map, and group selections preserve source context and camera framing', () => {
    for (const source of ['peerlist', 'map', 'map-group']) {
        const f = fixture();
        if (source === 'peerlist') f.navigation.selectTablePeer(1);
        else if (source === 'map') {
            f.replace([f.peers[0]]);
            f.navigation.clickMap(600, 450);
        } else {
            f.navigation.selectGroup(f.nodes, 600, 450);
            f.navigation.selectGroupPeer(1, false);
        }
        assert.equal(f.opened[0].source, source);
        assert.equal(f.target.zoom, 3);
        assert.ok(Math.abs(f.target.x + 16) < 1e-6);
        assert.ok(Math.abs(f.target.y + 76) < 1e-6);
        assert.deepEqual(f.opened[0].ids, source === 'map-group' ? [1, 2] : undefined);
    }
});

test('camera framing reads layout after the peer popup opens', () => {
    const f = fixture();
    // Use a callback which changes layout during popup opening.
    const navigation = create({
        ...minimalOptions(f),
        openPeerDetail: () => {
            f.collapse();
            return true;
        },
    });
    navigation.selectTablePeer(1);
    assert.ok(Math.abs(f.target.y + 40.0666666667) < 1e-6);
});

test('table details open for a peer without a rendered map node', () => {
    const f = fixture();
    const opened = [];
    const navigation = create({
        ...minimalOptions(f),
        getNodes: () => [],
        openPeerDetail: (peer, source) => { opened.push({ id: peer.id, source }); return true; },
    });
    assert.equal(navigation.selectTablePeer(1), true);
    assert.deepEqual(opened, [{ id: 1, source: 'peerlist' }]);
    assert.deepEqual(f.target, { x: 0, y: 0, zoom: 1 });
    assert.equal(navigation.selectTablePeer(999), false);
});

function minimalOptions(f) {
    return {
        interaction: f.dashboard.interaction,
        view: { x: 0, y: 0, zoom: 1 },
        target: f.target,
        maxZoom: 18,
        getNodes: () => f.nodes,
        getPeer: (id) => f.dashboard.byId.get(id),
        getSize: () => ({ width: 1200, height: 900 }),
        isPanelCollapsed: () => f.collapsed,
        collapsePanel: () => f.collapse(),
        getWrapOffsets: () => [0],
        worldToScreen: () => ({ x: 600, y: 450 }),
        screenToWorld: () => ({ lon: 0, lat: 0 }),
        findNodesAtScreen: () => f.nodes,
        tooltips: { hide() {}, showPinnedPeerDetail() {}, showGroupSelectionList() {}, refreshGroup() {} },
        renderTable() {},
        highlightRow() {},
        closePeerPopup() {},
        isPeerDetailActive: () => false,
        onMapClick: () => true,
        getProviderColor: () => '',
        isPrivateMode: () => false,
        enterPrivateMode() {},
        selectPrivatePeer() {},
        clearPrivatePeer() {},
    };
}

test('southern peers collapse the table only for the small-tooltip fallback', () => {
    const popup = fixture({ latitude: -60 });
    popup.navigation.selectTablePeer(1);
    assert.equal(popup.collapsed, false);
    const small = fixture({ popup: false, latitude: -60 });
    small.navigation.selectTablePeer(1);
    assert.equal(small.collapsed, true);
});

test('departed peers cancel delayed tooltips and cannot be selected through stale group rows', () => {
    const f = fixture();
    f.navigation.zoomToPeer(1);
    assert.equal(f.timers.size, 1);
    f.replace([f.peers[1]]);
    f.navigation.reconcile();
    assert.equal(f.timers.size, 0);
    f.tick();
    assert.deepEqual(f.shown, []);
    f.dashboard.interaction.groupedNodes = [{ peerId: 1 }];
    f.navigation.selectGroupPeer(1, false);
    assert.deepEqual(f.opened, []);
});

test('replacement selection cancels the old timer and resolves the current node at execution', () => {
    const f = fixture();
    f.navigation.zoomToPeer(1);
    f.navigation.zoomToPeer(2);
    assert.equal(f.timers.size, 1);
    f.replace(f.peers.map((peer) => ({ ...peer, subver: 'Updated' })));
    f.tick();
    assert.deepEqual(
        f.shown.map((node) => node.peerId),
        [2]
    );
    assert.equal(f.shown[0].peer.subver, 'Updated');
});

test('pinned groups reconcile arrivals and departures while empty filters stay active', () => {
    const f = fixture();
    f.navigation.selectGroup(f.nodes, 600, 450);
    f.replace([{ ...f.peers[1] }, { ...f.peers[1], id: 3 }]);
    f.navigation.reconcile();
    assert.deepEqual(f.refreshed.at(-1), [2, 3]);
    assert.deepEqual([...f.dashboard.interaction.mapFilterPeerIds], [2, 3]);
    f.replace([]);
    f.navigation.reconcile();
    assert.deepEqual(f.refreshed.at(-1), []);
    assert.equal(f.dashboard.interaction.mapFilterPeerIds.size, 0);
    f.navigation.filterPeerTable([]);
    assert.equal(f.dashboard.interaction.asFilterPeerIds.size, 0);
    f.navigation.filterPeerTable(null);
    assert.equal(f.dashboard.interaction.asFilterPeerIds, null);
});
