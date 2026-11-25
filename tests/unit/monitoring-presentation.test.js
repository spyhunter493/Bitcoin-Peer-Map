import test from 'node:test';
import assert from 'node:assert/strict';
import { chart, coverage, diagnosticRows, eventRows } from '../../src/static/js/monitoring/presentation.js';

test('monitoring observations and coverage escape addresses/reasons without claiming complete history', () => {
    const attack = '<img src=x onerror="alert(1)">';
    const html = eventRows([{ id: '1', time: 1700000000, source: 'peer', kind: 'arrived', address: attack, peer_id: 4, reason: attack }]);
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
    assert.match(eventRows([{ id: 'manual', time: 1700000000, source: 'manual', kind: 'disconnect_requested', address: null, peer_id: 42, reason: 'Requested.' }]), /Peer #42/);
    const text = coverage({ recording: false, started_at: null, oldest_at: null, newest_at: null, gaps: 2, dropped: 1, incomplete: true });
    assert.match(text, /Recording disabled/);
    assert.match(text, /Coverage is incomplete/);
    assert.match(text, /2 monitoring gap/);
});

test('monitoring charts break lines at unavailable samples and cap mounted chart points', () => {
    const html = chart([{ time: 1, first: 10, second: 3 }, { time: 61, first: null, second: null }, { time: 121, first: 20, second: 5 }], { title: 'Traffic', first: 'In', second: 'Out' });
    const path = html.match(/<path d="([^"]*)" class="monitoring-line-first"/)[1];
    assert.equal((path.match(/M/g) || []).length, 2);
    assert.ok(!path.includes('L'), 'an unavailable interval must not be bridged');
    const large = chart(Array.from({ length: 5000 }, (_, i) => ({ time: i * 60, first: i, second: i })), { title: 'Peers', first: 'In', second: 'Out' });
    const bounded = large.match(/<path d="([^"]*)" class="monitoring-line-first"/)[1];
    assert.equal((bounded.match(/[ML]/g) || []).length, 1000);
});

test('diagnostics render structured method samples and escape displayed text', () => {
    const html = diagnosticRows({ rpc: { methods: [{ method: '<test>', samples: 10, average_ms: 2 }] } });
    assert.match(html, /&lt;test&gt;/);
    assert.ok(!html.includes('[object Object]'));
    assert.ok(!html.includes('<test>'));
});
