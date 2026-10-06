import { query, queryAll, required } from '../core/dom.js';
import * as BPMDistributionData from './data.js';

/** @typedef {Pick<import('../types').DistributionNavigationOptions, 'getContainer' | 'getDashboard' | 'getDonut'
 * | 'getGroups' | 'getPanel' | 'getSegments' | 'getSummaryView' | 'hooks' | 'state'> & { actions:
 * Pick<import('../types').DistributionNavigationOptions['actions'], 'animateDonutExpand' |
 * 'clearLegendHighlight' | 'findActiveSegmentOrGroup' | 'getColorForAsNum' | 'getPeerIdsForAnyAs' |
 * 'hideInsightRect' | 'highlightLegendItem' | 'peersByIds' | 'renderCenter' | 'renderLegend' |
 * 'restoreInsightRectProvider' | 'showFocusedCenterText' | 'showPeerInDonutCenter' |
 * 'summaryAttachProviderClickHandlers' | 'summaryAttachProviderNavHandlers' |
 * 'tooltipAttachSubTooltipHandlers' | 'tooltipHideSubSubTooltip' | 'tooltipHideSubTooltip' |
 * 'tooltipHighlightSelectedPeerRow' | 'tooltipIsPinnedTo' | 'tooltipPinSecondary' |
 * 'tooltipPinSubTooltip' | 'tooltipShowSubSubTooltip' | 'tooltipShowSubTooltip' |
 * 'updateInsightRectForPeer'> }} Options */
/** @typedef {Pick<import('../types').DistributionNavigation, 'activateHoverAll' | 'closePeerPopup' |
 * 'isReconciling' | 'openPanel' | 'openPeerDetailPanel' | 'previewPeerInPopup' |
 * 'restorePeerPopupToSelected' | 'setLegendFocus' | 'summaryClearSubFilter' |
 * 'summaryPreviewProviderLines' | 'summaryPreviewSummaryLines' | 'summaryRestoreDonutAfterPreview' |
 * 'summaryRestoreProviderFromPreview' | 'summaryRestoreSummaryFromPreview'>} Transitions */

/** Handles panel rows and cascading tooltip input.
 * @param {Options} options
 * @param {() => Transitions} getNavigation
 */
export function create(options, getNavigation) {
    /**
     * @param {HTMLElement} rowEl
     */
    function previewCountry(rowEl) {
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        var countryId = rowEl.dataset.as || '';
        var seg = options.actions.findActiveSegmentOrGroup(countryId);
        if (!seg) return;
        options.actions.highlightLegendItem(countryId);
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(seg.peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(seg.peerIds);
        if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs(countryId, seg.peerIds, seg.color);
        if (options.state.donutFocused) {
            options.state.focusedHoverProvider = countryId;
            options.actions.showFocusedCenterText(countryId);
        }
    }

    /**

     */
    function restoreCountryPreview() {
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        options.state.focusedHoverProvider = null;
        options.actions.clearLegendHighlight();
        if (options.state.summarySelected) {
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            getNavigation().activateHoverAll();
        } else {
            if (options.hooks.clearAsLines) options.hooks.clearAsLines();
        }
        options.actions.renderCenter();
    }

    /**
     * @param {HTMLElement} rowEl
     * @param {HTMLElement} bodyEl
     * @param {PointerEvent} e
     */
    function selectCountryFromSummary(rowEl, bodyEl, e) {
        const containerEl = options.getContainer();
        e.stopPropagation();
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) getNavigation().closePeerPopup();
        var countryId = rowEl.dataset.as || '';
        var seg = options.actions.findActiveSegmentOrGroup(countryId);
        if (!seg) return;

        var scrollTop = bodyEl ? bodyEl.scrollTop : 0;
        options.state.panelHistory = [{ type: 'summary', scrollTop: scrollTop }];
        options.state.summarySelected = false;
        options.state.selectedProvider = countryId;
        options.state.filterPeerIds = null;
        options.state.filterLabel = null;
        options.state.filterCategory = null;
        options.actions.tooltipHideSubTooltip();
        options.actions.tooltipHideSubSubTooltip();

        getNavigation().openPanel(countryId);
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(seg.peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(seg.peerIds);
        if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs(countryId, seg.peerIds, seg.color);
        options.actions.animateDonutExpand(countryId);
        containerEl?.classList.add('as-legend-visible');
        options.actions.renderCenter();
        options.actions.renderLegend();
        if (options.hooks.resetMapZoom) options.hooks.resetMapZoom();
    }

    /**
     * @param {HTMLElement} bodyEl
     * @param {PointerEvent} e
     */
    function dismissPanelTooltips(bodyEl, e) {
        if (!(e.target instanceof Element)) return;
        // Only close if clicking on the body itself, not on interactive children
        if (
            e.target === bodyEl ||
            e.target.classList.contains('modal-section-title') ||
            e.target.classList.contains('modal-row') ||
            e.target.classList.contains('modal-label') ||
            e.target.classList.contains('modal-val')
        ) {
            if (options.state.subTooltipPinned || options.state.subSubTooltipPinned) {
                options.actions.tooltipHideSubTooltip();
                options.actions.tooltipHideSubSubTooltip();
                if (options.state.summarySelected) {
                    options.state.filterPeerIds = null;
                    options.state.filterLabel = null;
                    options.state.filterCategory = null;
                    if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
                    if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
                    getNavigation().activateHoverAll();
                    var rows = queryAll('.sub-filter-active', bodyEl);
                    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
                } else if (options.state.selectedProvider) {
                    getNavigation().summaryClearSubFilter();
                }
            }
        }
    }

    /**
     * @param {HTMLElement} provRow
     */
    function previewNestedProvider(provRow) {
        if (options.state.peerDetailActive || options.state.subSubTooltipPinned) return;
        var asNum = provRow.dataset.as || '';
        /** @type {number[]} */
        var peerIds = JSON.parse(provRow.dataset.peerIds || '');
        // Focus legend on this provider
        if (asNum) getNavigation().setLegendFocus(asNum);
        if (peerIds.length > 0 && options.hooks.drawLinesForAs && asNum) {
            options.hooks.drawLinesForAs(asNum, peerIds, options.actions.getColorForAsNum(asNum));
        }
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        // In focused mode, show provider in donut center + animate
        if (options.state.donutFocused && asNum) {
            options.actions.showFocusedCenterText(asNum);
            options.actions.animateDonutExpand(asNum);
        }
    }

    /**
     * @param {HTMLElement} provRow
     * @param {PointerEvent} e
     */
    function selectNestedProvider(provRow, e) {
        e.stopPropagation();
        /** @type {number[]} */
        var peerIds = JSON.parse(provRow.dataset.peerIds || '');

        // Find matching peer objects from lastPeersRaw
        var matchedPeers = options.actions.peersByIds(peerIds);

        var asNum = provRow.dataset.as || '';
        // Keep legend focused on this provider while sub-sub is pinned
        options.state.legendFocusProvider = asNum;
        options.actions.renderLegend();

        // Highlight this provider row as selected in the sub-tooltip
        var tip = document.getElementById('as-sub-tooltip');
        if (tip) {
            var prevSel = queryAll('.as-provider-row-selected', tip);
            for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
        }
        provRow.classList.add('as-provider-row-selected');

        var html = options.getSummaryView().buildPeerListHtmlForSubSub(matchedPeers);
        options.actions.tooltipShowSubSubTooltip(html, e);
        options.actions.tooltipPinSecondary();

        // Track sub-sub state for data refresh preservation
        options.state.subSubFilterPeerIds = peerIds;
        options.state.subSubFilterProvider = asNum;
        options.state.subSubFilterColor = options.actions.getColorForAsNum(asNum);

        // Draw lines for just this provider's peers
        if (options.hooks.drawLinesForAs && asNum) {
            options.hooks.drawLinesForAs(asNum, peerIds, options.state.subSubFilterColor);
        }
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
    }

    /**
     * @param {HTMLElement} linkEl
     * @param {PointerEvent} e
     */
    function enterPrivateFromTooltip(linkEl, e) {
        e.stopPropagation();
        var netKey = linkEl.dataset.net || '';
        if (options.hooks.enterPrivateNetMode && netKey) options.hooks.enterPrivateNetMode(netKey);
    }

    /**
     * @param {HTMLElement} rowEl
     * @param {() => string | null} buildProvPeerHtml
     * @param {MouseEvent} e
     */
    function previewConnectionProvider(rowEl, buildProvPeerHtml, e) {
        // When something is selected (pinned) or peer detail is open, suppress hover previews
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        /** @type {number[]} */
        var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
        var asNum = rowEl.dataset.as || '';
        if (asNum) getNavigation().setLegendFocus(asNum);
        var html = buildProvPeerHtml();
        if (html) options.actions.tooltipShowSubTooltip(html, e);
        // Preview lines for this provider
        if (asNum && peerIds.length > 0) {
            var color = options.actions.getColorForAsNum(asNum);
            if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs(asNum, peerIds, color);
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        }
        if (options.state.donutFocused && asNum) {
            options.actions.showFocusedCenterText(asNum);
            options.actions.animateDonutExpand(asNum);
        }
    }

    /**
     * @param {HTMLElement} rowEl
     * @param {() => string | null} buildProvPeerHtml
     * @param {PointerEvent} e
     */
    function selectConnectionProvider(rowEl, buildProvPeerHtml, e) {
        const panelEl = options.getPanel();
        e.stopPropagation();
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) getNavigation().closePeerPopup();
        if (options.actions.tooltipIsPinnedTo(rowEl)) {
            options.actions.tooltipHideSubTooltip();
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) getNavigation().activateHoverAll();
            getNavigation().summaryRestoreDonutAfterPreview();
            return;
        }
        /** @type {number[]} */
        var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
        var html = buildProvPeerHtml();
        if (!html) return;
        options.actions.tooltipShowSubTooltip(html, e);
        options.actions.tooltipPinSubTooltip(rowEl);
        options.actions.tooltipAttachSubTooltipHandlers();
        var tipEl = document.getElementById('as-sub-tooltip');
        if (tipEl) options.actions.summaryAttachProviderNavHandlers(tipEl);
        // Clear any active insight state when selecting a provider
        if (options.state.insightActiveAsNum || options.state.insightActiveType) {
            options.state.insightActiveAsNum = null;
            options.state.insightActiveData = null;
            options.state.insightActiveType = null;
            options.actions.hideInsightRect();
        }
        // Clear all highlights before setting new ones
        var activeBodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
        if (activeBodyEl) {
            var prev = queryAll('.sub-filter-active', activeBodyEl);
            for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
        }
        // Highlight this row as the active selection
        rowEl.classList.add('sub-filter-active');
        // Track sub-filter state for data refresh preservation
        var asNum = rowEl.dataset.as || '';
        options.state.filterPeerIds = peerIds;
        options.state.filterCategory = 'conn-provider';
        options.state.filterLabel = asNum || '';
        // Draw lines for this provider's peers
        if (asNum && options.hooks.drawLinesForAs) {
            var color = options.actions.getColorForAsNum(asNum);
            options.hooks.drawLinesForAs(asNum, peerIds, color);
        }
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        // Keep donut expanded for this provider while viewing its peers
        if (options.state.donutFocused && asNum) {
            options.actions.showFocusedCenterText(asNum);
            options.actions.animateDonutExpand(asNum);
        }
    }

    /**
     * @param {HTMLElement} rowEl
     * @param {() => string | null} buildOutSubHtml
     * @param {MouseEvent} e
     */
    function previewOutboundTypeGroup(rowEl, buildOutSubHtml, e) {
        // When something is selected (pinned) or peer detail is open, suppress hover previews
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        /** @type {number[]} */
        var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
        var asNum = rowEl.dataset.as || '';
        if (asNum) getNavigation().setLegendFocus(asNum);
        var html = buildOutSubHtml();
        if (html) options.actions.tooltipShowSubTooltip(html, e);
        if (asNum && peerIds.length > 0) {
            var color = options.actions.getColorForAsNum(asNum);
            if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs(asNum, peerIds, color);
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        }
        if (options.state.donutFocused && asNum) {
            options.actions.showFocusedCenterText(asNum);
            options.actions.animateDonutExpand(asNum);
        }
    }

    /**
     * @param {HTMLElement} rowEl
     * @param {() => string | null} buildOutSubHtml
     * @param {PointerEvent} e
     */
    function selectOutboundTypeGroup(rowEl, buildOutSubHtml, e) {
        const panelEl = options.getPanel();
        e.stopPropagation();
        if (options.actions.tooltipIsPinnedTo(rowEl)) {
            options.actions.tooltipHideSubTooltip();
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) getNavigation().activateHoverAll();
            getNavigation().summaryRestoreDonutAfterPreview();
            return;
        }
        /** @type {number[]} */
        var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
        var html = buildOutSubHtml();
        if (!html) return;
        options.actions.tooltipShowSubTooltip(html, e);
        options.actions.tooltipPinSubTooltip(rowEl);
        options.actions.tooltipAttachSubTooltipHandlers();
        // Clear insight state
        if (options.state.insightActiveAsNum || options.state.insightActiveType) {
            options.state.insightActiveAsNum = null;
            options.state.insightActiveData = null;
            options.state.insightActiveType = null;
            options.actions.hideInsightRect();
        }
        var activeBodyOut = panelEl ? query('.as-detail-body', panelEl) : null;
        if (activeBodyOut) {
            var prev = queryAll('.sub-filter-active', activeBodyOut);
            for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
        }
        // Highlight this row as the active selection
        rowEl.classList.add('sub-filter-active');
        // Track sub-filter state for data refresh preservation
        options.state.filterPeerIds = peerIds;
        options.state.filterCategory = 'conn-out';
        options.state.filterLabel = rowEl.dataset.as || '';
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        // Keep donut expanded for the parent provider
        var asNum = rowEl.dataset.as || '';
        if (options.state.donutFocused && asNum) {
            options.actions.showFocusedCenterText(asNum);
            options.actions.animateDonutExpand(asNum);
        }
    }

    /**
     * @param {HTMLElement} rowEl
     * @param {() => string | null} buildDirPeerHtml
     * @param {MouseEvent} e
     */
    function previewConnectionDirection(rowEl, buildDirPeerHtml, e) {
        // When something is selected (pinned) or peer detail is open, suppress hover previews
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        /** @type {number[]} */
        var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
        var asNum = rowEl.dataset.as || '';
        if (asNum) getNavigation().setLegendFocus(asNum);
        var html = buildDirPeerHtml();
        if (html) options.actions.tooltipShowSubTooltip(html, e);
        if (asNum && peerIds.length > 0) {
            var color = options.actions.getColorForAsNum(asNum);
            if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs(asNum, peerIds, color);
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        }
        if (options.state.donutFocused && asNum) {
            options.actions.showFocusedCenterText(asNum);
            options.actions.animateDonutExpand(asNum);
        }
    }

    /**
     * @param {HTMLElement} rowEl
     * @param {() => string | null} buildDirPeerHtml
     * @param {PointerEvent} e
     */
    function selectConnectionDirection(rowEl, buildDirPeerHtml, e) {
        const panelEl = options.getPanel();
        e.stopPropagation();
        if (options.actions.tooltipIsPinnedTo(rowEl)) {
            options.actions.tooltipHideSubTooltip();
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) getNavigation().activateHoverAll();
            getNavigation().summaryRestoreDonutAfterPreview();
            return;
        }
        /** @type {number[]} */
        var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
        var html = buildDirPeerHtml();
        if (!html) return;
        options.actions.tooltipShowSubTooltip(html, e);
        options.actions.tooltipPinSubTooltip(rowEl);
        options.actions.tooltipAttachSubTooltipHandlers();
        // Clear insight state
        if (options.state.insightActiveAsNum || options.state.insightActiveType) {
            options.state.insightActiveAsNum = null;
            options.state.insightActiveData = null;
            options.state.insightActiveType = null;
            options.actions.hideInsightRect();
        }
        var activeBodyIn = panelEl ? query('.as-detail-body', panelEl) : null;
        if (activeBodyIn) {
            var prev = queryAll('.sub-filter-active', activeBodyIn);
            for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
        }
        // Highlight this row as the active selection
        rowEl.classList.add('sub-filter-active');
        // Track sub-filter state for data refresh preservation
        options.state.filterPeerIds = peerIds;
        options.state.filterCategory = 'conn-in';
        options.state.filterLabel = rowEl.dataset.as || '';
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        // Keep donut expanded for the parent provider
        var asNum = rowEl.dataset.as || '';
        if (options.state.donutFocused && asNum) {
            options.actions.showFocusedCenterText(asNum);
            options.actions.animateDonutExpand(asNum);
        }
    }

    /**
     * @param {HTMLElement} rowEl
     * @param {PointerEvent} e
     */
    function selectOtherProviders(rowEl, e) {
        const panelEl = options.getPanel();
        e.stopPropagation();
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) getNavigation().closePeerPopup();
        /** @type {number[]} */
        var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
        /** @type {Parameters<ReturnType<typeof import('./summary-panel.js').create>['buildProviderListHtml']>[0]} */
        var providers = JSON.parse(rowEl.dataset.providers || '');

        // Toggle: clicking same row unpins
        if (options.actions.tooltipIsPinnedTo(rowEl)) {
            options.actions.tooltipHideSubTooltip();
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) getNavigation().activateHoverAll();
            getNavigation().summaryRestoreDonutAfterPreview();
            return;
        }

        // Clear insight state
        if (options.state.insightActiveAsNum || options.state.insightActiveType) {
            options.state.insightActiveAsNum = null;
            options.state.insightActiveData = null;
            options.state.insightActiveType = null;
            options.actions.hideInsightRect();
        }
        // Clear all highlights before setting new ones
        var activeBodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
        if (activeBodyEl) {
            var prev = queryAll('.sub-filter-active', activeBodyEl);
            for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
        }
        rowEl.classList.add('sub-filter-active');

        // Track sub-filter state — use 'conn-others' so refresh
        // rebuilds from the Others donut segment, not summary categories
        options.state.filterPeerIds = peerIds;
        options.state.filterCategory = 'conn-others';
        options.state.filterLabel = 'Others';

        // Draw lines grouped by AS for the Others peers
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
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);

        getNavigation().summaryRestoreDonutAfterPreview();

        // Pin the sub-tooltip with provider list + "Open Others panel" nav link
        var html = options.getSummaryView().buildProviderListHtml(providers, 'Others', 'Others',
            BPMDistributionData.distributionCoverage(options.getDashboard().peers.filter(peer => peerIds.includes(peer.id))));
        options.actions.tooltipShowSubTooltip(html, e);
        options.actions.tooltipPinSubTooltip(rowEl);
        const tipEl2 = required('#as-sub-tooltip');
        options.actions.summaryAttachProviderClickHandlers(tipEl2);
        options.actions.summaryAttachProviderNavHandlers(tipEl2);
    }

    /**
     * @param {HTMLElement} row
     */
    function previewTooltipPeer(row) {
        var peerId = parseInt(row.dataset.peerId || '');
        if (isNaN(peerId)) return;
        options.state.hoveredPeerId = peerId; // Track for update preservation
        if (options.state.summarySelected) {
            getNavigation().summaryPreviewSummaryLines([peerId]);
        } else if (options.state.selectedProvider) {
            getNavigation().summaryPreviewProviderLines([peerId]);
        }
        // Preview this peer in the popup if a different peer is selected
        if (options.state.peerDetailActive && peerId !== options.state.selectedPeerId) {
            var peer = options.getDashboard().peers.find(function (p) {
                return p.id === peerId;
            });
            if (peer) getNavigation().previewPeerInPopup(peer);
        }
        // In focused mode, show peer info in donut center or update insight rect
        if (options.state.donutFocused) {
            var peer = options.getDashboard().peers.find(function (p) {
                return p.id === peerId;
            });
            if (peer) {
                var asNum = row.dataset.as || BPMDistributionData.parseAsNumber(peer.as);
                var color = asNum ? options.actions.getColorForAsNum(asNum) : '#6e7681';
                if (options.getDonut().isInsightVisible()) {
                    options.actions.updateInsightRectForPeer(peer, color);
                } else {
                    options.actions.showPeerInDonutCenter(peer, color);
                    // Keep donut expanded for the provider context
                    if (
                        options.state.filterCategory &&
                        options.state.filterCategory.indexOf('conn-') === 0 &&
                        options.state.filterLabel
                    ) {
                        options.actions.animateDonutExpand(options.state.filterLabel);
                    }
                }
            }
        }
    }

    /**

     */
    function restoreTooltipPeerPreview() {
        options.state.hoveredPeerId = null;

        // If a peer is selected (popup open), restore to that peer's state
        if (options.state.peerDetailActive && options.state.selectedPeerId) {
            getNavigation().restorePeerPopupToSelected();
            var selPeer = options.getDashboard().peers.find(function (p) {
                return p.id === options.state.selectedPeerId;
            });
            if (selPeer) {
                var selAsNum = BPMDistributionData.parseAsNumber(selPeer.as);
                var selColor = selAsNum ? options.actions.getColorForAsNum(selAsNum) : '#6e7681';
                // Restore line/filter to selected peer
                if (options.hooks.drawLinesForAs && selAsNum)
                    options.hooks.drawLinesForAs(selAsNum, [options.state.selectedPeerId], selColor);
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable([options.state.selectedPeerId]);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers([options.state.selectedPeerId]);
                // Restore donut center / insight rect to selected peer
                if (options.state.donutFocused) {
                    if (options.getDonut().isInsightVisible()) {
                        options.actions.updateInsightRectForPeer(selPeer, selColor);
                    } else {
                        options.actions.showPeerInDonutCenter(selPeer, selColor);
                    }
                }
            }
            return;
        }

        // Restore lines/filter to parent state (selected provider or summary sub-filter)
        if (options.state.summarySelected) {
            getNavigation().summaryRestoreSummaryFromPreview();
        } else if (options.state.selectedProvider) {
            getNavigation().summaryRestoreProviderFromPreview();
        }
        // Restore donut center display
        if (options.state.donutFocused) {
            if (options.getDonut().isInsightVisible()) {
                options.actions.restoreInsightRectProvider();
            } else if (
                options.state.filterCategory &&
                options.state.filterCategory.indexOf('conn-') === 0 &&
                options.state.filterLabel
            ) {
                // Restore donut to show the provider (keep expanded)
                options.actions.showFocusedCenterText(options.state.filterLabel);
                options.actions.animateDonutExpand(options.state.filterLabel);
            } else if (options.state.selectedProvider) {
                options.actions.renderCenter();
            } else {
                options.actions.renderCenter();
            }
        }
    }

    /**
     * @param {HTMLElement} link
     * @param {PointerEvent} e
     */
    function selectPrimaryTooltipPeer(link, e) {
        e.stopPropagation();
        var peerId = parseInt(link.dataset.peerId || '');
        if (isNaN(peerId)) return;
        // Zoom to peer on map — panel stays open for navigation
        if (options.hooks.zoomToPeerOnly) options.hooks.zoomToPeerOnly(peerId);
        // Find the peer data and open the large popup
        var peer = options.getDashboard().peers.find(function (p) {
            return p.id === peerId;
        });
        if (peer) {
            getNavigation().openPeerDetailPanel(peer, 'panel');
            options.actions.tooltipHighlightSelectedPeerRow(peerId);
        }
    }

    /**
     * @param {HTMLElement} link
     * @param {PointerEvent} e
     */
    function selectSecondaryTooltipPeer(link, e) {
        e.stopPropagation();
        var peerId = parseInt(link.dataset.peerId || '');
        if (isNaN(peerId)) return;
        // Zoom to peer on map — panel stays open for navigation
        if (options.hooks.zoomToPeerOnly) options.hooks.zoomToPeerOnly(peerId);
        // Find the peer data and open the large popup
        var peer = options.getDashboard().peers.find(function (p) {
            return p.id === peerId;
        });
        if (peer) {
            getNavigation().openPeerDetailPanel(peer, 'panel');
            options.actions.tooltipHighlightSelectedPeerRow(peerId);
        }
    }

    /**
     * @param {HTMLElement} el
     */
    function previewNavigationProvider(el) {
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        var asNum = el.dataset.as || '';
        if (!asNum) return;
        // Focus legend on this provider
        getNavigation().setLegendFocus(asNum);
        var peerIds = options.actions.getPeerIdsForAnyAs(asNum);
        var color = options.actions.getColorForAsNum(asNum);
        if (peerIds.length > 0 && options.hooks.drawLinesForAs) {
            options.hooks.drawLinesForAs(asNum, peerIds, color);
        }
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        // In focused mode, show provider in donut center + animate
        if (options.state.donutFocused && asNum) {
            options.actions.showFocusedCenterText(asNum);
            options.actions.animateDonutExpand(asNum);
        }
    }

    /**
     * @param {HTMLElement} el
     * @param {PointerEvent} e
     */
    function selectAllProviders(el, e) {
        e.stopPropagation();
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) getNavigation().closePeerPopup();
        // Toggle: clicking same link unpins
        if (options.actions.tooltipIsPinnedTo(el)) {
            options.actions.tooltipHideSubTooltip();
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) getNavigation().activateHoverAll();
            return;
        }
        var allProvs = options.getGroups().map(function (g) {
            return {
                asNumber: g.asNumber,
                name: g.asShort || g.asName || g.asNumber,
                color: options.actions.getColorForAsNum(g.asNumber),
                peerCount: g.peerCount,
                peerIds: g.peerIds,
                peers: g.peers,
            };
        });
        var html = options.getSummaryView().buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')', undefined,
            BPMDistributionData.distributionCoverage(options.getDashboard().peers));
        options.actions.tooltipShowSubTooltip(html, e);
        options.actions.tooltipPinSubTooltip(el);
        var tip = document.getElementById('as-sub-tooltip');
        if (tip) {
            options.actions.summaryAttachProviderClickHandlers(tip);
            options.actions.summaryAttachProviderNavHandlers(tip);
        }
        // Track sub-filter state for data refresh preservation
        options.state.filterPeerIds = [];
        options.state.filterCategory = 'all-providers';
        options.state.filterLabel = 'all-providers';
    }

    /**
     * @param {HTMLElement} el
     * @param {PointerEvent} e
     */
    function selectHeaderProviders(el, e) {
        e.stopPropagation();
        if (options.actions.tooltipIsPinnedTo(el)) {
            options.actions.tooltipHideSubTooltip();
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) getNavigation().activateHoverAll();
            return;
        }
        var allProvs = options.getGroups().map(function (g) {
            return {
                asNumber: g.asNumber,
                name: g.asShort || g.asName || g.asNumber,
                color: options.actions.getColorForAsNum(g.asNumber),
                peerCount: g.peerCount,
                peerIds: g.peerIds,
                peers: g.peers,
            };
        });
        var html = options.getSummaryView().buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')', undefined,
            BPMDistributionData.distributionCoverage(options.getDashboard().peers));
        options.actions.tooltipShowSubTooltip(html, e);
        options.actions.tooltipPinSubTooltip(el);
        var tip = document.getElementById('as-sub-tooltip');
        if (tip) {
            options.actions.summaryAttachProviderClickHandlers(tip);
            options.actions.summaryAttachProviderNavHandlers(tip);
        }
        // Track sub-filter state for data refresh preservation
        options.state.filterPeerIds = [];
        options.state.filterCategory = 'all-providers';
        options.state.filterLabel = 'all-providers';
    }

    return Object.freeze({
        previewCountry,
        restoreCountryPreview,
        selectCountryFromSummary,
        dismissPanelTooltips,
        previewNestedProvider,
        selectNestedProvider,
        enterPrivateFromTooltip,
        previewConnectionProvider,
        selectConnectionProvider,
        previewOutboundTypeGroup,
        selectOutboundTypeGroup,
        previewConnectionDirection,
        selectConnectionDirection,
        selectOtherProviders,
        previewTooltipPeer,
        restoreTooltipPeerPreview,
        selectPrimaryTooltipPeer,
        selectSecondaryTooltipPeer,
        previewNavigationProvider,
        selectAllProviders,
        selectHeaderProviders,
    });
}
