import { test, mock } from 'node:test';
import * as BPMPeerRefresh from '../../src/static/js/peers/refresh.js';
import assert from 'assert';

function snapshot(peers, connected, lastSuccess = 1000, age = 0) {
    return { peers, status: {
        connected, last_success_at: lastSuccess, age_seconds: age, stale_after_seconds: 30,
    } };
}

for (const failure of ['node', 'dashboard', 'delayed']) {
    test(`peer ${failure} outage clears rates once while retaining peers and totals`, async () => {
        let now = 0;
        const peer = { id: 7, rx_bps: 0, tx_bps: 1024, bytesrecv: 2048, bytessent: 4096 };
        let response = snapshot([peer], true);
        const applied = [];
        const client = BPMPeerRefresh.create({
            now: () => now,
            api: { getJson: async () => {
                if (response instanceof Error) throw response;
                return response;
            } },
            onPeers: peers => applied.push(peers), onStatus: () => {},
        });
        await client.refresh();
        assert.strictEqual(applied[0][0].tx_bps, 1024);
        if (failure === 'delayed') {
            now = 31000;
            client.renderStatus();
        } else {
            response = failure === 'node' ? snapshot([peer], false, 1000, 5) : new Error('HTTP 503');
            await client.refresh();
        }
        assert.strictEqual(applied.length, 2);
        assert.deepStrictEqual({ ...applied[1][0], rx_bps: 0, tx_bps: 1024 }, applied[0][0]);
        assert.strictEqual(applied[1][0].rx_bps, null, 'expired measured zero also becomes unavailable');
        assert.strictEqual(applied[1][0].tx_bps, null);
        assert.strictEqual(peer.tx_bps, 1024, 'clearing browser rates must not mutate the API response');
        client.renderStatus(); client.renderStatus();
        assert.strictEqual(applied.length, 2, 'status ticks do not repeatedly replace cached peers');
        response = snapshot([{ ...peer, rx_bps: null, tx_bps: null }], true, 1010);
        await client.refresh();
        assert.strictEqual(applied.at(-1)[0].tx_bps, null, 'the recovery baseline is unavailable');
        response = snapshot([{ ...peer, rx_bps: 512, tx_bps: 2048 }], true, 1020);
        await client.refresh();
        assert.strictEqual(applied.at(-1)[0].rx_bps, 512);
        assert.strictEqual(applied.at(-1)[0].tx_bps, 2048);
        client.dispose();
    });
}

test('an initial cached snapshot displays totals with unavailable rates', async () => {
    const applied = [];
    const client = BPMPeerRefresh.create({
        api: { getJson: async () => snapshot([{ id: 8, bytessent: 2048, tx_bps: 1024, rx_bps: 512 }], false, 900, 100) },
        onPeers: peers => applied.push(peers), onStatus: () => {},
    });
    await client.refresh();
    assert.strictEqual(applied.length, 1);
    assert.strictEqual(applied[0][0].bytessent, 2048);
    assert.strictEqual(applied[0][0].tx_bps, null);
    assert.strictEqual(applied[0][0].rx_bps, null);
    client.dispose();
});

test('peer refresh', async () => {
    let now = 0;
    let response = snapshot([], null, null, null);
    const applied = [];
    const statuses = [];
    const client = BPMPeerRefresh.create({
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
    const initialCached = BPMPeerRefresh.create({
        api: { getJson: async () => snapshot([{ id: 8 }], false, 900, 100) },
        onPeers: peers => cached.push(peers), onStatus: () => {},
    });
    await initialCached.refresh();
    assert.strictEqual(cached[0][0].id, 8);
    assert.strictEqual(initialCached.getStatus().stale, true);

    let resolve;
    let requests = 0;
    const delayed = BPMPeerRefresh.create({
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

    const timedOut = BPMPeerRefresh.create({
        timeoutMs: 5,
        api: { getJson: (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }) },
        onPeers: () => { throw new Error('Must not replace peers on timeout'); }, onStatus: () => {},
    });
    await timedOut.refresh();
    assert.strictEqual(timedOut.getStatus().state, 'dashboard-unavailable');
    const renderFailure = BPMPeerRefresh.create({
        api: { getJson: async () => snapshot([], true) },
        onPeers: () => { throw new Error('render bug'); }, onStatus: () => {},
    });
    await assert.rejects(renderFailure.refresh(), /render bug/);
    console.log('Peer refresh tests passed');
});
