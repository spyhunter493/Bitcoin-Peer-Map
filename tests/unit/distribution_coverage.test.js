import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateProviders, aggregateCountries, aggregateSummarySoftware, aggregateSummaryHosting, aggregateSummaryCountries,
    computeInsights, distributionCoverage, distributionScore, coverageLabel } from '../../src/static/js/distribution/data.js';
import { create as createNavigationView } from '../../src/static/js/distribution/navigation-view.js';
import { create as createDonut } from '../../src/static/js/distribution/donut.js';
import { resolve as resolvePeers, forCategory } from '../../src/static/js/peers/filters.js';

const peers = [
    { id: 1, network: 'ipv4', is_public: true, direction: 'IN', as: 'AS1 A', countryCode: 'NZ', subver: 'A', geo: { freshness: 'stale' } },
    { id: 2, network: 'ipv6', is_public: true, direction: 'IN', as: '', countryCode: 'NZ', subver: 'A' },
    { id: 3, network: 'ipv4', is_public: true, direction: 'OUT', as: '', countryCode: '', subver: 'B' },
    { id: 4, network: 'ipv4', is_public: false, direction: 'OUT', as: 'AS99 Private', countryCode: 'GB', subver: 'B' },
];

test('coverage excludes nonpublic peers and distinguishes direction and country knowledge', () => {
    const provider = distributionCoverage(peers);
    assert.deepEqual(provider, { lens: 'provider', eligible: 3, known: 1, unknown: 2,
        inbound: { eligible: 2, known: 1, unknown: 1 }, outbound: { eligible: 1, known: 0, unknown: 1 } });
    assert.match(coverageLabel(provider), /Provider known for 1\/3 public peers/);
    assert.match(coverageLabel(provider), /Inbound 1\/2.*Outbound 0\/1.*Inbound \+ outbound/);
    assert.equal(distributionCoverage(peers, 'country').known, 2, 'country knowledge does not require AS information');
    const providers = aggregateProviders(peers, 1000), countries = aggregateCountries(peers, 1000);
    assert.equal(providers.groups.length, 1);
    assert.equal(providers.groups[0].percentage, 100, 'identified-sample shares stay unchanged');
    assert.equal(distributionScore(providers.groups, providers.total), 0);
    assert.equal(countries.total, 2);
    assert.equal(countries.groups[0].countryCode, 'NZ');
});

test('category totals include unidentified peers, with coverage tied to that category', () => {
    const software = aggregateSummarySoftware(peers, []);
    const category = software.find(group => group.label === 'A');
    assert.equal(category.peerCount, 2);
    assert.deepEqual(category.peerIds, [1, 2]);
    assert.equal(category.coverage.known, 1);
    assert.equal(category.coverage.eligible, 2);
    assert.equal(category.providers[0].peerCount, 1);
    const unknown = aggregateSummaryHosting(peers, []).find(group => group.key === 'unknown');
    assert.deepEqual(unknown.peerIds, [2, 3, 4], 'missing AS information is not presented as residential');
});

test('empty, unidentified, and fully identified coverage have explicit denominators', () => {
    for (const [scope, eligible, known] of [[[], 0, 0], [peers.slice(1, 3), 2, 0], [[peers[0]], 1, 1]]) {
        const coverage = distributionCoverage(scope);
        assert.equal(coverage.eligible, eligible);
        assert.equal(coverage.known, known);
        assert.equal(coverage.unknown, eligible - known);
    }
});

test('country category summaries and byte insights use the same public population as coverage', () => {
    const sample = peers.map(peer => ({ ...peer, conntime: 0, ping_ms: null,
        bytessent: peer.id === 4 ? 1000000 : peer.id === 1 ? 100 : 0,
        bytesrecv: peer.id === 4 ? 1000000 : peer.id === 1 ? 200 : 0 }));
    const countries = aggregateSummaryCountries(sample, []);
    assert.deepEqual(countries.map(country => country.key), ['NZ']);
    assert.deepEqual(countries[0].peerIds, [1, 2], 'country totals include a public peer lacking AS information');
    const { groups } = aggregateProviders(sample, 1000);
    const insights = computeInsights(groups, sample, [], 1000).filter(insight => insight.type === 'data-providers');
    assert.equal(insights.length, 2);
    for (const insight of insights) {
        assert.deepEqual(insight.topProviders.map(provider => provider.asNumber), ['AS1']);
        assert.deepEqual(insight.topProviders[0].peers.map(peer => peer.id), [1]);
        assert.equal(insight.topProviders[0].totalBytes, insight.field === 'bytessent' ? 100 : 200);
    }
});

test('category previews use all connected peers when unidentified and private peers are included', () => {
    const state = { donutFocused: true };
    const parts = Object.fromEntries(['distribution', 'heading', 'value', 'quality', 'label']
        .map(name => ['.as-score-' + name, { style: {}, textContent: '' }]));
    const donut = createDonut({ state });
    donut.init({ center: { querySelector: selector => parts[selector] || null } });
    const navigationView = createNavigationView({ state,
        getDashboard: () => ({ peers }),
        getDonut: () => donut,
    }, () => ({}));
    navigationView.summaryPreviewSummaryCenterText([2, 3, 4], 'Unknown');
    assert.equal(parts['.as-score-quality'].textContent, '75.0% of connected peers', 'category share is not 300% of the one-provider sample');
    assert.equal(parts['.as-score-heading'].textContent, '3 PEERS');
    assert.deepEqual(state.summaryPreviewPeerIds, [2, 3, 4]);
    state.donutFocused = false;
    navigationView.summaryPreviewSummaryCenterText([1], 'A');
    assert.equal(parts['.as-score-quality'].textContent, '75.0% of connected peers');
});

test('provider and country descriptors preserve the public grouping scope across refreshes', () => {
    const initial = [
        { ...peers[0], countryCode: ' NZ ' },
        peers[1],
        { ...peers[3], as: 'AS1 Private', countryCode: 'NZ' },
    ];
    const provider = forCategory('provider', 'AS1 A');
    const country = forCategory('country', 'NZ New Zealand');
    assert.deepEqual(resolvePeers(initial, provider).map(peer => peer.id), [1]);
    assert.deepEqual(resolvePeers(initial, country).map(peer => peer.id), [1, 2], 'country filters normalize the same codes as groups');
    const refreshed = [...initial, { ...peers[0], id: 5 }];
    assert.deepEqual(resolvePeers(refreshed, provider).map(peer => peer.id), [1, 5]);
    assert.deepEqual(resolvePeers(refreshed, country).map(peer => peer.id), [1, 2, 5]);
    assert.deepEqual(resolvePeers(refreshed, { kind: 'provider', key: '*' }).map(peer => peer.id), [1, 5]);
    assert.deepEqual(resolvePeers([...refreshed, peers[3]], { kind: 'others', key: 'provider' }, { provider: ['AS1'] }), [],
        'the Others descriptor excludes providers outside the public population');
});
