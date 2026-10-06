import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectivityService } from '../../src/server/services/connectivity.ts';
import { PeerService } from '../../src/server/services/peers.ts';
import { GeoDatabase } from '../../src/server/services/geoip.ts';
import { FakeRpc, temporaryDirectory, flush, deferred } from './helpers.ts';
import type { TestContext } from 'node:test';

const location = (headers?: HeadersInit) => new Response('{"status":"success","lat":1,"lon":2,"country":"NZ"}', { headers });
function setup(t: TestContext, fetcher: typeof fetch) {
    const connectivity = new ConnectivityService(false, undefined, fetcher);
    const geo = new GeoDatabase(temporaryDirectory(t), false);
    const rpc = new FakeRpc();
    const peers = new PeerService(rpc, geo, connectivity, undefined, fetcher);
    t.after(async () => { await peers.stop(); await connectivity.stop(); });
    return { connectivity, peers, rpc };
}
function clock(t: TestContext) {
    let time = 1_000_000;
    t.mock.method(Date, 'now', () => time);
    t.mock.method(performance, 'now', () => time);
    return (milliseconds: number) => { time += milliseconds; };
}
for (const failure of ['transport', 'outage', 'malformed'] as const) {
    test(`GeoIP ${failure} leaves internet status alone and recovers independently`, async t => {
        const advance = clock(t);
        let failing = true;
        const { connectivity, peers } = setup(t, async url => {
            assert.ok(String(url).includes('ip-api.com'), 'provider failures must not trigger Google probes');
            if (!failing) return location();
            if (failure === 'transport') throw new Error('GeoIP unreachable');
            return failure === 'outage' ? new Response('', { status: 503 }) : new Response('{"status":"success","lat":[],"lon":2,"country":"NZ"}');
        });
        for (let i = 0; i < 5; i++) assert.equal(await peers.fetchGeo('8.8.8.8'), null);
        const failed = connectivity.snapshot();
        assert.equal(failed.internet_state, 'green'); assert.equal(failed.api_available, false);
        assert.equal(failed.api_down_prompt, true); assert.equal(failed.providers.geoip.consecutive_failures, 5);
        connectivity.acknowledgePrompt();
        failing = false;
        assert.equal(await peers.fetchGeo('1.1.1.1'), null, 'outage recovery waits for the provider deadline');
        advance(30_000);
        assert.ok(await peers.fetchGeo('1.1.1.1'));
        const recovered = connectivity.snapshot();
        assert.equal(recovered.providers.geoip.state, 'healthy'); assert.equal(recovered.api_available, true);
        assert.equal(recovered.api_down_prompt, false); assert.equal(recovered.api_consecutive_failures, 0);
    });
}
test('GeoIP respects quota headers on success and HTTP 429', async t => {
    const advance = clock(t); let calls = 0;
    const { connectivity, peers } = setup(t, async () => {
        calls++;
        if (calls === 1) return location({ 'X-Rl': '0', 'X-Ttl': '30' });
        if (calls === 2) return new Response('', { status: 429, headers: { 'X-Ttl': '10' } });
        return location();
    });
    assert.ok(await peers.fetchGeo('8.8.8.8'));
    assert.equal(await peers.fetchGeo('1.1.1.1'), null); assert.equal(calls, 1);
    assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 0);
    assert.equal(connectivity.snapshot().providers.geoip.state, 'rate_limited');
    advance(30_000); assert.equal(await peers.fetchGeo('1.1.1.1'), null);
    assert.equal(connectivity.snapshot().providers.geoip.retry_at, 1040);
    advance(9999); await peers.fetchGeo('1.1.1.1'); assert.equal(calls, 2);
    advance(1); assert.ok(await peers.fetchGeo('1.1.1.1')); assert.equal(calls, 3);
    assert.equal(connectivity.snapshot().providers.geoip.state, 'healthy');
});
test('Retry-After accepts HTTP dates and defaults to 60 seconds for missing or invalid rate-limit headers', async t => {
    const advance = clock(t);
    const { connectivity } = setup(t, async () => location());
    for (const provider of ['geoip'] as const) {
        for (const value of [undefined, 'invalid', '-1']) {
            connectivity.providerFailure(provider, new Error('rate limited'), new Response('', { status: 429, headers: value === undefined ? {} : { 'Retry-After': value } }));
            assert.equal(connectivity.snapshot().providers[provider].retry_at, Date.now() / 1000 + 60);
            advance(60_000); connectivity.providerSuccess(provider);
        }
        connectivity.providerFailure(provider, new Error('maintenance'), new Response('', { status: 503, headers: { 'Retry-After': new Date(Date.now() + 30_000).toUTCString() } }));
        advance(29_999); assert.equal(connectivity.providerReady(provider), false);
        advance(1); assert.equal(connectivity.providerReady(provider), true);
    }
});
test('in-flight success cannot clear a rate-limit deadline from another request', async t => {
    const advance = clock(t), pending = deferred<Response>();
    const { connectivity, peers } = setup(t, async url => String(url).includes('8.8.8.8') ? pending.promise : new Response('', { status: 429, headers: { 'Retry-After': '60' } }));
    const first = peers.fetchGeo('8.8.8.8'); await flush();
    await peers.fetchGeo('1.1.1.1'); pending.resolve(location()); await first;
    assert.equal(connectivity.providerReady('geoip'), false);
    assert.equal(connectivity.snapshot().providers.geoip.state, 'rate_limited');
    advance(60_000); assert.equal(connectivity.providerReady('geoip'), true);
});
test('rejected addresses are lookup misses, while malformed bodies indicate provider failure', async t => {
    let body = '{"status":"fail","message":"reserved range"}';
    const { connectivity, peers } = setup(t, async () => new Response(body));
    assert.equal(await peers.fetchGeo('8.8.8.8'), null);
    assert.equal(connectivity.snapshot().providers.geoip.state, 'healthy');
    body = 'not JSON'; assert.equal(await peers.fetchGeo('8.8.8.8'), null);
    assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 1);
    const copy = connectivity.snapshot(); copy.providers.geoip.consecutive_failures = 99;
    assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 1);
});
test('internet probes run independently, recover after four successes, and stop cleanly', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    let available = true, calls = 0;
    const { connectivity } = setup(t, async url => {
        assert.equal(String(url), 'https://www.google.com'); calls++;
        if (!available) throw new Error('offline');
        return new Response(null, { status: 204 });
    });
    connectivity.ensureChecker(); connectivity.ensureChecker(); await flush();
    assert.equal(calls, 1);
    available = false; t.mock.timers.tick(30_000); await flush();
    assert.equal(connectivity.snapshot().internet_state, 'yellow');
    for (let i = 0; i < 5; i++) { t.mock.timers.tick(2000); await flush(); }
    assert.equal(connectivity.snapshot().internet_state, 'red');
    available = true;
    for (let i = 0; i < 3; i++) { t.mock.timers.tick(2000); await flush(); }
    assert.equal(connectivity.snapshot().internet_state, 'red');
    t.mock.timers.tick(2000); await flush();
    assert.equal(connectivity.snapshot().internet_state, 'green');
    assert.equal(connectivity.snapshot().providers.geoip.state, 'unknown');
    await connectivity.stop(); const stoppedCalls = calls;
    t.mock.timers.tick(60_000); await flush(); assert.equal(calls, stoppedCalls);
});
test('shutdown does not count cancelled provider requests as failures', async t => {
    const { connectivity, peers } = setup(t, async (_url, options) => {
        await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
        return location();
    });
    const pending = peers.fetchGeo('8.8.8.8'); await flush();
    await peers.stop(); await connectivity.stop(); await pending;
    assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 0);
});
test('a failed GeoIP lookup cannot suspend the resolver for unrelated peers', async t => {
    let geoCalls = 0;
    const { connectivity, peers, rpc } = setup(t, async url => {
        assert.ok(String(url).includes('ip-api.com'));
        return ++geoCalls === 1 ? new Response('', { status: 503 }) : location();
    });
    rpc.values.getpeerinfo = [{ id: 1, addr: '8.8.8.8:8333' }, { id: 2, addr: '1.1.1.1:8333' }];
    await peers.refreshOnce();
    assert.equal(await peers.resolveGeo('8.8.8.8', 'ipv4'), true);
    assert.equal(await peers.resolveGeo('1.1.1.1', 'ipv4'), true);
    assert.equal(geoCalls, 2); assert.equal(peers.cachedGeo('1.1.1.1')?.status, 'ok');
    assert.equal(connectivity.snapshot().internet_state, 'green');
});
test('an HTTP outage on the probe host still proves internet reachability', async t => {
    const { connectivity } = setup(t, async () => new Response(null, { status: 503 }));
    connectivity.ensureChecker(); await flush();
    assert.equal(connectivity.snapshot().internet_state, 'green');
    assert.equal(connectivity.failureStartedAt, null);
    await connectivity.stop();
});

test('provider outage backoff starts after five failures, increases to five minutes, and permits recovery', async t => {
    const advance = clock(t);
    let calls = 0, failing = true;
    const { connectivity, peers } = setup(t, async () => {
        calls++;
        if (failing) throw new Error('provider outage');
        return location();
    });
    connectivity.internetState = 'red';
    for (let i = 0; i < 4; i++) {
        await peers.fetchGeo('8.8.8.8');
        assert.equal(connectivity.providerReady('geoip'), true);
    }
    for (const delay of [30, 60, 120, 240, 300, 300]) {
        await peers.fetchGeo('8.8.8.8');
        const current = connectivity.snapshot();
        assert.equal(current.providers.geoip.state, 'unavailable');
        assert.equal(current.providers.geoip.retry_at, Date.now() / 1000 + delay);
        assert.equal(current.api_down_prompt, true, 'a failed probe does not hide provider notices');
        const before = calls;
        advance(delay * 1000 - 1);
        assert.equal(await peers.fetchGeo('1.1.1.1'), null);
        assert.equal(calls, before);
        advance(1); assert.equal(connectivity.providerReady('geoip'), true);
    }
    failing = false;
    assert.ok(await peers.fetchGeo('1.1.1.1'));
    assert.equal(connectivity.snapshot().providers.geoip.state, 'healthy');
    assert.equal(connectivity.snapshot().providers.geoip.retry_at, null);
    assert.equal(connectivity.snapshot().internet_state, 'red');
});

test('a concurrent success clears outage backoff while preserving a separate quota deadline', async t => {
    const advance = clock(t);
    const { connectivity } = setup(t, async () => location());
    for (let i = 0; i < 5; i++) connectivity.providerFailure('geoip', new Error('outage'));
    connectivity.providerFailure('geoip', new Error('quota'), new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    connectivity.providerSuccess('geoip');
    assert.equal(connectivity.snapshot().providers.geoip.consecutive_failures, 0);
    assert.equal(connectivity.snapshot().providers.geoip.state, 'rate_limited');
    advance(30_000); assert.equal(connectivity.providerReady('geoip'), false);
    advance(90_000); assert.equal(connectivity.providerReady('geoip'), true);
    assert.equal(connectivity.snapshot().providers.geoip.state, 'healthy');
});
