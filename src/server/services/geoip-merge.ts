import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { GEO_COLUMNS, GEO_SCHEMA, GEO_UPDATES } from './geoip-schema.ts';
import { normalizeDatasetRow } from './geoip-validation.ts';
import { errorMessage } from '../types.ts';
import type { GeoUpdateResult } from './geoip.ts';

export function mergeDataset(path: string, downloaded: string): GeoUpdateResult {
    const remote = new DatabaseSync(downloaded, { readOnly: true });
    try {
        remote.exec('PRAGMA trusted_schema=OFF');
        if (remote.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Downloaded database failed SQLite integrity validation');
        const schema = remote.prepare('PRAGMA table_info(geo_cache)').all().map(column => column.name);
        if (JSON.stringify(schema) !== JSON.stringify(GEO_COLUMNS) || remote.prepare("SELECT type FROM sqlite_master WHERE name='geo_cache'").get()?.type !== 'table') {
            throw new Error('Downloaded database has an unexpected geo_cache schema');
        }
        if (!Number(remote.prepare('SELECT COUNT(*) AS count FROM geo_cache').get()?.count)) throw new Error('Remote database is empty');
        const local = new DatabaseSync(path, { timeout: 5000 });
        try {
            local.exec(GEO_SCHEMA);
            local.exec('BEGIN IMMEDIATE');
            try {
                const before = Number(local.prepare('SELECT COUNT(*) AS count FROM geo_cache').get()!.count);
                const insert = local.prepare(`INSERT INTO geo_cache (${GEO_COLUMNS.join(',')}) VALUES (${GEO_COLUMNS.map(() => '?').join(',')})
                    ON CONFLICT(ip) DO UPDATE SET ${GEO_UPDATES}
                    WHERE COALESCE(excluded.last_updated, 0) > COALESCE(geo_cache.last_updated, 0)`);
                const rows = remote.prepare('SELECT * FROM geo_cache');
                // Read every SQLite integer so an unsafe value can be rejected per row.
                rows.setReadBigInts(true);
                let skipped = 0, valid = 0, changed = 0;
                for (const row of rows.iterate()) {
                    const numericRow = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]));
                    const normalized = normalizeDatasetRow(numericRow);
                    if (!normalized) { skipped++; continue; }
                    valid++;
                    changed += Number(insert.run(...GEO_COLUMNS.map(key => normalized[key] as SQLInputValue)).changes);
                }
                if (!valid) {
                    local.exec('ROLLBACK');
                    return { success: false, message: `Remote database has no valid geolocation records (${skipped} invalid rows skipped)`, skipped_rows: skipped };
                }
                const total = Number(local.prepare('SELECT COUNT(*) AS count FROM geo_cache').get()!.count);
                local.exec('COMMIT');
                const added = total - before, updated = changed - added;
                const message = added || updated
                    ? `+${added} new entries, ${updated} updated entries, ${skipped} invalid rows skipped (${total} total)`
                    : `Already up to date (${total} entries; 0 added, 0 updated, ${skipped} skipped)`;
                return { success: true, message, added_rows: added, updated_rows: updated, skipped_rows: skipped };
            } catch (error) { local.exec('ROLLBACK'); throw error; }
        } finally { local.close(); }
    } finally { remote.close(); }
}
if (!isMainThread) {
    try { parentPort!.postMessage(mergeDataset(workerData.path, workerData.downloaded)); }
    catch (error) { parentPort!.postMessage({ success: false, message: errorMessage(error), skipped_rows: 0 }); }
}
