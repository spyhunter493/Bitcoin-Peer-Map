import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { PeerService } from '../../src/server/services/peers.ts';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { FakeRpc, temporaryDirectory, deferred, flush } from './helpers.ts';

function setup(t: TestContext) {
    let monotonic = 1000, wall = 1_000_000;
    t.mock.method(performance, 'now', () => monotonic);
    t.mock.method(Date, 'now', () => wall);
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), false);
    const connectivity = new ConnectivityService(true), peers = new PeerService(rpc, geo, connectivity);
    t.after(async () => { await peers.stop(); await connectivity.stop(); geo.close(); });
    return { rpc, peers, geo,
        advance(milliseconds: number) { monotonic += milliseconds; wall += milliseconds; },
        moveWall(milliseconds: number) { wall += milliseconds; },
    };
}

function peer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: 1, addr: '10.0.0.1:8333', conntime: 900, session_id: 'connection-1',
        bytesrecv: 1000, bytessent: 2000, ...overrides };
}

function rates(peers: PeerService) {
    return peers.listPeers().map(({ id, rx_bps, tx_bps }) => ({ id, rx_bps, tx_bps }));
}

test('peer rates average bytes over the observed interval independently and retain real zero', async t => {
    const { rpc, peers, advance } = setup(t);
    rpc.values.getpeerinfo = [peer(), peer({ id: 2, addr: '10.0.0.2:8333', session_id: 'connection-2' })];
    await peers.refreshOnce();
    assert.deepEqual(rates(peers), [
        { id: 1, rx_bps: null, tx_bps: null }, { id: 2, rx_bps: null, tx_bps: null },
    ]);
    advance(8000);
    rpc.values.getpeerinfo = [
        peer({ id: 2, addr: '10.0.0.2:8333', session_id: 'connection-2', bytesrecv: 1000, bytessent: 10000 }),
        peer({ bytesrecv: 5001, bytessent: 4000 }),
    ];
    await peers.refreshOnce();
    assert.deepEqual(rates(peers), [
        { id: 2, rx_bps: 0, tx_bps: 1000 }, { id: 1, rx_bps: 500.125, tx_bps: 250 },
    ], 'Peer ordering cannot exchange rate baselines; rates retain numeric precision');
    advance(3000); await peers.refreshOnce();
    assert.deepEqual(rates(peers), [
        { id: 2, rx_bps: 0, tx_bps: 0 }, { id: 1, rx_bps: 0, tx_bps: 0 },
    ]);
});

test('delayed peer RPC responses use response arrival times for both ends of the interval', async t => {
    const { rpc, peers, advance } = setup(t);
    const firstResponse = deferred<unknown>(); rpc.values.getpeerinfo = () => firstResponse.promise;
    const first = peers.refreshOnce(); await flush();
    advance(2000); firstResponse.resolve([peer()]); await first;
    advance(5000);
    const secondResponse = deferred<unknown>(); rpc.values.getpeerinfo = () => secondResponse.promise;
    const second = peers.refreshOnce(); await flush();
    advance(5000); secondResponse.resolve([peer({ bytesrecv: 11000, bytessent: 22000 })]); await second;
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
    advance(5000); rpc.values.getpeerinfo = [peer({ bytesrecv: 16000, bytessent: 32000 })];
    await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
});

for (const missing of ['bytesrecv', 'bytessent'] as const) {
    test(`missing ${missing} leaves only that direction unavailable and needs a fresh counter baseline`, async t => {
        const { rpc, peers, advance } = setup(t);
        const absent = peer(); delete absent[missing];
        rpc.values.getpeerinfo = [absent]; await peers.refreshOnce();
        advance(5000);
        rpc.values.getpeerinfo = [peer({ bytesrecv: 6000, bytessent: 7000 })]; await peers.refreshOnce();
        assert.deepEqual(rates(peers), [{ id: 1,
            rx_bps: missing === 'bytesrecv' ? null : 1000,
            tx_bps: missing === 'bytessent' ? null : 1000,
        }]);
        advance(5000);
        rpc.values.getpeerinfo = [peer({ bytesrecv: 11000, bytessent: 12000 })]; await peers.refreshOnce();
        assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 1000 }]);
        advance(5000);
        const unavailable = peer({ bytesrecv: 16000, bytessent: 17000 }); unavailable[missing] = null;
        rpc.values.getpeerinfo = [unavailable]; await peers.refreshOnce();
        assert.deepEqual(rates(peers), [{ id: 1,
            rx_bps: missing === 'bytesrecv' ? null : 1000,
            tx_bps: missing === 'bytessent' ? null : 1000,
        }]);
        advance(5000);
        rpc.values.getpeerinfo = [peer({ bytesrecv: 21000, bytessent: 22000 })]; await peers.refreshOnce();
        assert.deepEqual(rates(peers), [{ id: 1,
            rx_bps: missing === 'bytesrecv' ? null : 1000,
            tx_bps: missing === 'bytessent' ? null : 1000,
        }], 'A newly restored counter cannot average across its missing observation');
    });
}

for (const [change, identity] of [
    ['peer ID', { id: 2 }],
    ['address when an ID is reused', { addr: '10.0.0.2:8333' }],
    ['connection time on reconnect', { conntime: 1001 }],
    ['transport session', { session_id: 'connection-2' }],
] as const) {
    test(`changing the ${change} starts fresh connection rates`, async t => {
        const { rpc, peers, advance } = setup(t);
        rpc.values.getpeerinfo = [peer()]; await peers.refreshOnce();
        advance(5000);
        rpc.values.getpeerinfo = [peer({ ...identity, bytesrecv: 6000, bytessent: 12000 })];
        await peers.refreshOnce();
        const expectedId = 'id' in identity ? identity.id : 1;
        assert.deepEqual(rates(peers), [{ id: expectedId, rx_bps: null, tx_bps: null }]);
        advance(5000);
        rpc.values.getpeerinfo = [peer({ ...identity, bytesrecv: 11000, bytessent: 22000 })];
        await peers.refreshOnce();
        assert.deepEqual(rates(peers), [{ id: expectedId, rx_bps: 1000, tx_bps: 2000 }]);
    });
}

test('older RPC responses without optional connection identity still support rates; newly available identity resets them', async t => {
    const { rpc, peers, advance } = setup(t);
    const withoutIdentity = peer(); delete withoutIdentity.conntime; delete withoutIdentity.session_id;
    rpc.values.getpeerinfo = [withoutIdentity]; await peers.refreshOnce();
    advance(5000);
    rpc.values.getpeerinfo = [{ ...withoutIdentity, bytesrecv: 6000, bytessent: 12000 }]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
    advance(5000);
    rpc.values.getpeerinfo = [peer({ bytesrecv: 11000, bytessent: 22000 })]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: null, tx_bps: null }]);
    advance(5000);
    rpc.values.getpeerinfo = [{ ...withoutIdentity, bytesrecv: 16000, bytessent: 32000 }]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: null, tx_bps: null }]);
});

test('a departed peer returning with the same identity cannot reuse its old rates', async t => {
    const { rpc, peers, advance } = setup(t);
    rpc.values.getpeerinfo = [peer()]; await peers.refreshOnce();
    advance(5000); rpc.values.getpeerinfo = [peer({ bytesrecv: 6000, bytessent: 12000 })]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
    advance(5000); rpc.values.getpeerinfo = []; await peers.refreshOnce();
    assert.deepEqual(rates(peers), []);
    advance(5000); rpc.values.getpeerinfo = [peer({ bytesrecv: 16000, bytessent: 32000 })]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: null, tx_bps: null }]);
});

for (const rollback of ['bytesrecv', 'bytessent'] as const) {
    test(`a ${rollback} rollback rebaselines only that counter without a negative rate`, async t => {
        const { rpc, peers, advance } = setup(t);
        rpc.values.getpeerinfo = [peer()]; await peers.refreshOnce();
        advance(5000);
        rpc.values.getpeerinfo = [peer({ bytesrecv: 6000, bytessent: 7000, [rollback]: 0 })]; await peers.refreshOnce();
        assert.deepEqual(rates(peers), [{ id: 1,
            rx_bps: rollback === 'bytesrecv' ? null : 1000,
            tx_bps: rollback === 'bytessent' ? null : 1000,
        }]);
        advance(5000);
        rpc.values.getpeerinfo = [peer({ bytesrecv: 11000, bytessent: 12000, [rollback]: 5000 })]; await peers.refreshOnce();
        assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 1000 }]);
    });
}

for (const failure of ['transport', 'wrong shape', 'invalid counter', 'partially valid list'] as const) {
    test(`${failure} peer poll retains cached totals, suppresses rates, and breaks the rate interval`, async t => {
        const { rpc, peers, advance } = setup(t);
        rpc.values.getpeerinfo = [peer()]; await peers.refreshOnce();
        advance(5000);
        rpc.values.getpeerinfo = [peer({ bytesrecv: 6000, bytessent: 12000 })]; await peers.refreshOnce();
        assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
        advance(5000);
        if (failure === 'transport') rpc.failed.add('getpeerinfo');
        else if (failure === 'wrong shape') rpc.values.getpeerinfo = {};
        else if (failure === 'invalid counter') rpc.values.getpeerinfo = [peer({ bytesrecv: '11000' })];
        else rpc.values.getpeerinfo = [peer({ bytesrecv: 11000, bytessent: 22000 }), { id: 2 }];
        assert.equal(await peers.refreshOnce(), false);
        assert.deepEqual(rates(peers), [{ id: 1, rx_bps: null, tx_bps: null }]);
        assert.equal(peers.listPeers()[0].bytesrecv, 6000, 'The last successful peer snapshot remains useful');
        assert.equal(peers.snapshot().status.connected, false);
        rpc.failed.clear(); advance(5000);
        rpc.values.getpeerinfo = [peer({ bytesrecv: 16000, bytessent: 32000 })]; await peers.refreshOnce();
        assert.deepEqual(rates(peers), [{ id: 1, rx_bps: null, tx_bps: null }]);
        advance(5000);
        rpc.values.getpeerinfo = [peer({ bytesrecv: 21000, bytessent: 42000 })]; await peers.refreshOnce();
        assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
    });
}

test('stale snapshots hide rates and a long sample gap starts a new interval', async t => {
    const { rpc, peers, advance } = setup(t);
    rpc.values.getpeerinfo = [peer()]; await peers.refreshOnce();
    advance(5000);
    rpc.values.getpeerinfo = [peer({ bytesrecv: 6000, bytessent: 12000 })]; await peers.refreshOnce();
    advance(30000);
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }], 'The 30-second age boundary remains valid');
    advance(1);
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: null, tx_bps: null }]);
    assert.equal(peers.listPeers()[0].bytesrecv, 6000);
    rpc.values.getpeerinfo = [peer({ bytesrecv: 36001, bytessent: 72002 })]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: null, tx_bps: null }], 'A sample cannot average across an unobserved gap over 30 seconds');
    advance(5000);
    rpc.values.getpeerinfo = [peer({ bytesrecv: 41001, bytessent: 82002 })]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
});

test('reading and GeoIP serialization never resample or change peer rate baselines', async t => {
    const { rpc, peers, geo, advance } = setup(t);
    rpc.values.getpeerinfo = [peer()]; await peers.refreshOnce();
    advance(5000); rpc.values.getpeerinfo = [peer({ bytesrecv: 6000, bytessent: 12000 })]; await peers.refreshOnce();
    const read = peers.listPeers(); read[0].rx_bps = -1;
    for (let i = 0; i < 3; i++) {
        advance(1000); geo.datasetChanged();
        assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
        assert.equal(peers.snapshot().peers[0].rx_bps, 1000);
        assert.equal(peers.listPeers()[0].geo.freshness, 'unavailable');
    }
    await peers.refreshKnownAddresses();
    assert.equal(rpc.count('getpeerinfo'), 2, 'Reading cached peer views and other metadata cannot trigger a traffic sample');
    advance(2000); rpc.values.getpeerinfo = [peer({ bytesrecv: 11000, bytessent: 22000 })]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
});

test('wall-clock changes do not distort rates or keep a monotonic stale snapshot fresh', async t => {
    const { rpc, peers, advance, moveWall } = setup(t);
    rpc.values.getpeerinfo = [peer()]; await peers.refreshOnce();
    advance(5000); moveWall(-60_000);
    rpc.values.getpeerinfo = [peer({ bytesrecv: 6000, bytessent: 12000 })]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
    advance(5000); moveWall(3_600_000);
    rpc.values.getpeerinfo = [peer({ bytesrecv: 11000, bytessent: 22000 })]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
    advance(30001); moveWall(-3_600_000);
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: null, tx_bps: null }]);
});

test('samples at the same monotonic time cannot invent rates and establish a fresh baseline', async t => {
    const { rpc, peers, advance } = setup(t);
    rpc.values.getpeerinfo = [peer()]; await peers.refreshOnce();
    rpc.values.getpeerinfo = [peer({ bytesrecv: 6000, bytessent: 12000 })]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: null, tx_bps: null }]);
    advance(5000); rpc.values.getpeerinfo = [peer({ bytesrecv: 11000, bytessent: 22000 })]; await peers.refreshOnce();
    assert.deepEqual(rates(peers), [{ id: 1, rx_bps: 1000, tx_bps: 2000 }]);
});
