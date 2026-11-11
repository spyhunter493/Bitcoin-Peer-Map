import test from 'node:test';
import assert from 'node:assert/strict';
import { AppRuntime } from '../../src/server/runtime.ts';
import { settings, temporaryDirectory, FakeRpc, flush } from './helpers.ts';

test('runtime feeds canonical observations and schedules guarded cleanup without any browser, then stops policy work when Off', async t => {
    const wall = 1_800_000_000;
    let monotonic = 0;
    t.mock.method(performance, 'now', () => monotonic);
    t.mock.method(Date, 'now', () => wall * 1000 + monotonic);
    t.mock.timers.enable({ apis: ['setInterval'] });
    const app = new AppRuntime(settings({ BPM_DATA_DIR: temporaryDirectory(t), BPM_ADMIN_TOKEN: 'runtime-policy-admin',
        BPM_GEOIP_ENABLED: 'false', BPM_OUTBOUND_ENABLED: 'false' }));
    t.after(() => app.stop());
    const rpc = new FakeRpc();
    const peers = Array.from({ length: 14 }, (_, index) => ({
        id: index + 1, addr: `192.0.2.${index + 1}:8333`, network: 'ipv4', inbound: index >= 4,
        connection_type: index < 4 ? 'outbound-full-relay' : 'inbound', permissions: [],
        conntime: wall - 7200, services: index === 13 ? '0' : '401', servicesnames: index === 13 ? [] : ['NETWORK', 'NETWORK_LIMITED'],
        transport_protocol_type: 'v1', session_id: '', last_transaction: 0, last_block: 0, last_block_announcement: 0,
        synced_headers: -1, synced_blocks: -1, presynced_headers: -1, inflight: [],
        bytessent: 1000, bytesrecv: 200, bytessent_per_msg: { inv: 1000 }, bytesrecv_per_msg: { pong: 200 },
    }));
    rpc.values.getpeerinfo = () => { monotonic++; return structuredClone(peers); };
    rpc.values.getnetworkinfo = { networkactive: true };
    rpc.values.getblockchaininfo = { chain: 'main', initialblockdownload: false };
    rpc.values.uptime = () => 100000 + Math.floor(monotonic / 1000);
    rpc.values.disconnectnode = (params: unknown[]) => {
        assert.deepEqual(params, ['', 14]);
        peers.splice(peers.findIndex(peer => peer.id === 14), 1);
        return null;
    };
    t.mock.method(app.rpc, 'call', rpc.call.bind(rpc));
    // Drive real canonical peer refreshes explicitly; the policy interval itself
    // remains the actual runtime-owned scheduler under a fake clock.
    t.mock.method(app.peers, 'start', async () => { await app.peers.refreshOnce(); });
    t.mock.method(app.connectivity, 'ensureChecker', () => {});
    await app.start();
    assert.equal(rpc.count('getnetworkinfo'), 0);
    assert.equal(app.peerPolicy.snapshot().config.mode, 'off');
    const configure = (mode: string) => app.peerPolicy.configure({ expected_revision: app.peerPolicy.snapshot().revision,
        config: { mode, listener_allowance: 0, keep_addresses: [] } });
    configure('preview'); await flush();
    await app.peers.refreshOnce();
    const step = async () => {
        monotonic += 10000;
        await app.peers.refreshOnce();
        t.mock.timers.tick(10000);
        await flush();
    };
    for (let index = 0; index < 180; index++) await step();
    assert.equal(app.peerPolicy.snapshot().preview_remaining_seconds, 0);
    assert.equal(app.peerPolicy.snapshot().counts.candidates, 1);
    assert.equal(rpc.count('disconnectnode'), 0);
    configure('automatic');
    for (let index = 0; index < 7; index++) await step();
    assert.equal(rpc.count('disconnectnode'), 1);
    assert(app.peerPolicy.snapshot().events.some(event => event.kind === 'departure_observed'));
    configure('off');
    const healthCalls = rpc.count('getnetworkinfo');
    for (let index = 0; index < 12; index++) await step();
    assert.equal(rpc.count('getnetworkinfo'), healthCalls);
    assert.equal(rpc.count('disconnectnode'), 1);
    assert.equal(app.peerPolicy.snapshot().effective_state, 'disabled');
    assert.deepEqual(app.peerPolicy.snapshot().peers, []);
});
