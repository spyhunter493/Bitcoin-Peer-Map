import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PeerPolicyCoordinator } from '../../src/server/peer-policy/coordinator.ts';
import { PeerPolicyStore } from '../../src/server/peer-policy/store.ts';
import { parsePeerInfo, type PeerInfo } from '../../src/server/rpc-types.ts';
import { HttpError } from '../../src/server/http.ts';
import { RpcAuthenticationError, RpcError, RpcTransportError } from '../../src/server/rpc.ts';
import { FakeRpc, deferred, flush, temporaryDirectory } from './helpers.ts';

const WALL = 1_800_000_000;

function peer(id: number, inbound = true, blockServing = false): PeerInfo {
    return parsePeerInfo([{
        id, addr: `192.0.2.${id}:8333`, network: 'ipv4', inbound,
        connection_type: inbound ? 'inbound' : 'outbound-full-relay', permissions: [],
        services: blockServing ? '0000000000000401' : '0000000000000000',
        servicesnames: blockServing ? ['NETWORK', 'NETWORK_LIMITED'] : [],
        conntime: WALL - 7_200, transport_protocol_type: 'v1', session_id: '',
        bytessent_per_msg: { version: 100, verack: 24, inv: 500 },
        bytesrecv_per_msg: { version: 100, verack: 24, pong: 50 },
        bytessent: 624, bytesrecv: 174,
        last_transaction: 0, last_block: 0, last_block_announcement: 0,
        synced_headers: -1, synced_blocks: -1, presynced_headers: -1, inflight: [],
    }])[0]!;
}

function fixture(t: TestContext, options: { candidates?: number; managementEnabled?: boolean; signal?: AbortSignal } = {}) {
    const directory = temporaryDirectory(t);
    const store = new PeerPolicyStore(directory, 'synthetic-main');
    const rpc = new FakeRpc();
    let milliseconds = 0;
    let wallOffset = 0;
    let peers = [
        ...Array.from({ length: 4 }, (_, index) => peer(index + 1, false, true)),
        ...Array.from({ length: 9 }, (_, index) => peer(index + 10, true, true)),
        ...Array.from({ length: options.candidates ?? 1 }, (_, index) => peer(index + 30)),
    ];
    rpc.values.getnetworkinfo = { networkactive: true };
    rpc.values.getblockchaininfo = { chain: 'main', initialblockdownload: false };
    rpc.values.uptime = () => 100_000 + Math.floor(milliseconds / 1_000);
    let refreshes = 0;
    let refresh: () => Promise<boolean> = async () => {
        refreshes++;
        milliseconds++;
        coordinator.observe(peers, milliseconds);
        return true;
    };
    const coordinator = new PeerPolicyCoordinator(store, {
        rpc, refreshPeers: () => refresh(), managementEnabled: options.managementEnabled ?? true,
        clock: () => milliseconds, wallClock: () => WALL + milliseconds / 1_000 + wallOffset,
        chain: 'main', signal: options.signal,
    });
    const configure = (mode: 'off' | 'preview' | 'automatic', changes: Record<string, unknown> = {}) => coordinator.configure({
        expected_revision: coordinator.snapshot().revision,
        config: { mode, listener_allowance: 0, keep_addresses: [], ...changes },
    });
    async function step(seconds = 10, evaluate = true) {
        let remaining = seconds;
        while (remaining > 0) {
            const delta = Math.min(remaining, 10);
            milliseconds += delta * 1_000;
            coordinator.observe(peers, milliseconds);
            if (evaluate) await coordinator.evaluate();
            remaining -= delta;
        }
    }
    async function warm(seconds = 1_800) {
        coordinator.observe(peers, milliseconds);
        for (let index = 0; index < seconds / 10; index++) await step();
    }
    return {
        coordinator, store, rpc, directory, configure, step, warm,
        get now() { return milliseconds; },
        get peers() { return peers; },
        set peers(value: PeerInfo[]) { peers = value; },
        get refreshes() { return refreshes; },
        set refresh(value: () => Promise<boolean>) { refresh = value; },
        advance(seconds: number) { milliseconds += seconds * 1_000; },
        shiftWall(seconds: number) { wallOffset += seconds; },
        observe() { coordinator.observe(peers, milliseconds); },
    };
}

test('off does no policy observation, health RPC, refresh, or writes; snapshot is read-only', async t => {
    const f = fixture(t);
    f.coordinator.start();
    f.observe();
    await f.coordinator.evaluate();
    const before = f.store.snapshot();
    f.advance(3_600);
    for (let index = 0; index < 5; index++) assert.equal(f.coordinator.snapshot().effective_state, 'disabled');
    assert.deepEqual(f.store.snapshot(), before);
    assert.equal(f.rpc.calls.length, 0);
    assert.equal(f.refreshes, 0);
    assert.deepEqual(f.coordinator.snapshot().peers, []);
    await f.coordinator.stop();
});

test('requires an authenticated Preview trial and does not count time spent off', async t => {
    const f = fixture(t);
    f.advance(3_600);
    assert.throws(() => f.configure('automatic'), (error: unknown) => error instanceof HttpError && error.status === 409);
    f.configure('preview');
    await f.warm(1_790);
    assert.equal(f.coordinator.snapshot().preview_remaining_seconds, 10);
    assert.throws(() => f.configure('automatic'), (error: unknown) => error instanceof HttpError && error.status === 409);
    await f.step();
    f.configure('automatic');
    assert.equal(f.coordinator.snapshot().config.mode, 'automatic');
    assert.equal(f.rpc.count('disconnectnode'), 0);
    const disabled = fixture(t, { managementEnabled: false });
    assert.throws(() => disabled.configure('preview'), (error: unknown) => error instanceof HttpError && error.status === 503);
});

test('Preview explains listener candidates below native capacity without mutation or read polling', async t => {
    const f = fixture(t);
    f.configure('preview');
    await f.warm(1_870);
    const before = f.rpc.calls.length;
    const snapshot = f.coordinator.snapshot();
    assert.equal(snapshot.effective_state, 'preview');
    assert.equal(snapshot.counts.candidates, 1, JSON.stringify(snapshot));
    assert(snapshot.events.some(event => event.kind === 'would_disconnect'));
    for (let index = 0; index < 10; index++) f.coordinator.snapshot();
    assert.equal(f.rpc.calls.length, before);
    assert.equal(f.rpc.count('disconnectnode'), 0);
    assert.equal(f.refreshes, 0);
});

test('page reads cannot finish Preview or peer quiet windows between canonical observations', async t => {
    const f = fixture(t);
    f.configure('preview');
    await f.warm(1_790);
    const before = f.coordinator.snapshot();
    const stored = f.store.snapshot();
    const calls = f.rpc.calls.length;
    f.advance(20);
    for (let index = 0; index < 10; index++) {
        const snapshot = f.coordinator.snapshot();
        assert.equal(snapshot.preview_remaining_seconds, before.preview_remaining_seconds);
        assert.equal(snapshot.counts.candidates, 0);
    }
    assert.throws(() => f.configure('automatic'), (error: unknown) => error instanceof HttpError && error.status === 409);
    assert.deepEqual(f.store.snapshot(), stored);
    assert.equal(f.rpc.calls.length, calls);
    f.observe();
    assert.equal(f.coordinator.snapshot().preview_remaining_seconds, 0);
    assert.equal(f.coordinator.snapshot().counts.candidates, 1);
});

test('Automatic reserves the attempt before numeric-nodeid dispatch and reconciles later departure once', async t => {
    const f = fixture(t);
    f.configure('preview');
    await f.warm();
    f.configure('automatic');
    f.rpc.values.disconnectnode = () => {
        const state = f.store.snapshot().state;
        assert.equal(state.attempts.length, 1);
        assert.equal(state.attempts[0]!.outcome, 'requested');
        return null;
    };
    await f.step(60);
    assert.equal(f.rpc.count('disconnectnode'), 1);
    assert.deepEqual(f.rpc.calls.find(call => call.method === 'disconnectnode')!.params, ['', 30]);
    assert.equal(f.store.snapshot().state.attempts[0]!.outcome, 'succeeded');
    assert(!f.coordinator.snapshot().events.some(event => event.kind === 'departure_observed'));
    f.peers = f.peers.filter(item => item.id !== 30);
    await f.step();
    await f.step();
    const events = f.coordinator.snapshot().events.filter(event => event.kind === 'departure_observed');
    assert.equal(events.length, 1);
    assert.match(events[0]!.reason, /cause is not established/);
});

test('canonical pre-action refresh cancels decisions if activity or connection identity changes', async t => {
    for (const change of ['activity', 'identity'] as const) {
        const f = fixture(t);
        f.configure('preview');
        await f.warm();
        f.configure('automatic');
        f.refresh = async () => {
            const listener = f.peers.find(item => item.id === 30)!;
            if (change === 'activity') listener.bytesrecv_per_msg = { version: 100, verack: 24, pong: 50, getheaders: 100 };
            else listener.conntime = WALL;
            f.advance(0.001);
            f.observe();
            return true;
        };
        await f.step(60);
        assert.equal(f.rpc.count('disconnectnode'), 0, change);
        assert.equal(f.store.snapshot().state.attempts.length, 0, change);
    }
});

test('a coalesced refresh without a new RPC observation cannot authorize dispatch', async t => {
    const f = fixture(t);
    f.configure('preview');
    await f.warm();
    f.configure('automatic');
    // Models an already-published RPC snapshot with pending GeoIP hydration:
    // refreshOnce resolves successfully but produces no newer observation.
    f.refresh = async () => true;
    await f.step(60);
    assert.equal(f.rpc.count('disconnectnode'), 0);
    assert.equal(f.store.snapshot().state.attempts.length, 0);
});

test('switching Off or editing exceptions during a pending refresh cancels dispatch', async t => {
    for (const mode of ['off', 'automatic'] as const) {
        const f = fixture(t);
        f.configure('preview');
        await f.warm();
        f.configure('automatic');
        const refresh = deferred<boolean>();
        f.refresh = () => refresh.promise;
        const evaluation = f.step(60);
        await flush();
        f.configure(mode, mode === 'automatic' ? { keep_addresses: ['192.0.2.30'] } : {});
        refresh.resolve(true);
        await evaluation;
        assert.equal(f.rpc.count('disconnectnode'), 0, mode);
        assert.equal(f.store.snapshot().state.attempts.length, 0, mode);
    }
});

test('stop and upstream cancellation cancel queued automated work', async t => {
    for (const upstream of [false, true]) {
        const abort = new AbortController();
        const f = fixture(t, { signal: abort.signal });
        f.configure('preview');
        await f.warm();
        f.configure('automatic');
        const pending = deferred<boolean>();
        f.refresh = () => pending.promise;
        const evaluation = f.step(60);
        await flush();
        const stopping = upstream ? (abort.abort(), Promise.resolve()) : f.coordinator.stop();
        pending.resolve(true);
        await Promise.all([evaluation, stopping]);
        assert.equal(f.rpc.count('disconnectnode'), 0);
    }
});

test('Off cannot retract an already-dispatched RPC; a late timeout remains reserved and uncertain', async t => {
    const f = fixture(t);
    f.configure('preview');
    await f.warm();
    f.configure('automatic');
    const response = deferred<unknown>();
    f.rpc.values.disconnectnode = () => response.promise;
    const evaluation = f.step(60);
    await flush();
    assert.equal(f.rpc.count('disconnectnode'), 1);
    f.configure('off');
    response.reject(new RpcTransportError('synthetic late timeout'));
    await evaluation;
    assert.equal(f.coordinator.snapshot().effective_state, 'disabled');
    assert.equal(f.store.snapshot().state.attempts[0]!.outcome, 'uncertain');
    assert.equal(f.rpc.count('disconnectnode'), 1);
});

test('concurrent evaluators share one canonical refresh and one attempt', async t => {
    const f = fixture(t);
    f.configure('preview');
    await f.warm();
    f.configure('automatic');
    await f.step(50, false);
    f.advance(10);
    f.observe();
    const work = Array.from({ length: 20 }, () => f.coordinator.evaluate());
    await Promise.all(work);
    assert.equal(f.refreshes, 1);
    assert.equal(f.rpc.count('disconnectnode'), 1);
});

test('failed or uncertain RPC outcomes retain limits and are never retried blindly', async t => {
    for (const failure of [new RpcError('synthetic failure', -29), new RpcTransportError('synthetic timeout')]) {
        const f = fixture(t);
        f.configure('preview');
        await f.warm();
        f.configure('automatic');
        f.rpc.values.disconnectnode = () => { throw failure; };
        await f.step(60);
        assert.equal(f.store.snapshot().state.attempts[0]!.outcome, failure instanceof RpcTransportError ? 'uncertain' : 'failed');
        for (let index = 0; index < 20; index++) await f.step(10);
        assert.equal(f.rpc.count('disconnectnode'), 1);
        assert(f.coordinator.snapshot().next_action_at! > WALL + f.now / 1_000);
    }
});

test('definite authentication or unsupported disconnect RPC pauses immediately with the reservation retained', async t => {
    for (const error of [new RpcAuthenticationError('synthetic authorization failure'), new RpcError('synthetic unsupported method', -32601)]) {
        const f = fixture(t, { candidates: 4 });
        f.configure('preview'); await f.warm(); f.configure('automatic');
        f.rpc.values.disconnectnode = () => { throw error; };
        await f.step(60);
        assert.equal(f.rpc.count('disconnectnode'), 1);
        assert.equal(f.coordinator.status().effective_state, 'paused');
        assert.equal(f.store.snapshot().state.attempts.length, 1);
        assert.equal(f.store.snapshot().state.failure_guard?.paused, true);
        await f.step(600);
        assert.equal(f.rpc.count('disconnectnode'), 1);
        assert.throws(() => f.configure('automatic'), (failure: unknown) => failure instanceof HttpError && failure.status === 409);
    }
});

test('three definite failures pause durably; only explicit fresh Preview resumes without clearing reservations', async t => {
    const f = fixture(t, { candidates: 5 });
    f.configure('preview'); await f.warm(); f.configure('automatic');
    f.rpc.values.disconnectnode = () => { throw new RpcError('synthetic definite failure', -29); };
    await f.step(60); await f.step(300); await f.step(300);
    assert.equal(f.rpc.count('disconnectnode'), 3);
    assert.equal(f.store.snapshot().state.failure_guard?.consecutive_failures, 3);
    assert.equal(f.coordinator.status().effective_state, 'paused');
    const before = f.rpc.calls.length;
    const restarted = new PeerPolicyCoordinator(new PeerPolicyStore(f.directory, 'synthetic-main'), {
        rpc: f.rpc, refreshPeers: async () => true, managementEnabled: true, chain: 'main',
        clock: () => f.now, wallClock: () => WALL + f.now / 1000,
    });
    assert.equal(restarted.status().effective_state, 'paused');
    await restarted.evaluate();
    assert.equal(f.rpc.calls.length, before, 'durable pause does not poll or dispatch');
    f.configure('off');
    assert.throws(() => f.configure('automatic'), (error: unknown) => error instanceof HttpError && error.status === 409);
    f.configure('preview');
    assert.equal(f.coordinator.snapshot().preview_remaining_seconds, 1800);
    assert.equal(f.store.snapshot().state.failure_guard?.paused, false);
    assert.equal(f.store.snapshot().state.attempts.length, 3);
    assert.throws(() => f.configure('automatic'), (error: unknown) => error instanceof HttpError && error.status === 409);
    await f.warm();
    f.configure('automatic');
    assert.equal(f.coordinator.status().mode, 'automatic');
    assert.equal(f.store.snapshot().state.attempts.length, 3);
});

test('uncertain outcomes do not count as definite failures, and an accepted request clears a definite failure streak', async t => {
    const uncertain = fixture(t, { candidates: 4 });
    uncertain.configure('preview'); await uncertain.warm(); uncertain.configure('automatic');
    uncertain.rpc.values.disconnectnode = () => { throw new RpcTransportError('synthetic timeout'); };
    await uncertain.step(60); await uncertain.step(300); await uncertain.step(300);
    assert.equal(uncertain.rpc.count('disconnectnode'), 3);
    assert.equal(uncertain.store.snapshot().state.failure_guard?.consecutive_failures, 0);
    assert.equal(uncertain.store.snapshot().state.failure_guard?.paused, false);
    assert(uncertain.store.snapshot().state.attempts.every(attempt => attempt.outcome === 'uncertain'));
    const recovered = fixture(t, { candidates: 4 });
    recovered.configure('preview'); await recovered.warm(); recovered.configure('automatic');
    recovered.rpc.values.disconnectnode = () => { throw new RpcError('synthetic definite failure', -29); };
    await recovered.step(60); await recovered.step(300);
    recovered.rpc.values.disconnectnode = null;
    await recovered.step(300);
    assert.equal(recovered.store.snapshot().state.failure_guard?.consecutive_failures, 0);
    assert.equal(recovered.store.snapshot().state.failure_guard?.paused, false);
});

test('results distinguish accepted requests, observed departures, and new same-host connections without counting a pre-existing NAT neighbor', async t => {
    const f = fixture(t, { candidates: 2 });
    f.peers.find(item => item.id === 31)!.addr = '192.0.2.30:18333';
    f.configure('preview'); await f.warm(); f.configure('automatic');
    f.rpc.values.disconnectnode = (params: unknown[]) => { f.peers = f.peers.filter(item => item.id !== params[1]); return null; };
    await f.step(10);
    assert.deepEqual(f.coordinator.snapshot().results, { window_seconds: 604800, accepted_requests: 1, observed_departures: 0, same_host_returns: 0 });
    await f.step(10);
    assert.equal(f.coordinator.snapshot().results.observed_departures, 1);
    assert.equal(f.coordinator.snapshot().results.same_host_returns, 0);
    const reconnected = peer(99);
    reconnected.addr = '192.0.2.30:28333'; reconnected.conntime = Math.floor(WALL + f.now / 1000);
    f.peers = [...f.peers, reconnected];
    await f.step(10);
    assert.equal(f.coordinator.snapshot().results.same_host_returns, 1);
    assert.match(f.coordinator.snapshot().events.find(event => event.kind === 'same_host_return')!.reason, /do not establish peer identity/);
    await f.step(30);
    assert.equal(f.coordinator.snapshot().events.filter(event => event.kind === 'same_host_return').length, 1);
    assert.equal(f.coordinator.snapshot().results.same_host_returns, 1);
    const saved = new PeerPolicyStore(f.directory, 'synthetic-main').snapshot();
    assert.equal(saved.state.attempts[0]!.return_observed, true);
});

test('results count distinct attempted connection identities once while retaining every request and reservation', t => {
    const directory = temporaryDirectory(t), store = new PeerPolicyStore(directory, 'synthetic-main'), rpc = new FakeRpc();
    const identity = 'epoch:[30,"192.0.2.30:8333",1000,""]';
    const attempts = Array.from({ length: 3 }, (_, index) => ({
        id: `attempt-${index}`, time: WALL - 3600 * (index + 1), peer_id: 30, address: '192.0.2.30', identity,
        outcome: (['succeeded', 'failed', 'uncertain'] as const)[index]!, departure_observed: true, return_observed: true,
    }));
    const snapshot = () => new PeerPolicyCoordinator(store, {
        rpc, refreshPeers: async () => true, managementEnabled: true, chain: 'main', clock: () => 0, wallClock: () => WALL,
    }).snapshot();
    store.updateState({ attempts, events: [], last_wall_time: WALL });
    assert.deepEqual(snapshot().results, { window_seconds: 604800, accepted_requests: 1, observed_departures: 1, same_host_returns: 1 });
    attempts.push({ ...attempts[0]!, id: 'different-session', identity: 'epoch:[30,"192.0.2.30:8333",2000,""]' });
    attempts.push({ ...attempts[0]!, id: 'expired-session', identity: 'older-epoch:[31,"192.0.2.31:8333",1000,""]', time: WALL - 604801 });
    store.updateState({ attempts, events: [], last_wall_time: WALL });
    assert.deepEqual(snapshot().results, { window_seconds: 604800, accepted_requests: 2, observed_departures: 2, same_host_returns: 2 });
    assert.equal(store.snapshot().state.attempts.length, 5, 'summary reads do not alter reservation history');
    assert.equal(rpc.calls.length, 0);
});

test('compact status does not inspect peers or construct a proposal', async t => {
    const f = fixture(t);
    f.configure('preview'); await f.warm();
    const before = f.store.snapshot(), calls = f.rpc.calls.length;
    const observer = (f.coordinator as unknown as { observer: { inspect: () => unknown; proposal: () => unknown } }).observer;
    observer.inspect = () => { throw new Error('status must not inspect'); };
    observer.proposal = () => { throw new Error('status must not project'); };
    assert.deepEqual(f.coordinator.status(), { available: true, revision: before.revision, mode: 'preview', effective_state: 'preview', reason: 'Preview only; no node changes.' });
    assert.equal(f.rpc.calls.length, calls);
    assert.deepEqual(f.store.snapshot(), before);
});

test('reservation write failure disables automation before sending any disconnect', async t => {
    const f = fixture(t);
    f.configure('preview');
    await f.warm();
    f.configure('automatic');
    f.store.updateState = () => { throw new Error('synthetic disk failure'); };
    await f.step(60);
    assert.equal(f.rpc.count('disconnectnode'), 0);
    assert.equal(f.coordinator.snapshot().available, false);
    assert.match(f.coordinator.snapshot().reason, /storage write failed/);
    assert.throws(() => f.configure('preview'), (error: unknown) => error instanceof HttpError && error.status === 503);
});

test('audit write failure after a dispatched RPC retains the on-disk reservation and stops new actions', async t => {
    const f = fixture(t);
    f.configure('preview');
    await f.warm();
    f.configure('automatic');
    const update = f.store.updateState.bind(f.store);
    let writes = 0;
    f.store.updateState = state => {
        if (++writes === 2) throw new Error('synthetic outcome write failure');
        update(state);
    };
    await f.step(60);
    assert.equal(f.rpc.count('disconnectnode'), 1);
    assert.equal(f.store.snapshot().state.attempts[0]!.outcome, 'requested');
    assert.equal(f.coordinator.snapshot().available, false);
});

test('clock jumps, RPC gaps, and node restart reset the Preview epoch', async t => {
    for (const interruption of ['gap', 'failure', 'restart', 'clock', 'wall'] as const) {
        const f = fixture(t);
        f.configure('preview');
        await f.warm();
        f.configure('automatic');
        if (interruption === 'gap') {
            f.advance(31);
            f.observe();
        } else if (interruption === 'failure') f.coordinator.failed();
        else if (interruption === 'clock') { f.advance(-100); f.observe(); }
        else if (interruption === 'wall') { f.shiftWall(100); f.observe(); }
        else {
            f.rpc.values.uptime = () => 10 + Math.floor(f.now / 1_000);
            await f.step(60);
        }
        assert(f.coordinator.snapshot().preview_remaining_seconds > 0, interruption);
        await f.coordinator.evaluate();
        assert.equal(f.rpc.count('disconnectnode'), 0, interruption);
    }
});

test('unknown, inactive, or wrong-chain health prevents automatic actions', async t => {
    const cases = [
        { network: {}, blockchain: { chain: 'main', initialblockdownload: false } },
        { network: { networkactive: false }, blockchain: { chain: 'main', initialblockdownload: false } },
        { network: { networkactive: true }, blockchain: { chain: 'main', initialblockdownload: true } },
        { network: { networkactive: true }, blockchain: { chain: 'test', initialblockdownload: false } },
        { network: { networkactive: true }, blockchain: { chain: 'main' } },
    ];
    for (const value of cases) {
        const f = fixture(t);
        f.configure('preview');
        await f.warm();
        f.configure('automatic');
        f.rpc.values.getnetworkinfo = value.network;
        f.rpc.values.getblockchaininfo = value.blockchain;
        await f.step(60);
        assert.equal(f.rpc.count('disconnectnode'), 0);
        assert.notEqual(f.coordinator.snapshot().effective_state, 'running');
    }
});

test('rate limit is one per five minutes, six per rolling hour, and one per host cooldown', async t => {
    const f = fixture(t, { candidates: 10 });
    f.configure('preview');
    await f.warm();
    f.configure('automatic');
    f.rpc.values.disconnectnode = (params: unknown[]) => {
        f.peers = f.peers.filter(item => item.id !== params[1]);
        return null;
    };
    await f.step(60);
    await f.step(10);
    assert.equal(f.rpc.count('disconnectnode'), 1);
    // Continue frequent canonical observations while minute evaluation enforces limits.
    for (let index = 0; index < 190; index++) await f.step(10);
    assert.equal(f.rpc.count('disconnectnode'), 6);
    const times = f.store.snapshot().state.attempts.map(attempt => attempt.time);
    assert(times.slice(1).every((time, index) => time - times[index]! >= 300));
    assert(f.coordinator.snapshot().next_action_at! >= times[0]! + 3_600);
});

test('same-host cooldown protects other sessions behind one address regardless of source port', async t => {
    const f = fixture(t, { candidates: 2 });
    f.peers.find(item => item.id === 31)!.addr = '192.0.2.30:18333';
    f.configure('preview');
    await f.warm();
    f.configure('automatic');
    f.rpc.values.disconnectnode = (params: unknown[]) => {
        f.peers = f.peers.filter(item => item.id !== params[1]);
        return null;
    };
    await f.step(60);
    assert.equal(f.coordinator.snapshot().next_action_at, f.store.snapshot().state.attempts[0]!.time + 1_800);
    for (let index = 0; index < 160; index++) await f.step(10);
    assert.equal(f.rpc.count('disconnectnode'), 1);
    for (let index = 0; index < 25; index++) await f.step(10);
    assert.equal(f.rpc.count('disconnectnode'), 2);
    const attempts = f.store.snapshot().state.attempts;
    assert.equal(attempts[0]!.address, attempts[1]!.address);
    assert(attempts[1]!.time - attempts[0]!.time >= 1_800);
});

test('read-only snapshots hide expired events while Off performs no retention writes or RPC', t => {
    const directory = temporaryDirectory(t);
    const store = new PeerPolicyStore(directory, 'synthetic-main');
    const event = { peer_id: 30, address: '192.0.2.30', kind: 'would_disconnect' as const, reason: 'Synthetic preview.' };
    store.updateState({ attempts: [], last_wall_time: WALL - 10, events: [
        { ...event, id: 'expired', time: WALL - 7 * 86_400 - 1 },
        { ...event, id: 'recent', time: WALL - 10 },
    ] });
    const rpc = new FakeRpc();
    const coordinator = new PeerPolicyCoordinator(store, {
        rpc, refreshPeers: async () => true, managementEnabled: true, chain: 'main',
        clock: () => 0, wallClock: () => WALL,
    });
    assert.deepEqual(coordinator.snapshot().events.map(item => item.id), ['recent']);
    assert.equal(store.snapshot().state.events.length, 2);
    assert.equal(rpc.calls.length, 0);
});

test('persisted budgets survive a new coordinator while Automatic must observe again', async t => {
    const f = fixture(t);
    f.configure('preview');
    await f.warm();
    f.configure('automatic');
    await f.step(60);
    const reservation = f.store.snapshot().state.attempts[0]!;
    const restarted = new PeerPolicyCoordinator(new PeerPolicyStore(f.directory, 'synthetic-main'), {
        rpc: f.rpc, refreshPeers: async () => true, managementEnabled: true, chain: 'main',
        clock: () => f.now, wallClock: () => WALL + f.now / 1_000,
    });
    assert.equal(restarted.snapshot().config.mode, 'automatic');
    assert.equal(restarted.snapshot().preview_remaining_seconds, 1_800);
    assert.equal(restarted.snapshot().next_action_at, reservation.time + 300);
    await restarted.evaluate();
    assert.equal(f.rpc.count('disconnectnode'), 1);
});

test('corrupt persisted state cannot crash runtime construction or restore Automatic', t => {
    const directory = temporaryDirectory(t);
    writeFileSync(join(directory, 'peer-policy.json'), '{broken');
    const coordinator = new PeerPolicyCoordinator(new PeerPolicyStore(directory, 'synthetic-main'), {
        rpc: new FakeRpc(), refreshPeers: async () => true, managementEnabled: true, chain: 'main',
    });
    assert.equal(coordinator.snapshot().available, false);
    assert.equal(coordinator.snapshot().config.mode, 'off');
    assert.match(coordinator.snapshot().reason, /storage is unavailable/);
});

test('removing the management credential disables a restored policy without observation, RPC, or writes', async t => {
    const directory = temporaryDirectory(t), store = new PeerPolicyStore(directory, 'synthetic-main');
    store.configure({ mode: 'automatic', listener_allowance: 0, keep_addresses: [] }, 0);
    const before = store.snapshot(), rpc = new FakeRpc();
    const coordinator = new PeerPolicyCoordinator(store, { rpc, refreshPeers: async () => true,
        managementEnabled: false, chain: 'main', clock: () => 0, wallClock: () => WALL });
    coordinator.start();
    coordinator.observe([peer(30)], 0);
    await coordinator.evaluate();
    assert.equal(coordinator.snapshot().effective_state, 'paused');
    assert.equal(coordinator.snapshot().available, false);
    assert.deepEqual(coordinator.snapshot().peers, []);
    assert.deepEqual(store.snapshot(), before);
    assert.equal(rpc.calls.length, 0);
    await coordinator.stop();
});
