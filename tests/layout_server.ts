import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createApplication, type ApplicationRuntime } from '../src/server/app.ts';
import { loadSettings, type Settings } from '../src/server/settings.ts';
import { BitcoinRpcClient } from '../src/server/rpc.ts';
import type { NodeMetricsSnapshot } from '../src/server/services/node-metrics.ts';
import type { DashboardInfo, RecentBlocks, ChainTips, Peer, MempoolResponse, BlockchainResponse } from '../src/server/api-types.ts';
import type { ConnectivityStatus } from '../src/server/services/connectivity.ts';
import { BITCOIN_NETWORKS } from '../src/server/network.ts';
import type { OutboundPreference } from '../src/server/preferences.ts';

// Captured API fixtures keep browser regressions independent of external services.
const fixtures: { peers: Peer[]; metrics: NodeMetricsSnapshot; info: DashboardInfo; mempool: MempoolResponse; blockchain: BlockchainResponse; blocks: RecentBlocks; tips: ChainTips } = JSON.parse(readFileSync(new URL('./fixtures/dashboard.json', import.meta.url), 'utf8'));
export class FixtureRuntime implements ApplicationRuntime {
    readonly settings: Settings;
    readonly rpc: BitcoinRpcClient;
    started = false;
    stopped = false;
    private dbOnly = false;
    private autoUpdate = false;
    private outboundPreferences = { optional_outbound: false, geoip_dataset_downloads: true, release_checks: true, reachability_checks: true };
    constructor(settings: Settings) {
        this.settings = settings; this.rpc = new BitcoinRpcClient(settings);
        this.outboundPreferences.optional_outbound = settings.outbound_enabled_override === true;
    }
    start() { this.started = true; }
    stop() { this.stopped = true; }
    setGeoipDbOnly(enabled: boolean) { return this.dbOnly = enabled; }
    setGeoipAutoUpdate(enabled: boolean) { return this.autoUpdate = enabled; }
    setOutboundPreference(preference: OutboundPreference, enabled: boolean) { this.outboundPreferences[preference] = enabled; return this.outbound.snapshot(); }
    outbound = { snapshot: () => {
        const preferences = { ...this.outboundPreferences }, enabled = this.settings.outbound_enabled_override !== false && preferences.optional_outbound;
        return { preferences, effective: { geoip_lookups: enabled && !this.dbOnly, dataset_downloads: enabled && preferences.geoip_dataset_downloads && this.settings.geoip_enabled,
            release_checks: enabled && preferences.release_checks, reachability_probes: enabled && preferences.reachability_checks },
            forced_disabled: this.settings.outbound_enabled_override === false, provider: { name: 'ip-api' as const, transport: 'http' as const } };
    } };
    peers = {
        listPeers: () => structuredClone(fixtures.peers),
        snapshot: () => ({ peers: this.peers.listPeers(), status: { connected: true, last_success_at: Date.now() / 1000, last_attempt_at: Date.now() / 1000, age_seconds: 0, error: null, stale_after_seconds: 30 } }),
    };
    metrics = {
        summary: async () => structuredClone(fixtures.metrics),
        latest: () => ({ ...fixtures.metrics, ts: Date.now() / 1000 }),
    };
    updates = {
        snapshot: () => ({ update_available: false, latest_version: null, changes_url: null, checked_at: Date.now() / 1000, check_failed: false }),
    };
    connectivity = {
        snapshot: (): ConnectivityStatus => ({ internet_state: this.outbound.snapshot().effective.reachability_probes ? 'green' : 'disabled', api_available: this.outbound.snapshot().effective.geoip_lookups, api_consecutive_failures: 0, geo_db_only_mode: this.dbOnly, api_down_prompt: false,
            providers: Object.fromEntries(['geoip'].map(provider => [provider, { state: this.outbound.snapshot().effective.geoip_lookups ? 'healthy' : 'disabled', consecutive_failures: 0, last_error: null, last_success_at: Date.now() / 1000, last_failure_at: null, retry_at: null }])) as ConnectivityStatus['providers'] }),
        acknowledgePrompt() {},
    };
    geoDatabase = { update: async () => this.outbound.snapshot().effective.dataset_downloads ? ({ success: true, message: 'DB already up to date', added_rows: 0, updated_rows: 0, skipped_rows: 0 }) : ({ success: false, message: 'Optional dataset downloads are disabled', skipped_rows: 0 }) };
    node = {
        dashboardInfo: async (): Promise<DashboardInfo> => {
            const info = structuredClone(fixtures.info);
            info.bitcoin_network = { chain: this.settings.bitcoin_network, ...BITCOIN_NETWORKS[this.settings.bitcoin_network] };
            if (info.last_block) info.last_block.time = Math.floor(Date.now() / 1000) - 600;
            info.geo_db_stats.auto_update = this.autoUpdate;
            info.geo_db_stats.db_only_mode = this.dbOnly;
            info.geo_db_only_mode = this.dbOnly;
            const connectivity = this.connectivity.snapshot();
            info.internet_state = connectivity.internet_state; info.api_available = connectivity.api_available; info.providers = connectivity.providers;
            return info;
        },
        mempool: async () => structuredClone(fixtures.mempool),
        blockchain: async () => structuredClone(fixtures.blockchain),
        recentBlocks: async (limit = 25) => { const value = structuredClone(fixtures.blocks); value.blocks = value.blocks.slice(0, limit); return value; },
        chainTips: async () => structuredClone(fixtures.tips),
        connect: async (address: string) => ({ success: true, address }),
        disconnect: async () => ({ success: true }),
        ban: async () => ({ success: true }),
        unban: async () => ({ success: true }),
        bans: async () => ({ success: true, bans: [] }),
        clearBans: async () => ({ success: true }),
    };
}
export const FIXTURE_ADMIN_TOKEN = 'bpm-test-admin-token-'.padEnd(64, 'x');
export function fixtureSettings(dataDir = '/tmp/bpm-layout-test', adminToken = FIXTURE_ADMIN_TOKEN) {
    return loadSettings({ BITCOIN_RPC_HOST: 'bitcoin', BITCOIN_RPC_USER: 'bpm', BITCOIN_RPC_PASSWORD: 'secret', BPM_DATA_DIR: dataDir, BPM_BUILD_REVISION: 'abcdef0123456789', BPM_ADMIN_TOKEN: adminToken, BPM_VIEW_MODE: 'public', BPM_OUTBOUND_ENABLED: 'true' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const settings = fixtureSettings(process.env.BPM_LAYOUT_TEST_DATA_DIR, process.env.BPM_LAYOUT_ADMIN_TOKEN);
    const app = createApplication(settings, new FixtureRuntime(settings));
    await app.listen(Number(process.env.BPM_LAYOUT_TEST_PORT || 58991), process.env.BPM_LAYOUT_TEST_HOST || '127.0.0.1');
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close(); });
}
