import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MonitoringStore } from '../../src/server/monitoring/store.ts';
import type { HistoryPage, HistoryTrends, HistorySettings } from '../../src/server/monitoring/types.ts';
import { temporaryDirectory } from './helpers.ts';

const event = (id: string, time: number) => ({
    id,
    time,
    source: 'peer',
    kind: 'arrived',
    address: '198.51.100.1:8333',
    peer_id: 1,
    reason: 'Observed connection.'
});
test('history storage is opt-in, idempotent, private and persistent; no-op saves preserve the recording start', async (t) => {
    const dir = temporaryDirectory(t),
        store = new MonitoringStore(dir, 'node-a');
    await store.start();
    assert.deepEqual(await store.request('settings'), { revision: 0, enabled: false, retention_days: 30 });
    await store.request('append', { events: [event('disabled', 100)], now: 100 });
    assert.equal((await store.request<HistoryPage>('events', { from: 0, limit: 50 })).events.length, 0);
    await store.request('configure', { expected_revision: 0, enabled: true, now: 100 });
    assert.deepEqual(await store.request('configure', { expected_revision: 1, enabled: true, now: 200 }), {
        revision: 1,
        enabled: true,
        retention_days: 30
    });
    await store.request('append', { events: [event('one', 101), event('one', 101)], now: 101 });
    const page = await store.request<HistoryPage>('events', { from: 100, limit: 50 });
    assert.equal(page.events.length, 1);
    assert.equal(page.coverage.started_at, 100);
    assert.equal(page.coverage.gaps, 0);
    assert.equal(page.coverage.incomplete, false);
    assert.equal(statSync(join(dir, 'history.db')).mode & 0o077, 0);
    await assert.rejects(store.request('configure', { expected_revision: 0, enabled: false, now: 201 }), {
        status: 409
    });
    await store.close();
    const restarted = new MonitoringStore(dir, 'node-a');
    await restarted.start();
    assert.equal((await restarted.request<HistoryPage>('events', { from: 0, limit: 50 })).events.length, 1);
    await restarted.close();
    const different = new MonitoringStore(dir, 'node-b');
    await different.start();
    assert.equal((await different.request<HistorySettings>('settings')).enabled, false);
    assert.equal((await different.request<HistoryPage>('events', { from: 0, limit: 50 })).events.length, 0);
    await different.close();
});
test('cursor pagination stays anchored while new events arrive and retention caps report incomplete coverage', async (t) => {
    const store = new MonitoringStore(temporaryDirectory(t), 'node', { events: 3, buckets: 2 });
    t.after(() => store.close());
    await store.start();
    await store.request('configure', { expected_revision: 0, enabled: true, now: 100 });
    await store.request('append', { events: [event('a', 100), event('b', 101), event('c', 102)], now: 102 });
    const first = await store.request<HistoryPage>('events', { from: 0, limit: 2 });
    assert.deepEqual(
        first.events.map((e) => e.id),
        ['c', 'b']
    );
    await store.request('append', { events: [event('d', 103)], now: 103 });
    const older = await store.request<HistoryPage>('events', { from: 0, limit: 2, cursor: first.next_cursor });
    assert.deepEqual(older.events, []);
    assert.equal(older.coverage.incomplete, true);
    const recent = await store.request<HistoryPage>('events', { from: 0, limit: 10 });
    assert.deepEqual(
        recent.events.map((e) => e.id),
        ['d', 'c', 'b']
    );
    await store.request('prune', { now: 31 * 86400 });
    assert.equal((await store.request<HistoryPage>('events', { from: 0, limit: 10 })).events.length, 0);
});
test('trend payloads are bounded and preserve unavailable traffic independently of peer counts', async (t) => {
    const store = new MonitoringStore(temporaryDirectory(t), 'node');
    t.after(() => store.close());
    await store.start();
    await store.request('configure', { expected_revision: 0, enabled: true, now: 0 });
    for (let i = 0; i < 1100; i++)
        await store.request('append', {
            events: [],
            bucket: {
                time: i * 60,
                inbound: 5,
                outbound: 4,
                networks: { ipv4: 9 },
                rx_bps: i % 2 ? 20 : null,
                tx_bps: null
            },
            now: i * 60
        });
    const trends = await store.request<HistoryTrends>('trends', { from: 0, seconds: 1100 * 60 });
    assert.ok(trends.buckets.length <= 1000);
    assert.equal(trends.buckets[0].inbound, 5);
    assert.equal(trends.buckets[0].tx_bps, null);
    assert.equal(trends.buckets[0].rx_bps, 20);
});
test('corrupt, insecure, and future-version databases are retained without being silently reset', async (t) => {
    for (const kind of ['corrupt', 'insecure', 'future']) {
        const dir = temporaryDirectory(t),
            file = join(dir, 'history.db');
        if (kind === 'corrupt') writeFileSync(file, 'retained evidence', { mode: 0o600 });
        else {
            const db = new DatabaseSync(file);
            if (kind === 'future') db.exec('PRAGMA user_version=99');
            db.close();
            chmodSync(file, kind === 'insecure' ? 0o644 : 0o600);
        }
        const before = readFileSync(file),
            store = new MonitoringStore(dir, 'node');
        await assert.rejects(store.start(), { status: 503 });
        await store.close();
        assert.deepEqual(readFileSync(file), before);
    }
});

test('a pinned WAL reader pauses optional recording visibly without blocking settings and recovers after release', async (t) => {
    const dir = temporaryDirectory(t),
        store = new MonitoringStore(dir, 'node');
    t.after(() => store.close());
    await store.start();
    await store.request('configure', { expected_revision: 0, enabled: true, now: 1000 });
    const reader = new DatabaseSync(join(dir, 'history.db'));
    t.after(() => reader.close());
    reader.exec('BEGIN');
    reader.prepare('SELECT COUNT(*) FROM events').get();
    let blocked = false;
    for (let batch = 0; batch < 100 && !blocked; batch++) {
        const events = Array.from({ length: 100 }, (_, i) => ({
            ...event(`${batch}-${i}`, 1000),
            reason: 'x'.repeat(512)
        }));
        try {
            await store.request('append', { events, now: 1000, recorded: true }, true);
        } catch (error) {
            assert.equal((error as { status: number }).status, 503);
            blocked = true;
        }
    }
    assert.equal(blocked, true);
    assert.notEqual(store.error, null);
    const before = statSync(join(dir, 'history.db-wal')).size;
    await assert.rejects(
        store.request('append', { events: [event('blocked', 1000)], now: 1000, recorded: true }, true),
        { status: 503 }
    );
    assert.equal(statSync(join(dir, 'history.db-wal')).size, before);
    assert.equal((await store.request<HistorySettings>('settings')).enabled, true);
    assert.notEqual(store.error, null);
    reader.exec('ROLLBACK');
    await store.request('append', { events: [event('recovered', 1000)], now: 1000, recorded: true }, true);
    assert.equal(store.error, null);
    assert.ok(statSync(join(dir, 'history.db-wal')).size < 8 * 1024 * 1024);
});
