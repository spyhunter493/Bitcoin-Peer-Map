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
loadScript(sandbox, 'src/static/js/features/distribution-data.js');
loadScript(sandbox, 'src/static/js/features/distribution-peer-detail.js');
loadScript(sandbox, 'src/static/js/features/distribution-network-panel.js');

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
loadScript(sandbox, 'src/static/js/as-distribution.js');
assert.strictEqual(typeof sandbox.window.ASDistribution.openPeerDetailPanel, 'function');

console.log('Distribution peer-detail module tests passed');
