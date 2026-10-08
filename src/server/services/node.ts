import { BITCOIN_NETWORKS, type BitcoinChain, formatBytes, normalizePeerAddress, splitPeerAddress, networkType } from '../network.ts';
import { type Rpc, errorMessage, nowSeconds, round } from '../types.ts';
import { Lru } from '../tasks.ts';
import { SharedRead, KeyedSharedReads, readDeadline } from '../shared-read.ts';
import { RpcBusyError } from '../rpc.ts';
import type { ConnectivityService } from './connectivity.ts';
import type { GeoDatabase } from './geoip.ts';
import { parsePeerInfo, parseNetworkInfo, parseBlockchainInfo, parseBlockHeader, parseBlock, parseMempoolInfo, parseChainTips, parseTxIndex, RpcValidationError, type TxIndexDetails, type NetworkInfo, type BlockchainInfo, type BlockHeader } from '../rpc-types.ts';
import { NodeMetrics } from './node-metrics.ts';
import type { DashboardDetails, DashboardInfo, RecentBlock, RecentBlocks, ChainTip, ChainTips, NetworkSummary, NetworkScores, MempoolResponse, BlockchainResponse, ActionResponse, BansResponse } from '../api-types.ts';
import { createFailureReporter, createLogger } from '../logging.ts';

type CachedBlock = Omit<RecentBlock, 'age_seconds'> & { previous_hash: string };
const log = createLogger('node');

export const CHAIN_TIP_HEADER_LIMIT = 100;
export const CHAIN_TIP_TIMEOUT_MS = 15_000;
export const CHAIN_TIP_AGE_TIMEOUT_MS = 5000;
export const CHAIN_TIP_WORKERS = 4;
export class NodeService {
    readonly rpc: Rpc;
    readonly connectivity: Pick<ConnectivityService, 'snapshot'>;
    readonly geoDatabase: Pick<GeoDatabase, 'stats' | 'enabled'>;
    readonly autoUpdateEnabled: () => boolean;
    readonly metrics: NodeMetrics;
    readonly chain: BitcoinChain;
    private dashboardCache = new SharedRead<DashboardDetails>(5000);
    private blockchainCache = new SharedRead<BlockchainInfo>(5000);
    private mempoolCache = new SharedRead<ReturnType<typeof parseMempoolInfo>>(5000);
    private bansCache = new SharedRead<unknown>(5000);
    private tipCache = new SharedRead<ReturnType<typeof parseChainTips>>(5000);
    private indexCache = new SharedRead<TxIndexDetails>(5000);
    private chainTipsCache = new SharedRead<ChainTips>(5000, 1000, { fromCompletion: true });
    private headers = new Lru<BlockHeader>(256);
    private blocks = new Lru<CachedBlock>(256);
    private headerReads = new KeyedSharedReads<string, BlockHeader>();
    private blockReads = new KeyedSharedReads<string, CachedBlock>();
    private blockchainFailures = createFailureReporter(log);
    private blockFailures = createFailureReporter(log);
    private networkFailures = createFailureReporter(log);
    private mempoolFailures = createFailureReporter(log);
    constructor(rpc: Rpc, connectivity: NodeService['connectivity'], geoDatabase: NodeService['geoDatabase'], autoUpdateEnabled: () => boolean, chain: BitcoinChain = 'main') {
        this.rpc = rpc; this.connectivity = connectivity; this.geoDatabase = geoDatabase; this.autoUpdateEnabled = autoUpdateEnabled;
        this.metrics = new NodeMetrics(rpc);
        this.chain = chain;
    }
    async dashboardInfo(signal?: AbortSignal): Promise<DashboardInfo> {
        const cached = await this.dashboardCache.get(signal => this.refreshDashboard(signal), signal);
        const connectivity = this.connectivity.snapshot();
        const stats: ReturnType<typeof this.geoDatabase.stats> & Partial<Pick<DashboardInfo['geo_db_stats'], 'oldest_age_days' | 'newest_age_days' | 'newest_age_seconds'>> = this.geoDatabase.stats();
        if (stats.entries) {
            const now = nowSeconds();
            stats.oldest_age_days = typeof stats.oldest_updated === 'number' && stats.oldest_updated ? Math.trunc((now - stats.oldest_updated) / 86400) : null;
            stats.newest_age_days = typeof stats.last_updated === 'number' && stats.last_updated ? Math.trunc((now - stats.last_updated) / 86400) : null;
            stats.newest_age_seconds = typeof stats.last_updated === 'number' && stats.last_updated ? Math.trunc(now - stats.last_updated) : null;
        }
        return { ...cached, bitcoin_network: { chain: this.chain, ...BITCOIN_NETWORKS[this.chain] }, internet_state: connectivity.internet_state, api_available: connectivity.api_available, geo_db_only_mode: connectivity.geo_db_only_mode, providers: connectivity.providers,
            geo_db_stats: { ...stats, auto_lookup: this.geoDatabase.enabled, auto_update: this.autoUpdateEnabled(), db_only_mode: connectivity.geo_db_only_mode } };
    }
    private readBlockchain(signal?: AbortSignal) {
        return this.blockchainCache.get(signal => this.rpc.call('getblockchaininfo', [], 10, signal).then(parseBlockchainInfo), signal);
    }
    private readMempool(signal?: AbortSignal) {
        return this.mempoolCache.get(signal => this.rpc.call('getmempoolinfo', [], 10, signal).then(parseMempoolInfo), signal);
    }
    private async header(hash: string, signal?: AbortSignal) {
        signal?.throwIfAborted();
        const cached = this.headers.get(hash);
        if (cached) return cached;
        return this.headerReads.get(hash, signal => this.rpc.call('getblockheader', [hash], 10, signal).then(value => {
            const header = parseBlockHeader(value);
            if (!signal.aborted) this.headers.set(hash, header);
            return header;
        }), signal);
    }
    private async refreshDashboard(signal: AbortSignal): Promise<DashboardDetails> {
        const [blockchain, network, metrics, mempoolSize] = await Promise.all([
            this.blockchainDetails(signal),
            this.networkDetails(signal),
            this.metrics.summary(),
            this.mempoolSize(signal),
        ]);
        const traffic = metrics.download_bytes === null || metrics.upload_bytes === null ? null : {
            download_bytes: metrics.download_bytes, upload_bytes: metrics.upload_bytes,
            download_fmt: formatBytes(metrics.download_bytes), upload_fmt: formatBytes(metrics.upload_bytes),
        };
        return { ...blockchain, ...network, node_traffic: traffic, node_metrics: metrics, mempool_size: mempoolSize };
    }
    private async blockchainDetails(signal: AbortSignal): Promise<Pick<DashboardDetails, 'blockchain' | 'last_block'>> {
        const result: Pick<DashboardDetails, 'blockchain' | 'last_block'> = { blockchain: null, last_block: null };
        let blockchain: BlockchainInfo | null = null;
        try {
            blockchain = await this.readBlockchain(signal);
            let index: TxIndexDetails = { status: 'unknown', height: null };
            try { index = await this.indexCache.get(signal => this.rpc.call('getindexinfo', [], 10, signal).then(value => {
                const index = parseTxIndex(value);
                if (index.status === 'unknown') throw new RpcValidationError('getindexinfo returned an unexpected response');
                return index;
            }), signal); }
            catch (error) { if (error instanceof RpcBusyError || signal.aborted) throw error; }
            result.blockchain = { size_gb: round((blockchain.size_on_disk || 0) / 1e9, 1), pruned: blockchain.pruned ?? false,
                indexed: ['ready', 'syncing'].includes(index.status), ibd: blockchain.initialblockdownload ?? null, txindex_status: index.status, txindex_height: index.height };
            this.blockchainFailures.recovered('Blockchain details recovered');
        } catch (error) { if (error instanceof RpcBusyError || signal.aborted) throw error; this.blockchainFailures.failure(`Could not load blockchain details: ${errorMessage(error)}`); }
        try {
            const hash = blockchain?.bestblockhash || await this.rpc.call('getbestblockhash', [], 10, signal);
            if (typeof hash !== 'string' || !hash) throw new Error('getbestblockhash returned an unexpected response');
            const header = await this.header(hash, signal);
            result.last_block = { height: blockchain?.blocks ?? header.height ?? 0, time: header.time ?? 0 };
            this.blockFailures.recovered('Last block details recovered');
        } catch (error) { if (error instanceof RpcBusyError || signal.aborted) throw error; this.blockFailures.failure(`Could not load last block: ${errorMessage(error)}`); }
        return result;
    }
    private async networkDetails(signal: AbortSignal): Promise<Pick<DashboardDetails, 'subversion' | 'connected' | 'services' | 'network_details' | 'network_scores'>> {
        const result: Pick<DashboardDetails, 'subversion' | 'connected' | 'services' | 'network_details' | 'network_scores'> = { subversion: null, connected: null, services: null, network_details: null, network_scores: null };
        try {
            const network = parseNetworkInfo(await this.rpc.call('getnetworkinfo', [], 10, signal));
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
        } catch (error) { if (error instanceof RpcBusyError || signal.aborted) throw error; this.networkFailures.failure(`Could not load network details: ${errorMessage(error)}`); }
        return result;
    }
    private async mempoolSize(signal: AbortSignal): Promise<number | null> {
        try {
            const size = (await this.readMempool(signal)).size ?? 0;
            this.mempoolFailures.recovered('Mempool details recovered');
            return size;
        } catch (error) {
            if (error instanceof RpcBusyError || signal.aborted) throw error;
            this.mempoolFailures.failure(`Could not load mempool details: ${errorMessage(error)}`);
            return null;
        }
    }
    async mempool(signal?: AbortSignal): Promise<MempoolResponse> {
        const result: MempoolResponse = { mempool: null, error: null };
        try { result.mempool = await this.readMempool(signal); } catch (error) { if (error instanceof RpcBusyError || signal?.aborted) throw error; result.error = errorMessage(error); }
        return result;
    }
    async blockchain(signal?: AbortSignal): Promise<BlockchainResponse> {
        try { return { blockchain: await this.readBlockchain(signal), error: null }; }
        catch (error) { if (error instanceof RpcBusyError || signal?.aborted) throw error; return { blockchain: null, error: errorMessage(error) }; }
    }
    private async recentBlock(hash: string, expectedHeight: number, signal?: AbortSignal): Promise<CachedBlock> {
        signal?.throwIfAborted();
        const cached = this.blocks.get(hash);
        if (cached) return cached;
        return this.blockReads.get(hash, signal => this.rpc.call('getblock', [hash, 1], 10, signal).then(value => {
            const block = parseBlock(value);
            const height = Number(block.height ?? expectedHeight);
            if (height !== expectedHeight) throw new Error(`getblock returned height ${height} while traversing height ${expectedHeight}`);
            const size = Number(block.size || 0);
            const result = { height, hash, time: Number(block.time || 0), size, size_mb: round(size / 1e6, 3), weight: Number(block.weight || 0), tx_count: Number(block.nTx ?? (Array.isArray(block.tx) ? block.tx.length : 0)), version: block.version ?? null, difficulty: block.difficulty ?? null, previous_hash: String(block.previousblockhash || '') };
            if (!signal.aborted) this.blocks.set(hash, result);
            return result;
        }), signal);
    }
    async recentBlocks(limit = 25, signal?: AbortSignal): Promise<RecentBlocks> {
        limit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 25;
        try {
            const blockchain = await this.readBlockchain(signal);
            const height = Number(blockchain.blocks || 0);
            let hash = blockchain.bestblockhash;
            if (typeof hash !== 'string' || !hash) throw new Error('getblockchaininfo did not return bestblockhash');
            const cached: CachedBlock[] = [];
            for (let offset = 0; offset < Math.min(limit, height + 1); offset++) {
                signal?.throwIfAborted();
                const block = await this.recentBlock(hash, height - offset, signal);
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
        } catch (error) { if (error instanceof RpcBusyError || signal?.aborted) throw error; return { success: false, summary: null, blocks: [], error: errorMessage(error) }; }
    }
    async chainTips(signal?: AbortSignal): Promise<ChainTips> {
        try {
            const result = await this.chainTipsCache.get(signal => this.loadChainTips(signal), signal);
            const generatedAt = Math.floor(nowSeconds());
            if (result.summary) result.summary.generated_at = generatedAt;
            for (const tip of result.tips) tip.age_seconds = tip.time ? Math.max(0, generatedAt - tip.time) : null;
            return result;
        } catch (error) { if (error instanceof RpcBusyError || signal?.aborted) throw error; return { success: false, summary: null, tips: [], error: errorMessage(error) }; }
    }
    private async loadChainTips(signal: AbortSignal): Promise<ChainTips> {
        const end = performance.now() + CHAIN_TIP_TIMEOUT_MS;
        const total = readDeadline(CHAIN_TIP_TIMEOUT_MS, signal);
        const source = readDeadline(10_000, total.signal);
        const metadata = readDeadline(5000, total.signal);
        try {
            const [tips, blockchain] = await Promise.all([
                this.tipCache.get(signal => this.rpc.call('getchaintips', [], 10, signal).then(parseChainTips), source.signal),
                this.readBlockchain(metadata.signal).catch(error => {
                    if (error instanceof RpcBusyError || signal.aborted) throw error;
                    return null;
                }),
            ]);
            const counts: Record<string, number> = {};
            const normalized: ChainTip[] = tips.map(tip => {
                const status = String(tip.status || 'unknown').toLowerCase(); counts[status] = (counts[status] || 0) + 1;
                return { height: Number(tip.height || 0), hash: String(tip.hash || ''), branch_length: Number(tip.branchlen || 0), status, status_label: status.replaceAll('-', ' ').replace(/\b\w/g, value => value.toUpperCase()), time: null, age_seconds: null, is_active: status === 'active' };
            });
            const priorities: Record<string, number> = { active: 0, 'valid-fork': 1, 'valid-headers': 2, 'headers-only': 3, invalid: 4 };
            normalized.sort((a, b) => (priorities[a.status] ?? 5) - (priorities[b.status] ?? 5) || b.height - a.height || b.branch_length - a.branch_length);
            const candidates = normalized.filter(tip => tip.hash);
            const selected = candidates.slice(0, CHAIN_TIP_HEADER_LIMIT);
            const ages = readDeadline(Math.min(CHAIN_TIP_AGE_TIMEOUT_MS, Math.max(0, end - performance.now())), total.signal);
            let next = 0, timedOut = false;
            try {
                await Promise.all(Array.from({ length: Math.min(CHAIN_TIP_WORKERS, selected.length) }, async () => {
                    while (next < selected.length && !ages.signal.aborted) {
                        signal.throwIfAborted();
                        const tip = selected[next++];
                        try { tip.time = Number((this.blocks.get(tip.hash) || await this.header(tip.hash, ages.signal)).time || 0); }
                        catch (error) { if (error instanceof RpcBusyError || signal.aborted) throw error; }
                    }
                }));
                timedOut = ages.signal.aborted;
                signal.throwIfAborted();
            } finally { ages.cancel(); ages.dispose(); }
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
                age_lookup_limit: CHAIN_TIP_HEADER_LIMIT, age_lookup_timed_out: timedOut, generated_at: generatedAt,
            } };
        } finally { source.cancel(); source.dispose(); metadata.cancel(); metadata.dispose(); total.cancel(); total.dispose(); }
    }
    async connect(address: string): Promise<ActionResponse> {
        try { const normalized = normalizePeerAddress(address, BITCOIN_NETWORKS[this.chain].default_peer_port); await this.rpc.call('addnode', [normalized, 'onetry']); this.dashboardCache.invalidate(); return { success: true, address: normalized }; }
        catch (error) { if (error instanceof RpcBusyError) throw error; return { success: false, error: errorMessage(error) }; }
    }
    async disconnect(id: number | null): Promise<ActionResponse> {
        if (id === null) return { success: false, error: 'peer_id is required' };
        try { await this.rpc.call('disconnectnode', ['', id]); this.dashboardCache.invalidate(); return { success: true }; }
        catch (error) { if (error instanceof RpcBusyError) throw error; return { success: false, error: errorMessage(error) }; }
    }
    async ban(id: number | null): Promise<ActionResponse> {
        if (id === null) return { success: false, error: 'peer_id is required' };
        try {
            const peers = parsePeerInfo(await this.rpc.call('getpeerinfo'));
            const peer = peers.find(peer => peer.id === id);
            if (!peer) return { success: false, error: `Peer ID ${id} not found` };
            const network = peer.network ?? networkType(peer.addr);
            if (!['ipv4', 'ipv6'].includes(network)) return { success: false, error: `Cannot ban ${network.toUpperCase()} peers; only IPv4 and IPv6 addresses can be banned` };
            const [host] = splitPeerAddress(peer.addr || '');
            await this.rpc.call('setban', [host, 'add', 86400]);
            this.bansCache.invalidate(); this.dashboardCache.invalidate();
            return { success: true, banned_ip: host, network };
        } catch (error) { if (error instanceof RpcBusyError) throw error; return { success: false, error: errorMessage(error) }; }
    }
    async unban(address: string): Promise<ActionResponse> {
        if (!address) return { success: false, error: 'address is required' };
        try { await this.rpc.call('setban', [address, 'remove']); this.bansCache.invalidate(); return { success: true }; }
        catch (error) { if (error instanceof RpcBusyError) throw error; return { success: false, error: errorMessage(error) }; }
    }
    async bans(signal?: AbortSignal): Promise<BansResponse> {
        try { return { success: true, bans: await this.bansCache.get(signal => this.rpc.call('listbanned', [], 10, signal), signal) }; }
        catch (error) { if (error instanceof RpcBusyError || signal?.aborted) throw error; return { success: false, bans: [], error: errorMessage(error) }; }
    }
    async clearBans(): Promise<ActionResponse> {
        try { await this.rpc.call('clearbanned'); this.bansCache.invalidate(); return { success: true }; }
        catch (error) { if (error instanceof RpcBusyError) throw error; return { success: false, error: errorMessage(error) }; }
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
