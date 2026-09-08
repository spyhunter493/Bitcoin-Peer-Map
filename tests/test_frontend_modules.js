'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadScript(sandbox, path) {
    vm.runInNewContext(fs.readFileSync(path, 'utf8'), sandbox, { filename: path });
}

(async () => {
    const requests = [];
    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        window: {
            AbortController,
            setTimeout,
            confirm: () => true,
            fetch: async (url, options) => {
                requests.push({ url, options });
                if (url === '/failure') {
                    return {
                        ok: false,
                        status: 503,
                        json: async () => ({ detail: 'temporarily unavailable' }),
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ success: true }),
                };
            },
        },
    };

    loadScript(sandbox, 'src/static/js/core/api.js');
    loadScript(sandbox, 'src/static/js/core/modal.js');
    loadScript(sandbox, 'src/static/js/features/node-monitor.js');
    loadScript(sandbox, 'src/static/js/features/peer-actions.js');
    loadScript(sandbox, 'src/static/js/features/display-settings.js');
    loadScript(sandbox, 'src/static/js/features/world-map.js');
    loadScript(sandbox, 'src/static/js/features/distribution-data.js');
    loadScript(sandbox, 'src/static/js/features/distribution-peer-detail.js');

    assert.strictEqual(typeof sandbox.window.BPMDisplaySettings.create, 'function');

    const hostile = `<img src=x onerror="alert(1)"> & '`;
    const escaped = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;';
    assert.strictEqual(sandbox.window.BPMModal.escapeHtml(hostile), escaped);

    const row = sandbox.window.BPMModal.row(hostile, hostile, hostile, hostile, 'ok" onclick="bad');
    assert.ok(row.includes(escaped));
    assert.ok(!row.includes('<img'));
    assert.ok(!row.includes('onclick='));

    const chainTips = sandbox.window.BPMNodeMonitor.renderChainTips({
        success: true,
        summary: {
            chain: 'main',
            best_height: 1,
            best_hash: hostile,
            total: 1,
            active_count: 1,
            non_active_count: 0,
            fork_count: 0,
        },
        tips: [{
            status: 'active',
            status_label: hostile,
            height: 1,
            branch_length: 0,
            hash: hostile,
            age_seconds: 1,
        }],
    });
    assert.ok(chainTips.includes(escaped));
    assert.ok(!chainTips.includes('<img'));

    await sandbox.window.BPMApi.postJson('/success', { peer_id: 7 });
    assert.strictEqual(requests[0].options.method, 'POST');
    assert.strictEqual(requests[0].options.headers['Content-Type'], 'application/json');
    assert.strictEqual(requests[0].options.body, '{"peer_id":7}');

    await assert.rejects(
        sandbox.window.BPMApi.getJson('/failure'),
        error => (
            error.name === 'HttpError' &&
            error.status === 503 &&
            error.message === 'temporarily unavailable'
        )
    );

    const map = sandbox.window.BPMWorldMap;
    const origin = map.project(0, 0);
    assert.ok(Math.abs(origin.x - 0.5) < 1e-12);
    assert.ok(Math.abs(origin.y - 0.5) < 1e-12);
    const view = { x: 17, y: -9, zoom: 2.5 };
    const screenPoint = map.worldToScreen(174.7633, -36.8485, 1200, 700, view);
    const roundTrip = map.screenToWorld(screenPoint.x, screenPoint.y, 1200, 700, view);
    assert.ok(Math.abs(roundTrip.lon - 174.7633) < 1e-9);
    assert.ok(Math.abs(roundTrip.lat - (-36.8485)) < 1e-9);

    const locatePrivatePeer = map.createAntarcticaLocator();
    const firstPosition = locatePrivatePeer('example.onion:8333');
    assert.strictEqual(locatePrivatePeer('example.onion:8333'), firstPosition);
    assert.ok(firstPosition.lat < -65 && firstPosition.lat > -72);

    let geometryFetches = 0;
    let loadedStates = null;
    const loader = map.createDataLoader({
        fetchJson: async filename => {
            geometryFetches += 1;
            return [{ filename }];
        },
        callbacks: { states: data => { loadedStates = data; } },
        logger: { log() {}, warn() {}, error() {} },
    });
    const stateRequest = loader.loadStates();
    assert.strictEqual(loader.loadStates(), stateRequest);
    await stateRequest;
    assert.strictEqual(geometryFetches, 1);
    assert.strictEqual(loadedStates[0].filename, 'states-50m.json');

    let fallbackWorld = null;
    const failingLoader = map.createDataLoader({
        fetchJson: async () => { throw new Error('offline'); },
        callbacks: { world: data => { fallbackWorld = data; } },
        logger: { log() {}, warn() {}, error() {} },
    });
    await failingLoader.loadWorld();
    assert.ok(Array.isArray(fallbackWorld) && fallbackWorld.length > 0);

    const distribution = sandbox.window.BPMDistributionData;
    const peers = [
        { id: 1, as: 'AS64500 Alpha Net', asname: 'Alpha', countryCode: 'NZ', country: 'New Zealand', direction: 'IN', connection_type: 'inbound', network: 'ipv4', subver: '/Satoshi:27.0/', services_abbrev: 'N W', ping_ms: 20, conntime: 900, bytessent: 1024, bytesrecv: 2048 },
        { id: 2, as: 'AS64500 Alpha Net', asname: 'Alpha', countryCode: 'NZ', country: 'New Zealand', direction: 'OUT', connection_type: 'outbound-full-relay', network: 'ipv6', subver: '/Satoshi:27.0/', services_abbrev: 'N', ping_ms: 40, conntime: 800, hosting: true },
        { id: 3, as: 'AS64501 Beta Net', asname: 'Beta', countryCode: 'AU', country: 'Australia', direction: 'OUT', connection_type: 'block-relay-only', network: 'onion', subver: '/Satoshi:26.0/', services_abbrev: 'N W', ping_ms: 60, conntime: 700, bytessent: 4096, bytesrecv: 1024, hosting: true },
        { id: 4, as: '', countryCode: '', direction: 'IN', connection_type: 'inbound' },
    ];
    const providers = distribution.aggregateProviders(peers, 1000);
    assert.strictEqual(providers.total, 3);
    assert.strictEqual(providers.groups.length, 2);
    assert.strictEqual(providers.groups[0].asNumber, 'AS64500');
    assert.strictEqual(providers.groups[0].peerCount, 2);
    assert.strictEqual(providers.groups[0].avgDurationSecs, 150);
    assert.strictEqual(distribution.distributionScore(providers.groups, providers.total), 4.4);
    const segments = distribution.buildDonutSegments(providers.groups, providers.total, {
        maxSegments: 1,
        palette: ['#111111', '#222222'],
        othersNoun: 'providers',
    });
    assert.strictEqual(segments.length, 2);
    assert.strictEqual(segments[1].isOthers, true);
    assert.strictEqual(segments[1].peerCount, 1);
    assert.strictEqual(distribution.fmtBytes(1024), '1.0 KB');
    assert.strictEqual(distribution.fmtDuration(3660), '1h 1m');

    const summary = distribution.computeSummaryData({
        score: distribution.distributionScore(providers.groups, providers.total),
        groups: providers.groups,
        segments,
        peers,
        connectionTypeLabels: {
            inbound: 'Inbound',
            'outbound-full-relay': 'Outbound full relay',
            'block-relay-only': 'Block relay only',
        },
        nowSeconds: 1000,
    });
    assert.strictEqual(summary.uniqueProviders, 2);
    assert.strictEqual(summary.topProvider.asNumber, 'AS64500');
    assert.deepStrictEqual(
        Array.from(summary.networks, item => [item.key, item.peerCount]),
        [['ipv4', 1], ['ipv6', 1], ['onion', 1]]
    );
    assert.strictEqual(summary.hosting[0].key, 'cloud');
    assert.strictEqual(summary.hosting[0].peerCount, 2);
    assert.strictEqual(summary.hosting[0].providerCount, 2);
    assert.strictEqual(summary.countries[0].key, 'NZ');
    assert.strictEqual(summary.software[0].peerCount, 2);
    assert.strictEqual(summary.services[0].peerCount, 2);
    assert.deepStrictEqual(
        Array.from(summary.connectionGrid, item => [item.asNumber, item.inCount, item.outCount]),
        [['AS64500', 1, 1], ['Others', 0, 1]]
    );
    assert.strictEqual(summary.connectionGrid[0].outSubtypes[0].label, 'Outbound full relay');
    assert.strictEqual(summary.insights[0].type, 'stable');
    assert.strictEqual(summary.insights[0].asNumber, 'AS64501');
    assert.strictEqual(summary.insights[1].type, 'fastest');
    assert.strictEqual(summary.insights[1].topProviders[0].asNumber, 'AS64500');
    assert.strictEqual(summary.insights[2].topProviders[0].asNumber, 'AS64501');
    assert.strictEqual(summary.insights[3].topProviders[0].asNumber, 'AS64500');

    const countries = distribution.aggregateCountries(peers, 1000);
    const countrySummary = distribution.computeCountrySummaryData(
        countries.groups,
        countries.total,
        distribution.distributionScore(countries.groups, countries.total)
    );
    assert.strictEqual(countrySummary.uniqueCountries, 2);
    assert.strictEqual(countrySummary.totalPeers, 3);
    assert.strictEqual(countrySummary.topCountry.countryCode, 'NZ');

    console.log('Frontend module tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
