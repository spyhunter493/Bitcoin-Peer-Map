import { query, queryAll, required } from '../core/dom.js';
import * as BPMDomState from '../core/dom-state.js';
import * as BPMPeerFilters from '../peers/filters.js';
import * as BPMDistributionData from './data.js';
/** @param {import('../types').DistributionNavigationOptions} options */
export function create(options) {
    let reconciling = false;
    let othersListOpen = false;
    function isReconciling() {
        return reconciling;
    }
    function isOthersListOpen() {
        return othersListOpen;
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
    function closeActiveInsight() {
        options.actions.hideInsightRect();
        options.state.insightActiveAsNum = null;
        options.state.insightActiveData = null;
        options.state.insightActiveType = null;
        options.actions.animateDonutRevert();
        options.actions.renderCenter();
        if (options.state.summarySelected) summaryClearSummarySubFilter();
    }

    /** @param {string} asNum */
    function setLegendFocus(asNum) {
        if (options.state.legendFocusProvider === asNum) return;
        options.state.legendFocusProvider = asNum;
        options.actions.renderLegend();
    }

    function clearLegendFocus() {
        if (!options.state.legendFocusProvider) return;
        if (options.state.subSubTooltipPinned) return;
        options.state.legendFocusProvider = null;
        options.actions.renderLegend();
    }

    // ═══════════════════════════════════════════════════════════
    // SUMMARY STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /** Select the Summary Analysis view */
    function selectSummary() {
        if (options.state.selectedProvider) deselect();
        options.state.summarySelected = true;
        options.state.hoveringAll = false;

        // Draw all lines (persistent)
        activateHoverAll();

        // Open the summary panel
        summaryOpenLensSummaryPanel();

        // Update donut center to show SUMMARY ANALYSIS as active
        options.actions.renderCenter();
    }

    /** Deselect the Summary Analysis view */
    function deselectSummary() {
        if (!options.state.summarySelected) return;
        options.state.summarySelected = false;
        options.state.panelHistory = [];
        options.state.filterPeerIds = null;
        options.state.filterLabel = null;
        options.state.filterCategory = null;
        options.state.insightActiveAsNum = null;
        options.state.insightActiveData = null;
        options.state.insightActiveType = null;
        options.actions.tooltipHideSubTooltip();
        options.actions.tooltipHideSubSubTooltip();
        options.actions.hideInsightRect();
        options.actions.closePanel();
        deactivateHoverAll();
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
        options.actions.renderCenter();
    }

    /** Navigate to a provider's panel (with back button to return)
     * @param {string} asNum */
    function navigateToProvider(asNum) {
        const panelEl = options.getPanel();
        const containerEl = options.getContainer();
        // Close any open map peer tooltip when navigating
        if (options.hooks.hideMapTooltip) options.hooks.hideMapTooltip();

        // Save current panel state to history
        var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
        var scrollTop = bodyEl ? bodyEl.scrollTop : 0;

        if (options.state.summarySelected) {
            options.state.panelHistory.push({ type: 'summary', scrollTop: scrollTop });
            options.state.summarySelected = false;
        } else if (options.state.selectedProvider) {
            options.state.panelHistory.push({
                type: 'provider',
                asNumber: options.state.selectedProvider,
                scrollTop: scrollTop,
            });
        }

        // Clear sub-filters and tooltips
        options.state.filterPeerIds = null;
        options.state.filterLabel = null;
        options.state.filterCategory = null;
        options.actions.tooltipHideSubTooltip();
        options.actions.tooltipHideSubSubTooltip();

        // Navigate to provider panel
        options.state.selectedProvider = asNum;
        openPanel(asNum);

        // Draw lines for this provider
        var peerIds = options.actions.getPeerIdsForAnyAs(asNum);
        var color = options.actions.getColorForAsNum(asNum);
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs(asNum, peerIds, color);

        // Animate donut to expand this provider's segment
        options.actions.animateDonutExpand(asNum);

        if (containerEl) containerEl.classList.add('as-legend-visible');
        options.actions.renderCenter();
        options.actions.renderLegend();
        // Zoom map out to world view when navigating to a new provider
        if (options.hooks.resetMapZoom) options.hooks.resetMapZoom();
    }

    /** Navigate back — always returns to distribution summary */
    function navigateBack() {
        // Close any open map peer tooltip when navigating back
        if (options.hooks.hideMapTooltip) options.hooks.hideMapTooltip();

        // Close Others popup if open
        if (othersListOpen) closeOthersListInDonut();

        // Always go back to distribution summary (clear all state)
        options.state.activeNetwork = null;
        dismissPeerDetailView(false);
        options.state.selectedProvider = null;
        options.state.filterPeerIds = null;
        options.state.filterLabel = null;
        options.state.filterCategory = null;
        options.state.insightActiveAsNum = null;
        options.state.insightActiveData = null;
        options.state.insightActiveType = null;
        options.state.panelHistory = [];
        options.actions.tooltipHideSubTooltip();
        options.actions.tooltipHideSubSubTooltip();
        options.actions.hideInsightRect();

        if (options.state.donutFocused) {
            options.state.summarySelected = true;
            summaryOpenLensSummaryPanel();
            options.actions.animateDonutRevert();
            activateHoverAll();
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            options.actions.renderCenter();
            options.actions.renderLegend();
            if (options.hooks.resetMapZoom) options.hooks.resetMapZoom();
        } else {
            // Not in focused mode — exit fully
            deselect();
        }
    }

    /** Render the back button in the panel header (shown when history exists) */
    function renderBackButton() {
        const panelEl = options.getPanel();
        if (!panelEl) return;
        var existing = query('.as-detail-back', panelEl);
        if (options.state.panelHistory.length > 0) {
            if (!existing) {
                existing = document.createElement('button');
                existing.className = 'as-detail-back';
                existing.title = 'Back';
                existing.innerHTML = '\u2190'; // ← left arrow = back
                existing.addEventListener('click', function (e) {
                    e.stopPropagation();
                    navigateBack();
                });
                var headerInfo = query('.as-detail-header-info', panelEl);
                if (headerInfo) headerInfo.parentNode?.insertBefore(existing, headerInfo);
            }
            existing.style.display = '';
        } else {
            if (existing) existing.style.display = 'none';
        }
    }

    /** Handle map click — gradual collapse:
     *  In focused mode:
     *    1st click: close sub-panels, back to panel top level
     *    2nd click: exit focused mode entirely
     *  In default mode:
     *    1st click: close sub-panels
     *    2nd click: close main panel */
    function onMapClick() {
        const panelEl = options.getPanel();
        // Stage 0: If a network panel (IPv4/IPv6) is open, close it and return to summary
        if (options.state.activeNetwork) {
            options.state.activeNetwork = null;
            options.state.selectedProvider = null;
            // If sub-tooltips are open, close those first
            if (options.state.subTooltipPinned || options.state.subSubTooltipPinned) {
                options.actions.tooltipHideSubTooltip();
                options.actions.tooltipHideSubSubTooltip();
                options.state.filterPeerIds = null;
                options.state.filterLabel = null;
                options.state.filterCategory = null;
            }
            // Return to summary view
            options.state.summarySelected = true;
            options.state.panelHistory = [];
            summaryOpenLensSummaryPanel();
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            activateHoverAll();
            options.actions.renderDonut();
            options.actions.renderCenter();
            options.actions.renderLegend();
            return true;
        }

        // Stage 1: If peer detail popup is active, close it (and any sub-tooltips) in one click
        if (options.state.peerDetailActive) {
            closePeerPopup();
            return true;
        }

        // Stage 1.5: If sub-tooltips are visible, close them
        if (options.state.subTooltipPinned || options.state.subSubTooltipPinned) {
            options.actions.tooltipHideSubTooltip();
            options.actions.tooltipHideSubSubTooltip();
            // Restore to main state (summary or single AS)
            if (options.state.summarySelected) {
                options.state.filterPeerIds = null;
                options.state.filterLabel = null;
                options.state.filterCategory = null;
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
                activateHoverAll();
                // Remove active highlights
                var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
                if (bodyEl) {
                    var rows = queryAll('.sub-filter-active', bodyEl);
                    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
                }
                // Revert donut expansion and center text (conn-provider sub-filter
                // may have expanded a segment and shown provider name in center)
                options.actions.animateDonutRevert();
                options.actions.renderCenter();
                options.actions.renderLegend();
            } else if (options.state.selectedProvider) {
                summaryClearSubFilter();
            }
            return true; // handled — don't close main panel
        }

        // Stage 2: If in a provider view, go back to summary
        if (options.state.selectedProvider) {
            if (options.state.donutFocused) {
                // In focused mode, go back to summary instead of closing
                if (othersListOpen) closeOthersListInDonut();
                options.state.panelHistory = [];
                options.state.selectedProvider = null;
                options.state.hoveredProvider = null;
                options.actions.animateDonutRevert();
                options.actions.renderCenter();
                options.actions.renderLegend();
                selectSummary();
                return true;
            }
            options.state.panelHistory = [];
            deselect();
            return true;
        }

        // Stage 3: Close summary / exit focused mode
        if (options.state.summarySelected) {
            if (options.state.donutFocused) {
                exitFocusedMode();
            } else {
                deselectSummary();
            }
            return true;
        }

        // Stage 4: If just in focused mode with nothing selected, exit it
        if (options.state.donutFocused) {
            exitFocusedMode();
            return true;
        }

        return false;
    }

    /** Go back from an Others sub-provider to the Others segment with popup open */
    function backToOthersList() {
        const othersSeg = options.actions.getActiveSegments().find(function (s) {
            return s.isOthers;
        });
        if (!othersSeg) return;
        // Clear sub-filters
        options.state.filterPeerIds = null;
        options.state.filterLabel = null;
        options.state.filterCategory = null;
        options.actions.tooltipHideSubTooltip();
        // Select the Others segment
        options.state.selectedProvider = 'Others';
        openPanel('Others');
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(othersSeg.peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(othersSeg.peerIds);
        if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs('Others', othersSeg.peerIds, othersSeg.color);
        options.actions.animateDonutExpand('Others');
        options.actions.renderCenter();
        options.actions.renderLegend();
        // Re-open the popup list
        showOthersListInDonut();
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
                var item = document.createElement('div');
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
                        backToOthersList();
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
                            navigateToProvider(g.asNumber);
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

    // ═══════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════

    /** @param {MouseEvent} e */
    function onSegmentHover(e) {
        const containerEl = options.getContainer();
        var asNum = e.currentTarget instanceof Element ? e.currentTarget.getAttribute('data-as') || '' : '';
        if (!asNum) return;
        // Don't show AS hover tooltip when a sub-tooltip is pinned or peer detail is active
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        options.state.hoveredProvider = asNum;
        // No floating tooltip — legend highlighting replaces it
        options.actions.highlightLegendItem(asNum);

        // In focused mode, show provider name in donut center on hover
        if (options.state.donutFocused && !options.state.selectedProvider) {
            options.state.focusedHoverProvider = asNum;
            options.actions.showFocusedCenterText(asNum);
        }

        // When legends are hidden (not focused), show provider info in donut center
        if (options.areLegendsHidden() && !options.state.donutFocused && !options.state.selectedProvider) {
            options.state.focusedHoverProvider = asNum;
            options.actions.showLegendHoverCenterText(asNum);
        }

        // Temporarily remove all-hovered highlight so only this segment is bright
        if ((options.state.hoveringAll || options.state.summarySelected) && containerEl) {
            containerEl.classList.remove('as-all-hovered');
        }

        // Draw hover lines if nothing is selected, or if summary is selected (temporary override)
        if (!options.state.selectedProvider) {
            var seg = options.actions.findActiveSegment(asNum);
            if (seg && options.hooks.drawLinesForAs && options.state.selectedProvider) {
                options.hooks.drawLinesForAs(asNum, seg.peerIds, seg.color);
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(seg.peerIds);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(seg.peerIds);
            }
        }
    }

    function onSegmentLeave() {
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        options.state.hoveredProvider = null;
        options.actions.clearLegendHighlight();

        // In focused mode, restore center text to default score display
        if (options.state.donutFocused && !options.state.selectedProvider) {
            options.state.focusedHoverProvider = null;
            options.actions.renderCenter();
        }

        // When legends are hidden (not focused), restore default center text
        if (options.areLegendsHidden() && !options.state.donutFocused && !options.state.selectedProvider) {
            options.state.focusedHoverProvider = null;
            clearLegendHoverActive();
            options.actions.renderCenter();
        }

        // If there's an active sub-filter, restore to that instead of showing all
        if (options.state.summarySelected && options.state.filterPeerIds !== null && !options.state.selectedProvider) {
            summaryRestoreSummaryFromPreview();
            return;
        }

        // If distributionState.hoveringAll or distributionState.summarySelected is active, restore all-lines state
        if ((options.state.hoveringAll || options.state.summarySelected) && !options.state.selectedProvider) {
            activateHoverAll();
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            return;
        }

        // ONLY clear lines if nothing is selected — selection keeps its lines
        if (!options.state.selectedProvider) {
            if (options.hooks.clearAsLines) options.hooks.clearAsLines();
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
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

    function onTitleEnter() {
        if (options.state.selectedProvider || options.state.summarySelected) return; // Don't override an active selection or summary
        options.state.hoveringAll = true;
        activateHoverAll();
    }

    function onTitleLeave() {
        if (!options.state.hoveringAll || options.state.summarySelected) return;
        options.state.hoveringAll = false;
        deactivateHoverAll();
    }

    /** @param {MouseEvent} e */
    function onSegmentClick(e) {
        const containerEl = options.getContainer();
        var asNum = e.currentTarget instanceof Element ? e.currentTarget.getAttribute('data-as') || '' : '';
        if (!asNum) return;

        // Close peer detail popup if open (user clicked a different segment)
        // Skip zoom reset — the segment view will set its own lines/filters
        if (options.state.peerDetailActive) {
            closePeerPopup(true);
        }

        // Auto-enter focused mode if not already
        if (!options.state.donutFocused) {
            options.state.donutFocused = true;
            document.body.classList.add('donut-focused');
        }

        // If summary is active, close it and select this AS
        if (options.state.summarySelected) {
            deselectSummary();
        }

        if (options.state.selectedProvider === asNum) {
            // Deselect — go back to summary in focused mode
            if (options.state.donutFocused) {
                if (othersListOpen) closeOthersListInDonut();
                options.state.selectedProvider = null;
                options.state.filterPeerIds = null;
                options.state.filterLabel = null;
                options.state.filterCategory = null;
                options.actions.tooltipHideSubTooltip();
                options.actions.closePanel();
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
                options.actions.animateDonutRevert();
                selectSummary();
                options.actions.renderCenter();
                options.actions.renderLegend();
            } else {
                options.actions.animateDonutRevert();
                deselect();
            }
        } else {
            // Select this AS — clear any sub-filter from previous selection
            options.state.filterPeerIds = null;
            options.state.filterLabel = null;
            options.state.filterCategory = null;
            options.actions.tooltipHideSubTooltip();
            if (othersListOpen) closeOthersListInDonut();
            options.state.selectedProvider = asNum;
            var seg = options.actions.findActiveSegment(asNum);
            if (seg) {
                openPanel(asNum);
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(seg.peerIds);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(seg.peerIds);
                if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs(asNum, seg.peerIds, seg.color);

                // In focused mode, Others segment shows scrollable provider list inside donut
                if (options.state.donutFocused && seg.isOthers) {
                    showOthersListInDonut();
                }
            }
            // Animate donut expansion
            options.actions.animateDonutExpand(asNum);
            // Keep legend visible while selected
            if (containerEl) containerEl.classList.add('as-legend-visible');
            options.actions.renderCenter();
            options.actions.renderLegend();
            // Zoom map out to world view when selecting a new provider
            if (options.hooks.resetMapZoom) options.hooks.resetMapZoom();
        }
    }

    function deselect() {
        const containerEl = options.getContainer();
        options.state.activeNetwork = null;
        if (options.state.summarySelected) {
            deselectSummary();
            return;
        }
        dismissPeerDetailView(false);
        options.state.selectedProvider = null;
        options.state.filterPeerIds = null;
        options.state.filterLabel = null;
        options.state.filterCategory = null;
        if (othersListOpen) closeOthersListInDonut();
        options.actions.tooltipHideSubTooltip();
        options.actions.hideInsightRect();
        options.actions.closePanel();
        if (containerEl) containerEl.classList.remove('as-legend-visible');
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
        if (options.hooks.clearAsLines) options.hooks.clearAsLines();
        if (
            options.getDonut().getAnimationState() !== 'idle' &&
            options.getDonut().getAnimationState() !== 'reverting'
        ) {
            options.actions.animateDonutRevert();
        } else {
            options.actions.renderDonut();
        }
        options.actions.renderCenter();
        options.actions.renderLegend();
    }

    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
        if (e.key === 'Escape') {
            // The shared modal controller owns Escape while a peer action dialog is open.
            if (document.getElementById('disconnect-dialog')) return;
            // Close peer popup first
            if (options.state.peerDetailActive && options.getPeerDetail().isOpen()) {
                closePeerPopup();
                return;
            }
            if (options.state.subSubTooltipPinned) {
                options.actions.tooltipHideSubSubTooltip();
                // Restore to parent sub-filter state
                if (options.state.summarySelected && options.state.filterPeerIds !== null) {
                    if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(options.state.filterPeerIds);
                    if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(options.state.filterPeerIds);
                    // Re-draw lines for the parent sub-filter (not all lines)
                    if (options.hooks.drawLinesForAllAs && options.getSegments().length > 0) {
                        /** @type {Record<number, boolean>} */
                        var idSet = {};
                        for (var i = 0; i < options.state.filterPeerIds.length; i++)
                            idSet[options.state.filterPeerIds[i]] = true;
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
                } else if (options.state.summarySelected) {
                    if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
                    if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
                    activateHoverAll();
                }
                return;
            }
            if (options.state.subTooltipPinned) {
                options.actions.tooltipHideSubTooltip();
                // Restore to full summary or AS state
                if (options.state.summarySelected) {
                    summaryClearSummarySubFilter();
                } else if (options.state.selectedProvider) {
                    summaryClearSubFilter();
                }
                return;
            }
            // If a network panel is open, Escape goes back to summary
            if (options.state.activeNetwork) {
                options.state.activeNetwork = null;
                options.state.selectedProvider = null;
                if (options.state.subTooltipPinned || options.state.subSubTooltipPinned) {
                    options.actions.tooltipHideSubTooltip();
                    options.actions.tooltipHideSubSubTooltip();
                    options.state.filterPeerIds = null;
                    options.state.filterLabel = null;
                    options.state.filterCategory = null;
                }
                options.state.summarySelected = true;
                options.state.panelHistory = [];
                summaryOpenLensSummaryPanel();
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
                activateHoverAll();
                options.actions.renderDonut();
                options.actions.renderCenter();
                options.actions.renderLegend();
                return;
            }
            if (options.state.summarySelected) {
                if (options.state.donutFocused) {
                    exitFocusedMode();
                } else {
                    deselectSummary();
                }
                return;
            }
            if (options.state.selectedProvider) {
                deselect();
                return;
            }
            if (options.state.donutFocused) {
                exitFocusedMode();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FOCUSED MODE — Donut moves to top-center, layout rearranges
    // ═══════════════════════════════════════════════════════════

    /** Enter focused mode: move the donut to the top-center */
    function enterFocusedMode() {
        if (options.state.donutFocused) return;
        options.state.donutFocused = true;
        document.body.classList.add('donut-focused');

        // Hide the legend (top 8 list) — it only shows in default mode or on interaction
        var legend = options.getDonut().getLegendElement();
        if (legend) {
            legend.style.display = '';
        }

        // Activate hover-all to show lines from donut center in focused mode
        options.state.hoveringAll = false;
        activateHoverAll();

        // Open summary panel automatically
        selectSummary();
    }

    /** Exit focused mode: everything returns to default positions */
    function exitFocusedMode() {
        if (!options.state.donutFocused) return;
        options.state.donutFocused = false;
        options.state.focusedHoverProvider = null;
        dismissPeerDetailView(false);
        options.state.activeNetwork = null;
        if (othersListOpen) closeOthersListInDonut();
        document.body.classList.remove('donut-focused');

        // Revert donut animation
        options.actions.stopDonutAnimation();
        options.actions.hideInsightRect();

        // Deselect everything
        if (options.state.summarySelected) deselectSummary();
        else if (options.state.selectedProvider) deselect();
        else options.actions.closePanel(); // Network panel or other non-summary/non-AS state
        options.state.hoveringAll = false;
        deactivateHoverAll();
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
        if (options.hooks.clearAsLines) options.hooks.clearAsLines();

        // Auto zoom-out to default map view
        if (options.hooks.resetMapZoom) options.hooks.resetMapZoom();

        // Reset center display
        options.actions.renderDonut();
        options.actions.renderCenter();
        options.actions.renderLegend();
    }

    /** Check if focused mode is active */
    function isFocusedMode() {
        return options.state.donutFocused;
    }

    /** @param {boolean} [restoreFocus] */
    function dismissPeerDetailView(restoreFocus) {
        options.state.peerDetailActive = false;
        options.state.selectedPeerId = null;
        options.getPeerDetail().close({ restoreFocus: restoreFocus !== false });
    }

    /** @param {import('../types').Peer} peer */
    function previewPeerInPopup(peer) {
        if (options.state.peerDetailActive) options.getPeerDetail().previewPeer(peer);
    }

    function restorePeerPopupToSelected() {
        options.getPeerDetail().restorePreview();
    }

    /** @param {boolean} [skipZoomReset] */
    function closePeerPopup(skipZoomReset) {
        dismissPeerDetailView(!skipZoomReset);

        if (options.state.summarySelected) {
            if (options.state.insightActiveAsNum) {
                var peerIds = options.actions.getPeerIdsForAnyAs(options.state.insightActiveAsNum);
                var color = options.actions.getColorForAsNum(options.state.insightActiveAsNum);
                if (options.hooks.drawLinesForAs)
                    options.hooks.drawLinesForAs(options.state.insightActiveAsNum, peerIds, color);
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
            } else if (options.state.filterPeerIds !== null) {
                summaryPreviewSummaryLines(options.state.filterPeerIds);
            } else {
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
                activateHoverAll();
            }
            options.actions.renderCenter();
        } else if (options.state.selectedProvider) {
            var seg = options.getSegments().find(function (item) {
                return item.asNumber === options.state.selectedProvider;
            });
            if (!seg) {
                var group = options.getGroups().find(function (item) {
                    return item.asNumber === options.state.selectedProvider;
                });
                if (group) {
                    var others = options.getSegments().find(function (item) {
                        return item.isOthers;
                    });
                    seg = {
                        ...group,
                        asNumber: options.state.selectedProvider,
                        peerIds: group.peerIds,
                        color: others ? others.color : '#58a6ff',
                    };
                }
            }
            if (seg) {
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(seg.peerIds);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(seg.peerIds);
                if (options.hooks.drawLinesForAs)
                    options.hooks.drawLinesForAs(options.state.selectedProvider, seg.peerIds, seg.color);
            }
            options.actions.renderCenter();
        } else {
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.hooks.clearAsLines) options.hooks.clearAsLines();
            options.actions.renderCenter();
        }

        if (!skipZoomReset && options.hooks.resetMapZoom) {
            options.hooks.resetMapZoom();
        } else if (skipZoomReset && options.hooks.clearPeerSelection) {
            options.hooks.clearPeerSelection();
        }
        options.getTooltips().clearPeerHighlight();
    }

    /** @param {number[]} peerIds */
    function openMultiPeerPopup(peerIds) {
        options.state.peerDetailActive = true;
        options.state.selectedPeerId = null;
        options.getPeerDetail().openGroup(peerIds);
    }

    /** @param {import('../types').Peer} peer
     * @param {string} source
     * @param {number[]} [groupPeerIds] */
    function openPeerDetailPanel(peer, source, groupPeerIds) {
        options.state.peerDetailActive = true;
        options.state.selectedPeerId = peer.id;

        var asNum = BPMDistributionData.parseAsNumber(peer.as);
        var provColor = asNum ? options.actions.getColorForAsNum(asNum) : '#6e7681';
        if (!options.state.donutFocused) {
            options.state.donutFocused = true;
            document.body.classList.add('donut-focused');
            if (!options.state.summarySelected && !options.state.selectedProvider) selectSummary();
            options.state.peerDetailActive = true;
            options.state.selectedPeerId = peer.id;
        }

        if (options.hooks.drawLinesForAs && asNum) options.hooks.drawLinesForAs(asNum, [peer.id], provColor);
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable([peer.id]);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers([peer.id]);
        options.actions.showPeerInDonutCenter(peer, provColor);
        if (groupPeerIds) options.getPeerDetail().openGroup(groupPeerIds);
        options.getPeerDetail().openPeer(peer.id, source);
    }

    function clearSelectionForLensSwitch() {
        const containerEl = options.getContainer();
        options.state.selectedProvider = null;
        options.state.hoveredProvider = null;
        options.state.hoveringAll = false;
        options.state.focusedHoverProvider = null;
        options.state.summarySelected = false;
        options.state.activeNetwork = null;
        options.state.legendFocusProvider = null;
        options.state.panelHistory = [];
        options.state.filterPeerIds = null;
        options.state.filterLabel = null;
        options.state.filterCategory = null;
        options.state.insightActiveAsNum = null;
        options.state.insightActiveData = null;
        options.state.insightActiveType = null;
        dismissPeerDetailView(false);
        if (othersListOpen) closeOthersListInDonut();
        options.actions.tooltipHideSubTooltip();
        options.actions.tooltipHideSubSubTooltip();
        options.actions.hideInsightRect();
        options.actions.closePanel();
        deactivateHoverAll();
        options.actions.stopDonutAnimation();
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
        if (options.hooks.clearAsLines) options.hooks.clearAsLines();
        if (containerEl) containerEl.classList.remove('as-legend-visible');
    }

    /**
     * @param {string} lens
     */
    function setDistributionLens(lens) {
        if (lens !== 'provider' && lens !== 'country') return;
        if (options.state.lens === lens) return;
        var wasFocused = options.state.donutFocused;
        clearSelectionForLensSwitch();
        options.state.lens = lens;
        options.actions.updateLensChrome();
        options.actions.renderDonut();
        options.actions.renderCenter();
        options.actions.renderLegend();
        if (wasFocused) {
            selectSummary();
            options.actions.renderLegend();
        }
    }

    function summaryOpenLensSummaryPanel() {
        if (options.actions.isCountryLens()) summaryOpenCountrySummaryPanel();
        else summaryOpenSummaryPanel();
    }

    function summaryOpenCountrySummaryPanel() {
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
        options.actions.renderCountrySummaryPanel();
    }

    function summaryOpenSummaryPanel() {
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
        options.actions.renderSummaryPanel();
    }

    /** @param {string} asNum */
    function openPanel(asNum) {
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
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
        options.getDonut().renderFilterCenter(peerIds.length, label, options.actions.getActiveTotalPeers());
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
                    if (asNum) setLegendFocus(asNum);
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
            if (asNum) setLegendFocus(asNum);
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

    /** @param {number[]} peerIds
     * @param {string} label */
    function summaryApplySummarySubFilter(peerIds, label) {
        // Close peer detail popup when selecting from panel
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
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
        if (options.state.summarySelected) activateHoverAll();
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
                if (scope.length) openPanel(options.state.selectedProvider);
                else {
                    required('.as-detail-body', panelEl).innerHTML =
                        '<div class="pn-panel-empty">No matching peers connected</div>';
                    required('.as-detail-pct', panelEl).textContent = '0 peers';
                }
            } else summaryOpenLensSummaryPanel();
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
        if (filtering) summaryPreviewSummaryLines(ids);
        else if (options.state.summarySelected) activateHoverAll();
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

    // ═══════════════════════════════════════════════════════════
    // IPv4/IPv6 NETWORK DETAIL PANEL
    // ═══════════════════════════════════════════════════════════

    /** Open a dedicated network detail panel (IPv4 or IPv6)
     * @param {string} netKey */
    function openNetworkPanel(netKey) {
        const panelEl = options.getPanel();
        if (!panelEl) return;
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();

        var isRefresh = options.state.activeNetwork === netKey;
        if (!options.state.donutFocused) {
            options.state.donutFocused = true;
            document.body.classList.add('donut-focused');
        }

        options.state.activeNetwork = netKey;
        if (!isRefresh) {
            options.state.panelHistory = [{ type: 'summary', scrollTop: 0 }];
            renderBackButton();
        }

        var result = options.getNetworkPanel().render({
            panelElement: panelEl,
            peers: options.getDashboard().peers,
            segments: options.getSegments(),
            networkKey: netKey,
            isRefresh: isRefresh,
        });
        if (!result.bodyElement || !result.data.peerCount) return;

        options.actions.summaryAttachSummaryHandlers(result.bodyElement);

        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(result.data.peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(result.data.peerIds);
        activateHoverAll();
        options.actions.renderCenter();
    }

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
            activateHoverAll();
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
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
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

        openPanel(countryId);
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
                    activateHoverAll();
                    var rows = queryAll('.sub-filter-active', bodyEl);
                    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
                } else if (options.state.selectedProvider) {
                    summaryClearSubFilter();
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
        if (asNum) setLegendFocus(asNum);
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
        if (asNum) setLegendFocus(asNum);
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
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
        if (options.actions.tooltipIsPinnedTo(rowEl)) {
            options.actions.tooltipHideSubTooltip();
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) activateHoverAll();
            summaryRestoreDonutAfterPreview();
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
        if (asNum) setLegendFocus(asNum);
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
            if (options.state.summarySelected) activateHoverAll();
            summaryRestoreDonutAfterPreview();
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
        if (asNum) setLegendFocus(asNum);
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
            if (options.state.summarySelected) activateHoverAll();
            summaryRestoreDonutAfterPreview();
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
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
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
            if (options.state.summarySelected) activateHoverAll();
            summaryRestoreDonutAfterPreview();
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

        summaryRestoreDonutAfterPreview();

        // Pin the sub-tooltip with provider list + "Open Others panel" nav link
        var html = options.getSummaryView().buildProviderListHtml(providers, 'Others', 'Others');
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
            summaryPreviewSummaryLines([peerId]);
        } else if (options.state.selectedProvider) {
            summaryPreviewProviderLines([peerId]);
        }
        // Preview this peer in the popup if a different peer is selected
        if (options.state.peerDetailActive && peerId !== options.state.selectedPeerId) {
            var peer = options.getDashboard().peers.find(function (p) {
                return p.id === peerId;
            });
            if (peer) previewPeerInPopup(peer);
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
            restorePeerPopupToSelected();
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
            summaryRestoreSummaryFromPreview();
        } else if (options.state.selectedProvider) {
            summaryRestoreProviderFromPreview();
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
            openPeerDetailPanel(peer, 'panel');
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
            openPeerDetailPanel(peer, 'panel');
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
        setLegendFocus(asNum);
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
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
        // Toggle: clicking same link unpins
        if (options.actions.tooltipIsPinnedTo(el)) {
            options.actions.tooltipHideSubTooltip();
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) activateHoverAll();
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
        var html = options.getSummaryView().buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')');
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
            if (options.state.summarySelected) activateHoverAll();
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
        var html = options.getSummaryView().buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')');
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
     * @param {MouseEvent} e
     */
    function previewFastestProviders(e) {
        // When something is selected (pinned) or peer detail is open, suppress hover previews
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        var html = options.actions.buildFastestProvHtml();
        if (html) options.actions.tooltipShowSubTooltip(html, e);
        // Preview lines for the #1 fastest provider + focus legend + show insight rect
        var data = options.actions.computeSummaryData();
        for (var j = 0; j < data.insights.length; j++) {
            const insightItem = data.insights[j];
            if (insightItem.type === 'fastest' && insightItem.topProviders && insightItem.topProviders.length > 0) {
                var top = insightItem.topProviders[0];
                setLegendFocus(top.asNumber);
                if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs(top.asNumber, top.peerIds, top.color);
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(top.peerIds);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(top.peerIds);
                if (options.state.donutFocused) {
                    options.actions.showInsightRect('fastest', {
                        provName: top.provName || top.asNumber,
                        asNumber: top.asNumber,
                        peerIds: top.peerIds,
                        avgPing: top.avgPing,
                        rank: 1,
                        color: top.color || options.actions.getColorForAsNum(top.asNumber),
                    });
                    options.actions.animateDonutExpand(top.asNumber);
                }
                break;
            }
        }
    }

    /**
     * @param {HTMLElement | null} fastestLink
     * @param {PointerEvent} e
     */
    function selectFastestProviders(fastestLink, e) {
        if (!fastestLink) return;
        const panelEl = options.getPanel();
        e.stopPropagation();
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
        if (options.actions.tooltipIsPinnedTo(fastestLink)) {
            options.actions.tooltipHideSubTooltip();
            fastestLink.closest('.as-summary-insight')?.classList.remove('sub-filter-active');
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            options.state.insightActiveAsNum = null;
            options.state.insightActiveData = null;
            options.state.insightActiveType = null;
            options.actions.hideInsightRect();
            if (options.state.donutFocused) options.actions.animateDonutRevert();
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) activateHoverAll();
            options.actions.renderCenter();
            return;
        }
        var html = options.actions.buildFastestProvHtml();
        if (!html) return;
        options.actions.tooltipShowSubTooltip(html, e);
        options.actions.tooltipPinSubTooltip(fastestLink);
        options.actions.insightAttachFastestProvRowHandlers(required('#as-sub-tooltip'));
        // Clear any other active highlights before adding ours
        var activeBodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
        if (activeBodyEl) {
            var prev = queryAll('.sub-filter-active', activeBodyEl);
            for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
        }
        fastestLink.closest('.as-summary-insight')?.classList.add('sub-filter-active');
        // Track sub-filter state for data refresh preservation
        options.state.filterPeerIds = [];
        options.state.filterCategory = 'insight-fastest';
        options.state.filterLabel = 'fastest';
        // Activate insight donut state — show insight rectangle for #1 fastest provider
        var insData = options.actions.computeSummaryData();
        for (var ij = 0; ij < insData.insights.length; ij++) {
            const insightItem = insData.insights[ij];
            if (insightItem.type === 'fastest' && insightItem.topProviders && insightItem.topProviders.length > 0) {
                var topProv = insightItem.topProviders[0];
                options.state.insightActiveAsNum = topProv.asNumber;
                options.state.insightActiveType = 'fastest';
                if (options.state.donutFocused) {
                    options.actions.showInsightRect('fastest', {
                        provName: topProv.provName,
                        asNumber: topProv.asNumber,
                        peerIds: topProv.peerIds,
                        avgPing: topProv.avgPing,
                        rank: 1,
                        color: topProv.color || options.actions.getColorForAsNum(topProv.asNumber),
                    });
                }
                setLegendFocus(topProv.asNumber);
                // Also draw lines for #1 provider immediately
                if (options.hooks.drawLinesForAs)
                    options.hooks.drawLinesForAs(topProv.asNumber, topProv.peerIds, topProv.color);
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(topProv.peerIds);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(topProv.peerIds);
                break;
            }
        }
    }

    /**
     * @param {HTMLElement | null} stableLink
     * @param {MouseEvent} e
     */
    function previewStablePeers(stableLink, e) {
        if (!stableLink) return;
        // When something is selected (pinned) or peer detail is open, suppress hover previews
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        var asNum = stableLink.dataset.as || '';
        if (asNum) setLegendFocus(asNum);
        var result = options.actions.buildStablePeersHtml();
        if (result) options.actions.tooltipShowSubTooltip(result.html, e);
        // Preview lines + filter for this provider + show insight rect
        if (asNum) {
            var peerIds = options.actions.getPeerIdsForAnyAs(asNum);
            var color = options.actions.getColorForAsNum(asNum);
            if (peerIds.length > 0 && options.hooks.drawLinesForAs) {
                options.hooks.drawLinesForAs(asNum, peerIds, color);
            }
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
            if (options.state.donutFocused) {
                var insData = options.actions.computeSummaryData();
                var stableIns = null;
                for (var ij = 0; ij < insData.insights.length; ij++) {
                    const insightItem = insData.insights[ij];
                    if (insightItem.type === 'stable') {
                        stableIns = insightItem;
                        break;
                    }
                }
                if (stableIns) {
                    options.actions.showInsightRect('stable', {
                        provName: stableIns.provName,
                        asNumber: stableIns.asNumber,
                        peerIds: stableIns.peerIds,
                        durText: stableIns.durText,
                        color: color,
                    });
                }
                options.actions.animateDonutExpand(asNum);
            }
        }
    }

    /**
     * @param {HTMLElement | null} stableLink
     * @param {PointerEvent} e
     */
    function selectStablePeers(stableLink, e) {
        if (!stableLink) return;
        const panelEl = options.getPanel();
        e.stopPropagation();
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
        // Toggle
        if (options.actions.tooltipIsPinnedTo(stableLink)) {
            options.actions.tooltipHideSubTooltip();
            stableLink.closest('.as-summary-insight')?.classList.remove('sub-filter-active');
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            options.state.insightActiveAsNum = null;
            options.state.insightActiveData = null;
            options.state.insightActiveType = null;
            options.actions.hideInsightRect();
            if (options.state.donutFocused) options.actions.animateDonutRevert();
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) activateHoverAll();
            options.actions.renderCenter();
            return;
        }
        var result = options.actions.buildStablePeersHtml();
        if (!result) return;
        options.actions.tooltipShowSubTooltip(result.html, e);
        options.actions.tooltipPinSubTooltip(stableLink);
        options.actions.tooltipAttachSubTooltipHandlers();
        var tip = document.getElementById('as-sub-tooltip');
        if (tip) options.actions.summaryAttachProviderNavHandlers(tip);
        // Clear any other active highlights before adding ours
        var activeBodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
        if (activeBodyEl) {
            var prev = queryAll('.sub-filter-active', activeBodyEl);
            for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
        }
        stableLink.closest('.as-summary-insight')?.classList.add('sub-filter-active');
        // Track sub-filter state for data refresh preservation
        options.state.filterPeerIds = result.peerIds;
        options.state.filterCategory = 'insight-stable';
        options.state.filterLabel = result.asNum;
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(result.peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(result.peerIds);
        // Draw lines for this provider
        var color = options.actions.getColorForAsNum(result.asNum);
        if (options.hooks.drawLinesForAs && result.asNum) {
            options.hooks.drawLinesForAs(result.asNum, result.peerIds, color);
        }
        // Activate insight donut state — show insight rectangle
        options.state.insightActiveAsNum = result.asNum;
        options.state.insightActiveType = 'stable';
        if (options.state.donutFocused) {
            var insData = options.actions.computeSummaryData();
            var stableIns = null;
            for (var ij = 0; ij < insData.insights.length; ij++) {
                const insightItem = insData.insights[ij];
                if (insightItem.type === 'stable') {
                    stableIns = insightItem;
                    break;
                }
            }
            if (stableIns) {
                options.actions.showInsightRect('stable', {
                    provName: stableIns.provName,
                    asNumber: stableIns.asNumber,
                    peerIds: stableIns.peerIds,
                    durText: stableIns.durText,
                    color: color,
                });
            }
        }
        setLegendFocus(result.asNum);
    }

    /**
     * @param {"bytesrecv" | "bytessent"} field
     * @param {MouseEvent} e
     */
    function previewDataProviders(field, e) {
        // When something is selected (pinned) or peer detail is open, suppress hover previews
        if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
        var result = options.actions.buildDataProviderHtml(field);
        if (!result) return;
        options.actions.tooltipShowSubTooltip(result.html, e);
        // Preview lines for the #1 data provider + focus legend + show insight rect
        if (result.insight && result.insight.topProviders && result.insight.topProviders.length > 0) {
            var top = result.insight.topProviders[0];
            setLegendFocus(top.asNumber);
            var topPeerIds = top.peers.slice(0, 20).map(function (p) {
                return p.id;
            });
            if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs(top.asNumber, topPeerIds, top.color);
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(topPeerIds);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(topPeerIds);
            if (options.state.donutFocused) {
                var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                options.actions.showInsightRect(rectType, {
                    provName: top.provName,
                    asNumber: top.asNumber,
                    peerIds: top.peers.map((peer) => peer.id),
                    totalBytes: top.totalBytes,
                    rank: 1,
                    color: top.color || options.actions.getColorForAsNum(top.asNumber),
                });
                options.actions.animateDonutExpand(top.asNumber);
            }
        }
    }

    /**
     * @param {HTMLElement} el
     * @param {"bytesrecv" | "bytessent"} field
     * @param {PointerEvent} e
     */
    function selectDataProviders(el, field, e) {
        const panelEl = options.getPanel();
        e.stopPropagation();
        if (options.state.peerDetailActive && !reconciling) closePeerPopup();
        // Toggle: clicking same link unpins
        if (options.actions.tooltipIsPinnedTo(el)) {
            options.actions.tooltipHideSubTooltip();
            el.closest('.as-summary-insight')?.classList.remove('sub-filter-active');
            options.state.filterPeerIds = null;
            options.state.filterCategory = null;
            options.state.filterLabel = null;
            options.state.insightActiveAsNum = null;
            options.state.insightActiveData = null;
            options.state.insightActiveType = null;
            options.actions.hideInsightRect();
            if (options.state.donutFocused) options.actions.animateDonutRevert();
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            if (options.state.summarySelected) activateHoverAll();
            options.actions.renderCenter();
            return;
        }
        var result = options.actions.buildDataProviderHtml(field);
        if (!result) return;
        options.actions.tooltipShowSubTooltip(result.html, e);
        options.actions.tooltipPinSubTooltip(el);
        options.actions.insightAttachDataProviderRowHandlers(required('#as-sub-tooltip'), field);
        // Clear any other active highlights before adding ours
        var activeBodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
        if (activeBodyEl) {
            var prev = queryAll('.sub-filter-active', activeBodyEl);
            for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
        }
        // Highlight this insight as active
        el.closest('.as-summary-insight')?.classList.add('sub-filter-active');
        // Track sub-filter state for data refresh preservation
        options.state.filterPeerIds = [];
        options.state.filterCategory = 'insight-data-' + field;
        options.state.filterLabel = field;
        // Activate insight donut state — show insight rectangle for #1 data provider
        var insDataResult = options.actions.buildDataProviderHtml(field);
        if (
            insDataResult &&
            insDataResult.insight &&
            insDataResult.insight.topProviders &&
            insDataResult.insight.topProviders.length > 0
        ) {
            var topDataProv = insDataResult.insight.topProviders[0];
            options.state.insightActiveAsNum = topDataProv.asNumber;
            options.state.insightActiveType = 'data-' + field;
            if (options.state.donutFocused) {
                var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                options.actions.showInsightRect(rectType, {
                    provName: topDataProv.provName,
                    asNumber: topDataProv.asNumber,
                    peerIds: topDataProv.peers.map((peer) => peer.id),
                    totalBytes: topDataProv.totalBytes,
                    rank: 1,
                    color: topDataProv.color || options.actions.getColorForAsNum(topDataProv.asNumber),
                });
            }
            setLegendFocus(topDataProv.asNumber);
            var topDataPeerIds = topDataProv.peers.slice(0, 20).map(function (p) {
                return p.id;
            });
            if (options.hooks.drawLinesForAs)
                options.hooks.drawLinesForAs(topDataProv.asNumber, topDataPeerIds, topDataProv.color);
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(topDataPeerIds);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(topDataPeerIds);
        }
    }

    /**
     * @param {PointerEvent} e
     */
    function enterPrivateFromSummary(e) {
        e.stopPropagation();
        if (options.hooks.enterPrivateNetMode) options.hooks.enterPrivateNetMode();
    }

    /**
     * @param {HTMLElement} provRow
     */
    function previewFastestProvider(provRow) {
        if (options.state.peerDetailActive || options.state.subSubTooltipPinned) return;
        var asNum = provRow.dataset.as || '';
        /** @type {number[]} */
        var peerIds = JSON.parse(provRow.dataset.peerIds || '');
        var rank = parseInt(provRow.dataset.rank || '') || 0;
        // Focus legend on this provider
        if (asNum) setLegendFocus(asNum);
        if (peerIds.length > 0 && options.hooks.drawLinesForAs && asNum) {
            options.hooks.drawLinesForAs(asNum, peerIds, options.actions.getColorForAsNum(asNum));
        }
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        // In focused mode, update insight rect for this provider
        if (options.state.donutFocused && asNum && options.getDonut().isInsightVisible()) {
            var grp = options.getGroups().find(function (g) {
                return g.asNumber === asNum;
            });
            var avgPing = parseFloat(provRow.dataset.avgPing || '') || 0;
            options.actions.showInsightRect('fastest', {
                provName: grp ? grp.asShort || grp.asName || asNum : asNum,
                asNumber: asNum,
                peerIds: peerIds,
                avgPing: avgPing,
                rank: rank,
                color: options.actions.getColorForAsNum(asNum),
            });
            options.state.insightActiveAsNum = asNum;
        } else if (options.state.donutFocused && asNum) {
            options.actions.showFocusedCenterText(asNum);
            options.actions.animateDonutExpand(asNum);
        }
    }

    /**
     * @param {HTMLElement} provRow
     * @param {PointerEvent} e
     */
    function selectFastestProvider(provRow, e) {
        e.stopPropagation();
        /** @type {number[]} */
        var peerIds = JSON.parse(provRow.dataset.peerIds || '');
        var asNum = provRow.dataset.as || '';
        var rank = parseInt(provRow.dataset.rank || '') || 0;

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

        var matchedPeers = options.actions.peersByIds(peerIds);
        matchedPeers.sort(function (a, b) {
            return (a.ping_ms || 9999) - (b.ping_ms || 9999);
        });

        // Build sub-sub-tooltip with peers ranked by ping
        var html = options.getSummaryView().buildPingPeerListHtml(matchedPeers.slice(0, 20));
        options.actions.tooltipShowSubSubTooltip(html, e);
        options.actions.tooltipPinSecondary();

        // Track sub-sub state for data refresh preservation
        options.state.subSubFilterPeerIds = peerIds;
        options.state.subSubFilterProvider = asNum;
        options.state.subSubFilterColor = options.actions.getColorForAsNum(asNum);

        if (options.hooks.drawLinesForAs && asNum) {
            options.hooks.drawLinesForAs(asNum, peerIds, options.state.subSubFilterColor);
        }
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);

        // Update insight rect to show selected provider
        if (options.state.donutFocused && options.getDonut().isInsightVisible()) {
            var grp = options.getGroups().find(function (g) {
                return g.asNumber === asNum;
            });
            var avgPing = parseFloat(provRow.dataset.avgPing || '') || 0;
            options.state.insightActiveAsNum = asNum;
            options.state.insightActiveData = {
                provName: grp ? grp.asShort || grp.asName || asNum : asNum,
                asNumber: asNum,
                peerIds: peerIds,
                avgPing: avgPing,
                rank: rank,
                color: options.actions.getColorForAsNum(asNum),
            };
            options.actions.showInsightRect('fastest', options.state.insightActiveData);
        }
    }

    /**
     * @param {HTMLElement} provRow
     * @param {string} field
     */
    function previewDataProvider(provRow, field) {
        if (options.state.peerDetailActive || options.state.subSubTooltipPinned) return;
        var asNum = provRow.dataset.as || '';
        /** @type {number[]} */
        var peerIds = JSON.parse(provRow.dataset.peerIds || '');
        var rank = parseInt(provRow.dataset.rank || '') || 0;
        // Focus legend on this provider
        if (asNum) setLegendFocus(asNum);
        if (peerIds.length > 0 && options.hooks.drawLinesForAs && asNum) {
            options.hooks.drawLinesForAs(asNum, peerIds, options.actions.getColorForAsNum(asNum));
        }
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);
        // In focused mode, update insight rect for this provider
        if (options.state.donutFocused && asNum && options.getDonut().isInsightVisible()) {
            var grp = options.getGroups().find(function (g) {
                return g.asNumber === asNum;
            });
            var totalBytes = parseInt(provRow.dataset.totalBytes || '') || 0;
            var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
            options.state.insightActiveAsNum = asNum;
            options.actions.showInsightRect(rectType, {
                provName: grp ? grp.asShort || grp.asName || asNum : asNum,
                asNumber: asNum,
                peerIds,
                totalBytes: totalBytes,
                rank: rank,
                color: options.actions.getColorForAsNum(asNum),
            });
        } else if (options.state.donutFocused && asNum) {
            options.actions.showFocusedCenterText(asNum);
            options.actions.animateDonutExpand(asNum);
        }
    }

    /**
     * @param {HTMLElement} provRow
     * @param {PointerEvent} e
     */
    function selectDataProvider(provRow, e) {
        e.stopPropagation();
        /** @type {number[]} */
        var peerIds = JSON.parse(provRow.dataset.peerIds || '');
        var asNum = provRow.dataset.as || '';
        const rowField = provRow.dataset.field === 'bytesrecv' ? 'bytesrecv' : 'bytessent';

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

        // Find matching peer objects from lastPeersRaw
        var matchedPeers = options.actions.peersByIds(peerIds);
        // Sort by the relevant field
        matchedPeers.sort(function (a, b) {
            return (b[rowField] || 0) - (a[rowField] || 0);
        });

        // Build sub-sub-tooltip showing top 20 peers with bytes amounts
        var html = options.getSummaryView().buildDataPeerListHtml(matchedPeers.slice(0, 20), rowField);
        options.actions.tooltipShowSubSubTooltip(html, e);
        options.actions.tooltipPinSecondary();

        // Track sub-sub state for data refresh preservation
        options.state.subSubFilterPeerIds = peerIds;
        options.state.subSubFilterProvider = asNum;
        options.state.subSubFilterColor = options.actions.getColorForAsNum(asNum);

        // Draw lines for this provider's peers
        if (options.hooks.drawLinesForAs && asNum) {
            options.hooks.drawLinesForAs(asNum, peerIds, options.state.subSubFilterColor);
        }
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(peerIds);

        // Update insight rect to show selected data provider
        if (options.state.donutFocused && options.getDonut().isInsightVisible()) {
            var grp = options.getGroups().find(function (g) {
                return g.asNumber === asNum;
            });
            var totalBytes = parseInt(provRow.dataset.totalBytes || '') || 0;
            var rank = parseInt(provRow.dataset.rank || '') || 0;
            var rectType = rowField === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
            options.state.insightActiveAsNum = asNum;
            options.state.insightActiveData = {
                provName: grp ? grp.asShort || grp.asName || asNum : asNum,
                asNumber: asNum,
                peerIds,
                totalBytes: totalBytes,
                rank: rank,
                color: options.actions.getColorForAsNum(asNum),
            };
            options.actions.showInsightRect(rectType, options.state.insightActiveData);
        }
    }
    /** @param {import('../types').PeerFilter | null} descriptor */
    function setFilterDescriptor(descriptor) {
        options.state.filterDescriptor = descriptor;
    }
    function clearFocusedHover() {
        options.state.focusedHoverProvider = null;
    }
    return Object.freeze({
        clearFocusedHover,
        setFilterDescriptor,
        closeActiveInsight,
        setLegendFocus,
        clearLegendFocus,
        selectSummary,
        deselectSummary,
        navigateToProvider,
        navigateBack,
        renderBackButton,
        onMapClick,
        backToOthersList,
        clearLegendHoverActive,
        showOthersListInDonut,
        closeOthersListInDonut,
        updateOthersPopupHighlight,
        onSegmentHover,
        onSegmentLeave,
        activateHoverAll,
        deactivateHoverAll,
        onTitleEnter,
        onTitleLeave,
        onSegmentClick,
        deselect,
        onKeyDown,
        enterFocusedMode,
        exitFocusedMode,
        isFocusedMode,
        dismissPeerDetailView,
        previewPeerInPopup,
        restorePeerPopupToSelected,
        closePeerPopup,
        openMultiPeerPopup,
        openPeerDetailPanel,
        clearSelectionForLensSwitch,
        setDistributionLens,
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
        summaryApplySummarySubFilter,
        summaryClearSummarySubFilter,
        summaryApplySubFilter,
        summaryClearSubFilter,
        refreshSelectionViews,
        openNetworkPanel,
        isReconciling,
        isOthersListOpen,
        clearSecondaryFilter,
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
        previewFastestProviders,
        selectFastestProviders,
        previewStablePeers,
        selectStablePeers,
        previewDataProviders,
        selectDataProviders,
        enterPrivateFromSummary,
        previewFastestProvider,
        selectFastestProvider,
        previewDataProvider,
        selectDataProvider,
    });
}
