import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MonitoringService } from '../../src/server/monitoring/service.ts';
import { parsePeerInfo } from '../../src/server/rpc-types.ts';
import type { NodeMetricsSnapshot } from '../../src/server/services/node-metrics.ts';
import { temporaryDirectory } from './helpers.ts';

const peers = (outbound = 4) =>
    parsePeerInfo(
        Array.from({ length: outbound + 1 }, (_, i) => ({
            id: i,
            addr: `198.51.100.${i + 1}:8333`,
            network: 'ipv4',
            inbound: i === outbound,
            conntime: 1,
            connection_type: i === outbound ? 'inbound' : 'outbound-full-relay'
        }))
    );
function service(dir: string, waitForMetrics?: () => Promise<void>) {
    let clock = 0,
        wall = 1000,
        calls = 0;
    let metrics: NodeMetricsSnapshot = {
        uptime: '1h',
        uptime_sec: 3600,
        download_bytes: 100,
        upload_bytes: 200,
        rx_bps: null,
        tx_bps: null,
        ts: wall
    };
    let policy = { mode: 'preview', state: 'preview', failure: false };
    const svc = new MonitoringService(dir, 'node', {
        managementEnabled: true,
        build: { version: 'dev', revision: 'test' },
        peers: () => ({ peers: [], status: { connected: null, last_success_at: null, age_seconds: null } }),
        rpc: () => ({ active: 0, queued: 0, capacity: 8, queue_limit: 32, calls: 0, failures: 0, methods: [] }),
        geoip: () => ({ state: 'disabled' }),
        policy: () => policy,
        metrics: async () => {
            calls++;
            await waitForMetrics?.();
            return structuredClone(metrics);
        },
        wall: () => wall,
        clock: () => clock
    });
    return {
        svc,
        advance(seconds: number) {
            clock += seconds;
            wall += seconds;
        },
        observe(outbound = 4) {
            svc.observe(peers(outbound), clock * 1000);
        },
        setMetrics(value: Partial<NodeMetricsSnapshot>) {
            metrics = { ...metrics, ...value };
        },
        setPolicy(value: typeof policy) {
            policy = value;
        },
        calls: () => calls
    };
}
test('recording is opt-in and server-owned minute trends do not rely on browser polling', async (t) => {
    const f = service(temporaryDirectory(t));
    t.after(() => f.svc.stop());
    await f.svc.start();
    f.observe();
    await f.svc.tick();
    assert.equal(f.calls(), 0);
    await f.svc.setHistorySettings({ expected_revision: 0, enabled: true });
    f.observe();
    await f.svc.tick();
    assert.equal(f.calls(), 1);
    for (let i = 0; i < 6; i++) {
        f.advance(10);
        f.observe();
    }
    f.setMetrics({ download_bytes: 1300, upload_bytes: 2600, uptime_sec: 3660 });
    await f.svc.tick();
    assert.equal(f.calls(), 2);
    await f.svc.store.flush();
    const trend = await f.svc.historyTrends(new URLSearchParams('window=1h'));
    assert.equal(trend.buckets.length, 2);
    assert.equal(trend.buckets[0].rx_bps, null);
    assert.equal(trend.buckets[1].rx_bps, 20);
    assert.equal(trend.buckets[1].tx_bps, 40);
    await f.svc.setHistorySettings({ expected_revision: 1, enabled: false });
    f.advance(60);
    f.observe();
    await f.svc.tick();
    assert.equal(f.calls(), 2);
    assert.equal((await f.svc.historyTrends(new URLSearchParams('window=1h'))).buckets.length, 2);
});
test('preset alerts work with recording off and require sustained fresh outbound evidence', async (t) => {
    const f = service(temporaryDirectory(t));
    t.after(() => f.svc.stop());
    await f.svc.start();
    for (let i = 0; i <= 12; i++) {
        if (i) f.advance(10);
        f.observe(1);
        await f.svc.tick();
    }
    let inbox = await f.svc.alerts();
    assert.deepEqual(
        inbox.incidents.map((i) => i.rule),
        ['low_outbound']
    );
    await f.svc.acknowledge({ id: inbox.incidents[0].id });
    assert.notEqual((await f.svc.alerts()).incidents[0].acknowledged_at, null);
    f.advance(61);
    await f.svc.tick();
    inbox = await f.svc.alerts();
    assert.ok(inbox.incidents.some((i) => i.rule === 'peer_data'));
    f.observe(4);
    await f.svc.tick();
    f.advance(30);
    f.observe(4);
    await f.svc.tick();
    assert.ok((await f.svc.alerts()).incidents.every((i) => i.state === 'resolved'));
    f.setPolicy({ mode: 'preview', state: 'observing', failure: false });
    await f.svc.tick();
    assert.equal(
        (await f.svc.alerts()).incidents.some((i) => i.rule === 'policy_failure'),
        false
    );
    f.setPolicy({ mode: 'automatic', state: 'paused', failure: true });
    await f.svc.tick();
    assert.ok((await f.svc.alerts()).incidents.some((i) => i.rule === 'policy_failure' && i.state === 'active'));
});
test('query validation and optimistic writes reject stale, duplicated, and unsupported input', async (t) => {
    const f = service(temporaryDirectory(t));
    t.after(() => f.svc.stop());
    await f.svc.start();
    for (const q of ['limit=101', 'window=90d', 'cursor=-1', 'window=1h&window=7d', 'source=wallet', 'unknown=1'])
        await assert.rejects(f.svc.historyEvents(new URLSearchParams(q)), { status: 422 });
    await assert.rejects(f.svc.historyTrends(new URLSearchParams('source=peer')), { status: 422 });
    await f.svc.setHistorySettings({ expected_revision: 0, enabled: true });
    await assert.rejects(f.svc.setHistorySettings({ expected_revision: 0, enabled: false }), { status: 409 });
    await assert.rejects(f.svc.setHistorySettings({ expected_revision: 1, enabled: true, retention_days: 90 }), {
        status: 422
    });
    const settings = await f.svc.alertSettings();
    settings.rules.low_outbound = false;
    await f.svc.setAlertSettings({ expected_revision: 0, rules: settings.rules });
    await assert.rejects(f.svc.setAlertSettings({ expected_revision: 0, rules: settings.rules }), { status: 409 });
});
test('database failure leaves diagnostics and active alerts available in memory without leaking details', async (t) => {
    const dir = temporaryDirectory(t);
    writeFileSync(join(dir, 'history.db'), 'private path and secret', { mode: 0o600 });
    const f = service(dir);
    t.after(() => f.svc.stop());
    await f.svc.start();
    f.advance(61);
    await f.svc.tick();
    const inbox = await f.svc.alerts();
    assert.equal(inbox.persistence_degraded, true);
    assert.equal(inbox.incidents[0].rule, 'peer_data');
    const diagnostics = JSON.stringify(f.svc.diagnostics());
    assert.doesNotMatch(diagnostics, /private path|secret|198\.51|http:\/\//);
    assert.equal(f.svc.diagnostics().recorder.available, false);
});
test('committed policy events are deduplicated, actions are separate from observations, and disabling retains accepted writes', async (t) => {
    const f = service(temporaryDirectory(t));
    t.after(() => f.svc.stop());
    await f.svc.start();
    await f.svc.setHistorySettings({ expected_revision: 0, enabled: true });
    const policy = {
        id: 'committed',
        time: 1000,
        peer_id: 1,
        address: '198.51.100.1',
        kind: 'succeeded' as const,
        reason: 'RPC accepted request.'
    };
    f.svc.policyEvent(policy);
    f.svc.policyEvent(policy);
    f.svc.action('disconnect', null, 1, 'succeeded');
    await f.svc.setHistorySettings({ expected_revision: 1, enabled: false });
    await f.svc.store.flush();
    const page = await f.svc.historyEvents(new URLSearchParams('window=1h'));
    assert.equal(page.events.filter((e) => e.source === 'policy').length, 1);
    assert.equal(page.events.filter((e) => e.source === 'manual').length, 1);
    const summary = await f.svc.historySummary(new URLSearchParams('window=1h'));
    assert.equal(summary.accepted_requests, 1);
    assert.equal(summary.observed_departures, 0);
    assert.equal(summary.same_host_returns, 0);
});

test('quiet disabled recording still expires old rows on scheduled maintenance', async (t) => {
    const f = service(temporaryDirectory(t));
    t.after(() => f.svc.stop());
    await f.svc.start();
    await f.svc.setHistorySettings({ expected_revision: 0, enabled: true });
    f.svc.action('connect', '198.51.100.1:8333', null, 'succeeded');
    await f.svc.store.flush();
    await f.svc.setHistorySettings({ expected_revision: 1, enabled: false });
    await f.svc.setAlertSettings({
        expected_revision: 0,
        rules: { peer_data: false, low_outbound: false, policy_failure: false, recording_failure: false }
    });
    f.advance(31 * 86400);
    await f.svc.tick();
    const page = await f.svc.store.request<import('../../src/server/monitoring/types.ts').HistoryPage>('events', {
        from: 0,
        limit: 50
    });
    assert.deepEqual(page.events, []);
});

test('restoring enabled recording marks process downtime as a gap and rebaselines without invented departures', async (t) => {
    const dir = temporaryDirectory(t),
        first = service(dir);
    await first.svc.start();
    await first.svc.setHistorySettings({ expected_revision: 0, enabled: true });
    first.observe();
    await first.svc.store.flush();
    await first.svc.stop();
    const next = service(dir);
    next.advance(60);
    t.after(() => next.svc.stop());
    await next.svc.start();
    next.observe(1);
    await next.svc.store.flush();
    const page = await next.svc.historyEvents(new URLSearchParams('window=1h'));
    assert.ok(page.events.some((e) => e.kind === 'monitoring_gap' && /restarted/.test(e.reason)));
    assert.equal(page.coverage.incomplete, true);
    assert.ok(page.coverage.gaps >= 1);
    assert.equal(
        page.events.some((e) => ['arrived', 'departed'].includes(e.kind)),
        false
    );
});

test('stalled peer observations do not create stale-count minute buckets or traffic rates across the gap', async (t) => {
    const f = service(temporaryDirectory(t));
    t.after(() => f.svc.stop());
    await f.svc.start();
    await f.svc.setHistorySettings({ expected_revision: 0, enabled: true });
    f.observe();
    await f.svc.tick();
    f.advance(61);
    await f.svc.tick();
    assert.equal(f.calls(), 1);
    f.observe();
    f.setMetrics({ download_bytes: 99999, upload_bytes: 99999, uptime_sec: 3661 });
    await f.svc.tick();
    await f.svc.store.flush();
    const trends = await f.svc.historyTrends(new URLSearchParams('window=1h'));
    assert.equal(trends.buckets.length, 2);
    assert.equal(trends.buckets[1].rx_bps, null);
    assert.equal(trends.buckets[1].tx_bps, null);
    assert.ok(trends.coverage.gaps >= 1);
});

test('aborted queued preference writes never change stored recording settings', async (t) => {
    const f = service(temporaryDirectory(t));
    t.after(() => f.svc.stop());
    await f.svc.start();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.svc.setHistorySettings({ expected_revision: 0, enabled: true }, controller.signal), {
        name: 'AbortError'
    });
    assert.equal((await f.svc.historySettings()).enabled, false);
});

test('an observation failure during an awaited metrics read cannot persist stale counts or establish a traffic baseline', async (t) => {
    let release!: () => void;
    const f = service(
        temporaryDirectory(t),
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            })
    );
    t.after(() => f.svc.stop());
    await f.svc.start();
    await f.svc.setHistorySettings({ expected_revision: 0, enabled: true });
    f.observe();
    const sample = f.svc.tick();
    f.svc.observe(null, 0);
    release();
    await sample;
    await f.svc.store.flush();
    assert.deepEqual((await f.svc.historyTrends(new URLSearchParams('window=1h'))).buckets, []);
});
