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
loadScript(sandbox, 'src/static/js/features/distribution-state.js');
loadScript(sandbox, 'src/static/js/features/distribution-data.js');
loadScript(sandbox, 'src/static/js/features/distribution-peer-detail.js');
loadScript(sandbox, 'src/static/js/features/distribution-network-panel.js');
loadScript(sandbox, 'src/static/js/features/distribution-donut.js');
loadScript(sandbox, 'src/static/js/features/distribution-summary-panel.js');
loadScript(sandbox, 'src/static/js/features/distribution-tooltips.js');
loadScript(sandbox, 'src/static/js/features/distribution-summary-insights.js');
loadScript(sandbox, 'src/static/js/features/distribution-summary.js');
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
    summaryController: panelSummary,
    connectionTypeLabels: {},
}), true);
assert.strictEqual(countryFixture.elements['.as-detail-asn'].textContent, 'NZ');
assert.ok(countryFixture.elements['.as-detail-body'].innerHTML.includes('Example Provider'));

const providerFixture = panelFixture();
assert.strictEqual(providerPanel.render({
    panelEl: providerFixture,
    segment: nestedProvider.segment,
    group: providerGroups[0],
    summaryController: panelSummary,
    connectionTypeLabels: {},
}), true);
assert.strictEqual(providerFixture.elements['.as-detail-asn'].textContent, 'AS64500');
assert.ok(providerFixture.elements['.as-detail-body'].innerHTML.includes('Peers'));

const peerDetail = sandbox.window.BPMDistributionPeerDetail;
const escapeHtml = sandbox.window.BPMModal.escapeHtml;
const hostile = `<img src=x onerror="alert(1)"> & '`;
const escaped = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;';
const serviceFlags = {
    NETWORK: { abbr: 'N', label: 'Full chain history', rpc: 'NODE_NETWORK' },
    WITNESS: { abbr: 'W', label: 'Segregated Witness', rpc: 'NODE_WITNESS' },
    NETWORK_LIMITED: {
        abbr: 'NL',
        label: 'Limited chain history',
        rpc: 'NODE_NETWORK_LIMITED',
    },
};

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

// Controllers are created before init/setHooks/update: they must read current data and hooks.
let currentSegments = [];
let drawLines = null;
const filtered = [];
const centerPreviews = [];
const summary = sandbox.window.BPMDistributionSummary.create({
    state: summaryState,
    data: { get segments() { return currentSegments; } },
    elements: { panel: null },
    hooks: {
        filterPeerTable: ids => filtered.push(Array.from(ids)),
        get drawLinesForAllAs() { return drawLines; },
    },
    actions: { getActiveTotalPeers: () => 3 },
    donut: { renderFilterCenter: (...args) => centerPreviews.push(args) },
    serviceFlags,
    connectionTypeLabels: {},
});
summary.previewSummaryLines([7]);
currentSegments = [
    { asNumber: 'AS64500', peerIds: [7, 8], color: '#58a6ff' },
    { asNumber: 'AS64501', peerIds: [9], color: '#3fb950' },
];
let drawn;
drawLines = groups => { drawn = JSON.parse(JSON.stringify(groups)); };
summary.previewSummaryLines([8, 9]);
assert.deepStrictEqual(filtered, [[7], [8, 9]]);
assert.deepStrictEqual(drawn, [
    { asNum: 'AS64500', peerIds: [8], color: '#58a6ff' },
    { asNum: 'AS64501', peerIds: [9], color: '#3fb950' },
]);
summary.previewSummaryCenterText([8, 9], 'IPv4');
assert.strictEqual(summaryState.summaryPreviewLabel, 'IPv4');
assert.deepStrictEqual(centerPreviews, [[2, 'IPv4', 3]]);

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

for (const direction of ['IN', 'OUT']) {
    const state = sandbox.window.BPMDistributionState.create({
        summarySelected: true, subTooltipPinned: true,
        filterCategory: direction === 'IN' ? 'conn-in' : 'conn-out',
        filterLabel: 'AS64500', filterPeerIds: [7],
    });
    const current = { groups: [{ asNumber: 'AS64500', peers: [
        { id: 7, direction }, { id: 8, direction: direction === 'IN' ? 'OUT' : 'IN' },
    ] }] };
    let visible, lines;
    const controller = sandbox.window.BPMDistributionSummary.create({
        state, data: current, elements: { panel: null },
        actions: { isCountryLens: () => false, getColorForAsNum: () => '#58a6ff' },
        hooks: {
            filterPeerTable: ids => { visible = Array.from(ids); },
            drawLinesForAs: (_as, ids) => { lines = Array.from(ids); },
        },
    });
    controller.refresh();
    assert.deepStrictEqual(visible, [7]);
    assert.deepStrictEqual(lines, [7]);
    current.groups[0].peers = [{ id: 9, direction }];
    controller.refresh();
    assert.deepStrictEqual(Array.from(state.filterPeerIds), [9]);
    assert.deepStrictEqual(visible, [9]);
    current.groups = [];
    controller.refresh();
    assert.deepStrictEqual(visible, []);
    assert.deepStrictEqual(lines, []);
}

console.log('Distribution feature module tests passed');
