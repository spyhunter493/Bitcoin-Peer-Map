import type { PeerSnapshot } from './api-types.ts';

const NETWORKS = ['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns'] as const;
function range(count: number) { const min = Math.floor(count / 5) * 5; return { min, max: min + 4 }; }

/** Deliberately build new objects from an allowlist, never spread a raw snapshot. */
export function viewingAggregate(snapshot: PeerSnapshot) {
    const status = snapshot.status;
    const availability = status.connected === false ? 'unavailable' as const
        : status.connected !== true || status.last_success_at === null || status.age_seconds === null ||
          status.age_seconds > status.stale_after_seconds ? 'unknown' as const : 'available' as const;
    const networks = Object.fromEntries(NETWORKS.map(network => [network, range(snapshot.peers.filter(peer => peer.network === network).length)])) as Record<typeof NETWORKS[number], ReturnType<typeof range>>;
    return { availability, networks, directions: {
        inbound: range(snapshot.peers.filter(peer => peer.direction === 'IN').length),
        outbound: range(snapshot.peers.filter(peer => peer.direction === 'OUT').length),
    } };
}
