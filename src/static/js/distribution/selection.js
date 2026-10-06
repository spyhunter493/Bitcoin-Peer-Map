import { query, queryAll } from '../core/dom.js';
import * as BPMDistributionData from './data.js';
import * as BPMDomState from '../core/dom-state.js';

/** @typedef {Pick<import('../types').DistributionNavigationOptions, 'getContainer' | 'getDashboard' | 'getDonut'
 * | 'getGroups' | 'getNetworkPanel' | 'getPanel' | 'getPeerDetail' | 'getSegments' | 'getTooltips' |
 * 'hooks' | 'state'> & { actions: Pick<import('../types').DistributionNavigationOptions['actions'],
 * 'animateDonutExpand' | 'animateDonutRevert' | 'closePanel' | 'getActiveSegments' |
 * 'getColorForAsNum' | 'getPeerIdsForAnyAs' | 'hideInsightRect' | 'renderCenter' | 'renderDonut' |
 * 'renderLegend' | 'showPeerInDonutCenter' | 'stopDonutAnimation' | 'summaryAttachSummaryHandlers' |
 * 'tooltipHideSubSubTooltip' | 'tooltipHideSubTooltip' | 'updateLensChrome'> }} Options */
/** @typedef {Pick<import('../types').DistributionNavigation, 'activateHoverAll' | 'closeOthersListInDonut' |
 * 'deactivateHoverAll' | 'isOthersListOpen' | 'isReconciling' | 'openPanel' | 'renderBackButton' |
 * 'showOthersListInDonut' | 'summaryClearSubFilter' | 'summaryClearSummarySubFilter' |
 * 'summaryOpenLensSummaryPanel' | 'summaryPreviewSummaryLines'>} Transitions */

/** Owns focused mode, provider, network, and peer selection transitions.
 * @param {Options} options
 * @param {() => Transitions} getNavigation
 */
export function create(options, getNavigation) {
    function rememberExplorationFocus() {
        const source = document.activeElement;
        const container = options.getContainer();
        if (container && source && source !== document.body) container.dataset.returnFocusKey = BPMDomState.key(source);
    }
    function closeActiveInsight() {
        options.actions.hideInsightRect();
        options.state.insightActiveAsNum = null;
        options.state.insightActiveData = null;
        options.state.insightActiveType = null;
        options.actions.animateDonutRevert();
        options.actions.renderCenter();
        if (options.state.summarySelected) getNavigation().summaryClearSummarySubFilter();
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

    /** Select the Summary Analysis view */
    function selectSummary() {
        if (options.state.selectedProvider) deselect();
        options.state.summarySelected = true;
        options.state.hoveringAll = false;

        // Draw all lines (persistent)
        getNavigation().activateHoverAll();

        // Open the summary panel
        getNavigation().summaryOpenLensSummaryPanel();

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
        getNavigation().deactivateHoverAll();
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
        getNavigation().openPanel(asNum);

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
        if (getNavigation().isOthersListOpen()) getNavigation().closeOthersListInDonut();

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
            getNavigation().summaryOpenLensSummaryPanel();
            options.actions.animateDonutRevert();
            getNavigation().activateHoverAll();
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
            getNavigation().summaryOpenLensSummaryPanel();
            if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
            if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
            getNavigation().activateHoverAll();
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
                getNavigation().activateHoverAll();
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
                getNavigation().summaryClearSubFilter();
            }
            return true; // handled — don't close main panel
        }

        // Stage 2: If in a provider view, go back to summary
        if (options.state.selectedProvider) {
            if (options.state.donutFocused) {
                // In focused mode, go back to summary instead of closing
                if (getNavigation().isOthersListOpen()) getNavigation().closeOthersListInDonut();
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
        getNavigation().openPanel('Others');
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(othersSeg.peerIds);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(othersSeg.peerIds);
        if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs('Others', othersSeg.peerIds, othersSeg.color);
        options.actions.animateDonutExpand('Others');
        options.actions.renderCenter();
        options.actions.renderLegend();
        // Re-open the popup list
        getNavigation().showOthersListInDonut();
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
        if (getNavigation().isOthersListOpen()) getNavigation().closeOthersListInDonut();
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

    /** Enter focused mode: move the donut to the top-center */
    function enterFocusedMode() {
        if (options.state.donutFocused) return;
        rememberExplorationFocus();
        options.state.donutFocused = true;
        document.body.classList.add('donut-focused');

        // Hide the legend (top 8 list) — it only shows in default mode or on interaction
        var legend = options.getDonut().getLegendElement();
        if (legend) {
            legend.style.display = '';
        }

        // Activate hover-all to show lines from donut center in focused mode
        options.state.hoveringAll = false;
        getNavigation().activateHoverAll();

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
        if (getNavigation().isOthersListOpen()) getNavigation().closeOthersListInDonut();
        document.body.classList.remove('donut-focused');

        // Revert donut animation
        options.actions.stopDonutAnimation();
        options.actions.hideInsightRect();

        // Deselect everything
        if (options.state.summarySelected) deselectSummary();
        else if (options.state.selectedProvider) deselect();
        else options.actions.closePanel(); // Network panel or other non-summary/non-AS state
        options.state.hoveringAll = false;
        getNavigation().deactivateHoverAll();
        if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
        if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
        if (options.hooks.clearAsLines) options.hooks.clearAsLines();

        // Auto zoom-out to default map view
        if (options.hooks.resetMapZoom) options.hooks.resetMapZoom();

        // Reset center display
        options.actions.renderDonut();
        options.actions.renderCenter();
        options.actions.renderLegend();
        const sourceKey = options.getContainer()?.dataset.returnFocusKey;
        const source = sourceKey ? queryAll('*', document).find(element => BPMDomState.key(element) === sourceKey) : null;
        const target = source && source.getClientRects().length ? source : document.getElementById('as-overview-trigger');
        target?.focus({ preventScroll: true });
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
                getNavigation().summaryPreviewSummaryLines(options.state.filterPeerIds);
            } else {
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
                getNavigation().activateHoverAll();
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
        var asNum = BPMDistributionData.parseAsNumber(peer.as);
        var provColor = asNum ? options.actions.getColorForAsNum(asNum) : '#6e7681';
        if (!options.state.donutFocused) {
            rememberExplorationFocus();
            options.state.donutFocused = true;
            document.body.classList.add('donut-focused');
            if (!options.state.summarySelected && !options.state.selectedProvider) selectSummary();
        }
        // Summary initialization may close an existing popup. Mark the new
        // selection active only after that transition, preserving its source focus.
        options.state.peerDetailActive = true;
        options.state.selectedPeerId = peer.id;

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
        if (getNavigation().isOthersListOpen()) getNavigation().closeOthersListInDonut();
        options.actions.tooltipHideSubTooltip();
        options.actions.tooltipHideSubSubTooltip();
        options.actions.hideInsightRect();
        options.actions.closePanel();
        getNavigation().deactivateHoverAll();
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

    /** Open a dedicated network detail panel (IPv4 or IPv6)
     * @param {string} netKey */
    function openNetworkPanel(netKey) {
        const panelEl = options.getPanel();
        if (!panelEl) return;
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) closePeerPopup();

        var isRefresh = options.state.activeNetwork === netKey;
        if (!options.state.donutFocused) {
            rememberExplorationFocus();
            options.state.donutFocused = true;
            document.body.classList.add('donut-focused');
        }

        options.state.activeNetwork = netKey;
        if (!isRefresh) {
            options.state.panelHistory = [{ type: 'summary', scrollTop: 0 }];
            getNavigation().renderBackButton();
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
        getNavigation().activateHoverAll();
        options.actions.renderCenter();
    }

    return Object.freeze({
        closeActiveInsight,
        setLegendFocus,
        clearLegendFocus,
        selectSummary,
        deselectSummary,
        navigateToProvider,
        navigateBack,
        onMapClick,
        backToOthersList,
        deselect,
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
        openNetworkPanel,
    });
}
