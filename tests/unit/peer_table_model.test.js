import { test, mock } from 'node:test';
import * as BPMPeerTableModel from '../../src/static/js/peers/table-model.js';
import assert from 'assert';

const model = BPMPeerTableModel;
const peers = [
    { id: 1, network: 'ipv4', direction: 'IN', bytessent: 1024, conntime: 100, subver: '<b>one</b>' },
    { id: 2, network: 'ipv6', direction: 'OUT', bytessent: 999, conntime: 200 },
    { id: 3, network: 'onion', direction: 'IN', bytessent: 1000000, conntime: 50 },
    { id: 4, network: 'i2p', direction: 'OUT' },
];
const ids = rows => Array.from(rows, peer => peer.id);
const filters = { privateMode: false, privateNetwork: null, passesNetwork: () => true,
    providerPeerIds: new Set([1, 2]), mapPeerIds: null };
assert.deepStrictEqual(ids(model.filterPeers(peers, filters)), [1, 2]);
filters.passesNetwork = network => network === 'ipv6';
assert.deepStrictEqual(ids(model.filterPeers(peers, filters)), [2]);
filters.mapPeerIds = new Set([1]);
assert.deepStrictEqual(ids(model.filterPeers(peers, filters)), []);
// Private mode ignores public map/provider filters, then narrows by private network.
filters.privateMode = true;
assert.deepStrictEqual(ids(model.filterPeers(peers, filters)), [3, 4]);
filters.privateNetwork = 'onion';
assert.deepStrictEqual(ids(model.filterPeers(peers, filters)), [3]);
assert.deepStrictEqual(ids(model.filterPeers(peers.filter(p => p.id !== 3), filters)), []);
assert.deepStrictEqual(ids(model.filterPeers([...peers, { id: 5, network: 'onion' }], filters)), [3, 5]);
const bytes = { key: 'bytessent_fmt', get: p => p.bytessent === 1024 ? '1 KB' : '999 B' };
assert.deepStrictEqual(ids(model.sortPeers(peers.slice(0, 3), bytes, true)), [2, 1, 3]);
assert.deepStrictEqual(ids(model.sortPeers(peers.slice(0, 3), bytes, false)), [3, 1, 2]);
const duration = { key: 'conntime_fmt', get: () => 'formatted duration' };
assert.deepStrictEqual(ids(model.sortPeers(peers.slice(0, 3), duration, true)), [2, 1, 3]);
assert.deepStrictEqual(ids(model.sortPeers(peers, undefined, true)), [1, 2, 3, 4]);
assert.strictEqual(peers[0].subver, '<b>one</b>');
console.log('Peer table model tests passed');
