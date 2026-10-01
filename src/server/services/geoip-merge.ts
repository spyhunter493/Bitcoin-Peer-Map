import { DatabaseSync } from 'node:sqlite';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { GEO_COLUMNS, GEO_SCHEMA, GEO_UPDATES } from './geoip-schema.ts';
import { errorMessage } from '../types.ts';

export function mergeDataset(path: string, downloaded: string) {
    const remote = new DatabaseSync(downloaded, { readOnly: true });
    try {
        remote.exec('PRAGMA trusted_schema=OFF');
        if (remote.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Downloaded database failed SQLite integrity validation');
        const schema = remote.prepare('PRAGMA table_info(geo_cache)').all().map(column => column.name);
        if (JSON.stringify(schema) !== JSON.stringify(GEO_COLUMNS) || remote.prepare("SELECT type FROM sqlite_master WHERE name='geo_cache'").get()?.type !== 'table') {
            throw new Error('Downloaded database has an unexpected geo_cache schema');
        }
        if (!Number(remote.prepare('SELECT COUNT(*) AS count FROM geo_cache').get()?.count)) throw new Error('Remote database is empty');
    } finally { remote.close(); }
    const local = new DatabaseSync(path, { timeout: 5000 });
    try {
        local.exec(GEO_SCHEMA);
        local.prepare('ATTACH DATABASE ? AS downloaded').run(downloaded);
        local.exec('BEGIN IMMEDIATE');
        try {
            const before = Number(local.prepare('SELECT COUNT(*) AS count FROM geo_cache').get()!.count);
            const result = local.prepare(`INSERT INTO geo_cache (${GEO_COLUMNS.join(',')})
                SELECT ${GEO_COLUMNS.join(',')} FROM downloaded.geo_cache WHERE true
                ON CONFLICT(ip) DO UPDATE SET ${GEO_UPDATES}
                WHERE COALESCE(excluded.last_updated, 0) > COALESCE(geo_cache.last_updated, 0)`).run();
            const total = Number(local.prepare('SELECT COUNT(*) AS count FROM geo_cache').get()!.count);
            local.exec('COMMIT');
            const added = total - before;
            const updated = Number(result.changes) - added;
            const changes = [added ? `+${added} new entries` : '', updated ? `${updated} updated entries` : ''].filter(Boolean);
            return { success: true, message: changes.length ? `${changes.join(', ')} (${total} total)` : `Already up to date (${total} entries)` };
        } catch (error) { local.exec('ROLLBACK'); throw error; }
    } finally { local.close(); }
}
if (!isMainThread) {
    try { parentPort!.postMessage(mergeDataset(workerData.path, workerData.downloaded)); }
    catch (error) { parentPort!.postMessage({ success: false, message: errorMessage(error) }); }
}
