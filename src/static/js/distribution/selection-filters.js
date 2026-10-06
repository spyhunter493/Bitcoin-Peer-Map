import { query, queryAll, required } from '../core/dom.js';
import * as BPMDomState from '../core/dom-state.js';
import * as BPMPeerFilters from '../peers/filters.js';
import * as BPMDistributionData from './data.js';

/** @typedef {Pick<import('../types').DistributionNavigationOptions, 'getCountrySegments' | 'getDashboard' |
 * 'getNetworkPanel' | 'getPanel' | 'getSegments' | 'getTooltips' | 'hooks' | 'state'> & { actions:
 * Pick<import('../types').DistributionNavigationOptions['actions'], 'animateDonutRevert' |
 * 'findActiveSegmentOrGroup' | 'getColorForAsNum' | 'getInsightDataForActive' | 'hideInsightRect' |
 * 'isCountryLens' | 'renderCenter' | 'renderLegend' | 'showInsightRect' | 'showPeerInDonutCenter' |
 * 'summaryAttachSummaryHandlers' | 'summaryHighlightActiveSubRow' | 'summaryHighlightActiveSummaryRow'
 * | 'tooltipHideSubTooltip'> }} Options */
/** @typedef {Pick<import('../types').DistributionNavigation, 'activateHoverAll' | 'closePeerPopup' | 'openPanel'
 * | 'summaryOpenLensSummaryPanel' | 'summaryPreviewSummaryLines'>} Transitions */

/** Owns persistent filters and reconciles selection against refreshed peer data.
 * @param {Options} options
 * @param {() => Transitions} getNavigation
 */
export function create(options, getNavigation) {
    let reconciling = false;

    function isReconciling() {
        return reconciling;
    }

    function clearSecondaryFilter() {
        options.state.subSubFilterPeerIds = null;
        options.state.subSubFilterProvider = null;
        options.state.subSubFilterColor = null;
        if (options.state.legendFocusProvider) {
            options.state.legendFocusProvider = null;
            options.actions.renderLegend();
        }
    }

    /** @param {number[]} peerIds
     * @param {string} label */
    function summaryApplySummarySubFilter(peerIds, label) {
        // Close peer detail popup when selecting from panel
        if (options.state.peerDetailActive && !reconciling) getNavigation().closePeerPopup();
        if (options.state.filterPeerIds && label === options.state.filterLabel) {
            summaryClearSummarySubFilter();
            return;
        }
        // Clear any active insight state when switching to a different category
        if (options.state.insightActiveAsNum || options.state.insightActiveType) {
            options.state.insightActiveAsNum = null;
            options.state.insightActiveData = null;
            options.state.insightActiveType = null;
            options.actions.hideInsightRect();
            if (options.state.donutFocused) options.actions.animateDonutRevert();
        }
        options.state.filterPeerIds = peerIds;
        options.state.filterCategory = 'summary';
        options.state.filterLabel = label;
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        // Draw lines for the filtered peers — group by AS for colored lines
        if (options.hooks.drawLinesForAllAs && options.getSegments().length > 0) {
            /** @type {Record<number, boolean>} */
            var idSet = {};
            for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
            var groups = [];
            for (var si = 0; si < options.getSegments().length; si++) {
                var seg = options.getSegments()[si];
                var filteredIds = [];
                for (var pi = 0; pi < seg.peerIds.length; pi++) {
                    if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                }
                if (filteredIds.length > 0) {
                    groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                }
            }
            options.hooks.drawLinesForAllAs(groups);
        }
        options.actions.summaryHighlightActiveSummaryRow();
        // Zoom map out to world view when selecting a new category
        if (options.hooks.resetMapZoom) options.hooks.resetMapZoom();
    }

    function summaryClearSummarySubFilter() {
        const panelEl = options.getPanel();
        options.state.filterPeerIds = null;
        options.state.filterLabel = null;
        options.state.filterCategory = null;
        options.state.insightActiveAsNum = null;
        options.state.insightActiveData = null;
        options.state.insightActiveType = null;
        options.actions.tooltipHideSubTooltip();
        options.actions.hideInsightRect();
        // Restore to showing all peers
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
        // Re-draw all lines
        if (options.state.summarySelected) getNavigation().activateHoverAll();
        // Remove active highlights from both summary rows and insight rows
        var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
        if (bodyEl) {
            var rows = queryAll('.sub-filter-active', bodyEl);
            for (var ri = 0; ri < rows.length; ri++) rows[ri].classList.remove('sub-filter-active');
        }
        // Revert donut expansion and center text (a conn-provider sub-filter
        // may have expanded a segment and shown provider name in center)
        options.actions.animateDonutRevert();
        options.actions.renderCenter();
        options.actions.renderLegend();
    }

    /** @param {number[]} peerIds
     * @param {string} category
     * @param {string} label */
    function summaryApplySubFilter(peerIds, category, label) {
        if (
            options.state.filterPeerIds &&
            category === options.state.filterCategory &&
            label === options.state.filterLabel
        ) {
            // Clicking the same filter — toggle off
            summaryClearSubFilter();
            return;
        }
        options.state.filterPeerIds = peerIds;
        options.state.filterCategory = category || null;
        options.state.filterLabel = label || null;
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);

        // Draw lines for sub-filtered peers
        const seg = options.state.selectedProvider
            ? options.actions.findActiveSegmentOrGroup(options.state.selectedProvider)
            : null;
        if (seg && options.hooks.drawLinesForAs && options.state.selectedProvider) {
            options.hooks.drawLinesForAs(options.state.selectedProvider, peerIds, seg.color);
        }

        // Highlight the active row
        options.actions.summaryHighlightActiveSubRow();
    }

    function summaryClearSubFilter() {
        const panelEl = options.getPanel();
        options.state.filterPeerIds = null;
        options.state.filterLabel = null;
        options.state.filterCategory = null;
        options.actions.tooltipHideSubTooltip();
        // Restore to full AS filter
        if (options.state.selectedProvider) {
            const seg = options.actions.findActiveSegmentOrGroup(options.state.selectedProvider);
            if (seg) {
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(seg.peerIds);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(seg.peerIds);
                if (options.hooks.drawLinesForAs)
                    options.hooks.drawLinesForAs(options.state.selectedProvider, seg.peerIds, seg.color);
            }
        }
        // Remove active highlights
        var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
        if (bodyEl) {
            var rows = queryAll('.as-interactive-row', bodyEl);
            for (var ri = 0; ri < rows.length; ri++) {
                rows[ri].classList.remove('sub-filter-active');
            }
        }
    }

    function refreshSelectionViews() {
        const panelEl = options.getPanel();
        if (
            !panelEl ||
            (!options.state.selectedProvider && !options.state.summarySelected && !options.state.activeNetwork)
        )
            return;
        const restorePanel = BPMDomState.capture(panelEl);
        const pinnedKey = options.getTooltips().captureSource();
        const category = options.state.filterCategory;
        const label = options.state.filterLabel || '';
        const topGroups = {
            provider: options
                .getSegments()
                .filter((segment) => !segment.isOthers)
                .map((segment) => segment.asNumber),
            country: options
                .getCountrySegments()
                .filter((segment) => !segment.isOthers)
                .map((segment) => segment.asNumber),
        };
        let scope = options.getDashboard().peers;
        if (options.state.activeNetwork) scope = scope.filter((peer) => peer.network === options.state.activeNetwork);
        else if (options.state.selectedProvider)
            scope = BPMPeerFilters.resolve(
                scope,
                {
                    kind:
                        options.state.selectedProvider === 'Others'
                            ? 'others'
                            : options.actions.isCountryLens()
                              ? 'country'
                              : 'provider',
                    key:
                        options.state.selectedProvider === 'Others'
                            ? options.actions.isCountryLens()
                                ? 'country'
                                : 'provider'
                            : options.state.selectedProvider,
                },
                topGroups
            );

        let descriptor = options.state.filterDescriptor;
        if (category && category !== 'summary') descriptor = BPMPeerFilters.forCategory(category, label, scope);
        options.state.filterDescriptor = descriptor;
        const filtered = BPMPeerFilters.resolve(scope, descriptor, topGroups);
        options.state.filterPeerIds = category ? filtered.map((peer) => peer.id) : null;
        const secondary = options.state.subSubFilterProvider;
        const secondaryPeers = secondary
            ? filtered.filter((peer) => BPMDistributionData.parseAsNumber(peer.as) === secondary)
            : null;
        options.state.subSubFilterPeerIds = secondaryPeers ? secondaryPeers.map((peer) => peer.id) : null;

        reconciling = true;
        try {
            if (options.state.activeNetwork) {
                const result = options.getNetworkPanel().render({
                    panelElement: panelEl,
                    peers: options.getDashboard().peers,
                    segments: options.getSegments(),
                    networkKey: options.state.activeNetwork,
                    isRefresh: true,
                });
                if (result.bodyElement) options.actions.summaryAttachSummaryHandlers(result.bodyElement);
            } else if (options.state.selectedProvider) {
                if (scope.length) getNavigation().openPanel(options.state.selectedProvider);
                else {
                    required('.as-detail-body', panelEl).innerHTML =
                        '<div class="pn-panel-empty">No matching peers connected</div>';
                    required('.as-detail-pct', panelEl).textContent = '0 peers';
                }
            } else getNavigation().summaryOpenLensSummaryPanel();
        } finally {
            reconciling = false;
        }
        restorePanel();
        options.getTooltips().restoreSource(pinnedKey);
        options.actions.summaryHighlightActiveSummaryRow();
        options.actions.summaryHighlightActiveSubRow();

        options.getTooltips().refreshPinned({ category, label, filtered, secondary, secondaryPeers });
        let visible = secondaryPeers || filtered;
        if (!secondary && category?.startsWith('insight-') && options.state.insightActiveAsNum) {
            visible = visible.filter(
                (peer) => BPMDistributionData.parseAsNumber(peer.as) === options.state.insightActiveAsNum
            );
        }
        const peer =
            options.state.selectedPeerId === null
                ? undefined
                : options.getDashboard().byId.get(options.state.selectedPeerId);
        const hovered =
            options.state.hoveredPeerId === null
                ? undefined
                : options.getDashboard().byId.get(options.state.hoveredPeerId);
        if (peer && options.state.peerDetailActive) visible = [peer];
        else if (hovered && visible.some((item) => item.id === hovered.id)) visible = [hovered];
        const ids = visible.map((item) => item.id);
        const filtering =
            category || options.state.selectedProvider || options.state.activeNetwork || peer || secondary;
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(filtering ? ids : null);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(filtering ? ids : null);
        if (filtering) getNavigation().summaryPreviewSummaryLines(ids);
        else if (options.state.summarySelected) getNavigation().activateHoverAll();
        if (peer && options.state.peerDetailActive)
            options.actions.showPeerInDonutCenter(
                peer,
                options.actions.getColorForAsNum(BPMDistributionData.parseAsNumber(peer.as))
            );
        else if (options.state.insightActiveAsNum) {
            const data = options.actions.getInsightDataForActive();
            if (data && options.state.insightActiveType)
                options.actions.showInsightRect(options.state.insightActiveType, data);
            else options.actions.hideInsightRect();
        }
    }

    /** @param {import('../types').PeerFilter | null} descriptor */
    function setFilterDescriptor(descriptor) {
        options.state.filterDescriptor = descriptor;
    }

    return Object.freeze({
        isReconciling,
        clearSecondaryFilter,
        summaryApplySummarySubFilter,
        summaryClearSummarySubFilter,
        summaryApplySubFilter,
        summaryClearSubFilter,
        refreshSelectionViews,
        setFilterDescriptor,
    });
}
