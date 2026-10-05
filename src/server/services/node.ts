import { formatBytes, normalizePeerAddress, splitPeerAddress, networkType } from '../network.ts';
import { type Data, type Rpc, object, errorMessage, nowSeconds, round } from '../types.ts';
import { CachedRequest, Lru } from '../tasks.ts';
import type { ConnectivityService } from './connectivity.ts';
import type { GeoDatabase } from './geoip.ts';
import { parsePeerInfo, parseNetworkInfo, parseBlockchainInfo, parseBlockHeader, parseBlock, parseMempoolInfo, parseChainTips, type NetworkInfo, type BlockchainInfo, type BlockHeader } from '../rpc-types.ts';
import { NodeMetrics } from './node-metrics.ts';
import type { DashboardDetails, DashboardInfo, RecentBlock, RecentBlocks, ChainTip, ChainTips, NetworkSummary, NetworkScores } from '../api-types.ts';
import { createFailureReporter, createLogger } from '../logging.ts';

const log = createLogger('node');

export const CHAIN_TIP_HEADER_LIMIT = 100;
export class NodeService {
    readonly rpc: Rpc;
    readonly connectivity: Pick<ConnectivityService, 'snapshot'>;
    readonly geoDatabase: Pick<GeoDatabase, 'stats' | 'enabled'>;
    readonly autoUpdateEnabled: () => boolean;
    readonly metrics: NodeMetrics;
    private dashboardCache = new CachedRequest<DashboardDetails>(5000);
    private headers = new Lru<BlockHeader>(256);
    private blocks = new Lru<RecentBlock & { previous_hash: string }>(256);
    private pendingHeaders = new Map<string, Promise<BlockHeader>>();
    private pendingBlocks = new Map<string, Promise<RecentBlock & { previous_hash: string }>>();
    private blockchainFailures = createFailureReporter(log);
    private blockFailures = createFailureReporter(log);
    private networkFailures = createFailureReporter(log);
    private mempoolFailures = createFailureReporter(log);
    constructor(rpc: Rpc, connectivity: NodeService['connectivity'], geoDatabase: NodeService['geoDatabase'], autoUpdateEnabled: () => boolean) {
        this.rpc = rpc; this.connectivity = connectivity; this.geoDatabase = geoDatabase; this.autoUpdateEnabled = autoUpdateEnabled;
        this.metrics = new NodeMetrics(rpc);
    }
    async dashboardInfo(): Promise<DashboardInfo> {
        const cached = structuredClone(await this.dashboardCache.get(() => this.refreshDashboard()));
        const connectivity = this.connectivity.snapshot();
        const stats = this.geoDatabase.stats();
        if (stats.entries) {
            const now = nowSeconds();
            stats.oldest_age_days = typeof stats.oldest_updated === 'number' && stats.oldest_updated ? Math.trunc((now - stats.oldest_updated) / 86400) : null;
            stats.newest_age_days = typeof stats.last_updated === 'number' && stats.last_updated ? Math.trunc((now - stats.last_updated) / 86400) : null;
            stats.newest_age_seconds = typeof stats.last_updated === 'number' && stats.last_updated ? Math.trunc(now - stats.last_updated) : null;
        }
        return { ...cached, internet_state: connectivity.internet_state, api_available: connectivity.api_available, geo_db_only_mode: connectivity.geo_db_only_mode,
            geo_db_stats: { ...stats, auto_lookup: this.geoDatabase.enabled, auto_update: this.autoUpdateEnabled(), db_only_mode: connectivity.geo_db_only_mode } };
    }
    private async header(hash: string) {
        const cached = this.headers.get(hash);
        if (cached) return cached;
        let pending = this.pendingHeaders.get(hash);
        if (!pending) {
            pending = this.rpc.call('getblockheader', [hash], 10).then(value => {
                return this.headers.set(hash, parseBlockHeader(value));
            }).finally(() => this.pendingHeaders.delete(hash));
            this.pendingHeaders.set(hash, pending);
        }
        return pending;
    }
    private async refreshDashboard(): Promise<DashboardDetails> {
        const [blockchain, network, metrics, mempoolSize] = await Promise.all([
            this.blockchainDetails(),
            this.networkDetails(),
            this.metrics.summary(),
            this.mempoolSize(),
        ]);
        const traffic = metrics.download_bytes === null || metrics.upload_bytes === null ? null : {
            download_bytes: metrics.download_bytes, upload_bytes: metrics.upload_bytes,
            download_fmt: formatBytes(metrics.download_bytes), upload_fmt: formatBytes(metrics.upload_bytes),
        };
        return { ...blockchain, ...network, node_traffic: traffic, node_metrics: metrics, mempool_size: mempoolSize };
    }
    private async blockchainDetails(): Promise<Pick<DashboardDetails, 'blockchain' | 'last_block'>> {
        const result: Pick<DashboardDetails, 'blockchain' | 'last_block'> = { blockchain: null, last_block: null };
        let blockchain: BlockchainInfo | null = null;
        try {
            blockchain = parseBlockchainInfo(await this.rpc.call('getblockchaininfo', [], 10));
            let indexed = false;
            try { const indexes = await this.rpc.call('getindexinfo', [], 10); indexed = object(indexes) && 'txindex' in indexes; } catch { /* Optional RPC. */ }
            result.blockchain = { size_gb: round((blockchain.size_on_disk || 0) / 1e9, 1), pruned: blockchain.pruned ?? false, indexed, ibd: blockchain.initialblockdownload ?? false };
            this.blockchainFailures.recovered('Blockchain details recovered');
        } catch (error) { this.blockchainFailures.failure(`Could not load blockchain details: ${errorMessage(error)}`); }
        try {
            const hash = blockchain?.bestblockhash || await this.rpc.call('getbestblockhash', [], 10);
            if (typeof hash !== 'string' || !hash) throw new Error('getbestblockhash returned an unexpected response');
            const header = await this.header(hash);
            result.last_block = { height: blockchain?.blocks ?? header.height ?? 0, time: header.time ?? 0 };
            this.blockFailures.recovered('Last block details recovered');
        } catch (error) { this.blockFailures.failure(`Could not load last block: ${errorMessage(error)}`); }
        return result;
    }
    private async networkDetails(): Promise<Pick<DashboardDetails, 'subversion' | 'connected' | 'services' | 'network_details' | 'network_scores'>> {
        const result: Pick<DashboardDetails, 'subversion' | 'connected' | 'services' | 'network_details' | 'network_scores'> = { subversion: null, connected: null, services: null, network_details: null, network_scores: null };
        try {
            const network = parseNetworkInfo(await this.rpc.call('getnetworkinfo', [], 10));
            result.subversion = network.subversion;
            result.connected = network.connections;
            result.services = network.localservicesnames;
            result.network_details = networkSummary(network);
            const scores: NetworkScores = { ipv4: null, ipv6: null };
            for (const address of network.localaddresses ?? []) {
                const host: string = address.address || '';
                if (host.endsWith('.onion') || host.endsWith('.i2p') || /^f[cd]/.test(host)) continue;
                const family = host.includes(':') ? 'ipv6' : 'ipv4', score = address.score ?? 0;
                if (scores[family] === null || score > scores[family]) scores[family] = score;
            }
            result.network_scores = network.localaddresses === null ? null : scores;
            this.networkFailures.recovered('Network details recovered');
        } catch (error) { this.networkFailures.failure(`Could not load network details: ${errorMessage(error)}`); }
        return result;
    }
    private async mempoolSize(): Promise<number | null> {
        try {
            const size = parseMempoolInfo(await this.rpc.call('getmempoolinfo', [], 10)).size ?? 0;
            this.mempoolFailures.recovered('Mempool details recovered');
            return size;
        } catch (error) {
            this.mempoolFailures.failure(`Could not load mempool details: ${errorMessage(error)}`);
            return null;
        }
    }
    async mempool(): Promise<Data> {
        const result: Data = { mempool: null, error: null };
        try { result.mempool = parseMempoolInfo(await this.rpc.call('getmempoolinfo')); } catch (error) { result.error = errorMessage(error); }
        return result;
    }
    async blockchain(): Promise<Data> {
        try { return { blockchain: parseBlockchainInfo(await this.rpc.call('getblockchaininfo')), error: null }; }
        catch (error) { return { blockchain: null, error: errorMessage(error) }; }
    }
    private async recentBlock(hash: string, expectedHeight: number): Promise<RecentBlock & { previous_hash: string }> {
        const cached = this.blocks.get(hash);
        if (cached) return cached;
        let pending = this.pendingBlocks.get(hash);
        if (!pending) {
            pending = this.rpc.call('getblock', [hash, 1], 10).then(value => {
                const block = parseBlock(value);
                const height = Number(block.height ?? expectedHeight);
                if (height !== expectedHeight) throw new Error(`getblock returned height ${height} while traversing height ${expectedHeight}`);
                const size = Number(block.size || 0);
                return this.blocks.set(hash, { height, hash, time: Number(block.time || 0), size, size_mb: round(size / 1e6, 3), weight: Number(block.weight || 0), tx_count: Number(block.nTx ?? (Array.isArray(block.tx) ? block.tx.length : 0)), version: block.version ?? null, difficulty: block.difficulty ?? null, previous_hash: String(block.previousblockhash || '') });
            }).finally(() => this.pendingBlocks.delete(hash));
            this.pendingBlocks.set(hash, pending);
        }
        return pending;
    }
    async recentBlocks(limit = 25): Promise<RecentBlocks> {
        limit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 25;
        try {
            const blockchain = parseBlockchainInfo(await this.rpc.call('getblockchaininfo', [], 10));
            const height = Number(blockchain.blocks || 0);
            let hash = blockchain.bestblockhash;
            if (typeof hash !== 'string' || !hash) throw new Error('getblockchaininfo did not return bestblockhash');
            const cached: (RecentBlock & { previous_hash: string })[] = [];
            for (let offset = 0; offset < Math.min(limit, height + 1); offset++) {
                const block = await this.recentBlock(hash, height - offset);
                cached.push(block);
                if (height - offset > 0) {
                    hash = block.previous_hash;
                    if (!hash) throw new Error(`getblock did not return previousblockhash at height ${height - offset}`);
                }
            }
            const generatedAt = Math.floor(nowSeconds());
            const blocks: RecentBlock[] = cached.map(({ previous_hash, ...block }) => ({ ...block, age_seconds: block.time ? Math.max(0, generatedAt - block.time) : null }));
            const count = blocks.length;
            const totalSize = blocks.reduce((sum, block) => sum + block.size, 0), transactions = blocks.reduce((sum, block) => sum + block.tx_count, 0);
            return { success: true, blocks, error: null, summary: { chain: blockchain.chain ?? null, tip_height: height, count, latest_time: blocks[0]?.time ?? null, total_size: totalSize, avg_size_mb: count ? round(totalSize / count / 1e6, 3) : 0, total_transactions: transactions, avg_transactions: count ? round(transactions / count, 1) : 0, generated_at: generatedAt } };
        } catch (error) { return { success: false, summary: null, blocks: [], error: errorMessage(error) }; }
    }
    async chainTips(): Promise<ChainTips> {
        try {
            const tips = parseChainTips(await this.rpc.call('getchaintips', [], 10));
            let blockchain: BlockchainInfo | null = null;
            try { blockchain = parseBlockchainInfo(await this.rpc.call('getblockchaininfo', [], 10)); } catch { /* Tip data remains usable. */ }
            const counts: Record<string, number> = {};
            const normalized: ChainTip[] = tips.map(tip => {
                const status = String(tip.status || 'unknown').toLowerCase(); counts[status] = (counts[status] || 0) + 1;
                return { height: Number(tip.height || 0), hash: String(tip.hash || ''), branch_length: Number(tip.branchlen || 0), status, status_label: status.replaceAll('-', ' ').replace(/\b\w/g, value => value.toUpperCase()), time: null, age_seconds: null, is_active: status === 'active' };
            });
            const priorities: Record<string, number> = { active: 0, 'valid-fork': 1, 'valid-headers': 2, 'headers-only': 3, invalid: 4 };
            normalized.sort((a, b) => (priorities[a.status] ?? 5) - (priorities[b.status] ?? 5) || b.height - a.height || b.branch_length - a.branch_length);
            const candidates = normalized.filter(tip => tip.hash);
            for (const tip of candidates.slice(0, CHAIN_TIP_HEADER_LIMIT)) {
                try { tip.time = Number((this.blocks.get(tip.hash) || await this.header(tip.hash)).time || 0); } catch { /* Unknown ages are explicitly null. */ }
            }
            const generatedAt = Math.floor(nowSeconds());
            for (const tip of normalized) tip.age_seconds = tip.time ? Math.max(0, generatedAt - tip.time) : null;
            const active = normalized.find(tip => tip.is_active);
            const nonActive = normalized.filter(tip => !tip.is_active);
            const latest = [...nonActive].sort((a, b) => b.height - a.height)[0];
            return { success: true, tips: normalized, error: null, summary: {
                chain: blockchain?.chain ?? null, best_height: blockchain?.blocks ?? active?.height ?? null,
                best_hash: blockchain?.bestblockhash || active?.hash || null, total: normalized.length,
                active_count: counts.active || 0, non_active_count: nonActive.length,
                fork_count: counts['valid-fork'] || 0, headers_only_count: counts['headers-only'] || 0,
                latest_non_active_height: latest?.height ?? null, latest_non_active_status: latest?.status ?? null,
                counts_by_status: counts, age_lookup_limited: candidates.length > CHAIN_TIP_HEADER_LIMIT,
                age_lookup_limit: CHAIN_TIP_HEADER_LIMIT, generated_at: generatedAt,
            } };
        } catch (error) { return { success: false, summary: null, tips: [], error: errorMessage(error) }; }
    }
    async connect(address: string): Promise<Data> {
        try { const normalized = normalizePeerAddress(address); await this.rpc.call('addnode', [normalized, 'onetry']); return { success: true, address: normalized }; }
        catch (error) { return { success: false, error: errorMessage(error) }; }
    }
    async disconnect(id: number | null): Promise<Data> {
        if (id === null) return { success: false, error: 'peer_id is required' };
        try { await this.rpc.call('disconnectnode', ['', id]); return { success: true }; }
        catch (error) { return { success: false, error: errorMessage(error) }; }
    }
    async ban(id: number | null): Promise<Data> {
        if (id === null) return { success: false, error: 'peer_id is required' };
        try {
            const peers = parsePeerInfo(await this.rpc.call('getpeerinfo'));
            const peer = peers.find(peer => peer.id === id);
            if (!peer) return { success: false, error: `Peer ID ${id} not found` };
            const network = peer.network ?? networkType(peer.addr);
            if (!['ipv4', 'ipv6'].includes(network)) return { success: false, error: `Cannot ban ${network.toUpperCase()} peers; only IPv4 and IPv6 addresses can be banned` };
            const [host] = splitPeerAddress(peer.addr || '');
            await this.rpc.call('setban', [host, 'add', 86400]);
            return { success: true, banned_ip: host, network };
        } catch (error) { return { success: false, error: errorMessage(error) }; }
    }
    async unban(address: string): Promise<Data> {
        if (!address) return { success: false, error: 'address is required' };
        try { await this.rpc.call('setban', [address, 'remove']); return { success: true }; }
        catch (error) { return { success: false, error: errorMessage(error) }; }
    }
    async bans(): Promise<Data> {
        try { return { success: true, bans: await this.rpc.call('listbanned') }; }
        catch (error) { return { success: false, bans: [], error: errorMessage(error) }; }
    }
    async clearBans(): Promise<Data> {
        try { await this.rpc.call('clearbanned'); return { success: true }; }
        catch (error) { return { success: false, error: errorMessage(error) }; }
    }
}

export function networkSummary(network: Pick<NetworkInfo, 'networks' | 'localaddresses'>): NetworkSummary | null {
    if (network.networks === null || network.localaddresses === null) return null;
    const details: NetworkSummary = { ipv4: emptyNetwork(), ipv6: emptyNetwork(), onion: emptyNetwork(), i2p: emptyNetwork(), cjdns: emptyNetwork() };
    for (const item of network.networks) {
        const key = String(item.name || '').toLowerCase();
        if (Object.hasOwn(details, key)) Object.assign(details[key as keyof NetworkSummary], { reachable: item.reachable ?? false, limited: item.limited ?? true, proxy: item.proxy ?? '' });
    }
    for (const item of network.localaddresses) {
        const address = String(item.address || '').trim(), lower = address.toLowerCase();
        if (!address) continue;
        const key = lower.endsWith('.onion') ? 'onion' : lower.endsWith('.i2p') ? 'i2p' : /^f[cd].*:/.test(lower) ? 'cjdns' : address.includes(':') ? 'ipv6' : 'ipv4';
        details[key].localaddresses.push({ address, port: item.port ?? null, score: item.score ?? 0 });
    }
    for (const detail of Object.values(details)) detail.localaddresses.sort((a, b) => b.score - a.score);
    return details;
}
const emptyNetwork = (): NetworkSummary['ipv4'] => ({ reachable: false, limited: true, proxy: '', localaddresses: [] });
