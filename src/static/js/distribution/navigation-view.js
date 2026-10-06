import { query, queryAll } from '../core/dom.js';

/** @typedef {Pick<import('../types').DistributionNavigationOptions, 'getContainer' | 'getDonut' | 'getPanel' |
 * 'getSegments' | 'getTooltips' | 'getDashboard' | 'hooks' | 'state'> & { actions:
 * Pick<import('../types').DistributionNavigationOptions['actions'], 'animateDonutExpand' |
 * 'animateDonutRevert' | 'getActiveSegments' | 'getActiveTotalPeers' | 'getColorForActiveEntity' |
 * 'getColorForAsNum' | 'getPeerIdsForActiveEntity' | 'getPeerIdsForAnyAs' | 'isCountryLens' |
 * 'isOthersSubProvider' | 'renderCenter' | 'renderCountrySummaryPanel' | 'renderLegend' |
 * 'renderPanel' | 'renderSummaryPanel' | 'restoreInsightRectProvider' | 'showFocusedCenterText'> }} Options */
/** @typedef {Pick<import('../types').DistributionNavigation, 'backToOthersList' | 'closePeerPopup' |
 * 'isReconciling' | 'navigateBack' | 'navigateToProvider' | 'setLegendFocus'>} Transitions */

/** Owns navigation visuals, the Others popup, and temporary map previews.
 * @param {Options} options
 * @param {() => Transitions} getNavigation
 */
export function create(options, getNavigation) {
    let othersListOpen = false;

    function isOthersListOpen() {
        return othersListOpen;
    }

    /** Render the back button in the panel header (shown when history exists) */
    function renderBackButton() {
        const panelEl = options.getPanel();
        if (!panelEl) return;
        var existing = query('.as-detail-back', panelEl);
        if (options.state.panelHistory.length > 0) {
            if (!existing) {
                existing = document.createElement('button');
                existing.setAttribute('type', 'button');
                existing.className = 'as-detail-back';
                existing.title = 'Back';
                existing.setAttribute('aria-label', 'Back to distribution summary');
                existing.innerHTML = '\u2190'; // ← left arrow = back
                existing.addEventListener('click', function (e) {
                    e.stopPropagation();
                    getNavigation().navigateBack();
                });
                var headerInfo = query('.as-detail-header-info', panelEl);
                if (headerInfo) headerInfo.parentNode?.insertBefore(existing, headerInfo);
            }
            existing.style.display = '';
        } else {
            if (existing) existing.style.display = 'none';
        }
    }

    function clearLegendHoverActive() {
        options.getDonut().clearLegendHover();
    }

    /** Show scrollable Others provider list as a floating popup to the right of the donut.
     *  Each item is hoverable (preview lines) and clickable (opens provider panel). */
    function showOthersListInDonut() {
        const othersSeg = options.actions.getActiveSegments().find(function (s) {
            return s.isOthers;
        });
        if (!othersSeg || !othersSeg._othersGroups) return;

        othersListOpen = true;

        // Remove any existing popup
        var existing = document.getElementById('as-others-popup');
        if (existing) existing.remove();

        // Build popup container
        var popup = document.createElement('div');
        popup.id = 'as-others-popup';
        popup.className = 'as-others-popup';

        // Header
        var header = document.createElement('div');
        header.className = 'as-others-popup-header';
        header.textContent =
            'Others (' +
            othersSeg._othersGroups.length +
            (options.actions.isCountryLens() ? ' countries)' : ' providers)');
        popup.appendChild(header);

        // Scrollable list
        var listDiv = document.createElement('div');
        listDiv.className = 'as-others-popup-list';

        var groups = othersSeg._othersGroups;
        for (var i = 0; i < groups.length; i++) {
            (function (g) {
                var item = document.createElement('button');
                item.setAttribute('type', 'button');
                item.className = 'as-others-popup-item';
                var name = g.asShort || g.asName || g.asNumber;
                if (name.length > 24) name = name.substring(0, 23) + '\u2026';
                var nameSpan = document.createElement('span');
                nameSpan.className = 'as-others-popup-name';
                nameSpan.textContent = name;
                var countSpan = document.createElement('span');
                countSpan.className = 'as-others-popup-count';
                countSpan.textContent = String(g.peerCount);
                item.appendChild(nameSpan);
                item.appendChild(countSpan);
                item.title =
                    (options.actions.isCountryLens() ? g.countryCode || '' : g.asNumber) +
                    ' \u00b7 ' +
                    (g.asName || g.asShort || '') +
                    ' \u00b7 ' +
                    g.peerCount +
                    ' peer' +
                    (g.peerCount !== 1 ? 's' : '');

                // Hover: preview lines and donut center for this provider's peers
                item.addEventListener('mouseenter', function () {
                    if (options.hooks.drawLinesForAs)
                        options.hooks.drawLinesForAs(g.asNumber, g.peerIds, othersSeg.color);
                    if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(g.peerIds);
                    options.actions.showFocusedCenterText(g.asNumber);
                });
                item.dataset.as = g.asNumber;
                item.addEventListener('mouseleave', function () {
                    // Restore lines and donut center for current selection
                    if (options.state.selectedProvider === 'Others') {
                        if (options.hooks.drawLinesForAs)
                            options.hooks.drawLinesForAs('Others', othersSeg.peerIds, othersSeg.color);
                        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(othersSeg.peerIds);
                        options.actions.showFocusedCenterText('Others');
                    } else if (
                        options.state.selectedProvider &&
                        options.actions.isOthersSubProvider(options.state.selectedProvider)
                    ) {
                        // Restore selected sub-provider's lines
                        var peerIds = options.actions.getPeerIdsForAnyAs(options.state.selectedProvider);
                        var color = options.actions.getColorForAsNum(options.state.selectedProvider);
                        if (options.hooks.drawLinesForAs)
                            options.hooks.drawLinesForAs(options.state.selectedProvider, peerIds, color);
                        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
                        options.actions.showFocusedCenterText(options.state.selectedProvider);
                    } else {
                        activateHoverAll();
                        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
                        options.actions.renderCenter();
                    }
                });

                // Click: toggle or navigate to this provider's panel
                item.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (options.state.selectedProvider === g.asNumber) {
                        // Toggle off — go back to Others list
                        getNavigation().backToOthersList();
                    } else {
                        if (options.actions.isCountryLens()) {
                            options.state.selectedProvider = g.asNumber;
                            openPanel(g.asNumber);
                            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(g.peerIds);
                            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(g.peerIds);
                            if (options.hooks.drawLinesForAs)
                                options.hooks.drawLinesForAs(g.asNumber, g.peerIds, othersSeg.color);
                            options.actions.renderCenter();
                            options.actions.renderLegend();
                        } else {
                            // Select this sub-provider (keep popup open)
                            getNavigation().navigateToProvider(g.asNumber);
                        }
                        options.actions.animateDonutExpand(g.asNumber);
                        updateOthersPopupHighlight();
                    }
                });

                listDiv.appendChild(item);
            })(groups[i]);
        }

        popup.appendChild(listDiv);

        // Position next to the donut wrap
        if (!options.getDonut().appendToWrap(popup)) {
            document.body.appendChild(popup);
        }
    }

    /** Close the Others popup list */
    function closeOthersListInDonut() {
        othersListOpen = false;
        var popup = document.getElementById('as-others-popup');
        if (popup) popup.remove();
    }

    /** Update the selected highlight on Others popup items */
    function updateOthersPopupHighlight() {
        var popup = document.getElementById('as-others-popup');
        if (!popup) return;
        var items = queryAll('.as-others-popup-item', popup);
        for (var i = 0; i < items.length; i++) {
            if (items[i].dataset.as === options.state.selectedProvider) {
                items[i].classList.add('as-others-popup-selected');
            } else {
                items[i].classList.remove('as-others-popup-selected');
            }
        }
    }

    /** Activate hover-all visual state: highlight all segments + draw all lines */
    function activateHoverAll() {
        const containerEl = options.getContainer();
        if (containerEl) containerEl.classList.add('as-all-hovered');
        if (containerEl) containerEl.classList.add('as-legend-visible');
        // Build groups array and draw all lines
        var segments = options.actions.getActiveSegments();
        if (options.hooks.drawLinesForAllAs && segments.length > 0) {
            var groups = [];
            for (var i = 0; i < segments.length; i++) {
                var seg = segments[i];
                if (seg.peerIds && seg.peerIds.length > 0) {
                    groups.push({ asNum: seg.asNumber, peerIds: seg.peerIds, color: seg.color });
                }
            }
            options.hooks.drawLinesForAllAs(groups);
        }
    }

    /** Deactivate hover-all visual state */
    function deactivateHoverAll() {
        const containerEl = options.getContainer();
        if (containerEl) containerEl.classList.remove('as-all-hovered');
        if (containerEl) containerEl.classList.remove('as-legend-visible');
        if (options.hooks.clearAsLines) options.hooks.clearAsLines();
    }

    function summaryOpenLensSummaryPanel() {
        if (options.actions.isCountryLens()) summaryOpenCountrySummaryPanel();
        else summaryOpenSummaryPanel();
    }

    function summaryOpenCountrySummaryPanel() {
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) getNavigation().closePeerPopup();
        options.actions.renderCountrySummaryPanel();
    }

    function summaryOpenSummaryPanel() {
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) getNavigation().closePeerPopup();
        options.actions.renderSummaryPanel();
    }

    /** @param {string} asNum */
    function openPanel(asNum) {
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) getNavigation().closePeerPopup();
        options.actions.renderPanel(asNum);
    }

    function summaryRestoreDonutAfterPreview() {
        options.state.summaryPreviewPeerIds = null;
        options.state.summaryPreviewLabel = null;
        if (!options.state.donutFocused) return;
        if (options.state.subSubFilterProvider && options.state.subSubTooltipPinned) {
            // A Level 3 provider is selected (sub-sub pinned) — keep donut on that provider
            options.actions.showFocusedCenterText(options.state.subSubFilterProvider);
            options.actions.animateDonutExpand(options.state.subSubFilterProvider);
        } else if (options.state.insightActiveAsNum) {
            // An insight is active (Most Stable, Fastest, etc.) — keep donut on that provider
            if (options.getDonut().isInsightVisible()) {
                options.actions.restoreInsightRectProvider();
            }
            options.actions.showFocusedCenterText(options.state.insightActiveAsNum);
            options.actions.animateDonutExpand(options.state.insightActiveAsNum);
        } else if (
            options.state.filterCategory &&
            options.state.filterCategory.indexOf('conn-') === 0 &&
            options.state.filterLabel
        ) {
            // A conn-provider/conn-out/conn-in sub-filter is active — keep donut on that
            options.actions.showFocusedCenterText(options.state.filterLabel);
            options.actions.animateDonutExpand(options.state.filterLabel);
        } else if (
            options.state.filterPeerIds &&
            options.state.filterLabel &&
            options.state.filterCategory === 'summary'
        ) {
            // A summary category sub-filter is active (IPv4, etc.) — show category info
            options.actions.animateDonutRevert();
            options.actions.renderCenter();
        } else {
            // No active sub-filter — revert to default
            options.actions.animateDonutRevert();
            options.actions.renderCenter();
        }
    }

    /** @param {number[]} peerIds */
    function summaryPreviewSummaryLines(peerIds) {
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
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
    }

    /** @param {number[]} peerIds */
    function summaryPreviewProviderLines(peerIds) {
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        if (options.state.selectedProvider && options.hooks.drawLinesForAs) {
            var color = options.actions.getColorForActiveEntity(options.state.selectedProvider);
            options.hooks.drawLinesForAs(options.state.selectedProvider, peerIds, color);
        }
    }

    /** @param {number[]} peerIds
     * @param {string} label */
    function summaryPreviewSummaryCenterText(peerIds, label) {
        if (!options.state.donutFocused) return;
        options.state.summaryPreviewPeerIds = peerIds;
        options.state.summaryPreviewLabel = label;
        options.getDonut().renderFilterCenter(peerIds.length, label, options.getDashboard().peers.length, 'connected peers');
    }

    function summaryRestoreSummaryFromPreview() {
        // Don't restore if big peer popup is active — it manages its own line state
        if (options.state.peerDetailActive) return;
        if (options.state.subSubFilterPeerIds && options.state.subSubFilterProvider) {
            // Was showing sub-sub (e.g. a specific provider within a category)
            var ssColor =
                options.state.subSubFilterColor || options.actions.getColorForAsNum(options.state.subSubFilterProvider);
            if (options.hooks.drawLinesForAs)
                options.hooks.drawLinesForAs(
                    options.state.subSubFilterProvider,
                    options.state.subSubFilterPeerIds,
                    ssColor
                );
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(options.state.subSubFilterPeerIds);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(options.state.subSubFilterPeerIds);
        } else if (options.state.filterPeerIds !== null) {
            // Was showing a category filter (e.g. IPv6)
            summaryPreviewSummaryLines(options.state.filterPeerIds);
        } else if (
            options.state.subTooltipPinned &&
            (options.state.filterCategory === 'insight-fastest' ||
                (options.state.filterCategory && options.state.filterCategory.indexOf('insight-data-') === 0))
        ) {
            // Rank list pinned — default to showing #1 ranked provider
            const firstRow = options.getTooltips().getRankedProvider();
            if (firstRow) {
                if (firstRow) {
                    var asNum = firstRow.asNumber;
                    /** @type {number[]} */
                    var peerIds = firstRow.peerIds;
                    if (asNum) getNavigation().setLegendFocus(asNum);
                    if (peerIds.length > 0 && options.hooks.drawLinesForAs && asNum) {
                        options.hooks.drawLinesForAs(asNum, peerIds, options.actions.getColorForAsNum(asNum));
                    }
                    if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
                    if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
                    if (options.state.donutFocused && asNum && options.getDonut().isInsightVisible()) {
                        options.actions.restoreInsightRectProvider();
                    } else if (options.state.donutFocused && asNum) {
                        options.actions.showFocusedCenterText(asNum);
                        options.actions.animateDonutExpand(asNum);
                    }
                    return;
                }
            }
            // Fallback: show all
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            activateHoverAll();
        } else if (options.state.insightActiveAsNum) {
            // Insight is active (e.g. Most Stable clicked) — restore to showing the insight's provider
            var asNum = options.state.insightActiveAsNum;
            var peerIds = options.actions.getPeerIdsForAnyAs(asNum);
            var color = options.actions.getColorForAsNum(asNum);
            if (asNum) getNavigation().setLegendFocus(asNum);
            if (peerIds.length > 0 && options.hooks.drawLinesForAs) {
                options.hooks.drawLinesForAs(asNum, peerIds, color);
            }
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
            if (options.state.donutFocused && options.getDonut().isInsightVisible()) {
                options.actions.restoreInsightRectProvider();
            } else if (options.state.donutFocused) {
                options.actions.showFocusedCenterText(asNum);
                options.actions.animateDonutExpand(asNum);
            }
        } else {
            // No filter — show all
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            activateHoverAll();
        }
    }

    function summaryRestoreProviderFromPreview() {
        // Don't restore if big peer popup is active — it manages its own line state
        if (options.state.peerDetailActive) return;
        if (options.state.filterPeerIds !== null) {
            summaryPreviewProviderLines(options.state.filterPeerIds);
        } else if (options.state.selectedProvider) {
            var allPeerIds = options.actions.getPeerIdsForActiveEntity(options.state.selectedProvider);
            var color = options.actions.getColorForActiveEntity(options.state.selectedProvider);
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(allPeerIds);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(allPeerIds);
            if (options.hooks.drawLinesForAs)
                options.hooks.drawLinesForAs(options.state.selectedProvider, allPeerIds, color);
        }
    }

    return Object.freeze({
        isOthersListOpen,
        renderBackButton,
        clearLegendHoverActive,
        showOthersListInDonut,
        closeOthersListInDonut,
        updateOthersPopupHighlight,
        activateHoverAll,
        deactivateHoverAll,
        summaryOpenLensSummaryPanel,
        summaryOpenCountrySummaryPanel,
        summaryOpenSummaryPanel,
        openPanel,
        summaryRestoreDonutAfterPreview,
        summaryPreviewSummaryLines,
        summaryPreviewProviderLines,
        summaryPreviewSummaryCenterText,
        summaryRestoreSummaryFromPreview,
        summaryRestoreProviderFromPreview,
    });
}
