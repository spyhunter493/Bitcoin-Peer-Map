import { randomUUID } from 'node:crypto';
import type { PeerInfo } from '../rpc-types.ts';
import { splitPeerAddress } from '../network.ts';
import type { HistoryEvent, HistoryBucket } from './types.ts';

const identity = (peer: PeerInfo) =>
    JSON.stringify([
        peer.id,
        peer.addr,
        peer.conntime,
        peer.network,
        peer.connection_type,
        peer.inbound,
        peer.session_id,
        peer.transport_protocol_type
    ]);
/** Consecutive successful observations establish changes; gaps never imply departures. */
export class HistoryRecorder {
    private epoch = randomUUID();
    private previous: Map<string, PeerInfo> | null = null;
    private gap = false;
    private last: { wall: number; mono: number } | null = null;
    private departed = new Map<string, number>();
    private pending: HistoryEvent[] = [];
    private enabled = false;
    private lastCounts: Pick<HistoryBucket, 'inbound' | 'outbound' | 'networks'> = {
        inbound: 0,
        outbound: 0,
        networks: {}
    };
    setEnabled(enabled: boolean, wall: number) {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        this.previous = null;
        this.last = null;
        this.departed.clear();
        this.gap = false;
        this.epoch = randomUUID();
        if (enabled)
            this.push(
                'recording_started',
                null,
                'Recording began with a baseline; existing peers are not new arrivals.',
                wall
            );
    }
    restart(wall: number) {
        if (!this.enabled) return;
        this.gap = true;
        this.push('monitoring_gap', null, 'BPM restarted; observations during process downtime are unknown.', wall);
    }
    private push(kind: string, peer: PeerInfo | null, reason: string, time: number) {
        this.pending.push({
            id: randomUUID(),
            time,
            source: 'peer',
            kind,
            address: peer?.addr ?? null,
            peer_id: peer?.id ?? null,
            reason
        });
    }
    observe(peers: PeerInfo[] | null, mono: number, wall: number): void {
        if (!this.enabled) return;
        if (
            this.last &&
            (mono < this.last.mono ||
                wall < this.last.wall ||
                Math.abs((mono - this.last.mono) / 1000 - (wall - this.last.wall)) > 5)
        ) {
            this.push('clock_gap', null, 'Clock change interrupted recording; a fresh baseline is required.', wall);
            this.previous = null;
            this.departed.clear();
            this.epoch = randomUUID();
        } else if (this.last && mono - this.last.mono > 30000) {
            this.push(
                'monitoring_gap',
                null,
                'The observation interval exceeded 30 seconds; intervening connection changes are unknown.',
                wall
            );
            this.previous = null;
            this.departed.clear();
            this.gap = true;
        }
        this.last = { mono, wall };
        if (peers === null) {
            if (!this.gap)
                this.push(
                    'monitoring_gap',
                    null,
                    'Peer observation failed; arrivals and departures during this interval are unknown.',
                    wall
                );
            this.gap = true;
            this.previous = null;
            this.departed.clear();
            return;
        }
        if (peers.length > 2000) {
            this.observe(null, mono, wall);
            return;
        }
        if (peers.some((peer) => !Number.isSafeInteger(peer.conntime) || peer.conntime! < 0)) {
            if (!this.gap)
                this.push(
                    'monitoring_gap',
                    null,
                    'Connection identity metadata is incomplete; changes cannot be established safely.',
                    wall
                );
            this.gap = true;
            this.previous = null;
            this.departed.clear();
            return;
        }
        const current = new Map(peers.map((peer) => [this.epoch + identity(peer), peer]));
        this.lastCounts = {
            inbound: peers.filter((p) => p.inbound === true).length,
            outbound: peers.filter((p) => p.inbound === false).length,
            networks: {}
        };
        for (const peer of peers) {
            const network = peer.network ?? 'unknown';
            this.lastCounts.networks[network] = (this.lastCounts.networks[network] ?? 0) + 1;
        }
        if (this.gap) {
            this.push(
                'monitoring_recovered',
                null,
                'Peer observations recovered; recording resumed from a new baseline.',
                wall
            );
            this.gap = false;
        }
        if (this.previous) {
            for (const [key, peer] of this.previous)
                if (!current.has(key)) {
                    this.push(
                        'departed',
                        peer,
                        'Connection was absent in the next successful observation; departure cause is unknown.',
                        wall
                    );
                    const [host] = splitPeerAddress(peer.addr ?? '');
                    this.departed.set(host, wall);
                }
            for (const [key, peer] of current)
                if (!this.previous.has(key)) {
                    this.push('arrived', peer, 'A connection was first observed between successful polls.', wall);
                    const [host] = splitPeerAddress(peer.addr ?? '');
                    if (this.departed.has(host))
                        this.push(
                            'same_address_return',
                            peer,
                            'A connection was observed at a previously departed address; this does not establish client identity.',
                            wall
                        );
                }
        }
        for (const [host, time] of this.departed) if (wall - time > 30 * 86400) this.departed.delete(host);
        while (this.departed.size > 4000) this.departed.delete(this.departed.keys().next().value!);
        this.previous = current;
    }
    drain(): HistoryEvent[] {
        const events = this.pending;
        this.pending = [];
        return events;
    }
    counts() {
        return structuredClone(this.lastCounts);
    }
    baselineValid() {
        return this.previous !== null && !this.gap;
    }
}
