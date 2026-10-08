import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppRuntime } from '../../src/server/runtime.ts';
import { FakeRpc, flush, settings, temporaryDirectory } from './helpers.ts';

test('implicit and legacy configurations deny every optional request while RPC and local hydration work', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
    t.mock.method(globalThis, 'fetch', () => { assert.fail('Implicit configuration made an optional request'); });
    const directory = temporaryDirectory(t), path = join(directory, 'settings.json');
    writeFileSync(path, '{"geoip_db_only":false,"geoip_auto_update":true}');
    const app = new AppRuntime(settings({ BPM_DATA_DIR: directory, BPM_BUILD_VERSION: 'v1.1.0' }));
    t.after(() => app.stop());
    const rpc = new FakeRpc(); rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4' }];
    let rpcCalls = 0;
    t.mock.method(app.rpc, 'call', async (method: string, params: unknown[] = []) => { rpcCalls++; return rpc.call(method, params); });
    t.mock.method(app.peers, 'start', async () => {
        await app.geoDatabase.save('8.8.8.8', { country: 'NZ', lat: 1, lon: 2 });
        await app.peers.refreshOnce();
    });
    await app.start();
    assert.equal(rpcCalls > 0, true);
    assert.equal(app.peers.listPeers()[0].location_status, 'ok');
    assert.deepEqual(app.outbound.snapshot().effective, { geoip_lookups: false, dataset_downloads: false, release_checks: false, reachability_probes: false });
    assert.equal(app.preferences.geoip_db_only, false, 'explicit old feature choice is retained');
    assert.equal(app.preferences.optional_outbound, false, 'missing global flag defaults to denial');
    assert.match((await app.geoDatabase.update()).message, /disabled/);
    app.setGeoipDbOnly(true); app.setGeoipDbOnly(false);
    app.setGeoipAutoUpdate(false); app.setGeoipAutoUpdate(true);
    t.mock.timers.tick(2 * 24 * 60 * 60 * 1000); await flush();
    assert.equal(app.connectivity.snapshot().internet_state, 'disabled');
    assert.equal(app.connectivity.snapshot().providers.geoip.state, 'disabled');
    assert.equal(app.updates.snapshot().checked_at, null);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).optional_outbound, false);
});

test('explicit deployment denial overrides saved opt-ins and authenticated preference changes', async t => {
    t.mock.method(globalThis, 'fetch', () => { assert.fail('Request escaped deployment ceiling'); });
    const directory = temporaryDirectory(t);
    writeFileSync(join(directory, 'settings.json'), '{"optional_outbound":true,"geoip_db_only":false}');
    const app = new AppRuntime(settings({ BPM_DATA_DIR: directory, BPM_OUTBOUND_ENABLED: 'false', BPM_BUILD_VERSION: 'v1.1.0' }));
    t.after(() => app.stop());
    t.mock.method(app.peers, 'start', async () => {});
    await app.start();
    app.setOutboundPreference('optional_outbound', false);
    const status = app.setOutboundPreference('optional_outbound', true);
    assert.equal(status.preferences.optional_outbound, true);
    assert.equal(status.forced_disabled, true);
    assert.equal(Object.values(status.effective).every(enabled => !enabled), true);
    assert.match((await app.geoDatabase.update()).message, /disabled/);
    assert.equal(app.rpc.signal.aborted, false, 'optional denial leaves configured RPC alive');
});

test('failed optional-policy persistence leaves live permissions and cancellation generations unchanged', async t => {
    const app = new AppRuntime(settings({ BPM_DATA_DIR: temporaryDirectory(t), BPM_OUTBOUND_ENABLED: 'true' }));
    t.after(() => app.stop());
    app.setGeoipDbOnly(false);
    const before = app.outbound.snapshot(), signals = ['geoip', 'dataset', 'updates', 'probe'].map(feature => app.outboundPolicy.signal(feature as 'geoip' | 'dataset' | 'updates' | 'probe'));
    t.mock.method(app.preferencesStore, 'save', () => { throw new Error('Disk full'); });
    assert.throws(() => app.setOutboundPreference('optional_outbound', false), /Disk full/);
    assert.deepEqual(app.outbound.snapshot(), before);
    assert.equal(signals.every(signal => !signal.aborted), true);
    assert.throws(() => app.setOutboundPreference('__proto__' as 'optional_outbound', true), /Invalid outbound preference/);
});
