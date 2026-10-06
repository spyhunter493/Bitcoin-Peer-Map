import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNodeDetails, renderChainTips } from '../../src/static/js/node/monitor.js';

for (const [status, indexed, height, label] of [
    ['disabled', false, null, 'Disabled'],
    ['syncing', true, 123, 'Syncing'],
    ['ready', true, 456, 'Ready'],
    ['unknown', false, null, 'Unknown'],
    [undefined, true, undefined, 'Enabled'],
    [undefined, false, undefined, 'Disabled'],
]) {
    test(`transaction index ${status ?? `legacy ${indexed}`} reports ${label}`, () => {
        const html = renderNodeDetails({ blockchain: { indexed, txindex_status: status, txindex_height: height } }, { stale: false });
        const index = html.match(/<div class="modal-row"><span class="modal-label"[^>]*>TX Index<\/span><span class="modal-val" title="([^"]*)">([^<]*)<\/span><\/div>/);
        assert.ok(index);
        assert.equal(index[2], label);
        if (height != null) assert.ok(index[1].includes(`indexed through block ${height}`));
        if (status === 'unknown' || status === undefined && indexed) {
            assert.ok(index[1].includes('readiness unavailable'));
            assert.doesNotMatch(index[1], /ready|synced/i);
        }
    });
}
test('partial chain-tip ages report timeouts independently of the lookup cap', () => {
    const data = { success: true, tips: [{ height: 100, hash: 'abc', branch_length: 0, status: 'active', time: null, age_seconds: null }], summary: { total: 1, active_count: 1, non_active_count: 0, age_lookup_timed_out: true, age_lookup_limited: false } };
    const html = renderChainTips(data);
    assert.match(html, /lookup timed out/);
    assert.doesNotMatch(html, /limited to the first/);
    assert.match(html, />—<\/td>/);
    data.summary.age_lookup_limited = true;
    data.summary.age_lookup_limit = 100;
    assert.match(renderChainTips(data), /limited to the first 100/);
    data.summary.age_lookup_timed_out = false;
    assert.doesNotMatch(renderChainTips(data), /lookup timed out/);
});
