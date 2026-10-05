import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeService, networkSummary } from '../../src/server/services/node.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { PeerService } from '../../src/server/services/peers.ts';
import { FakeRpc, deferred, flush, temporaryDirectory } from './helpers.ts';
import type { TestContext } from 'node:test';
import type { Data } from '../../src/server/types.ts';
import { parseNetworkInfo } from '../../src/server/rpc-types.ts';

function services(t: TestContext, fetcher: typeof fetch = async () => { throw new Error('Unexpected external request'); }) {
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), true);
    geo.initialize(); t.after(() => geo.close());
    const connectivity = new ConnectivityService(false, undefined, fetcher);
    t.mock.method(connectivity, 'ensureChecker', () => {});
    t.after(() => connectivity.stop());
    const node = new NodeService(rpc, connectivity, geo, () => false);
    return { rpc, geo, connectivity, node };
}
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
    result = await node.recentBlocks(3);
    assert.equal(result.blocks[0].hash, 'reorg-100'); assert.equal(rpc.count('getblock'), 4);
    rpc.failed.add('getblockchaininfo');
    assert.deepEqual((await node.recentBlocks()).blocks, []);
});
test('recent blocks reject malformed traversal rather than mixing chain heights', async t => {
    const { node, rpc } = services(t);
    rpc.values.getblock = { height: 99 };
    const result = await node.recentBlocks(1); assert.ok(result.error);
    assert.match(result.error, /height 99/);
});
test('chain tips sort, count, cache header ages, and cap header work at 100', async t => {
    const { node, rpc } = services(t);
    rpc.values.getchaintips = Array.from({ length: 105 }, (_, i) => ({ hash: `hash-${i}`, height: i, branchlen: 1, status: i === 0 ? 'active' : i === 1 ? 'valid-fork' : 'headers-only' }));
    let result = await node.chainTips();
    assert.ok(result.summary);
    assert.equal(result.tips[0].status, 'active'); assert.equal(result.tips[1].status, 'valid-fork');
    assert.equal(result.summary.total, 105); assert.equal(result.summary.headers_only_count, 103);
    assert.equal(result.summary.age_lookup_limited, true); assert.equal(rpc.count('getblockheader'), 100);
    assert.equal(result.tips.filter((tip: Data) => tip.time === null).length, 5);
    result = await node.chainTips(); assert.equal(rpc.count('getblockheader'), 100);
    rpc.failed.add('getchaintips'); assert.equal((await node.chainTips()).success, false);
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
test('GeoIP misses retry after 60 seconds and cached records invalidate after a dataset merge', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const { rpc, geo, connectivity } = services(t); connectivity.setGeoipApiDisabled(true);
    const peers = new PeerService(rpc, geo, connectivity);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }];
    await peers.refreshOnce(); await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(peers.listPeers()[0].location_status, 'unavailable');
    time = 59999; assert.ok(peers.cachedGeo('8.8.8.8'));
    time = 60000; assert.equal(peers.cachedGeo('8.8.8.8'), null);
    geo.save('8.8.8.8', { lat: 1, lon: 2, city: 'Auckland', country: 'New Zealand', countryCode: 'NZ', as: 'AS1', offset: 43200 });
    await peers.resolveGeo('8.8.8.8', 'ipv4');
    assert.equal(peers.listPeers()[0].location, 'Auckland, NZ'); assert.equal(peers.listPeers()[0].as, 'AS1');
    geo.datasetChanged(); assert.equal(peers.cachedGeo('8.8.8.8'), null);
});
test('private and departed peers do not trigger API requests and stale in-flight results are discarded', async t => {
    const { rpc, geo, connectivity } = services(t), gate = deferred<Response>(); let calls = 0;
    const peers = new PeerService(rpc, geo, connectivity, undefined, async () => { calls++; return gate.promise; });
    rpc.values.getpeerinfo = [{ id: 1, addr: '10.0.0.1:8333' }, { id: 2, addr: '8.8.8.8:8333' }];
    await peers.refreshOnce(); assert.equal(peers.listPeers()[0].location_status, 'private');
    assert.equal(peers.geoQueue.length, 1);
    await peers.resolveGeo('1.1.1.1', 'ipv4'); assert.equal(calls, 0);
    const lookup = peers.resolveGeo('8.8.8.8', 'ipv4'); geo.datasetChanged();
    gate.resolve(new Response('{"status":"success","lat":1,"lon":2,"country":"NZ"}'));
    await lookup;
    assert.equal(calls, 1); assert.equal(peers.cachedGeo('8.8.8.8'), null); assert.equal(geo.get('8.8.8.8'), null);
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
    rpc.values.getnodeaddresses = [{ address: '8.8.8.8' }]; await peers.refreshKnownAddresses();
    for (const value of [null, {}, [null], [{ address: {} }], [{ address: '' }]]) {
        rpc.values.getnodeaddresses = value; await peers.refreshKnownAddresses();
        assert.deepEqual([...peers.knownAddresses], ['8.8.8.8']);
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
        for (const key of ['subversion', 'connected', 'services', 'network_details', 'network_scores']) assert.equal(info[key], null);
        assert.equal(info.last_block?.height, 100); assert.equal(info.mempool_size, 5);
    }
    rpc.values.getnettotals = { totalbytesrecv: [] }; rpc.values.getmempoolinfo = { size: {} }; time += 5000;
    const info = await node.dashboardInfo();
    assert.equal(info.node_traffic, null); assert.equal(info.mempool_size, null);
    assert.equal(info.last_block?.height, 100);
    assert.equal((await node.mempool()).mempool, null);
    rpc.values.getblockchaininfo = null;
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
