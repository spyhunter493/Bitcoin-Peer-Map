import { isMeasuredPing } from '../core/ping.js';

export const networks = Object.freeze(['onion', 'i2p', 'cjdns']);
/** @type {Readonly<Record<string, string>>} */
export const labels = Object.freeze({ onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' });
/** @param {import('../types').Peer[]} peers @param {string | null} [network] */
export function scope(peers, network = null) {
    return peers.filter(peer => networks.includes(peer.network) && (!network || peer.network === network));
}
/** Derive donut counts from live map nodes, independently of panel snapshot data.
 * @param {import('../types').MapNode[]} nodes */
export function liveCounts(nodes) {
    /** @type {Record<string, number>} */
    const counts = { onion: 0, i2p: 0, cjdns: 0 };
    for (const node of nodes) if (node.alive && Object.hasOwn(counts, node.peer.network)) counts[node.peer.network]++;
    return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}
/** @param {import('../types').Peer[]} peers */
export function summarize(peers) {
    let inbound = 0, outbound = 0, totalPing = 0, pingCount = 0, totalBytesSent = 0, totalBytesRecv = 0;
    /** @type {Record<string, import('../types').Peer[]>} */
    const softwareMap = Object.create(null), servicesMap = Object.create(null), connTypeMap = Object.create(null);
    for (const peer of peers) {
        if (peer.direction === 'IN') inbound++; else outbound++;
        if (isMeasuredPing(peer.ping_ms)) { totalPing += peer.ping_ms; pingCount++; }
        totalBytesSent += peer.bytessent || 0;
        totalBytesRecv += peer.bytesrecv || 0;
        const software = peer.subver || 'Unknown', services = peer.services_abbrev || '\u2014', type = peer.connection_type || 'unknown';
        (softwareMap[software] ||= []).push(peer);
        (servicesMap[services] ||= []).push(peer);
        (connTypeMap[type] ||= []).push(peer);
    }
    return { inbound, outbound, avgPing: pingCount ? totalPing / pingCount : null,
        totalBytesSent, totalBytesRecv, softwareMap, servicesMap, connTypeMap };
}
/** Ties retain snapshot order; zero byte totals do not invent a winner.
 * @param {import('../types').Peer[]} peers @param {number} nowSeconds */
export function insights(peers, nowSeconds) {
    /** @type {import('../types').Peer | null} */
    let bestStablePeer = null, bestPingPeer = null, bestSentPeer = null, bestRecvPeer = null;
    let bestStableDur = 0, bestPing = Infinity, bestSent = 0, bestRecv = 0;
    for (const peer of peers) {
        const duration = peer.conntime > 0 ? nowSeconds - peer.conntime : 0;
        if (duration > bestStableDur) { bestStableDur = duration; bestStablePeer = peer; }
        if (isMeasuredPing(peer.ping_ms) && peer.ping_ms < bestPing) { bestPing = peer.ping_ms; bestPingPeer = peer; }
        if ((peer.bytessent || 0) > bestSent) { bestSent = peer.bytessent; bestSentPeer = peer; }
        if ((peer.bytesrecv || 0) > bestRecv) { bestRecv = peer.bytesrecv; bestRecvPeer = peer; }
    }
    return { bestStablePeer, bestStableDur, bestPingPeer, bestPing, bestSentPeer, bestSent, bestRecvPeer, bestRecv };
}
