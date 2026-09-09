/* Summary rendering, category/provider drill-down, filters, and refresh coordination. */
(function (global) {
    'use strict';

    // data, elements, and hooks expose live getters from the composition root.
    // Keep their objects intact so polling and late hook/DOM setup remain visible.
    // Child controllers use the same state and call back here to restore previews.
    function create(options) {
        const distributionState = options.state;
        const sourceData = options.data;
        const elements = options.elements;
        const hooks = options.hooks;
        const actions = options.actions;
        const distributionData = global.BPMDistributionData;
        const view = global.BPMDistributionSummaryPanel.create(options);
        const childOptions = Object.assign({}, options, {
            view,
            actions: Object.assign({}, actions, {
                previewSummaryLines,
                previewProviderLines,
                restoreSummaryFromPreview,
                restoreProviderFromPreview,
                restoreDonutAfterPreview,
                attachProviderClickHandlers,
                attachProviderNavHandlers,
            }),
        });
        const tooltips = global.BPMDistributionTooltips.create(childOptions);
        const insights = global.BPMDistributionSummaryInsights.create(
            Object.assign({}, childOptions, { tooltips })
        );

        function openLensSummaryPanel() {
            if (actions.isCountryLens()) openCountrySummaryPanel();
            else openSummaryPanel();
        }

        function openCountrySummaryPanel() {
            if (!elements.panel) return;
            if (distributionState.peerDetailActive) actions.closePeerPopup();
            actions.renderBackButton();
            var bodyEl = view.renderCountry(actions.computeCountrySummaryData());
            if (!bodyEl) return;
            attachCountrySummaryRowHandlers(bodyEl);
            attachPanelBlankClickHandler(bodyEl);
        }

        function attachCountrySummaryRowHandlers(bodyEl) {
            var rows = bodyEl.querySelectorAll('.as-country-summary-row');
            for (var ri = 0; ri < rows.length; ri++) {
                (function (rowEl) {
                    rowEl.addEventListener('mouseenter', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        var countryId = rowEl.dataset.as;
                        var seg = actions.findActiveSegmentOrGroup(countryId);
                        if (!seg) return;
                        actions.highlightLegendItem(countryId);
                        if (hooks.filterPeerTable) hooks.filterPeerTable(seg.peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(seg.peerIds);
                        if (hooks.drawLinesForAs) hooks.drawLinesForAs(countryId, seg.peerIds, seg.color);
                        if (distributionState.donutFocused) {
                            distributionState.focusedHoverProvider = countryId;
                            actions.showFocusedCenterText(countryId);
                        }
                    });
                    rowEl.addEventListener('mouseleave', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        distributionState.focusedHoverProvider = null;
                        actions.clearLegendHighlight();
                        if (distributionState.summarySelected) {
                            if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                            actions.activateHoverAll();
                        } else {
                            if (hooks.clearAsLines) hooks.clearAsLines();
                        }
                        actions.renderCenter();
                    });
                    rowEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (distributionState.peerDetailActive) actions.closePeerPopup();
                        var countryId = rowEl.dataset.as;
                        var seg = actions.findActiveSegmentOrGroup(countryId);
                        if (!seg) return;

                        var scrollTop = bodyEl ? bodyEl.scrollTop : 0;
                        distributionState.panelHistory = [{ type: 'summary', scrollTop: scrollTop }];
                        distributionState.summarySelected = false;
                        distributionState.selectedProvider = countryId;
                        distributionState.filterPeerIds = null;
                        distributionState.filterLabel = null;
                        distributionState.filterCategory = null;
                        tooltips.hideSubTooltip();
                        tooltips.hideSubSubTooltip();

                        actions.openPanel(countryId);
                        if (hooks.filterPeerTable) hooks.filterPeerTable(seg.peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(seg.peerIds);
                        if (hooks.drawLinesForAs) hooks.drawLinesForAs(countryId, seg.peerIds, seg.color);
                        actions.animateDonutExpand(countryId);
                        if (elements.container) elements.container.classList.add('as-legend-visible');
                        actions.renderCenter();
                        actions.renderLegend();
                        if (hooks.resetMapZoom) hooks.resetMapZoom();
                    });
                })(rows[ri]);
            }
        }

        function openSummaryPanel() {
            if (!elements.panel) return;
            if (distributionState.peerDetailActive) actions.closePeerPopup();
            actions.renderBackButton();
            var bodyEl = view.renderProvider(actions.computeSummaryData());
            if (!bodyEl) return;
            attachSummaryHandlers(bodyEl);
        }

        function buildPeerSummaryHtml(peerIds, category, label) {
            // Find the actual peer objects from the current AS group
            var seg = distributionState.selectedProvider ? actions.findActiveSegment(distributionState.selectedProvider) : null;
            var allPeers = [];
            if (seg) {
                if (seg.isOthers && seg._othersGroups) {
                    for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                        for (var opi = 0; opi < seg._othersGroups[oi].peers.length; opi++) {
                            allPeers.push(seg._othersGroups[oi].peers[opi]);
                        }
                    }
                } else {
                    var grp = actions.findActiveGroup(distributionState.selectedProvider);
                    if (grp) allPeers = grp.peers;
                }
            } else if (distributionState.selectedProvider) {
                // Fallback for sub-groups not in top donut segments.
                var grp = actions.findActiveGroup(distributionState.selectedProvider);
                if (grp) allPeers = grp.peers;
            }

            var idSet = {};
            for (var ii = 0; ii < peerIds.length; ii++) idSet[peerIds[ii]] = true;
            var matchedPeers = [];
            for (var mi = 0; mi < allPeers.length; mi++) {
                if (idSet[allPeers[mi].id]) matchedPeers.push(allPeers[mi]);
            }

            return view.buildPeerSummaryHtml(matchedPeers, category, label);
        }

        function attachPanelBlankClickHandler(bodyEl) {
            bodyEl.addEventListener('click', function (e) {
                // Only close if clicking on the body itself, not on interactive children
                if (e.target === bodyEl || e.target.classList.contains('modal-section-title') ||
                    e.target.classList.contains('modal-row') || e.target.classList.contains('modal-label') ||
                    e.target.classList.contains('modal-val')) {
                    if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
                        tooltips.hideSubTooltip();
                        tooltips.hideSubSubTooltip();
                        if (distributionState.summarySelected) {
                            distributionState.filterPeerIds = null;
                            distributionState.filterLabel = null;
                            distributionState.filterCategory = null;
                            if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                            actions.activateHoverAll();
                            var rows = bodyEl.querySelectorAll('.sub-filter-active');
                            for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
                        } else if (distributionState.selectedProvider) {
                            clearSubFilter();
                        }
                    }
                }
            });
        }

        function attachInteractiveRowHandlers(bodyEl, seg) {
            var rows = bodyEl.querySelectorAll('.as-interactive-row');
            for (var ri = 0; ri < rows.length; ri++) {
                (function (rowEl) {
                    rowEl.addEventListener('mouseenter', function (e) {
                        // When something is selected (pinned) or peer detail is open, suppress hover previews
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var category = rowEl.dataset.category;
                        var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                        var html = buildPeerSummaryHtml(peerIds, category, label);
                        tooltips.showSubTooltip(html, e);
                        // Preview lines/filter for hovered sub-row
                        previewProviderLines(peerIds);
                    });
                    rowEl.addEventListener('mousemove', function (e) {
                        if (!distributionState.subTooltipPinned) tooltips.positionSubTooltip(e);
                    });
                    rowEl.addEventListener('mouseleave', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        tooltips.hideSubTooltip();
                        restoreProviderFromPreview();
                    });
                    rowEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var category = rowEl.dataset.category;
                        var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                        // Toggle: clicking same row unpins
                        if (tooltips.isPinnedTo(rowEl)) {
                            tooltips.hideSubTooltip();
                            clearSubFilter();
                            return;
                        }
                        applySubFilter(peerIds, category, label);
                        var html = buildPeerSummaryHtml(peerIds, category, label);
                        tooltips.showSubTooltip(html, e);
                        tooltips.pinSubTooltip(rowEl);
                    });
                })(rows[ri]);
            }
        }

        function restoreDonutAfterPreview() {
            distributionState.summaryPreviewPeerIds = null;
            distributionState.summaryPreviewLabel = null;
            if (!distributionState.donutFocused) return;
            if (distributionState.subSubFilterProvider && distributionState.subSubTooltipPinned) {
                // A Level 3 provider is selected (sub-sub pinned) — keep donut on that provider
                actions.showFocusedCenterText(distributionState.subSubFilterProvider);
                actions.animateDonutExpand(distributionState.subSubFilterProvider);
            } else if (distributionState.insightActiveAsNum) {
                // An insight is active (Most Stable, Fastest, etc.) — keep donut on that provider
                if (options.donut.isInsightVisible()) {
                    actions.restoreInsightRectProvider();
                }
                actions.showFocusedCenterText(distributionState.insightActiveAsNum);
                actions.animateDonutExpand(distributionState.insightActiveAsNum);
            } else if (distributionState.filterCategory && distributionState.filterCategory.indexOf('conn-') === 0 && distributionState.filterLabel) {
                // A conn-provider/conn-out/conn-in sub-filter is active — keep donut on that
                actions.showFocusedCenterText(distributionState.filterLabel);
                actions.animateDonutExpand(distributionState.filterLabel);
            } else if (distributionState.filterPeerIds && distributionState.filterLabel && distributionState.filterCategory === 'summary') {
                // A summary category sub-filter is active (IPv4, etc.) — show category info
                actions.animateDonutRevert();
                actions.renderCenter();
            } else {
                // No active sub-filter — revert to default
                actions.animateDonutRevert();
                actions.renderCenter();
            }
        }

        function previewSummaryLines(peerIds) {
            if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
            if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
            if (hooks.drawLinesForAllAs && sourceData.segments.length > 0) {
                var idSet = {};
                for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                var groups = [];
                for (var si = 0; si < sourceData.segments.length; si++) {
                    var seg = sourceData.segments[si];
                    var filteredIds = [];
                    for (var pi = 0; pi < seg.peerIds.length; pi++) {
                        if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                    }
                    if (filteredIds.length > 0) {
                        groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                    }
                }
                hooks.drawLinesForAllAs(groups);
            }
        }

        function previewProviderLines(peerIds) {
            if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
            if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
            if (distributionState.selectedProvider && hooks.drawLinesForAs) {
                var color = actions.getColorForActiveEntity(distributionState.selectedProvider);
                hooks.drawLinesForAs(distributionState.selectedProvider, peerIds, color);
            }
        }

        function previewSummaryCenterText(peerIds, label) {
            if (!distributionState.donutFocused) return;
            distributionState.summaryPreviewPeerIds = peerIds;
            distributionState.summaryPreviewLabel = label;
            options.donut.renderFilterCenter(peerIds.length, label, actions.getActiveTotalPeers());
        }

        function restoreSummaryFromPreview() {
            // Don't restore if big peer popup is active — it manages its own line state
            if (distributionState.peerDetailActive) return;
            if (distributionState.subSubFilterPeerIds && distributionState.subSubFilterProvider) {
                // Was showing sub-sub (e.g. a specific provider within a category)
                var ssColor = distributionState.subSubFilterColor || actions.getColorForAsNum(distributionState.subSubFilterProvider);
                if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.subSubFilterProvider, distributionState.subSubFilterPeerIds, ssColor);
                if (hooks.filterPeerTable) hooks.filterPeerTable(distributionState.subSubFilterPeerIds);
                if (hooks.dimMapPeers) hooks.dimMapPeers(distributionState.subSubFilterPeerIds);
            } else if (distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0) {
                // Was showing a category filter (e.g. IPv6)
                previewSummaryLines(distributionState.filterPeerIds);
            } else if (distributionState.subTooltipPinned && (distributionState.filterCategory === 'insight-fastest' || (distributionState.filterCategory && distributionState.filterCategory.indexOf('insight-data-') === 0))) {
                // Rank list pinned — default to showing #1 ranked provider
                var tip = document.getElementById('as-sub-tooltip');
                if (tip) {
                    var firstRow = tip.querySelector('.as-fastest-prov-row, .as-data-prov-row');
                    if (firstRow) {
                        var asNum = firstRow.dataset.as;
                        var peerIds = JSON.parse(firstRow.dataset.peerIds || '[]');
                        if (asNum) actions.setLegendFocus(asNum);
                        if (peerIds.length > 0 && hooks.drawLinesForAs && asNum) {
                            hooks.drawLinesForAs(asNum, peerIds, actions.getColorForAsNum(asNum));
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        if (distributionState.donutFocused && asNum && options.donut.isInsightVisible()) {
                            actions.restoreInsightRectProvider();
                        } else if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                        return;
                    }
                }
                // Fallback: show all
                if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                actions.activateHoverAll();
            } else if (distributionState.insightActiveAsNum) {
                // Insight is active (e.g. Most Stable clicked) — restore to showing the insight's provider
                var asNum = distributionState.insightActiveAsNum;
                var peerIds = actions.getPeerIdsForAnyAs(asNum);
                var color = actions.getColorForAsNum(asNum);
                if (asNum) actions.setLegendFocus(asNum);
                if (peerIds.length > 0 && hooks.drawLinesForAs) {
                    hooks.drawLinesForAs(asNum, peerIds, color);
                }
                if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                if (distributionState.donutFocused && options.donut.isInsightVisible()) {
                    actions.restoreInsightRectProvider();
                } else if (distributionState.donutFocused) {
                    actions.showFocusedCenterText(asNum);
                    actions.animateDonutExpand(asNum);
                }
            } else {
                // No filter — show all
                if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                actions.activateHoverAll();
            }
        }

        function restoreProviderFromPreview() {
            // Don't restore if big peer popup is active — it manages its own line state
            if (distributionState.peerDetailActive) return;
            if (distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0) {
                previewProviderLines(distributionState.filterPeerIds);
            } else if (distributionState.selectedProvider) {
                var allPeerIds = actions.getPeerIdsForActiveEntity(distributionState.selectedProvider);
                var color = actions.getColorForActiveEntity(distributionState.selectedProvider);
                if (hooks.filterPeerTable) hooks.filterPeerTable(allPeerIds);
                if (hooks.dimMapPeers) hooks.dimMapPeers(allPeerIds);
                if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.selectedProvider, allPeerIds, color);
            }
        }

        function attachSummaryRowHandlers(bodyEl) {
            var rows = bodyEl.querySelectorAll('.as-summary-row');
            for (var ri = 0; ri < rows.length; ri++) {
                (function (rowEl) {
                    rowEl.addEventListener('mouseenter', function (e) {
                        // When something is selected (pinned) or peer detail is open, suppress hover previews
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var providers = JSON.parse(rowEl.dataset.providers);
                        var catLabel = rowEl.dataset.catLabel;
                        var html = view.buildProviderListHtml(providers, catLabel);
                        tooltips.showSubTooltip(html, e);
                        // Preview lines/filter for hovered category
                        previewSummaryLines(peerIds);
                        // Preview category info in donut center
                        previewSummaryCenterText(peerIds, catLabel);
                    });
                    rowEl.addEventListener('mousemove', function (e) {
                        if (!distributionState.subTooltipPinned) tooltips.positionSubTooltip(e);
                    });
                    rowEl.addEventListener('mouseleave', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        tooltips.hideSubTooltip();
                        restoreSummaryFromPreview();
                        restoreDonutAfterPreview();
                    });
                    rowEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (distributionState.peerDetailActive) actions.closePeerPopup();
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var providers = JSON.parse(rowEl.dataset.providers);
                        var catLabel = rowEl.dataset.catLabel;

                        // Toggle: clicking same row unpins
                        if (tooltips.isPinnedTo(rowEl)) {
                            tooltips.hideSubTooltip();
                            clearSummarySubFilter();
                            restoreDonutAfterPreview();
                            return;
                        }

                        // Apply sub-filter for all peers in this category
                        applySummarySubFilter(peerIds, catLabel);

                        // Immediately update the donut to reflect the new category
                        restoreDonutAfterPreview();

                        // Pin the sub-tooltip with provider list
                        var html = view.buildProviderListHtml(providers, catLabel);
                        tooltips.showSubTooltip(html, e);
                        tooltips.pinSubTooltip(rowEl);
                        attachProviderClickHandlers(document.getElementById('as-sub-tooltip'));
                    });
                    rowEl.addEventListener('keydown', function (e) {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        rowEl.click();
                    });
                })(rows[ri]);
            }
        }

        function attachProviderClickHandlers(tip) {
            var provRows = tip.querySelectorAll('.as-provider-row');
            for (var pi = 0; pi < provRows.length; pi++) {
                (function (provRow) {
                    provRow.style.cursor = 'pointer';
                    // Hover preview: show lines + filter for this provider's peers
                    provRow.addEventListener('mouseenter', function () {
                        if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                        var asNum = provRow.dataset.as;
                        var peerIds = JSON.parse(provRow.dataset.peerIds);
                        // Focus legend on this provider
                        if (asNum) actions.setLegendFocus(asNum);
                        if (peerIds.length > 0 && hooks.drawLinesForAs && asNum) {
                            hooks.drawLinesForAs(asNum, peerIds, actions.getColorForAsNum(asNum));
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        // In focused mode, show provider in donut center + animate
                        if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                    });
                    provRow.addEventListener('mouseleave', function () {
                        if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                        actions.clearLegendFocus();
                        restoreSummaryFromPreview();
                        restoreDonutAfterPreview();
                    });
                    provRow.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var peerIds = JSON.parse(provRow.dataset.peerIds);

                        // Find matching peer objects from lastPeersRaw
                        var idSet = {};
                        for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                        var matchedPeers = [];
                        for (var i = 0; i < sourceData.peers.length; i++) {
                            if (idSet[sourceData.peers[i].id]) matchedPeers.push(sourceData.peers[i]);
                        }

                        var asNum = provRow.dataset.as;
                        // Keep legend focused on this provider while sub-sub is pinned
                        distributionState.legendFocusProvider = asNum;
                        actions.renderLegend();

                        // Highlight this provider row as selected in the sub-tooltip
                        var tip = document.getElementById('as-sub-tooltip');
                        if (tip) {
                            var prevSel = tip.querySelectorAll('.as-provider-row-selected');
                            for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
                        }
                        provRow.classList.add('as-provider-row-selected');

                        var html = view.buildPeerListHtmlForSubSub(matchedPeers);
                        tooltips.showSubSubTooltip(html, e);
                        distributionState.subSubTooltipPinned = true;

                        // Track sub-sub state for data refresh preservation
                        distributionState.subSubFilterPeerIds = peerIds;
                        distributionState.subSubFilterProvider = asNum;
                        distributionState.subSubFilterColor = actions.getColorForAsNum(asNum);

                        // Draw lines for just this provider's peers
                        if (hooks.drawLinesForAs && asNum) {
                            hooks.drawLinesForAs(asNum, peerIds, distributionState.subSubFilterColor);
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                    });
                })(provRows[pi]);
            }

            // Private network panel links (Tor/I2P/CJDNS titles)
            var pnLinks = tip.querySelectorAll('.as-private-net-link');
            for (var pnli = 0; pnli < pnLinks.length; pnli++) {
                (function (linkEl) {
                    linkEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var netKey = linkEl.dataset.net;
                        if (hooks.enterPrivateNetMode && netKey) hooks.enterPrivateNetMode(netKey);
                    });
                })(pnLinks[pnli]);
            }
        }

        function attachGridHandlers(bodyEl) {
            // Provider total rows — hover/click shows all peers for this provider
            var connProvRows = bodyEl.querySelectorAll('.as-conn-prov-row');
            for (var cpi = 0; cpi < connProvRows.length; cpi++) {
                (function (rowEl) {
                    function buildProvPeerHtml() {
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        if (peerIds.length === 0) return null;
                        var asNum = rowEl.dataset.as;
                        var idSet = {};
                        for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                        var matchedPeers = [];
                        for (var i = 0; i < sourceData.peers.length; i++) {
                            if (idSet[sourceData.peers[i].id]) matchedPeers.push(sourceData.peers[i]);
                        }
                        // Find the provider name for the header
                        var provName = asNum;
                        var grp = sourceData.groups.find(function (g) { return g.asNumber === asNum; });
                        if (grp) provName = grp.asShort || grp.asName || asNum;
                        var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                        html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + provName + ' Peers</div>';
                        html += '<div class="as-sub-tt-nav as-grid-provider-click" data-as="' + asNum + '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open provider panel</div>';
                        html += '</div>';
                        html += view.buildPeerListHtmlForSubSub(matchedPeers);
                        return html;
                    }
                    rowEl.addEventListener('mouseenter', function (e) {
                        // When something is selected (pinned) or peer detail is open, suppress hover previews
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var asNum = rowEl.dataset.as;
                        if (asNum) actions.setLegendFocus(asNum);
                        var html = buildProvPeerHtml();
                        if (html) tooltips.showSubTooltip(html, e);
                        // Preview lines for this provider
                        if (asNum && peerIds.length > 0) {
                            var color = actions.getColorForAsNum(asNum);
                            if (hooks.drawLinesForAs) hooks.drawLinesForAs(asNum, peerIds, color);
                            if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        }
                        if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                    });
                    rowEl.addEventListener('mouseleave', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        actions.clearLegendFocus();
                        tooltips.hideSubTooltip();
                        restoreSummaryFromPreview();
                        restoreDonutAfterPreview();
                    });
                    rowEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (distributionState.peerDetailActive) actions.closePeerPopup();
                        if (tooltips.isPinnedTo(rowEl)) {
                            tooltips.hideSubTooltip();
                            distributionState.filterPeerIds = null;
                            distributionState.filterCategory = null;
                            distributionState.filterLabel = null;
                            if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                            if (distributionState.summarySelected) actions.activateHoverAll();
                            restoreDonutAfterPreview();
                            return;
                        }
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var html = buildProvPeerHtml();
                        if (!html) return;
                        tooltips.showSubTooltip(html, e);
                        tooltips.pinSubTooltip(rowEl);
                        tooltips.attachSubTooltipHandlers();
                        var tipEl = document.getElementById('as-sub-tooltip');
                        if (tipEl) attachProviderNavHandlers(tipEl);
                        // Clear any active insight state when selecting a provider
                        if (distributionState.insightActiveAsNum || distributionState.insightActiveType) {
                            distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null;
                            distributionState.insightActiveType = null;
                            actions.hideInsightRect();
                        }
                        // Clear all highlights before setting new ones
                        var activeBodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
                        if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                        // Highlight this row as the active selection
                        rowEl.classList.add('sub-filter-active');
                        // Track sub-filter state for data refresh preservation
                        var asNum = rowEl.dataset.as;
                        distributionState.filterPeerIds = peerIds;
                        distributionState.filterCategory = 'conn-provider';
                        distributionState.filterLabel = asNum || '';
                        // Draw lines for this provider's peers
                        if (asNum && hooks.drawLinesForAs) {
                            var color = actions.getColorForAsNum(asNum);
                            hooks.drawLinesForAs(asNum, peerIds, color);
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        // Keep donut expanded for this provider while viewing its peers
                        if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                    });
                })(connProvRows[cpi]);
            }

            // Out rows — hover/click shows outbound subtypes breakdown
            var connOutRows = bodyEl.querySelectorAll('.as-conn-out-row');
            for (var coi = 0; coi < connOutRows.length; coi++) {
                (function (rowEl) {
                    function buildOutSubHtml() {
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        if (peerIds.length === 0) return null;
                        var subtypes = JSON.parse(rowEl.dataset.outSubtypes);
                        var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                        html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Outbound Peers</div>';
                        html += '</div>';
                        html += '<div class="as-sub-tt-scroll">';
                        for (var si = 0; si < subtypes.length; si++) {
                            var st = subtypes[si];
                            html += '<div class="as-sub-tt-peer">';
                            html += '<span class="as-sub-tt-id" style="font-weight:600; min-width:60px">' + st.label + '</span>';
                            html += '<span class="as-sub-tt-type">' + st.count + ' peer' + (st.count !== 1 ? 's' : '') + '</span>';
                            html += '</div>';
                        }
                        html += '</div>';
                        // Also include full peer list below subtypes
                        var idSet = {};
                        for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                        var matchedPeers = [];
                        for (var i = 0; i < sourceData.peers.length; i++) {
                            if (idSet[sourceData.peers[i].id]) matchedPeers.push(sourceData.peers[i]);
                        }
                        html += '<div style="border-top:1px solid rgba(88,166,255,0.1); margin-top:4px; padding-top:4px">';
                        html += view.buildPeerListHtmlForSubSub(matchedPeers);
                        html += '</div>';
                        return html;
                    }
                    rowEl.addEventListener('mouseenter', function (e) {
                        // When something is selected (pinned) or peer detail is open, suppress hover previews
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var asNum = rowEl.dataset.as;
                        if (asNum) actions.setLegendFocus(asNum);
                        var html = buildOutSubHtml();
                        if (html) tooltips.showSubTooltip(html, e);
                        if (asNum && peerIds.length > 0) {
                            var color = actions.getColorForAsNum(asNum);
                            if (hooks.drawLinesForAs) hooks.drawLinesForAs(asNum, peerIds, color);
                            if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        }
                        if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                    });
                    rowEl.addEventListener('mouseleave', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        actions.clearLegendFocus();
                        tooltips.hideSubTooltip();
                        restoreSummaryFromPreview();
                        restoreDonutAfterPreview();
                    });
                    rowEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (tooltips.isPinnedTo(rowEl)) {
                            tooltips.hideSubTooltip();
                            distributionState.filterPeerIds = null;
                            distributionState.filterCategory = null;
                            distributionState.filterLabel = null;
                            if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                            if (distributionState.summarySelected) actions.activateHoverAll();
                            restoreDonutAfterPreview();
                            return;
                        }
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var html = buildOutSubHtml();
                        if (!html) return;
                        tooltips.showSubTooltip(html, e);
                        tooltips.pinSubTooltip(rowEl);
                        tooltips.attachSubTooltipHandlers();
                        // Clear insight state
                        if (distributionState.insightActiveAsNum || distributionState.insightActiveType) { distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null; distributionState.insightActiveType = null; actions.hideInsightRect(); }
                        var activeBodyOut = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
                        if (activeBodyOut) { var prev = activeBodyOut.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                        // Highlight this row as the active selection
                        rowEl.classList.add('sub-filter-active');
                        // Track sub-filter state for data refresh preservation
                        distributionState.filterPeerIds = peerIds;
                        distributionState.filterCategory = 'conn-out';
                        distributionState.filterLabel = rowEl.dataset.as || '';
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        // Keep donut expanded for the parent provider
                        var asNum = rowEl.dataset.as;
                        if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                    });
                })(connOutRows[coi]);
            }

            // In rows already have .as-interactive-row class — handled by attachInteractiveRowHandlers if in provider panel,
            // but here in summary we need explicit handling. The .as-conn-dir-row In rows:
            var connDirRows = bodyEl.querySelectorAll('.as-conn-dir-row');
            for (var cdi = 0; cdi < connDirRows.length; cdi++) {
                (function (rowEl) {
                    function buildDirPeerHtml() {
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        if (peerIds.length === 0) return null;
                        var idSet = {};
                        for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                        var matchedPeers = [];
                        for (var i = 0; i < sourceData.peers.length; i++) {
                            if (idSet[sourceData.peers[i].id]) matchedPeers.push(sourceData.peers[i]);
                        }
                        var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                        html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Inbound Peers</div>';
                        html += '</div>';
                        html += view.buildPeerListHtmlForSubSub(matchedPeers);
                        return html;
                    }
                    rowEl.addEventListener('mouseenter', function (e) {
                        // When something is selected (pinned) or peer detail is open, suppress hover previews
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var asNum = rowEl.dataset.as;
                        if (asNum) actions.setLegendFocus(asNum);
                        var html = buildDirPeerHtml();
                        if (html) tooltips.showSubTooltip(html, e);
                        if (asNum && peerIds.length > 0) {
                            var color = actions.getColorForAsNum(asNum);
                            if (hooks.drawLinesForAs) hooks.drawLinesForAs(asNum, peerIds, color);
                            if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        }
                        if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                    });
                    rowEl.addEventListener('mouseleave', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        actions.clearLegendFocus();
                        tooltips.hideSubTooltip();
                        restoreSummaryFromPreview();
                        restoreDonutAfterPreview();
                    });
                    rowEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (tooltips.isPinnedTo(rowEl)) {
                            tooltips.hideSubTooltip();
                            distributionState.filterPeerIds = null;
                            distributionState.filterCategory = null;
                            distributionState.filterLabel = null;
                            if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                            if (distributionState.summarySelected) actions.activateHoverAll();
                            restoreDonutAfterPreview();
                            return;
                        }
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var html = buildDirPeerHtml();
                        if (!html) return;
                        tooltips.showSubTooltip(html, e);
                        tooltips.pinSubTooltip(rowEl);
                        tooltips.attachSubTooltipHandlers();
                        // Clear insight state
                        if (distributionState.insightActiveAsNum || distributionState.insightActiveType) { distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null; distributionState.insightActiveType = null; actions.hideInsightRect(); }
                        var activeBodyIn = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
                        if (activeBodyIn) { var prev = activeBodyIn.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                        // Highlight this row as the active selection
                        rowEl.classList.add('sub-filter-active');
                        // Track sub-filter state for data refresh preservation
                        distributionState.filterPeerIds = peerIds;
                        distributionState.filterCategory = 'conn-in';
                        distributionState.filterLabel = rowEl.dataset.as || '';
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        // Keep donut expanded for the parent provider
                        var asNum = rowEl.dataset.as;
                        if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                    });
                })(connDirRows[cdi]);
            }

            // Others row — 3-level: hover/click shows provider list, then provider → peer list
            var connOthersRows = bodyEl.querySelectorAll('.as-conn-others-row');
            for (var coi2 = 0; coi2 < connOthersRows.length; coi2++) {
                (function (rowEl) {
                    rowEl.addEventListener('mouseenter', function (e) {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var providers = JSON.parse(rowEl.dataset.providers);
                        var html = view.buildProviderListHtml(providers, 'Others', 'Others');
                        tooltips.showSubTooltip(html, e);
                        previewSummaryLines(peerIds);
                        previewSummaryCenterText(peerIds, 'Others');
                    });
                    rowEl.addEventListener('mousemove', function (e) {
                        if (!distributionState.subTooltipPinned) tooltips.positionSubTooltip(e);
                    });
                    rowEl.addEventListener('mouseleave', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        tooltips.hideSubTooltip();
                        restoreSummaryFromPreview();
                        restoreDonutAfterPreview();
                    });
                    rowEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (distributionState.peerDetailActive) actions.closePeerPopup();
                        var peerIds = JSON.parse(rowEl.dataset.peerIds);
                        var providers = JSON.parse(rowEl.dataset.providers);

                        // Toggle: clicking same row unpins
                        if (tooltips.isPinnedTo(rowEl)) {
                            tooltips.hideSubTooltip();
                            distributionState.filterPeerIds = null;
                            distributionState.filterCategory = null;
                            distributionState.filterLabel = null;
                            if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                            if (distributionState.summarySelected) actions.activateHoverAll();
                            restoreDonutAfterPreview();
                            return;
                        }

                        // Clear insight state
                        if (distributionState.insightActiveAsNum || distributionState.insightActiveType) {
                            distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null;
                            distributionState.insightActiveType = null;
                            actions.hideInsightRect();
                        }
                        // Clear all highlights before setting new ones
                        var activeBodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
                        if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                        rowEl.classList.add('sub-filter-active');

                        // Track sub-filter state — use 'conn-others' so refresh
                        // rebuilds from the Others donut segment, not summary categories
                        distributionState.filterPeerIds = peerIds;
                        distributionState.filterCategory = 'conn-others';
                        distributionState.filterLabel = 'Others';

                        // Draw lines grouped by AS for the Others peers
                        if (hooks.drawLinesForAllAs && sourceData.segments.length > 0) {
                            var idSet = {};
                            for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                            var groups = [];
                            for (var si = 0; si < sourceData.segments.length; si++) {
                                var seg = sourceData.segments[si];
                                var filteredIds = [];
                                for (var pi = 0; pi < seg.peerIds.length; pi++) {
                                    if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                                }
                                if (filteredIds.length > 0) {
                                    groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                                }
                            }
                            hooks.drawLinesForAllAs(groups);
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);

                        restoreDonutAfterPreview();

                        // Pin the sub-tooltip with provider list + "Open Others panel" nav link
                        var html = view.buildProviderListHtml(providers, 'Others', 'Others');
                        tooltips.showSubTooltip(html, e);
                        tooltips.pinSubTooltip(rowEl);
                        var tipEl2 = document.getElementById('as-sub-tooltip');
                        attachProviderClickHandlers(tipEl2);
                        attachProviderNavHandlers(tipEl2);
                    });
                })(connOthersRows[coi2]);
            }
        }

        function attachProviderNavHandlers(tip) {
            var provRows = tip.querySelectorAll('.as-provider-row');
            for (var i = 0; i < provRows.length; i++) {
                (function (provRow) {
                    var nameEl = provRow.querySelector('.as-provider-click');
                    if (nameEl) {
                        nameEl.addEventListener('click', function (e) {
                            e.stopPropagation();
                            var asNum = provRow.dataset.as;
                            if (asNum) {
                                tooltips.hideSubTooltip();
                                actions.navigateToProvider(asNum);
                            }
                        });
                    }
                })(provRows[i]);
            }
            // Also handle standalone provider-click links (e.g. "Open provider panel" in sub-tooltips)
            var provClicks = tip.querySelectorAll('.as-grid-provider-click');
            for (var i = 0; i < provClicks.length; i++) {
                (function (el) {
                    el.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var asNum = el.dataset.as;
                        if (asNum) {
                            tooltips.hideSubTooltip();
                            actions.navigateToProvider(asNum);
                        }
                    });
                })(provClicks[i]);
            }
        }

        function applySummarySubFilter(peerIds, label) {
            // Close peer detail popup when selecting from panel
            if (distributionState.peerDetailActive) actions.closePeerPopup();
            if (distributionState.filterPeerIds && label === distributionState.filterLabel) {
                clearSummarySubFilter();
                return;
            }
            // Clear any active insight state when switching to a different category
            if (distributionState.insightActiveAsNum || distributionState.insightActiveType) {
                distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null;
                distributionState.insightActiveType = null;
                actions.hideInsightRect();
                if (distributionState.donutFocused) actions.animateDonutRevert();
            }
            distributionState.filterPeerIds = peerIds;
            distributionState.filterCategory = 'summary';
            distributionState.filterLabel = label;
            if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
            if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
            // Draw lines for the filtered peers — group by AS for colored lines
            if (hooks.drawLinesForAllAs && sourceData.segments.length > 0) {
                var idSet = {};
                for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                var groups = [];
                for (var si = 0; si < sourceData.segments.length; si++) {
                    var seg = sourceData.segments[si];
                    var filteredIds = [];
                    for (var pi = 0; pi < seg.peerIds.length; pi++) {
                        if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                    }
                    if (filteredIds.length > 0) {
                        groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                    }
                }
                hooks.drawLinesForAllAs(groups);
            }
            highlightActiveSummaryRow();
            // Zoom map out to world view when selecting a new category
            if (hooks.resetMapZoom) hooks.resetMapZoom();
        }

        function clearSummarySubFilter() {
            distributionState.filterPeerIds = null;
            distributionState.filterLabel = null;
            distributionState.filterCategory = null;
            distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null;
            distributionState.insightActiveType = null;
            tooltips.hideSubTooltip();
            actions.hideInsightRect();
            // Restore to showing all peers
            if (hooks.filterPeerTable) hooks.filterPeerTable(null);
            if (hooks.dimMapPeers) hooks.dimMapPeers(null);
            // Re-draw all lines
            if (distributionState.summarySelected) actions.activateHoverAll();
            // Remove active highlights from both summary rows and insight rows
            var bodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
            if (bodyEl) {
                var rows = bodyEl.querySelectorAll('.sub-filter-active');
                for (var ri = 0; ri < rows.length; ri++) rows[ri].classList.remove('sub-filter-active');
            }
            // Revert donut expansion and center text (a conn-provider sub-filter
            // may have expanded a segment and shown provider name in center)
            actions.animateDonutRevert();
            actions.renderCenter();
            actions.renderLegend();
        }

        function highlightActiveSummaryRow() {
            var bodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
            if (!bodyEl) return;
            // Clear ALL highlights first (summary rows + insight rows + grid rows)
            var allActive = bodyEl.querySelectorAll('.sub-filter-active');
            for (var ai = 0; ai < allActive.length; ai++) allActive[ai].classList.remove('sub-filter-active');
            // Re-apply highlight to matching summary row
            if (distributionState.filterCategory === 'summary' && distributionState.filterLabel) {
                var rows = bodyEl.querySelectorAll('.as-summary-row');
                for (var ri = 0; ri < rows.length; ri++) {
                    if (rows[ri].dataset.catLabel === distributionState.filterLabel) {
                        rows[ri].classList.add('sub-filter-active');
                    }
                }
            }
            // Re-apply highlight to matching grid rows (conn-provider, conn-out, conn-in)
            if (distributionState.filterCategory && distributionState.filterCategory.indexOf('conn-') === 0 && distributionState.filterLabel) {
                var gridSelector = distributionState.filterCategory === 'conn-provider' ? '.as-conn-prov-row'
                    : distributionState.filterCategory === 'conn-out' ? '.as-conn-out-row'
                    : distributionState.filterCategory === 'conn-others' ? '.as-conn-others-row'
                    : '.as-conn-dir-row';
                var gridRows = bodyEl.querySelectorAll(gridSelector);
                for (var gi = 0; gi < gridRows.length; gi++) {
                    if (gridRows[gi].dataset.as === distributionState.filterLabel) {
                        gridRows[gi].classList.add('sub-filter-active');
                    }
                }
            }
        }

        function applySubFilter(peerIds, category, label) {
            if (distributionState.filterPeerIds && category === distributionState.filterCategory && label === distributionState.filterLabel) {
                // Clicking the same filter — toggle off
                clearSubFilter();
                return;
            }
            distributionState.filterPeerIds = peerIds;
            distributionState.filterCategory = category || null;
            distributionState.filterLabel = label || null;
            if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
            if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);

            // Draw lines for sub-filtered peers
            var seg = distributionState.selectedProvider ? actions.findActiveSegment(distributionState.selectedProvider) : null;
            if (!seg && distributionState.selectedProvider) {
                var grp = actions.findActiveGroup(distributionState.selectedProvider);
                if (grp) {
                    var othersSeg = actions.getActiveSegments().find(function (s) { return s.isOthers; });
                    seg = { asNumber: distributionState.selectedProvider, peerIds: grp.peerIds, color: othersSeg ? othersSeg.color : '#58a6ff' };
                }
            }
            if (seg && hooks.drawLinesForAs) {
                hooks.drawLinesForAs(distributionState.selectedProvider, peerIds, seg.color);
            }

            // Highlight the active row
            highlightActiveSubRow();
        }

        function highlightActiveSubRow() {
            var bodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
            if (!bodyEl) return;
            var rows = bodyEl.querySelectorAll('.as-interactive-row');
            for (var ri = 0; ri < rows.length; ri++) {
                if (distributionState.filterCategory && distributionState.filterLabel
                    && rows[ri].dataset.category === distributionState.filterCategory
                    && rows[ri].querySelector('.as-detail-sub-label').textContent === distributionState.filterLabel) {
                    rows[ri].classList.add('sub-filter-active');
                } else {
                    rows[ri].classList.remove('sub-filter-active');
                }
            }
        }

        function clearSubFilter() {
            distributionState.filterPeerIds = null;
            distributionState.filterLabel = null;
            distributionState.filterCategory = null;
            tooltips.hideSubTooltip();
            // Restore to full AS filter
            if (distributionState.selectedProvider) {
                var seg = actions.findActiveSegment(distributionState.selectedProvider);
                if (!seg) {
                    var grp = actions.findActiveGroup(distributionState.selectedProvider);
                    if (grp) {
                        var othersSeg = actions.getActiveSegments().find(function (s) { return s.isOthers; });
                        seg = { asNumber: distributionState.selectedProvider, peerIds: grp.peerIds, color: othersSeg ? othersSeg.color : '#58a6ff' };
                    }
                }
                if (seg) {
                    if (hooks.filterPeerTable) hooks.filterPeerTable(seg.peerIds);
                    if (hooks.dimMapPeers) hooks.dimMapPeers(seg.peerIds);
                    if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.selectedProvider, seg.peerIds, seg.color);
                }
            }
            // Remove active highlights
            var bodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
            if (bodyEl) {
                var rows = bodyEl.querySelectorAll('.as-interactive-row');
                for (var ri = 0; ri < rows.length; ri++) {
                    rows[ri].classList.remove('sub-filter-active');
                }
            }
        }

        function findPeerIdsByCategoryLabel(seg, category, label) {
            var fullGroup = seg.isOthers ? seg : actions.findActiveGroup(seg.asNumber);
            if (!fullGroup) return null;

            if (category === 'software' && fullGroup.versions) {
                for (var i = 0; i < fullGroup.versions.length; i++) {
                    if (fullGroup.versions[i].subver === label) {
                        return fullGroup.versions[i].peers.map(function (p) { return p.id; });
                    }
                }
            } else if (category === 'conntype') {
                var ctList = fullGroup.connTypesList || [];
                for (var i = 0; i < ctList.length; i++) {
                    var ctLabel = options.connectionTypeLabels[ctList[i].type] || ctList[i].type;
                    if (ctLabel === label) {
                        return ctList[i].peers.map(function (p) { return p.id; });
                    }
                }
                // Also check Others' connection types
                if (seg.isOthers) {
                    var allOtherPeers = [];
                    if (seg._othersGroups) {
                        for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                            for (var opi = 0; opi < seg._othersGroups[oi].peers.length; opi++) {
                                allOtherPeers.push(seg._othersGroups[oi].peers[opi]);
                            }
                        }
                    }
                    var connMap = {};
                    for (var ci = 0; ci < allOtherPeers.length; ci++) {
                        var ct = allOtherPeers[ci].connection_type || 'unknown';
                        var cl = options.connectionTypeLabels[ct] || ct;
                        if (!connMap[cl]) connMap[cl] = [];
                        connMap[cl].push(allOtherPeers[ci].id);
                    }
                    if (connMap[label]) return connMap[label];
                }
            } else if (category === 'country' && fullGroup.countries) {
                for (var i = 0; i < fullGroup.countries.length; i++) {
                    var cLabel = fullGroup.countries[i].code + '  ' + fullGroup.countries[i].name;
                    if (cLabel === label) {
                        return fullGroup.countries[i].peers.map(function (p) { return p.id; });
                    }
                }
            } else if (category === 'services' && fullGroup.servicesCombos) {
                for (var i = 0; i < fullGroup.servicesCombos.length; i++) {
                    if (fullGroup.servicesCombos[i].abbrev === label) {
                        return fullGroup.servicesCombos[i].peers.map(function (p) { return p.id; });
                    }
                }
            } else if (category === 'provider' && seg.isOthers && seg._othersGroups) {
                for (var i = 0; i < seg._othersGroups.length; i++) {
                    var g = seg._othersGroups[i];
                    var gName = g.asShort || g.asName || g.asNumber;
                    if (gName.length > 24) gName = gName.substring(0, 23) + '\u2026';
                    var pLabel = g.asNumber + ' \u00b7 ' + gName;
                    if (pLabel === label) {
                        return g.peerIds;
                    }
                }
            } else if (category === 'country-group' && seg.isOthers && seg._othersGroups) {
                for (var i = 0; i < seg._othersGroups.length; i++) {
                    var cg = seg._othersGroups[i];
                    var cLabel = (cg.countryCode || cg.asShort || '') + '  ' + (cg.countryName || cg.asName || cg.asNumber);
                    if (cLabel === label) {
                        return cg.peerIds;
                    }
                }
            } else if (category === 'country-provider' && fullGroup.peers) {
                var providers = actions.aggregateProvidersForPeers(fullGroup.peers);
                for (var i = 0; i < providers.length; i++) {
                    var prov = providers[i];
                    var pName = prov.name;
                    if (pName.length > 24) pName = pName.substring(0, 23) + '\u2026';
                    if (prov.asNumber + ' \u00b7 ' + pName === label) {
                        return prov.peerIds;
                    }
                }
            }
            return null;
        }

        function refresh() {
            // If summary is active, refresh — but DON'T rebuild the panel DOM if a
            // sub-tooltip is pinned (that destroys its source row and resets state).
            // Instead, just refresh lines/filters with fresh peer data.
            if (distributionState.summarySelected) {
                if (actions.isCountryLens()) {
                    var countrySumBodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
                    var countrySumScroll = countrySumBodyEl ? countrySumBodyEl.scrollTop : 0;
                    openCountrySummaryPanel();
                    if (countrySumBodyEl && countrySumScroll > 0) countrySumBodyEl.scrollTop = countrySumScroll;
                    if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                    if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                    actions.activateHoverAll();
                    actions.renderCenter();
                    actions.renderLegend();
                    return;
                }
                if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
                    // Sub-tooltip is open — preserve DOM. Refresh lines/filters with fresh peer data.

                    // PRIORITY 1: Sub-sub-tooltip pinned (e.g. IPv6 → Provider → Peers)
                    // Draw lines only for the specific provider, not the entire category.
                    if (distributionState.subSubTooltipPinned && distributionState.subSubFilterProvider) {
                        var provGroup = sourceData.groups.find(function (g) { return g.asNumber === distributionState.subSubFilterProvider; });
                        if (provGroup) {
                            var freshProvPeerIds = provGroup.peerIds;
                            // If there's a parent category filter (e.g. "IPv6"), intersect
                            if (distributionState.filterCategory === 'summary' && distributionState.filterLabel) {
                                var freshSumData = actions.computeSummaryData();
                                var freshCatPeerIds = null;
                                var allCats = [freshSumData.networks, freshSumData.hosting, freshSumData.countries, freshSumData.software, freshSumData.services];
                                for (var ci = 0; ci < allCats.length; ci++) {
                                    if (!allCats[ci]) continue;
                                    for (var ri = 0; ri < allCats[ci].length; ri++) {
                                        if (allCats[ci][ri].label === distributionState.filterLabel) {
                                            freshCatPeerIds = allCats[ci][ri].peerIds;
                                            break;
                                        }
                                    }
                                    if (freshCatPeerIds) break;
                                }
                                if (freshCatPeerIds) {
                                    distributionState.filterPeerIds = freshCatPeerIds;
                                    var catSet = {};
                                    for (var i = 0; i < freshCatPeerIds.length; i++) catSet[freshCatPeerIds[i]] = true;
                                    freshProvPeerIds = [];
                                    for (var i = 0; i < provGroup.peerIds.length; i++) {
                                        if (catSet[provGroup.peerIds[i]]) freshProvPeerIds.push(provGroup.peerIds[i]);
                                    }
                                }
                            } else if (distributionState.filterCategory === 'conn-others') {
                                // Others bucket — intersect provider with fresh Others peers
                                var othersSeg = sourceData.segments.find(function (s) { return s.isOthers; });
                                if (othersSeg) {
                                    distributionState.filterPeerIds = othersSeg.peerIds;
                                    var othSet = {};
                                    for (var i = 0; i < othersSeg.peerIds.length; i++) othSet[othersSeg.peerIds[i]] = true;
                                    freshProvPeerIds = [];
                                    for (var i = 0; i < provGroup.peerIds.length; i++) {
                                        if (othSet[provGroup.peerIds[i]]) freshProvPeerIds.push(provGroup.peerIds[i]);
                                    }
                                }
                            }
                            distributionState.subSubFilterPeerIds = freshProvPeerIds;
                            var ssColor = distributionState.subSubFilterColor || actions.getColorForAsNum(distributionState.subSubFilterProvider);
                            // If a peer is currently being hovered, preserve that single-peer view
                            if (distributionState.hoveredPeerId && freshProvPeerIds.indexOf(distributionState.hoveredPeerId) >= 0) {
                                if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.subSubFilterProvider, [distributionState.hoveredPeerId], ssColor);
                                if (hooks.filterPeerTable) hooks.filterPeerTable([distributionState.hoveredPeerId]);
                                if (hooks.dimMapPeers) hooks.dimMapPeers([distributionState.hoveredPeerId]);
                                // Preserve hovered peer's center text
                                if (distributionState.donutFocused) {
                                    var hPeer = sourceData.peers.find(function (p) { return p.id === distributionState.hoveredPeerId; });
                                    if (hPeer) actions.showPeerInDonutCenter(hPeer, ssColor);
                                }
                            } else {
                                if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.subSubFilterProvider, freshProvPeerIds, ssColor);
                                if (hooks.filterPeerTable) hooks.filterPeerTable(freshProvPeerIds);
                                if (hooks.dimMapPeers) hooks.dimMapPeers(freshProvPeerIds);
                                // Restore center text to the selected provider
                                if (distributionState.donutFocused) {
                                    actions.showFocusedCenterText(distributionState.subSubFilterProvider);
                                    actions.animateDonutExpand(distributionState.subSubFilterProvider);
                                }
                            }
                        }
                    }
                    // PRIORITY 2: Sub-tooltip pinned at category level (e.g. "IPv6" showing providers)
                    else if (distributionState.filterPeerIds && distributionState.filterCategory && distributionState.filterLabel) {
                        if (distributionState.filterCategory === 'summary') {
                            // Standard summary category — look up fresh peer IDs
                            var freshSumData = actions.computeSummaryData();
                            var freshPeerIds = null;
                            var allCats = [freshSumData.networks, freshSumData.hosting, freshSumData.countries, freshSumData.software, freshSumData.services];
                            for (var ci = 0; ci < allCats.length; ci++) {
                                if (!allCats[ci]) continue;
                                for (var ri = 0; ri < allCats[ci].length; ri++) {
                                    if (allCats[ci][ri].label === distributionState.filterLabel) {
                                        freshPeerIds = allCats[ci][ri].peerIds;
                                        break;
                                    }
                                }
                                if (freshPeerIds) break;
                            }
                            if (freshPeerIds && freshPeerIds.length > 0) {
                                distributionState.filterPeerIds = freshPeerIds;
                                // If a provider row is being hovered in the sub-tooltip, preserve that
                                if (distributionState.legendFocusProvider) {
                                    var hovProvGroup = sourceData.groups.find(function (g) { return g.asNumber === distributionState.legendFocusProvider; });
                                    if (hovProvGroup) {
                                        // Intersect provider peers with category-scoped freshPeerIds
                                        // so a 10-second refresh doesn't expand the preview beyond
                                        // the active filter (e.g. IPv6-only stays IPv6-only).
                                        var hovAllIds = hovProvGroup.peerIds;
                                        var freshSet = {};
                                        for (var fsi = 0; fsi < freshPeerIds.length; fsi++) freshSet[freshPeerIds[fsi]] = true;
                                        var hovPeerIds = [];
                                        for (var hfi = 0; hfi < hovAllIds.length; hfi++) {
                                            if (freshSet[hovAllIds[hfi]]) hovPeerIds.push(hovAllIds[hfi]);
                                        }
                                        var hovColor = actions.getColorForAsNum(distributionState.legendFocusProvider);
                                        if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.legendFocusProvider, hovPeerIds, hovColor);
                                        if (hooks.filterPeerTable) hooks.filterPeerTable(hovPeerIds);
                                        if (hooks.dimMapPeers) hooks.dimMapPeers(hovPeerIds);
                                        if (distributionState.donutFocused) {
                                            actions.showFocusedCenterText(distributionState.legendFocusProvider);
                                            actions.animateDonutExpand(distributionState.legendFocusProvider);
                                        }
                                    }
                                } else {
                                    if (hooks.filterPeerTable) hooks.filterPeerTable(freshPeerIds);
                                    if (hooks.dimMapPeers) hooks.dimMapPeers(freshPeerIds);
                                    if (hooks.drawLinesForAllAs && sourceData.segments.length > 0) {
                                        var idSet = {};
                                        for (var i = 0; i < freshPeerIds.length; i++) idSet[freshPeerIds[i]] = true;
                                        var groups = [];
                                        for (var si = 0; si < sourceData.segments.length; si++) {
                                            var seg = sourceData.segments[si];
                                            var filteredIds = [];
                                            for (var pi = 0; pi < seg.peerIds.length; pi++) {
                                                if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                                            }
                                            if (filteredIds.length > 0) {
                                                groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                                            }
                                        }
                                        hooks.drawLinesForAllAs(groups);
                                    }
                                }
                            }
                        } else if (distributionState.filterCategory === 'insight-stable') {
                            // "Most stable" insight — refresh by AS number stored in distributionState.filterLabel
                            var provGroup = sourceData.groups.find(function (g) { return g.asNumber === distributionState.filterLabel; });
                            if (provGroup) {
                                distributionState.filterPeerIds = provGroup.peerIds;
                                var color = actions.getColorForAsNum(distributionState.filterLabel);
                                if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.filterLabel, provGroup.peerIds, color);
                                if (hooks.filterPeerTable) hooks.filterPeerTable(provGroup.peerIds);
                                if (hooks.dimMapPeers) hooks.dimMapPeers(provGroup.peerIds);
                                // Preserve insight rect state
                                distributionState.insightActiveAsNum = distributionState.filterLabel;
                                if (distributionState.donutFocused && options.donut.isInsightVisible()) {
                                    var insRectData = actions.getInsightDataForActive();
                                    if (insRectData) actions.showInsightRect(distributionState.insightActiveType, insRectData);
                                } else if (distributionState.donutFocused) {
                                    actions.showFocusedCenterText(distributionState.filterLabel);
                                    actions.animateDonutExpand(distributionState.filterLabel);
                                }
                            }
                        } else if (distributionState.filterCategory === 'conn-provider') {
                            // Connection by Provider row — refresh by AS number in distributionState.filterLabel
                            var provGroup = sourceData.groups.find(function (g) { return g.asNumber === distributionState.filterLabel; });
                            if (provGroup) {
                                distributionState.filterPeerIds = provGroup.peerIds;
                                var color = actions.getColorForAsNum(distributionState.filterLabel);
                                // If a peer is being hovered, preserve that single-peer view
                                if (distributionState.hoveredPeerId && provGroup.peerIds.indexOf(distributionState.hoveredPeerId) >= 0) {
                                    if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.filterLabel, [distributionState.hoveredPeerId], color);
                                    if (hooks.filterPeerTable) hooks.filterPeerTable([distributionState.hoveredPeerId]);
                                    if (hooks.dimMapPeers) hooks.dimMapPeers([distributionState.hoveredPeerId]);
                                    if (distributionState.donutFocused) {
                                        var hPeer = sourceData.peers.find(function (p) { return p.id === distributionState.hoveredPeerId; });
                                        if (hPeer) actions.showPeerInDonutCenter(hPeer, color);
                                    }
                                } else {
                                    if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.filterLabel, provGroup.peerIds, color);
                                    if (hooks.filterPeerTable) hooks.filterPeerTable(provGroup.peerIds);
                                    if (hooks.dimMapPeers) hooks.dimMapPeers(provGroup.peerIds);
                                    // Preserve donut state for this provider
                                    if (distributionState.donutFocused) {
                                        actions.showFocusedCenterText(distributionState.filterLabel);
                                        actions.animateDonutExpand(distributionState.filterLabel);
                                    }
                                }
                            }
                        } else if (distributionState.filterCategory === 'conn-out') {
                            // Outbound connection row — refresh outbound peers for the AS
                            var provGroup = sourceData.groups.find(function (g) { return g.asNumber === distributionState.filterLabel; });
                            if (provGroup) {
                                var outPeerIds = [];
                                for (var i = 0; i < provGroup.peers.length; i++) {
                                    if (provGroup.peers[i].direction === 'outbound') outPeerIds.push(provGroup.peers[i].id);
                                }
                                distributionState.filterPeerIds = outPeerIds;
                                if (hooks.filterPeerTable) hooks.filterPeerTable(outPeerIds);
                                if (hooks.dimMapPeers) hooks.dimMapPeers(outPeerIds);
                                // Preserve donut state for this provider
                                if (distributionState.donutFocused) {
                                    actions.showFocusedCenterText(distributionState.filterLabel);
                                    actions.animateDonutExpand(distributionState.filterLabel);
                                }
                            }
                        } else if (distributionState.filterCategory === 'conn-in') {
                            // Inbound connection row — refresh inbound peers for the AS
                            var provGroup = sourceData.groups.find(function (g) { return g.asNumber === distributionState.filterLabel; });
                            if (provGroup) {
                                var inPeerIds = [];
                                for (var i = 0; i < provGroup.peers.length; i++) {
                                    if (provGroup.peers[i].direction === 'inbound') inPeerIds.push(provGroup.peers[i].id);
                                }
                                distributionState.filterPeerIds = inPeerIds;
                                if (hooks.filterPeerTable) hooks.filterPeerTable(inPeerIds);
                                if (hooks.dimMapPeers) hooks.dimMapPeers(inPeerIds);
                                // Preserve donut state for this provider
                                if (distributionState.donutFocused) {
                                    actions.showFocusedCenterText(distributionState.filterLabel);
                                    actions.animateDonutExpand(distributionState.filterLabel);
                                }
                            }
                        } else if (distributionState.filterCategory === 'conn-others') {
                            // Others bucket — refresh from the Others donut segment
                            var othersSeg = sourceData.segments.find(function (s) { return s.isOthers; });
                            if (othersSeg) {
                                var freshOthersPeerIds = othersSeg.peerIds;
                                distributionState.filterPeerIds = freshOthersPeerIds;
                                // If a provider is being hovered, intersect with Others peers
                                if (distributionState.legendFocusProvider) {
                                    var hovProvGroup = sourceData.groups.find(function (g) { return g.asNumber === distributionState.legendFocusProvider; });
                                    if (hovProvGroup) {
                                        var othSet = {};
                                        for (var oi = 0; oi < freshOthersPeerIds.length; oi++) othSet[freshOthersPeerIds[oi]] = true;
                                        var hovPeerIds = [];
                                        for (var hoi = 0; hoi < hovProvGroup.peerIds.length; hoi++) {
                                            if (othSet[hovProvGroup.peerIds[hoi]]) hovPeerIds.push(hovProvGroup.peerIds[hoi]);
                                        }
                                        var hovColor = actions.getColorForAsNum(distributionState.legendFocusProvider);
                                        if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.legendFocusProvider, hovPeerIds, hovColor);
                                        if (hooks.filterPeerTable) hooks.filterPeerTable(hovPeerIds);
                                        if (hooks.dimMapPeers) hooks.dimMapPeers(hovPeerIds);
                                        if (distributionState.donutFocused) {
                                            actions.showFocusedCenterText(distributionState.legendFocusProvider);
                                            actions.animateDonutExpand(distributionState.legendFocusProvider);
                                        }
                                    }
                                } else {
                                    if (hooks.filterPeerTable) hooks.filterPeerTable(freshOthersPeerIds);
                                    if (hooks.dimMapPeers) hooks.dimMapPeers(freshOthersPeerIds);
                                    if (hooks.drawLinesForAllAs && sourceData.segments.length > 0) {
                                        var idSet = {};
                                        for (var i = 0; i < freshOthersPeerIds.length; i++) idSet[freshOthersPeerIds[i]] = true;
                                        var groups = [];
                                        for (var si = 0; si < sourceData.segments.length; si++) {
                                            var seg = sourceData.segments[si];
                                            var filteredIds = [];
                                            for (var pi = 0; pi < seg.peerIds.length; pi++) {
                                                if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                                            }
                                            if (filteredIds.length > 0) {
                                                groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                                            }
                                        }
                                        hooks.drawLinesForAllAs(groups);
                                    }
                                }
                            }
                        } else if (distributionState.filterCategory === 'insight-fastest' || distributionState.filterCategory === 'insight-data-bytessent' || distributionState.filterCategory === 'insight-data-bytesrecv') {
                            // Insight ranking categories — preserve DOM, refresh lines for active provider
                            if (distributionState.insightActiveAsNum) {
                                var insProvGroup = sourceData.groups.find(function (g) { return g.asNumber === distributionState.insightActiveAsNum; });
                                if (insProvGroup) {
                                    var insColor = actions.getColorForAsNum(distributionState.insightActiveAsNum);
                                    // If sub-sub is drilled into a specific provider, respect that
                                    if (distributionState.subSubTooltipPinned && distributionState.subSubFilterProvider) {
                                        var ssProvGroup = sourceData.groups.find(function (g) { return g.asNumber === distributionState.subSubFilterProvider; });
                                        if (ssProvGroup) {
                                            distributionState.subSubFilterPeerIds = ssProvGroup.peerIds;
                                            var ssColor = distributionState.subSubFilterColor || actions.getColorForAsNum(distributionState.subSubFilterProvider);
                                            if (distributionState.hoveredPeerId && ssProvGroup.peerIds.indexOf(distributionState.hoveredPeerId) >= 0) {
                                                if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.subSubFilterProvider, [distributionState.hoveredPeerId], ssColor);
                                                if (hooks.filterPeerTable) hooks.filterPeerTable([distributionState.hoveredPeerId]);
                                                if (hooks.dimMapPeers) hooks.dimMapPeers([distributionState.hoveredPeerId]);
                                                // Preserve hovered peer's center text
                                                if (distributionState.donutFocused) {
                                                    var hPeer = sourceData.peers.find(function (p) { return p.id === distributionState.hoveredPeerId; });
                                                    if (hPeer) actions.showPeerInDonutCenter(hPeer, ssColor);
                                                }
                                            } else {
                                                if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.subSubFilterProvider, ssProvGroup.peerIds, ssColor);
                                                if (hooks.filterPeerTable) hooks.filterPeerTable(ssProvGroup.peerIds);
                                                if (hooks.dimMapPeers) hooks.dimMapPeers(ssProvGroup.peerIds);
                                            }
                                        }
                                    } else {
                                        if (hooks.drawLinesForAs) hooks.drawLinesForAs(distributionState.insightActiveAsNum, insProvGroup.peerIds, insColor);
                                        if (hooks.filterPeerTable) hooks.filterPeerTable(insProvGroup.peerIds);
                                        if (hooks.dimMapPeers) hooks.dimMapPeers(insProvGroup.peerIds);
                                    }
                                }
                            }
                        }
                        // Preserve insight rect state for all insight categories
                        // (but skip if a peer is being hovered — that takes priority)
                        if (distributionState.insightActiveAsNum && distributionState.donutFocused && !distributionState.hoveredPeerId) {
                            if (options.donut.isInsightVisible()) {
                                var insRectData = actions.getInsightDataForActive();
                                if (insRectData) actions.showInsightRect(distributionState.insightActiveType, insRectData);
                            } else {
                                actions.showFocusedCenterText(distributionState.insightActiveAsNum);
                                actions.animateDonutExpand(distributionState.insightActiveAsNum);
                            }
                        }
                    } else {
                        // No sub-filter, just keep all-lines going
                        actions.activateHoverAll();
                    }
                } else {
                    // No sub-tooltip pinned — safe to rebuild the panel
                    var savedSumCategory = distributionState.filterCategory;
                    var savedSumLabel = distributionState.filterLabel;
                    var savedInsightAsNum = distributionState.insightActiveAsNum;
                    var savedInsightType = distributionState.insightActiveType;

                    // Preserve scroll position across data refresh
                    var sumBodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
                    var savedSumScroll = sumBodyEl ? sumBodyEl.scrollTop : 0;
                    openSummaryPanel();
                    if (sumBodyEl && savedSumScroll > 0) sumBodyEl.scrollTop = savedSumScroll;

                    // Restore insight state after panel rebuild
                    distributionState.insightActiveAsNum = savedInsightAsNum;
                    distributionState.insightActiveType = savedInsightType;

                    if (savedSumCategory === 'summary' && savedSumLabel) {
                        var freshSumData = actions.computeSummaryData();
                        var freshPeerIds = null;
                        var allCats = [freshSumData.networks, freshSumData.hosting, freshSumData.countries, freshSumData.software, freshSumData.services];
                        for (var ci = 0; ci < allCats.length; ci++) {
                            if (!allCats[ci]) continue;
                            for (var ri = 0; ri < allCats[ci].length; ri++) {
                                if (allCats[ci][ri].label === savedSumLabel) {
                                    freshPeerIds = allCats[ci][ri].peerIds;
                                    break;
                                }
                            }
                            if (freshPeerIds) break;
                        }
                        if (freshPeerIds && freshPeerIds.length > 0) {
                            distributionState.filterPeerIds = freshPeerIds;
                            distributionState.filterCategory = savedSumCategory;
                            distributionState.filterLabel = savedSumLabel;
                            if (hooks.filterPeerTable) hooks.filterPeerTable(freshPeerIds);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(freshPeerIds);
                            highlightActiveSummaryRow();
                            if (hooks.drawLinesForAllAs && sourceData.segments.length > 0) {
                                var idSet = {};
                                for (var i = 0; i < freshPeerIds.length; i++) idSet[freshPeerIds[i]] = true;
                                var groups = [];
                                for (var si = 0; si < sourceData.segments.length; si++) {
                                    var seg = sourceData.segments[si];
                                    var filteredIds = [];
                                    for (var pi = 0; pi < seg.peerIds.length; pi++) {
                                        if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                                    }
                                    if (filteredIds.length > 0) {
                                        groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                                    }
                                }
                                hooks.drawLinesForAllAs(groups);
                            }
                        } else {
                            distributionState.filterPeerIds = null;
                            distributionState.filterCategory = null;
                            distributionState.filterLabel = null;
                            tooltips.hideSubTooltip();
                            tooltips.hideSubSubTooltip();
                            actions.activateHoverAll();
                        }
                    } else if (savedInsightAsNum) {
                        // Insight was active (e.g. Most Stable, Fastest) — preserve its rect/line state
                        var insightPeerIds = actions.getPeerIdsForAnyAs(savedInsightAsNum);
                        var insightColor = actions.getColorForAsNum(savedInsightAsNum);
                        if (insightPeerIds.length > 0 && hooks.drawLinesForAs) {
                            hooks.drawLinesForAs(savedInsightAsNum, insightPeerIds, insightColor);
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(insightPeerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(insightPeerIds);
                        actions.setLegendFocus(savedInsightAsNum);
                        if (distributionState.donutFocused) {
                            if (options.donut.isInsightVisible()) {
                                var insRectData = actions.getInsightDataForActive();
                                if (insRectData) actions.showInsightRect(distributionState.insightActiveType, insRectData);
                            } else {
                                actions.showFocusedCenterText(savedInsightAsNum);
                                actions.animateDonutExpand(savedInsightAsNum);
                            }
                        }
                    } else {
                        actions.activateHoverAll();
                    }
                }
            }
        }

        function attachSummaryHandlers(bodyEl) {
            attachSummaryRowHandlers(bodyEl);
            attachGridHandlers(bodyEl);
            insights.attachSummaryLinkHandlers(bodyEl);
            attachPanelBlankClickHandler(bodyEl);
        }

        return Object.freeze({
            openLensSummaryPanel,
            attachPanelBlankClickHandler,
            attachInteractiveRowHandlers,
            previewSummaryLines,
            previewProviderLines,
            previewSummaryCenterText,
            restoreSummaryFromPreview,
            clearSummarySubFilter,
            highlightActiveSubRow,
            clearSubFilter,
            findPeerIdsByCategoryLabel,
            refresh,
            attachSummaryHandlers,
            view,
            tooltips,
        });
    }

    global.BPMDistributionSummary = Object.freeze({ create });
})(window);
