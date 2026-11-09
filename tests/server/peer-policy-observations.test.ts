import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerService } from '../../src/server/services/peers.ts';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { FakeRpc, temporaryDirectory, deferred } from './helpers.ts';

test('only complete canonical RPC observations notify policy; reads and failed polls never manufacture departures', async t => {
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), false), connectivity = new ConnectivityService(true);
    const peers = new PeerService(rpc, geo, connectivity);
    t.after(async () => { await peers.stop(); await connectivity.stop(); geo.close(); });
    const observed: (number[] | null)[] = [], times: number[] = [];
    const unsubscribe = peers.onObservation((value, time) => { observed.push(value?.map(peer => peer.id) ?? null); times.push(time); });
    rpc.values.getpeerinfo = [{ id: 1, addr: '192.0.2.1:8333' }];
    const pending = deferred<unknown>(); rpc.values.getpeerinfo = () => pending.promise;
    const first = peers.refreshOnce(), coalesced = peers.refreshOnce();
    assert.equal(first, coalesced); assert.deepEqual(observed, []);
    pending.resolve([{ id: 1, addr: '192.0.2.1:8333' }]); assert.equal(await first, true);
    assert.deepEqual(observed, [[1]]); assert.ok(times.every(Number.isFinite));
    for (let i = 0; i < 10; i++) { peers.listPeers(); peers.snapshot(); }
    assert.deepEqual(observed, [[1]], 'Browser reads cannot advance policy observation');
    rpc.failed.add('getpeerinfo'); assert.equal(await peers.refreshOnce(), false);
    assert.deepEqual(observed, [[1], null]); assert.equal(peers.listPeers().length, 1);
    rpc.failed.delete('getpeerinfo'); rpc.values.getpeerinfo = [{ id: 'malformed', addr: '192.0.2.2:8333' }];
    assert.equal(await peers.refreshOnce(), false); assert.deepEqual(observed, [[1], null, null]);
    rpc.values.getpeerinfo = []; assert.equal(await peers.refreshOnce(), true); assert.deepEqual(observed, [[1], null, null, []]);
    unsubscribe(); await peers.refreshOnce(); assert.equal(observed.length, 4);
});
