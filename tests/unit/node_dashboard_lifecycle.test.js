import test from 'node:test';
import assert from 'node:assert/strict';
import { create as createDashboard } from '../../src/static/js/core/dashboard-state.js';
import { create as createNodeDashboard } from '../../src/static/js/node/dashboard.js';
import fixture from '../fixtures/dashboard.json' with { type: 'json' };

function environment(peers) {
    let nextId = 0, calls = 0;
    const timers = new Map(), frames = new Map(), intervals = new Map();
    const clock = {
        setTimeout: task => { timers.set(++nextId, task); return nextId; }, clearTimeout: id => timers.delete(id),
        requestAnimationFrame: task => { frames.set(++nextId, task); return nextId; }, cancelAnimationFrame: id => frames.delete(id),
        setInterval: task => { intervals.set(++nextId, task); return nextId; }, clearInterval: id => intervals.delete(id),
    };
    const chip = new EventTarget();
    chip.dataset = { net: 'onion' };
    const moPeers = { textContent: '', classList: { add() {}, remove() {} } };
    const document = { hidden: false, defaultView: null,
        querySelectorAll: selector => selector === '.fd-net-chip' ? [chip] : [], querySelector: () => null,
        getElementById: id => id === 'mo-peers' ? moPeers : null };
    const dashboard = createDashboard();
    dashboard.replace(peers);
    const requests = [];
    const api = { getJson: (_url, options) => new Promise(resolve => requests.push({ resolve, signal: options.signal })) };
    const instance = createNodeDashboard({ dashboard, document, clock, nowSeconds: () => 1000, api, storage: null,
        config: { infoPollInterval: 10000 }, onAction: () => calls++ });
    return { instance, dashboard, document, chip, requests, moPeers, timers, frames, intervals, calls: () => calls };
}
const info = { api_available: true, geo_db_only_mode: false, node_traffic: null, node_metrics: undefined,
    network_scores: { ipv4: 2, ipv6: null }, network_details: {} };

test('node components bind exactly once, dispose ownership, and reinitialize independently', async () => {
    const first = environment(fixture.peers.slice(0, 2)), second = environment(fixture.peers.slice(0, 1));
    first.instance.init();
    first.instance.init();
    first.chip.dispatchEvent(new Event('click'));
    assert.equal(first.calls(), 1);
    assert.equal(second.calls(), 0);
    first.instance.infoPolling.start();
    assert.equal(first.intervals.size, 1);
    const refresh = first.instance.fetchInfo();
    await Promise.resolve();
    first.requests[0].resolve(info);
    await refresh;
    assert.equal(first.moPeers.textContent, '2');
    const secondRefresh = second.instance.fetchInfo();
    await Promise.resolve();
    second.requests[0].resolve(info);
    await secondRefresh;
    assert.equal(second.moPeers.textContent, '1');
    first.instance.dispose();
    first.instance.dispose();
    assert.equal(first.intervals.size, 0);
    assert.equal(first.timers.size, 0);
    first.chip.dispatchEvent(new Event('click'));
    assert.equal(first.calls(), 1);
    second.chip.dispatchEvent(new Event('click'));
    assert.equal(second.calls(), 1);
    first.instance.init();
    first.chip.dispatchEvent(new Event('click'));
    assert.equal(first.calls(), 2);
    first.instance.dispose();
    second.instance.dispose();
});
test('disposing aborts an in-flight snapshot and prevents late response updates', async () => {
    const component = environment(fixture.peers.slice(0, 2));
    const pending = component.instance.fetchInfo();
    await Promise.resolve();
    const request = component.requests[0];
    assert.equal(request.signal.aborted, false);
    component.instance.dispose();
    assert.equal(request.signal.aborted, true);
    component.instance.init();
    const fresh = component.instance.fetchInfo();
    await Promise.resolve();
    assert.equal(component.requests.length, 2, 're-init can read immediately while the aborted request is unsettled');
    component.requests[1].resolve({ ...info, network_details: { onion: { reachable: true, proxy: 'new-proxy', localaddresses: [] } } });
    await fresh;
    assert.equal(component.moPeers.textContent, '2');
    request.resolve({ ...info, network_details: { onion: { reachable: true, proxy: 'obsolete-proxy', localaddresses: [] } } });
    await pending;
    assert.match(component.instance.getNetworkStats('onion'), /new-proxy/);
    assert.doesNotMatch(component.instance.getNetworkStats('onion'), /obsolete-proxy/);
    component.instance.dispose();
});
