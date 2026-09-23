/** @param {readonly import('../types').Peer[]} peers
 *  @param {import('../types').PeerTableFilters} filters
 *  @returns {import('../types').Peer[]} */
function filterPeers(peers, filters) {
    return peers.filter((peer) => {
        if (filters.privateMode) {
            return ['onion', 'i2p', 'cjdns'].includes(peer.network) && (!filters.privateNetwork || peer.network === filters.privateNetwork);
        }
        return (
            filters.passesNetwork(peer.network || 'ipv4') &&
            (!filters.providerPeerIds || filters.providerPeerIds.has(peer.id)) &&
            (!filters.mapPeerIds || filters.mapPeerIds.has(peer.id))
        );
    });
}

/** @param {readonly import('../types').Peer[]} peers
 *  @param {import('../types').PeerColumn | undefined} column
 *  @param {boolean} ascending
 *  @returns {import('../types').Peer[]} */
function sortPeers(peers, column, ascending) {
    const sorted = [...peers];
    if (!column) return sorted;
    return sorted.sort((a, b) => {
        let comparison;
        if (column.key === 'ping_ms') comparison = (a.ping_ms || 0) - (b.ping_ms || 0);
        else if (column.key === 'bytessent_fmt') comparison = (a.bytessent || 0) - (b.bytessent || 0);
        else if (column.key === 'bytesrecv_fmt') comparison = (a.bytesrecv || 0) - (b.bytesrecv || 0);
        // Older connection timestamps represent longer durations.
        else if (column.key === 'conntime_fmt') comparison = (b.conntime || 0) - (a.conntime || 0);
        else {
            const left = column.get(a);
            const right = column.get(b);
            comparison = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
        }
        return ascending ? comparison : -comparison;
    });
}

export { filterPeers };
export { sortPeers };
