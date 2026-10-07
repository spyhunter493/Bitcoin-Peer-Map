import test from 'node:test';
import assert from 'node:assert/strict';
import { toDisplayPeer } from '../../src/static/js/peers/data.js';
import { mempoolView, blockchainView } from '../../src/static/js/node/rpc-view.js';

test('peer display projection guards retained provider values and accepts database flags without mutating the wire object', () => {
    const raw = { id: 1, port: '8333', country: 'NZ', lat: 1, lon: 2, city: { unsafe: true },
        isp: ['unsafe'], as: 'AS1 Example', countryCode: 'NZ', offset: 'unsafe', mobile: 1, hosting: 0, proxy: false };
    const view = toDisplayPeer(raw);
    assert.equal(view.city, ''); assert.equal(view.isp, ''); assert.equal(view.offset, 0);
    assert.equal(view.mobile, true); assert.equal(view.hosting, false); assert.equal(view.proxy, false);
    assert.equal(view.as, raw.as); assert.equal(view.countryCode, 'NZ'); assert.equal(view.port, '8333');
    assert.deepEqual(raw.city, { unsafe: true }); assert.deepEqual(raw.isp, ['unsafe']); assert.equal(raw.mobile, 1);
});

test('RPC display projections guard extension fields while retaining valid values and nullable failures', () => {
    assert.equal(mempoolView(null), null); assert.equal(blockchainView(null), null);
    const mempool = { size: 3, bytes: 200, usage: { unexpected: true }, total_fee: 0.5,
        maxmempool: Infinity, mempoolminfee: 'unsafe', minrelaytxfee: 0.001, fullrbf: false, unbroadcastcount: 2 };
    const view = mempoolView(mempool);
    assert.equal(view.bytes, 200); assert.equal(view.usage, null); assert.equal(view.maxmempool, null);
    assert.equal(view.mempoolminfee, null); assert.equal(view.minrelaytxfee, 0.001);
    assert.equal(view.fullrbf, false); assert.equal(view.unbroadcastcount, 2); assert.equal(view.total_fee, 0.5);
    assert.deepEqual(mempool.usage, { unexpected: true });
    const blockchain = blockchainView({ blocks: 1, initialblockdownload: null, headers: 'unsafe', difficulty: 2,
        softforks: JSON.parse('{"valid":{"active":true,"type":"bip9"},"bad":12,"__proto__":{"active":false,"type":"bip8"}}') });
    assert.equal(blockchain.headers, null); assert.equal(blockchain.difficulty, 2);
    assert.deepEqual(blockchain.softforks.valid, { active: true, type: 'bip9' });
    assert.equal('bad' in blockchain.softforks, false); assert.equal(Object.getPrototypeOf(blockchain.softforks), null);
    assert.equal(blockchain.softforks.__proto__.type, 'bip8');
});
