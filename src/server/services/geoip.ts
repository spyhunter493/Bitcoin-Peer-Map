import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { GEO_COLUMNS, GEO_SCHEMA, GEO_UPDATES, GEO_PROVENANCE_SCHEMA, GEO_RECORD_QUERY, GEO_PROVENANCE_WRITE } from './geoip-schema.ts';
import { type Data, errorMessage, nowSeconds, object } from '../types.ts';
import { createFailureReporter, createLogger } from '../logging.ts';
import { sleep } from '../tasks.ts';
import { isValidGeoData, type ValidGeoData } from './geoip-validation.ts';
import type { OutboundPolicy } from '../outbound-policy.ts';

export { GEO_COLUMNS } from './geoip-schema.ts';
export { isValidGeoData } from './geoip-validation.ts';
export const GEOIP_DATASET_URL = 'https://raw.githubusercontent.com/mbhillrn/Bitcoin-Node-GeoIP-Dataset/main/geo.db';
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
export const GEO_SAVE_RETRY_BUDGET_MS = 65_000;
export type GeoSaveResult = { status: 'saved' | 'superseded'; row: ValidGeoData }
    | { status: 'disabled' | 'cancelled' }
    | { status: 'failed'; message: string };
export type GeoReadResult = { status: 'hit'; row: Data }
    | { status: 'miss' | 'disabled' }
    | { status: 'error'; message: string };
export type { GeoUpdateResponse as GeoUpdateResult } from '../api-types.ts';
import type { GeoUpdateResponse as GeoUpdateResult, GeoDatabaseStats } from '../api-types.ts';
const isBusy = (error: unknown) => object(error) && typeof error.errcode === 'number' && [5, 6].includes(error.errcode & 255);
export class GeoDatabase {
    readonly enabled: boolean;
    readonly path: string;
    readonly tempDir: string;
    readonly signal: AbortSignal;
    generation = 0;
    private database: DatabaseSync | null = null;
    private cachedStats: GeoDatabaseStats | null = null;
    private updating = false;
    private controller = new AbortController();
    private saveFailures = createFailureReporter(createLogger('geoip'));
    private readonly outbound?: OutboundPolicy;
    constructor(dataDir: string, enabled: boolean, signal?: AbortSignal, outbound?: OutboundPolicy) {
        this.enabled = enabled; this.path = join(dataDir, 'geo.db'); this.tempDir = join(dataDir, 'tmp');
        this.signal = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
        this.outbound = outbound;
    }
    initialize() {
        if (!this.enabled) return;
        this.signal.throwIfAborted();
        mkdirSync(this.tempDir, { recursive: true });
        for (const entry of readdirSync(this.tempDir, { withFileTypes: true })) if (entry.isFile()) rmSync(join(this.tempDir, entry.name));
        this.database = new DatabaseSync(this.path);
        this.database.exec(GEO_SCHEMA);
        this.database.exec(GEO_PROVENANCE_SCHEMA);
    }
    close() { this.controller.abort(); this.database?.close(); this.database = null; }
    datasetChanged() { this.generation++; this.cachedStats = null; }
    stats(): GeoDatabaseStats {
        if (this.cachedStats) return { ...this.cachedStats };
        const result: GeoDatabaseStats = { status: 'disabled', entries: 0, size_bytes: 0, last_updated: null, oldest_updated: null, db_path: this.path };
        if (!this.enabled) return result;
        if (this.signal.aborted) return { ...result, status: 'closed' };
        if (!existsSync(this.path)) return { ...result, status: 'not_found' };
        try {
            if (!this.database) {
                this.database = new DatabaseSync(this.path);
                this.database.exec(GEO_PROVENANCE_SCHEMA);
            }
            // SQLite COUNT is numeric and these two integer timestamp aggregates are nullable.
            const stats = this.database.prepare('SELECT COUNT(*) AS entries, MAX(last_updated) AS last_updated, MIN(CASE WHEN last_updated > 0 THEN last_updated END) AS oldest_updated FROM geo_cache').get() as Pick<GeoDatabaseStats, 'entries' | 'last_updated' | 'oldest_updated'>;
            this.cachedStats = { ...result, ...stats, status: 'ok', size_bytes: statSync(this.path).size };
            return { ...this.cachedStats };
        } catch (error) { return { ...result, status: 'error', error: errorMessage(error) }; }
    }
    get(ip: string): Data | null {
        const result = this.read(ip);
        return result.status === 'hit' ? result.row : null;
    }
    read(ip: string): GeoReadResult {
        if (!this.enabled || this.signal.aborted) return { status: 'disabled' };
        if (!existsSync(this.path)) return { status: 'miss' };
        try {
            if (!this.database) {
                this.database = new DatabaseSync(this.path);
                this.database.exec(GEO_PROVENANCE_SCHEMA);
            }
            const row = this.database.prepare(GEO_RECORD_QUERY).get(ip);
            return row ? { status: 'hit', row: { ...row } } : { status: 'miss' };
        } catch (error) { return { status: 'error', message: errorMessage(error) }; }
    }
    async save(ip: string, data: Data, observedAt = Math.floor(nowSeconds()), signal?: AbortSignal): Promise<GeoSaveResult> {
        if (!this.enabled) return { status: 'disabled' };
        const cancellation = signal ? AbortSignal.any([this.signal, signal]) : this.signal;
        if (cancellation.aborted) return { status: 'cancelled' };
        if (!this.database || !isValidGeoData(data) || !Number.isSafeInteger(observedAt) || observedAt < 0) return { status: 'failed', message: 'Invalid geolocation data or database is not initialized' };
        // Preserve the observation time across retries so a delayed write cannot replace newer data.
        const record: Data = { ...data, ip, lat: Number(data.lat), lon: Number(data.lon), utc_offset: data.offset ?? 0, as_info: data.as ?? '', last_updated: observedAt };
        const values: SQLInputValue[] = GEO_COLUMNS.map(key => {
            if (['mobile', 'proxy', 'hosting'].includes(key)) return Number(Boolean(record[key]));
            const value = record[key];
            return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : '';
        });
        const deadline = performance.now() + GEO_SAVE_RETRY_BUDGET_MS;
        let delay = 50;
        while (!cancellation.aborted && this.database) {
            try {
                this.database.exec('BEGIN IMMEDIATE');
                try {
                    const result = this.database.prepare(`INSERT INTO geo_cache (${GEO_COLUMNS.join(',')}) VALUES (${GEO_COLUMNS.map(() => '?').join(',')})
                        ON CONFLICT(ip) DO UPDATE SET ${GEO_UPDATES}
                        WHERE COALESCE(excluded.last_updated, 0) > COALESCE(geo_cache.last_updated, 0)`).run(...values);
                    if (Number(result.changes)) this.database.prepare(GEO_PROVENANCE_WRITE).run(ip, 'ip_api', observedAt);
                    const row = this.database.prepare(GEO_RECORD_QUERY).get(ip);
                    if (!row) throw new Error('Geolocation write did not return a stored record');
                    if (!isValidGeoData(row)) throw new Error('Stored geolocation winner contains invalid location data');
                    this.database.exec('COMMIT');
                    if (Number(result.changes)) this.cachedStats = null;
                    this.saveFailures.recovered('Geolocation database writes recovered');
                    return { status: Number(result.changes) ? 'saved' : 'superseded', row: { ...row } };
                } catch (error) { this.database.exec('ROLLBACK'); throw error; }
            } catch (error) {
                const remaining = deadline - performance.now();
                if (isBusy(error) && remaining > 0) {
                    await sleep(Math.min(delay, remaining), cancellation);
                    delay = Math.min(500, delay * 2);
                    continue;
                }
                const message = errorMessage(error);
                this.saveFailures.failure(`Could not save geolocation for ${ip}: ${message}`, 'error');
                return { status: 'failed', message };
            }
        }
        return { status: 'cancelled' };
    }
    async update(fetcher: typeof fetch = fetch, maxBytes = MAX_DOWNLOAD_BYTES): Promise<GeoUpdateResult> {
        if (!this.enabled) return { success: false, message: 'Geo database is disabled', skipped_rows: 0 };
        if (this.outbound && !this.outbound.allowed('dataset')) return { success: false, message: 'Optional dataset downloads are disabled', skipped_rows: 0 };
        if (this.updating) return { success: false, message: 'Geo database update already in progress', skipped_rows: 0 };
        this.updating = true;
        const temporary = join(this.tempDir, `geo-download-${randomUUID()}.db`);
        const signal = AbortSignal.any([AbortSignal.timeout(60_000), this.signal]);
        const downloadSignal = this.outbound ? AbortSignal.any([signal, this.outbound.signal('dataset')]) : signal;
        try {
            downloadSignal.throwIfAborted();
            mkdirSync(this.tempDir, { recursive: true });
            const response = await fetcher(GEOIP_DATASET_URL, { signal: downloadSignal, redirect: 'manual' });
            try {
                downloadSignal.throwIfAborted();
                if (response.status !== 200) throw new Error(`Download failed (HTTP ${response.status})`);
                const length = response.headers.get('Content-Length');
                if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error('Downloaded database exceeds the size limit or has an invalid Content-Length');
                if (!response.body) throw new Error('Remote database is empty');
                const output = await open(temporary, 'wx', 0o600);
                let downloaded = 0;
                try {
                    for await (const chunk of response.body) {
                        downloadSignal.throwIfAborted();
                        downloaded += chunk.length;
                        if (downloaded > maxBytes) throw new Error('Downloaded database exceeds the 100 MiB size limit');
                        await output.writeFile(chunk);
                    }
                } finally { await output.close(); }
            } finally { if (!response.bodyUsed) await response.body?.cancel(); }
            downloadSignal.throwIfAborted();
            // Dataset validation and its potentially large transaction run off the HTTP event loop.
            const result = await new Promise<GeoUpdateResult>((resolve, reject) => {
                const worker = new Worker(new URL('./geoip-merge.ts', import.meta.url), { workerData: { path: this.path, downloaded: temporary } });
                const abort = () => { void worker.terminate().then(() => reject(new Error('GeoIP update cancelled'))); };
                signal.addEventListener('abort', abort, { once: true });
                let received = false;
                worker.once('message', result => { received = true; resolve(result); });
                worker.once('error', reject);
                worker.once('exit', code => {
                    signal.removeEventListener('abort', abort);
                    if (!received) reject(new Error(`GeoIP merge worker stopped (${code})`));
                });
                if (signal.aborted) abort();
            });
            if (result.success) this.datasetChanged();
            return result;
        } catch (error) { return { success: false, message: downloadSignal.aborted && !signal.aborted ? 'Optional dataset download cancelled' : errorMessage(error), skipped_rows: 0 }; }
        finally {
            try {
                // Reading a WAL-mode download can create sidecars even through a read-only connection.
                await Promise.all([temporary, `${temporary}-wal`, `${temporary}-shm`].map(path => rm(path, { force: true })));
            } finally { this.updating = false; }
        }
    }
}
