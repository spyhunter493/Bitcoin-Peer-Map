'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadScript(sandbox, path) {
    vm.runInNewContext(fs.readFileSync(path, 'utf8'), sandbox, { filename: path });
}

const sandbox = {
    window: {
        setTimeout,
        clearTimeout,
    },
};
loadScript(sandbox, 'src/static/js/core/modal.js');
    loadScript(sandbox, 'src/static/js/core/format.js');
loadScript(sandbox, 'src/static/js/features/service-flags.js');
loadScript(sandbox, 'src/static/js/features/distribution-state.js');
loadScript(sandbox, 'src/static/js/features/private-network-state.js');
loadScript(sandbox, 'src/static/js/core/dashboard-state.js');
loadScript(sandbox, 'src/static/js/features/peer-filters.js');
loadScript(sandbox, 'src/static/js/features/distribution-data.js');
loadScript(sandbox, 'src/static/js/features/distribution-peer-detail.js');
loadScript(sandbox, 'src/static/js/features/distribution-network-panel.js');
loadScript(sandbox, 'src/static/js/features/distribution-donut.js');
loadScript(sandbox, 'src/static/js/features/distribution-summary-panel.js');
loadScript(sandbox, 'src/static/js/features/distribution-country-panel.js');
loadScript(sandbox, 'src/static/js/features/distribution-provider-panel.js');

const providerPanel = sandbox.window.BPMDistributionProviderPanel;
const providerSegments = [{ asNumber: 'Others', peerIds: [7, 8], isOthers: true }];
const providerGroups = [{ asNumber: 'AS64500', peerIds: [7], percentage: 33,
    asName: 'Example Provider', riskLevel: 'low' }];
const nestedProvider = providerPanel.resolve('AS64500', providerSegments, providerGroups, () => '#58a6ff');
assert.strictEqual(nestedProvider.segment.asNumber, 'AS64500');
assert.strictEqual(nestedProvider.segment.color, '#58a6ff');
assert.strictEqual(nestedProvider.group, providerGroups[0]);
assert.strictEqual(providerPanel.resolve('Others', providerSegments, providerGroups, () => '').group, providerSegments[0]);
assert.strictEqual(providerPanel.resolve('missing', providerSegments, providerGroups, () => ''), null);
assert.deepStrictEqual(Array.from(providerPanel.peerIdsFor('AS64500', providerSegments, providerGroups)), [7]);
assert.deepStrictEqual(Array.from(providerPanel.peerIdsFor('Others', providerSegments, providerGroups)), [7, 8]);
assert.deepStrictEqual(Array.from(providerPanel.peerIdsFor('missing', providerSegments, providerGroups)), []);

function panelFixture() {
    const elements = {};
    for (const selector of ['.as-detail-asn', '.as-detail-org', '.as-detail-meta',
        '.as-detail-bar-fill', '.as-detail-pct', '.as-detail-risk', '.as-detail-body']) {
        elements[selector] = {
            textContent: '', innerHTML: '', style: {}, scrollTop: 0,
            classList: { add() {}, remove() {} },
        };
    }
    return { elements, querySelector: selector => elements[selector] };
}

const panelSummary = {
    view: {
        row: (label, value) => `<p>${label}: ${value}</p>`,
        interactiveRow: (label, value) => `<p>${label}: ${value}</p>`,
    },
    attachInteractiveRowHandlers() {},
    attachPanelBlankClickHandler() {},
};
const countryFixture = panelFixture();
assert.strictEqual(sandbox.window.BPMDistributionCountryPanel.render({
    panelEl: countryFixture,
    segment: { asNumber: 'NZ', percentage: 50, peerCount: 1, color: '#58a6ff', riskLevel: 'low' },
    group: { countryCode: 'NZ', countryName: 'New Zealand', avgDurationFmt: '1h',
        totalBytesSentFmt: '2 KB', totalBytesRecvFmt: '3 KB' },
    peers: [{ id: 7, direction: 'IN' }],
    providers: [{ asNumber: 'AS64500', name: 'Example Provider', peerCount: 1, peerIds: [7] }],
    summaryView: panelSummary.view,
    attachInteractiveRowHandlers() {}, attachPanelBlankClickHandler() {},
    connectionTypeLabels: {},
}), true);
assert.strictEqual(countryFixture.elements['.as-detail-asn'].textContent, 'NZ');
assert.ok(countryFixture.elements['.as-detail-body'].innerHTML.includes('Example Provider'));

const providerFixture = panelFixture();
assert.strictEqual(providerPanel.render({
    panelEl: providerFixture,
    segment: nestedProvider.segment,
    group: providerGroups[0],
    summaryView: panelSummary.view,
    attachInteractiveRowHandlers() {}, attachPanelBlankClickHandler() {},
    connectionTypeLabels: {},
}), true);
assert.strictEqual(providerFixture.elements['.as-detail-asn'].textContent, 'AS64500');
assert.ok(providerFixture.elements['.as-detail-body'].innerHTML.includes('Peers'));

const peerDetail = sandbox.window.BPMPeerDetail;
const escapeHtml = sandbox.window.BPMModal.escapeHtml;
const hostile = `<img src=x onerror="alert(1)"> & '`;
const escaped = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;';
const serviceFlags = sandbox.window.BPMServiceFlags;
assert.strictEqual(serviceFlags['BLAKE2B?'].abbr, 'BL');
assert.strictEqual(serviceFlags.BLAKE2B, serviceFlags['BLAKE2B?']);

assert.strictEqual(escapeHtml(hostile), escaped);
assert.strictEqual(escapeHtml(0), '0');
assert.strictEqual(escapeHtml(null), '');

const ordinaryRow = peerDetail.peerDetailRow('<label>', hostile);
assert.ok(ordinaryRow.includes('&lt;label&gt;'));
assert.ok(ordinaryRow.includes(escaped));
assert.ok(!ordinaryRow.includes('<img'));

const trustedRow = peerDetail.peerDetailRow(
    'Session ID',
    `<span>${escapeHtml(hostile)}</span>`,
    true
);
assert.ok(trustedRow.includes('<span>'));
assert.ok(!trustedRow.includes('<img'));

const serviceList = peerDetail.renderServiceFlagList('N W NL', serviceFlags);
assert.ok(serviceList.includes('class="service-flag-list"'));
assert.ok(serviceList.includes('NODE_NETWORK'));
assert.ok(serviceList.includes('Segregated Witness'));
assert.ok(!serviceList.includes('<br>'));
const forkServiceList = peerDetail.renderServiceFlagList('BL', serviceFlags);
assert.ok(forkServiceList.includes('BLAKE2b fork support'));
assert.ok(forkServiceList.includes('NODE_BLAKE2B'));
assert.ok(!forkServiceList.includes('Unknown service flag'));

const rendered = peerDetail.renderPeerDetails({
    id: 7,
    addr: hostile,
    as: 'AS64500 ' + hostile,
    asname: hostile,
    network: 'ipv4',
    direction: 'IN',
    subver: hostile,
    services_abbrev: 'N W',
    session_id: hostile,
}, {
    providerColor: '#58a6ff',
    serviceFlags,
    connectionTypeLabels: {},
    nowSeconds: 1000,
});
assert.ok(rendered.html.includes(escaped));
assert.ok(!rendered.html.includes('<img'));
assert.ok(rendered.html.includes('type="button"'));
assert.strictEqual(rendered.presentation.asNumber, 'AS64500');

const renderedGroup = peerDetail.renderPeerGroup([{
    id: 7,
    addr: hostile,
    city: hostile,
    country: 'NZ',
    network: 'ipv4',
}]);
assert.ok(renderedGroup.includes('id="peer-popup-title"'));
assert.ok(renderedGroup.includes('class="as-detail-sub-row multi-peer-row"'));
assert.ok(renderedGroup.includes(escaped));
assert.ok(!renderedGroup.includes('<img'));

const peerDetailSource = fs.readFileSync(
    'src/static/js/features/distribution-peer-detail.js',
    'utf8'
);
assert.ok(!peerDetailSource.includes('fetch('));

const source = fs.readFileSync('src/static/js/distribution.js', 'utf8');
assert.ok(!source.includes("fetch('/api/peer/disconnect'"));
assert.ok(!source.includes("fetch('/api/peer/ban'"));
assert.ok(!source.includes('function describeArc'));
assert.ok(!source.includes("querySelector('.as-score-"));

const summaryState = sandbox.window.BPMDistributionState.create();
assert.strictEqual(summaryState.donutFocused, false);
assert.strictEqual(summaryState.peerDetailActive, false);
assert.strictEqual(summaryState.selectedPeerId, null);
assert.strictEqual(summaryState.insightActiveType, null);
summaryState.donutFocused = true;
summaryState.insightActiveAsNum = 'AS64500';
summaryState.insightActiveType = 'fastest';
assert.strictEqual(summaryState.snapshot().insightActiveAsNum, 'AS64500');
assert.strictEqual(sandbox.window.BPMDistributionState.create().insightActiveAsNum, null);

const summary = { view: sandbox.window.BPMDistributionSummaryPanel.create({
    elements: { panel: null }, actions: {}, serviceFlags, connectionTypeLabels: {},
}) };

const summaryRow = summary.view.summaryInteractiveRow(hostile, '2p / 1prov', {
    peerIds: [7, 8],
    providers: [{ asNumber: 'AS64500', name: hostile, color: '#58a6ff', peerCount: 2, peerIds: [7, 8] }],
});
assert.ok(summaryRow.includes('role="button" tabindex="0"'));
assert.ok(summaryRow.includes('data-cat-label="' + escaped + '"'));
assert.ok(summaryRow.includes('data-peer-ids="[7,8]"'));
assert.ok(!summaryRow.includes('<img'));

// Every drill-down renderer receives raw labels, including strings decoded from data attributes.
const unsafePeer = { id: 7, connection_type: hostile, city: '<b>Town</b>', country: '<b>C</b>',
    as: 'AS64500', ping_ms: 20, bytessent: 1234, bytesrecv: 4567 };
const unsafeProvider = { asNumber: 'AS64500', name: hostile, peerIds: [7], peerCount: 1, color: '#58a6ff' };
for (const html of [
    summary.view.row(hostile, hostile),
    summary.view.interactiveRow(hostile, hostile, [7], 'software'),
    summary.view.buildProviderListHtml([unsafeProvider], hostile, 'AS64500'),
    summary.view.buildPeerSummaryHtml([unsafePeer], 'conntype', hostile),
    summary.view.buildPeerListHtmlForSubSub([unsafePeer]),
    summary.view.buildPingPeerListHtml([unsafePeer]),
    summary.view.buildDataPeerListHtml([unsafePeer], 'bytessent'),
]) {
    assert.ok(!html.includes('<img'), 'peer markup must be escaped in every drill-down');
    assert.ok(!html.includes('<b>'), 'short location markup must also remain text');
    assert.ok(html.includes('&lt;'), 'the label should remain visible as literal text');
}

loadScript(sandbox, 'src/static/js/distribution.js');
assert.strictEqual(typeof sandbox.window.BPMDistribution.openPeerDetailPanel, 'function');

console.log('Distribution feature module tests passed');

// Filter meaning survives snapshot replacement; no matches remain an empty set.
const peerFilters = sandbox.window.BPMPeerFilters;
const filterPeers = [
    { id: 0, as: 'AS1 First', network: 'ipv4', direction: 'IN', countryCode: 'NZ', subver: 'Core', services_abbrev: 'N', ping_ms: 10 },
    { id: 2, as: 'AS2 Second', network: 'ipv6', direction: 'OUT', countryCode: 'US', subver: 'Other', services_abbrev: 'W', ping_ms: 0 },
];
const filteredIds = (peers, descriptor, groups) => Array.from(peerFilters.resolve(peers, descriptor, groups), peer => peer.id);
const inbound = peerFilters.forCategory('conn-in', 'AS1');
assert.deepStrictEqual(filteredIds(filterPeers, inbound), [0]);
assert.deepStrictEqual(filteredIds([{ ...filterPeers[0], id: 3 }, filterPeers[1]], inbound), [3]);
assert.deepStrictEqual(filteredIds([filterPeers[1]], inbound), []);
assert.deepStrictEqual(filteredIds(filterPeers, { kind: 'all', filters: [{ kind: 'network', key: 'ipv4' }, { kind: 'software', key: 'Other' }] }), []);
assert.deepStrictEqual(filteredIds(filterPeers, peerFilters.forCategory('conn-out', 'Others'), { provider: ['AS1'] }), [2]);
assert.deepStrictEqual(filteredIds(filterPeers, peerFilters.forCategory('insight-fastest', 'fastest')), [0]);
const dashboardState = sandbox.window.BPMDashboardState.create();
dashboardState.replace(filterPeers);
assert.strictEqual(dashboardState.byId.get(0), filterPeers[0]);
dashboardState.distribution.hoveredPeerId = 0;
dashboardState.replace([filterPeers[1]]);
assert.strictEqual(dashboardState.byId.has(0), false);
assert.strictEqual(dashboardState.distribution.hoveredPeerId, null);
