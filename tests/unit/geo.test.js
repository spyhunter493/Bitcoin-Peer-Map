import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGeoAge, geoSourceLabel, geoFreshnessLabel } from '../../src/static/js/core/geo.js';
import { renderPeerDetails } from '../../src/static/js/peers/detail.js';
import { sortPeers } from '../../src/static/js/peers/table-model.js';

test('GeoIP presentation distinguishes retained stale data from unknown and unavailable data', () => {
    const geo = { source: 'ip_api', freshness: 'stale', age_seconds: 30 * 86400, observed_at: 1700000000, stale_after_seconds: 30 * 86400 };
    assert.equal(geoSourceLabel(geo), 'ip-api.com');
    assert.equal(geoFreshnessLabel(geo), 'Stale');
    assert.equal(formatGeoAge(geo.age_seconds), '30 days');
    assert.equal(formatGeoAge(null), 'Unknown');
    assert.equal(formatGeoAge(-1), 'Unknown');
    assert.equal(geoSourceLabel({ source: null, freshness: 'unavailable' }), 'Unavailable');
    assert.equal(geoFreshnessLabel({ freshness: 'unknown' }), 'Unknown age');
    const html = renderPeerDetails({ id: 42, network: 'ipv4', addr: '8.8.8.8:8333', services: [], country: 'New Zealand', geo }).html;
    assert.match(html, /GeoIP source.*ip-api\.com/);
    assert.match(html, /GeoIP age.*30 days/);
    assert.match(html, /GeoIP freshness.*Stale/);
    assert.match(html, /New Zealand/);
});

test('GeoIP age sorts numerically with unknown ages last in either direction', () => {
    const peers = [{ id: 1, geo: { age_seconds: 10 * 86400 } }, { id: 2, geo: { age_seconds: 2 * 86400 } }, { id: 3, geo: { age_seconds: null } }];
    const column = { key: 'geo_age_seconds', get: peer => formatGeoAge(peer.geo.age_seconds) };
    assert.deepEqual(sortPeers(peers, column, true).map(peer => peer.id), [2, 1, 3]);
    assert.deepEqual(sortPeers(peers, column, false).map(peer => peer.id), [1, 2, 3]);
});
