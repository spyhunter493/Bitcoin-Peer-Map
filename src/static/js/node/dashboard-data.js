import { isMeasuredPing } from '../core/ping.js';

/** @type {Readonly<Record<string, string>>} */
export const networkLabels = Object.freeze({ ipv4: 'IPv4', ipv6: 'IPv6', onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' });
export const privateNetworks = Object.freeze(['onion', 'i2p', 'cjdns']);
/** @param {import('../types').Peer[]} peers */
export function networkCounts(peers) {
    /** @type {Record<string, {in: number; out: number}>} */
    const counts = Object.fromEntries(Object.keys(networkLabels).map(network => [network, { in: 0, out: 0 }]));
    for (const peer of peers) {
        const count = counts[peer.network || 'ipv4'];
        if (!count) continue;
        if (peer.direction === 'IN') count.in++; else count.out++;
    }
    return counts;
}
/** @param {import('../types').Peer[]} peers @param {string} network
 * @param {import('../types').NetworkDetails | undefined} details */
export function networkStats(peers, network, details) {
    /** @type {Record<string, number>} */
    const counts = Object.fromEntries(Object.keys(networkLabels).map(key => [key, 0]));
    let inbound = 0, outbound = 0, totalPing = 0, pingCount = 0;
    for (const peer of peers) {
        if (Object.hasOwn(counts, peer.network)) counts[peer.network]++;
        if (network !== 'all' && peer.network !== network) continue;
        if (peer.direction === 'IN') inbound++; else outbound++;
        if (isMeasuredPing(peer.ping_ms)) { totalPing += peer.ping_ms; pingCount++; }
    }
    const total = network === 'all' ? peers.length : counts[network] || 0;
    if (!total && network !== 'all' && !details) return null;
    return { counts, inbound, outbound, total, avgPing: pingCount ? totalPing / pingCount : null,
        label: network === 'all' ? 'All Networks' : networkLabels[network] || network.toUpperCase(), details };
}
/** @param {import('../types').NodeAddress} address */
export function formatNodeAddress(address) {
    if (!address || !address.address) return '';
    const host = String(address.address), port = Number(address.port || 0);
    if (!port) return host;
    return host.includes(':') && !host.endsWith('.onion') && !host.endsWith('.i2p') ? `[${host}]:${port}` : `${host}:${port}`;
}
/** @param {string} value */
export function shortNodeAddress(value) {
    return value.length <= 36 ? value : `${value.slice(0, 16)}...${value.slice(-15)}`;
}
/** @param {number} bps */
export function formatBps(bps) {
    if (bps < 1024) return `${Math.round(bps)} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}
/** Decide display text from a snapshot and an explicit observation time.
 * @param {import('../types').Peer[]} peers @param {import('../types').NodeDisplayInfo | null} info @param {number} nowSeconds */
export function locationStatus(peers, info, nowSeconds) {
    const provider = info?.providers?.geoip;
    const retryIn = provider?.retry_at == null ? 0 : Math.max(0, Math.ceil(provider.retry_at - nowSeconds));
    if (info?.geo_db_only_mode) return { text: 'API lookup off', loaded: false, color: 'var(--warn)' };
    if (provider?.state === 'disabled') return { text: 'External lookups disabled', loaded: false, color: 'var(--text-secondary)' };
    if (retryIn > 0) return { text: `${provider?.state === 'rate_limited' ? 'GeoIP rate limited' : 'GeoIP retry'} (${retryIn}s)`, loaded: false, color: 'var(--warn)' };
    if (provider?.state === 'unavailable' || info?.api_available === false) return { text: 'GeoIP provider unavailable', loaded: false, color: 'var(--warn)' };
    const pending = peers.filter(peer => peer.location_status === 'pending').length;
    if (pending) return { text: `Locating ${pending} peer${pending > 1 ? 's' : ''}...`, loaded: false, color: '' };
    if (peers.length) return { text: 'Map Loaded!', loaded: true, color: '' };
    return { text: null, loaded: null, color: '' };
}
