/** GeoIP text and flags are retained verbatim on the wire; normalize them once for browser views. */
const text = /** @param {unknown} value */ value => typeof value === 'string' ? value : '';
const number = /** @param {unknown} value */ value => typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** @param {import('../../../shared/api.generated').Peer} peer
 * @returns {import('../types').Peer} */
export function toDisplayPeer(peer) {
    return {
        ...peer,
        continent: text(peer.continent), continentCode: text(peer.continentCode),
        countryCode: text(peer.countryCode), region: text(peer.region), regionName: text(peer.regionName),
        city: text(peer.city), district: text(peer.district), zip: text(peer.zip),
        timezone: text(peer.timezone), currency: text(peer.currency), isp: text(peer.isp),
        org: text(peer.org), as: text(peer.as), asname: text(peer.asname),
        offset: number(peer.offset), mobile: Boolean(peer.mobile), proxy: Boolean(peer.proxy), hosting: Boolean(peer.hosting),
    };
}
