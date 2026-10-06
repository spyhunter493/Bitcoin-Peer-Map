

import * as BPMDomState from '../core/dom-state.js';
/** @typedef {Pick<import('../types').DistributionNavigationOptions, 'areLegendsHidden' | 'getContainer' |
 * 'getPeerDetail' | 'getSegments' | 'hooks' | 'state'> & { actions:
 * Pick<import('../types').DistributionNavigationOptions['actions'], 'animateDonutExpand' |
 * 'animateDonutRevert' | 'clearLegendHighlight' | 'closePanel' | 'findActiveSegment' |
 * 'highlightLegendItem' | 'renderCenter' | 'renderDonut' | 'renderLegend' | 'showFocusedCenterText' |
 * 'showLegendHoverCenterText' | 'tooltipHideSubSubTooltip' | 'tooltipHideSubTooltip'> }} Options */
/** @typedef {Pick<import('../types').DistributionNavigation, 'activateHoverAll' | 'clearLegendHoverActive' |
 * 'closeOthersListInDonut' | 'closePeerPopup' | 'deactivateHoverAll' | 'deselect' | 'deselectSummary'
 * | 'exitFocusedMode' | 'isOthersListOpen' | 'openPanel' | 'selectSummary' | 'showOthersListInDonut' |
 * 'summaryClearSubFilter' | 'summaryClearSummarySubFilter' | 'summaryOpenLensSummaryPanel' |
 * 'summaryRestoreSummaryFromPreview'>} Transitions */

/** Handles donut pointer input and staged Escape navigation.
 * @param {Options} options
 * @param {() => Transitions} getNavigation
 */
export function create(options, getNavigation) {
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
            getNavigation().clearLegendHoverActive();
            options.actions.renderCenter();
        }

        // If there's an active sub-filter, restore to that instead of showing all
        if (options.state.summarySelected && options.state.filterPeerIds !== null && !options.state.selectedProvider) {
            getNavigation().summaryRestoreSummaryFromPreview();
            return;
        }

        // If distributionState.hoveringAll or distributionState.summarySelected is active, restore all-lines state
        if ((options.state.hoveringAll || options.state.summarySelected) && !options.state.selectedProvider) {
            getNavigation().activateHoverAll();
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

    function onTitleEnter() {
        if (options.state.selectedProvider || options.state.summarySelected) return; // Don't override an active selection or summary
        options.state.hoveringAll = true;
        getNavigation().activateHoverAll();
    }

    function onTitleLeave() {
        if (!options.state.hoveringAll || options.state.summarySelected) return;
        options.state.hoveringAll = false;
        getNavigation().deactivateHoverAll();
    }

    /** @param {MouseEvent} e */
    function onSegmentClick(e) {
        const containerEl = options.getContainer();
        var asNum = e.currentTarget instanceof Element ? e.currentTarget.getAttribute('data-as') || '' : '';
        if (!asNum) return;

        // Close peer detail popup if open (user clicked a different segment)
        // Skip zoom reset — the segment view will set its own lines/filters
        if (options.state.peerDetailActive) {
            getNavigation().closePeerPopup(true);
        }

        // Auto-enter focused mode if not already
        if (!options.state.donutFocused) {
            if (containerEl && document.activeElement && document.activeElement !== document.body)
                containerEl.dataset.returnFocusKey = BPMDomState.key(document.activeElement);
            options.state.donutFocused = true;
            document.body.classList.add('donut-focused');
        }

        // If summary is active, close it and select this AS
        if (options.state.summarySelected) {
            getNavigation().deselectSummary();
        }

        if (options.state.selectedProvider === asNum) {
            // Deselect — go back to summary in focused mode
            if (options.state.donutFocused) {
                if (getNavigation().isOthersListOpen()) getNavigation().closeOthersListInDonut();
                options.state.selectedProvider = null;
                options.state.filterPeerIds = null;
                options.state.filterLabel = null;
                options.state.filterCategory = null;
                options.actions.tooltipHideSubTooltip();
                options.actions.closePanel();
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
                options.actions.animateDonutRevert();
                getNavigation().selectSummary();
                options.actions.renderCenter();
                options.actions.renderLegend();
            } else {
                options.actions.animateDonutRevert();
                getNavigation().deselect();
            }
        } else {
            // Select this AS — clear any sub-filter from previous selection
            options.state.filterPeerIds = null;
            options.state.filterLabel = null;
            options.state.filterCategory = null;
            options.actions.tooltipHideSubTooltip();
            if (getNavigation().isOthersListOpen()) getNavigation().closeOthersListInDonut();
            options.state.selectedProvider = asNum;
            var seg = options.actions.findActiveSegment(asNum);
            if (seg) {
                getNavigation().openPanel(asNum);
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(seg.peerIds);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(seg.peerIds);
                if (options.hooks.drawLinesForAs) options.hooks.drawLinesForAs(asNum, seg.peerIds, seg.color);

                // In focused mode, Others segment shows scrollable provider list inside donut
                if (options.state.donutFocused && seg.isOthers) {
                    getNavigation().showOthersListInDonut();
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

    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
        if (e.key === 'Escape' && !e.defaultPrevented) {
            // The shared modal controller owns Escape while a peer action dialog is open.
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            if (!options.state.peerDetailActive && !options.state.subTooltipPinned && !options.state.subSubTooltipPinned &&
                !options.state.activeNetwork && !options.state.summarySelected && !options.state.selectedProvider && !options.state.donutFocused) return;
            e.preventDefault();
            // Close peer popup first
            if (options.state.peerDetailActive && options.getPeerDetail().isOpen()) {
                getNavigation().closePeerPopup();
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
                    getNavigation().activateHoverAll();
                }
                return;
            }
            if (options.state.subTooltipPinned) {
                options.actions.tooltipHideSubTooltip();
                // Restore to full summary or AS state
                if (options.state.summarySelected) {
                    getNavigation().summaryClearSummarySubFilter();
                } else if (options.state.selectedProvider) {
                    getNavigation().summaryClearSubFilter();
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
                getNavigation().summaryOpenLensSummaryPanel();
                if (options.hooks.filterPeerTable) options.hooks.filterPeerTable(null);
                if (options.hooks.dimMapPeers) options.hooks.dimMapPeers(null);
                getNavigation().activateHoverAll();
                options.actions.renderDonut();
                options.actions.renderCenter();
                options.actions.renderLegend();
                return;
            }
            if (options.state.summarySelected) {
                if (options.state.donutFocused) {
                    getNavigation().exitFocusedMode();
                } else {
                    getNavigation().deselectSummary();
                }
                return;
            }
            if (options.state.selectedProvider) {
                getNavigation().deselect();
                return;
            }
            if (options.state.donutFocused) {
                getNavigation().exitFocusedMode();
            }
        }
    }

    function clearFocusedHover() {
        options.state.focusedHoverProvider = null;
    }

    return Object.freeze({
        onSegmentHover,
        onSegmentLeave,
        onTitleEnter,
        onTitleLeave,
        onSegmentClick,
        onKeyDown,
        clearFocusedHover,
    });
}
