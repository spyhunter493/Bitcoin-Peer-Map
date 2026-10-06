import type { Data } from './types.ts';
import type { ConnectivityStatus } from './services/connectivity.ts';
import type { NodeMetricsSnapshot } from './services/node-metrics.ts';
import type { BitcoinNetwork } from './network.ts';

export type NetworkFamily = 'ipv4' | 'ipv6' | 'onion' | 'i2p' | 'cjdns';
export type NetworkSummary = Record<NetworkFamily, {
    reachable: boolean; limited: boolean; proxy: string;
    localaddresses: { address: string; port: number | null; score: number }[];
}>;
export type NetworkScores = { ipv4: number | null; ipv6: number | null };
export interface DashboardDetails extends Data {
    blockchain: { size_gb: number; pruned: boolean; indexed: boolean; ibd: boolean | null; txindex_status: 'disabled' | 'syncing' | 'ready' | 'unknown'; txindex_height: number | null } | null;
    last_block: { height: number; time: number } | null;
    subversion: string | null; connected: number | null; services: string[] | null;
    network_details: NetworkSummary | null; network_scores: NetworkScores | null;
    node_traffic: { download_bytes: number; upload_bytes: number; download_fmt: string; upload_fmt: string } | null;
    node_metrics: NodeMetricsSnapshot;
    mempool_size: number | null;
}
export interface DashboardInfo extends DashboardDetails {
    bitcoin_network: BitcoinNetwork;
    internet_state: ConnectivityStatus['internet_state']; api_available: boolean; geo_db_only_mode: boolean;
    providers: ConnectivityStatus['providers'];
    geo_db_stats: Data;
}
export interface RecentBlock extends Data {
    height: number; hash: string; time: number; size: number; size_mb: number;
    weight: number; tx_count: number; version: number | null; difficulty: number | null;
    age_seconds?: number | null;
}
export interface RecentBlocks extends Data {
    success: boolean; blocks: RecentBlock[]; error: string | null;
    summary: { chain: string | null; tip_height: number; count: number; latest_time: number | null;
        total_size: number; avg_size_mb: number; total_transactions: number; avg_transactions: number; generated_at: number } | null;
}
export interface ChainTip extends Data {
    height: number; hash: string; branch_length: number; status: string; status_label: string;
    time: number | null; age_seconds: number | null; is_active: boolean;
}
export interface ChainTips extends Data {
    success: boolean; tips: ChainTip[]; error: string | null;
    summary: { chain: string | null; best_height: number | null; best_hash: string | null; total: number;
        active_count: number; non_active_count: number; fork_count: number; headers_only_count: number;
        latest_non_active_height: number | null; latest_non_active_status: string | null;
        counts_by_status: Record<string, number>; age_lookup_limited: boolean; age_lookup_limit: number; age_lookup_timed_out: boolean; generated_at: number } | null;
}
