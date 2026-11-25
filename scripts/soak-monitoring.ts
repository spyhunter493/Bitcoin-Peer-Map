/** Isolated real-time monitoring soak. Uses synthetic peers/RPC totals only.
 * node scripts/soak-monitoring.ts --seconds 86400 --directory /tmp/bpm-soak
 * Short runs validate the harness; they are not evidence of a 24-hour soak. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../src/server/app.ts';
import { MonitoringService } from '../src/server/monitoring/service.ts';
import { parsePeerInfo, type PeerInfo } from '../src/server/rpc-types.ts';
import { FixtureRuntime, fixtureSettings } from '../tests/layout_server.ts';

const args = process.argv.slice(2);
let duration = 86400, directory = resolve('/tmp', `bpm-monitoring-soak-${Date.now()}`);
for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--seconds' && /^\d+$/.test(args[i + 1] || '')) duration = Number(args[i + 1]);
    else if (args[i] === '--directory' && args[i + 1]) directory = resolve(args[i + 1]);
    else throw new Error('Use --seconds <positive integer> and --directory <path>');
}
assert.ok(duration > 0);
mkdirSync(directory, { recursive: true });
const began = Date.now(), beganMonotonic = performance.now(), token = randomUUID();
const repository = fileURLToPath(new URL('..', import.meta.url));
function backendFingerprint() {
    const hash = createHash('sha256');
    const files = readdirSync(join(repository, 'src/server'), { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
        .map(entry => join(entry.parentPath, entry.name));
    files.push(join(repository, 'tests/layout_server.ts'), join(repository, 'tests/fixtures/monitoring.ts'), fileURLToPath(import.meta.url));
    for (const file of files.sort()) { hash.update(file.slice(repository.length)); hash.update(readFileSync(file)); }
    return hash.digest('hex');
}
const fingerprint = backendFingerprint();
const suppliedRevision = process.env.BPM_SOAK_SOURCE_REVISION;
const sourceRevision = suppliedRevision && /^[a-f0-9]{40}$/.test(suppliedRevision) ? suppliedRevision
    : spawnSync('git', ['-c', `safe.directory=${repository}`, '-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
let lastSuccess = Date.now() / 1000;
let peers: PeerInfo[] = [];
let observations = 0, gaps = 0, queries = 0;
let maximumHeap = 0, maximumRss = 0, maximumQueryMs = 0;
const settings = fixtureSettings(directory, token);
class SoakRuntime extends FixtureRuntime {
    override readonly monitoring: MonitoringService;
    constructor() {
        super(settings);
        this.monitoring = new MonitoringService(directory, 'isolated-soak', {
            managementEnabled: true, build: { version: 'soak', revision: 'isolated' },
            peers: () => ({ peers, status: { connected: Date.now() / 1000 - lastSuccess < 30, last_success_at: lastSuccess, age_seconds: Date.now() / 1000 - lastSuccess } }),
            rpc: () => ({ active: 0, queued: 0, capacity: 8, queue_limit: 32, calls: observations, failures: gaps, methods: [] }),
            geoip: () => ({ state: 'disabled' }), policy: () => ({ mode: 'off', state: 'disabled', failure: false }),
            metrics: async () => {
                const age = (performance.now() - beganMonotonic) / 1000;
                return { uptime: 'soak', uptime_sec: Math.floor(age + 100), ts: Date.now() / 1000,
                    download_bytes: Math.floor(1000000 + age * 4000), upload_bytes: Math.floor(1000000 + age * 8000), rx_bps: 4000, tx_bps: 8000 };
            },
        });
    }
    override async start() { super.start(); await this.monitoring.start(); }
    override async stop() { await this.monitoring.stop(); super.stop(); }
}
const runtime = new SoakRuntime();
const app = createApplication(settings, runtime);
const address = await app.listen(0, '127.0.0.1');
assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const reportPath = join(directory, 'report.json');
const report = { status: 'running', pid: process.pid, started_at: new Date(began).toISOString(), requested_seconds: duration,
    source_revision: sourceRevision, backend_fingerprint: fingerprint, elapsed_seconds: 0,
    directory, observations: 0, gaps: 0, queries: 0, maximum_heap_bytes: 0, maximum_rss_bytes: 0, maximum_query_ms: 0, finished_at: null as string | null, error: null as string | null };
function checkpoint() {
    maximumHeap = Math.max(maximumHeap, process.memoryUsage().heapUsed);
    maximumRss = Math.max(maximumRss, process.memoryUsage().rss);
    Object.assign(report, { observations, gaps, queries, elapsed_seconds: (performance.now() - beganMonotonic) / 1000, maximum_heap_bytes: maximumHeap, maximum_rss_bytes: maximumRss, maximum_query_ms: maximumQueryMs });
    writeFileSync(reportPath + '.tmp', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    renameSync(reportPath + '.tmp', reportPath);
}
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { stopping = true; });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function read(path: string) {
    const start = performance.now();
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, path);
    const result = await response.json();
    maximumQueryMs = Math.max(maximumQueryMs, performance.now() - start); queries++;
    return result;
}
function observe() {
    const elapsed = Math.floor((performance.now() - beganMonotonic) / 1000);
    // One gap every fifteen minutes, then a clean baseline; no invented departures.
    if (elapsed > 0 && elapsed % 900 < 10) { runtime.monitoring.observe(null, performance.now()); gaps++; return; }
    const rotation = Math.floor(elapsed / 60);
    peers = parsePeerInfo(Array.from({ length: 70 }, (_, i) => ({ id: i === 69 ? 1000 + rotation : i + 1,
        addr: `198.51.100.${i + 1}:${30000 + i}`, conntime: Math.floor(began / 1000) - 7200 + (i === 69 ? rotation * 60 : 0),
        inbound: i >= 14, network: i < 5 ? 'onion' : 'ipv4', connection_type: i >= 14 ? 'inbound' : 'outbound-full-relay',
        subver: '/Synthetic:soak/', bytessent: elapsed * 100 + i, bytesrecv: elapsed * 50 + i })));
    runtime.monitoring.observe(peers, performance.now()); observations++; lastSuccess = Date.now() / 1000;
}
try {
    const history = await runtime.monitoring.historySettings();
    await runtime.monitoring.setHistorySettings({ expected_revision: history.revision, enabled: true });
    console.log(JSON.stringify({ status: 'started', report: reportPath, requested_seconds: duration }));
    let lastObservation = -10, lastQuery = -60;
    while (!stopping && performance.now() - beganMonotonic < duration * 1000) {
        const age = (performance.now() - beganMonotonic) / 1000;
        if (age - lastObservation >= 10) { observe(); lastObservation = age; }
        if (age - lastQuery >= 60) {
            const events = await read('/api/history/events?window=30d&limit=100');
            assert.ok(events.events.length <= 100);
            const trends = await read('/api/history/trends?window=30d');
            assert.ok(trends.buckets.length <= 1000);
            const diagnostics = await read('/api/diagnostics');
            assert.equal(diagnostics.policy.mode, 'off');
            assert.ok(!JSON.stringify(diagnostics).includes(token));
            assert.equal(diagnostics.recorder.available, true);
            await read('/api/alerts');
            assert.ok(process.memoryUsage().rss < 1024 * 1024 * 1024, 'isolated 70-peer soak exceeded the 1 GiB RSS safety ceiling');
            assert.equal(backendFingerprint(), fingerprint, 'backend or soak source changed during validation; restart the soak');
            lastQuery = age; checkpoint();
        }
        await wait(Math.min(1000, Math.max(1, duration * 1000 - (performance.now() - beganMonotonic))));
    }
    assert.equal(backendFingerprint(), fingerprint, 'backend or soak source changed during validation; restart the soak');
    report.status = stopping ? 'interrupted' : 'passed';
} catch (error) {
    report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
} finally {
    await app.close(); report.finished_at = new Date().toISOString(); checkpoint();
    console.log(JSON.stringify({ status: report.status, report: reportPath, observations, gaps, queries }));
}
