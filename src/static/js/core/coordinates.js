/** Read real coordinates while excluding unresolved location placeholders.
 * @param {{location_status?: unknown; lat?: unknown; lon?: unknown}} peer
 * @param {'lat' | 'lon'} key
 * @returns {number | null} */
export function coordinateValue(peer, key) {
    if (peer.location_status !== undefined && peer.location_status !== 'ok') return null;
    const value = peer[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** @param {{location_status?: unknown; lat?: unknown; lon?: unknown}} peer
 * @param {'lat' | 'lon'} key */
export function formatCoordinate(peer, key) {
    return coordinateValue(peer, key)?.toFixed(2) ?? '—';
}

/** Missing coordinates stay last in either direction.
 * @param {number | null} left @param {number | null} right @param {boolean} ascending */
export function compareCoordinates(left, right, ascending) {
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return ascending ? left - right : right - left;
}
