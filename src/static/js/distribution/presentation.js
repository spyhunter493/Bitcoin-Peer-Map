import { query, queryAll, required } from '../core/dom.js';
import { connectionLabels } from '../core/format.js';
import * as distributionData from './data.js';
import * as countryPanel from './country-panel.js';
import * as providerPanel from './provider-panel.js';

/**
 * @typedef {object} DistributionElements
 * @property {HTMLElement | null} container
 * @property {HTMLElement | null} title
 * @property {HTMLElement | null} lensToggle
 * @property {HTMLElement | null} panel
 */

/**
 * @typedef {object} PresentationOptions
 * @property {ReturnType<typeof import('../core/dashboard-state.js').create>} dashboard
 * @property {import('../types').DistributionValues} state
 * @property {ReturnType<typeof import('./model.js').create>} model
 * @property {ReturnType<typeof import('./donut.js').create>} donut
 * @property {() => DistributionElements} getElements
 * @property {() => boolean} areLegendsHidden
 * @property {() => import('../types').DistributionNavigation} getNavigation
 * @property {() => import('../types').DistributionSummaryInteractions} getInteractions
 * @property {ReturnType<typeof import('./summary-panel.js').create>} summaryView
 * @property {Document} document
 */

/** Own distribution rendering without owning navigation transitions.
 * @param {PresentationOptions} options
 */
export function create(options) {
    const { dashboard, state, model, donut, getElements, areLegendsHidden,
        getNavigation, getInteractions, summaryView, document } = options;
    /** @type {Set<ReturnType<typeof setTimeout>>} */
    const closeTimers = new Set();

    function renderCenter() {
        const coverage = distributionData.distributionCoverage(dashboard.peers, model.isCountryLens() ? 'country' : 'provider');
        const coverageEl = document.getElementById('as-coverage');
        if (coverageEl) coverageEl.textContent = distributionData.coverageLabel(coverage);
        var activePeerTotal = model.getActiveTotalPeers();
        donut.clearLegendHover();
        if (state.peerDetailActive) return;
        if (
            state.donutFocused &&
            state.focusedHoverProvider &&
            !state.selectedProvider
        ) {
            showFocusedCenterText(state.focusedHoverProvider);
            return;
        }
        if (
            areLegendsHidden() &&
            !state.donutFocused &&
            state.focusedHoverProvider &&
            !state.selectedProvider
        ) {
            showLegendHoverCenterText(state.focusedHoverProvider);
            return;
        }
        if (
            state.insightActiveAsNum &&
            state.summarySelected &&
            !state.selectedProvider &&
            state.donutFocused
        ) {
            if (donut.isInsightVisible()) {
                var insightData = model.getInsightDataForActive();
                if (insightData && state.insightActiveType)
                    donut.showInsight(state.insightActiveType, insightData);
            } else {
                showFocusedCenterText(state.insightActiveAsNum);
            }
            return;
        }
        if (
            state.donutFocused &&
            state.summarySelected &&
            state.filterPeerIds &&
            state.filterLabel &&
            !state.selectedProvider
        ) {
            donut.renderFilterCenter(
                state.filterPeerIds.length,
                state.filterLabel,
                dashboard.peers.length,
                'connected peers'
            );
            return;
        }
        if (
            state.donutFocused &&
            state.summarySelected &&
            state.summaryPreviewPeerIds &&
            state.summaryPreviewLabel &&
            !state.selectedProvider
        ) {
            getNavigation().summaryPreviewSummaryCenterText(state.summaryPreviewPeerIds, state.summaryPreviewLabel);
            return;
        }
        if (state.donutFocused && state.activeNetwork && !state.selectedProvider) {
            if (state.filterPeerIds && state.filterLabel) {
                donut.renderFilterCenter(
                    state.filterPeerIds.length,
                    state.filterLabel,
                    dashboard.peers.length,
                    'connected peers'
                );
                return;
            }
            var networkKey = state.activeNetwork;
            var networkPeerCount = dashboard.peers.filter(function (peer) {
                return (peer.network || 'ipv4') === networkKey;
            }).length;
            donut.renderNetworkCenter(networkKey, networkPeerCount, dashboard.peers.length, 'connected peers');
            return;
        }
        if (state.selectedProvider) {
            var segment = model.findActiveSegmentOrGroup(state.selectedProvider);
            if (segment) {
                donut.renderSelectedCenter(segment, {
                    focused: state.donutFocused,
                    isSubProvider: model.isOthersSubProvider(state.selectedProvider),
                    countryLens: model.isCountryLens(),
                    entityKind: model.getActiveEntityKind(),
                    onBack: () => getNavigation().backToOthersList(),
                });
                return;
            }
        }
        donut.renderScoreCenter(model.getActiveDistributionScore(), activePeerTotal, {
            countryLens: model.isCountryLens(),
            tooltip: model.buildActiveScoreTooltip(model.getActiveDistributionScore()),
        });
    }

    function renderLegend() {
        donut.renderLegend();
    }

    function showPanel() {
        const { panel: panelEl } = getElements();
        if (!panelEl) return;
        panelEl.classList.remove('hidden');
        void panelEl.offsetWidth;
        panelEl.classList.add('visible');
        document.body.classList.add('as-panel-open');
        document.body.classList.add('panel-focus-as');
        document.body.classList.remove('panel-focus-peers');
    }

    /** @param {string} countryId */
    function renderCountryPanel(countryId) {
        const { panel: panelEl } = getElements();
        if (!panelEl) return;
        var seg = model.findActiveSegment(countryId);
        var fullGroup = seg && seg.isOthers ? seg : model.findActiveGroup(countryId);
        if (!seg && fullGroup) seg = model.findActiveSegmentOrGroup(countryId);
        if (!seg || !fullGroup) return;

        var allPeers = model.getAllPeersForActiveSegment(seg);
        if (seg.isOthers) {
            fullGroup = distributionData.buildDistributionGroup(
                {
                    asNumber: 'Others',
                    asName: seg.asName,
                    asShort: '',
                    isCountryGroup: true,
                },
                allPeers,
                model.countryTotal
            );
        }
        getNavigation().renderBackButton();
        if (
            !countryPanel.render({
                panelEl,
                segment: seg,
                group: fullGroup,
                peers: allPeers,
                providers: model.aggregateProvidersForPeers(allPeers),
                summaryView,
                attachInteractiveRowHandlers: (bodyEl) => getInteractions().summaryAttachInteractiveRowHandlers(bodyEl),
                attachPanelBlankClickHandler: (bodyEl) => getInteractions().summaryAttachPanelBlankClickHandler(bodyEl),
                connectionTypeLabels: connectionLabels,
                coverage: distributionData.distributionCoverage(dashboard.peers, 'country'),
            })
        )
            return;
        showPanel();
    }

    /** @param {string} asNum */
    function renderPanel(asNum) {
        const { panel: panelEl } = getElements();
        if (model.isCountryLens()) {
            renderCountryPanel(asNum);
            return;
        }
        if (!panelEl) return;
        const resolved = providerPanel.resolve(asNum, model.providerSegments, model.providerGroups, model.getColorForAsNum);
        if (!resolved) return;
        getNavigation().renderBackButton();
        if (
            !providerPanel.render({
                panelEl,
                segment: resolved.segment,
                group: resolved.group,
                summaryView,
                attachInteractiveRowHandlers: (bodyEl) => getInteractions().summaryAttachInteractiveRowHandlers(bodyEl),
                attachPanelBlankClickHandler: (bodyEl) => getInteractions().summaryAttachPanelBlankClickHandler(bodyEl),
                connectionTypeLabels: connectionLabels,
                coverage: distributionData.distributionCoverage(dashboard.peers),
            })
        )
            return;
        showPanel();
    }

    function closePanel() {
        const { panel: panelEl } = getElements();
        if (!panelEl) return;
        panelEl.classList.remove('visible');
        document.body.classList.remove('as-panel-open');
        document.body.classList.remove('panel-focus-as');
        const timer = setTimeout(function () {
            closeTimers.delete(timer);
            const { panel: panelEl } = getElements();
            if (panelEl && !panelEl.classList.contains('visible')) {
                panelEl.classList.add('hidden');
            }
        }, 310);
        closeTimers.add(timer);
    }

    /** @param {string | null} asNum */
    function showFocusedCenterText(asNum) {
        if (!asNum) return;
        var segment = model.findActiveSegmentOrGroup(asNum);
        if (!segment) return;
        donut.renderProviderCenter(segment, {
            isSubProvider: model.isOthersSubProvider(asNum),
            countryLens: model.isCountryLens(),
            entityKind: model.getActiveEntityKind(),
            onBack: () => getNavigation().backToOthersList(),
        });
    }

    /** @param {string} asNum */
    function showLegendHoverCenterText(asNum) {
        var segment = model.findActiveSegment(asNum);
        if (!segment) return;
        var rank = 0;
        var segments = model.getActiveSegments();
        for (var i = 0; i < segments.length; i++) {
            if (segments[i].isOthers) continue;
            rank++;
            if (segments[i].asNumber === asNum) break;
        }
        donut.renderLegendHoverCenter(segment, {
            rank: rank,
            countryLens: model.isCountryLens(),
            entityKind: model.getActiveEntityKind(),
        });
    }

    function updateLensChrome() {
        const { container: containerEl, title: titleEl, lensToggle: lensToggleEl } = getElements();
        if (containerEl) {
            containerEl.dataset.lens = state.lens;
        }
        if (titleEl) {
            if (model.isCountryLens()) {
                titleEl.innerHTML =
                    '<span class="as-title-peer">Peer</span> <span class="as-title-provider">Countries</span><span class="as-title-subtitle" id="as-title-subtitle">(jurisdiction risk)</span>';
                titleEl.title = 'Country and territory peer distribution analysis';
            } else {
                titleEl.innerHTML =
                    '<span class="as-title-peer">Peer</span> <span class="as-title-provider">Service Providers</span><span class="as-title-subtitle" id="as-title-subtitle">(IPv4/IPv6)</span>';
                titleEl.title = 'Autonomous System Peer Distribution Analysis';
            }
        }
        if (!lensToggleEl) return;
        var buttons = queryAll('.as-lens-btn', lensToggleEl);
        for (var i = 0; i < buttons.length; i++) {
            var active = buttons[i].dataset.lens === state.lens;
            buttons[i].classList.toggle('active', active);
            buttons[i].setAttribute('aria-selected', active ? 'true' : 'false');
            buttons[i].tabIndex = active ? 0 : -1;
        }
    }

    function renderCountrySummaryPanel() {
        const { panel: panelEl } = getElements();
        if (!panelEl) return;
        getNavigation().renderBackButton();
        var bodyEl = summaryView.renderCountry(model.computeCountrySummaryData());
        if (!bodyEl) return;
        getInteractions().summaryAttachCountrySummaryRowHandlers(bodyEl);
        getInteractions().summaryAttachPanelBlankClickHandler(bodyEl);
    }

    function renderSummaryPanel() {
        const { panel: panelEl } = getElements();
        if (!panelEl) return;
        getNavigation().renderBackButton();
        var bodyEl = summaryView.renderProvider(model.computeSummaryData());
        if (!bodyEl) return;
        getInteractions().summaryAttachSummaryHandlers(bodyEl);
    }

    /** @param {number[]} peerIds
     * @param {string} category
     * @param {string} label */
    function summaryBuildPeerSummaryHtml(peerIds, category, label) {
        // Find the actual peer objects from the current AS group
        var seg = state.selectedProvider ? model.findActiveSegment(state.selectedProvider) : null;
        /** @type {import('../types').Peer[]} */
        var allPeers = [];
        if (seg) {
            if (seg.isOthers && seg._othersGroups) {
                for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                    for (var opi = 0; opi < seg._othersGroups[oi].peers.length; opi++) {
                        allPeers.push(seg._othersGroups[oi].peers[opi]);
                    }
                }
            } else {
                var grp = model.findActiveGroup(state.selectedProvider);
                if (grp) allPeers = grp.peers;
            }
        } else if (state.selectedProvider) {
            // Fallback for sub-groups not in top donut segments.
            var grp = model.findActiveGroup(state.selectedProvider);
            if (grp) allPeers = grp.peers;
        }

        var matchedPeers = model.peersByIds(peerIds, allPeers);

        return summaryView.buildPeerSummaryHtml(matchedPeers, category, label);
    }

    function summaryHighlightActiveSummaryRow() {
        const { panel: panelEl } = getElements();
        var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
        if (!bodyEl) return;
        // Clear ALL highlights first (summary rows + insight rows + grid rows)
        var allActive = queryAll('.sub-filter-active', bodyEl);
        for (var ai = 0; ai < allActive.length; ai++) allActive[ai].classList.remove('sub-filter-active');
        // Re-apply highlight to matching summary row
        if (state.filterCategory === 'summary' && state.filterLabel) {
            var rows = queryAll('.as-summary-row', bodyEl);
            for (var ri = 0; ri < rows.length; ri++) {
                if (rows[ri].dataset.catLabel === state.filterLabel) {
                    rows[ri].classList.add('sub-filter-active');
                }
            }
        }
        // Re-apply highlight to matching grid rows (conn-provider, conn-out, conn-in)
        if (
            state.filterCategory &&
            state.filterCategory.indexOf('conn-') === 0 &&
            state.filterLabel
        ) {
            var gridSelector =
                state.filterCategory === 'conn-provider'
                    ? '.as-conn-prov-row'
                    : state.filterCategory === 'conn-out'
                      ? '.as-conn-out-row'
                      : state.filterCategory === 'conn-others'
                        ? '.as-conn-others-row'
                        : '.as-conn-dir-row';
            var gridRows = queryAll(gridSelector, bodyEl);
            for (var gi = 0; gi < gridRows.length; gi++) {
                if (gridRows[gi].dataset.as === state.filterLabel) {
                    gridRows[gi].classList.add('sub-filter-active');
                }
            }
        }
    }

    function summaryHighlightActiveSubRow() {
        const { panel: panelEl } = getElements();
        var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
        if (!bodyEl) return;
        var rows = queryAll('.as-interactive-row', bodyEl);
        for (var ri = 0; ri < rows.length; ri++) {
            if (
                state.filterCategory &&
                state.filterLabel &&
                rows[ri].dataset.category === state.filterCategory &&
                required('.as-detail-sub-label', rows[ri]).textContent === state.filterLabel
            ) {
                rows[ri].classList.add('sub-filter-active');
            } else {
                rows[ri].classList.remove('sub-filter-active');
            }
        }
    }

    /** @param {string} asNum */
    function getLineOriginForAs(asNum) {
        // When insight rect is visible, lines come from the origin circle at the bottom
        if (donut.isInsightVisible()) {
            var origin = donut.getInsightOrigin();
            if (origin) return origin;
        }
        // In focused mode or with legends hidden, lines come from donut center
        if (state.donutFocused || areLegendsHidden()) return donut.getDonutCenterPosition();

        // First: direct legend dot match (works for top-8 and selected AS)
        var direct = donut.getLegendDotPosition(asNum);
        if (direct) return direct;

        // Second: check if this AS is inside the "Others" bucket
        var segments = model.getActiveSegments();
        if (segments) {
            for (var i = 0; i < segments.length; i++) {
                var seg = segments[i];
                if (seg.isOthers && seg._othersGroups) {
                    for (var j = 0; j < seg._othersGroups.length; j++) {
                        if (seg._othersGroups[j].asNumber === asNum) {
                            // Found in Others — use the Others legend dot
                            return donut.getLegendDotPosition('Others');
                        }
                    }
                }
            }
        }

        // Final fallback: donut center (only when legend genuinely not rendered)
        return donut.getDonutCenterPosition();
    }

    function dispose() {
        for (const timer of closeTimers) clearTimeout(timer);
        closeTimers.clear();
    }

    return Object.freeze({
        renderCenter,
        renderLegend,
        showPanel,
        renderCountryPanel,
        renderPanel,
        closePanel,
        showFocusedCenterText,
        showLegendHoverCenterText,
        updateLensChrome,
        renderCountrySummaryPanel,
        renderSummaryPanel,
        summaryBuildPeerSummaryHtml,
        summaryHighlightActiveSummaryRow,
        summaryHighlightActiveSubRow,
        getLineOriginForAs,
        dispose,
    });
}
