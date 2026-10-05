import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeMetrics } from '../../src/server/services/node-metrics.ts';
import { FakeRpc, deferred, flush } from './helpers.ts';

test('node metrics share cached and in-flight RPC reads and return independent snapshots', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const rpc = new FakeRpc(), gate = deferred<number>(), metrics = new NodeMetrics(rpc);
    rpc.values.uptime = () => gate.promise;
    const first = metrics.summary(), second = metrics.summary();
    await flush(); time = 6000;
    const late = metrics.summary();
    gate.resolve(183840);
    const snapshots = await Promise.all([first, second, late]);
    assert.equal(rpc.count('getnettotals'), 1); assert.equal(rpc.count('uptime'), 1);
    assert.equal(snapshots[0].uptime, '2d 3h 4m');
    assert.equal(snapshots[0].rx_bps, null); assert.equal(snapshots[0].tx_bps, null);
    assert.equal(snapshots[0].download_bytes, 2048); assert.equal(snapshots[0].upload_bytes, 4096);
    assert.deepEqual(Object.keys(snapshots[0]).sort(), ['download_bytes', 'rx_bps', 'ts', 'tx_bps', 'upload_bytes', 'uptime', 'uptime_sec']);
    snapshots[0].download_bytes = -1;
    assert.equal(snapshots[1].download_bytes, 2048); assert.equal(metrics.latest()?.download_bytes, 2048);
    await metrics.summary(); assert.equal(rpc.count('getnettotals'), 2);
    time = 10999; await metrics.summary(); assert.equal(rpc.count('getnettotals'), 2);
    time = 11000; await metrics.summary(); assert.equal(rpc.count('getnettotals'), 3);
});

test('P2P rates use actual elapsed time and show zero for valid idle samples', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const rpc = new FakeRpc(), metrics = new NodeMetrics(rpc);
    await metrics.summary();
    time = 10000; rpc.values.getnettotals = { totalbytesrecv: 7168, totalbytessent: 6656 };
    let snapshot = await metrics.summary();
    assert.equal(snapshot.rx_bps, 512); assert.equal(snapshot.tx_bps, 256);
    time = 15000; snapshot = await metrics.summary();
    assert.equal(snapshot.rx_bps, 0); assert.equal(snapshot.tx_bps, 0);
    rpc.values.uptime = 0; rpc.values.getnettotals = { totalbytesrecv: 0, totalbytessent: 0 }; time = 20000;
    snapshot = await metrics.summary(); assert.equal(snapshot.uptime, '0m'); assert.equal(snapshot.download_bytes, 0);
    time = 25000; snapshot = await metrics.summary(); assert.equal(snapshot.rx_bps, 0);
});

test('counter resets and a decreasing daemon uptime invalidate both rate baselines', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const rpc = new FakeRpc(), metrics = new NodeMetrics(rpc);
    await metrics.summary();
    time = 5000; rpc.values.getnettotals = { totalbytesrecv: 10, totalbytessent: 5000 };
    let snapshot = await metrics.summary(); assert.equal(snapshot.rx_bps, null); assert.equal(snapshot.tx_bps, null);
    time = 10000; rpc.values.getnettotals = { totalbytesrecv: 110, totalbytessent: 5100 };
    snapshot = await metrics.summary(); assert.equal(snapshot.rx_bps, 20); assert.equal(snapshot.tx_bps, 20);
    time = 15000; rpc.values.uptime = 10; rpc.values.getnettotals = { totalbytesrecv: 10000, totalbytessent: 20000 };
    snapshot = await metrics.summary(); assert.equal(snapshot.rx_bps, null); assert.equal(snapshot.tx_bps, null);
    time = 20000; rpc.values.uptime = 15;
    snapshot = await metrics.summary(); assert.equal(snapshot.rx_bps, 0); assert.equal(snapshot.tx_bps, 0);
});

test('RPC outages clear unavailable values and recovery starts with a fresh rate baseline', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const rpc = new FakeRpc(), metrics = new NodeMetrics(rpc);
    await metrics.summary(); rpc.failed.add('getnettotals'); time = 5000;
    let snapshot = await metrics.summary();
    assert.equal(snapshot.download_bytes, null); assert.equal(snapshot.upload_bytes, null);
    assert.equal(snapshot.rx_bps, null); assert.equal(snapshot.tx_bps, null); assert.equal(snapshot.uptime_sec, 183840);
    rpc.failed.clear(); rpc.failed.add('uptime'); time = 10000;
    snapshot = await metrics.summary(); assert.equal(snapshot.uptime, null); assert.equal(snapshot.uptime_sec, null);
    assert.equal(snapshot.download_bytes, 2048); assert.equal(snapshot.rx_bps, null);
    rpc.failed.clear(); time = 15000;
    snapshot = await metrics.summary(); assert.equal(snapshot.rx_bps, 0); assert.equal(snapshot.uptime_sec, 183840);
});

test('missing or malformed RPC counters never become fabricated zero totals', async t => {
    let time = 0; t.mock.method(performance, 'now', () => time);
    const rpc = new FakeRpc(), metrics = new NodeMetrics(rpc);
    for (const value of [null, [], {}, { totalbytesrecv: 0 }, { totalbytesrecv: -1, totalbytessent: 0 }, { totalbytesrecv: '10', totalbytessent: 0 }, { totalbytesrecv: 0, totalbytessent: Infinity }]) {
        rpc.values.getnettotals = value; time += 5000;
        const snapshot = await metrics.summary();
        assert.equal(snapshot.download_bytes, null); assert.equal(snapshot.upload_bytes, null); assert.equal(snapshot.rx_bps, null);
    }
    rpc.values.getnettotals = { totalbytesrecv: 0, totalbytessent: 0 };
    for (const value of [null, {}, '123', -1, 1.5, Infinity]) {
        rpc.values.uptime = value; time += 5000;
        const snapshot = await metrics.summary(); assert.equal(snapshot.uptime_sec, null); assert.equal(snapshot.download_bytes, 0);
    }
});
