import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createApplication, type ApplicationRuntime } from '../src/server/app.ts';
import { loadSettings, type Settings } from '../src/server/settings.ts';
import { BitcoinRpcClient } from '../src/server/rpc.ts';
import type { Data } from '../src/server/types.ts';
import type { NodeMetricsSnapshot } from '../src/server/services/node-metrics.ts';
import type { DashboardInfo, RecentBlocks, ChainTips } from '../src/server/api-types.ts';
import type { ConnectivityStatus } from '../src/server/services/connectivity.ts';

// Captured API fixtures keep browser regressions independent of external services.
const fixtures: { peers: Data[]; metrics: NodeMetricsSnapshot; info: DashboardInfo; mempool: Data; blockchain: Data; blocks: RecentBlocks; tips: ChainTips } = JSON.parse(readFileSync(new URL('./fixtures/dashboard.json', import.meta.url), 'utf8'));
export class FixtureRuntime implements ApplicationRuntime {
    readonly settings: Settings;
    readonly rpc: BitcoinRpcClient;
    started = false;
    stopped = false;
    private dbOnly = false;
    private autoUpdate = false;
    constructor(settings: Settings) { this.settings = settings; this.rpc = new BitcoinRpcClient(settings); }
    start() { this.started = true; }
    stop() { this.stopped = true; }
    toggleGeoipApi() { return this.dbOnly = !this.dbOnly; }
    toggleGeoipAutoUpdate() { return this.autoUpdate = !this.autoUpdate; }
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
        snapshot: (): ConnectivityStatus => ({ internet_state: 'green', api_available: true, api_consecutive_failures: 0, geo_db_only_mode: this.dbOnly, api_down_prompt: false,
            providers: Object.fromEntries(['geoip'].map(provider => [provider, { state: 'healthy', consecutive_failures: 0, last_error: null, last_success_at: Date.now() / 1000, last_failure_at: null, retry_at: null }])) as ConnectivityStatus['providers'] }),
        acknowledgePrompt() {},
    };
    geoDatabase = { update: async () => ({ success: true, message: 'DB already up to date' }) };
    node = {
        dashboardInfo: async (): Promise<DashboardInfo> => {
            const info = structuredClone(fixtures.info);
            if (info.last_block) info.last_block.time = Math.floor(Date.now() / 1000) - 600;
            info.geo_db_stats.auto_update = this.autoUpdate;
            info.geo_db_stats.db_only_mode = this.dbOnly;
            info.geo_db_only_mode = this.dbOnly;
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
export function fixtureSettings(dataDir = '/tmp/bpm-layout-test') {
    return loadSettings({ BITCOIN_RPC_HOST: 'bitcoin', BITCOIN_RPC_USER: 'bpm', BITCOIN_RPC_PASSWORD: 'secret', BPM_DATA_DIR: dataDir, BPM_BUILD_REVISION: 'abcdef0123456789' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const settings = fixtureSettings(process.env.BPM_LAYOUT_TEST_DATA_DIR);
    const app = createApplication(settings, new FixtureRuntime(settings));
    await app.listen(Number(process.env.BPM_LAYOUT_TEST_PORT || 58991), process.env.BPM_LAYOUT_TEST_HOST || '127.0.0.1');
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close(); });
}
