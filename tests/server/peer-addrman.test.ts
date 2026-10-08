import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { peerEndpointKey } from '../../src/server/network.ts';
import { parseNodeAddresses, RpcValidationError } from '../../src/server/rpc-types.ts';
import { PeerService } from '../../src/server/services/peers.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { FakeRpc, temporaryDirectory } from './helpers.ts';

function service(t: TestContext) {
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), false), connectivity = new ConnectivityService(false);
    const peers = new PeerService(rpc, geo, connectivity);
    t.after(() => peers.stop()); t.after(() => connectivity.stop()); t.after(() => geo.close());
    return { rpc, peers };
}
function states(peers: PeerService) {
    return peers.listPeers().map(peer => ({ addr: peer.addr, status: peer.addrman_status, present: peer.in_addrman }));
}

test('endpoint keys require explicit valid ports and canonicalize hostnames, IPv6 and mapped aliases without defaults', () => {
    for (const [address, port, expected] of [
        ['8.8.8.8:8333', undefined, '8.8.8.8:8333'], ['8.8.8.8', 8333, '8.8.8.8:8333'],
        ['8.8.8.8:0001', undefined, '8.8.8.8:1'], ['8.8.8.8', 65535, '8.8.8.8:65535'],
        ['[2001:4860:0000:0000:0000:0000:0000:0001]:8333', undefined, '[2001:4860::1]:8333'],
        ['2001:4860::1', 8333, '[2001:4860::1]:8333'], ['[FC00:0:0:0:0:0:0:1]:8333', undefined, '[fc00::1]:8333'],
        ['[::ffff:8.8.8.8]:8333', undefined, '8.8.8.8:8333'], ['::ffff:808:808', 8333, '8.8.8.8:8333'],
        ['EXAMPLE.OnIoN:8333', undefined, 'example.onion:8333'], ['Example.B32.I2P:0', undefined, 'example.b32.i2p:0'],
        ['Proxy.EXAMPLE', 8333, 'proxy.example:8333'],
    ] as const) assert.equal(peerEndpointKey(address, port), expected, address);
    for (const address of ['8.8.8.8', '2001:4860::1', 'example.onion', 'example.b32.i2p', '8.8.8.8:', '8.8.8.8:-1', '8.8.8.8:65536', '8.8.8.8:1.5', '8.8.8.8:1e3', '[::1]:', '[::1]:8333trailing', '[example.onion]:8333', '[::1]garbage:8333', 'fe80::1%eth0:8333', '[fe80::1%eth0]:8333', '999.0.0.1:8333', 'bad host:8333', '8.8.8.8: 8333']) {
        assert.equal(peerEndpointKey(address), null, address);
    }
    for (const port of [-1, 65536, 1.5, Infinity, NaN]) assert.equal(peerEndpointKey('8.8.8.8', port), null);
    for (const address of ['', 'bad host', '[::1]', '8.8.8.8:8333', 'fe80::1%eth0']) assert.equal(peerEndpointKey(address, 8333), null);
});

test('getnodeaddresses requires numeric integer ports from zero through65535 and preserves extensions', () => {
    assert.deepEqual(parseNodeAddresses([{ address: 'example.b32.i2p', port: 0, services: 'future' }, { address: '8.8.8.8', port: 65535 }]), [
        { address: 'example.b32.i2p', port: 0, services: 'future' }, { address: '8.8.8.8', port: 65535 },
    ]);
    for (const port of [undefined, null, '', '8333', -1, 65536, 1.5, NaN, Infinity, false, []]) {
        assert.throws(() => parseNodeAddresses([{ address: '8.8.8.8', port }]), RpcValidationError, String(port));
    }
});

test('exact endpoint membership handles same-host ports, IPv6, CJDNS, onion and I2P port zero', async t => {
    const { rpc, peers } = service(t);
    const addresses = [
        '8.8.8.8:8333', '8.8.8.8:18333', '[2001:4860::1]:8333', '[FC00:0:0:0:0:0:0:1]:8333',
        'EXAMPLE.OnIoN:8333', 'example.onion:18333', 'Example.B32.I2P:0', 'example.b32.i2p:8333',
        '9.9.9.9:8333', '8.8.8.8', '[2001:4860::1]', '[::1]:65536',
    ];
    rpc.values.getpeerinfo = addresses.map((addr, id) => ({ id, addr }));
    await peers.refreshOnce();
    assert.ok(states(peers).every(peer => peer.status === 'unavailable' && !peer.present), 'Initial inventory is unavailable');
    rpc.values.getnodeaddresses = [
        { address: '8.8.8.8', port: 8333 }, { address: '2001:4860:0:0:0:0:0:1', port: 8333 },
        { address: 'fc00::1', port: 8333 }, { address: 'example.onion', port: 8333 }, { address: 'example.b32.i2p', port: 0 },
    ];
    await peers.refreshKnownAddresses();
    assert.deepEqual(states(peers).map(peer => peer.status), ['present', 'not_returned', 'present', 'present', 'present', 'not_returned', 'present', 'not_returned', 'not_returned', 'unavailable', 'unavailable', 'unavailable']);
    assert.ok(states(peers).every(peer => peer.present === (peer.status === 'present')));
    assert.deepEqual(peers.snapshot().peers, peers.listPeers(), 'Both serialized peer forms expose the same required status');
    assert.deepEqual(rpc.calls.filter(call => call.method === 'getnodeaddresses'), [{ method: 'getnodeaddresses', params: [0] }]);
    assert.equal(rpc.count('getrawaddrman'), 0);
});

test('failed and invalid inventories retain keys internally while suppressing claims until recovery', async t => {
    const { rpc, peers } = service(t);
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333' }]; await peers.refreshOnce();
    rpc.failed.add('getnodeaddresses'); await peers.refreshKnownAddresses();
    assert.equal(states(peers)[0].status, 'unavailable');
    rpc.failed.delete('getnodeaddresses'); rpc.values.getnodeaddresses = [{ address: '8.8.8.8', port: 8333 }];
    await peers.refreshKnownAddresses();
    assert.deepEqual(states(peers)[0], { addr: '8.8.8.8:8333', status: 'present', present: true });
    const retained = [...peers.knownAddresses];
    rpc.failed.add('getnodeaddresses'); await peers.refreshKnownAddresses();
    assert.deepEqual([...peers.knownAddresses], retained);
    assert.equal(states(peers)[0].status, 'unavailable'); assert.equal(states(peers)[0].present, false);
    rpc.failed.delete('getnodeaddresses');
    for (const value of [null, {}, [null], [{ address: '8.8.8.8' }], [{ address: '8.8.8.8', port: '8333' }], [{ address: 'bad host', port: 8333 }], [{ address: '8.8.8.8', port: 8333 }, { address: '9.9.9.9', port: 65536 }]]) {
        rpc.values.getnodeaddresses = value; await peers.refreshKnownAddresses();
        assert.deepEqual([...peers.knownAddresses], retained, JSON.stringify(value));
        assert.equal(states(peers)[0].status, 'unavailable'); assert.equal(states(peers)[0].present, false);
    }
    rpc.values.getnodeaddresses = []; await peers.refreshKnownAddresses();
    assert.equal(states(peers)[0].status, 'not_returned'); assert.equal(states(peers)[0].present, false);
    assert.equal(peers.knownAddresses.size, 0);
    rpc.values.getnodeaddresses = [{ address: '8.8.8.8', port: 8333 }]; await peers.refreshKnownAddresses();
    assert.equal(states(peers)[0].status, 'present'); assert.equal(states(peers)[0].present, true);
});
