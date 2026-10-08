import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateValue, formatCoordinate } from '../../src/static/js/core/coordinates.js';
import { sortPeers } from '../../src/static/js/peers/table-model.js';

for (const key of ['lat', 'lon']) {
    test(`${key} coordinates accept real finite values and exclude unresolved placeholders`, () => {
        for (const location_status of [undefined, 'ok']) {
            for (const [value, display] of [[-32.789, '-32.79'], [0, '0.00'], [0.125, '0.13'], [2, '2.00']]) {
                const peer = { [key]: value, location_status };
                assert.equal(coordinateValue(peer, key), value);
                assert.equal(formatCoordinate(peer, key), display);
            }
            for (const value of [null, undefined, '2', NaN, Infinity, -Infinity, {}, false]) {
                assert.equal(coordinateValue({ [key]: value, location_status }, key), null);
                assert.equal(formatCoordinate({ [key]: value, location_status }, key), '—');
            }
        }
        for (const location_status of ['pending', 'private', 'unavailable', '', null, 'invalid']) {
            for (const value of [0, 2]) {
                assert.equal(coordinateValue({ [key]: value, location_status }, key), null);
                assert.equal(formatCoordinate({ [key]: value, location_status }, key), '—');
            }
        }
        assert.equal(formatCoordinate({}, key), '—');
    });

    test(`${key} sorts raw coordinates numerically, keeps missing last, and preserves stable ties and inputs`, () => {
        const values = [null, 30, 2, 10, 0, -5, 0.1242, 0.1241, 2, undefined, '4', NaN, Infinity];
        const peers = values.map((value, id) => Object.freeze({ id, [key]: value, location_status: 'ok' }));
        for (const location_status of ['pending', 'private', 'unavailable']) {
            peers.push(Object.freeze({ id: peers.length, [key]: 0, location_status }));
        }
        Object.freeze(peers);
        const original = [...peers];
        const missingIds = [0, 9, 10, 11, 12, 13, 14, 15];
        const column = { key, get: peer => formatCoordinate(peer, key) };
        assert.equal(formatCoordinate(peers[6], key), formatCoordinate(peers[7], key), 'rounded display ties still sort by their distinct raw numbers');
        assert.deepEqual(sortPeers(peers, column, true).map(peer => peer.id), [5, 4, 7, 6, 2, 8, 3, 1, ...missingIds]);
        assert.deepEqual(sortPeers(peers, column, false).map(peer => peer.id), [1, 3, 2, 8, 6, 7, 4, 5, ...missingIds]);
        assert.deepEqual(sortPeers(peers, undefined, true), original);
        const missing = peers.filter(peer => coordinateValue(peer, key) === null);
        for (const ascending of [true, false]) assert.deepEqual(sortPeers(missing, column, ascending), missing);
        assert.deepEqual(peers, original);
    });

    test(`${key} reorders a pending zero only after a located snapshot arrives`, () => {
        const column = { key, get: peer => formatCoordinate(peer, key) };
        const pending = [{ id: 1, [key]: 0, location_status: 'pending' }, { id: 2, [key]: 2, location_status: 'ok' }];
        assert.deepEqual(sortPeers(pending, column, true).map(peer => peer.id), [2, 1]);
        const located = pending.map(peer => peer.id === 1 ? { ...peer, location_status: 'ok' } : peer);
        assert.deepEqual(sortPeers(located, column, true).map(peer => peer.id), [1, 2]);
        assert.deepEqual(sortPeers(located, column, false).map(peer => peer.id), [2, 1]);
        assert.equal(formatCoordinate(pending[0], key), '—');
        assert.equal(formatCoordinate(located[0], key), '0.00');
    });
}
