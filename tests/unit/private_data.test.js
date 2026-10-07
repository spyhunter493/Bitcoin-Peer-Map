import test from 'node:test';
import assert from 'node:assert/strict';
import { scope, summarize, insights, liveCounts } from '../../src/static/js/peers/private-data.js';
import fixture from '../fixtures/dashboard.json' with { type: 'json' };
const seed = fixture.peers.find(peer => peer.network === 'onion');
const peer = (id, changes = {}) => ({ ...seed, id, ...changes });

test('private snapshot aggregation preserves direction, missing ping, and grouping', () => {
    const peers = [peer(1, { network: 'onion', direction: 'IN', ping_ms: 0, subver: '__proto__', bytessent: 5, bytesrecv: 6 }),
        peer(2, { network: 'i2p', direction: 'OUT', ping_ms: null, subver: '__proto__', bytessent: 7, bytesrecv: 8 }),
        peer(3, { network: 'ipv4', direction: 'OUT', ping_ms: 100 })];
    assert.deepEqual(scope(peers).map(peer => peer.id), [1, 2]);
    assert.deepEqual(scope(peers, 'i2p').map(peer => peer.id), [2]);
    const summary = summarize(scope(peers));
    assert.equal(summary.inbound, 1);
    assert.equal(summary.outbound, 1);
    assert.equal(summary.avgPing, 0);
    assert.equal(summary.totalBytesSent, 12);
    assert.equal(summary.totalBytesRecv, 14);
    assert.equal(summary.softwareMap.__proto__.length, 2);
    assert.equal(summarize([]).avgPing, null);
});
test('insights use an explicit clock and retain the first winner for ties', () => {
    const peers = [peer(1, { conntime: 900, ping_ms: 0, bytessent: 8, bytesrecv: 0 }),
        peer(2, { conntime: 900, ping_ms: 0, bytessent: 8, bytesrecv: 0 })];
    const result = insights(peers, 1000);
    assert.equal(result.bestStablePeer.id, 1);
    assert.equal(result.bestStableDur, 100);
    assert.equal(result.bestPingPeer.id, 1);
    assert.equal(result.bestSentPeer.id, 1);
    assert.equal(result.bestRecvPeer, null);
    assert.equal(insights(peers, 1200).bestStableDur, 300);
    assert.equal(insights([peer(3, { conntime: 0, ping_ms: null, bytessent: 0, bytesrecv: 0 })], 1000).bestStablePeer, null);
});
test('live donut counts exclude dying nodes without altering snapshot counts', () => {
    const peers = [peer(1), peer(2), peer(3, { network: 'ipv4' })];
    const nodes = peers.map((peer, index) => ({ peer, alive: index !== 1 }));
    assert.equal(scope(peers).length, 2);
    assert.deepEqual(liveCounts(nodes), { counts: { onion: 1, i2p: 0, cjdns: 0 }, total: 1 });
    assert.equal(liveCounts([]).total, 0);
});

test('independent private controllers own their state and pending navigation timers', async () => {
    const { create: createDashboard } = await import('../../src/static/js/core/dashboard-state.js');
    const { create: createPrivateNetwork } = await import('../../src/static/js/peers/private-network.js');
    const clocks = [];
    const component = () => {
        const timers = new Map(), frames = new Map();
        let nextId = 0;
        const clock = {
            setTimeout: task => { timers.set(++nextId, task); return nextId; }, clearTimeout: id => timers.delete(id),
            requestAnimationFrame: task => { frames.set(++nextId, task); return nextId; }, cancelAnimationFrame: id => frames.delete(id),
        };
        clocks.push({ timers, frames });
        const classes = new Set();
        const document = { body: { classList: { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)) } },
            getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], activeElement: null, defaultView: null };
        const dashboard = createDashboard();
        dashboard.replace([peer(1)]);
        const instance = createPrivateNetwork({ dashboard, document, clock, nowSeconds: () => 1000,
            distribution: { closePeerPopup() {}, deselect() {}, isFocusedMode: () => false },
            mapView: { nodes: [], target: { x: 0, y: 0, zoom: 1 }, width: 1000, height: 500 },
            settings: { showDonutLegends: true }, onAction() {} });
        return { instance, dashboard, classes };
    };
    const first = component(), second = component();
    first.instance.enterPrivateNetMode();
    assert.equal(first.dashboard.privateNetwork.privateNetMode, true);
    assert.equal(second.dashboard.privateNetwork.privateNetMode, false);
    assert.ok(clocks[0].timers.size > 0);
    first.instance.dispose();
    first.instance.dispose();
    assert.equal(clocks[0].timers.size, 0);
    assert.equal(first.classes.has('private-net-mode'), false);
    first.instance.enterPrivateNetMode();
    assert.equal(first.dashboard.privateNetwork.privateNetMode, false);
    first.instance.init();
    first.instance.init();
    first.instance.enterPrivateNetMode();
    assert.equal(first.dashboard.privateNetwork.privateNetMode, true);
    second.instance.enterPrivateNetMode();
    first.instance.dispose();
    assert.equal(second.dashboard.privateNetwork.privateNetMode, true);
    second.instance.dispose();
});
