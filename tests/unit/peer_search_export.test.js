import assert from 'node:assert/strict';
import test from 'node:test';
import { filterSearch } from '../../src/static/js/peers/table-search.js';
import { toCsv, toJson } from '../../src/static/js/peers/table-export.js';

const peers = [
    {
        id: 19, network: 'ipv6', addr: '[2001:db8::19]:8333', ip: '2001:db8::19', port: 8333,
        subver: '/Satoshi:29.0.0/', city: 'Auckland', region: 'AUK', regionName: 'Auckland Region',
        country: 'New Zealand', countryCode: 'NZ', isp: 'Example ISP', org: 'Example Org',
        as: 'AS64500 Example Network', asname: 'EXAMPLE-NET', direction: 'OUT', connection_type: 'manual',
        ping_ms: 0.4, bytessent: 1536, geo: { freshness: 'fresh', age_seconds: 5, location: { lat: -36.85 } },
    },
    {
        id: 7, network: 'onion', addr: 'myhiddenpeer.onion:8333', ip: 'myhiddenpeer.onion',
        subver: '/Satoshi:28.1.0/', direction: 'IN', connection_type: 'inbound',
        country: null, city: null, isp: null, ping_ms: null, geo: { freshness: 'unavailable', age_seconds: null },
    },
    { id: 11, network: 'i2p', addr: 'mypeer.b32.i2p:0', subver: null, direction: 'OUT', connection_type: 'block-relay-only' },
    { id: 3, network: 'cjdns', addr: '[fc00::3]:8333', countryCode: null },
];
const ids = (result) => result.map((peer) => peer.id);

test('peer search combines words across fields, ignores case and surrounding whitespace, and preserves input order', () => {
    assert.deepEqual(ids(filterSearch(peers, '  satoshi\tNZ   OUTBOUND\nmanual  ')), [19]);
    assert.deepEqual(ids(filterSearch(peers, 'SATOSHI')), [19, 7]);
    assert.deepEqual(ids(filterSearch(peers, 'satoshi auckland')), [19]);
    assert.deepEqual(ids(filterSearch(peers, 'satoshi france')), []);
    assert.deepEqual(ids(peers), [19, 7, 11, 3]);
    assert.equal(filterSearch(peers, '19')[0], peers[0]);
});

test('peer search finds IPv6 and private addresses, network aliases, peer IDs, and connection types', () => {
    for (const query of ['2001:db8::19', '[2001:db8::19]:8333', 'ipv6 19', 'AS64500', 'example-net', 'example org', 'AUK']) {
        assert.deepEqual(ids(filterSearch(peers, query)), [19], query);
    }
    for (const query of ['TOR', 'onion', 'hiddenpeer', 'tor inbound']) {
        assert.deepEqual(ids(filterSearch(peers, query)), [7], query);
    }
    assert.deepEqual(ids(filterSearch(peers, 'i2p block-relay-only')), [11]);
    assert.deepEqual(ids(filterSearch(peers, 'cjdns fc00::3')), [3]);
});

test('empty and null searches include every peer, missing fields stay absent, and markup remains text', () => {
    for (const query of ['', ' \t\n ', null, undefined]) {
        assert.deepEqual(filterSearch(peers, query), peers);
    }
    assert.deepEqual(filterSearch([], 'anything'), []);
    assert.deepEqual(ids(filterSearch(peers, 'null')), []);
    const raw = { id: 90, subver: '<img src=x onerror="throw new Error()">', city: null };
    assert.deepEqual(filterSearch([raw], '<img'), [raw]);
    assert.equal(raw.subver, '<img src=x onerror="throw new Error()">');
});

test('CSV follows selected column order, uses display values, and quotes punctuation, quotes, and newlines', () => {
    const sample = { id: 19, subver: 'Example, "quoted"\nclient\rbuild', city: 'Auckland' };
    const columns = [
        { key: 'city', label: 'City', get: (peer) => peer.city },
        { key: 'subver', label: 'Software', get: (peer) => peer.subver },
        { key: 'id', label: 'ID', get: (peer) => peer.id },
        { key: 'bytessent_fmt', label: 'Sent', get: () => '1.5 KB' },
    ];
    assert.equal(toCsv([sample], columns), 'City,Software,ID,Sent\r\nAuckland,"Example, ""quoted""\nclient\rbuild",19,1.5 KB\r\n');
    assert.equal(toCsv([], columns), 'City,Software,ID,Sent\r\n');
});

test('CSV neutralizes spreadsheet formulas after leading whitespace or controls while preserving numeric cells', () => {
    const column = { key: 'subver', label: 'Software', get: (peer) => peer.subver };
    for (const value of ['=1+1', '+SUM(A1:A2)', '-1+1', '@SUM(A1)', '  =1+1', '\t+1', '\u0001-1', '\u0085@A1']) {
        assert.equal(toCsv([{ subver: value }], [column]), `Software\r\n'${value}\r\n`, value);
    }
    assert.equal(toCsv([{ subver: '\r\n=1' }], [column]), 'Software\r\n"\'\r\n=1"\r\n');
    assert.equal(toCsv([{ subver: '-0.4' }], [column]), "Software\r\n'-0.4\r\n");
    assert.equal(toCsv([{ subver: -0.4 }], [column]), 'Software\r\n-0.4\r\n');
    assert.equal(toCsv([{ subver: 0 }, { subver: null }, { subver: false }], [column]), 'Software\r\n0\r\n\r\nfalse\r\n');
});

test('CSV exports all matching records, independently of the visible table window', () => {
    const snapshot = Array.from({ length: 300 }, (_, id) => ({ id, network: id % 2 ? 'onion' : 'ipv4' }));
    const matching = filterSearch(snapshot, 'tor');
    const csv = toCsv(matching, [{ key: 'id', label: 'ID', get: (peer) => peer.id }]);
    const rows = csv.trimEnd().split('\r\n');
    assert.equal(rows.length, 151);
    assert.equal(rows[1], '1');
    assert.equal(rows.at(-1), '299');
});

test('JSON preserves raw nullable and nested data, scope metadata, and result order', () => {
    const filtered = filterSearch(peers, 'satoshi');
    const metadata = {
        exported_at: '2026-10-08T01:02:03.000Z',
        filters: { search: 'satoshi', networks: ['ipv6', 'onion'] },
        sort: { key: 'id', ascending: false },
        columns: ['addr', 'ping_ms'],
    };
    const output = JSON.parse(toJson(filtered, metadata));
    assert.deepEqual(output, { ...metadata, count: 2, peers: filtered });
    assert.equal(output.peers[1].ping_ms, null);
    assert.equal(output.peers[0].ping_ms, 0.4);
    assert.equal(output.peers[0].geo.location.lat, -36.85);
    assert.deepEqual(JSON.parse(toJson([], metadata)), { ...metadata, count: 0, peers: [] });
    assert.equal(JSON.parse(toJson(filtered, { ...metadata, count: 999, peers: [] })).count, 2);
});
