import { comparePing } from '../core/ping.js';
import { query, queryAll, required } from '../core/dom.js';

/** @typedef {Pick<import('../types').DistributionNavigationOptions, 'getDonut' | 'getGroups' | 'getPanel' |
 * 'getSummaryView' | 'hooks' | 'state'> & { actions:
 * Pick<import('../types').DistributionNavigationOptions['actions'], 'animateDonutExpand' |
 * 'animateDonutRevert' | 'buildDataProviderHtml' | 'buildFastestProvHtml' | 'buildStablePeersHtml' |
 * 'computeSummaryData' | 'getColorForAsNum' | 'getPeerIdsForAnyAs' | 'hideInsightRect' |
 * 'insightAttachDataProviderRowHandlers' | 'insightAttachFastestProvRowHandlers' | 'peersByIds' |
 * 'renderCenter' | 'renderLegend' | 'showFocusedCenterText' | 'showInsightRect' |
 * 'summaryAttachProviderNavHandlers' | 'tooltipAttachSubTooltipHandlers' | 'tooltipHideSubTooltip' |
 * 'tooltipIsPinnedTo' | 'tooltipPinSecondary' | 'tooltipPinSubTooltip' | 'tooltipShowSubSubTooltip' |
 * 'tooltipShowSubTooltip'> }} Options */
/** @typedef {Pick<import('../types').DistributionNavigation, 'activateHoverAll' | 'closePeerPopup' |
 * 'isReconciling' | 'setLegendFocus'>} Transitions */

/** Handles summary insights and their provider and peer previews.
 * @param {Options} options
 * @param {() => Transitions} getNavigation
 */
export function create(options, getNavigation) {
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
                getNavigation().setLegendFocus(top.asNumber);
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
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) getNavigation().closePeerPopup();
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
            if (options.state.summarySelected) getNavigation().activateHoverAll();
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
                getNavigation().setLegendFocus(topProv.asNumber);
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
        if (asNum) getNavigation().setLegendFocus(asNum);
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
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) getNavigation().closePeerPopup();
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
            if (options.state.summarySelected) getNavigation().activateHoverAll();
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
        getNavigation().setLegendFocus(result.asNum);
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
            getNavigation().setLegendFocus(top.asNumber);
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
        if (options.state.peerDetailActive && !getNavigation().isReconciling()) getNavigation().closePeerPopup();
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
            if (options.state.summarySelected) getNavigation().activateHoverAll();
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
            getNavigation().setLegendFocus(topDataProv.asNumber);
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
        if (asNum) getNavigation().setLegendFocus(asNum);
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
            return comparePing(a.ping_ms, b.ping_ms);
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
        if (asNum) getNavigation().setLegendFocus(asNum);
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

    return Object.freeze({
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
