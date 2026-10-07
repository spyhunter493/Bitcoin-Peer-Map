import assert from 'node:assert/strict';
import test from 'node:test';
import { create as createDashboard } from '../../src/static/js/core/dashboard-state.js';
import { create as createModel } from '../../src/static/js/distribution/model.js';
import { create as createPresentation } from '../../src/static/js/distribution/presentation.js';

function fixture() {
    const dashboard = createDashboard();
    const peers = [
        { id: 1, network: 'ipv4', is_public: true, direction: 'IN', as: 'AS1 A', countryCode: 'NZ', conntime: 100, ping_ms: 5 },
        { id: 2, network: 'ipv6', is_public: true, direction: 'OUT', as: 'AS1 A', countryCode: 'NZ', conntime: 200, ping_ms: 15 },
        { id: 3, network: 'ipv4', is_public: true, direction: 'OUT', as: 'AS2 B', countryCode: 'US', conntime: 300, ping_ms: 1 },
        { id: 4, network: 'ipv4', is_public: true, direction: 'OUT', as: '', countryCode: 'NZ', conntime: 400, ping_ms: null },
        { id: 5, network: 'ipv4', is_public: false, direction: 'OUT', as: 'AS99 Private', countryCode: 'GB', conntime: 500, ping_ms: 2 },
    ];
    const model = createModel({ dashboard, palette: ['#123456', '#abcdef'], maxSegments: 1,
        connectionTypeLabels: {}, nowSeconds: () => 1000 });
    model.update(peers);

    const calls = [];
    const record = (method) => (...args) => calls.push({ method, args });
    const geometry = {
        insightVisible: false,
        insightOrigin: { x: 10, y: 20 },
        center: { x: 1, y: 2 },
        dots: new Map([['AS1', { x: 3, y: 4 }], ['Others', { x: 5, y: 6 }]]),
    };
    const donut = {
        clearLegendHover() {},
        renderFilterCenter: record('filter'),
        renderNetworkCenter: record('network'),
        renderScoreCenter: record('score'),
        renderSelectedCenter: record('selected'),
        renderProviderCenter: record('provider'),
        renderLegendHoverCenter: record('hover'),
        showInsight: record('insight'),
        isInsightVisible: () => geometry.insightVisible,
        getInsightOrigin: () => geometry.insightOrigin,
        getDonutCenterPosition: () => geometry.center,
        getLegendDotPosition: id => geometry.dots.get(id) || null,
    };
    const coverage = { textContent: '' };
    const panelClasses = new Set();
    const classList = values => ({
        add: value => values.add(value),
        remove: value => values.delete(value),
        contains: value => values.has(value),
    });
    const panel = { classList: classList(panelClasses), offsetWidth: 10 };
    const document = { body: { classList: classList(new Set()) }, getElementById: id => id === 'as-coverage' ? coverage : null };
    let navigation;
    let legendsHidden = false;
    const presentation = createPresentation({
        dashboard, state: dashboard.distribution, model, donut,
        getElements: () => ({ container: null, title: null, lensToggle: null, panel }),
        areLegendsHidden: () => legendsHidden,
        getNavigation: () => {
            assert.ok(navigation, 'navigation must only be resolved after composition');
            return navigation;
        },
        getInteractions: () => {
            throw new Error('Center rendering must not request panel interaction handlers');
        },
        summaryView: {}, document,
    });
    return {
        dashboard, state: dashboard.distribution, model, presentation, geometry, coverage, calls, panelClasses,
        setNavigation: value => { navigation = value; },
        hideLegends: () => { legendsHidden = true; },
        get last() { return calls.at(-1); },
    };
}

test('provider and country centers show their own known public population and coverage', () => {
    const f = fixture();
    assert.equal(f.calls.length, 0, 'factory composition must not render or resolve lazy navigation');
    f.presentation.renderCenter();
    assert.equal(f.last.method, 'score');
    assert.equal(f.last.args[1], 3);
    assert.equal(f.last.args[2].countryLens, false);
    assert.match(f.last.args[2].tooltip, /known provider only/);
    assert.match(f.coverage.textContent, /Provider known for 3\/4 public peers/);

    f.state.setLens('country');
    f.presentation.renderCenter();
    assert.equal(f.last.method, 'score');
    assert.equal(f.last.args[1], 4);
    assert.equal(f.last.args[2].countryLens, true);
    assert.match(f.last.args[2].tooltip, /known country only/);
    assert.match(f.coverage.textContent, /Country known for 4\/4 public peers/);
    assert.doesNotMatch(f.coverage.textContent, /5\/5/);

    f.state.selectedProvider = 'country:NZ';
    f.presentation.renderCenter();
    assert.equal(f.last.method, 'selected');
    assert.equal(f.last.args[0].peerCount, 3);
    assert.equal(f.last.args[1].countryLens, true);
    assert.equal(f.last.args[1].entityKind, 'Country');
});

test('peer detail, focused hover and active insight take priority over summary filters', () => {
    const f = fixture();
    Object.assign(f.state, {
        peerDetailActive: true, donutFocused: true, summarySelected: true,
        focusedHoverProvider: 'AS1', insightActiveAsNum: 'AS2', insightActiveType: 'fastest',
        filterPeerIds: [1, 2], filterLabel: 'Software',
    });
    f.presentation.renderCenter();
    assert.equal(f.calls.length, 0, 'the peer detail retains ownership of the center');
    assert.match(f.coverage.textContent, /Provider known for 3\/4 public peers/, 'coverage still refreshes above the detail');

    f.state.peerDetailActive = false;
    f.presentation.renderCenter();
    assert.equal(f.last.method, 'provider');
    assert.equal(f.last.args[0].asNumber, 'AS1', 'focused hover wins over insight and filter');

    f.state.focusedHoverProvider = null;
    f.geometry.insightVisible = true;
    f.presentation.renderCenter();
    assert.equal(f.last.method, 'insight');
    assert.equal(f.last.args[0], 'fastest');
    assert.equal(f.last.args[1].asNumber, 'AS2');

    f.geometry.insightVisible = false;
    f.presentation.renderCenter();
    assert.equal(f.last.method, 'provider');
    assert.equal(f.last.args[0].asNumber, 'AS2', 'an insight without its rectangle retains its provider center');
    assert.equal(f.last.args[1].isSubProvider, true, 'Others members retain the Back control');

    f.state.insightActiveAsNum = null;
    f.presentation.renderCenter();
    assert.deepEqual(f.last, { method: 'filter', args: [2, 'Software', 5, 'connected peers'] });
});

test('summary previews resolve late navigation and category/network shares use all connected peers', () => {
    const f = fixture();
    Object.assign(f.state, { donutFocused: true, summarySelected: true, activeNetwork: 'ipv4',
        summaryPreviewPeerIds: [1, 3, 4, 5], summaryPreviewLabel: 'IPv4 preview' });
    f.setNavigation({ summaryPreviewSummaryCenterText: (...args) => f.calls.push({ method: 'preview', args }) });
    f.presentation.renderCenter();
    assert.deepEqual(f.last, { method: 'preview', args: [[1, 3, 4, 5], 'IPv4 preview'] });

    f.state.summaryPreviewPeerIds = null;
    f.state.summaryPreviewLabel = null;
    f.presentation.renderCenter();
    assert.deepEqual(f.last, { method: 'network', args: ['ipv4', 4, 5, 'connected peers'] });

    Object.assign(f.state, { summarySelected: false, filterPeerIds: [4, 5], filterLabel: 'Other peers' });
    f.presentation.renderCenter();
    assert.deepEqual(f.last, { method: 'filter', args: [2, 'Other peers', 5, 'connected peers'] });

    f.state.selectedProvider = 'AS2';
    f.presentation.renderCenter();
    assert.equal(f.last.method, 'selected', 'selection wins over network/category filters');
    assert.equal(f.last.args[0].asNumber, 'AS2');
});

test('hidden-legend hover and selected Others controls resolve the current navigation lazily', () => {
    const f = fixture();
    f.hideLegends();
    f.state.focusedHoverProvider = 'AS1';
    f.presentation.renderCenter();
    assert.equal(f.last.method, 'hover');
    assert.equal(f.last.args[1].rank, 1);

    f.state.selectedProvider = 'AS2';
    f.presentation.renderCenter();
    assert.equal(f.last.method, 'selected', 'selection suppresses the hidden-legend hover');
    assert.equal(f.last.args[1].isSubProvider, true);
    const onBack = f.last.args[1].onBack;
    let transitions = 0;
    f.setNavigation({ backToOthersList: () => { transitions++; } });
    onBack();
    f.setNavigation({ backToOthersList: () => { transitions += 10; } });
    onBack();
    assert.equal(transitions, 11, 'a rendered button does not capture an outdated transition object');
});

test('line origins prioritize insight, focused/hidden center, direct legend and active Others membership', () => {
    const f = fixture();
    assert.deepEqual(f.presentation.getLineOriginForAs('AS1'), { x: 3, y: 4 });
    assert.deepEqual(f.presentation.getLineOriginForAs('AS2'), { x: 5, y: 6 });
    assert.deepEqual(f.presentation.getLineOriginForAs('AS404'), { x: 1, y: 2 });
    f.state.donutFocused = true;
    assert.deepEqual(f.presentation.getLineOriginForAs('AS1'), { x: 1, y: 2 });
    f.geometry.insightVisible = true;
    assert.deepEqual(f.presentation.getLineOriginForAs('AS1'), { x: 10, y: 20 });
    f.geometry.insightOrigin = null;
    assert.deepEqual(f.presentation.getLineOriginForAs('AS1'), { x: 1, y: 2 });
    f.geometry.insightVisible = false;
    f.state.donutFocused = false;
    f.state.setLens('country');
    assert.deepEqual(f.presentation.getLineOriginForAs('country:US'), { x: 5, y: 6 });
    f.hideLegends();
    assert.deepEqual(f.presentation.getLineOriginForAs('AS1'), { x: 1, y: 2 });
});

test('dispose cancels every close timer for its own presentation instance', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const first = fixture(), second = fixture();
    first.presentation.showPanel();
    first.presentation.closePanel();
    t.mock.timers.tick(100);
    first.presentation.closePanel();
    second.presentation.showPanel();
    second.presentation.closePanel();
    first.presentation.dispose();
    t.mock.timers.tick(1000);
    assert.equal(first.panelClasses.has('hidden'), false, 'neither delayed callback may affect a disposed panel');
    assert.equal(second.panelClasses.has('hidden'), true, 'another instance keeps its scheduled transition');
});

test('delayed panel close preserves a panel reopened before the animation ends', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    f.presentation.showPanel();
    f.presentation.closePanel();
    t.mock.timers.tick(309);
    assert.equal(f.panelClasses.has('hidden'), false);
    f.presentation.showPanel();
    t.mock.timers.tick(1);
    assert.equal(f.panelClasses.has('visible'), true);
    assert.equal(f.panelClasses.has('hidden'), false);
    f.presentation.dispose();
});
