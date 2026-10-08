import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { AppRuntime, GEOIP_UPDATE_INTERVAL_MS } from '../../src/server/runtime.ts';
import { PreferenceStore, DEFAULT_PREFERENCES } from '../../src/server/preferences.ts';
import { main, waitForRpc } from '../../src/server/main.ts';
import { BitcoinRpcClient, RpcAuthenticationError } from '../../src/server/rpc.ts';
import { settings, temporaryDirectory, deferred, flush, FakeRpc } from './helpers.ts';
import type { TestContext } from 'node:test';

function runtime(t: TestContext, overrides: Record<string, string> = {}) {
    const app = new AppRuntime(settings({ BPM_DATA_DIR: temporaryDirectory(t), BPM_OUTBOUND_ENABLED: 'true', ...overrides }));
    app.setGeoipDbOnly(false); // Explicit opt-in for unrelated legacy scheduler fixtures.
    t.mock.method(app.peers, 'start', async () => {});
    t.mock.method(app.connectivity, 'ensureChecker', () => {});
    t.after(() => app.stop()); return app;
}
test('scheduler retries hourly after completion, without a browser, including failed attempts', async t => {
    const app = runtime(t), gate = deferred<{ success: boolean; message: string }>(); let calls = 0;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(app.geoDatabase, 'update', () => { calls++; return calls === 1 ? gate.promise : Promise.resolve({ success: true, message: 'OK' }); });
    await app.start(); t.mock.timers.tick(1); await flush(); assert.equal(calls, 1);
    t.mock.timers.tick(15000); gate.resolve({ success: false, message: 'Unavailable' }); await flush();
    t.mock.timers.tick(GEOIP_UPDATE_INTERVAL_MS - 1); await flush(); assert.equal(calls, 1);
    t.mock.timers.tick(1); await flush(); assert.equal(calls, 2);
    await app.stop(); t.mock.timers.tick(GEOIP_UPDATE_INTERVAL_MS); await flush(); assert.equal(calls, 2);
});
test('changing unrelated outbound features preserves the dataset scheduler cadence', async t => {
    const app = runtime(t); let calls = 0;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(app.geoDatabase, 'update', async () => { calls++; return { success: true, message: 'OK', skipped_rows: 0 }; });
    await app.start(); t.mock.timers.tick(0); await flush(); assert.equal(calls, 1);
    app.setGeoipDbOnly(true);
    app.setOutboundPreference('release_checks', false);
    app.setOutboundPreference('reachability_checks', false);
    t.mock.timers.tick(0); await flush(); assert.equal(calls, 1);
    t.mock.timers.tick(GEOIP_UPDATE_INTERVAL_MS); await flush(); assert.equal(calls, 2);
});
test('live disabling lets the current import finish; re-enabling triggers an immediate check', async t => {
    const app = runtime(t, { BPM_GEOIP_AUTO_UPDATE: 'false' }), gate = deferred<{ success: boolean; message: string }>(); let calls = 0;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(app.geoDatabase, 'update', () => { calls++; return calls === 1 ? gate.promise : Promise.resolve({ success: true, message: 'OK' }); });
    await app.start(); t.mock.timers.tick(GEOIP_UPDATE_INTERVAL_MS); await flush(); assert.equal(calls, 0);
    app.setGeoipAutoUpdate(true); t.mock.timers.tick(1); await flush(); assert.equal(calls, 1);
    app.setGeoipAutoUpdate(false); gate.resolve({ success: true, message: 'OK' }); await flush();
    t.mock.timers.tick(GEOIP_UPDATE_INTERVAL_MS); await flush(); assert.equal(calls, 1);
    app.setGeoipAutoUpdate(true); t.mock.timers.tick(1); await flush(); assert.equal(calls, 2);
});
test('a disabled database never schedules downloads', async t => {
    const app = runtime(t, { BPM_GEOIP_ENABLED: 'false' });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(app.geoDatabase, 'update', () => assert.fail('Database is disabled'));
    await app.start(); app.setGeoipAutoUpdate(false); app.setGeoipAutoUpdate(true);
    t.mock.timers.tick(GEOIP_UPDATE_INTERVAL_MS); await flush();
});
for (const enabled of ['true', 'false']) {
    test(`saved privacy is restored before peer workers start (database ${enabled})`, async t => {
        const dir = temporaryDirectory(t), config = settings({ BPM_DATA_DIR: dir, BPM_GEOIP_ENABLED: enabled, BPM_GEOIP_AUTO_UPDATE: 'false' });
        const first = new AppRuntime(config); first.setGeoipDbOnly(true); await first.stop();
        const restored = new AppRuntime(config); t.after(() => restored.stop());
        assert.equal(restored.connectivity.snapshot().geo_db_only_mode, true);
        t.mock.method(restored.connectivity, 'ensureChecker', () => {});
        t.mock.method(restored.rpc, 'call', async () => [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }]);
        t.mock.method(restored.peers, 'fetchGeo', () => assert.fail('Privacy leak'));
        t.mock.method(restored.peers, 'start', async () => {
            await restored.peers.refreshOnce(); assert.equal(await restored.peers.resolveGeo('8.8.8.8', 'ipv4'), false);
        });
        await restored.start(); restored.setGeoipDbOnly(false);
        assert.equal(new PreferenceStore(join(dir, 'settings.json')).load().geoip_db_only, false);
    });
}
for (const [method, key] of [['setGeoipDbOnly', 'geoip_db_only'], ['setGeoipAutoUpdate', 'geoip_auto_update']] as const) {
    test(`failed preference writes leave live settings unchanged: ${method}`, t => {
        const app = runtime(t), before = { ...app.preferences };
        t.mock.method(app.preferencesStore, 'save', () => { throw new Error('Disk full'); });
        assert.throws(() => app[method](!before[key]), /Disk full/);
        assert.deepEqual(app.preferences, before); assert.equal(app.connectivity.geoipApiDisabled, false);
    });
}
test('simultaneous preference changes preserve both flags', async t => {
    const app = runtime(t);
    await Promise.all([Promise.resolve().then(() => app.setGeoipDbOnly(true)), Promise.resolve().then(() => app.setGeoipAutoUpdate(false))]);
    assert.deepEqual(app.preferencesStore.load(), { ...DEFAULT_PREFERENCES, optional_outbound: true, geoip_auto_update: false, geoip_db_only: true });
});
test('explicit preferences are idempotent and do not rewrite already saved values', t => {
    const app = runtime(t), save = t.mock.method(app.preferencesStore, 'save');
    assert.equal(app.setGeoipDbOnly(false), false);
    assert.equal(app.setGeoipAutoUpdate(true), true);
    assert.equal(save.mock.callCount(), 0);
    assert.equal(app.setGeoipDbOnly(true), true);
    assert.equal(app.setGeoipDbOnly(true), true);
    assert.equal(app.setGeoipAutoUpdate(false), false);
    assert.equal(app.setGeoipAutoUpdate(false), false);
    assert.equal(save.mock.callCount(), 2);
    assert.deepEqual(app.preferencesStore.load(), { ...DEFAULT_PREFERENCES, optional_outbound: true, geoip_auto_update: false, geoip_db_only: true });
});
test('startup validates the chain and fails immediately on authentication errors', async t => {
    const app = runtime(t);
    t.mock.method(app.rpc, 'checkConnection', async () => ({}));
    t.mock.method(app.rpc, 'call', async () => ({ chain: 'test' }));
    await assert.rejects(waitForRpc(app), /does not match/);
    t.mock.method(app.rpc, 'call', async () => ({ chain: 'main' }));
    await waitForRpc(app);
    t.mock.method(app.rpc, 'checkConnection', async () => { throw new RpcAuthenticationError('Wrong credentials'); });
    await assert.rejects(waitForRpc(app), RpcAuthenticationError);
});
test('startup retries transport errors and respects cancellation', async t => {
    const app = runtime(t); let attempts = 0;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(app.rpc, 'checkConnection', async () => { if (++attempts === 1) throw new Error('Not ready'); return {}; });
    t.mock.method(app.rpc, 'call', async () => ({ chain: 'main' }));
    const ready = waitForRpc(app); await flush(); t.mock.timers.tick(2000); await ready;
    assert.equal(attempts, 2); app.controller.abort();
    await assert.rejects(waitForRpc(app), /cancelled/);
});
for (const stalledMethod of ['getnetworkinfo', 'getblockchaininfo']) {
    test(`startup deadline bounds a stalled ${stalledMethod} request`, async t => {
        const server = createServer(async (req, res) => {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString());
            if (body.method === stalledMethod) return;
            res.end(JSON.stringify({ id: body.id, result: {}, error: null }));
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        t.after(() => new Promise<void>(resolve => {
            server.closeAllConnections();
            server.close(() => resolve());
        }));
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const app = runtime(t, {
            BITCOIN_RPC_PORT: String(address.port),
            BITCOIN_RPC_TIMEOUT: '5',
            BPM_RPC_STARTUP_TIMEOUT: '1',
        });
        const started = performance.now();
        await assert.rejects(waitForRpc(app));
        assert.ok(performance.now() - started < 2000, 'startup must use its one-second budget, not the five-second RPC timeout');
    });
}


for (const override of ['', 'true', 'false']) {
    test(`invalid saved settings stop main before RPC, workers, or writes (override ${override || 'unset'})`, async t => {
        const dir = temporaryDirectory(t), path = join(dir, 'settings.json');
        const raw = '{"geoip_db_only":"true","geoip_auto_update":false}';
        writeFileSync(path, raw);
        const original = process.env;
        process.env = { ...original, BITCOIN_RPC_HOST: '127.0.0.1', BITCOIN_RPC_USER: 'test', BITCOIN_RPC_PASSWORD: 'test', BITCOIN_RPC_PASSWORD_FILE: '', BPM_DATA_DIR: dir, BPM_GEOIP_AUTO_UPDATE: override, BPM_VIEW_MODE: 'public' };
        t.after(() => { process.env = original; });
        t.mock.method(BitcoinRpcClient.prototype, 'checkConnection', async () => assert.fail('RPC check started'));
        t.mock.method(BitcoinRpcClient.prototype, 'call', async () => assert.fail('RPC activity started'));
        t.mock.method(AppRuntime.prototype, 'start', async () => assert.fail('HTTP listening starts workers'));
        t.mock.method(PreferenceStore.prototype, 'save', () => assert.fail('Preference write started'));
        await assert.rejects(main(), /geoip_db_only must be a boolean/);
        assert.equal(readFileSync(path, 'utf8'), raw);
    });
}


for (const [chain, port] of [['main', 8333], ['test', 18333], ['testnet4', 48333], ['signet', 38333], ['regtest', 18444]] as const) {
    test(`${chain} startup matches RPC chain and passes the configured peer default to NodeService`, async t => {
        const app = runtime(t, { BITCOIN_NETWORK: chain }), rpc = new FakeRpc();
        rpc.record('getblockchaininfo').chain = chain;
        t.mock.method(app.rpc, 'checkConnection', async () => ({}));
        t.mock.method(app.rpc, 'call', rpc.call.bind(rpc));
        await waitForRpc(app);
        assert.deepEqual(await app.node.connect('8.8.8.8'), { success: true, address: `8.8.8.8:${port}` });
        assert.deepEqual((await app.node.dashboardInfo()).bitcoin_network, { chain, default_peer_port: port });
        rpc.record('getblockchaininfo').chain = 'wrong-chain';
        await assert.rejects(waitForRpc(app), /does not match/);
    });
}
