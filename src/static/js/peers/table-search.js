/** @type {Record<string, string>} */
const NETWORK_NAMES = {
    ipv4: 'IPv4',
    ipv6: 'IPv6',
    onion: 'Tor Onion',
    i2p: 'I2P',
    cjdns: 'CJDNS',
};

/**
 * Match every search word against the peer's identity and descriptive fields.
 * Values stay plain strings, including addresses and untrusted software names.
 *
 * @param {readonly import('../types').Peer[]} peers
 * @param {string | null | undefined} query
 * @returns {import('../types').Peer[]}
 */
function filterSearch(peers, query) {
    const words = (query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [...peers];
    return peers.filter((peer) => {
        const network = peer.network || 'ipv4';
        const values = [
            peer.id, peer.addr, peer.ip, peer.port,
            network, NETWORK_NAMES[network], peer.subver,
            peer.city, peer.region, peer.regionName, peer.country, peer.countryCode,
            peer.isp, peer.org, peer.as, peer.asname,
            peer.direction, peer.direction === 'IN' ? 'inbound' : peer.direction === 'OUT' ? 'outbound' : '',
            peer.connection_type,
        ].map((value) => value == null ? '' : String(value).toLowerCase());
        return words.every((word) => values.some((value) => value.includes(word)));
    });
}

export { filterSearch };
