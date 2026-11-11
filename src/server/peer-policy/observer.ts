import { isIP } from 'node:net';
import { HttpError } from '../http.ts';
import { object } from '../types.ts';
import type { PeerInfo } from '../rpc-types.ts';
import { buildPolicyProposal } from './proposal.ts';
import { POLICY_LIMITS, type PolicyAttempt, type PolicyConfig, type PolicyEvaluation, type PolicyPeer, type PolicyProposal } from './types.ts';

const MAX_SESSIONS = 2000;
const BLOCK_SERVICES = 0x401n;
const KNOWN_SERVICES = 0x10000c4dn;
const NETWORKS = new Set(['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns']);
const PASSIVE_MESSAGES = new Set(['version', 'verack', 'sendaddrv2', 'wtxidrelay', 'sendcmpct', 'sendheaders', 'feefilter', 'ping', 'pong', 'addr', 'addrv2', 'getaddr', 'inv']);
const ACTIVE_MESSAGES = new Set(['getdata', 'tx', 'notfound', 'getblocks', 'getheaders', 'headers', 'block', 'cmpctblock', 'getblocktxn', 'blocktxn', 'merkleblock', 'filterload', 'filteradd', 'filterclear', 'getcfcheckpt', 'cfcheckpt', 'getcfheaders', 'cfheaders', 'getcfilters', 'cfilter', 'mempool']);
const nonnegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const validTime = (value: number) => Number.isFinite(value) && value >= 0;

/** Exact host identity only: never resolve DNS or accept a subnet. */
export function normalizePolicyAddress(address: string): string | null {
    if (typeof address !== 'string' || address.length > 512 || !address || address !== address.trim() || /[\s/%\\@?#]/.test(address)) return null;
    let host = address;
    if (address.startsWith('[')) {
        const match = /^\[([^\[\]]+)\](?::([0-9]+))?$/.exec(address);
        if (!match || isIP(match[1]) !== 6 || (match[2] !== undefined && (!nonnegativeInteger(Number(match[2])) || Number(match[2]) > 65535))) return null;
        host = match[1];
    } else if (!isIP(address)) {
        const match = /^([^:]+)(?::([0-9]+))?$/.exec(address);
        if (!match || (match[2] !== undefined && (!nonnegativeInteger(Number(match[2])) || Number(match[2]) > 65535))) return null;
        host = match[1];
    }
    const family = isIP(host);
    if (family === 4) return host;
    if (family === 6) {
        const canonical = new URL(`http://[${host}]/`).hostname.slice(1, -1);
        const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
        if (!mapped) return canonical;
        const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
        return [high >> 8, high & 255, low >> 8, low & 255].join('.');
    }
    const lower = host.toLowerCase();
    return /^(?:[a-z2-7]{16}|[a-z2-7]{56})\.onion$/.test(lower) || /^[a-z2-7]{52}\.b32\.i2p$/.test(lower) ? lower : null;
}

export const policyIdentity = (peer: PeerInfo): string => JSON.stringify([peer.id, peer.addr, peer.conntime ?? null, peer.session_id ?? null]);

function services(peer: PeerInfo): bigint | null {
    if (typeof peer.services !== 'string' || !/^[0-9a-f]{1,16}$/i.test(peer.services)) return null;
    return BigInt(`0x${peer.services}`);
}
function messageMap(value: unknown): Record<string, number> | null {
    if (!object(value)) return null;
    const keys = Object.keys(value);
    if (keys.length > 64 || keys.some(key => !/^[a-z0-9_*]{1,32}$/.test(key) || !nonnegativeInteger(value[key]))) return null;
    return { ...value } as Record<string, number>;
}
interface Frame {
    peer: PeerInfo; identity: string; host: string; reason: string | null;
    sent: Record<string, number> | null; received: Record<string, number> | null;
    signals: number[]; quietSince: number | null;
}
function frame(peer: PeerInfo, wallSeconds: number): Frame {
    peer = { ...peer };
    const host = normalizePolicyAddress(peer.addr) ?? '';
    const current: Frame = { peer, identity: policyIdentity(peer), host, reason: null,
        sent: messageMap(peer.bytessent_per_msg), received: messageMap(peer.bytesrecv_per_msg), signals: [], quietSince: null };
    const unknown = (reason: string) => { current.reason = reason; return current; };
    if (!nonnegativeInteger(peer.id) || !host || typeof peer.network !== 'string' || !NETWORKS.has(peer.network)
        || !nonnegativeInteger(peer.conntime) || peer.conntime === 0) return unknown('Connection identity or transport is unavailable');
    if (peer.conntime > wallSeconds + 300) return unknown('Connection timestamp is inconsistent with the local clock');
    const family = isIP(host);
    if ((peer.network === 'ipv4' && family !== 4) || (['ipv6', 'cjdns'].includes(peer.network) && family !== 6)
        || (peer.network === 'onion' && !host.endsWith('.onion')) || (peer.network === 'i2p' && !host.endsWith('.b32.i2p'))) return unknown('Connection transport is inconsistent');
    if (typeof peer.inbound !== 'boolean' || typeof peer.connection_type !== 'string') return unknown('Connection direction is unavailable');
    if (peer.inbound ? peer.connection_type !== 'inbound' : !['manual', 'outbound-full-relay', 'block-relay-only', 'feeler', 'addr-fetch'].includes(peer.connection_type)) return unknown('Connection direction is inconsistent');
    if (!Array.isArray(peer.permissions) || peer.permissions.length > 32 || !peer.permissions.every(value => typeof value === 'string' && value.length > 0 && value.length <= 64)) return unknown('Peer permissions are unavailable');
    if (peer.forced_inbound !== undefined && typeof peer.forced_inbound !== 'boolean') return unknown('Inbound permission metadata is invalid');
    const bits = services(peer);
    if (bits === null || (bits & ~KNOWN_SERVICES) !== 0n) return unknown('Peer service bits are unavailable or unsupported');
    if (peer.servicesnames != null && (!Array.isArray(peer.servicesnames) || peer.servicesnames.length > 32
        || !peer.servicesnames.every(name => typeof name === 'string' && name.length <= 64)
        || (peer.servicesnames.includes('NETWORK') && !(bits & 1n)) || (peer.servicesnames.includes('NETWORK_LIMITED') && !(bits & 1024n)))) return unknown('Peer service metadata is inconsistent');
    if (!['v1', 'v2'].includes(peer.transport_protocol_type ?? '') || typeof peer.session_id !== 'string'
        || (peer.transport_protocol_type === 'v2' ? !/^[0-9a-f]{64}$/i.test(peer.session_id) : peer.session_id !== '')) return unknown('Connection session metadata is unavailable');
    if (!current.sent || !current.received) return unknown('Per-message traffic evidence is unavailable');
    if (!nonnegativeInteger(peer.bytessent) || !nonnegativeInteger(peer.bytesrecv)) return unknown('Traffic totals are unavailable');
    for (const map of [current.sent, current.received]) for (const [type, bytes] of Object.entries(map)) {
        if (!PASSIVE_MESSAGES.has(type) && !ACTIVE_MESSAGES.has(type) && bytes > 0) return unknown('Unclassified traffic protects this connection');
    }
    for (const key of ['last_transaction', 'last_block', 'last_block_announcement']) {
        if (!nonnegativeInteger(peer[key])) return unknown('Contribution timestamps are unavailable');
        if ((peer[key] as number) > 0 && ((peer[key] as number) > wallSeconds + 300 || (peer[key] as number) < peer.conntime - 300)) return unknown('Contribution timestamps are inconsistent');
        current.signals.push(peer[key] as number);
    }
    for (const key of ['synced_headers', 'synced_blocks', 'presynced_headers']) {
        if (!Number.isSafeInteger(peer[key]) || (peer[key] as number) < -1) return unknown('Chain progress evidence is unavailable');
        current.signals.push(peer[key] as number);
    }
    if (!Array.isArray(peer.inflight) || peer.inflight.length > 1024 || !peer.inflight.every(nonnegativeInteger)) return unknown('In-flight block evidence is unavailable');
    return current;
}
function trafficActivity(previous: Frame, current: Frame): 'quiet' | 'active' | 'regressed' {
    if (current.peer.bytessent! < previous.peer.bytessent! || current.peer.bytesrecv! < previous.peer.bytesrecv!) return 'regressed';
    let active = previous.signals.some((value, index) => current.signals[index] !== value);
    for (const [index, [oldMap, newMap]] of [[previous.sent, current.sent], [previous.received, current.received]].entries()) {
        if (!oldMap || !newMap) return 'regressed';
        let classifiedBytes = 0;
        for (const key of new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
            const before = oldMap[key] ?? 0, after = newMap[key] ?? 0;
            if (after < before) return 'regressed';
            classifiedBytes += after - before;
            if (after > before && !PASSIVE_MESSAGES.has(key)) active = true;
        }
        const totalDelta = index === 0 ? current.peer.bytessent! - previous.peer.bytessent! : current.peer.bytesrecv! - previous.peer.bytesrecv!;
        // Wire framing differs by transport; do not demand byte-for-byte equality.
        if (totalDelta > 0 && classifiedBytes === 0) active = true;
    }
    return active ? 'active' : 'quiet';
}

/** Pure observations; only canonical successful RPC arrivals may advance evidence. */
export class ListenerObserver {
    lastObservedAt: number | null = null;
    continuousSince: number | null = null;
    private lastWallSeconds: number | null = null;
    private frames = new Map<string, Frame>();
    proposal(config: PolicyConfig, evaluation: PolicyEvaluation, wall: number, attempts: readonly PolicyAttempt[], reason: string | null): PolicyProposal {
        return buildPolicyProposal([...this.frames.values()].map(row => row.peer), evaluation, config, attempts, wall, reason);
    }
    reset(): void { this.frames.clear(); this.lastObservedAt = null; this.continuousSince = null; this.lastWallSeconds = null; }
    observe(peers: PeerInfo[], observedAt: number, wallSeconds: number): void {
        if (!Array.isArray(peers) || peers.length > MAX_SESSIONS || !validTime(observedAt) || !validTime(wallSeconds)) {
            this.reset(); throw new HttpError(503, 'Peer policy observation is unavailable or exceeds its bounds.', 'peer_policy_observation_unavailable');
        }
        if (this.lastObservedAt !== null) {
            const elapsed = observedAt - this.lastObservedAt;
            const wallElapsed = wallSeconds - this.lastWallSeconds!;
            if (elapsed <= 0 || elapsed > 30_000 || wallElapsed < 0 || Math.abs(wallElapsed - elapsed / 1000) > 30) this.reset();
        }
        this.continuousSince ??= observedAt;
        const next = new Map<string, Frame>(), ids = new Set<number>();
        for (const peer of peers) {
            if (!object(peer) || ids.has(peer.id)) { this.reset(); throw new HttpError(503, 'Peer policy received ambiguous connection identities.', 'peer_policy_observation_unavailable'); }
            if (typeof peer.addr !== 'string' || peer.addr.length > 512
                || (typeof peer.network === 'string' && peer.network.length > 32)
                || (typeof peer.session_id === 'string' && peer.session_id.length > 128)) {
                this.reset(); throw new HttpError(503, 'Peer policy connection metadata exceeds its bounds.', 'peer_policy_observation_unavailable');
            }
            ids.add(peer.id);
            const current = frame(peer, wallSeconds), previous = this.frames.get(current.identity);
            if (!current.reason) {
                const activity = previous && !previous.reason ? trafficActivity(previous, current) : 'active';
                if (activity === 'regressed') current.reason = 'Traffic counters reset; fresh evidence is required';
                else current.quietSince = activity === 'quiet' ? previous!.quietSince ?? observedAt : observedAt;
            }
            next.set(current.identity, current);
        }
        this.frames = next; this.lastObservedAt = observedAt; this.lastWallSeconds = wallSeconds;
    }
    inspect(config: PolicyConfig, now: number, wallSeconds: number): PolicyEvaluation {
        const frames = [...this.frames.values()];
        const groups = new Map<number, number>();
        for (const row of frames) if (nonnegativeInteger(row.peer.mapped_as) && row.peer.mapped_as > 0) {
            groups.set(row.peer.mapped_as, (groups.get(row.peer.mapped_as) ?? 0) + 1);
        }
        const networks = new Map<string, number>();
        for (const row of frames) if (row.peer.network && NETWORKS.has(row.peer.network)) networks.set(row.peer.network, (networks.get(row.peer.network) ?? 0) + 1);
        const outbound = frames.filter(row => row.peer.inbound === false && ['manual', 'outbound-full-relay', 'block-relay-only'].includes(row.peer.connection_type ?? '') && ((services(row.peer) ?? 0n) & BLOCK_SERVICES)).length;
        const stale = !validTime(now) || !validTime(wallSeconds) || this.lastObservedAt === null || now < this.lastObservedAt || now - this.lastObservedAt > 30_000
            || this.lastWallSeconds === null || wallSeconds < this.lastWallSeconds || Math.abs((wallSeconds - this.lastWallSeconds) - (now - this.lastObservedAt) / 1000) > 30;
        const views = frames.map(row => {
            const peer = row.peer;
            const age = nonnegativeInteger(peer.conntime) && peer.conntime > 0 && wallSeconds >= peer.conntime ? wallSeconds - peer.conntime : null;
            const evidenceEnd = Math.min(now, this.lastObservedAt ?? now);
            const observed = row.quietSince === null || !validTime(evidenceEnd) || evidenceEnd < row.quietSince ? 0 : Math.max(0, (evidenceEnd - row.quietSince) / 1000);
            const view: PolicyPeer = { peer_id: peer.id, address: peer.addr, host: row.host, network: peer.network ?? 'unknown',
                subver: typeof peer.subver === 'string' && peer.subver.length <= 512 && peer.subver.trim()
                    && !/[\u0000-\u001f\u007f-\u009f]/.test(peer.subver) ? peer.subver : null,
                connection_age_seconds: age, observed_seconds: observed,
                remaining_seconds: Math.max(0, POLICY_LIMITS.grace_seconds - (age ?? 0), POLICY_LIMITS.observation_seconds - observed), status: 'unknown', reason: '' };
            const protect = (reason: string) => { view.status = 'protected'; view.reason = reason; return { row, view }; };
            if (config.mode === 'off') return protect('Policy is off');
            if (stale) { view.reason = 'Fresh uninterrupted peer observations are required'; return { row, view }; }
            if (peer.inbound === false || peer.connection_type === 'manual') return protect('Outbound and manual connections are exempt');
            if (row.reason) { view.reason = row.reason; return { row, view }; }
            if (peer.permissions!.length || peer.forced_inbound === true) return protect('Permissioned connections are exempt');
            if (config.keep_addresses.includes(row.host)) return protect('Operator Keep exception');
            if ((services(peer)! & BLOCK_SERVICES) !== 0n) return protect('Block-serving services are protected');
            if ((peer.inflight as unknown[]).length || (peer.presynced_headers as number) >= 0) return protect('Active chain synchronization is protected');
            if (age === null) { view.reason = 'Connection time is unavailable or ahead of the local clock'; return { row, view }; }
            if (view.remaining_seconds > 0) { view.status = 'observing'; view.reason = 'Waiting for connection grace and uninterrupted quiet observations'; return { row, view }; }
            if (frames.length - 1 < POLICY_LIMITS.min_total_peers || outbound < POLICY_LIMITS.min_outbound_peers) return protect('Connectivity floor prevents removal');
            if ((networks.get(view.network) ?? 0) <= 1) return protect('Last connection on this transport network');
            const candidateAs = peer.mapped_as;
            if (nonnegativeInteger(candidateAs) && candidateAs > 0) {
                const remaining = groups.size - (groups.get(candidateAs) === 1 ? 1 : 0);
                if (remaining < Math.min(2, groups.size)) return protect('AS diversity floor prevents removal');
            }
            view.status = 'candidate'; view.reason = 'No block-serving services; only listener traffic observed through the quiet window';
            return { row, view };
        });
        const candidates = views.filter(item => item.view.status === 'candidate').sort((a, b) => a.row.peer.conntime! - b.row.peer.conntime! || a.row.identity.localeCompare(b.row.identity));
        const removeCount = Math.max(0, candidates.length - config.listener_allowance);
        for (const item of candidates.slice(removeCount)) item.view.reason = 'Within the configured listener allowance';
        return { peers: views.map(item => item.view), eligible: candidates.slice(0, removeCount).map(({ row, view }) => ({ identity: row.identity, host: row.host, peer: row.peer, view })),
            counts: { inbound: frames.filter(row => row.peer.inbound === true).length, candidates: candidates.length, exempt: views.filter(item => item.view.status === 'protected').length }, as_diversity_available: groups.size > 0 };
    }
}
