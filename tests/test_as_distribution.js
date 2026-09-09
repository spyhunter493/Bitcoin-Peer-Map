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

const source = fs.readFileSync('src/static/js/as-distribution.js', 'utf8');
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

loadScript(sandbox, 'src/static/js/as-distribution.js');
assert.strictEqual(typeof sandbox.window.ASDistribution.openPeerDetailPanel, 'function');

console.log('Distribution feature module tests passed');
