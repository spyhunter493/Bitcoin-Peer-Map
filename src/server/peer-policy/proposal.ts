import type { PeerInfo } from '../rpc-types.ts';
import { POLICY_LIMITS, type PolicyAttempt, type PolicyConfig, type PolicyEvaluation, type PolicyProposal, type PolicyProposalEntry } from './types.ts';

type Reservation = Pick<PolicyAttempt, 'time' | 'address'>;

class MinHeap<T> {
    private readonly values: T[] = [];
    private readonly compare: (a: T, b: T) => number;
    constructor(compare: (a: T, b: T) => number) { this.compare = compare; }
    get first(): T | undefined { return this.values[0]; }
    push(value: T): void {
        let index = this.values.length;
        this.values.push(value);
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (this.compare(this.values[parent]!, value) <= 0) break;
            this.values[index] = this.values[parent]!; index = parent;
        }
        this.values[index] = value;
    }
    pop(): T | undefined {
        const first = this.values[0], last = this.values.pop();
        if (this.values.length && last !== undefined) {
            let index = 0;
            while (index * 2 + 1 < this.values.length) {
                let child = index * 2 + 1;
                if (child + 1 < this.values.length && this.compare(this.values[child + 1]!, this.values[child]!) < 0) child++;
                if (this.compare(last, this.values[child]!) <= 0) break;
                this.values[index] = this.values[child]!; index = child;
            }
            this.values[index] = last;
        }
        return first;
    }
}

/** Also used by dispatch: projections must honor the same rolling reservations. */
export function nextPolicyAttemptAt(attempts: readonly Reservation[], wall: number): number {
    const recent = attempts.filter(attempt => wall - attempt.time < 3_600).sort((a, b) => a.time - b.time);
    let next = recent.length ? recent[recent.length - 1]!.time + POLICY_LIMITS.attempt_interval_seconds : wall;
    if (recent.length >= POLICY_LIMITS.max_attempts_per_hour) {
        next = Math.max(next, recent[recent.length - POLICY_LIMITS.max_attempts_per_hour]!.time + 3_600);
    }
    return Math.max(wall, next);
}

/** A bounded hypothetical queue, never an observation or a dispatch reservation. */
export function buildPolicyProposal(
    peers: readonly PeerInfo[], evaluation: PolicyEvaluation, config: PolicyConfig,
    attempts: readonly PolicyAttempt[], wall: number, blockingReason: string | null,
): PolicyProposal {
    const raw = new Map(peers.map(peer => [peer.id, peer]));
    const entries: PolicyProposalEntry[] = evaluation.peers.filter(view => raw.get(view.peer_id)?.inbound === true).map(view => ({
        peer_id: view.peer_id, address: view.address, action: view.status === 'protected' ? 'retained' : 'blocked',
        order: null, proposed_at: null, reason: view.reason,
    }));
    const byId = new Map(entries.map(entry => [entry.peer_id, entry]));
    const candidates = evaluation.peers.filter(view => view.status === 'candidate' && byId.has(view.peer_id))
        .sort((a, b) => raw.get(a.peer_id)!.conntime! - raw.get(b.peer_id)!.conntime! ||
            JSON.stringify([a.peer_id, a.address]).localeCompare(JSON.stringify([b.peer_id, b.address])));
    const networks = new Map<string, number>(), groups = new Map<number, number>();
    for (const peer of peers) {
        if (peer.network) networks.set(peer.network, (networks.get(peer.network) ?? 0) + 1);
        if (Number.isSafeInteger(peer.mapped_as) && peer.mapped_as! > 0) groups.set(peer.mapped_as!, (groups.get(peer.mapped_as!) ?? 0) + 1);
    }
    let remaining = peers.length, cursor = wall, order = 0;
    const removed = new Set<number>();
    const hostReadyAt = new Map<string, number>();
    for (const attempt of attempts) hostReadyAt.set(attempt.address,
        Math.max(hostReadyAt.get(attempt.address) ?? wall, attempt.time + POLICY_LIMITS.address_cooldown_seconds));
    const times = attempts.map(attempt => attempt.time).filter(time => wall - time < 3_600).sort((a, b) => a - b);
    let firstTime = 0;
    const rateReadyAt = (): number => {
        while (firstTime < times.length && cursor - times[firstTime]! >= 3_600) firstTime++;
        const count = times.length - firstTime;
        let ready = count ? times[times.length - 1]! + POLICY_LIMITS.attempt_interval_seconds : cursor;
        if (count >= POLICY_LIMITS.max_attempts_per_hour) ready = Math.max(ready, times[times.length - POLICY_LIMITS.max_attempts_per_hour]! + 3_600);
        return Math.max(cursor, ready);
    };
    const floorReason = (id: number): string | null => {
        const peer = raw.get(id)!;
        if (remaining - 1 < POLICY_LIMITS.min_total_peers) return 'Projected connectivity floor prevents removal';
        if ((networks.get(peer.network!) ?? 0) <= 1) return 'Projected last connection on this transport network';
        if (peer.mapped_as && groups.has(peer.mapped_as)) {
            const after = groups.size - (groups.get(peer.mapped_as) === 1 ? 1 : 0);
            if (after < Math.min(2, groups.size)) return 'Projected AS diversity floor prevents removal';
        }
        return null;
    };
    // Only the oldest eligible connection for a host can win selection. Keeping
    // one heap entry per host avoids rescanning every peer after each departure.
    const active = candidates.map(candidate => !floorReason(candidate.peer_id));
    let activeCount = active.filter(Boolean).length;
    const byNetwork = new Map<string, number[]>(), byGroup = new Map<number, number[]>();
    const hosts = new Map<string, { indices: number[]; cursor: number }>();
    candidates.forEach((candidate, index) => {
        const network = byNetwork.get(candidate.network) ?? []; network.push(index); byNetwork.set(candidate.network, network);
        const group = raw.get(candidate.peer_id)!.mapped_as;
        if (group && groups.has(group)) { const members = byGroup.get(group) ?? []; members.push(index); byGroup.set(group, members); }
        const host = hosts.get(candidate.host) ?? { indices: [], cursor: 0 }; host.indices.push(index); hosts.set(candidate.host, host);
    });
    const block = (indices: readonly number[] = []): void => {
        for (const index of indices) if (active[index]) { active[index] = false; activeCount--; }
    };
    let allowanceCursor = candidates.length - 1, boundary = candidates.length;
    let reserved: number[] = [];
    const updateAllowance = (): void => {
        reserved = reserved.filter(index => active[index]);
        while (reserved.length < config.listener_allowance && allowanceCursor >= 0) {
            if (active[allowanceCursor]) reserved.push(allowanceCursor);
            allowanceCursor--;
        }
        boundary = reserved.length ? Math.min(...reserved) : candidates.length;
    };
    updateAllowance();
    const hostHead = (host: string): number | null => {
        const members = hosts.get(host)!;
        while (members.cursor < members.indices.length) {
            const index = members.indices[members.cursor]!;
            if (index >= boundary) { members.cursor = members.indices.length; break; }
            if (active[index]) return index;
            members.cursor++;
        }
        return null;
    };
    type HostEntry = { host: string; index: number; time: number };
    const ready = new MinHeap<HostEntry>((a, b) => a.index - b.index);
    const waiting = new MinHeap<HostEntry>((a, b) => a.time - b.time || a.index - b.index);
    for (const host of hosts.keys()) {
        const index = hostHead(host);
        if (index !== null) waiting.push({ host, index, time: hostReadyAt.get(host) ?? wall });
    }
    while (!blockingReason && remaining > POLICY_LIMITS.min_total_peers && activeCount > config.listener_allowance) {
        updateAllowance();
        let selection: HostEntry | undefined;
        while (!selection) {
            const at = rateReadyAt();
            while (waiting.first && waiting.first.time <= at) {
                const item = waiting.pop()!, index = hostHead(item.host);
                if (index !== null) ready.push({ ...item, index });
            }
            while (ready.first) {
                const item = ready.pop()!, index = hostHead(item.host);
                if (index === null) continue;
                if (index !== item.index) { ready.push({ ...item, index }); continue; }
                const time = hostReadyAt.get(item.host) ?? wall;
                if (time > at) { waiting.push({ ...item, time }); continue; }
                selection = { ...item, time: at }; break;
            }
            if (selection || !waiting.first) break;
            cursor = Math.max(cursor, waiting.first.time);
        }
        if (!selection) break;
        const candidate = candidates[selection.index]!, hostReady = hostReadyAt.get(candidate.host) ?? wall;
        const entry = byId.get(candidate.peer_id)!, at = selection.time;
        const rateReady = rateReadyAt();
        const delays = [hostReady > wall ? 'same-host cooldown' : '', rateReady > wall ? 'attempt spacing and rolling-hour budget' : ''].filter(Boolean);
        Object.assign(entry, { action: 'planned', order: ++order, proposed_at: at,
            reason: `Conditional removal after fresh revalidation${delays.length ? `; timing respects ${delays.join(' and ')}` : ''}.` });
        times.push(at);
        hostReadyAt.set(candidate.host, at + POLICY_LIMITS.address_cooldown_seconds);
        cursor = at;
        removed.add(candidate.peer_id);
        active[selection.index] = false; activeCount--;
        remaining--;
        networks.set(candidate.network, networks.get(candidate.network)! - 1);
        if (networks.get(candidate.network) === 1) block(byNetwork.get(candidate.network));
        const oldGroupCount = groups.size;
        const group = raw.get(candidate.peer_id)!.mapped_as;
        if (group && groups.has(group)) {
            const count = groups.get(group)! - 1;
            if (count) groups.set(group, count); else groups.delete(group);
        }
        if (groups.size <= 2) {
            if (oldGroupCount > 2) { for (const [asn, count] of groups) if (count === 1) block(byGroup.get(asn)); }
            else if (group && groups.get(group) === 1) block(byGroup.get(group));
        }
        const next = hostHead(candidate.host);
        if (next !== null) waiting.push({ host: candidate.host, index: next, time: at + POLICY_LIMITS.address_cooldown_seconds });
    }
    for (const candidate of candidates) {
        if (removed.has(candidate.peer_id)) continue;
        const entry = byId.get(candidate.peer_id)!;
        const floor = floorReason(candidate.peer_id);
        entry.action = blockingReason || floor ? 'blocked' : 'retained';
        entry.reason = blockingReason ?? floor ?? 'Within the configured listener allowance after projected departures';
    }
    entries.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
    return { conditional: true, planned: order, retained: entries.filter(entry => entry.action === 'retained').length,
        blocked: entries.filter(entry => entry.action === 'blocked').length, entries };
}
