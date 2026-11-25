export const HISTORY_RETENTION_SECONDS = 30 * 86400;
export const HISTORY_WINDOWS = { '1h': 3600, '24h': 86400, '7d': 7 * 86400, '30d': HISTORY_RETENTION_SECONDS } as const;
export type HistoryWindow = keyof typeof HISTORY_WINDOWS;
export interface HistorySettings {
    revision: number;
    enabled: boolean;
    retention_days: 30;
}
export interface HistoryEvent {
    id: string;
    time: number;
    source: 'peer' | 'manual' | 'policy';
    kind: string;
    address: string | null;
    peer_id: number | null;
    reason: string;
}
export interface HistoryCoverage {
    recording: boolean;
    started_at: number | null;
    oldest_at: number | null;
    newest_at: number | null;
    gaps: number;
    dropped: number;
    incomplete: boolean;
}
export interface HistoryPage {
    events: HistoryEvent[];
    next_cursor: string | null;
    coverage: HistoryCoverage;
}
export interface HistoryBucket {
    time: number;
    inbound: number;
    outbound: number;
    networks: Record<string, number>;
    rx_bps: number | null;
    tx_bps: number | null;
}
export interface HistoryTrends {
    buckets: HistoryBucket[];
    coverage: HistoryCoverage;
}
export interface HistorySummary {
    window: HistoryWindow;
    accepted_requests: number;
    observed_departures: number;
    same_host_returns: number;
    coverage: HistoryCoverage;
}
export const ALERT_RULES = ['peer_data', 'low_outbound', 'policy_failure', 'recording_failure'] as const;
export type AlertRule = (typeof ALERT_RULES)[number];
export interface AlertSettings {
    revision: number;
    rules: Record<AlertRule, boolean>;
}
export interface AlertIncident {
    id: string;
    rule: AlertRule;
    state: 'active' | 'resolved';
    raised_at: number;
    resolved_at: number | null;
    acknowledged_at: number | null;
    message: string;
}
export interface AlertInbox {
    incidents: AlertIncident[];
    persistence_degraded: boolean;
}
export interface RecorderHealth {
    enabled: boolean;
    available: boolean;
    queued: number;
    dropped: number;
    error: string | null;
    started_at: number | null;
}
export interface RpcDiagnostics {
    active: number;
    queued: number;
    capacity: number;
    queue_limit: number;
    calls: number;
    failures: number;
    methods: { method: string; samples: number; average_ms: number; p95_ms: number; failures: number }[];
}
export interface MonitoringDiagnostics {
    generated_at: number;
    build: { version: string; revision: string };
    peers: { connected: boolean | null; last_success_at: number | null; age_seconds: number | null; count: number };
    rpc: RpcDiagnostics;
    geoip: { state: string };
    policy: { mode: string; state: string; failure: boolean };
    recorder: RecorderHealth;
}
export interface MonitoringApi {
    historySettings(): Promise<HistorySettings>;
    setHistorySettings(payload: unknown, signal?: AbortSignal): Promise<HistorySettings>;
    historyEvents(query: URLSearchParams): Promise<HistoryPage>;
    historyTrends(query: URLSearchParams): Promise<HistoryTrends>;
    historySummary(query: URLSearchParams): Promise<HistorySummary>;
    diagnostics(): MonitoringDiagnostics;
    alerts(): Promise<AlertInbox>;
    acknowledge(payload: unknown, signal?: AbortSignal): Promise<AlertInbox>;
    alertSettings(): Promise<AlertSettings>;
    setAlertSettings(payload: unknown, signal?: AbortSignal): Promise<AlertSettings>;
}
