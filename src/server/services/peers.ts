import { abbreviateConnectionType, formatBytes, formatDuration, isPrivateAddress, isPublicAddress, networkType, splitPeerAddress } from '../network.ts';
import { type Data, type Rpc, object, nowSeconds, errorMessage } from '../types.ts';
import { repeat, sleep } from '../tasks.ts';
import { GeoDatabase, isValidGeoData } from './geoip.ts';
import { ConnectivityService } from './connectivity.ts';
import { parsePeerInfo, parseNodeAddresses, type PeerInfo } from '../rpc-types.ts';
import { createFailureReporter, createLogger } from '../logging.ts';

const log = createLogger('peers');

export const REFRESH_INTERVAL_MS = 10_000;
export const GEO_PERSISTENCE_RETRY_MS = 60_000;
const GEO_API_FIELDS = 'status,message,continent,continentCode,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,mobile,proxy,hosting';
interface PendingGeoSave { data: Data; observedAt: number }
interface GeoEntry { data: Data; generation: number; retryAt: number | null; pendingSave?: PendingGeoSave; saveRetryAt?: number }
export class PeerService {
    readonly rpc: Rpc;
    readonly geoDatabase: GeoDatabase;
    readonly connectivity: ConnectivityService;
    readonly signal: AbortSignal;
    readonly fetcher: typeof fetch;
    private controller = new AbortController();
    private tasks: Promise<void>[] = [];
    private refreshFailures = createFailureReporter(log);
    private geoFailures = createFailureReporter(log);
    peers: PeerInfo[] = [];
    lastSuccessAt: number | null = null;
    lastAttemptAt: number | null = null;
    lastError: string | null = null;
    geoQueue: [string, string][] = [];
    pending = new Set<string>();
    geoCache = new Map<string, GeoEntry>();
    activeHosts = new Set<string>();
    knownAddresses = new Set<string>();
    constructor(rpc: Rpc, geoDatabase: GeoDatabase, connectivity: ConnectivityService, signal?: AbortSignal, fetcher = fetch) {
        this.rpc = rpc; this.geoDatabase = geoDatabase; this.connectivity = connectivity; this.fetcher = fetcher;
        this.signal = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    }
    async start() {
        if (this.tasks.length) return;
        await this.refreshKnownAddresses();
        let refreshes = 0;
        this.tasks = [repeat(async () => {
            await this.refreshOnce();
            if (++refreshes >= 6) { refreshes = 0; await this.refreshKnownAddresses(); }
        }, REFRESH_INTERVAL_MS, this.signal, log), this.geoLoop()];
    }
    async stop() { this.controller.abort(); await Promise.allSettled(this.tasks); }
    async refreshOnce() {
        let peers: PeerInfo[];
        try {
            peers = parsePeerInfo(await this.rpc.call('getpeerinfo'));
        } catch (error) {
            this.lastAttemptAt = nowSeconds(); this.lastError = 'Could not refresh peers from the Bitcoin node';
            if (!this.signal.aborted) this.refreshFailures.failure(`Peer refresh failed: ${errorMessage(error)}`);
            return false;
        }
        this.peers = peers;
        if (!this.signal.aborted) this.refreshFailures.recovered('Peer refresh recovered');
        this.lastSuccessAt = nowSeconds(); this.lastAttemptAt = this.lastSuccessAt; this.lastError = null;
        this.activeHosts = new Set(this.peers.map(peer => splitPeerAddress(peer.addr || '')[0]));
        for (const host of this.geoCache.keys()) if (!this.activeHosts.has(host)) this.geoCache.delete(host);
        for (const peer of this.peers) {
            const address = peer.addr || '', network = peer.network ?? networkType(address);
            const [host] = splitPeerAddress(address);
            const entry = this.geoCache.get(host);
            if (entry?.pendingSave && performance.now() >= (entry.saveRetryAt ?? Infinity)) this.queueGeoLookup(host, network);
            if (!this.cachedGeo(host)) {
                if (isPublicAddress(network, host)) this.queueGeoLookup(host, network);
                else this.geoCache.set(host, { data: emptyGeo('private'), generation: this.geoDatabase.generation, retryAt: null });
            }
        }
        return true;
    }
    async refreshKnownAddresses() {
        try {
            const addresses = parseNodeAddresses(await this.rpc.call('getnodeaddresses', [0]));
            this.knownAddresses = new Set(addresses.map(item => item.address));
        } catch { /* Address-manager metadata is optional. */ }
    }
    cachedGeo(host: string): Data | null {
        const entry = this.geoCache.get(host);
        if (!entry || (!entry.pendingSave && entry.generation !== this.geoDatabase.generation) || (entry.retryAt !== null && performance.now() >= entry.retryAt)) return null;
        return entry.data;
    }
    queueGeoLookup(host: string, network: string) {
        if (this.pending.has(host)) return;
        this.pending.add(host); this.geoQueue.push([host, network]);
    }
    async fetchGeo(host: string): Promise<Data | null> {
        if (!this.connectivity.providerReady('geoip')) return null;
        let response: Response | undefined;
        try {
            response = await this.fetcher(`http://ip-api.com/json/${encodeURIComponent(host)}?fields=${GEO_API_FIELDS}`, { signal: AbortSignal.any([this.signal, AbortSignal.timeout(10_000)]) });
            if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
            const data: unknown = await response.json();
            if (object(data) && data.status === 'fail' && (data.message === undefined || typeof data.message === 'string')) {
                // A rejected address is a lookup miss, not a provider outage.
                this.connectivity.providerSuccess('geoip', response); return null;
            }
            if (!object(data) || data.status !== 'success' || !isValidGeoData(data)) throw new Error('GeoIP response did not include valid geolocation data');
            this.connectivity.providerSuccess('geoip', response); return data;
        } catch (error) { if (!this.signal.aborted) this.connectivity.providerFailure('geoip', error, response); }
        return null;
    }
    async resolveGeo(host: string, network: string) {
        try {
            if (!this.activeHosts.has(host)) return false;
            const retained = this.geoCache.get(host)?.pendingSave;
            if (retained) { await this.persistGeo(host, retained); return false; }
            let data = this.geoDatabase.get(host);
            if (!isValidGeoData(data)) data = null;
            const state = this.connectivity.snapshot();
            const usedApi = !data && !state.geo_db_only_mode && this.connectivity.providerReady('geoip') && !['yellow', 'red'].includes(state.internet_state) && isPublicAddress(network, host);
            if (usedApi) {
                data = await this.fetchGeo(host);
                if (isValidGeoData(data)) {
                    const pendingSave = { data: { ...data }, observedAt: Math.floor(nowSeconds()) };
                    this.cacheGeo(host, data, false, pendingSave);
                    await this.persistGeo(host, pendingSave);
                    return true;
                }
                // An import may have supplied a location while the provider request was pending.
                data = this.geoDatabase.get(host);
                if (!isValidGeoData(data)) data = null;
            }
            this.cacheGeo(host, data, true);
            return usedApi;
        } finally { this.pending.delete(host); }
    }
    private cacheGeo(host: string, data: Data | null, fromDatabase: boolean, pendingSave?: PendingGeoSave, saveRetryAt?: number) {
        if (this.signal.aborted || !this.activeHosts.has(host)) return;
        const normalized = emptyGeo(data ? 'ok' : 'unavailable');
        if (data) {
            for (const key of Object.keys(normalized)) if (key !== 'status' && key in data) normalized[key] = data[key];
            normalized.lat = Number(data.lat); normalized.lon = Number(data.lon);
            if (fromDatabase) { normalized.offset = data.utc_offset ?? 0; normalized.as = data.as_info ?? ''; }
        }
        this.geoCache.set(host, { data: normalized, generation: this.geoDatabase.generation, retryAt: data ? null : performance.now() + 60_000, pendingSave, saveRetryAt });
    }
    private async persistGeo(host: string, pendingSave: PendingGeoSave) {
        const result = await this.geoDatabase.save(host, pendingSave.data, pendingSave.observedAt, this.signal);
        if (result.status === 'cancelled' || this.signal.aborted) return;
        if (result.status === 'saved' || result.status === 'superseded') this.cacheGeo(host, result.row, true);
        else if (result.status === 'disabled') this.cacheGeo(host, pendingSave.data, false);
        else this.cacheGeo(host, pendingSave.data, false, pendingSave, performance.now() + GEO_PERSISTENCE_RETRY_MS);
    }
    private async geoLoop() {
        while (!this.signal.aborted) {
            const item = this.geoQueue.shift();
            if (!item) { await sleep(500, this.signal); continue; }
            try {
                if (await this.resolveGeo(...item)) await sleep(1500, this.signal);
                if (!this.signal.aborted) this.geoFailures.recovered('Peer geolocation processing recovered');
            } catch (error) { if (!this.signal.aborted) this.geoFailures.failure(`Peer geolocation processing failed: ${errorMessage(error)}`, 'error'); }
        }
    }
    listPeers() { return this.snapshot().peers; }
    snapshot(): { peers: Data[]; status: Data } {
        return { peers: this.serializePeers(this.peers, this.lastSuccessAt ?? nowSeconds()), status: {
            connected: this.lastAttemptAt === null ? null : this.lastError === null,
            last_success_at: this.lastSuccessAt, last_attempt_at: this.lastAttemptAt,
            age_seconds: this.lastSuccessAt === null ? null : Math.max(0, nowSeconds() - this.lastSuccessAt),
            error: this.lastError, stale_after_seconds: 30,
        } };
    }
    serializePeers(peers: PeerInfo[], observedAt: number): Data[] {
        const serviceNames: Record<string, string> = { NETWORK: 'N', WITNESS: 'W', NETWORK_LIMITED: 'NL', P2P_V2: 'P', COMPACT_FILTERS: 'CF', BLOOM: 'B', 'BLAKE2B?': 'BL', BLAKE2B: 'BL' };
        return peers.map(peer => {
            const address = peer.addr || '', network = peer.network ?? networkType(address);
            const [host, port] = splitPeerAddress(address), geo = this.cachedGeo(host);
            let locationStatus = 'pending', location = 'Stalking...';
            if (['onion', 'i2p', 'cjdns'].includes(network) || isPrivateAddress(host)) { locationStatus = 'private'; location = 'PRIVATE'; }
            else if (geo?.status === 'ok') {
                const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
                const country = text(geo.countryCode) || text(geo.country);
                const locality = text(geo.city) || text(geo.regionName) || text(geo.region);
                locationStatus = 'ok'; location = [locality, country].filter(Boolean).join(', ');
            }
            else if (geo?.status === 'unavailable') { locationStatus = 'unavailable'; location = 'UNAVAILABLE'; }
            const services: string[] = peer.servicesnames || [];
            const result: Data = {
                id: peer.id ?? null, network, ip: host, port, direction: peer.inbound ? 'IN' : 'OUT',
                subver: (peer.subver || '').replaceAll('/', ''),
                bytessent: peer.bytessent ?? 0, bytesrecv: peer.bytesrecv ?? 0,
                bytessent_fmt: formatBytes(peer.bytessent ?? 0), bytesrecv_fmt: formatBytes(peer.bytesrecv ?? 0),
                ping_ms: typeof peer.pingtime === 'number' && peer.pingtime >= 0 && Number.isFinite(peer.pingtime * 1000) ? peer.pingtime * 1000 : null, conntime: peer.conntime ?? 0,
                conntime_fmt: peer.conntime ? formatDuration(Math.floor(observedAt) - peer.conntime) : '-',
                version: peer.version ?? 0, connection_type: peer.connection_type ?? '',
                connection_type_abbrev: abbreviateConnectionType(peer.connection_type || ''),
                services, services_abbrev: services.map(name => serviceNames[name] || name.slice(0, 2)).join(' '),
                in_addrman: this.knownAddresses.has(host), location, location_status: locationStatus, addr: address,
            };
            for (const [key, fallback] of Object.entries(emptyGeo(''))) if (key !== 'status') result[key] = geo?.[key] ?? fallback;
            for (const key of ['minping', 'lastsend', 'lastrecv', 'startingheight', 'synced_headers', 'synced_blocks', 'addr_relay_enabled', 'relaytxes', 'minfeefilter', 'mapped_as']) result[key] = peer[key] ?? null;
            for (const key of ['transport_protocol_type', 'session_id', 'addrlocal']) result[key] = peer[key] ?? '';
            for (const key of ['bip152_hb_from', 'bip152_hb_to']) result[key] = peer[key] ?? false;
            for (const key of ['last_transaction', 'last_block', 'timeoffset', 'addr_processed', 'addr_rate_limited']) result[key] = peer[key] ?? 0;
            result.permissions = peer.permissions ?? [];
            return result;
        });
    }
}
export function emptyGeo(status: string): Data {
    return { status, continent: '', continentCode: '', country: '', countryCode: '', region: '', regionName: '', city: '', district: '', zip: '', lat: 0, lon: 0, timezone: '', offset: 0, currency: '', isp: '', org: '', as: '', asname: '', mobile: false, proxy: false, hosting: false };
}
