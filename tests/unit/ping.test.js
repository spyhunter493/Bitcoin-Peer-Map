import assert from 'node:assert/strict';
import test from 'node:test';
import { averagePing, comparePing, fmtPing, isMeasuredPing } from '../../src/static/js/core/ping.js';
import { sortPeers } from '../../src/static/js/peers/table-model.js';
import { aggregateProviders, aggregateCountries, computeInsights } from '../../src/static/js/distribution/data.js';
import { renderPeerDetails } from '../../src/static/js/peers/detail.js';
import { create as createMapTooltip } from '../../src/static/js/map/tooltips.js';
import { render as renderProvider } from '../../src/static/js/distribution/provider-panel.js';
import { render as renderCountry } from '../../src/static/js/distribution/country-panel.js';
import { computeNetworkPanelData, renderNetworkPanelBody } from '../../src/static/js/distribution/network-panel.js';
import { escapeHtml, row } from '../../src/static/js/core/modal.js';

test('ping distinguishes missing values, measured zero, and fractions in displays and averages', () => {
    for (const value of [null, undefined, -1, NaN, Infinity, '0']) {
        assert.equal(isMeasuredPing(value), false);
        assert.equal(fmtPing(value), '—');
    }
    assert.equal(fmtPing(0), '0ms');
    assert.equal(fmtPing(0.4), '0.4ms');
    assert.equal(fmtPing(0.004), '<0.1ms');
    assert.equal(fmtPing(12.26), '12.3ms');
    assert.equal(averagePing([null, undefined]), null);
    assert.equal(averagePing([null, 0]), 0);
    assert.equal(averagePing([null, 0, 0.4]), 0.2);
    for (const [ping_ms, expected] of [[null, '—'], [0, '0ms'], [0.4, '0.4ms']]) {
        assert.match(renderPeerDetails({ id: 1, network: 'ipv4', ping_ms }).html, new RegExp(expected));
    }
});

test('map tooltips and provider, Others, country, and network panels retain unknown and fractional pings', () => {
    const element = { innerHTML: '', style: {}, classList: { remove() {} } };
    const tooltip = createMapTooltip({ element, networkLabels: { ipv4: 'IPv4' }, rgba: () => '#abcdef', getWidth: () => 1200 });
    for (const [ping_ms, expected] of [[null, '—'], [0, '0ms'], [0.4, '0.4ms'], [0.004, '<0.1ms'], [12000, '12000ms']]) {
        tooltip.showGroupHoverTooltip([{ peerId: 1, peer: { id: 1, network: 'ipv4', ping_ms } }], 100, 100);
        assert.ok(element.innerHTML.includes(`<span class="tt-label">Ping</span><span class="tt-val">${escapeHtml(expected)}</span>`));
        const peers = [null, ping_ms].map((value, id) => ({ id, as: 'AS1 Provider', countryCode: 'NZ', country: 'New Zealand', network: 'ipv4', is_public: true, direction: 'OUT', ping_ms: value }));
        const group = aggregateProviders(peers).groups[0];
        for (const others of [false, true]) {
            const body = { innerHTML: '', scrollTop: 0 };
            const segment = { ...group, isOthers: others, _othersGroups: others ? [group] : undefined };
            renderProvider({ panelEl: { querySelector: selector => selector === '.as-detail-body' ? body : null },
                segment, group: others ? segment : group, summaryView: { row, interactiveRow: () => '' },
                connectionTypeLabels: {}, attachInteractiveRowHandlers() {}, attachPanelBlankClickHandler() {},
            });
            assert.ok(body.innerHTML.includes(row('Avg Ping', expected)));
        }
        const country = aggregateCountries(peers).groups[0], countryBody = { innerHTML: '' };
        renderCountry({ panelEl: { querySelector: selector => selector === '.as-detail-body' ? countryBody : null },
            segment: country, group: country, peers, providers: [], summaryView: { row, interactiveRow: () => '' },
            connectionTypeLabels: {}, attachInteractiveRowHandlers() {}, attachPanelBlankClickHandler() {},
        });
        assert.ok(countryBody.innerHTML.includes(row('Avg Ping', expected)));
        assert.ok(renderNetworkPanelBody(computeNetworkPanelData(peers, 'ipv4', [])).includes(escapeHtml(expected)));
    }
});

test('unknown pings sort last in both directions and never precede very slow measured peers', () => {
    const peers = [null, 12000, 0.4, undefined, 0].map((ping_ms, id) => ({ id, ping_ms }));
    const column = { key: 'ping_ms', get: peer => peer.ping_ms };
    assert.deepEqual(sortPeers(peers, column, true).map(peer => peer.id), [4, 2, 1, 0, 3]);
    assert.deepEqual(sortPeers(peers, column, false).map(peer => peer.id), [1, 2, 4, 0, 3]);
    assert.equal(comparePing(null, null), 0);
    const known = { id: 1, is_public: true, as: 'AS1 A', direction: 'OUT', ping_ms: 12000 };
    const unknown = { ...known, id: 2, ping_ms: null };
    const zero = { ...known, id: 3, as: 'AS2 B', ping_ms: 0 };
    const allUnknown = { ...unknown, id: 4, as: 'AS3 C' };
    const peersForGroups = [known, unknown, zero, allUnknown];
    const { groups } = aggregateProviders(peersForGroups);
    assert.equal(groups.find(group => group.asNumber === 'AS1').avgPingMs, 12000);
    assert.equal(groups.find(group => group.asNumber === 'AS2').avgPingMs, 0);
    assert.equal(groups.find(group => group.asNumber === 'AS3').avgPingMs, null);
    const fastest = computeInsights(groups, peersForGroups, []).find(insight => insight.type === 'fastest');
    assert.deepEqual(fastest.topProviders.map(provider => provider.asNumber), ['AS2', 'AS1']);
    assert.deepEqual(fastest.topProviders[1].peers.map(peer => peer.id), [1, 2]);
});
