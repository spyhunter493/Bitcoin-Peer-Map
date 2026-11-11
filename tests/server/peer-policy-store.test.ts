import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PeerPolicyStore, parsePolicyConfig } from '../../src/server/peer-policy/store.ts';
import type { PolicyConfig, PolicyState } from '../../src/server/peer-policy/types.ts';
import { HttpError } from '../../src/server/http.ts';

const CONFIG: PolicyConfig = { mode: 'preview', listener_allowance: 0, keep_addresses: [] };
function fixture(t: test.TestContext) {
    const dir = mkdtempSync(join(tmpdir(), 'bpm-policy-store-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return { dir, store: new PeerPolicyStore(dir, 'synthetic-node-main') };
}
const state = (): PolicyState => ({ attempts: [{ id: 'attempt-1', time: 1000, peer_id: 1, address: '192.0.2.1:12345', identity: 'epoch:[1,192.0.2.1]', outcome: 'uncertain', departure_observed: false }],
    events: [{ id: 'event-1', time: 1000, peer_id: 1, address: '192.0.2.1:12345', kind: 'uncertain', reason: 'RPC outcome is uncertain' }], last_wall_time: 1000 });
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;

test('new stores are off without writes and snapshots do not expose mutable state', t => {
    const { dir, store } = fixture(t);
    const snapshot = store.snapshot();
    assert.equal(snapshot.config.mode, 'off'); assert.equal(snapshot.revision, 0);
    assert.deepEqual(readdirSync(dir), []);
    snapshot.config.keep_addresses.push('192.0.2.1'); snapshot.state.last_wall_time = 999;
    assert.deepEqual(store.snapshot().config.keep_addresses, []); assert.equal(store.snapshot().state.last_wall_time, 0);
});

test('config and reserved budgets persist together with revision checks and owner-only atomic files', t => {
    const { dir, store } = fixture(t);
    store.configure({ ...CONFIG, keep_addresses: ['[2001:0db8::1]:8333', '192.0.2.1:5', '192.0.2.1'] }, 0);
    assert.equal(store.snapshot().revision, 1);
    assert.deepEqual(store.snapshot().config.keep_addresses, ['192.0.2.1', '2001:db8::1']);
    store.updateState(state());
    assert.equal(store.snapshot().state.attempts[0].address, '192.0.2.1', 'saved cooldowns use normalized hosts without source ports');
    assert.equal(store.snapshot().state.events[0].address, '192.0.2.1');
    assert.equal(statSync(store.path).mode & 0o777, 0o600);
    const reopened = new PeerPolicyStore(dir, 'synthetic-node-main');
    assert.deepEqual(reopened.snapshot(), store.snapshot());
    assert.throws(() => reopened.configure(CONFIG, 0), status(409));
    reopened.configure({ ...CONFIG, mode: 'off' }, 1);
    assert.equal(reopened.snapshot().state.attempts.length, 1, 'turning off cannot clear budgets');
    assert.equal(reopened.snapshot().revision, 2);
    assert.deepEqual(readdirSync(dir), ['peer-policy.json']);
});

test('a different node scope defaults off and preserves the original document until explicit configuration', t => {
    const { dir, store } = fixture(t); store.configure({ ...CONFIG, mode: 'automatic' }, 0); store.updateState(state());
    const original = readFileSync(store.path, 'utf8'), switched = new PeerPolicyStore(dir, 'other-synthetic-node');
    assert.equal(switched.snapshot().config.mode, 'off'); assert.equal(switched.snapshot().state.attempts.length, 0);
    assert.throws(() => switched.updateState({ attempts: [], events: [], last_wall_time: 0 }), status(503));
    assert.equal(readFileSync(store.path, 'utf8'), original);
    switched.configure(CONFIG, 0);
    assert.equal(new PeerPolicyStore(dir, 'other-synthetic-node').snapshot().config.mode, 'preview');
});

test('config parser rejects broad addresses, unknown fields, malformed mode/allowance and oversized Keep lists', () => {
    for (const payload of [null, {}, { ...CONFIG, mode: 'enabled' }, { ...CONFIG, listener_allowance: 21 }, { ...CONFIG, listener_allowance: 0.5 },
        { ...CONFIG, keep_addresses: ['example.com'] }, { ...CONFIG, keep_addresses: ['192.0.2.0/24'] }, { ...CONFIG, extra: true }, { ...CONFIG, keep_addresses: Array(129).fill('192.0.2.1') }]) {
        assert.throws(() => parsePolicyConfig(payload), status(422));
    }
});

test('corrupt, oversized, unsupported or unsafe saved documents fail closed without being rewritten', t => {
    const { dir, store } = fixture(t); store.configure(CONFIG, 0);
    const valid = store.snapshot();
    const bad = ['not json', JSON.stringify({ ...valid, version: 2 }), JSON.stringify({ ...valid, state: { ...valid.state, attempts: [{}] } }), ' '.repeat(1024 * 1024 + 1)];
    for (const content of bad) {
        writeFileSync(store.path, content, { mode: 0o600 });
        const broken = new PeerPolicyStore(dir, 'synthetic-node-main');
        assert.throws(() => broken.snapshot(), status(503)); assert.throws(() => broken.configure(CONFIG, 0), status(503));
        assert.equal(readFileSync(store.path, 'utf8'), content);
    }
});

test('invalid or oversized state disables subsequent actions instead of evicting reservations', t => {
    for (const variation of ['attempts', 'events', 'departure', 'reason', 'serialized']) {
        const { store } = fixture(t); store.configure(CONFIG, 0);
        const input = state();
        if (variation === 'attempts') input.attempts = Array.from({ length: 2001 }, (_, index) => ({ ...input.attempts[0], id: `attempt-${index}` }));
        if (variation === 'events') input.events = Array(201).fill(input.events[0]);
        if (variation === 'departure') (input.attempts[0] as unknown as Record<string, unknown>).departure_observed = 'yes';
        if (variation === 'reason') input.events[0].reason = 'unsafe\nreason';
        if (variation === 'serialized') input.attempts = Array.from({ length: 1000 }, (_, index) => ({ ...input.attempts[0], id: `attempt-${index}`, identity: 'a'.repeat(2048) }));
        assert.throws(() => store.updateState(input), status(503), variation);
        assert.throws(() => store.snapshot(), status(503));
    }
});

test('an atomic write failure preserves the prior file and makes the instance unavailable', t => {
    const { dir, store } = fixture(t); store.configure(CONFIG, 0);
    rmSync(store.path); mkdirSync(store.path);
    assert.throws(() => store.updateState(state()), status(503));
    assert.throws(() => store.snapshot(), status(503));
    assert.equal(statSync(store.path).isDirectory(), true);
    assert.deepEqual(readdirSync(dir), ['peer-policy.json']);
});

test('failure pauses and observed-return flags survive restart and Preview clears only the guard atomically', t => {
    const { dir, store } = fixture(t);
    store.configure({ ...CONFIG, mode: 'automatic' }, 0);
    const saved = state();
    saved.attempts[0]!.departure_observed = true;
    saved.attempts[0]!.return_observed = true;
    saved.failure_guard = { consecutive_failures: 3, paused: true, reason: 'Paused after definite failures.' };
    store.updateState(saved);
    const reopened = new PeerPolicyStore(dir, 'synthetic-node-main');
    assert.deepEqual(reopened.snapshot(), store.snapshot());
    const stateBefore = reopened.snapshot().state;
    reopened.configure(CONFIG, 1, { ...stateBefore, failure_guard: { consecutive_failures: 0, paused: false, reason: null } });
    const restored = new PeerPolicyStore(dir, 'synthetic-node-main').snapshot();
    assert.equal(restored.config.mode, 'preview');
    assert.deepEqual(restored.state.attempts, stateBefore.attempts);
    assert.deepEqual(restored.state.failure_guard, { consecutive_failures: 0, paused: false, reason: null });
    assert.equal(statSync(reopened.path).mode & 0o777, 0o600);
});

test('malformed failure guards or return observations cannot silently clear a persisted pause', t => {
    for (const change of [
        { failure_guard: { consecutive_failures: 4, paused: true, reason: 'Too many' } },
        { failure_guard: { consecutive_failures: 1, paused: true, reason: null } },
        { failure_guard: { consecutive_failures: 1, paused: false, reason: 'Contradictory' } },
        { attempts: [{ ...state().attempts[0], return_observed: true }] },
    ]) {
        const { store } = fixture(t); store.configure(CONFIG, 0);
        assert.throws(() => store.updateState({ ...state(), ...change } as PolicyState), status(503));
        assert.throws(() => store.snapshot(), status(503));
    }
});
