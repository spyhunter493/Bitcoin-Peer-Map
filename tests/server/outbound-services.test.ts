import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { OutboundPolicy } from '../../src/server/outbound-policy.ts';
import type { OutboundFeature } from '../../src/server/outbound-policy.ts';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { UpdateService } from '../../src/server/services/updates.ts';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { GEO_SCHEMA } from '../../src/server/services/geoip-schema.ts';
import { createGeoipLookup } from '../../src/server/services/geoip-provider.ts';
import { deferred, flush, settings, temporaryDirectory } from './helpers.ts';

const allow = { geoip: true, dataset: true, updates: true, probe: true };
const deny = { geoip: false, dataset: false, updates: false, probe: false };
const location = () => Response.json({ status: 'success', country: 'NZ', lat: 1, lon: 2 });
const release = () => Response.json({ draft: false, prerelease: false, tag_name: 'v1.2.0' });

test('rejected GeoIP and release responses release their unread streams without following redirects', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const policy = new OutboundPolicy(allow), directory = temporaryDirectory(t);
    let calls = 0, cancelled = 0;
    const fetcher: typeof fetch = async (_url, options) => {
        calls++;
        assert.equal(options?.redirect, 'manual');
        return new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }), {
            status: 302, headers: { Location: 'https://redirect.invalid/SECRET-SENTINEL' },
        });
    };
    const connectivity = new ConnectivityService(false, undefined, fetcher, policy);
    const updates = new UpdateService(settings({ BPM_BUILD_VERSION: 'v1.1.0', BPM_DATA_DIR: directory }), undefined, fetcher, policy);
    t.after(async () => { policy.close(); await connectivity.stop(); await updates.stop(); });
    t.mock.method(console, 'warn', () => {});
    assert.equal(await createGeoipLookup(connectivity, policy, fetcher)('8.8.8.8', new AbortController().signal), null);
    updates.start(); t.mock.timers.tick(0); await flush();
    assert.equal(calls, 2);
    assert.equal(cancelled, 2, 'both rejected responses release the connection without consuming their payloads');
    assert.equal(connectivity.snapshot().providers.geoip.last_error?.includes('SECRET-SENTINEL'), false);
    assert.equal(updates.snapshot().check_failed, true);
});

test('enabling preferences does not start probing until the worker was explicitly started', async t => {
    const policy = new OutboundPolicy(deny); let calls = 0;
    const connectivity = new ConnectivityService(false, undefined, async () => { calls++; return new Response(null, { status: 204 }); }, policy);
    t.after(async () => { policy.close(); await connectivity.stop(); });
    policy.update(allow); await flush(); assert.equal(calls, 0);
    connectivity.ensureChecker(); await flush(); assert.equal(calls, 1);
});

test('denied optional services perform no requests while local SQLite remains usable', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
    const policy = new OutboundPolicy(deny), directory = temporaryDirectory(t);
    const fetcher: typeof fetch = () => { assert.fail('Optional request escaped global denial'); };
    const connectivity = new ConnectivityService(false, undefined, fetcher, policy);
    const updates = new UpdateService(settings({ BPM_BUILD_VERSION: 'v1.1.0', BPM_DATA_DIR: directory }), undefined, fetcher, policy);
    const geo = new GeoDatabase(directory, true, undefined, policy);
    t.after(async () => { policy.close(); await connectivity.stop(); await updates.stop(); geo.close(); });
    geo.initialize(); connectivity.ensureChecker(); updates.start();
    t.mock.timers.tick(2 * 24 * 60 * 60 * 1000); await flush();
    assert.equal(await createGeoipLookup(connectivity, policy, fetcher)('8.8.8.8', new AbortController().signal), null);
    assert.match((await geo.update(fetcher)).message, /disabled/);
    assert.equal((await geo.save('8.8.8.8', { country: 'NZ', lat: 1, lon: 2 })).status, 'saved');
    assert.equal(geo.get('8.8.8.8')?.country, 'NZ');
    assert.equal(connectivity.snapshot().internet_state, 'disabled');
    assert.equal(connectivity.snapshot().providers.geoip.state, 'disabled');
    assert.equal(connectivity.snapshot().api_down_prompt, false);
    assert.equal(updates.snapshot().checked_at, null);
});

test('disabling each feature cancels requests and rejects late responses without recording failures', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
    const policy = new OutboundPolicy(allow), directory = temporaryDirectory(t);
    const gates = { geoip: deferred<Response>(), dataset: deferred<Response>(), updates: deferred<Response>(), probe: deferred<Response>() };
    const signals = new Map<OutboundFeature, AbortSignal>();
    let calls = 0;
    const fetcher: typeof fetch = (url, options) => {
        const text = String(url), feature = text.includes('ip-api') ? 'geoip' : text.includes('raw.githubusercontent') ? 'dataset' : text.includes('api.github') ? 'updates' : 'probe';
        assert.equal(options?.redirect, 'manual');
        const restarted = signals.has(feature);
        signals.set(feature, options!.signal!); calls++;
        if (restarted) return Promise.resolve(feature === 'updates' ? release() : new Response(null, { status: 204 }));
        return gates[feature].promise; // Deliberately ignore abort to exercise late completions.
    };
    const connectivity = new ConnectivityService(false, undefined, fetcher, policy);
    const updates = new UpdateService(settings({ BPM_BUILD_VERSION: 'v1.1.0', BPM_DATA_DIR: directory }), undefined, fetcher, policy);
    const geo = new GeoDatabase(directory, true, undefined, policy); geo.initialize();
    t.after(async () => { policy.close(); await connectivity.stop(); await updates.stop(); geo.close(); });
    connectivity.ensureChecker(); updates.start(); t.mock.timers.tick(0); await flush();
    const lookup = createGeoipLookup(connectivity, policy, fetcher)('8.8.8.8', new AbortController().signal);
    const download = geo.update(fetcher); await flush();
    assert.equal(signals.size, 4);
    policy.update(deny);
    for (const signal of signals.values()) assert.equal(signal.aborted, true);
    gates.geoip.resolve(location()); gates.dataset.resolve(new Response('ignored')); gates.updates.resolve(release()); gates.probe.resolve(new Response(null, { status: 204 }));
    assert.equal(await lookup, null);
    assert.match((await download).message, /cancelled/);
    await flush();
    assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 0);
    assert.equal(connectivity.snapshot().providers.geoip.last_success_at, null);
    assert.equal(updates.snapshot().checked_at, null);
    assert.equal(existsSync(join(directory, 'update-check.json')), false);
    assert.deepEqual(readdirSync(geo.tempDir), []);
    t.mock.timers.tick(24 * 60 * 60 * 1000); await flush(); assert.equal(calls, 4);
    policy.update({ ...deny, updates: true, probe: true });
    t.mock.timers.tick(0); await flush();
    assert.equal(calls, 6, 'only re-enabled features restart');
    assert.equal(updates.snapshot().latest_version, 'v1.2.0');
    assert.equal(connectivity.snapshot().providers.geoip.state, 'disabled');
});

test('a downloaded dataset finishes its local merge after optional network traffic is disabled', async t => {
    const directory = temporaryDirectory(t), policy = new OutboundPolicy(allow);
    const remote = join(directory, 'fixture.db'), db = new DatabaseSync(remote);
    db.exec(GEO_SCHEMA);
    db.prepare('INSERT INTO geo_cache (ip,country,lat,lon,last_updated) VALUES (?,?,?,?,?)').run('8.8.8.8', 'NZ', 1, 2, 100);
    db.close();
    const geo = new GeoDatabase(directory, true, undefined, policy); geo.initialize();
    t.after(() => { policy.close(); geo.close(); });
    const once = Worker.prototype.once;
    t.mock.method(Worker.prototype, 'once', function (this: Worker, event: string, listener: (...args: unknown[]) => void) {
        if (event === 'message') policy.update(deny); // Download handed off; local validation/transaction remains allowed.
        return once.call(this, event, listener);
    });
    const result = await geo.update(async () => new Response(readFileSync(remote)));
    assert.equal(result.success, true);
    assert.equal(policy.allowed('dataset'), false);
    assert.equal(geo.get('8.8.8.8')?.country, 'NZ');
    assert.deepEqual(readdirSync(geo.tempDir), []);
});

test('legacy HTTP lookup rejects private hosts and redirects and sanitizes transport errors', async t => {
    const policy = new OutboundPolicy(allow), connectivity = new ConnectivityService(false, undefined, fetch, policy);
    t.after(async () => { policy.close(); await connectivity.stop(); });
    t.mock.method(console, 'warn', () => {});
    let calls = 0;
    const lookup = createGeoipLookup(connectivity, policy, async (url, options) => {
        calls++;
        assert.match(String(url), /^http:\/\/ip-api\.com\/json\//);
        assert.equal(options?.redirect, 'manual');
        if (calls === 1) return new Response(null, { status: 302, headers: { Location: 'https://other.example/SECRET-SENTINEL' } });
        throw new Error('SECRET-SENTINEL in transport internals');
    });
    for (const host of ['127.0.0.1', '192.168.1.1', '::1', 'example.onion', 'example.com']) assert.equal(await lookup(host, new AbortController().signal), null);
    assert.equal(calls, 0);
    assert.equal(await lookup('8.8.8.8', new AbortController().signal), null);
    assert.equal(calls, 1, 'redirects are never followed');
    assert.equal(await lookup('1.1.1.1', new AbortController().signal), null);
    assert.equal(connectivity.snapshot().providers.geoip.last_error?.includes('SECRET-SENTINEL'), false);
    policy.update(deny);
    assert.equal(await lookup('8.8.8.8', new AbortController().signal), null);
    assert.equal(calls, 2);
});
