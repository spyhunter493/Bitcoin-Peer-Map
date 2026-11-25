import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, chmodSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import {
    HISTORY_RETENTION_SECONDS,
    ALERT_RULES,
    type HistoryEvent,
    type HistoryBucket,
    type AlertIncident,
    type HistoryCoverage
} from './types.ts';

const {
    path,
    scope,
    limits = {}
} = workerData as { path: string; scope: string; limits?: { events?: number; buckets?: number } };
const MAX_EVENTS = limits.events ?? 250000,
    MAX_BUCKETS = limits.buckets ?? 45000;
const port = parentPort!;
let db: DatabaseSync;
let walBlocked = false;
try {
    mkdirSync(dirname(path), { recursive: true });
    const existed = existsSync(path);
    if (existed) {
        const stat = lstatSync(path);
        if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 256 * 1024 * 1024)
            throw new Error('Invalid history permissions or size');
    }
    db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if ((version !== 0 && version !== 1) || (existed && version === 0 && statSync(path).size > 0)) {
        db.close();
        throw new Error('Unsupported history version');
    }
    const pageSize = Number(db.prepare('PRAGMA page_size').get()!.page_size);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA max_page_count=${Math.floor((256 * 1024 * 1024) / pageSize)}; PRAGMA wal_autocheckpoint=256; PRAGMA journal_size_limit=8388608;
      CREATE TABLE IF NOT EXISTS metadata(scope TEXT PRIMARY KEY, history_revision INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 0, started_at REAL, dropped INTEGER NOT NULL DEFAULT 0, incomplete INTEGER NOT NULL DEFAULT 0, alert_revision INTEGER NOT NULL DEFAULT 0, rules TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, id TEXT NOT NULL, time REAL NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, address TEXT, peer_id INTEGER, reason TEXT NOT NULL, UNIQUE(scope,id));
      CREATE INDEX IF NOT EXISTS events_scope_seq ON events(scope,seq DESC);
      CREATE INDEX IF NOT EXISTS events_time ON events(time);
      CREATE TABLE IF NOT EXISTS buckets(scope TEXT NOT NULL,time INTEGER NOT NULL,inbound INTEGER NOT NULL,outbound INTEGER NOT NULL,networks TEXT NOT NULL,rx_bps REAL,tx_bps REAL,PRIMARY KEY(scope,time));
      CREATE TABLE IF NOT EXISTS incidents(scope TEXT NOT NULL,id TEXT NOT NULL,rule TEXT NOT NULL,state TEXT NOT NULL,raised_at REAL NOT NULL,resolved_at REAL,acknowledged_at REAL,message TEXT NOT NULL,PRIMARY KEY(scope,id));
      PRAGMA user_version=1;`);
    db.prepare('INSERT OR IGNORE INTO metadata(scope,rules) VALUES(?,?)').run(
        scope,
        JSON.stringify(Object.fromEntries(ALERT_RULES.map((rule) => [rule, true])))
    );
    port.postMessage({ ready: true });
} catch {
    port.postMessage({ ready: false, error: 'History storage is unavailable. Check saved data and permissions.' });
    port.close();
}

function meta() {
    return db.prepare('SELECT * FROM metadata WHERE scope=?').get(scope)! as Record<string, string | number | null>;
}
function coverage(from = 0): HistoryCoverage {
    const m = meta();
    const row = db
        .prepare(
            "SELECT MIN(time) oldest,MAX(time) newest,SUM(CASE WHEN kind IN ('monitoring_gap','clock_gap') THEN 1 ELSE 0 END) gaps FROM events WHERE scope=? AND time>=?"
        )
        .get(scope, from)!;
    return {
        recording: Boolean(m.enabled),
        started_at: m.started_at as number | null,
        oldest_at: row.oldest as number | null,
        newest_at: row.newest as number | null,
        gaps: Number(row.gaps ?? 0),
        dropped: Number(m.dropped),
        incomplete:
            !m.enabled ||
            Boolean(m.incomplete) ||
            m.started_at === null ||
            Number(m.started_at) > from ||
            Number(row.gaps ?? 0) > 0
    };
}
function prune(now: number) {
    db.prepare('DELETE FROM events WHERE time<?').run(now - HISTORY_RETENTION_SECONDS);
    db.prepare('DELETE FROM buckets WHERE time<?').run(now - HISTORY_RETENTION_SECONDS);
    const excess = db.prepare('SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?').get(MAX_EVENTS);
    if (excess) {
        db.prepare(
            'UPDATE metadata SET incomplete=1 WHERE scope IN (SELECT DISTINCT scope FROM events WHERE seq<=?)'
        ).run(excess.seq!);
        db.prepare('DELETE FROM events WHERE seq<=?').run(excess.seq!);
    }
    const bucketCut = db.prepare('SELECT time FROM buckets ORDER BY time DESC LIMIT 1 OFFSET ?').get(MAX_BUCKETS);
    if (bucketCut) {
        db.exec('UPDATE metadata SET incomplete=1');
        db.prepare('DELETE FROM buckets WHERE time<=?').run(bucketCut.time!);
    }
    db.prepare("DELETE FROM incidents WHERE state='resolved' AND resolved_at<?").run(now - HISTORY_RETENTION_SECONDS);
    db.exec(
        "DELETE FROM incidents WHERE rowid IN (SELECT rowid FROM incidents WHERE state='resolved' ORDER BY resolved_at DESC LIMIT -1 OFFSET 1000)"
    );
}
function maintainFiles() {
    for (const suffix of ['-wal', '-shm']) if (existsSync(path + suffix)) chmodSync(path + suffix, 0o600);
    if (existsSync(path + '-wal') && statSync(path + '-wal').size > 8 * 1024 * 1024) {
        const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()!;
        walBlocked = Number(checkpoint.busy) !== 0 || statSync(path + '-wal').size > 8 * 1024 * 1024;
        if (walBlocked) throw new Error('History checkpoint is blocked; optional recording is paused.');
    } else walBlocked = false;
}
const eventView = (row: Record<string, unknown>): HistoryEvent => ({
    id: String(row.id),
    time: Number(row.time),
    source: row.source as HistoryEvent['source'],
    kind: String(row.kind),
    address: row.address as string | null,
    peer_id: row.peer_id as number | null,
    reason: String(row.reason)
});
function perform(op: string, data: Record<string, unknown>) {
    if (op === 'coverage') return coverage(Number(data.from ?? 0));
    if (op === 'settings') {
        const m = meta();
        return { revision: m.history_revision, enabled: Boolean(m.enabled), retention_days: 30 };
    }
    if (op === 'configure') {
        const m = meta();
        if (m.history_revision !== data.expected_revision)
            throw Object.assign(new Error('History settings changed. Reload before saving.'), { status: 409 });
        if (Boolean(m.enabled) === data.enabled) return perform('settings', {});
        db.prepare(
            'UPDATE metadata SET enabled=?,history_revision=history_revision+1,started_at=CASE WHEN ? THEN ? ELSE started_at END WHERE scope=?'
        ).run(data.enabled ? 1 : 0, data.enabled ? 1 : 0, Number(data.now), scope);
        return perform('settings', {});
    }
    if (op === 'append') {
        if (walBlocked) maintainFiles();
        // Accepted observations retain their opt-in authority when a priority
        // disable command overtakes their queued write.
        if (!meta().enabled && !data.recorded) return coverage();
        db.exec('BEGIN IMMEDIATE');
        try {
            const insert = db.prepare(
                'INSERT OR IGNORE INTO events(scope,id,time,source,kind,address,peer_id,reason) VALUES(?,?,?,?,?,?,?,?)'
            );
            for (const e of (data.events ?? []) as HistoryEvent[])
                insert.run(scope, e.id, e.time, e.source, e.kind, e.address, e.peer_id, e.reason);
            const bucket = data.bucket as HistoryBucket | undefined;
            if (bucket)
                db.prepare('INSERT OR REPLACE INTO buckets VALUES(?,?,?,?,?,?,?)').run(
                    scope,
                    bucket.time,
                    bucket.inbound,
                    bucket.outbound,
                    JSON.stringify(bucket.networks),
                    bucket.rx_bps,
                    bucket.tx_bps
                );
            db.prepare(
                'UPDATE metadata SET dropped=dropped+?,incomplete=CASE WHEN ?>0 THEN 1 ELSE incomplete END WHERE scope=?'
            ).run(Number(data.dropped ?? 0), Number(data.dropped ?? 0), scope);
            prune(Number(data.now));
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        maintainFiles();
        return coverage();
    }
    if (op === 'events') {
        const conditions = ['scope=?', 'time>=?'],
            args: (string | number)[] = [scope, Number(data.from)];
        if (data.cursor) {
            conditions.push('seq<?');
            args.push(Number(data.cursor));
        }
        for (const field of ['source', 'kind'] as const)
            if (data[field]) {
                conditions.push(field + '=?');
                args.push(String(data[field]));
            }
        if (data.search) {
            conditions.push("(instr(lower(COALESCE(address,'')),?)>0 OR instr(lower(reason),?)>0)");
            args.push(String(data.search).toLowerCase(), String(data.search).toLowerCase());
        }
        const limit = Number(data.limit),
            rows = db
                .prepare(`SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY seq DESC LIMIT ?`)
                .all(...args, limit + 1);
        return {
            events: rows.slice(0, limit).map(eventView),
            next_cursor: rows.length > limit ? String(rows[limit - 1].seq) : null,
            coverage: coverage(Number(data.from))
        };
    }
    if (op === 'trends') {
        const rows = db
            .prepare('SELECT * FROM buckets WHERE scope=? AND time>=? ORDER BY time')
            .all(scope, Number(data.from));
        const width = Math.max(60, Math.ceil(Number(data.seconds) / 1000 / 60) * 60),
            groups = new Map<
                number,
                {
                    count: number;
                    inbound: number;
                    outbound: number;
                    networks: Record<string, number>;
                    rx: number;
                    rxn: number;
                    tx: number;
                    txn: number;
                }
            >();
        for (const row of rows) {
            const time = Math.floor(Number(row.time) / width) * width;
            const g = groups.get(time) ?? {
                count: 0,
                inbound: 0,
                outbound: 0,
                networks: {},
                rx: 0,
                rxn: 0,
                tx: 0,
                txn: 0
            };
            g.count++;
            g.inbound += Number(row.inbound);
            g.outbound += Number(row.outbound);
            for (const [key, value] of Object.entries(JSON.parse(String(row.networks)) as Record<string, number>))
                g.networks[key] = (g.networks[key] ?? 0) + value;
            if (row.rx_bps !== null) {
                g.rx += Number(row.rx_bps);
                g.rxn++;
            }
            if (row.tx_bps !== null) {
                g.tx += Number(row.tx_bps);
                g.txn++;
            }
            groups.set(time, g);
        }
        return {
            buckets: [...groups].map(([time, g]) => ({
                time,
                inbound: g.inbound / g.count,
                outbound: g.outbound / g.count,
                networks: Object.fromEntries(Object.entries(g.networks).map(([k, v]) => [k, v / g.count])),
                rx_bps: g.rxn ? g.rx / g.rxn : null,
                tx_bps: g.txn ? g.tx / g.txn : null
            })),
            coverage: coverage(Number(data.from))
        };
    }
    if (op === 'summary') {
        const row = db
            .prepare(
                "SELECT SUM(kind='succeeded') accepted_requests,SUM(kind='departure_observed') observed_departures,SUM(kind='same_host_return') same_host_returns FROM events WHERE scope=? AND source='policy' AND time>=?"
            )
            .get(scope, Number(data.from))!;
        return {
            window: data.window,
            accepted_requests: Number(row.accepted_requests ?? 0),
            observed_departures: Number(row.observed_departures ?? 0),
            same_host_returns: Number(row.same_host_returns ?? 0),
            coverage: coverage(Number(data.from))
        };
    }
    if (op === 'alertSettings') {
        const m = meta();
        return { revision: m.alert_revision, rules: JSON.parse(String(m.rules)) };
    }
    if (op === 'configureAlerts') {
        if (meta().alert_revision !== data.expected_revision)
            throw Object.assign(new Error('Alert settings changed. Reload before saving.'), { status: 409 });
        db.prepare('UPDATE metadata SET alert_revision=alert_revision+1,rules=? WHERE scope=?').run(
            JSON.stringify(data.rules),
            scope
        );
        return perform('alertSettings', {});
    }
    if (op === 'incidents')
        return db
            .prepare(
                'SELECT id,rule,state,raised_at,resolved_at,acknowledged_at,message FROM incidents WHERE scope=? ORDER BY raised_at DESC LIMIT 1004'
            )
            .all(scope);
    if (op === 'incident') {
        const i = data.incident as AlertIncident;
        db.prepare('INSERT OR REPLACE INTO incidents VALUES(?,?,?,?,?,?,?,?)').run(
            scope,
            i.id,
            i.rule,
            i.state,
            i.raised_at,
            i.resolved_at,
            i.acknowledged_at,
            i.message
        );
        prune(Number(data.now));
        maintainFiles();
        return true;
    }
    if (op === 'prune') {
        prune(Number(data.now));
        maintainFiles();
        return true;
    }
    if (op === 'close') {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db.close();
        return true;
    }
    throw new Error('Unknown monitoring operation');
}
port.on('message', ({ id, op, data }: { id: number; op: string; data: Record<string, unknown> }) => {
    try {
        port.postMessage({ id, result: perform(op, data) });
        if (op === 'close') port.close();
    } catch (error) {
        const e = error as Error & { status?: number };
        port.postMessage({
            id,
            error: e.status === 409 ? e.message : 'History storage is unavailable. Check saved data and permissions.',
            status: e.status ?? 503
        });
    }
});
