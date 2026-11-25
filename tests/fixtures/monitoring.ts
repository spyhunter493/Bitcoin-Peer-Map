import { HttpError } from '../../src/server/http.ts';
import { object } from '../../src/server/types.ts';
import { ALERT_RULES, type MonitoringApi, type HistorySettings, type HistoryEvent, type HistoryCoverage, type AlertSettings, type AlertIncident, type MonitoringDiagnostics } from '../../src/server/monitoring/types.ts';

export const MONITORING_REQUESTS: Record<string, unknown> = {
    '/api/history/settings': { expected_revision: 0, enabled: true },
    '/api/alerts': { id: 'fixture-alert' },
    '/api/alerts/settings': { expected_revision: 0, rules: { peer_data: true, low_outbound: true, policy_failure: true, recording_failure: true } },
    '/api/peer-policy/annotations': { expected_revision: 0, address: '198.51.100.1', label: 'Remote wallet', note: 'Fixture operator metadata.' },
    '/api/saved-views': { expected_revision: 0, operation: 'create', name: 'All peers', kind: 'peers', state: { query: '', networks: ['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns'], filter: null, private_mode: false, columns: ['id', 'ip'], sort: { key: null, direction: null } } },
};

/** In-memory browser fixture: production recorder/storage are tested separately. */
export class FixtureMonitoring implements MonitoringApi {
    private settings: HistorySettings = { revision: 0, enabled: false, retention_days: 30 };
    private rules: AlertSettings = { revision: 0, rules: { peer_data: true, low_outbound: true, policy_failure: true, recording_failure: true } };
    private began = Date.now() / 1000 - 86400;
    private incidents: AlertIncident[] = [{ id: 'fixture-alert', rule: 'peer_data', state: 'active', raised_at: this.began, resolved_at: null, acknowledged_at: null, message: 'Fixture outage <img src=x onerror="window.monitoringInjection=true">' }];
    private events: HistoryEvent[] = Array.from({ length: 151 }, (_, index) => ({ id: `fixture-${index}`, time: Date.now() / 1000 - index * 60,
        source: index % 3 === 0 ? 'policy' : index % 3 === 1 ? 'manual' : 'peer', kind: index % 3 === 0 ? 'succeeded' : 'arrival',
        address: '198.51.100.' + (index % 200 + 1), peer_id: index,
        reason: index ? 'Fixture observation; departure cause is unknown.' : '<img src=x onerror="window.monitoringInjection=true">' }));
    private coverage(): HistoryCoverage { return { recording: this.settings.enabled, started_at: this.began, oldest_at: this.events.at(-1)?.time ?? null,
        newest_at: this.events[0]?.time ?? null, gaps: 1, dropped: 2, incomplete: true }; }
    async historySettings() { return { ...this.settings }; }
    async setHistorySettings(payload: unknown) {
        if (!object(payload) || Object.keys(payload).length !== 2 || typeof payload.enabled !== 'boolean') throw new HttpError(422, 'Invalid recording settings.');
        if (payload.expected_revision !== this.settings.revision) throw new HttpError(409, 'History settings changed.');
        this.settings = { ...this.settings, revision: this.settings.revision + 1, enabled: payload.enabled };
        return this.historySettings();
    }
    async historyEvents(query: URLSearchParams) {
        const limitText = query.get('limit') || '50', cursorText = query.get('cursor') || '0';
        if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 100 || !/^\d+$/.test(cursorText)) throw new HttpError(422, 'Invalid history pagination.');
        const cursor = Number(cursorText), limit = Number(limitText);
        const source = query.get('source'), kind = query.get('kind'), search = (query.get('search') || '').toLowerCase();
        const matching = this.events.filter(event => (!source || event.source === source) && (!kind || event.kind === kind) &&
            (!search || `${event.address} ${event.reason}`.toLowerCase().includes(search)));
        const events = matching.slice(cursor, cursor + limit);
        return { events, next_cursor: cursor + limit < matching.length ? String(cursor + limit) : null, coverage: this.coverage() };
    }
    async historyTrends(_query: URLSearchParams) {
        return { buckets: Array.from({ length: 30 }, (_, index) => ({ time: Math.floor(Date.now() / 60000) * 60 - (29 - index) * 60,
            inbound: 30 + index % 4, outbound: 12, networks: { ipv4: 30, onion: 12 }, rx_bps: index === 10 ? null : 1000 + index * 100,
            tx_bps: index === 10 ? null : 500 + index * 50 })), coverage: this.coverage() };
    }
    async historySummary(query: URLSearchParams) {
        return { window: (query.get('window') || '24h') as '1h' | '24h' | '7d' | '30d', accepted_requests: 12, observed_departures: 10, same_host_returns: 5, coverage: this.coverage() };
    }
    diagnostics(): MonitoringDiagnostics {
        return { generated_at: Date.now() / 1000, build: { version: 'fixture', revision: 'abcdef0123456789' },
            peers: { connected: true, last_success_at: Date.now() / 1000, age_seconds: 0, count: 40 },
            rpc: { active: 0, queued: 0, capacity: 8, queue_limit: 32, calls: 123, failures: 1, methods: [{ method: 'getpeerinfo', samples: 20, average_ms: 5, p95_ms: 9, failures: 1 }] },
            geoip: { state: 'disabled' }, policy: { mode: 'off', state: 'disabled', failure: false },
            recorder: { enabled: this.settings.enabled, available: true, queued: 0, dropped: 2, error: null, started_at: this.began } };
    }
    async alerts() { return { incidents: structuredClone(this.incidents), persistence_degraded: false }; }
    async acknowledge(payload: unknown) {
        if (!object(payload) || typeof payload.id !== 'string') throw new HttpError(422, 'Invalid acknowledgment.');
        const item = this.incidents.find(incident => incident.id === payload.id);
        if (!item) throw new HttpError(404, 'Alert not found.');
        item.acknowledged_at = Date.now() / 1000;
        return this.alerts();
    }
    async alertSettings() { return structuredClone(this.rules); }
    async setAlertSettings(payload: unknown) {
        if (!object(payload) || !object(payload.rules) || Object.keys(payload.rules).length !== 4 || ALERT_RULES.some(rule => typeof (payload.rules as Record<string, unknown>)[rule] !== 'boolean')) throw new HttpError(422, 'Invalid rules.');
        if (payload.expected_revision !== this.rules.revision) throw new HttpError(409, 'Alert settings changed.');
        this.rules = { revision: this.rules.revision + 1, rules: payload.rules as AlertSettings['rules'] };
        return this.alertSettings();
    }
}
