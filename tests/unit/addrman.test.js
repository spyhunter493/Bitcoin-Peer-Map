import test from 'node:test';
import assert from 'node:assert/strict';
import { addrmanLabel } from '../../src/static/js/core/addrman.js';
import { renderPeerDetails } from '../../src/static/js/peers/detail.js';
import { create as createMapTooltip } from '../../src/static/js/map/tooltips.js';

test('Addrman labels express observation status and reject absent or invalid values', () => {
    assert.equal(addrmanLabel('present'), 'Yes');
    assert.equal(addrmanLabel('not_returned'), 'Not returned');
    for (const status of ['unavailable', undefined, null, '', true, false, 'absent', 'Present', {}, '<img src=x>']) {
        assert.equal(addrmanLabel(status), 'Unavailable');
    }
});

test('peer details and map tooltips share Addrman labels rather than inferring certainty from legacy booleans', () => {
    const element = { innerHTML: '', style: {}, classList: { remove() {} } };
    const tooltip = createMapTooltip({ element, networkLabels: { ipv4: 'IPv4' }, rgba: () => '#abcdef', getWidth: () => 1200 });
    for (const [addrman_status, label] of [['present', 'Yes'], ['not_returned', 'Not returned'], ['unavailable', 'Unavailable'], [undefined, 'Unavailable'], ['invalid', 'Unavailable']]) {
        for (const in_addrman of [true, false]) {
            const peer = { id: 1, network: 'ipv4', in_addrman, addrman_status };
            assert.ok(renderPeerDetails(peer).html.includes(`<span class="as-detail-sub-label">Addrman</span><span class="as-detail-sub-val">${label}</span>`));
            tooltip.showGroupHoverTooltip([{ peerId: 1, peer }], 100, 100);
            assert.ok(element.innerHTML.includes(`<span class="tt-label">Addrman</span><span class="tt-val">${label}</span>`));
            tooltip.showGroupHoverTooltip([{ peerId: 1, peer, isPrivate: true }], 100, 100);
            assert.ok(element.innerHTML.includes('<span class="tt-label">Addrman</span><span class="tt-val">—</span>'));
        }
    }
});
