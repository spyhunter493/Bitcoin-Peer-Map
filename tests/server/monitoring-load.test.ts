import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MonitoringStore } from '../../src/server/monitoring/store.ts';
import type { HistoryPage, HistoryTrends } from '../../src/server/monitoring/types.ts';

test('retention-scale history remains bounded and returns small paginated/aggregated responses', { timeout: 30000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bpm-history-load-'));
    const now = Math.floor(Date.now() / 60000) * 60;
    let store = new MonitoringStore(directory, 'load-test');
    try {
        await store.start();
        await store.request('configure', { expected_revision: 0, enabled: true, now });
        await store.close();
        const db = new DatabaseSync(join(directory, 'history.db'));
        try {
            db.exec('BEGIN');
            const event = db.prepare('INSERT INTO events(scope,id,time,source,kind,address,peer_id,reason) VALUES(?,?,?,?,?,?,?,?)');
            for (let i = 0; i < 250001; i++) event.run('load-test', `seed-${i}`, now - i % 43200 * 60, 'peer', 'arrived', '198.51.100.1:8333', i % 2000, 'Synthetic retained observation.');
            const bucket = db.prepare('INSERT INTO buckets(scope,time,inbound,outbound,networks,rx_bps,tx_bps) VALUES(?,?,?,?,?,?,?)');
            for (let i = 0; i < 45001; i++) bucket.run('load-test', now - i * 60, 40, 12, '{"ipv4":40,"onion":12}', 1000, i % 15 ? 2000 : null);
            db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');
        } finally { db.close(); }
        store = new MonitoringStore(directory, 'load-test');
        await store.start();
        await store.request('append', { events: [{ id: 'newest', time: now, source: 'peer', kind: 'arrived', address: null, peer_id: null, reason: 'Synthetic newest event.' }], now, recorded: true });
        const query = { from: now - 30 * 86400, seconds: 30 * 86400, limit: 100, cursor: '', source: '', kind: '', search: '', window: '30d' };
        const [events, trends] = await Promise.all([
            store.request<HistoryPage>('events', query),
            store.request<HistoryTrends>('trends', query),
        ]);
        assert.equal(events.events.length, 100);
        assert.equal(events.events[0].id, 'newest');
        assert.ok(events.next_cursor);
        assert.ok(trends.buckets.length > 0 && trends.buckets.length <= 1000);
        assert.ok(Buffer.byteLength(JSON.stringify(events)) < 100000, 'a page never transfers the retained event archive');
        assert.ok(Buffer.byteLength(JSON.stringify(trends)) < 500000, 'the chart receives bounded aggregated buckets');
        await store.close();
        const checked = new DatabaseSync(join(directory, 'history.db'), { readOnly: true });
        try {
            assert.ok(Number(checked.prepare('SELECT COUNT(*) count FROM events').get()!.count) <= 250000);
            assert.ok(Number(checked.prepare('SELECT COUNT(*) count FROM buckets').get()!.count) <= 45000);
            assert.ok(Number(checked.prepare('SELECT MIN(time) time FROM buckets').get()!.time) >= now - 30 * 86400);
        } finally { checked.close(); }
        assert.ok(statSync(join(directory, 'history.db')).size <= 256 * 1024 * 1024);
    } finally { await store.close(); rmSync(directory, { recursive: true, force: true }); }
});
