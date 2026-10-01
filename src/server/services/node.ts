import { formatBytes, normalizePeerAddress, splitPeerAddress } from '../network.ts';
import { type Data, type Rpc, object, errorMessage, nowSeconds, round } from '../types.ts';
import { CachedRequest, Lru } from '../tasks.ts';
import type { ConnectivityService } from './connectivity.ts';
import type { GeoDatabase } from './geoip.ts';

export const CHAIN_TIP_HEADER_LIMIT = 100;
export class NodeService {
    readonly rpc: Rpc;
    readonly connectivity: Pick<ConnectivityService, 'priceInfo' | 'fetchPrice' | 'snapshot'>;
    readonly geoDatabase: Pick<GeoDatabase, 'stats' | 'enabled'>;
    readonly autoUpdateEnabled: () => boolean;
    private dashboardCache = new CachedRequest<Data>(5000);
    private headers = new Lru<Data>(256);
    private blocks = new Lru<Data>(256);
    private pendingHeaders = new Map<string, Promise<Data>>();
    private pendingBlocks = new Map<string, Promise<Data>>();
    constructor(rpc: Rpc, connectivity: NodeService['connectivity'], geoDatabase: NodeService['geoDatabase'], autoUpdateEnabled: () => boolean) {
        this.rpc = rpc; this.connectivity = connectivity; this.geoDatabase = geoDatabase; this.autoUpdateEnabled = autoUpdateEnabled;
    }
    price(currency = 'USD') { return this.connectivity.priceInfo(currency); }
    async dashboardInfo(currency = 'USD', includePrice = true): Promise<Data> {
        const result = structuredClone(await this.dashboardCache.get(() => this.refreshDashboard()));
        if (includePrice) Object.assign(result, await this.price(currency));
        const connectivity = this.connectivity.snapshot();
        for (const key of ['internet_state', 'api_available', 'geo_db_only_mode']) result[key] = connectivity[key];
        const stats = this.geoDatabase.stats();
        if (stats.entries) {
            const now = nowSeconds();
            stats.oldest_age_days = stats.oldest_updated ? Math.trunc((now - stats.oldest_updated) / 86400) : null;
            stats.newest_age_days = stats.last_updated ? Math.trunc((now - stats.last_updated) / 86400) : null;
            stats.newest_age_seconds = stats.last_updated ? Math.trunc(now - stats.last_updated) : null;
        }
        result.geo_db_stats = { ...stats, auto_lookup: this.geoDatabase.enabled, auto_update: this.autoUpdateEnabled(), db_only_mode: connectivity.geo_db_only_mode };
        return result;
    }
    private async header(hash: string) {
        const cached = this.headers.get(hash);
        if (cached) return cached;
        let pending = this.pendingHeaders.get(hash);
        if (!pending) {
            pending = this.rpc.call('getblockheader', [hash], 10).then(value => {
                if (!object(value)) throw new Error('getblockheader returned an unexpected response');
                return this.headers.set(hash, value);
            }).finally(() => this.pendingHeaders.delete(hash));
            this.pendingHeaders.set(hash, pending);
        }
        return pending;
    }
    private async refreshDashboard(): Promise<Data> {
        const result: Data = Object.fromEntries(['last_block', 'blockchain', 'network_scores', 'connected', 'mempool_size', 'subversion', 'services', 'network_details', 'node_traffic'].map(key => [key, null]));
        let blockchain: Data | null = null;
        try {
            const value = await this.rpc.call('getblockchaininfo', [], 10);
            if (!object(value)) throw new Error('getblockchaininfo returned an unexpected response');
            blockchain = value;
            let indexed = false;
            try { indexed = 'txindex' in await this.rpc.call('getindexinfo', [], 10); } catch { /* Optional RPC. */ }
            result.blockchain = { size_gb: round((blockchain.size_on_disk || 0) / 1e9, 1), pruned: blockchain.pruned ?? false, indexed, ibd: blockchain.initialblockdownload ?? false };
        } catch (error) { console.warn(`Could not load blockchain details: ${errorMessage(error)}`); }
        try {
            const hash = blockchain?.bestblockhash || await this.rpc.call('getbestblockhash', [], 10);
            const header = await this.header(hash);
            result.last_block = { height: blockchain?.blocks ?? header.height ?? 0, time: header.time ?? 0 };
        } catch (error) { console.warn(`Could not load last block: ${errorMessage(error)}`); }
        try {
            const network = await this.rpc.call('getnetworkinfo', [], 10);
            if (!object(network)) throw new Error('getnetworkinfo returned an unexpected response');
            result.subversion = network.subversion ?? ''; result.connected = network.connections ?? 0;
            if (Array.isArray(network.localservicesnames) && network.localservicesnames.every((name: unknown) => typeof name === 'string' && name.trim().length > 0)) {
                result.services = network.localservicesnames;
            }
            result.network_details = networkSummary(network);
            const scores: Data = { ipv4: null, ipv6: null };
            for (const address of network.localaddresses || []) {
                const host: string = address.address || '';
                if (host.endsWith('.onion') || host.endsWith('.i2p') || /^f[cd]/.test(host)) continue;
                const family = host.includes(':') ? 'ipv6' : 'ipv4', score = address.score ?? 0;
                if (scores[family] === null || score > scores[family]) scores[family] = score;
            }
            result.network_scores = scores;
        } catch (error) { console.warn(`Could not load network details: ${errorMessage(error)}`); }
        try {
            const totals = await this.rpc.call('getnettotals', [], 10);
            const downloaded = Math.max(0, Math.trunc(totals.totalbytesrecv || 0)), uploaded = Math.max(0, Math.trunc(totals.totalbytessent || 0));
            result.node_traffic = { download_bytes: downloaded, upload_bytes: uploaded, download_fmt: formatBytes(downloaded), upload_fmt: formatBytes(uploaded) };
        } catch (error) { console.warn(`Could not load node traffic totals: ${errorMessage(error)}`); }
        try { result.mempool_size = (await this.rpc.call('getmempoolinfo', [], 10)).size ?? 0; }
        catch (error) { console.warn(`Could not load mempool details: ${errorMessage(error)}`); }
        return result;
    }
    async mempool(currency = 'USD'): Promise<Data> {
        const result: Data = { mempool: null, btc_price: null, error: null };
        try { result.mempool = await this.rpc.call('getmempoolinfo'); } catch (error) { result.error = errorMessage(error); }
        result.btc_price = await this.connectivity.fetchPrice(currency.toUpperCase());
        return result;
    }
    async blockchain(): Promise<Data> {
        try { return { blockchain: await this.rpc.call('getblockchaininfo'), error: null }; }
        catch (error) { return { blockchain: null, error: errorMessage(error) }; }
    }
    private async recentBlock(hash: string, expectedHeight: number): Promise<Data> {
        const cached = this.blocks.get(hash);
        if (cached) return cached;
        let pending = this.pendingBlocks.get(hash);
        if (!pending) {
            pending = this.rpc.call('getblock', [hash, 1], 10).then(block => {
                if (!object(block)) throw new Error('getblock returned an unexpected response');
                const height = Number(block.height ?? expectedHeight);
                if (height !== expectedHeight) throw new Error(`getblock returned height ${height} while traversing height ${expectedHeight}`);
                const size = Number(block.size || 0);
                return this.blocks.set(hash, { height, hash, time: Number(block.time || 0), size, size_mb: round(size / 1e6, 3), weight: Number(block.weight || 0), tx_count: Number(block.nTx ?? (Array.isArray(block.tx) ? block.tx.length : 0)), version: block.version ?? null, difficulty: block.difficulty ?? null, previous_hash: String(block.previousblockhash || '') });
            }).finally(() => this.pendingBlocks.delete(hash));
            this.pendingBlocks.set(hash, pending);
        }
        return pending;
    }
    async recentBlocks(limit = 25): Promise<Data> {
        limit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 25;
        try {
            const blockchain = await this.rpc.call('getblockchaininfo', [], 10);
            if (!object(blockchain)) throw new Error('getblockchaininfo returned an unexpected response');
            const height = Number(blockchain.blocks || 0);
            let hash = blockchain.bestblockhash;
            if (typeof hash !== 'string' || !hash) throw new Error('getblockchaininfo did not return bestblockhash');
            const cached: Data[] = [];
            for (let offset = 0; offset < Math.min(limit, height + 1); offset++) {
                const block = await this.recentBlock(hash, height - offset);
                cached.push(block);
                if (height - offset > 0) {
                    hash = block.previous_hash;
                    if (!hash) throw new Error(`getblock did not return previousblockhash at height ${height - offset}`);
                }
            }
            const generatedAt = Math.floor(nowSeconds());
            const blocks: Data[] = cached.map(({ previous_hash, ...block }) => ({ ...block, age_seconds: block.time ? Math.max(0, generatedAt - block.time) : null }));
            const count = blocks.length;
            const totalSize = blocks.reduce((sum, block) => sum + block.size, 0), transactions = blocks.reduce((sum, block) => sum + block.tx_count, 0);
            return { success: true, blocks, error: null, summary: { chain: blockchain.chain ?? null, tip_height: height, count, latest_time: blocks[0]?.time ?? null, total_size: totalSize, avg_size_mb: count ? round(totalSize / count / 1e6, 3) : 0, total_transactions: transactions, avg_transactions: count ? round(transactions / count, 1) : 0, generated_at: generatedAt } };
        } catch (error) { return { success: false, summary: null, blocks: [], error: errorMessage(error) }; }
    }
    async chainTips(): Promise<Data> {
        try {
            const tips = await this.rpc.call('getchaintips', [], 10);
            if (!Array.isArray(tips)) throw new Error('getchaintips returned an unexpected response');
            let blockchain: Data = {};
            try { const value = await this.rpc.call('getblockchaininfo', [], 10); if (object(value)) blockchain = value; } catch { /* Tip data remains usable. */ }
            const counts: Record<string, number> = {};
            const normalized: Data[] = tips.filter(object).map(tip => {
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
                chain: blockchain.chain ?? null, best_height: blockchain.blocks ?? active?.height ?? null,
                best_hash: blockchain.bestblockhash || active?.hash || null, total: normalized.length,
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
            const peers = await this.rpc.call('getpeerinfo');
            const peer = peers.find((peer: Data) => peer.id === id);
            if (!peer) return { success: false, error: `Peer ID ${id} not found` };
            const network = peer.network ?? 'ipv4';
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

export function networkSummary(network: Data): Data {
    const details: Data = Object.fromEntries(['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns'].map(key => [key, { reachable: false, limited: true, proxy: '', localaddresses: [] }]));
    for (const item of network.networks || []) {
        const key = String(item.name || '').toLowerCase();
        if (details[key]) Object.assign(details[key], { reachable: Boolean(item.reachable), limited: item.limited ?? true, proxy: String(item.proxy || '') });
    }
    for (const item of network.localaddresses || []) {
        const address = String(item.address || '').trim(), lower = address.toLowerCase();
        if (!address) continue;
        const key = lower.endsWith('.onion') ? 'onion' : lower.endsWith('.i2p') ? 'i2p' : /^f[cd].*:/.test(lower) ? 'cjdns' : address.includes(':') ? 'ipv6' : 'ipv4';
        details[key].localaddresses.push({ address, port: item.port ?? null, score: item.score ?? 0 });
    }
    for (const detail of Object.values(details)) detail.localaddresses.sort((a: Data, b: Data) => (b.score || 0) - (a.score || 0));
    return details;
}
