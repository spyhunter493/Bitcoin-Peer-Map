/** @param {number | null | undefined} seconds */
export function formatGeoAge(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'Unknown';
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} days`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    return `${Math.floor(seconds)}s`;
}

/** @param {import('../types').Peer['geo']} geo */
export function geoSourceLabel(geo) {
    if (geo?.source === 'dataset') return 'Downloaded dataset';
    if (geo?.source === 'ip_api') return 'ip-api.com';
    return geo?.freshness === 'unavailable' ? 'Unavailable' : 'Unknown';
}

/** @param {import('../types').Peer['geo']} geo */
export function geoFreshnessLabel(geo) {
    if (geo?.freshness === 'fresh') return 'Fresh';
    if (geo?.freshness === 'stale') return 'Stale';
    if (geo?.freshness === 'unavailable') return 'Unavailable';
    return 'Unknown age';
}
