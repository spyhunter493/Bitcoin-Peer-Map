import { abbreviateConnectionType, formatBytes, formatDuration, isPrivateAddress, isPublicAddress, networkType, splitPeerAddress, peerEndpointKey } from '../network.ts';
import { type Data, type Rpc, object, nowSeconds, errorMessage } from '../types.ts';
import { repeat, sleep } from '../tasks.ts';
import { setImmediate } from 'node:timers/promises';
import { GeoDatabase, isValidGeoData } from './geoip.ts';
import { ConnectivityService } from './connectivity.ts';
import { parsePeerInfo, parseNodeAddresses, type PeerInfo } from '../rpc-types.ts';
import { PeerBandwidthRates, PEER_SNAPSHOT_STALE_AFTER_SECONDS } from './peer-rates.ts';
import { createFailureReporter, createLogger } from '../logging.ts';
import type { ValidGeoData } from './geoip-validation.ts';
import { hasOversizedGeoStrings } from './geoip-limits.ts';
import { readGeoipJson } from './geoip-response.ts';

const log = createLogger('peers');

export const REFRESH_INTERVAL_MS = 10_000;
export const GEO_PERSISTENCE_RETRY_MS = 60_000;
export const GEO_HYDRATION_BATCH_SIZE = 32;
export const GEO_PROVIDER_SPACING_MS = 1500;
export const GEO_STALE_AFTER_SECONDS = 2592000; // 30 days, matching the wire contract.
export const GEO_REFRESH_RETRY_MS = 60 * 60 * 1000;
export type { GeoMetadata } from '../../shared/api.generated.d.ts';
import type { GeoMetadata, Peer, PeerSnapshot } from '../api-types.ts';
const GEO_API_FIELDS = 'status,message,continent,continentCode,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,mobile,proxy,hosting';
type CachedGeoData = Data & Pick<Peer, 'country' | 'lat' | 'lon'>;
interface PendingGeoSave { data: ValidGeoData; observedAt: number }
interface GeoHost {
    host: string; network: string; controller: AbortController;
    generation: number; readRetryAt: number; readFailed: boolean;
}
interface ProviderJob {
    owner: GeoHost; controller: AbortController; promise?: Promise<boolean>;
}
interface SaveJob {
    owner: GeoHost; observation: PendingGeoSave; promise?: Promise<void>;
}
export type GeoIpLookup = (host: string, signal: AbortSignal) => Promise<Data | null>;
interface GeoEntry {
    data: CachedGeoData; source: GeoMetadata['source']; observedAt: number | null;
    generation: number; retryAt: number | null; refreshRetryAt: number | null;
    pendingSave?: PendingGeoSave; saveRetryAt?: number;
}
function metadata(entry?: GeoEntry): GeoMetadata {
    const available = entry?.data.status === 'ok';
    const now = nowSeconds();
    const observed = available && typeof entry.observedAt === 'number' && Number.isSafeInteger(entry.observedAt) && entry.observedAt > 0 ? entry.observedAt : null;
    const age = observed !== null && observed <= now ? Math.floor(now - observed) : null;
    return { source: available ? entry.source : null, observed_at: observed, age_seconds: age,
        freshness: !available ? 'unavailable' : age === null ? 'unknown' : age >= GEO_STALE_AFTER_SECONDS ? 'stale' : 'fresh',
        stale_after_seconds: GEO_STALE_AFTER_SECONDS };
}
export class PeerService {
    readonly rpc: Rpc;
    readonly geoDatabase: GeoDatabase;
    readonly connectivity: ConnectivityService;
    readonly signal: AbortSignal;
    readonly fetcher: typeof fetch;
    private controller = new AbortController();
    private tasks: Promise<void>[] = [];
    private startup: Promise<void> | null = null;
    private refreshTask: Promise<boolean> | null = null;
    private knownAddressesTask: Promise<void> | null = null;
    private hosts = new Map<string, GeoHost>();
    private providerJobs = new Map<string, ProviderJob>();
    private saveJobs = new Map<string, SaveJob>();
    private providerTask: Promise<boolean> | null = null;
    private saveTask: Promise<void> | null = null;
    private nextProviderAt = 0;
    private refreshFailures = createFailureReporter(log);
    private geoFailures = createFailureReporter(log);
    private bandwidth = new PeerBandwidthRates();
    peers: PeerInfo[] = [];
    lastSuccessAt: number | null = null;
    lastAttemptAt: number | null = null;
    lastError: string | null = null;
    geoQueue: [string, string][] = [];
    saveQueue: string[] = [];
    pending = new Set<string>();
    geoCache = new Map<string, GeoEntry>();
    activeHosts = new Set<string>();
    knownAddresses = new Set<string>();
    private knownAddressesAvailable = false;
    private readonly lookup?: GeoIpLookup;
    constructor(rpc: Rpc, geoDatabase: GeoDatabase, connectivity: ConnectivityService, signal?: AbortSignal, fetcher = fetch, lookup?: GeoIpLookup) {
        this.rpc = rpc; this.geoDatabase = geoDatabase; this.connectivity = connectivity; this.fetcher = fetcher; this.lookup = lookup;
        this.signal = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    }
    start() {
        // Claim startup synchronously; concurrent callers must not create extra workers.
        this.startup ??= this.startWorkers();
        return this.startup;
    }
    private async startWorkers() {
        if (this.signal.aborted) return;
        await this.refreshKnownAddresses();
        if (this.signal.aborted) return;
        let refreshes = 0;
        this.tasks = [repeat(async () => {
            await this.refreshOnce();
            if (++refreshes >= 6) { refreshes = 0; await this.refreshKnownAddresses(); }
        }, REFRESH_INTERVAL_MS, this.signal, log), this.geoLoop(), this.saveLoop()];
    }
    async stop() {
        this.controller.abort();
        this.cancelProviderWork();
        for (const owner of this.hosts.values()) owner.controller.abort();
        this.hosts.clear(); this.activeHosts.clear(); this.geoCache.clear();
        this.bandwidth.clear();
        this.saveJobs.clear(); this.saveQueue = [];
        await Promise.allSettled([this.startup, ...this.tasks, this.refreshTask, this.knownAddressesTask, this.providerTask, this.saveTask]);
    }
    refreshOnce() {
        if (this.signal.aborted) return Promise.resolve(false);
        if (this.refreshTask) return this.refreshTask;
        const task = this.refreshPeers().finally(() => { if (this.refreshTask === task) this.refreshTask = null; });
        this.refreshTask = task;
        return task;
    }
    private async refreshPeers() {
        let peers: PeerInfo[];
        let observedAt: number;
        try {
            const response = await this.rpc.call('getpeerinfo', [], undefined, this.signal);
            observedAt = performance.now();
            peers = parsePeerInfo(response);
        } catch (error) {
            if (this.signal.aborted) return false;
            this.bandwidth.clear();
            this.lastAttemptAt = nowSeconds(); this.lastError = 'Could not refresh peers from the Bitcoin node';
            this.refreshFailures.failure(`Peer refresh failed: ${errorMessage(error)}`);
            return false;
        }
        if (this.signal.aborted) return false;
        this.bandwidth.sample(peers, observedAt);
        this.peers = peers;
        this.refreshFailures.recovered('Peer refresh recovered');
        this.lastSuccessAt = nowSeconds(); this.lastAttemptAt = this.lastSuccessAt; this.lastError = null;
        const unique = new Map<string, string>();
        for (const peer of peers) {
            const address = peer.addr || '', network = peer.network ?? networkType(address);
            const [host] = splitPeerAddress(address);
            if (!unique.has(host) || isPublicAddress(network, host)) unique.set(host, network);
        }
        this.activeHosts = new Set(unique.keys());
        for (const [host, owner] of this.hosts) if (!unique.has(host)
            || isPublicAddress(owner.network, host) !== isPublicAddress(unique.get(host)!, host)) {
            owner.controller.abort(); this.hosts.delete(host); this.geoCache.delete(host);
            const job = this.providerJobs.get(host);
            if (job?.owner === owner) { job.controller.abort(); this.providerJobs.delete(host); this.pending.delete(host); }
            if (this.saveJobs.get(host)?.owner === owner) this.saveJobs.delete(host);
        }
        this.geoQueue = this.geoQueue.filter(([host]) => this.providerJobs.has(host));
        this.saveQueue = this.saveQueue.filter(host => this.saveJobs.has(host));
        let processed = 0;
        for (const [host, network] of unique) {
            let owner = this.hosts.get(host);
            if (!owner) {
                owner = { host, network, controller: new AbortController(), generation: -1, readRetryAt: 0, readFailed: false };
                this.hosts.set(host, owner);
            } else owner.network = network;
            if (isPublicAddress(network, host)) this.hydrate(owner);
            else this.geoCache.set(host, { data: emptyGeo('private'), source: null, observedAt: null,
                generation: this.geoDatabase.generation, retryAt: null, refreshRetryAt: null });
            if (++processed % GEO_HYDRATION_BATCH_SIZE === 0) {
                await setImmediate();
                if (this.signal.aborted) return false;
            }
        }
        // Dispatch newly discovered misses only after every host's eligible local read.
        for (const [host, network] of unique) {
            const owner = this.hosts.get(host)!;
            const entry = this.geoCache.get(host);
            if (entry?.pendingSave) {
                if (performance.now() >= (entry.saveRetryAt ?? 0)) this.queueSave(owner, entry.pendingSave);
            } else if (!owner.readFailed && isPublicAddress(network, host) && this.needsLookup(entry)) this.queueGeoLookup(host, network);
        }
        return true;
    }
    refreshKnownAddresses() {
        if (this.signal.aborted) return Promise.resolve();
        if (this.knownAddressesTask) return this.knownAddressesTask;
        const task = this.loadKnownAddresses().finally(() => { if (this.knownAddressesTask === task) this.knownAddressesTask = null; });
        this.knownAddressesTask = task;
        return task;
    }
    private async loadKnownAddresses() {
        try {
            const addresses = parseNodeAddresses(await this.rpc.call('getnodeaddresses', [0], undefined, this.signal));
            if (this.signal.aborted) return;
            const keys = addresses.map(item => peerEndpointKey(item.address, item.port));
            if (keys.some(key => key === null)) throw new Error('getnodeaddresses returned an unusable endpoint');
            this.knownAddresses = new Set(keys as string[]);
            this.knownAddressesAvailable = true;
        } catch { if (!this.signal.aborted) this.knownAddressesAvailable = false; /* Retain optional metadata without making current claims. */ }
    }
    cachedGeo(host: string): CachedGeoData | null {
        let entry = this.geoCache.get(host);
        if (entry && hasOversizedGeoStrings(entry.data)) {
            this.rejectOversizedGeo(host);
            entry = this.geoCache.get(host);
        }
        if (!entry || (entry.data.status !== 'ok' && !entry.pendingSave &&
            (entry.generation !== this.geoDatabase.generation || (entry.retryAt !== null && performance.now() >= entry.retryAt)))) return null;
        return entry.data;
    }
    private current(owner: GeoHost) { return !this.signal.aborted && !owner.controller.signal.aborted && this.hosts.get(owner.host) === owner; }
    private rejectOversizedGeo(host: string) {
        const previous = this.geoCache.get(host);
        // An independently validated API replacement remains usable while its write retries.
        if (previous?.pendingSave && isValidGeoData(previous.pendingSave.data) && isValidGeoData(previous.data)) return;
        this.geoCache.set(host, { data: emptyGeo('unavailable'), source: null, observedAt: null,
            generation: this.geoDatabase.generation, retryAt: previous?.data.status === 'unavailable' ? previous.retryAt : null, refreshRetryAt: null });
    }
    private hydrate(owner: GeoHost, force = false) {
        if (!this.current(owner) || !isPublicAddress(owner.network, owner.host)) return;
        if (!force && owner.generation === this.geoDatabase.generation && performance.now() < owner.readRetryAt) return;
        const result = this.geoDatabase.read(owner.host);
        owner.generation = this.geoDatabase.generation;
        owner.readFailed = result.status === 'error';
        owner.readRetryAt = result.status === 'hit' ? Infinity : performance.now() + 60_000;
        if (result.status === 'rejected' || (result.status === 'hit' && hasOversizedGeoStrings(result.row))) this.rejectOversizedGeo(owner.host);
        if (result.status === 'hit' && isValidGeoData(result.row)) this.cacheGeo(owner, result.row, true);
        const retained = this.geoCache.get(owner.host);
        if (retained) retained.generation = this.geoDatabase.generation;
    }
    private needsLookup(entry?: GeoEntry) {
        if (entry?.pendingSave) return false;
        if (entry?.data.status === 'ok') return !this.connectivity.geoipApiDisabled && metadata(entry).freshness !== 'fresh'
            && performance.now() >= (entry.refreshRetryAt ?? 0) && this.connectivity.providerReady('geoip');
        return !entry || entry.retryAt === null || performance.now() >= entry.retryAt;
    }
    queueGeoLookup(host: string, network: string) {
        const owner = this.hosts.get(host);
        if (!owner || !this.current(owner) || !isPublicAddress(network, host) || this.providerJobs.has(host)) return;
        this.providerJobs.set(host, { owner, controller: new AbortController() });
        this.pending.add(host); this.geoQueue.push([host, network]);
    }
    cancelProviderWork() {
        for (const job of this.providerJobs.values()) job.controller.abort();
        this.providerJobs.clear(); this.pending.clear(); this.geoQueue = [];
    }
    async fetchGeo(host: string, signal = this.signal): Promise<Data | null> {
        if (signal.aborted || !this.connectivity.providerReady('geoip')) return null;
        if (this.lookup) return this.lookup(host, signal);
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
        let response: Response | undefined;
        try {
            response = await this.fetcher(`http://ip-api.com/json/${encodeURIComponent(host)}?fields=${GEO_API_FIELDS}`, { signal: requestSignal, redirect: 'manual' });
            requestSignal.throwIfAborted();
            if (!response.ok) throw new Error(`GeoIP HTTP ${response.status}`);
            const data = await readGeoipJson(response, requestSignal);
            requestSignal.throwIfAborted();
            if (object(data) && hasOversizedGeoStrings(data)) throw new Error('GeoIP record exceeds the string size limit');
            if (object(data) && data.status === 'fail' && (data.message === undefined || typeof data.message === 'string')) {
                // A rejected address is a lookup miss, not a provider outage.
                this.connectivity.providerSuccess('geoip', response); return null;
            }
            if (!object(data) || data.status !== 'success' || !isValidGeoData(data)) throw new Error('GeoIP response did not include valid geolocation data');
            this.connectivity.providerSuccess('geoip', response); return data;
        } catch {
            if (!signal.aborted) {
                const message = response && !response.ok ? `GeoIP HTTP ${response.status}` : 'GeoIP request failed or returned invalid data';
                this.connectivity.providerFailure('geoip', new Error(message), response);
            }
        } finally {
            if (response && !response.bodyUsed) void response.body?.cancel().catch(() => {});
        }
        return null;
    }
    resolveGeo(host: string, network: string): Promise<boolean> {
        this.queueGeoLookup(host, network);
        const job = this.providerJobs.get(host);
        if (!job) return Promise.resolve(false);
        if (job.promise) return job.promise;
        if (this.providerTask) return Promise.resolve(false);
        this.geoQueue = this.geoQueue.filter(([queued]) => queued !== host);
        const task = this.resolveProvider(job).finally(() => {
            if (this.providerJobs.get(host) === job) { this.providerJobs.delete(host); this.pending.delete(host); }
            if (this.providerTask === task) this.providerTask = null;
        });
        job.promise = task; this.providerTask = task;
        return task;
    }
    private async resolveProvider(job: ProviderJob) {
        const owner = job.owner, host = owner.host;
        const signal = AbortSignal.any([this.signal, owner.controller.signal, job.controller.signal]);
        if (signal.aborted || !this.current(owner)) return false;
        this.hydrate(owner, true);
        let entry = this.geoCache.get(host);
        if (entry?.pendingSave) { this.queueSave(owner, entry.pendingSave); return false; }
        if (owner.readFailed || !this.needsLookup(entry) || this.connectivity.geoipApiDisabled || !this.connectivity.providerReady('geoip')) {
            if (!entry && !owner.readFailed) this.cacheGeo(owner, null, true);
            return false;
        }
        const delay = this.nextProviderAt - performance.now();
        if (delay > 0) {
            await sleep(delay, signal);
            if (signal.aborted || !this.current(owner)) return false;
            this.hydrate(owner, true);
        }
        if (signal.aborted || !this.current(owner)) return false;
        // Imports, pending saves, preference changes and quota windows may supersede queued work.
        entry = this.geoCache.get(host);
        if (entry?.pendingSave) { this.queueSave(owner, entry.pendingSave); return false; }
        const usedApi = !owner.readFailed && this.needsLookup(entry) && !this.connectivity.geoipApiDisabled
            && this.connectivity.providerReady('geoip') && isPublicAddress(owner.network, host);
        if (usedApi) {
            let data: Data | null;
            try { data = await this.fetchGeo(host, signal); }
            finally { this.nextProviderAt = performance.now() + GEO_PROVIDER_SPACING_MS; }
            if (signal.aborted || !this.current(owner)) return true;
            if (isValidGeoData(data)) {
                const observation = { data: { ...data }, observedAt: Math.floor(nowSeconds()) };
                // Reconcile an import that committed while the provider was in flight.
                this.hydrate(owner, true);
                this.cacheGeo(owner, data, false, observation);
                entry = this.geoCache.get(host);
                if (entry) { entry.pendingSave = observation; entry.saveRetryAt = 0; }
                this.queueSave(owner, observation);
                return true;
            }
            // A dataset import may have supplied a location while lookup was pending.
            this.hydrate(owner, true);
        }
        entry = this.geoCache.get(host);
        if (entry?.data.status === 'ok') {
            if (usedApi && metadata(entry).freshness !== 'fresh') entry.refreshRetryAt = performance.now() + GEO_REFRESH_RETRY_MS;
        } else if (!owner.readFailed) this.cacheGeo(owner, null, true);
        return usedApi;
    }
    private cacheGeo(owner: GeoHost, data: ValidGeoData | null, fromDatabase: boolean, observation?: PendingGeoSave) {
        if (!this.current(owner)) return;
        if (data && hasOversizedGeoStrings(data)) { this.rejectOversizedGeo(owner.host); return; }
        const previous = this.geoCache.get(owner.host);
        if (!data && previous?.data.status === 'ok') return;
        const source: GeoMetadata['source'] = !data ? null : !fromDatabase ? 'ip_api' :
            data.geo_source === 'dataset' || data.geo_source === 'ip_api' ? data.geo_source : 'unknown';
        const timestamp = !data ? null : fromDatabase ? (typeof data.last_updated === 'number' ? data.last_updated : null) : observation?.observedAt ?? null;
        // SQLite keeps its existing row on equal timestamps. A read is authoritative for that tie.
        if (data && previous?.data.status === 'ok' && ((timestamp ?? 0) < (previous.observedAt ?? 0)
            || (!fromDatabase && (timestamp ?? 0) === (previous.observedAt ?? 0)))) return;
        const normalized = emptyGeo(data ? 'ok' : 'unavailable');
        if (data) {
            for (const key of Object.keys(normalized)) if (key !== 'status' && key in data) normalized[key] = data[key];
            normalized.lat = Number(data.lat); normalized.lon = Number(data.lon);
            if (fromDatabase) { normalized.offset = data.utc_offset ?? 0; normalized.as = data.as_info ?? ''; }
        }
        const unchanged = previous?.source === source && previous?.observedAt === timestamp;
        this.geoCache.set(owner.host, { data: normalized, source, observedAt: timestamp, generation: this.geoDatabase.generation,
            retryAt: data ? null : performance.now() + 60_000, refreshRetryAt: unchanged ? previous.refreshRetryAt : null,
            pendingSave: previous?.pendingSave, saveRetryAt: previous?.saveRetryAt });
    }
    private queueSave(owner: GeoHost, observation: PendingGeoSave) {
        if (!this.current(owner) || this.saveJobs.has(owner.host)) return;
        const entry = this.geoCache.get(owner.host);
        if (entry?.pendingSave !== observation || performance.now() < (entry.saveRetryAt ?? 0)) return;
        this.saveJobs.set(owner.host, { owner, observation }); this.saveQueue.push(owner.host);
    }
    persistGeo(host: string): Promise<void> {
        const owner = this.hosts.get(host), entry = this.geoCache.get(host);
        if (owner && entry?.pendingSave) this.queueSave(owner, entry.pendingSave);
        const job = this.saveJobs.get(host);
        if (!job) return Promise.resolve();
        if (job.promise) return job.promise;
        if (this.saveTask) return Promise.resolve();
        this.saveQueue = this.saveQueue.filter(queued => queued !== host);
        const task = this.saveGeo(job).finally(() => {
            if (this.saveJobs.get(host) === job) this.saveJobs.delete(host);
            if (this.saveTask === task) this.saveTask = null;
        });
        job.promise = task; this.saveTask = task;
        return task;
    }
    private async saveGeo(job: SaveJob) {
        const { owner, observation } = job;
        if (!this.current(owner)) return;
        const signal = AbortSignal.any([this.signal, owner.controller.signal]);
        let result;
        try { result = await this.geoDatabase.save(owner.host, observation.data, observation.observedAt, signal); }
        catch (error) {
            if (this.current(owner) && this.saveJobs.get(owner.host) === job) {
                const entry = this.geoCache.get(owner.host);
                if (entry?.pendingSave === observation) entry.saveRetryAt = performance.now() + GEO_PERSISTENCE_RETRY_MS;
            }
            if (!signal.aborted) throw error;
            return;
        }
        if (!this.current(owner) || this.saveJobs.get(owner.host) !== job) return;
        if (result.status === 'saved' || result.status === 'superseded') this.cacheGeo(owner, result.row, true);
        const entry = this.geoCache.get(owner.host);
        if (entry?.pendingSave !== observation) return;
        if (result.status === 'saved' || result.status === 'superseded' || result.status === 'disabled') {
            entry.pendingSave = undefined; entry.saveRetryAt = undefined;
            // An unknown-age stored winner needs the same cooldown after a delayed write.
            if (entry.data.status === 'ok' && metadata(entry).freshness !== 'fresh') entry.refreshRetryAt = performance.now() + GEO_REFRESH_RETRY_MS;
        } else entry.saveRetryAt = performance.now() + GEO_PERSISTENCE_RETRY_MS;
    }
    private async geoLoop() {
        while (!this.signal.aborted) {
            const item = this.geoQueue[0];
            if (!item || this.providerTask) { await sleep(500, this.signal); continue; }
            try {
                await this.resolveGeo(...item);
                if (!this.signal.aborted) this.geoFailures.recovered('Peer geolocation processing recovered');
            } catch (error) { if (!this.signal.aborted) this.geoFailures.failure(`Peer geolocation processing failed: ${errorMessage(error)}`, 'error'); }
        }
    }
    private async saveLoop() {
        while (!this.signal.aborted) {
            const host = this.saveQueue[0];
            if (!host || this.saveTask) { await sleep(500, this.signal); continue; }
            try { await this.persistGeo(host); }
            catch (error) { if (!this.signal.aborted) this.geoFailures.failure(`Peer geolocation persistence failed: ${errorMessage(error)}`, 'error'); }
        }
    }
    listPeers() { return this.snapshot().peers; }
    snapshot(): PeerSnapshot {
        return { peers: this.serializePeers(this.peers, this.lastSuccessAt ?? nowSeconds()), status: {
            connected: this.lastAttemptAt === null ? null : this.lastError === null,
            last_success_at: this.lastSuccessAt, last_attempt_at: this.lastAttemptAt,
            age_seconds: this.lastSuccessAt === null ? null : Math.max(0, nowSeconds() - this.lastSuccessAt),
            error: this.lastError, stale_after_seconds: PEER_SNAPSHOT_STALE_AFTER_SECONDS,
        } };
    }
    serializePeers(peers: PeerInfo[], observedAt: number): Peer[] {
        const serviceNames: Record<string, string> = { NETWORK: 'N', WITNESS: 'W', NETWORK_LIMITED: 'NL', P2P_V2: 'P', COMPACT_FILTERS: 'CF', BLOOM: 'B', 'BLAKE2B?': 'BL', BLAKE2B: 'BL' };
        const rateNow = performance.now();
        const ratesFresh = this.lastSuccessAt !== null && nowSeconds() - this.lastSuccessAt <= PEER_SNAPSHOT_STALE_AFTER_SECONDS;
        return peers.map(peer => {
            const address = peer.addr || '', network = peer.network ?? networkType(address);
            const [host, port] = splitPeerAddress(address), geo = this.cachedGeo(host);
            const endpoint = peerEndpointKey(address);
            const addrmanStatus: Peer['addrman_status'] = !this.knownAddressesAvailable || endpoint === null ? 'unavailable' :
                this.knownAddresses.has(endpoint) ? 'present' : 'not_returned';
            let locationStatus: Peer['location_status'] = 'pending';
            let location = 'Stalking...';
            if (['onion', 'i2p', 'cjdns'].includes(network) || isPrivateAddress(host)) { locationStatus = 'private'; location = 'PRIVATE'; }
            else if (geo?.status === 'ok') {
                const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
                const country = text(geo.countryCode) || text(geo.country);
                const locality = text(geo.city) || text(geo.regionName) || text(geo.region);
                locationStatus = 'ok'; location = [locality, country].filter(Boolean).join(', ');
            }
            else if (geo?.status === 'unavailable') { locationStatus = 'unavailable'; location = 'UNAVAILABLE'; }
            const services: string[] = peer.servicesnames || [];
            const rates = ratesFresh ? this.bandwidth.get(peer, rateNow) : { rx_bps: null, tx_bps: null };
            const result: Peer = {
                id: peer.id ?? null, network, ip: host, port, direction: peer.inbound ? 'IN' : 'OUT',
                subver: (peer.subver || '').replaceAll('/', ''),
                bytessent: peer.bytessent ?? 0, bytesrecv: peer.bytesrecv ?? 0,
                ...rates,
                bytessent_fmt: formatBytes(peer.bytessent ?? 0), bytesrecv_fmt: formatBytes(peer.bytesrecv ?? 0),
                ping_ms: typeof peer.pingtime === 'number' && peer.pingtime >= 0 && Number.isFinite(peer.pingtime * 1000) ? peer.pingtime * 1000 : null, conntime: peer.conntime ?? 0,
                conntime_fmt: peer.conntime ? formatDuration(Math.floor(observedAt) - peer.conntime) : '-',
                version: peer.version ?? 0, connection_type: peer.connection_type ?? '',
                connection_type_abbrev: abbreviateConnectionType(peer.connection_type || ''),
                services, services_abbrev: services.map(name => serviceNames[name] || name.slice(0, 2)).join(' '),
                in_addrman: addrmanStatus === 'present', addrman_status: addrmanStatus, location, location_status: locationStatus, addr: address,
                geo: metadata(geo?.status === 'ok' ? this.geoCache.get(host) : undefined),
                is_public: isPublicAddress(network, host),
                continent: geo?.continent ?? '',
                continentCode: geo?.continentCode ?? '',
                countryCode: geo?.countryCode ?? '',
                region: geo?.region ?? '',
                regionName: geo?.regionName ?? '',
                city: geo?.city ?? '',
                district: geo?.district ?? '',
                zip: geo?.zip ?? '',
                timezone: geo?.timezone ?? '',
                currency: geo?.currency ?? '',
                isp: geo?.isp ?? '',
                org: geo?.org ?? '',
                as: geo?.as ?? '',
                asname: geo?.asname ?? '',
                country: geo?.country ?? '',
                lat: geo?.lat ?? 0,
                lon: geo?.lon ?? 0,
                offset: geo?.offset ?? 0,
                mobile: geo?.mobile ?? false,
                proxy: geo?.proxy ?? false,
                hosting: geo?.hosting ?? false,
                minping: peer.minping ?? null,
                lastsend: peer.lastsend ?? null,
                lastrecv: peer.lastrecv ?? null,
                startingheight: peer.startingheight ?? null,
                synced_headers: peer.synced_headers ?? null,
                synced_blocks: peer.synced_blocks ?? null,
                addr_relay_enabled: peer.addr_relay_enabled ?? null,
                relaytxes: peer.relaytxes ?? null,
                minfeefilter: peer.minfeefilter ?? null,
                mapped_as: peer.mapped_as ?? null,
                transport_protocol_type: peer.transport_protocol_type ?? '',
                session_id: peer.session_id ?? '',
                addrlocal: peer.addrlocal ?? '',
                bip152_hb_from: peer.bip152_hb_from ?? false,
                bip152_hb_to: peer.bip152_hb_to ?? false,
                last_transaction: peer.last_transaction ?? 0,
                last_block: peer.last_block ?? 0,
                timeoffset: peer.timeoffset ?? 0,
                addr_processed: peer.addr_processed ?? 0,
                addr_rate_limited: peer.addr_rate_limited ?? 0,
                permissions: peer.permissions ?? [],
            };
            return result;
        });
    }
}
export function emptyGeo(status: string): CachedGeoData {
    return { status, continent: '', continentCode: '', country: '', countryCode: '', region: '', regionName: '', city: '', district: '', zip: '', lat: 0, lon: 0, timezone: '', offset: 0, currency: '', isp: '', org: '', as: '', asname: '', mobile: false, proxy: false, hosting: false };
}
