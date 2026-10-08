import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeService, networkSummary, CHAIN_TIP_AGE_TIMEOUT_MS, CHAIN_TIP_WORKERS } from '../../src/server/services/node.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { PeerService } from '../../src/server/services/peers.ts';
import { FakeRpc, deferred, flush, temporaryDirectory } from './helpers.ts';
import type { TestContext } from 'node:test';
import type { Data } from '../../src/server/types.ts';
import { parseNetworkInfo } from '../../src/server/rpc-types.ts';
import { RpcBusyError } from '../../src/server/rpc.ts';

function services(t: TestContext, fetcher: typeof fetch = async () => { throw new Error('Unexpected external request'); }) {
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), true);
    geo.initialize(); t.after(() => geo.close());
    const connectivity = new ConnectivityService(false, undefined, fetcher);
    t.mock.method(connectivity, 'ensureChecker', () => {});
    t.after(() => connectivity.stop());
    const node = new NodeService(rpc, connectivity, geo, () => false);
    return { rpc, geo, connectivity, node };
}
type KeyedNodeReads = {
    recentBlock(hash: string, height: number, signal?: AbortSignal): Promise<{ time: number }>;
    header(hash: string, signal?: AbortSignal): Promise<{ time?: number }>;
};
const keyedReadCases = [
    { kind: 'block', method: 'getblock', read: (node: NodeService, hash: string, signal?: AbortSignal) => (node as unknown as KeyedNodeReads).recentBlock(hash, 100, signal) },
    { kind: 'header', method: 'getblockheader', read: (node: NodeService, hash: string, signal?: AbortSignal) => (node as unknown as KeyedNodeReads).header(hash, signal) },
] as const;

for (const { kind, method, read } of keyedReadCases) {
    test(`${kind} failures share twenty sequential requests, expire exactly after settlement, and recover into the successful LRU`, async t => {
        let now = 0; t.mock.method(performance, 'now', () => now);
        const { node, rpc } = services(t); rpc.failed.add(method);
        for (let i = 0; i < 20; i++) await assert.rejects(read(node, 'failed-hash'), new RegExp(`${method} failed`));
        assert.equal(rpc.count(method), 1);
        now = 999; await assert.rejects(read(node, 'failed-hash'), new RegExp(`${method} failed`));
        assert.equal(rpc.count(method), 1);
        rpc.failed.delete(method); rpc.values[method] = { height: 100, time: 2000 };
        now = 1000; assert.equal((await read(node, 'failed-hash')).time, 2000);
        assert.equal(rpc.count(method), 2);
        now = 100_000; rpc.failed.add(method);
        assert.equal((await read(node, 'failed-hash')).time, 2000);
        assert.equal(rpc.count(method), 2, 'Recovery keeps the immutable success cache');
        await assert.rejects(read(node, 'other-hash'), new RegExp(`${method} failed`));
        assert.equal(rpc.count(method), 3, 'Different hashes remain independent');
    });

    test(`${kind} slow failures share twenty concurrent requests and receive a full one-second failure interval`, async t => {
        let now = 0; t.mock.method(performance, 'now', () => now);
        const { node, rpc } = services(t), gate = deferred<unknown>(), error = new Error(`${method} offline`);
        rpc.values[method] = () => gate.promise;
        const rejected = Array.from({ length: 20 }, () => assert.rejects(read(node, 'slow-hash'), error));
        await flush(); assert.equal(rpc.count(method), 1);
        now = 5000; gate.reject(error); await Promise.all(rejected);
        now = 5999; await assert.rejects(read(node, 'slow-hash'), error);
        assert.equal(rpc.count(method), 1);
        now = 6000; rpc.values[method] = { height: 100, time: 2000 };
        assert.equal((await read(node, 'slow-hash')).time, 2000);
        assert.equal(rpc.count(method), 2);
    });

    test(`${kind} parser failures are cached separately from successful values`, async t => {
        let now = 0; t.mock.method(performance, 'now', () => now);
        const { node, rpc } = services(t); rpc.values[method] = { height: 'invalid' };
        for (let i = 0; i < 20; i++) await assert.rejects(read(node, 'malformed-hash'), new RegExp(method));
        assert.equal(rpc.count(method), 1);
        rpc.values[method] = { height: 100, time: 2000 }; now = 1000;
        assert.equal((await read(node, 'malformed-hash')).time, 2000);
        assert.equal(rpc.count(method), 2);
    });

    test(`${kind} cancellation keeps another subscriber and late cancelled results cannot poison a replacement`, async t => {
        const { node, rpc } = services(t), firstGate = deferred<unknown>(), oldGate = deferred<unknown>(), newGate = deferred<unknown>();
        const original = rpc.call.bind(rpc); let loadSignal: AbortSignal | undefined, transport = 0;
        t.mock.method(rpc, 'call', (name: string, params: unknown[] = [], _timeout?: number, signal?: AbortSignal) => {
            if (name !== method) return original(name, params);
            rpc.calls.push({ method: name, params }); loadSignal = signal;
            return [firstGate, oldGate, newGate][transport++].promise;
        });
        const one = new AbortController(), first = read(node, 'shared-hash', one.signal), second = read(node, 'shared-hash');
        const cancelledFirst = assert.rejects(first, { name: 'AbortError' });
        await flush(); one.abort(); await cancelledFirst;
        assert.equal(loadSignal!.aborted, false);
        firstGate.resolve({ height: 100, time: 1000 }); assert.equal((await second).time, 1000);
        const controller = new AbortController(), abandoned = read(node, 'replacement-hash', controller.signal);
        const cancelled = assert.rejects(abandoned, { name: 'AbortError' });
        await flush(); controller.abort(); await cancelled;
        assert.equal(loadSignal!.aborted, true);
        const fresh = read(node, 'replacement-hash'); await flush();
        oldGate.resolve({ height: 100, time: 1500 }); await flush();
        const joined = read(node, 'replacement-hash'); await flush();
        assert.equal(rpc.count(method), 3, 'Late completion cannot delete the active replacement');
        newGate.resolve({ height: 100, time: 2000 });
        assert.deepEqual((await Promise.all([fresh, joined])).map(value => value.time), [2000, 2000]);
        assert.equal((await read(node, 'replacement-hash')).time, 2000);
        assert.equal(rpc.count(method), 3, 'Late old result cannot overwrite the success LRU');
    });
}

test('block and header failure budgets are independent for the same hash', async t => {
    let now = 0; t.mock.method(performance, 'now', () => now);
    const { node, rpc } = services(t);
    rpc.failed.add('getblock'); rpc.failed.add('getblockheader');
    const reads = node as unknown as KeyedNodeReads;
    await assert.rejects(reads.header('same-hash'), /getblockheader failed/);
    for (let key = 0; key < 257; key++) await assert.rejects(reads.recentBlock(`block-${key}`, 100), /getblock failed/);
    await assert.rejects(reads.header('same-hash'), /getblockheader failed/);
    assert.equal(rpc.count('getblockheader'), 1, 'Block failure saturation cannot evict header failures');
    now = 1000; rpc.failed.delete('getblockheader');
    assert.equal((await reads.header('same-hash')).time, 1000);
    assert.equal(rpc.count('getblockheader'), 2);
});

test('node details and mempool use only RPC and never request market prices', async t => {
    const { node, rpc, connectivity } = services(t, async () => assert.fail('Node reads must not request external prices'));
    rpc.values.getmempoolinfo = { size: 5, total_fee: 0.125 };
    const info = await node.dashboardInfo(), mempool = await node.mempool();
    assert.equal(info.connected, 100); assert.equal(info.node_metrics.uptime_sec, 183840);
    assert.deepEqual(mempool.mempool, { size: 5, total_fee: 0.125 });
    for (const value of [info, mempool, connectivity.snapshot()]) {
        for (const key of ['btc_price', 'btc_currency', 'last_known_price', 'last_price_error']) assert.equal(key in value, false);
    }
    assert.deepEqual(Object.keys(connectivity.snapshot().providers), ['geoip']);
});
test('concurrent dashboards share RPC work, keep independent responses, and expire from request start', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { rpc, node } = services(t), gate = deferred<Data>();
    rpc.values.getblockchaininfo = () => gate.promise;
    const pending = Array.from({ length: 10 }, () => node.dashboardInfo());
    await flush(); time = 6000;
    const late = node.dashboardInfo();
    gate.resolve({ blocks: 100, bestblockhash: 'block-100' });
    const results = await Promise.all([...pending, late]);
    assert.equal(rpc.count('getblockchaininfo'), 1);
    assert.ok(results[0].last_block && results[1].last_block);
    results[0].last_block.height = -1;
    assert.equal(results[1].last_block.height, 100);
    await node.dashboardInfo();
    assert.equal(rpc.count('getblockchaininfo'), 2);
    assert.equal(rpc.count('getblockheader'), 1);
});
test('failed dashboard fields clear after expiry and blockchain failure still permits header fallback', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { rpc, node } = services(t);
    assert.equal((await node.dashboardInfo()).connected, 100);
    time = 5000; rpc.failed.add('getnetworkinfo'); rpc.failed.add('getblockchaininfo');
    const info = await node.dashboardInfo();
    assert.equal(info.connected, null); assert.equal(info.network_details, null); assert.equal(info.blockchain, null);
    assert.equal(info.services, null);
    assert.deepEqual(info.last_block, { height: 100, time: 1000 });
    assert.equal(info.node_traffic?.download_bytes, 2048);
    assert.equal(rpc.count('getbestblockhash'), 1);
});
test('peer refresh outages are logged once, reminded after a minute, and reset after recovery', async t => {
    const { rpc, geo, connectivity } = services(t);
    const peers = new PeerService(rpc, geo, connectivity);
    t.after(() => peers.stop());
    let now = 0; t.mock.method(performance, 'now', () => now);
    const warnings: string[] = [], recoveries: string[] = [];
    t.mock.method(console, 'warn', (message: string) => { warnings.push(message); });
    t.mock.method(console, 'info', (message: string) => { recoveries.push(message); });
    rpc.failed.add('getpeerinfo');
    assert.equal(await peers.refreshOnce(), false);
    assert.equal(await peers.refreshOnce(), false);
    assert.equal(warnings.length, 1);
    now = 60_000; await peers.refreshOnce();
    assert.equal(warnings.length, 2);
    assert.match(warnings[1], /WARN \[peers\].*3 consecutive failures/);
    rpc.failed.delete('getpeerinfo');
    assert.equal(await peers.refreshOnce(), true);
    assert.equal(await peers.refreshOnce(), true);
    assert.equal(recoveries.length, 1);
    assert.match(recoveries[0], /INFO \[peers\] Peer refresh recovered/);
    rpc.failed.add('getpeerinfo'); await peers.refreshOnce();
    assert.equal(warnings.length, 3, 'a new outage is reported immediately');
    await peers.stop(); await peers.refreshOnce();
    assert.equal(warnings.length, 3, 'shutdown cancellation does not generate an outage');
});
test('dashboard RPC failure reminders and recovery retain unavailable field behavior', async t => {
    const { rpc, node } = services(t);
    let now = 0; t.mock.method(performance, 'now', () => now);
    const warnings: string[] = [], recoveries: string[] = [];
    t.mock.method(console, 'warn', (message: string) => { warnings.push(message); });
    t.mock.method(console, 'info', (message: string) => { recoveries.push(message); });
    rpc.failed.add('getnetworkinfo');
    assert.equal((await node.dashboardInfo()).connected, null);
    now = 5000; assert.equal((await node.dashboardInfo()).connected, null);
    assert.equal(warnings.length, 1);
    now = 60_000; await node.dashboardInfo(); assert.equal(warnings.length, 2);
    rpc.failed.delete('getnetworkinfo');
    now = 65_000; assert.equal((await node.dashboardInfo()).connected, 100);
    now = 70_000; await node.dashboardInfo();
    assert.equal(recoveries.length, 1);
    assert.match(recoveries[0], /INFO \[node\] Network details recovered/);
});
test('dashboard starts independent RPC reads while blockchain details are still pending', async t => {
    const { rpc, node } = services(t);
    const blockchain = deferred<Data>();
    rpc.values.getblockchaininfo = () => blockchain.promise;
    const pending = node.dashboardInfo();
    await flush();
    const started = ['getnetworkinfo', 'getnettotals', 'getmempoolinfo'].map(method => rpc.count(method));
    blockchain.resolve({ blocks: 100, bestblockhash: 'block-100' });
    const result = await pending;
    assert.deepEqual(started, [1, 1, 1]);
    assert.equal(result.connected, 100);
    assert.equal(result.mempool_size, 5);
    assert.equal(result.last_block?.height, 100);
});
test('dashboard services preserve advertised names and distinguish empty lists from unavailable data', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { rpc, node } = services(t);
    const names = ['NETWORK', 'WITNESS', 'BLAKE2B?', 'FUTURE_SERVICE'];
    rpc.record('getnetworkinfo').localservicesnames = names;
    const info = await node.dashboardInfo();
    assert.deepEqual(info.services, names);
    info.services.push('CLIENT_MUTATION');
    assert.deepEqual((await node.dashboardInfo()).services, names);
    assert.equal(rpc.count('getnetworkinfo'), 1);

    for (const value of [[], undefined, null, 'NETWORK', ['NETWORK', 1], [' ']]) {
        time += 5000;
        rpc.record('getnetworkinfo').localservicesnames = value;
        const refreshed = await node.dashboardInfo();
        assert.deepEqual(refreshed.services, Array.isArray(value) && value.length === 0 ? [] : null);
        assert.equal(refreshed.connected, 100);
    }
});
test('network summaries include all five families, proxies, sorted addresses, and safe defaults', () => {
    const summary = networkSummary(parseNetworkInfo({ networks: [{ name: 'onion', reachable: true, limited: false, proxy: '127.0.0.1:9050' }], localaddresses: [
        { address: '8.8.8.8', score: 1 }, { address: '1.1.1.1', score: 2 }, { address: '2001:4860::1' }, { address: 'example.onion' }, { address: 'example.i2p' }, { address: 'fc00::1' },
    ] }));
    assert.ok(summary);
    assert.deepEqual(Object.keys(summary), ['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns']);
    assert.equal(summary.ipv4.localaddresses[0].address, '1.1.1.1');
    assert.equal(summary.onion.proxy, '127.0.0.1:9050'); assert.equal(summary.onion.reachable, true);
    assert.equal(summary.cjdns.localaddresses.length, 1); assert.equal(summary.i2p.limited, true);
});
test('node traffic follows node counters through dashboard restarts and node counter resets', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { node, rpc, geo, connectivity } = services(t);
    assert.equal((await node.dashboardInfo()).node_traffic?.download_bytes, 2048);
    const restarted = new NodeService(rpc, connectivity, geo, () => false);
    assert.equal((await restarted.dashboardInfo()).node_traffic?.download_bytes, 2048);
    rpc.record('getnettotals').totalbytesrecv = 10; time = 5000;
    assert.equal((await restarted.dashboardInfo()).node_traffic?.download_bytes, 10);
});
test('recent blocks follow parent hashes across reorganizations and reuse immutable blocks', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { node, rpc } = services(t);
    rpc.values.getblock = ([hash]: string[]) => {
        const height = Number(hash.split('-')[1]);
        return { hash, height, previousblockhash: `block-${height - 1}`, time: height * 600, size: 1e6, weight: 4e6, tx: ['tx1', 'tx2'] };
    };
    let result = await node.recentBlocks(3);
    assert.equal(result.success, true); assert.deepEqual(result.blocks.map((block: Data) => block.height), [100, 99, 98]);
    assert.ok(result.summary);
    assert.equal(result.summary.total_transactions, 6); assert.equal(result.summary.avg_size_mb, 1);
    result.blocks[0].height = -1;
    assert.equal((await node.recentBlocks(3)).blocks[0].height, 100); assert.equal(rpc.count('getblock'), 3);
    rpc.record('getblockchaininfo').bestblockhash = 'reorg-100';
    time = 5000;
    result = await node.recentBlocks(3);
    assert.equal(result.blocks[0].hash, 'reorg-100'); assert.equal(rpc.count('getblock'), 4);
    rpc.failed.add('getblockchaininfo');
    time = 10_000;
    assert.deepEqual((await node.recentBlocks()).blocks, []);
});
test('recent blocks reject malformed traversal rather than mixing chain heights', async t => {
    const { node, rpc } = services(t);
    rpc.values.getblock = { height: 99 };
    const result = await node.recentBlocks(1); assert.ok(result.error);
    assert.match(result.error, /height 99/);
});
test('chain tips sort, count, cache header ages, and cap header work at 100', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { node, rpc } = services(t);
    rpc.values.getchaintips = Array.from({ length: 105 }, (_, i) => ({ hash: `hash-${i}`, height: i, branchlen: 1, status: i === 0 ? 'active' : i === 1 ? 'valid-fork' : 'headers-only' }));
    let result = await node.chainTips();
    assert.ok(result.summary);
    assert.equal(result.tips[0].status, 'active'); assert.equal(result.tips[1].status, 'valid-fork');
    assert.equal(result.summary.total, 105); assert.equal(result.summary.headers_only_count, 103);
    assert.equal(result.summary.age_lookup_limited, true); assert.equal(rpc.count('getblockheader'), 100);
    assert.equal(result.tips.filter((tip: Data) => tip.time === null).length, 5);
    result = await node.chainTips(); assert.equal(rpc.count('getblockheader'), 100);
    time = 5000; rpc.failed.add('getchaintips'); assert.equal((await node.chainTips()).success, false);
});
test('peer actions send the expected RPC parameters and reject bans for private networks', async t => {
    const { node, rpc } = services(t);
    assert.equal((await node.connect('8.8.8.8')).address, '8.8.8.8:8333');
    assert.deepEqual(rpc.calls.at(-1), { method: 'addnode', params: ['8.8.8.8:8333', 'onetry'] });
    await node.disconnect(9); assert.deepEqual(rpc.calls.at(-1)?.params, ['', 9]);
    assert.equal((await node.disconnect(null)).success, false);
    rpc.values.getpeerinfo = [{ id: 9, addr: '[2001:4860::1]:8333', network: 'ipv6' }];
    assert.equal((await node.ban(9)).banned_ip, '2001:4860::1');
    assert.deepEqual(rpc.calls.at(-1)?.params, ['2001:4860::1', 'add', 86400]);
    rpc.values.getpeerinfo = [{ id: 9, addr: 'example.onion:8333', network: 'onion' }]; assert.equal((await node.ban(9)).success, false);
    assert.equal((await node.ban(99)).success, false);
    await node.unban('8.8.8.8'); assert.deepEqual(rpc.calls.at(-1)?.params, ['8.8.8.8', 'remove']);
    rpc.failed.add('clearbanned'); assert.equal((await node.clearBans()).success, false);
});
test('peer failures retain the last snapshot, while successful empty responses clear it', async t => {
    const { rpc, geo, connectivity } = services(t), peers = new PeerService(rpc, geo, connectivity);
    assert.equal(peers.snapshot().status.connected, null);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', servicesnames: ['BLAKE2B?', 'WITNESS'] }];
    await peers.refreshOnce(); const first = peers.snapshot();
    assert.equal(first.peers[0].services_abbrev, 'BL W');
    assert.equal(first.peers[0].addr_processed, 0); assert.equal(first.peers[0].addr_rate_limited, 0);
    rpc.failed.add('getpeerinfo'); assert.equal(await peers.refreshOnce(), false);
    assert.equal(peers.snapshot().status.connected, false);
    assert.deepEqual(peers.snapshot().peers, first.peers);
    assert.equal(peers.snapshot().status.last_success_at, first.status.last_success_at);
    rpc.failed.clear(); rpc.values.getpeerinfo = {}; assert.equal(await peers.refreshOnce(), false);
    rpc.values.getpeerinfo = []; await peers.refreshOnce();
    assert.deepEqual(peers.listPeers(), []); assert.equal(peers.snapshot().status.connected, true);
});
test('GeoIP misses retry after 60 seconds and cached locations survive dataset reloads', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { rpc, geo, connectivity } = services(t); connectivity.setGeoipApiDisabled(true);
    const peers = new PeerService(rpc, geo, connectivity);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }];
    await peers.refreshOnce(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(peers.listPeers()[0].location_status, 'unavailable');
    time = 59999; assert.ok(peers.cachedGeo('8.8.8.8'));
    time = 60000; assert.equal(peers.cachedGeo('8.8.8.8'), null);
    await geo.save('8.8.8.8', { lat: 1, lon: 2, city: 'Auckland', country: 'New Zealand', countryCode: 'NZ', as: 'AS1', offset: 43200 });
    await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(peers.listPeers()[0].location, 'Auckland, NZ'); assert.equal(peers.listPeers()[0].as, 'AS1');
    geo.datasetChanged(); assert.equal(peers.cachedGeo('8.8.8.8')?.city, 'Auckland');
    await peers.refreshOnce(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(peers.geoCache.get('8.8.8.8')?.generation, geo.generation);
});
test('private and departed peers do not trigger API requests and fresh in-flight results survive dataset generation changes', async t => {
    const { rpc, geo, connectivity } = services(t), gate = deferred<Response>(); let calls = 0;
    const peers = new PeerService(rpc, geo, connectivity, undefined, async () => { calls++; return gate.promise; });
    rpc.values.getpeerinfo = [{ id: 1, addr: '10.0.0.1:8333' }, { id: 2, addr: '8.8.8.8:8333' }];
    await peers.refreshOnce(); assert.equal(peers.listPeers()[0].location_status, 'private');
    assert.equal(peers.geoQueue.length, 1);
    await peers.resolveGeo('1.1.1.1', 'ipv4'); assert.equal(calls, 0);
    const lookup = peers.resolveGeo('8.8.8.8', 'ipv4'); geo.datasetChanged();
    gate.resolve(new Response('{"status":"success","lat":1,"lon":2,"country":"NZ"}'));
    await lookup;
    assert.equal(calls, 1); assert.equal(peers.cachedGeo('8.8.8.8')?.status, 'ok'); assert.equal(geo.get('8.8.8.8')?.country, 'NZ');
});
test('malformed nested peer fields cannot replace a good snapshot or reach a ban RPC', async t => {
    const { rpc, geo, connectivity, node } = services(t);
    const peers = new PeerService(rpc, geo, connectivity);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', servicesnames: ['NETWORK', 'FUTURE_SERVICE'] }];
    assert.equal(await peers.refreshOnce(), true);
    const first = peers.snapshot();
    t.mock.method(console, 'warn', () => {});
    for (const fields of [
        { id: null }, { id: 1.5 }, { addr: {} }, { addr: null }, { network: [] },
        { subver: {} }, { servicesnames: 'NETWORK' }, { servicesnames: ['NETWORK', {}] },
        { permissions: [null] }, { inbound: 'false' }, { bytessent: '10' }, { bytesrecv: -1 },
        { pingtime: Infinity }, { connection_type: [] }, { minfeefilter: {} },
    ]) {
        rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', ...fields }];
        assert.equal(await peers.refreshOnce(), false, JSON.stringify(fields));
        assert.deepEqual(peers.snapshot().peers, first.peers);
        assert.equal(peers.snapshot().status.connected, false);
        assert.equal(peers.snapshot().status.last_success_at, first.status.last_success_at);
        assert.equal((await node.ban(1)).success, false);
    }
    assert.equal(rpc.count('setban'), 0);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', servicesnames: null, permissions: null, minping: null, synced_blocks: -1 }];
    assert.equal(await peers.refreshOnce(), true);
    assert.deepEqual(peers.listPeers()[0].services, []); assert.equal(peers.listPeers()[0].minping, null);
    assert.equal(peers.listPeers()[0].synced_blocks, -1);
    rpc.values.getpeerinfo = []; assert.equal(await peers.refreshOnce(), true);
    assert.deepEqual(peers.listPeers(), []);
});
test('address-manager validation retains prior metadata instead of coercing invalid addresses', async t => {
    const { rpc, geo, connectivity } = services(t);
    const peers = new PeerService(rpc, geo, connectivity);
    rpc.values.getnodeaddresses = [{ address: '8.8.8.8', port: 8333 }]; await peers.refreshKnownAddresses();
    for (const value of [null, {}, [null], [{ address: {} }], [{ address: '' }]]) {
        rpc.values.getnodeaddresses = value; await peers.refreshKnownAddresses();
        assert.deepEqual([...peers.knownAddresses], ['8.8.8.8:8333']);
    }
    rpc.values.getnodeaddresses = []; await peers.refreshKnownAddresses();
    assert.equal(peers.knownAddresses.size, 0);
});
test('network metadata validates nested arrays while keeping independent fields and recovery', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { rpc, node } = services(t);
    const original = rpc.record('getnetworkinfo');
    for (const fields of [
        { networks: {} }, { networks: [null] }, { networks: [{ name: 'ipv4', proxy: {} }] },
        { networks: [{ name: 'ipv4', reachable: 'false' }] },
        { localaddresses: {} }, { localaddresses: [null] },
        { localaddresses: [{ address: {} }] }, { localaddresses: [{ address: '8.8.8.8', score: '10' }] },
        { localaddresses: [{ address: '8.8.8.8', port: [] }] },
    ]) {
        rpc.values.getnetworkinfo = { ...original, ...fields }; time += 5000;
        const info = await node.dashboardInfo();
        assert.equal(info.connected, 100); assert.equal(info.subversion, '/Satoshi:30/');
        assert.deepEqual(info.services, original.localservicesnames);
        assert.equal(info.network_details, null);
        assert.deepEqual(info.network_scores, 'localaddresses' in fields ? null : { ipv4: null, ipv6: null });
        assert.equal(info.last_block?.height, 100); assert.equal(info.node_traffic?.download_bytes, 2048);
    }
    rpc.values.getnetworkinfo = { ...original, connections: '100', subversion: {} }; time += 5000;
    const scalarFailure = await node.dashboardInfo();
    assert.equal(scalarFailure.connected, null); assert.equal(scalarFailure.subversion, null);
    assert.deepEqual(scalarFailure.services, original.localservicesnames);
    assert.ok(scalarFailure.network_details);
    rpc.values.getnetworkinfo = original; time += 5000;
    const recovered = await node.dashboardInfo();
    assert.equal(recovered.connected, 100); assert.ok(recovered.network_details);
});
test('null and malformed RPC objects produce explicit nulls without masking successful dashboard reads', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { rpc, node } = services(t);
    t.mock.method(console, 'warn', () => {});
    for (const value of [null, [], 'invalid']) {
        rpc.values.getnetworkinfo = value; time += 5000;
        const info = await node.dashboardInfo();
        for (const key of ['subversion', 'connected', 'services', 'network_details', 'network_scores'] as const) assert.equal(info[key], null);
        assert.equal(info.last_block?.height, 100); assert.equal(info.mempool_size, 5);
    }
    rpc.values.getnettotals = { totalbytesrecv: [] }; rpc.values.getmempoolinfo = { size: {} }; time += 5000;
    const info = await node.dashboardInfo();
    assert.equal(info.node_traffic, null); assert.equal(info.mempool_size, null);
    assert.equal(info.last_block?.height, 100);
    assert.equal((await node.mempool()).mempool, null);
    rpc.values.getblockchaininfo = null;
    time += 5000;
    assert.equal((await node.blockchain()).blockchain, null);
});


for (const [ibd, expected] of [[true, true], [false, false], [undefined, null], [null, null]] as const) {
    test(`dashboard preserves explicit IBD ${ibd} as ${expected}`, async t => {
        const { rpc, node } = services(t);
        rpc.record('getblockchaininfo').initialblockdownload = ibd;
        assert.equal((await node.dashboardInfo()).blockchain?.ibd, expected);
        const raw = await node.blockchain();
        assert.equal((raw.blockchain as Data).initialblockdownload, expected);
    });
}

test('public node readers share RPC samples across bursts and related endpoints', async t => {
    const { rpc, node } = services(t);
    rpc.values.getchaintips = [{ hash: 'block-100', height: 100, status: 'active' }];
    rpc.values.getblock = { height: 100, previousblockhash: 'block-99', time: 1000, size: 100, nTx: 2 };
    rpc.values.listbanned = [{ address: '8.8.8.8/32' }];
    const reads = Array.from({ length: 30 }, () => node.mempool());
    const [mempools] = await Promise.all([Promise.all(reads), node.dashboardInfo(), node.blockchain(), node.recentBlocks(1), node.chainTips(), Promise.all(Array.from({ length: 30 }, () => node.bans()))]);
    for (const method of ['getmempoolinfo', 'getblockchaininfo', 'getindexinfo', 'getchaintips', 'listbanned']) assert.equal(rpc.count(method), 1, method);
    (mempools[0].mempool as Data).size = -1;
    assert.equal((mempools[1].mempool as Data).size, 5);
    assert.equal(((await node.mempool()).mempool as Data).size, 5);
});

test('public read failures share a short cooldown and replace expired successful samples', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { rpc, node } = services(t);
    assert.equal(((await node.mempool()).mempool as Data).size, 5);
    time = 5000; rpc.failed.add('getmempoolinfo');
    const failed = await Promise.all(Array.from({ length: 30 }, () => node.mempool()));
    assert.ok(failed.every(result => result.mempool === null && result.error === 'getmempoolinfo failed'));
    time = 5999; assert.equal((await node.mempool()).mempool, null); assert.equal(rpc.count('getmempoolinfo'), 2);
    time = 6000; rpc.failed.delete('getmempoolinfo'); rpc.values.getmempoolinfo = { size: 8 };
    assert.equal(((await node.mempool()).mempool as Data).size, 8);
});

test('successful peer and ban mutations invalidate their affected public samples', async t => {
    const { rpc, node } = services(t);
    rpc.values.listbanned = [{ address: '8.8.8.8/32' }];
    await node.bans(); rpc.values.listbanned = [];
    assert.equal((await node.bans()).bans instanceof Array, true); assert.equal(rpc.count('listbanned'), 1);
    await node.clearBans(); assert.deepEqual((await node.bans()).bans, []); assert.equal(rpc.count('listbanned'), 2);
    await node.unban('8.8.8.8'); await node.bans(); assert.equal(rpc.count('listbanned'), 3);
    rpc.values.getpeerinfo = [{ id: 9, addr: '8.8.8.8:8333', network: 'ipv4' }];
    await node.dashboardInfo();
    for (const action of [() => node.connect('8.8.8.8'), () => node.disconnect(9), () => node.ban(9)]) {
        const before = rpc.count('getnetworkinfo');
        assert.equal((await action()).success, true);
        await node.dashboardInfo(); assert.equal(rpc.count('getnetworkinfo'), before + 1);
    }
    await node.bans(); assert.equal(rpc.count('listbanned'), 4);
});

test('RPC overload propagates through public readers and mutations for HTTP handling', async t => {
    const { rpc, node } = services(t);
    t.mock.method(rpc, 'call', async () => { throw new RpcBusyError(); });
    for (const read of [() => node.mempool(), () => node.blockchain(), () => node.bans(), () => node.dashboardInfo(), () => node.recentBlocks(1), () => node.chainTips(), () => node.connect('8.8.8.8'), () => node.disconnect(1), () => node.ban(1), () => node.unban('8.8.8.8'), () => node.clearBans()]) {
        await assert.rejects(read(), RpcBusyError);
    }
});

test('chain-tip enrichment stops at its budget with four workers and caches the partial result', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { rpc, node } = services(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    rpc.values.getchaintips = Array.from({ length: 100 }, (_, height) => ({ hash: `slow-${height}`, height, status: 'headers-only' }));
    const original = rpc.call.bind(rpc), signals: AbortSignal[] = [];
    t.mock.method(rpc, 'call', (method: string, params: unknown[] = [], _timeout?: number, signal?: AbortSignal) => {
        if (method !== 'getblockheader') return original(method, params);
        rpc.calls.push({ method, params }); signals.push(signal!);
        return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
    });
    const pending = node.chainTips(); await flush(); await flush();
    assert.equal(signals.length, CHAIN_TIP_WORKERS); assert.ok(signals.every(signal => !signal.aborted));
    time = CHAIN_TIP_AGE_TIMEOUT_MS; t.mock.timers.tick(CHAIN_TIP_AGE_TIMEOUT_MS);
    const result = await pending;
    assert.equal(result.success, true); assert.equal(result.summary?.age_lookup_timed_out, true);
    assert.equal(result.tips.length, 100); assert.ok(result.tips.every(tip => tip.time === null));
    assert.ok(signals.every(signal => signal.aborted)); assert.equal(signals.length, CHAIN_TIP_WORKERS);
    assert.equal((await node.chainTips()).summary?.age_lookup_timed_out, true); assert.equal(signals.length, CHAIN_TIP_WORKERS);
});

test('closing one chain-tip reader preserves a shared reader and closing the last cancels headers', async t => {
    const { rpc, node } = services(t);
    rpc.values.getchaintips = Array.from({ length: 10 }, (_, height) => ({ hash: `waiting-${height}`, height, status: 'headers-only' }));
    const original = rpc.call.bind(rpc), signals: AbortSignal[] = [];
    t.mock.method(rpc, 'call', (method: string, params: unknown[] = [], _timeout?: number, signal?: AbortSignal) => {
        if (method !== 'getblockheader') return original(method, params);
        rpc.calls.push({ method, params }); signals.push(signal!);
        return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
    });
    const first = new AbortController(), second = new AbortController();
    const a = node.chainTips(first.signal), b = node.chainTips(second.signal);
    const rejectedA = assert.rejects(a, { name: 'AbortError' }), rejectedB = assert.rejects(b, { name: 'AbortError' });
    await flush(); await flush(); assert.equal(signals.length, CHAIN_TIP_WORKERS);
    first.abort(); await rejectedA; assert.ok(signals.every(signal => !signal.aborted));
    second.abort(); await rejectedB; await flush();
    assert.ok(signals.every(signal => signal.aborted)); assert.equal(signals.length, CHAIN_TIP_WORKERS);
});

test('closing chain tips leaves a header still needed by the dashboard running', async t => {
    const { rpc, node } = services(t), gate = deferred<unknown>();
    rpc.values.getchaintips = [{ hash: 'block-100', height: 100, status: 'active' }];
    const original = rpc.call.bind(rpc); let headerSignal: AbortSignal | undefined;
    t.mock.method(rpc, 'call', (method: string, params: unknown[] = [], _timeout?: number, signal?: AbortSignal) => {
        if (method !== 'getblockheader') return original(method, params);
        rpc.calls.push({ method, params }); headerSignal = signal; return gate.promise;
    });
    const controller = new AbortController(), tips = node.chainTips(controller.signal), dashboard = node.dashboardInfo();
    const rejected = assert.rejects(tips, { name: 'AbortError' });
    await flush(); await flush(); assert.equal(rpc.count('getblockheader'), 1);
    controller.abort(); await rejected; assert.equal(headerSignal!.aborted, false);
    gate.resolve({ height: 100, time: 1000 }); assert.equal((await dashboard).last_block?.time, 1000);
});

test('chain tips stop waiting for optional metadata after five seconds', async t => {
    const { rpc, node } = services(t), metadata = deferred<unknown>();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    rpc.values.getchaintips = [{ hash: 'block-100', height: 100, status: 'active' }];
    rpc.values.getblockchaininfo = () => metadata.promise;
    const pending = node.chainTips(); await flush();
    t.mock.timers.tick(5000); await flush();
    const result = await pending;
    assert.equal(result.success, true); assert.equal(result.summary?.chain, null);
    assert.equal(result.summary?.age_lookup_timed_out, false); assert.equal(result.tips[0].time, 1000);
    metadata.resolve({ chain: 'main', blocks: 100 });
});

for (const [value, status, height] of [
    [{}, 'disabled', null], [{ txindex: { synced: false, best_block_height: 1 } }, 'syncing', 1],
    [{ txindex: { synced: true, best_block_height: 100 } }, 'ready', 100],
    [{ txindex: { synced: true } }, 'ready', null],
    [{ txindex: { synced: false, best_block_height: 0 } }, 'syncing', 0],
    [{ txindex: { synced: true, best_block_height: Number.MAX_SAFE_INTEGER } }, 'ready', Number.MAX_SAFE_INTEGER],
    ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100', null].map(best_block_height => [{ txindex: { synced: true, best_block_height } }, 'unknown', null] as const),
    [{ txindex: { synced: 'true' } }, 'unknown', null], [{ txindex: null }, 'unknown', null],
    [null, 'unknown', null], ['unavailable', 'unknown', null],
] as const) {
    test(`transaction index reports ${status} for ${JSON.stringify(value)}`, async t => {
        const { rpc, node } = services(t); rpc.values.getindexinfo = value;
        const blockchain = (await node.dashboardInfo()).blockchain!;
        assert.equal(blockchain.txindex_status, status); assert.equal(blockchain.txindex_height, height);
        assert.equal(blockchain.indexed, status === 'ready' || status === 'syncing');
    });
}

test('a denied transaction-index RPC reports unknown without discarding blockchain data', async t => {
    const { rpc, node } = services(t); rpc.failed.add('getindexinfo');
    const blockchain = (await node.dashboardInfo()).blockchain!;
    assert.equal(blockchain.txindex_status, 'unknown'); assert.equal(blockchain.txindex_height, null);
    assert.equal(blockchain.size_gb, 1); assert.equal(blockchain.indexed, false);
});

test('malformed transaction-index reads recover after their one-second failure cooldown', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { rpc, node } = services(t); rpc.values.getindexinfo = { txindex: { synced: true, best_block_height: -1 } };
    assert.equal((await node.dashboardInfo()).blockchain?.txindex_status, 'unknown');
    rpc.values.getindexinfo = { txindex: { synced: true, best_block_height: 100 } };
    time = 999; await node.connect('8.8.8.8');
    assert.equal((await node.dashboardInfo()).blockchain?.txindex_status, 'unknown'); assert.equal(rpc.count('getindexinfo'), 1);
    time = 1000; await node.connect('8.8.8.8');
    assert.equal((await node.dashboardInfo()).blockchain?.txindex_status, 'ready'); assert.equal(rpc.count('getindexinfo'), 2);
});


test('bans request disconnection through setban and retain genuine RPC errors', async t => {
    const { rpc, node } = services(t);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }];
    assert.deepEqual(await node.ban(1), { success: true, banned_ip: '8.8.8.8', network: 'ipv4' });
    assert.equal(rpc.count('disconnectnode'), 0);
    assert.deepEqual(rpc.calls.find(call => call.method === 'setban')?.params, ['8.8.8.8', 'add', 86400]);
    rpc.failed.add('setban');
    assert.deepEqual(await node.ban(1), { success: false, error: 'setban failed' });
    rpc.failed.add('listbanned');
    assert.deepEqual(await node.bans(), { success: false, bans: [], error: 'listbanned failed' });
});

for (const source of ['database', 'api']) {
    for (const [fields, location] of [
        [{ city: 'Auckland', regionName: 'Auckland Region', countryCode: 'NZ' }, 'Auckland, NZ'],
        [{ city: '', regionName: 'Auckland Region', countryCode: 'NZ' }, 'Auckland Region, NZ'],
        [{ city: '', regionName: '', region: 'AUK', countryCode: 'NZ' }, 'AUK, NZ'],
        [{ city: '', regionName: '', countryCode: 'NZ' }, 'NZ'],
        [{ city: '', regionName: 'Auckland Region', countryCode: '' }, 'Auckland Region, New Zealand'],
        [{ city: '', regionName: '', countryCode: '' }, 'New Zealand'],
    ] as const) {
        test(`${source} geolocation maps ${location} without requiring a city and serializes numeric coordinates`, async t => {
            const { rpc, geo, connectivity } = services(t);
            const data = { ...fields, status: 'success', country: 'New Zealand', lat: '-36.85', lon: '174.76' };
            if (source === 'database') { await geo.save('8.8.8.8', data); connectivity.setGeoipApiDisabled(true); }
            let requests = 0;
            const peers = new PeerService(rpc, geo, connectivity, undefined, async () => { requests++; return Response.json(data); });
            t.after(() => peers.stop());
            rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }, { id: 2, addr: '10.0.0.1:8333', network: 'ipv4' }];
            await peers.refreshOnce();
            assert.equal(peers.listPeers()[0].location_status, 'pending');
            await peers.resolveGeo('8.8.8.8', 'ipv4');
            const [peer, privatePeer] = JSON.parse(JSON.stringify(peers.listPeers()));
            assert.equal(peer.location_status, 'ok');
            assert.equal(peer.location, location);
            assert.equal(peer.lat, -36.85); assert.equal(peer.lon, 174.76);
            assert.equal(privatePeer.location_status, 'private'); assert.equal(privatePeer.location, 'PRIVATE');
            assert.equal(requests, source === 'api' ? 1 : 0);
        });
    }
}


for (const [chain, port] of [['main', 8333], ['test', 18333], ['testnet4', 48333], ['signet', 38333], ['regtest', 18444]] as const) {
    test(`${chain} uses peer port ${port} for IPv4, IPv6, Tor and CJDNS while retaining explicit ports and I2P :0`, async t => {
        const { rpc, connectivity, geo } = services(t);
        const node = new NodeService(rpc, connectivity, geo, () => false, chain);
        const expected = [
            ['8.8.8.8', `8.8.8.8:${port}`],
            ['8.8.8.8:12345', '8.8.8.8:12345'],
            ['2001:4860::1', `[2001:4860::1]:${port}`],
            ['[2001:4860::1]', `[2001:4860::1]:${port}`],
            ['[2001:4860::1]:12345', '[2001:4860::1]:12345'],
            ['example.onion', `example.onion:${port}`],
            ['example.onion:12345', 'example.onion:12345'],
            ['[fc00::1]', `[fc00::1]:${port}`],
            ['fc00::1', `[fc00::1]:${port}`],
            ['[fc00::1]:12345', '[fc00::1]:12345'],
            ['example.b32.i2p:0', 'example.b32.i2p:0'],
        ];
        for (const [address, normalized] of expected) {
            assert.deepEqual(await node.connect(address), { success: true, address: normalized });
            assert.deepEqual(rpc.calls.at(-1)?.params, [normalized, 'onetry']);
        }
        for (const address of ['example.b32.i2p', 'example.b32.i2p:12345']) {
            assert.deepEqual(await node.connect(address), { success: false, error: 'I2P addresses must end with :0' });
        }
        assert.deepEqual((await node.dashboardInfo()).bitcoin_network, { chain, default_peer_port: port });
    });
}
