import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { BitcoinRpcClient } from '../../src/server/rpc.ts';
import { NodeService } from '../../src/server/services/node.ts';
import { PeerPolicyCoordinator } from '../../src/server/peer-policy/coordinator.ts';
import { PeerPolicyStore } from '../../src/server/peer-policy/store.ts';
import { settings, FakeRpc, temporaryDirectory } from './helpers.ts';

test('cached RPC diagnostics keep bounded timings without parameters, endpoint credentials, wallet names or response bodies', async (t) => {
    let fail = false;
    const server = createServer((_req, res) =>
        res.end(fail ? '{"error":{"code":-1,"message":"secret-response-body"}}' : '{"result":true}')
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(
        () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections();
                server.close(() => resolve());
            })
    );
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const rpc = new BitcoinRpcClient(settings({ BITCOIN_RPC_PORT: String(address.port) }));
    for (let i = 0; i < 129; i++) await rpc.callWallet('secret-wallet-name', 'getbalances', ['private-parameter']);
    fail = true;
    await assert.rejects(rpc.call('getnetworkinfo'));
    const value = rpc.diagnostics();
    assert.equal(value.calls, 130);
    assert.equal(value.failures, 1);
    assert.equal(value.active, 0);
    assert.equal(value.queued, 0);
    assert.equal(
        value.methods.reduce((n, m) => n + m.samples, 0),
        128
    );
    assert.doesNotMatch(
        JSON.stringify(value),
        /secret-wallet-name|private-parameter|secret-response-body|127\.0\.0\.1|bpm-test|Authorization/
    );
});
test('manual action recording cannot change requests or let failing observers block administrator actions', async () => {
    const rpc = new FakeRpc(),
        node = new NodeService(
            rpc,
            { snapshot: () => ({}) } as unknown as NodeService['connectivity'],
            { stats: () => ({}), enabled: false } as unknown as NodeService['geoDatabase'],
            () => false
        );
    const records: string[] = [];
    node.onAction((kind, _address, _id, outcome) => records.push(kind + '_' + outcome));
    node.onAction(() => {
        throw new Error('history unavailable');
    });
    assert.equal((await node.connect('198.51.100.1:8333')).success, true);
    assert.equal((await node.disconnect(1)).success, true);
    assert.deepEqual(records, [
        'connect_requested',
        'connect_succeeded',
        'disconnect_requested',
        'disconnect_succeeded'
    ]);
    assert.deepEqual(
        rpc.calls.map((c) => c.method),
        ['addnode', 'disconnectnode']
    );
});
test('monitoring health reads distinguish expected Preview observation from a definite failure guard without extra RPC', async (t) => {
    const store = new PeerPolicyStore(temporaryDirectory(t), 'node'),
        rpc = new FakeRpc();
    store.configure({ mode: 'preview', listener_allowance: 0, keep_addresses: [] }, 0);
    const coordinator = new PeerPolicyCoordinator(store, {
        rpc,
        refreshPeers: async () => true,
        managementEnabled: true,
        chain: 'main'
    });
    assert.equal(coordinator.monitoringHealth().failure, false);
    assert.equal(rpc.calls.length, 0);
    const guardedStore = new PeerPolicyStore(temporaryDirectory(t), 'node');
    guardedStore.configure({ mode: 'preview', listener_allowance: 0, keep_addresses: [] }, 0, {
        attempts: [],
        events: [],
        last_wall_time: 0,
        failure_guard: { consecutive_failures: 3, paused: true, reason: 'Failures require a new Preview.' }
    });
    const guarded = new PeerPolicyCoordinator(guardedStore, {
        rpc,
        refreshPeers: async () => true,
        managementEnabled: true,
        chain: 'main'
    });
    assert.equal(guarded.monitoringHealth().failure, true);
    assert.equal(rpc.calls.length, 0);
    await coordinator.stop();
    await guarded.stop();
});
