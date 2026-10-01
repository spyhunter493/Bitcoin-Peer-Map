import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { GEO_COLUMNS, GEO_SCHEMA, GEO_UPDATES } from './geoip-schema.ts';
import { type Data, errorMessage, nowSeconds, object } from '../types.ts';

export { GEO_COLUMNS } from './geoip-schema.ts';
export const GEOIP_DATASET_URL = 'https://raw.githubusercontent.com/mbhillrn/Bitcoin-Node-GeoIP-Dataset/main/geo.db';
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
export function isValidGeoData(data: unknown): data is Data {
    if (!object(data) || data.lat == null || data.lon == null || !String(data.country || '').trim()) return false;
    const lat = Number(data.lat), lon = Number(data.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}
export class GeoDatabase {
    readonly enabled: boolean;
    readonly path: string;
    readonly tempDir: string;
    readonly signal?: AbortSignal;
    generation = 0;
    private database: DatabaseSync | null = null;
    private cachedStats: Data | null = null;
    private updating = false;
    constructor(dataDir: string, enabled: boolean, signal?: AbortSignal) {
        this.enabled = enabled; this.path = join(dataDir, 'geo.db'); this.tempDir = join(dataDir, 'tmp'); this.signal = signal;
    }
    initialize() {
        if (!this.enabled) return;
        mkdirSync(this.tempDir, { recursive: true });
        for (const entry of readdirSync(this.tempDir, { withFileTypes: true })) if (entry.isFile()) rmSync(join(this.tempDir, entry.name));
        this.database = new DatabaseSync(this.path);
        this.database.exec(GEO_SCHEMA);
    }
    close() { this.database?.close(); this.database = null; }
    datasetChanged() { this.generation++; this.cachedStats = null; }
    stats(): Data {
        if (this.cachedStats) return { ...this.cachedStats };
        const result: Data = { status: 'disabled', entries: 0, size_bytes: 0, last_updated: null, oldest_updated: null, db_path: this.path };
        if (!this.enabled) return result;
        if (!existsSync(this.path)) return { ...result, status: 'not_found' };
        try {
            if (!this.database) this.database = new DatabaseSync(this.path);
            const stats = this.database.prepare('SELECT COUNT(*) AS entries, MAX(last_updated) AS last_updated, MIN(CASE WHEN last_updated > 0 THEN last_updated END) AS oldest_updated FROM geo_cache').get();
            this.cachedStats = { ...result, ...stats, status: 'ok', size_bytes: statSync(this.path).size };
            return { ...this.cachedStats };
        } catch (error) { return { ...result, status: 'error', error: errorMessage(error) }; }
    }
    get(ip: string): Data | null {
        if (!this.enabled || !existsSync(this.path)) return null;
        try {
            if (!this.database) this.database = new DatabaseSync(this.path);
            const row = this.database.prepare('SELECT * FROM geo_cache WHERE ip = ?').get(ip);
            return row ? { ...row } : null;
        } catch { return null; }
    }
    save(ip: string, data: Data) {
        if (!this.enabled || !this.database || !isValidGeoData(data)) return;
        const record: Data = { ...data, ip, utc_offset: data.offset ?? 0, as_info: data.as ?? '', last_updated: Math.floor(nowSeconds()) };
        const values: SQLInputValue[] = GEO_COLUMNS.map(key => ['mobile', 'proxy', 'hosting'].includes(key) ? Number(Boolean(record[key])) : record[key] ?? '');
        try {
            this.database.prepare(`INSERT INTO geo_cache (${GEO_COLUMNS.join(',')}) VALUES (${GEO_COLUMNS.map(() => '?').join(',')}) ON CONFLICT(ip) DO UPDATE SET ${GEO_UPDATES}`).run(...values);
            this.cachedStats = null;
        } catch (error) { console.error(`Could not save geolocation for ${ip}: ${errorMessage(error)}`); }
    }
    async update(fetcher: typeof fetch = fetch, maxBytes = MAX_DOWNLOAD_BYTES): Promise<{ success: boolean; message: string }> {
        if (!this.enabled) return { success: false, message: 'Geo database is disabled' };
        if (this.updating) return { success: false, message: 'Geo database update already in progress' };
        this.updating = true;
        const temporary = join(this.tempDir, `geo-download-${randomUUID()}.db`);
        const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(this.signal ? [this.signal] : [])]);
        try {
            mkdirSync(this.tempDir, { recursive: true });
            const response = await fetcher(GEOIP_DATASET_URL, { signal });
            try {
                if (response.status !== 200) throw new Error(`Download failed (HTTP ${response.status})`);
                const length = response.headers.get('Content-Length');
                if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error('Downloaded database exceeds the size limit or has an invalid Content-Length');
                if (!response.body) throw new Error('Remote database is empty');
                const output = await open(temporary, 'wx', 0o600);
                let downloaded = 0;
                try {
                    for await (const chunk of response.body) {
                        downloaded += chunk.length;
                        if (downloaded > maxBytes) throw new Error('Downloaded database exceeds the 100 MiB size limit');
                        await output.writeFile(chunk);
                    }
                } finally { await output.close(); }
            } finally { if (!response.bodyUsed) await response.body?.cancel(); }
            signal.throwIfAborted();
            // Dataset validation and its potentially large transaction run off the HTTP event loop.
            const result = await new Promise<{ success: boolean; message: string }>((resolve, reject) => {
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
        } catch (error) { return { success: false, message: errorMessage(error) }; }
        finally { try { await rm(temporary, { force: true }); } finally { this.updating = false; } }
    }
}
