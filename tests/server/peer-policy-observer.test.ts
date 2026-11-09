import test from 'node:test';
import assert from 'node:assert/strict';
import { ListenerObserver, normalizePolicyAddress, policyIdentity } from '../../src/server/peer-policy/observer.ts';
import { parsePeerInfo, type PeerInfo } from '../../src/server/rpc-types.ts';
import type { PolicyConfig } from '../../src/server/peer-policy/types.ts';

const WALL = 1_800_000_000;
const CONFIG: PolicyConfig = { mode: 'preview', listener_allowance: 0, keep_addresses: [] };
function peer(id = 1, overrides: Record<string, unknown> = {}): PeerInfo {
    return parsePeerInfo([{ id, addr: `192.0.2.${id}:8333`, network: 'ipv4', inbound: true, connection_type: 'inbound',
        conntime: WALL - 7200, services: '0000000000000000', servicesnames: [], permissions: [],
        forced_inbound: false, transport_protocol_type: 'v1', session_id: '',
        last_transaction: 0, last_block: 0, last_block_announcement: 0,
        synced_headers: -1, synced_blocks: -1, presynced_headers: -1, inflight: [],
        bytessent: 1000, bytesrecv: 200, bytessent_per_msg: { inv: 1000 }, bytesrecv_per_msg: { ping: 200 }, mapped_as: (id % 3) + 1,
        ...overrides }])[0];
}
function healthy(targets: PeerInfo[] = [peer()]): PeerInfo[] {
    return [...targets, ...Array.from({ length: 14 }, (_, index) => peer(index + 20, {
        inbound: index >= 4, connection_type: index < 4 ? 'outbound-full-relay' : 'inbound', services: '0000000000000401', servicesnames: ['NETWORK', 'NETWORK_LIMITED'],
    }))];
}
function window(observer: ListenerObserver, peers: PeerInfo[], start = 1000, duration = 1800) {
    for (let seconds = 0; seconds <= duration; seconds += 10) observer.observe(peers, start + seconds * 1000, WALL + start / 1000 + seconds);
    return start + duration * 1000;
}

test('address exceptions normalize exact IP/overlay hosts without accepting DNS, subnet or URL input', () => {
    assert.equal(normalizePolicyAddress('[2001:0db8:0:0::1]:12345'), '2001:db8::1');
    assert.equal(normalizePolicyAddress('2001:db8::1'), '2001:db8::1');
    assert.equal(normalizePolicyAddress('[::ffff:192.0.2.1]:8333'), '192.0.2.1');
    assert.equal(normalizePolicyAddress('192.0.2.1:12345'), '192.0.2.1');
    assert.equal(normalizePolicyAddress(`${'A'.repeat(56)}.ONION:8333`), `${'a'.repeat(56)}.onion`);
    assert.equal(normalizePolicyAddress(`${'b'.repeat(52)}.b32.i2p:0`), `${'b'.repeat(52)}.b32.i2p`);
    for (const value of ['example.com', 'localhost:8333', '192.0.2.1/32', 'http://192.0.2.1', '[fe80::1%eth0]:3', '192.0.2.1:65536', '[::1]junk', ' 192.0.2.1', 'a.onion']) assert.equal(normalizePolicyAddress(value), null, value);
});

test('a quiet listener qualifies through local observations, with allowance ordering and pure repeated reads', () => {
    const observer = new ListenerObserver(), peers = healthy([peer(1), peer(2, { conntime: WALL - 8000 })]);
    const now = window(observer, peers);
    const all = observer.inspect(CONFIG, now, WALL + now / 1000);
    assert.deepEqual(all.eligible.map(item => item.peer.id), [2, 1]);
    assert.equal(all.counts.candidates, 2);
    const allowed = observer.inspect({ ...CONFIG, listener_allowance: 1 }, now, WALL + now / 1000);
    assert.deepEqual(allowed.eligible.map(item => item.peer.id), [2]);
    assert.deepEqual(observer.inspect(CONFIG, now, WALL + now / 1000), all);
    assert.equal(observer.lastObservedAt, now);
    assert.equal(observer.inspect(CONFIG, now + 31_000, WALL + now / 1000 + 31).eligible.length, 0);
});

test('connection grace cannot be replaced by a long local observation window', () => {
    const observer = new ListenerObserver();
    const now = window(observer, healthy([peer(1, { conntime: WALL })]));
    assert.equal(observer.inspect(CONFIG, now, WALL + now / 1000).eligible.length, 0);
    assert.equal(observer.inspect(CONFIG, now, WALL + now / 1000).peers[0].status, 'observing');
});

test('page reads cannot finish the observation window before a new canonical arrival', () => {
    const observer = new ListenerObserver(), peers = healthy();
    const now = window(observer, peers, 1000, 1790);
    const beforeArrival = observer.inspect(CONFIG, now + 10_000, WALL + now / 1000 + 10);
    assert.equal(beforeArrival.eligible.length, 0);
    assert.equal(beforeArrival.peers[0].observed_seconds, 1790);
    observer.observe(peers, now + 10_000, WALL + now / 1000 + 10);
    assert.equal(observer.inspect(CONFIG, now + 10_000, WALL + now / 1000 + 10).eligible.length, 1);
});

test('outbound, permissioned, serving and explicitly kept connections remain protected', () => {
    const targets = [
        peer(1, { inbound: false, connection_type: 'manual' }), peer(2, { permissions: ['noban'] }),
        peer(3, { services: '400', servicesnames: ['NETWORK_LIMITED'] }), peer(4, { inflight: [100] }),
        peer(5, { presynced_headers: 50 }), peer(6),
    ];
    const observer = new ListenerObserver(), now = window(observer, healthy(targets));
    const evaluation = observer.inspect({ ...CONFIG, keep_addresses: ['192.0.2.6'] }, now, WALL + now / 1000);
    assert.equal(evaluation.eligible.length, 0);
    assert.ok(evaluation.peers.slice(0, targets.length).every(item => item.status === 'protected'));
});

test('missing, malformed and unknown RPC extensions never become evidence of inactivity', () => {
    const variations: Record<string, unknown>[] = [
        { services: undefined }, { services: 'not-hex' }, { services: '8000000000000000' },
        { permissions: null }, { last_block_announcement: undefined }, { inflight: undefined },
        { bytesrecv_per_msg: null }, { bytessent_per_msg: { '*other*': 1 } },
        { bytesrecv_per_msg: { ping: -1 } }, { bytessent_per_msg: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`message${i}`, 1])) },
        { session_id: 'unexpected' }, { inbound: undefined }, { network: undefined },
        { last_block_announcement: WALL + 100000 }, { last_transaction: WALL - 9000 }, { conntime: WALL + 100000 },
    ];
    for (const fields of variations) {
        const observer = new ListenerObserver(), now = window(observer, healthy([peer(1, fields)]));
        assert.equal(observer.inspect(CONFIG, now, WALL + now / 1000).eligible.length, 0, JSON.stringify(fields));
    }
});

test('traffic payloads, ambiguous requests, timestamp changes and counter rollback restart quiet evidence', () => {
    for (const change of ['getdata', 'headers', 'tx', 'cfilter', 'timestamp', 'regression', 'total-regression', 'unclassified-total']) {
        const observer = new ListenerObserver();
        const peers = healthy(), now = window(observer, peers);
        assert.equal(observer.inspect(CONFIG, now, WALL + now / 1000).eligible.length, 1);
        const changed = structuredClone(peers);
        if (change === 'timestamp') changed[0].last_transaction = WALL + 1;
        else if (change === 'regression') changed[0].bytesrecv_per_msg = { ping: 100 };
        else if (change === 'total-regression') changed[0].bytesrecv = 100;
        else if (change === 'unclassified-total') changed[0].bytesrecv = 1000;
        else changed[0].bytesrecv_per_msg = { ping: 200, [change]: 24 };
        observer.observe(changed, now + 10_000, WALL + now / 1000 + 10);
        assert.equal(observer.inspect(CONFIG, now + 10_000, WALL + now / 1000 + 10).eligible.length, 0, change);
    }
});

test('passive announcement deltas do not stop the quiet window', () => {
    const observer = new ListenerObserver(), peers = healthy();
    let now = window(observer, peers, 1000, 1790);
    const changed = structuredClone(peers); changed[0].bytessent_per_msg = { inv: 2000 }; changed[0].bytessent = 2000;
    observer.observe(changed, now += 10_000, WALL + now / 1000);
    assert.equal(observer.inspect(CONFIG, now, WALL + now / 1000).eligible.length, 1);
});

test('failed-poll resets, long gaps, wall-clock changes and reconnections invalidate old windows', () => {
    for (const change of ['reset', 'gap', 'clock', 'identity', 'disappear']) {
        const observer = new ListenerObserver(), peers = healthy();
        const now = window(observer, peers), initialIdentity = policyIdentity(peers[0]);
        let elapsed = 10_000;
        if (change === 'reset') observer.reset();
        if (change === 'gap') elapsed = 31_000;
        const next = structuredClone(peers);
        if (change === 'identity') { next[0].conntime = WALL + now / 1000; assert.notEqual(policyIdentity(next[0]), initialIdentity); }
        if (change === 'disappear') observer.observe(peers.slice(1), now + 1000, WALL + now / 1000 + 1);
        observer.observe(next, now + elapsed, WALL + now / 1000 + elapsed / 1000 + (change === 'clock' ? 100 : 0));
        assert.equal(observer.inspect(CONFIG, now + elapsed, WALL + now / 1000 + elapsed / 1000 + (change === 'clock' ? 100 : 0)).eligible.length, 0, change);
    }
});

test('transport and connectivity floors protect peers; AS mapping is optional and not a per-AS exemption', () => {
    const evaluate = (peers: PeerInfo[]) => { const observer = new ListenerObserver(), now = window(observer, peers); return observer.inspect(CONFIG, now, WALL + now / 1000); };
    const unmapped = healthy().map(item => { const clone = { ...item }; delete clone.mapped_as; return clone; });
    assert.equal(evaluate(unmapped).eligible.length, 1);
    assert.equal(evaluate(unmapped).as_diversity_available, false);
    assert.equal(evaluate(healthy([peer(1, { mapped_as: 999 })])).eligible.length, 1, 'sole-AS listener can leave while two other AS groups remain');
    const twoGroups = healthy([peer(1, { mapped_as: 999 })]).map((item, index) => index ? { ...item, mapped_as: 1 } : item);
    assert.equal(evaluate(twoGroups).eligible.length, 0, 'last second-AS connection stays');
    assert.equal(evaluate(healthy([peer(1, { addr: `${'a'.repeat(56)}.onion:8333`, network: 'onion' })])).eligible.length, 0);
    assert.equal(evaluate(healthy().slice(0, 12)).eligible.length, 0);
    assert.equal(evaluate(healthy().slice(0, 13)).eligible.length, 1, 'removal may leave exactly twelve peers');
    const fewOutbound = healthy(); fewOutbound[1] = peer(20, { services: '401', servicesnames: ['NETWORK', 'NETWORK_LIMITED'] });
    assert.equal(evaluate(fewOutbound).eligible.length, 0);
});

test('bounded observation fails closed rather than dropping session evidence', () => {
    const observer = new ListenerObserver();
    assert.throws(() => observer.observe(Array.from({ length: 2001 }, () => peer()), 1000, WALL), /bounds/);
    assert.equal(observer.lastObservedAt, null);
    assert.equal(observer.continuousSince, null);
    assert.throws(() => observer.observe([peer(), peer()], 1000, WALL), /ambiguous/);
    for (const oversized of [{ addr: 'x'.repeat(513) }, { session_id: 'x'.repeat(129) }, { network: 'x'.repeat(33) }]) {
        assert.throws(() => observer.observe([peer(1, oversized)], 1000, WALL), /bounds/);
        assert.equal(observer.lastObservedAt, null);
    }
});
