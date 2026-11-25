import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.ts';
import { object } from '../types.ts';
import type { PeerInfo } from '../rpc-types.ts';
import type { NodeMetricsSnapshot } from '../services/node-metrics.ts';
import type { PolicyEvent } from '../peer-policy/types.ts';
import { MonitoringStore } from './store.ts';
import { HistoryRecorder } from './recorder.ts';
import { AlertEngine } from './alerts.ts';
import {
    HISTORY_WINDOWS,
    ALERT_RULES,
    type MonitoringApi,
    type HistoryWindow,
    type HistorySettings,
    type HistoryEvent,
    type HistoryPage,
    type HistoryTrends,
    type HistorySummary,
    type AlertSettings,
    type AlertInbox,
    type MonitoringDiagnostics,
    type RpcDiagnostics
} from './types.ts';

interface Dependencies {
    build: { version: string; revision: string };
    managementEnabled: boolean;
    peers: () => {
        peers: unknown[];
        status: { connected: boolean | null; last_success_at: number | null; age_seconds: number | null };
    };
    rpc: () => RpcDiagnostics;
    geoip: () => { state: string };
    policy: () => { mode: string; state: string; failure: boolean };
    metrics: () => Promise<NodeMetricsSnapshot>;
    wall?: () => number;
    clock?: () => number;
}
const invalid = () => new HttpError(422, 'Invalid monitoring settings or query.', 'monitoring_invalid');
function fields(payload: unknown, names: string[]): payload is Record<string, unknown> {
    return (
        object(payload) && Object.keys(payload).length === names.length && names.every((n) => Object.hasOwn(payload, n))
    );
}

/** Monitoring is observational: it cannot change peers or the policy's authority. */
export class MonitoringService implements MonitoringApi {
    readonly store: MonitoringStore;
    private deps: Dependencies;
    private recorder = new HistoryRecorder();
    private engine = new AlertEngine();
    private settings: HistorySettings = { revision: 0, enabled: false, retention_days: 30 };
    private began: number;
    private lastSuccess: number | null = null;
    private lowSince: number | null = null;
    private lowOutbound = false;
    private timer: ReturnType<typeof setInterval> | null = null;
    private lastMinute: number | null = null;
    private previousTraffic: { time: number; sent: number; received: number; uptime: number | null } | null = null;
    private sampling = false;
    private sampleWork: Promise<void> | null = null;
    private closed = false;
    private started = false;
    private maintenanceAt: number;
    private persistenceDegraded = false;
    private startedAt: number | null = null;
    private lost = 0;
    private chain: Promise<void> = Promise.resolve();
    private wall: () => number;
    private clock: () => number;
    constructor(dataDir: string, scope: string, deps: Dependencies, store?: MonitoringStore) {
        this.store = store ?? new MonitoringStore(dataDir, scope);
        this.deps = deps;
        this.wall = deps.wall ?? (() => Date.now() / 1000);
        this.clock = deps.clock ?? (() => performance.now() / 1000);
        this.began = this.clock();
        this.maintenanceAt = this.began;
    }
    async start() {
        if (!this.deps.managementEnabled || this.started || this.closed) return;
        this.started = true;
        try {
            await this.store.start();
            await this.store.request('prune', { now: this.wall() });
            this.settings = await this.store.request('settings');
            const coverage = await this.store.request<import('./types.ts').HistoryCoverage>('coverage');
            this.startedAt = coverage.started_at;
            const rules = await this.store.request<AlertSettings>('alertSettings');
            const incidents = await this.store.request<import('./types.ts').AlertIncident[]>('incidents');
            this.engine.restore(incidents, rules);
            this.recorder.setEnabled(this.settings.enabled, this.wall());
            if (this.settings.enabled) {
                this.recorder.restart(this.wall());
                this.append(this.recorder.drain());
            }
        } catch {
            this.persistenceDegraded = true;
        }
        this.timer = setInterval(() => {
            void this.tick();
        }, 5000);
        this.timer.unref();
    }
    async stop() {
        this.closed = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        await Promise.allSettled([this.chain, this.sampleWork]);
        await this.store.close();
    }
    private append(events: HistoryEvent[], bucket?: import('./types.ts').HistoryBucket) {
        if (!this.settings.enabled || this.closed) return;
        const dropped = this.lost + this.store.dropped;
        this.lost = 0;
        this.store.dropped = 0;
        void this.store
            .request('append', { events, bucket, now: this.wall(), dropped, recorded: true }, true)
            .then(() => {
                this.persistenceDegraded = false;
            })
            .catch((error) => {
                this.lost +=
                    dropped +
                    (error instanceof HttpError && error.code === 'history_overflow' ? 0 : events.length || 1);
                this.persistenceDegraded = true;
            });
    }
    observe(peers: PeerInfo[] | null, observedAt: number) {
        const mono = observedAt / 1000,
            now = this.clock();
        if (peers === null) {
            this.lowSince = null;
            this.lowOutbound = false;
            this.previousTraffic = null;
        } else {
            if (this.lastSuccess !== null && now - this.lastSuccess > 30) {
                this.lowSince = null;
                this.previousTraffic = null;
            }
            this.lastSuccess = now;
            const low =
                peers.every((p) => typeof p.inbound === 'boolean') &&
                peers.filter((p) => p.inbound === false).length < 4;
            if (low) {
                this.lowSince ??= mono;
                this.lowOutbound = mono - this.lowSince >= 120 && now - this.began >= 120;
            } else {
                this.lowSince = null;
                this.lowOutbound = false;
            }
        }
        this.recorder.observe(peers, observedAt, this.wall());
        const events = this.recorder.drain();
        if (events.some((event) => event.kind === 'monitoring_gap' || event.kind === 'clock_gap'))
            this.previousTraffic = null;
        this.append(events);
    }
    policyEvent(event: PolicyEvent) {
        this.append([{ ...event, id: 'policy:' + event.id, source: 'policy' }]);
    }
    action(
        kind: string,
        address: string | null,
        peerId: number | null,
        outcome: 'requested' | 'succeeded' | 'failed' | 'uncertain'
    ) {
        this.append([
            {
                id: randomUUID(),
                time: this.wall(),
                source: 'manual',
                kind: kind + '_' + outcome,
                address,
                peer_id: peerId,
                reason:
                    outcome === 'succeeded'
                        ? 'RPC accepted the administrator request; later observations do not establish its cause.'
                        : outcome === 'requested'
                          ? 'Dashboard administrator requested this action.'
                          : outcome === 'uncertain'
                            ? 'The request outcome is uncertain; no automatic retry was sent.'
                            : 'The administrator request failed.'
            }
        ]);
    }
    private async sampleMinute() {
        if (this.sampling || !this.settings.enabled || !this.recorder.baselineValid()) return;
        if (this.lastSuccess === null || this.clock() - this.lastSuccess > 30) {
            this.previousTraffic = null;
            return;
        }
        const minute = Math.floor(this.wall() / 60) * 60;
        if (minute === this.lastMinute) return;
        this.sampling = true;
        this.lastMinute = minute;
        try {
            const sample = await this.deps.metrics();
            if (this.closed || !this.settings.enabled) return;
            if (!this.recorder.baselineValid() || this.lastSuccess === null || this.clock() - this.lastSuccess > 30) {
                this.previousTraffic = null;
                return;
            }
            const now = this.clock(),
                p = this.previousTraffic;
            let rx: number | null = null,
                tx: number | null = null;
            if (sample.download_bytes !== null && sample.upload_bytes !== null) {
                if (
                    p &&
                    now > p.time &&
                    now - p.time <= 90 &&
                    (sample.uptime_sec === null || p.uptime === null || sample.uptime_sec >= p.uptime) &&
                    sample.download_bytes >= p.received &&
                    sample.upload_bytes >= p.sent
                ) {
                    rx = (sample.download_bytes - p.received) / (now - p.time);
                    tx = (sample.upload_bytes - p.sent) / (now - p.time);
                }
                this.previousTraffic = {
                    time: now,
                    sent: sample.upload_bytes,
                    received: sample.download_bytes,
                    uptime: sample.uptime_sec
                };
            } else this.previousTraffic = null;
            this.append([], { time: minute, ...this.recorder.counts(), rx_bps: rx, tx_bps: tx });
        } catch {
            this.previousTraffic = null;
        } finally {
            this.sampling = false;
        }
    }
    async tick() {
        if (this.closed || !this.deps.managementEnabled) return;
        const now = this.clock(),
            policy = this.deps.policy();
        if (now - this.maintenanceAt >= 3600) {
            this.maintenanceAt = now;
            try {
                await this.store.request('prune', { now: this.wall() });
            } catch {
                this.persistenceDegraded = true;
            }
            if (this.closed) return;
        }
        const changes = this.engine.tick(this.wall(), {
            peer_data: now - (this.lastSuccess ?? this.began) >= 60,
            low_outbound: this.lastSuccess !== null && now - this.lastSuccess <= 30 && this.lowOutbound,
            policy_failure: policy.mode !== 'off' && policy.failure,
            recording_failure: this.settings.enabled && Boolean(this.store.error || this.lost || this.store.dropped)
        });
        for (const incident of changes) await this.persistIncident(incident);
        if (!this.sampleWork) {
            const work = this.sampleMinute();
            this.sampleWork = work;
            void work.finally(() => {
                if (this.sampleWork === work) this.sampleWork = null;
            });
        }
        await this.sampleWork;
    }
    private async persistIncident(incident: import('./types.ts').AlertIncident) {
        try {
            await this.store.request('incident', { incident, now: this.wall() });
        } catch {
            this.persistenceDegraded = true;
        }
    }
    async historySettings() {
        return { ...this.settings };
    }
    setHistorySettings(payload: unknown, signal?: AbortSignal): Promise<HistorySettings> {
        const operation = this.chain.then(async () => {
            signal?.throwIfAborted();
            if (
                !fields(payload, ['expected_revision', 'enabled']) ||
                !Number.isSafeInteger(payload.expected_revision) ||
                Number(payload.expected_revision) < 0 ||
                typeof payload.enabled !== 'boolean'
            )
                throw invalid();
            const changed = payload.enabled !== this.settings.enabled;
            const settings = await this.store.request<HistorySettings>(
                'configure',
                { ...payload, now: this.wall() },
                false,
                signal
            );
            this.settings = settings;
            if (changed) {
                this.recorder.setEnabled(settings.enabled, this.wall());
                if (settings.enabled) this.startedAt = this.wall();
                this.previousTraffic = null;
                this.lastMinute = null;
                this.append(this.recorder.drain());
            }
            return { ...settings };
        });
        this.chain = operation.then(
            () => {},
            () => {}
        );
        return operation;
    }
    private query(query: URLSearchParams, events = false) {
        const allowed = events ? ['window', 'limit', 'cursor', 'source', 'kind', 'search'] : ['window'];
        if (
            [...query.keys()].some((k) => !allowed.includes(k)) ||
            [...new Set(query.keys())].some((k) => query.getAll(k).length !== 1)
        )
            throw invalid();
        const window = query.get('window') ?? '24h';
        if (!Object.hasOwn(HISTORY_WINDOWS, window)) throw invalid();
        const seconds = HISTORY_WINDOWS[window as HistoryWindow],
            limit = query.get('limit') ?? '50',
            cursor = query.get('cursor') ?? '',
            source = query.get('source') ?? '',
            kind = query.get('kind') ?? '',
            search = query.get('search') ?? '';
        if (
            !/^\d+$/.test(limit) ||
            Number(limit) < 1 ||
            Number(limit) > 100 ||
            (cursor && (!/^[1-9]\d{0,15}$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) ||
            (source && !['peer', 'manual', 'policy'].includes(source)) ||
            kind.length > 64 ||
            search.length > 512
        )
            throw invalid();
        return {
            window: window as HistoryWindow,
            seconds,
            from: this.wall() - seconds,
            limit: Number(limit),
            cursor,
            source,
            kind,
            search
        };
    }
    async historyEvents(query: URLSearchParams): Promise<HistoryPage> {
        return this.store.request('events', this.query(query, true));
    }
    async historyTrends(query: URLSearchParams): Promise<HistoryTrends> {
        return this.store.request('trends', this.query(query));
    }
    async historySummary(query: URLSearchParams): Promise<HistorySummary> {
        return this.store.request('summary', this.query(query));
    }
    diagnostics(): MonitoringDiagnostics {
        const peers = this.deps.peers();
        return {
            generated_at: this.wall(),
            build: { ...this.deps.build },
            peers: {
                connected: peers.status.connected,
                last_success_at: peers.status.last_success_at,
                age_seconds: peers.status.age_seconds,
                count: peers.peers.length
            },
            rpc: this.deps.rpc(),
            geoip: this.deps.geoip(),
            policy: this.deps.policy(),
            recorder: {
                enabled: this.settings.enabled,
                available: !this.store.error && !this.persistenceDegraded,
                queued: this.store.queued,
                dropped: this.lost + this.store.dropped,
                error: this.store.error ?? (this.persistenceDegraded ? 'Monitoring persistence is degraded.' : null),
                started_at: this.startedAt
            }
        };
    }
    async alerts(): Promise<AlertInbox> {
        return {
            incidents: this.engine.snapshot(),
            persistence_degraded: this.persistenceDegraded || Boolean(this.store.error)
        };
    }
    async acknowledge(payload: unknown, signal?: AbortSignal): Promise<AlertInbox> {
        signal?.throwIfAborted();
        if (!fields(payload, ['id']) || typeof payload.id !== 'string' || payload.id.length > 128) throw invalid();
        const incident = this.engine.acknowledge(payload.id, this.wall());
        if (!incident) throw new HttpError(404, 'Alert not found.');
        await this.persistIncident(incident);
        return this.alerts();
    }
    async alertSettings() {
        return structuredClone(this.engine.settings);
    }
    async setAlertSettings(payload: unknown, signal?: AbortSignal): Promise<AlertSettings> {
        signal?.throwIfAborted();
        if (
            !fields(payload, ['expected_revision', 'rules']) ||
            !Number.isSafeInteger(payload.expected_revision) ||
            Number(payload.expected_revision) < 0 ||
            !object(payload.rules) ||
            Object.keys(payload.rules).length !== 4 ||
            ALERT_RULES.some((rule) => typeof (payload.rules as Record<string, unknown>)[rule] !== 'boolean')
        )
            throw invalid();
        const value = await this.store.request<AlertSettings>('configureAlerts', payload, false, signal);
        this.engine.settings = value;
        return structuredClone(value);
    }
}
