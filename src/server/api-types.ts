/** HTTP contracts are generated from OpenAPI; service-only projections stay local. */
import type { DashboardInfo as ApiDashboardInfo } from '../shared/api.generated.d.ts';
export type {
    NetworkFamily, NetworkSummary, NetworkScores, Peer, PeerSnapshot, PeerStatus,
    GeoMetadata, GeoStats, GeoDatabaseStats, GeoUpdateResponse, ActionResponse,
    BansResponse, MempoolResponse, BlockchainResponse, NodeMetrics,
    RecentBlock, RecentBlocksResponse as RecentBlocks, ChainTip, ChainTipsResponse as ChainTips,
} from '../shared/api.generated.d.ts';

/** Update status is composed by the HTTP layer, not the RPC node service. */
export type DashboardInfo = Omit<ApiDashboardInfo, 'updates'>;
export type DashboardDetails = Pick<DashboardInfo,
    'blockchain' | 'last_block' | 'subversion' | 'connected' | 'services'
    | 'network_details' | 'network_scores' | 'node_traffic' | 'node_metrics' | 'mempool_size'>;
