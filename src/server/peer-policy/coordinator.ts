import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.ts';
import type { PeerInfo } from '../rpc-types.ts';
import { RpcAuthenticationError, RpcBusyError, RpcError, RpcTransportError } from '../rpc.ts';
import { object, type Rpc } from '../types.ts';
import { ListenerObserver, normalizePolicyAddress, policyIdentity } from './observer.ts';
import { nextPolicyAttemptAt } from './proposal.ts';
import { parsePolicyConfig, type PeerPolicyStore } from './store.ts';
import {
    DEFAULT_POLICY_CONFIG, POLICY_LIMITS,
    type PolicyAttempt, type PolicyCandidate, type PolicyDocument, type PolicyEvaluation,
    type PolicyEvent, type PolicyEventKind, type PolicyFailureGuard, type PolicySnapshot, type PolicyState, type PolicyStatus,
} from './types.ts';

const MINUTE = 60_000;
const RETENTION = 604_800;
const MAX_EVENTS = 200;
const MAX_ENTRIES = 2_000;
const EMPTY_EVALUATION: PolicyEvaluation = {
    peers: [], eligible: [], counts: { inbound: 0, candidates: 0, exempt: 0 }, as_diversity_available: false,
};

export interface PolicyCoordinatorDependencies {
    rpc: Rpc;
    refreshPeers: () => Promise<boolean>;
    signal?: AbortSignal;
    /** Monotonic milliseconds, using the same clock as canonical peer observations. */
    clock?: () => number;
    /** Epoch seconds, used only for persistence and connection ages. */
    wallClock?: () => number;
    managementEnabled: boolean;
    chain: string;
}

interface Health { at: number; uptime: number; checkedAt: number; reason: string | null }

/** Server-owned policy. Reads never poll RPC or advance its observation windows. */
export class PeerPolicyCoordinator {
    private readonly observer = new ListenerObserver();
    private readonly store: PeerPolicyStore;
    private readonly dependencies: PolicyCoordinatorDependencies;
    private readonly clock: () => number;
    private readonly wallClock: () => number;
    private epoch = randomUUID();
    private document: PolicyDocument;
    private persistenceError: string | null = null;
    private observationError: string | null = null;
    private health: Health | null = null;
    private trialStarted: number | null = null;
    private latestIdentities = new Set<string>();
    private lastEvaluate: number | null = null;
    private lastHealthAttempt: number | null = null;
    private lastClock: { monotonic: number; wall: number } | null = null;
    private work: Promise<void> | null = null;
    private controller = new AbortController();
    private timer: ReturnType<typeof setInterval> | null = null;
    private started = false;
    private stopped = false;
    private lastPreviewIdentity: string | null = null;

    constructor(store: PeerPolicyStore, dependencies: PolicyCoordinatorDependencies) {
        this.store = store;
        this.dependencies = dependencies;
        this.clock = dependencies.clock ?? (() => performance.now());
        this.wallClock = dependencies.wallClock ?? (() => Date.now() / 1_000);
        try { this.document = store.snapshot(); }
        catch {
            this.persistenceError = 'Policy storage is unavailable; automatic actions are disabled.';
            this.document = {
                version: 1, scope: '', revision: 0,
                config: structuredClone(DEFAULT_POLICY_CONFIG),
                state: { attempts: [], events: [], last_wall_time: 0 },
            };
        }
        dependencies.signal?.addEventListener('abort', () => { void this.stop(); }, { once: true });
        if (dependencies.signal?.aborted) this.stopped = true;
    }

    start(): void {
        if (this.started || this.stopped || this.dependencies.signal?.aborted) return;
        this.started = true;
        this.schedule();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        this.cancelPending();
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        await this.work;
    }

    private schedule(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        if (!this.started || this.stopped || !this.dependencies.managementEnabled || this.document.config.mode === 'off' || this.persistenceError || this.document.state.failure_guard?.paused) return;
        this.timer = setInterval(() => { void this.evaluate(); }, MINUTE);
        this.timer.unref();
        void this.evaluate();
    }

    private cancelPending(): void {
        this.controller.abort();
        this.controller = new AbortController();
    }

    private resetEvidence(): void {
        this.observer.reset();
        this.latestIdentities.clear();
        this.trialStarted = null;
        this.epoch = randomUUID();
        this.lastPreviewIdentity = null;
    }

    /** Only called by canonical, serialized peer refreshes, never by HTTP reads. */
    observe(peers: PeerInfo[], observedAt: number): void {
        if (this.document.config.mode === 'off' || this.stopped || !this.dependencies.managementEnabled || this.persistenceError) return;
        const wall = this.wallClock();
        if (!this.validTime(observedAt, wall)) return;
        const previousContinuous = this.observer.continuousSince;
        try {
            this.observer.observe(peers, observedAt, wall);
            if (this.observer.continuousSince !== previousContinuous) {
                this.trialStarted = this.observer.continuousSince;
                this.epoch = randomUUID();
                this.lastPreviewIdentity = null;
            }
            this.observationError = null;
            const previousIdentities = this.latestIdentities;
            this.latestIdentities = new Set(peers.map(peer => policyIdentity(peer)));
            this.reconcileDepartures(peers.filter(peer => !previousIdentities.has(policyIdentity(peer))), wall);
        } catch {
            this.resetEvidence();
            this.observationError = 'Peer evidence is incomplete or exceeds policy limits; observing again.';
        }
    }

    failed(): void {
        if (this.document.config.mode === 'off' || this.stopped) return;
        this.resetEvidence();
        this.observationError = 'Peer refresh failed; a fresh observation window is required.';
    }

    private validTime(monotonic: number, wall: number): boolean {
        const previous = this.lastClock;
        const valid = Number.isFinite(monotonic) && monotonic >= 0 && Number.isFinite(wall) && wall >= 0 &&
            (!previous || (monotonic >= previous.monotonic && wall >= previous.wall &&
                Math.abs((monotonic - previous.monotonic) / 1_000 - (wall - previous.wall)) <= 5)) &&
            wall >= this.document.state.last_wall_time;
        this.lastClock = Number.isFinite(monotonic) && Number.isFinite(wall) ? { monotonic, wall } : null;
        if (!valid) {
            this.resetEvidence();
            this.health = null;
            this.observationError = 'A clock anomaly interrupted observation; automatic actions are paused.';
        }
        return valid;
    }

    configure(payload: unknown): PolicySnapshot {
        if (!object(payload) || Object.keys(payload).some(key => !['expected_revision', 'config'].includes(key)) ||
            !Number.isSafeInteger(payload.expected_revision) || (payload.expected_revision as number) < 0 || !object(payload.config)) {
            throw new HttpError(422, 'Expected policy config and expected_revision.', 'peer_policy_invalid');
        }
        if (this.persistenceError || this.stopped) throw new HttpError(503, 'Policy is unavailable.', 'peer_policy_unavailable');
        if (payload.expected_revision !== this.document.revision) throw new HttpError(409, 'Policy revision changed; reload the policy.', 'peer_policy_conflict');
        const config = parsePolicyConfig(payload.config);
        if (config.mode !== 'off' && !this.dependencies.managementEnabled) {
            throw new HttpError(503, 'An administrator credential is required to enable the policy.', 'peer_policy_unavailable');
        }
        if (config.mode === 'automatic' && this.document.state.failure_guard?.paused) {
            throw new HttpError(409, 'Policy paused after RPC failures. Save Preview and complete a fresh trial before enabling Automatic.', 'peer_policy_preview_required');
        }
        if (config.mode === 'automatic' && this.document.config.mode !== 'automatic' &&
            (this.document.config.mode !== 'preview' || this.previewRemaining(this.clock()) > 0 || !this.freshObservation(this.clock()))) {
            throw new HttpError(409, 'Complete 30 minutes of fresh Preview before enabling Automatic.', 'peer_policy_preview_required');
        }
        const previous = this.document.config;
        const clearGuard = config.mode === 'preview' && this.document.state.failure_guard !== undefined;
        try {
            this.store.configure(config, payload.expected_revision as number, clearGuard ? {
                ...this.document.state, failure_guard: { consecutive_failures: 0, paused: false, reason: null },
            } : undefined);
            this.document = this.store.snapshot();
        } catch (error) {
            if (!(error instanceof HttpError) || error.status === 503) this.persistenceError = 'Policy storage is unavailable; automatic actions are disabled.';
            throw error;
        }
        this.cancelPending();
        const next = this.document.config;
        const settingsChanged = previous.listener_allowance !== next.listener_allowance ||
            JSON.stringify(previous.keep_addresses) !== JSON.stringify(next.keep_addresses);
        if (previous.mode === 'off' || next.mode === 'off' || settingsChanged || clearGuard) this.resetEvidence();
        this.schedule();
        return this.snapshot();
    }

    private previewRemaining(now: number): number {
        const evidenceAt = Math.min(now, this.observer.lastObservedAt ?? now);
        return this.trialStarted === null ? POLICY_LIMITS.observation_seconds :
            Math.max(0, Math.ceil(POLICY_LIMITS.observation_seconds - (evidenceAt - this.trialStarted) / 1_000));
    }

    private freshObservation(now: number): boolean {
        return this.observer.lastObservedAt !== null && now >= this.observer.lastObservedAt && now - this.observer.lastObservedAt <= 30_000;
    }

    private evaluation(now: number, wall: number): PolicyEvaluation {
        return this.document.config.mode === 'off' ? EMPTY_EVALUATION : this.observer.inspect(this.document.config, now, wall);
    }

    private pauseReason(now: number): string | null {
        if (!this.dependencies.managementEnabled) return 'An administrator credential is required to enable the policy.';
        if (this.persistenceError) return this.persistenceError;
        if (this.stopped || this.dependencies.signal?.aborted) return 'Policy coordinator is stopped.';
        if (this.document.state.failure_guard?.paused) return this.document.state.failure_guard.reason;
        if (this.observationError) return this.observationError;
        if (!this.freshObservation(now)) return 'Waiting for fresh peer observations.';
        if (this.previewRemaining(now) > 0) return 'Collecting a fresh 30-minute Preview trial.';
        if (!this.health || now < this.health.at || now - this.health.at > 60_000) return 'Waiting for fresh node health.';
        return this.health.reason;
    }

    private statusAt(now: number): PolicyStatus {
        const off = this.document.config.mode === 'off';
        const remaining = this.previewRemaining(now);
        const reason = this.persistenceError ?? (off ? 'Inbound policy is off.' : this.pauseReason(now));
        return {
            available: this.dependencies.managementEnabled && !this.persistenceError && !this.stopped,
            revision: this.document.revision, mode: this.document.config.mode,
            effective_state: off ? 'disabled' : reason ? (remaining > 0 && this.dependencies.managementEnabled && !this.stopped && !this.observationError && !this.persistenceError && !this.document.state.failure_guard?.paused ? 'observing' : 'paused') :
                this.document.config.mode === 'preview' ? 'preview' : 'running',
            reason: reason ?? (this.document.config.mode === 'preview' ? 'Preview only; no node changes.' : 'Automatic listener cleanup is active.'),
        };
    }

    /** Cheap closed-panel status: no peer inspection, projection, persistence, or RPC. */
    status(): PolicyStatus { return this.statusAt(this.clock()); }

    snapshot(): PolicySnapshot {
        const now = this.clock(), wall = this.wallClock();
        const evaluation = this.evaluation(now, wall), status = this.statusAt(now);
        const off = this.document.config.mode === 'off';
        const reason = off ? status.reason : this.pauseReason(now);
        const attempts = this.document.state.attempts.filter(attempt => wall - attempt.time < RETENTION);
        let nextAction = this.nextActionAt(wall);
        if (evaluation.eligible.length) {
            const hostReady = evaluation.eligible.map(candidate => this.document.state.attempts
                .filter(attempt => attempt.address === candidate.host)
                .reduce((ready, attempt) => Math.max(ready, attempt.time + POLICY_LIMITS.address_cooldown_seconds), wall));
            nextAction = Math.max(nextAction, Math.min(...hostReady));
        }
        return structuredClone({
            available: status.available,
            config: this.document.config, revision: this.document.revision,
            effective_state: status.effective_state, reason: status.reason,
            preview_remaining_seconds: off ? POLICY_LIMITS.observation_seconds : this.previewRemaining(now),
            next_action_at: off || (nextAction <= wall && (this.document.config.mode !== 'automatic' || reason || !evaluation.eligible.length)) ? null : nextAction,
            counts: evaluation.counts, limits: POLICY_LIMITS, peers: evaluation.peers,
            events: this.document.state.events.filter(event => wall - event.time < RETENTION).slice().reverse(), as_diversity_available: evaluation.as_diversity_available,
            proposal: this.observer.proposal(this.document.config, evaluation, wall, attempts, reason),
            results: { window_seconds: RETENTION, accepted_requests: attempts.filter(attempt => attempt.outcome === 'succeeded').length,
                observed_departures: new Set(attempts.filter(attempt => attempt.departure_observed).map(attempt => attempt.identity)).size,
                same_host_returns: new Set(attempts.filter(attempt => attempt.return_observed).map(attempt => attempt.identity)).size },
        });
    }

    /** Serialized and minute-throttled, including explicit invocations by tests. */
    evaluate(): Promise<void> {
        if (this.work) return this.work;
        if (this.stopped || this.document.config.mode === 'off' || this.persistenceError || !this.dependencies.managementEnabled || this.document.state.failure_guard?.paused) return Promise.resolve();
        const now = this.clock();
        if (this.lastEvaluate !== null && now >= this.lastEvaluate && now - this.lastEvaluate < MINUTE) return Promise.resolve();
        this.lastEvaluate = now;
        const work = this.evaluateOnce().catch(() => {
            this.resetEvidence();
            this.observationError = 'Policy evaluation failed; a fresh observation window is required.';
        });
        this.work = work;
        void work.finally(() => { if (this.work === work) this.work = null; });
        return work;
    }

    private async refreshHealth(now: number, signal: AbortSignal): Promise<void> {
        if (this.lastHealthAttempt !== null && now >= this.lastHealthAttempt && now - this.lastHealthAttempt < MINUTE) return;
        this.lastHealthAttempt = now;
        try {
            const [network, blockchain, uptime] = await Promise.all([
                this.dependencies.rpc.call('getnetworkinfo', [], 10, signal),
                this.dependencies.rpc.call('getblockchaininfo', [], 10, signal),
                this.dependencies.rpc.call('uptime', [], 10, signal),
            ]);
            signal.throwIfAborted();
            const finished = this.clock();
            if (!object(network) || typeof network.networkactive !== 'boolean' || !object(blockchain) ||
                typeof blockchain.initialblockdownload !== 'boolean' || typeof blockchain.chain !== 'string' ||
                !Number.isSafeInteger(uptime) || (uptime as number) < 0) throw new Error('Incomplete node health');
            const previous = this.health;
            if (previous && ((uptime as number) < previous.uptime ||
                Math.abs(((uptime as number) - previous.uptime) - (finished - previous.checkedAt) / 1_000) > 5)) {
                this.resetEvidence();
            }
            const reason = blockchain.chain !== this.dependencies.chain ? 'Connected node chain differs from the configured chain.' :
                !network.networkactive ? 'Node networking is inactive.' : blockchain.initialblockdownload ? 'Node is in initial block download.' : null;
            if (blockchain.chain !== this.dependencies.chain) this.resetEvidence();
            this.health = { at: finished, checkedAt: finished, uptime: uptime as number, reason };
        } catch {
            if (!signal.aborted) {
                this.health = null;
                this.resetEvidence();
                this.observationError = 'Node health RPC failed; a fresh observation window is required.';
            }
        }
    }

    private async evaluateOnce(): Promise<void> {
        const signal = this.dependencies.signal ? AbortSignal.any([this.controller.signal, this.dependencies.signal]) : this.controller.signal;
        const revision = this.document.revision;
        if (!this.validTime(this.clock(), this.wallClock())) return;
        this.pruneState(this.wallClock());
        if (this.persistenceError) return;
        await this.refreshHealth(this.clock(), signal);
        if (!this.validTime(this.clock(), this.wallClock())) return;
        if (signal.aborted || this.document.revision !== revision || this.pauseReason(this.clock())) return;
        let evaluation = this.evaluation(this.clock(), this.wallClock());
        const candidate = evaluation.eligible.find(item => !this.inCooldown(item, this.wallClock()));
        if (!candidate || this.nextActionAt(this.wallClock()) > this.wallClock()) return;
        if (this.document.config.mode === 'preview') {
            if (candidate.identity !== this.lastPreviewIdentity) {
                this.appendEvent('would_disconnect', candidate.peer.id, candidate.host, 'Listener allowance exceeded; Preview only.');
                this.lastPreviewIdentity = candidate.identity;
            }
            return;
        }
        if (this.document.config.mode !== 'automatic') return;
        const epoch = this.epoch;
        const previousObservation = this.observer.lastObservedAt;
        const refreshed = await this.dependencies.refreshPeers();
        if (!this.validTime(this.clock(), this.wallClock())) return;
        if (signal.aborted || !refreshed || this.document.revision !== revision || this.epoch !== epoch || this.pauseReason(this.clock())) return;
        // The canonical refresh can coalesce work whose RPC observation was
        // already published while GeoIP hydration is still finishing. Only a
        // genuinely newer RPC arrival can revalidate this selected connection.
        if (previousObservation === null || this.observer.lastObservedAt === null
            || this.observer.lastObservedAt <= previousObservation) return;
        evaluation = this.evaluation(this.clock(), this.wallClock());
        const current = evaluation.eligible.find(item => item.identity === candidate.identity);
        if (!current || this.inCooldown(current, this.wallClock()) || this.nextActionAt(this.wallClock()) > this.wallClock()) return;
        const attempt: PolicyAttempt = {
            id: randomUUID(), time: this.wallClock(), peer_id: current.peer.id,
            address: current.host, identity: `${this.epoch}:${current.identity}`, outcome: 'requested',
        };
        this.writeState({ ...this.document.state,
            attempts: [...this.document.state.attempts, attempt],
            events: [...this.document.state.events, this.event('requested', attempt.peer_id, attempt.address, 'Listener allowance exceeded; disconnect requested.', attempt.id)],
            last_wall_time: this.wallClock(),
        });
        if (this.persistenceError || signal.aborted || this.document.revision !== revision || this.epoch !== epoch || this.document.config.mode !== 'automatic') return;
        let outcome: PolicyAttempt['outcome'];
        let immediatePause = false;
        try {
            await this.dependencies.rpc.call('disconnectnode', ['', current.peer.id], 10, signal);
            outcome = 'succeeded';
        } catch (error) {
            outcome = error instanceof RpcError && !(error instanceof RpcTransportError) ? 'failed' : 'uncertain';
            if (error instanceof RpcBusyError || error instanceof RpcAuthenticationError) outcome = 'failed';
            immediatePause = error instanceof RpcAuthenticationError || (error instanceof RpcError && error.code === -32601);
        }
        const previousGuard = this.document.state.failure_guard;
        const failures = outcome === 'succeeded' ? 0 : Math.min(3, (previousGuard?.consecutive_failures ?? 0) + (outcome === 'failed' ? 1 : 0));
        const paused = previousGuard?.paused === true || immediatePause || failures >= 3;
        const guard: PolicyFailureGuard = { consecutive_failures: failures, paused,
            reason: paused ? 'Automatic cleanup paused after definite RPC failures. Save Preview to start a fresh trial before resuming.' : null };
        this.writeState({ ...this.document.state,
            attempts: this.document.state.attempts.map(item => item.id === attempt.id ? { ...item, outcome } : item),
            events: [...this.document.state.events, this.event(outcome, attempt.peer_id, attempt.address,
                outcome === 'succeeded' ? 'Disconnect RPC accepted; awaiting a later peer observation.' :
                    outcome === 'failed' ? 'Disconnect RPC failed; the attempt budget remains reserved.' :
                        'Disconnect outcome is uncertain; the attempt will not be retried blindly.'),
                ...(paused && !previousGuard?.paused ? [this.event('paused', null, null, guard.reason!)] : [])],
            last_wall_time: this.wallClock(),
            failure_guard: guard,
        });
        if (paused) { this.cancelPending(); this.schedule(); }
    }

    private inCooldown(candidate: PolicyCandidate, wall: number): boolean {
        return this.document.state.attempts.some(attempt => attempt.address === candidate.host && wall - attempt.time < POLICY_LIMITS.address_cooldown_seconds);
    }

    private nextActionAt(wall: number): number {
        return nextPolicyAttemptAt(this.document.state.attempts, wall);
    }

    private event(kind: PolicyEventKind, peerId: number | null, address: string | null, reason: string, id: string = randomUUID()): PolicyEvent {
        return { id, time: this.wallClock(), peer_id: peerId, address, kind, reason };
    }

    private appendEvent(kind: PolicyEventKind, peerId: number | null, address: string | null, reason: string): void {
        this.writeState({ ...this.document.state, events: [...this.document.state.events, this.event(kind, peerId, address, reason)], last_wall_time: this.wallClock() });
    }

    private reconcileDepartures(arrivals: PeerInfo[], wall: number): void {
        const departed = this.document.state.attempts.filter(attempt => !attempt.departure_observed &&
            attempt.identity.startsWith(`${this.epoch}:`) && !this.latestIdentities.has(attempt.identity.slice(this.epoch.length + 1)));
        const ids = new Set(departed.map(item => item.id));
        const hosts = new Map<string, Set<string>>();
        for (const peer of arrivals) {
            if (peer.inbound !== true || !Number.isSafeInteger(peer.id) || !Number.isSafeInteger(peer.conntime) || peer.conntime! <= 0) continue;
            const host = normalizePolicyAddress(peer.addr);
            if (!host) continue;
            const identities = hosts.get(host) ?? new Set<string>();
            identities.add(policyIdentity(peer)); hosts.set(host, identities);
        }
        const returned = this.document.state.attempts.filter(attempt => attempt.identity.startsWith(`${this.epoch}:`) && !attempt.return_observed && (attempt.departure_observed || ids.has(attempt.id)) &&
            [...(hosts.get(attempt.address) ?? [])].some(identity => identity !== attempt.identity.slice(attempt.identity.indexOf(':') + 1)));
        if (!departed.length && !returned.length) return;
        const returnedIds = new Set(returned.map(attempt => attempt.id));
        this.writeState({ ...this.document.state,
            attempts: this.document.state.attempts.map(attempt => ({ ...attempt,
                ...(ids.has(attempt.id) ? { departure_observed: true } : {}), ...(returnedIds.has(attempt.id) ? { return_observed: true } : {}) })),
            events: [...this.document.state.events, ...departed.map(attempt => this.event('departure_observed', attempt.peer_id, attempt.address,
                'Departure observed after request; its cause is not established.')),
                ...returned.map(attempt => this.event('same_host_return', attempt.peer_id, attempt.address,
                    'A different connection was observed at the same host after departure; shared addresses do not establish peer identity.'))], last_wall_time: wall,
        });
    }

    private pruneState(wall: number): void {
        const state = this.document.state;
        const attempts = state.attempts.filter(item => wall - item.time < RETENTION);
        const events = state.events.filter(item => wall - item.time < RETENTION).slice(-MAX_EVENTS);
        if (attempts.length !== state.attempts.length || events.length !== state.events.length) {
            this.writeState({ ...state, attempts, events, last_wall_time: wall });
        }
    }

    private writeState(state: PolicyState): void {
        if (this.persistenceError) return;
        if (state.attempts.length > MAX_ENTRIES || new Set(state.attempts.filter(item => this.wallClock() - item.time < POLICY_LIMITS.address_cooldown_seconds).map(item => item.address)).size > MAX_ENTRIES) {
            this.persistenceError = 'Policy state exceeds its bounded limits; automatic actions are disabled.';
            this.cancelPending();
            return;
        }
        try {
            const wall = this.wallClock();
            this.store.updateState({ ...state, events: state.events.filter(item => wall - item.time < RETENTION).slice(-MAX_EVENTS) });
            this.document = this.store.snapshot();
        } catch {
            this.persistenceError = 'Policy storage write failed; automatic actions are disabled.';
            this.cancelPending();
        }
    }
}
