import type { PeerInfo } from '../rpc-types.ts';
import type { Peer } from '../api-types.ts';

export const PEER_SNAPSHOT_STALE_AFTER_SECONDS = 30;
type PeerRates = Pick<Peer, 'rx_bps' | 'tx_bps'>;
type Observation = PeerRates & { received: number | null; sent: number | null; time: number };
const unavailable = (): PeerRates => ({ rx_bps: null, tx_bps: null });
const identity = (peer: PeerInfo) => JSON.stringify([peer.id, peer.addr, peer.conntime ?? null, peer.session_id || null]);

function rate(current: number | null, previous: number | null, elapsed: number): number | null {
    if (current === null || previous === null || current < previous || elapsed <= 0
        || elapsed > PEER_SNAPSHOT_STALE_AFTER_SECONDS) return null;
    const value = (current - previous) / elapsed;
    return Number.isFinite(value) ? value : null;
}

/** Rates belong to RPC observations, independently of dashboard reads and GeoIP enrichment. */
export class PeerBandwidthRates {
    private observations = new Map<string, Observation>();
    clear() { this.observations.clear(); }
    sample(peers: PeerInfo[], observedAt: number) {
        const current = new Map<string, Observation>();
        for (const peer of peers) {
            const key = identity(peer), previous = this.observations.get(key);
            const received = peer.bytesrecv ?? null, sent = peer.bytessent ?? null;
            const elapsed = previous ? (observedAt - previous.time) / 1000 : 0;
            current.set(key, {
                received, sent, time: observedAt,
                rx_bps: previous ? rate(received, previous.received, elapsed) : null,
                tx_bps: previous ? rate(sent, previous.sent, elapsed) : null,
            });
        }
        // Departed connections must not retain a baseline if their identity later returns.
        this.observations = current;
    }
    get(peer: PeerInfo, now: number): PeerRates {
        const observation = this.observations.get(identity(peer));
        if (!observation || now < observation.time
            || now - observation.time > PEER_SNAPSHOT_STALE_AFTER_SECONDS * 1000) return unavailable();
        return { rx_bps: observation.rx_bps, tx_bps: observation.tx_bps };
    }
}
