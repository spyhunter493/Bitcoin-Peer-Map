'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const sandbox = { window: { AbortController, setTimeout, clearTimeout } };
vm.runInNewContext(fs.readFileSync('src/static/js/features/peer-refresh.js', 'utf8'), sandbox);

function snapshot(peers, connected, lastSuccess = 1000, age = 0) {
    return { peers, status: {
        connected, last_success_at: lastSuccess, age_seconds: age, stale_after_seconds: 30,
    } };
}

(async () => {
    let now = 0;
    let response = snapshot([], null, null, null);
    const applied = [];
    const statuses = [];
    const client = sandbox.window.BPMPeerRefresh.create({
        now: () => now,
        api: { getJson: async () => {
            if (response instanceof Error) throw response;
            return response;
        } },
        onPeers: peers => applied.push(peers),
        onStatus: status => statuses.push(status),
    });
    await client.refresh();
    assert.strictEqual(client.getStatus().state, 'connecting');
    assert.strictEqual(applied.length, 0);
    response = snapshot([], false, null, null);
    await client.refresh();
    assert.strictEqual(client.getStatus().state, 'node-unavailable');
    assert.strictEqual(client.getStatus().ageSeconds, null);
    assert.strictEqual(applied.length, 0);

    response = snapshot([{ id: 7 }], true);
    await client.refresh();
    assert.strictEqual(client.getStatus().state, 'live');
    assert.strictEqual(applied.length, 1);
    now = 5000;
    response = snapshot([{ id: 7 }], false, 1000, 5);
    await client.refresh();
    assert.strictEqual(client.getStatus().state, 'node-unavailable');
    assert.strictEqual(client.getStatus().stale, true);
    assert.strictEqual(applied.length, 1);
    response = new Error('HTTP 503');
    await client.refresh();
    now = 9000;
    client.renderStatus();
    assert.strictEqual(client.getStatus().state, 'dashboard-unavailable');
    assert.strictEqual(statuses.at(-1).ageSeconds, 9);
    assert.strictEqual(applied.length, 1);

    // A restarted backend has no snapshot yet; retain what the browser last saw.
    response = snapshot([], null, null, null);
    await client.refresh();
    assert.strictEqual(client.getStatus().stale, true);
    assert.strictEqual(applied.length, 1);
    response = snapshot([], true, 1010);
    await client.refresh();
    assert.strictEqual(client.getStatus().state, 'live');
    assert.deepStrictEqual(applied.at(-1), []);
    now += 31000;
    assert.strictEqual(client.getStatus().state, 'delayed');
    response = { peers: [], status: { connected: true } };
    await client.refresh();
    assert.strictEqual(client.getStatus().state, 'dashboard-unavailable');
    assert.strictEqual(applied.length, 2);

    // A new page can display the server's cached peers during an RPC outage.
    const cached = [];
    const initialCached = sandbox.window.BPMPeerRefresh.create({
        api: { getJson: async () => snapshot([{ id: 8 }], false, 900, 100) },
        onPeers: peers => cached.push(peers), onStatus: () => {},
    });
    await initialCached.refresh();
    assert.strictEqual(cached[0][0].id, 8);
    assert.strictEqual(initialCached.getStatus().stale, true);

    let resolve;
    let requests = 0;
    const delayed = sandbox.window.BPMPeerRefresh.create({
        api: { getJson: () => { requests++; return new Promise(done => { resolve = done; }); } },
        onPeers: () => {}, onStatus: () => {},
    });
    const first = delayed.refresh();
    const second = delayed.refresh();
    assert.strictEqual(first, second);
    await Promise.resolve();
    assert.strictEqual(requests, 1);
    resolve(snapshot([], true));
    await first;

    const timedOut = sandbox.window.BPMPeerRefresh.create({
        timeoutMs: 5,
        api: { getJson: (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }) },
        onPeers: () => { throw new Error('Must not replace peers on timeout'); }, onStatus: () => {},
    });
    await timedOut.refresh();
    assert.strictEqual(timedOut.getStatus().state, 'dashboard-unavailable');
    const renderFailure = sandbox.window.BPMPeerRefresh.create({
        api: { getJson: async () => snapshot([], true) },
        onPeers: () => { throw new Error('render bug'); }, onStatus: () => {},
    });
    await assert.rejects(renderFailure.refresh(), /render bug/);
    console.log('Peer refresh tests passed');
})().catch(error => { console.error(error); process.exit(1); });
