import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerService } from '../../src/server/services/peers.ts';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { FakeRpc, temporaryDirectory } from './helpers.ts';

test('serialized public scope matches GeoIP eligibility across public, reserved, mapped, and overlay addresses', async t => {
    const samples = [
        ['8.8.8.8:8333', 'ipv4', true],
        ['[2606:4700:4700::1111]:8333', 'ipv6', true],
        ['192.0.0.9:8333', 'ipv4', true],
        ['[::ffff:8.8.8.8]:8333', 'ipv6', true],
        ['10.0.0.1:8333', 'ipv4', false],
        ['127.0.0.1:8333', 'ipv4', false],
        ['100.64.0.1:8333', 'ipv4', false],
        ['192.0.2.1:8333', 'ipv4', false],
        ['[2001:db8::1]:8333', 'ipv6', false],
        ['[::ffff:10.0.0.1]:8333', 'ipv6', false],
        ['[::1]:8333', 'ipv6', false],
        ['example.org:8333', 'ipv4', false],
        ['abcdef.onion:8333', 'onion', false],
        ['abcdef.b32.i2p:0', 'i2p', false],
        ['[fc00::1]:8333', 'cjdns', false],
    ] as const;
    const rpc = new FakeRpc(), geo = new GeoDatabase(temporaryDirectory(t), false);
    const connectivity = new ConnectivityService(true), peers = new PeerService(rpc, geo, connectivity);
    t.after(async () => { await peers.stop(); await connectivity.stop(); geo.close(); });
    rpc.values.getpeerinfo = samples.map(([addr, network], id) => ({ id, addr, network, inbound: id % 2 === 0 }));
    await peers.refreshOnce();
    const serialized = peers.listPeers();
    for (let index = 0; index < samples.length; index++) {
        assert.equal(serialized[index].is_public, samples[index][2], samples[index][0]);
    }
    const queuedHosts = new Set(peers.geoQueue.map(([host]) => host));
    for (const peer of serialized) assert.equal(queuedHosts.has(peer.ip as string), peer.is_public,
        `lookup eligibility and coverage scope agree for ${peer.addr}`);
    assert.equal(serialized[0].location_status, 'pending', 'missing locations still belong to the public coverage denominator');
});
