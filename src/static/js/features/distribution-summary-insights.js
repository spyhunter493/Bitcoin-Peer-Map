/* Summary links and stable, ping, and traffic insight drill-down interactions. */
(function (global) {
    'use strict';

    function create(options) {
        const distributionState = options.state;
        const sourceData = options.data;
        const elements = options.elements;
        const hooks = options.hooks;
        const actions = options.actions;
        const distributionData = global.BPMDistributionData;
        const view = options.view;
        const tooltips = options.tooltips;

        function attachSummaryLinkHandlers(bodyEl) {
            // "Navigate to provider" links — hover previews lines to that provider's peers, click navigates
            var navLinks = bodyEl.querySelectorAll('.as-navigate-provider');
            for (var i = 0; i < navLinks.length; i++) {
                (function (el) {
                    el.addEventListener('mouseenter', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        var asNum = el.dataset.as;
                        if (!asNum) return;
                        // Focus legend on this provider
                        actions.setLegendFocus(asNum);
                        var peerIds = actions.getPeerIdsForAnyAs(asNum);
                        var color = actions.getColorForAsNum(asNum);
                        if (peerIds.length > 0 && hooks.drawLinesForAs) {
                            hooks.drawLinesForAs(asNum, peerIds, color);
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        // In focused mode, show provider in donut center + animate
                        if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                    });
                    el.addEventListener('mouseleave', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        actions.clearLegendFocus();
                        actions.restoreSummaryFromPreview();
                        actions.restoreDonutAfterPreview();
                    });
                    el.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var asNum = el.dataset.as;
                        if (asNum) actions.navigateToProvider(asNum);
                    });
                })(navLinks[i]);
            }

            // "All providers" links — opens sub-tooltip with all providers
            var allProvLinks = bodyEl.querySelectorAll('.as-all-providers-link');
            for (var i = 0; i < allProvLinks.length; i++) {
                (function (el) {
                    el.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (distributionState.peerDetailActive) actions.closePeerPopup();
                        // Toggle: clicking same link unpins
                        if (tooltips.isPinnedTo(el)) {
                            tooltips.hideSubTooltip();
                            distributionState.filterPeerIds = null;
                            distributionState.filterCategory = null;
                            distributionState.filterLabel = null;
                            if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                            if (distributionState.summarySelected) actions.activateHoverAll();
                            return;
                        }
                        var allProvs = sourceData.groups.map(function (g) {
                            return { asNumber: g.asNumber, name: g.asShort || g.asName || g.asNumber, color: actions.getColorForAsNum(g.asNumber), peerCount: g.peerCount, peerIds: g.peerIds, peers: g.peers };
                        });
                        var html = view.buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')');
                        tooltips.showSubTooltip(html, e);
                        tooltips.pinSubTooltip(el);
                        var tip = document.getElementById('as-sub-tooltip');
                        if (tip) {
                            actions.attachProviderClickHandlers(tip);
                            actions.attachProviderNavHandlers(tip);
                        }
                        // Track sub-filter state for data refresh preservation
                        distributionState.filterPeerIds = [];
                        distributionState.filterCategory = 'all-providers';
                        distributionState.filterLabel = 'all-providers';
                    });
                })(allProvLinks[i]);
            }

            // Header provider links
            if (elements.panel) {
                var headerProvLinks = elements.panel.querySelectorAll('.as-detail-header-info .as-all-providers-link');
                for (var i = 0; i < headerProvLinks.length; i++) {
                    (function (el) {
                        el.addEventListener('click', function (e) {
                            e.stopPropagation();
                            if (tooltips.isPinnedTo(el)) {
                                tooltips.hideSubTooltip();
                                distributionState.filterPeerIds = null;
                                distributionState.filterCategory = null;
                                distributionState.filterLabel = null;
                                if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                                if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                                if (distributionState.summarySelected) actions.activateHoverAll();
                                return;
                            }
                            var allProvs = sourceData.groups.map(function (g) {
                                return { asNumber: g.asNumber, name: g.asShort || g.asName || g.asNumber, color: actions.getColorForAsNum(g.asNumber), peerCount: g.peerCount, peerIds: g.peerIds, peers: g.peers };
                            });
                            var html = view.buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')');
                            tooltips.showSubTooltip(html, e);
                            tooltips.pinSubTooltip(el);
                            var tip = document.getElementById('as-sub-tooltip');
                            if (tip) {
                                actions.attachProviderClickHandlers(tip);
                                actions.attachProviderNavHandlers(tip);
                            }
                            // Track sub-filter state for data refresh preservation
                            distributionState.filterPeerIds = [];
                            distributionState.filterCategory = 'all-providers';
                            distributionState.filterLabel = 'all-providers';
                        });
                    })(headerProvLinks[i]);
                }
            }

            // "Fastest connection" link — hover shows providers ranked by avg ping, click pins
            var fastestLink = bodyEl.querySelector('.as-fastest-link');
            if (fastestLink) {
                function buildFastestProvHtml() {
                    var data = actions.computeSummaryData();
                    var fastInsight = null;
                    for (var j = 0; j < data.insights.length; j++) {
                        if (data.insights[j].type === 'fastest') { fastInsight = data.insights[j]; break; }
                    }
                    if (!fastInsight || !fastInsight.topProviders) return null;
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Fastest Connection \u2014 Avg Ping</div>';
                    html += '</div>';
                    html += '<div class="as-sub-tt-scroll">';
                    for (var pi = 0; pi < fastInsight.topProviders.length; pi++) {
                        var prov = fastInsight.topProviders[pi];
                        var peerIdsJson = JSON.stringify(prov.peerIds.slice(0, 20)).replace(/"/g, '&quot;');
                        html += '<div class="as-sub-tt-peer as-provider-row as-fastest-prov-row" data-as="' + prov.asNumber + '" data-peer-ids="' + peerIdsJson + '" data-rank="' + (pi + 1) + '" data-avg-ping="' + prov.avgPing.toFixed(1) + '">';
                        html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
                        html += '<span class="as-grid-dot" style="background:' + prov.color + '"></span>';
                        var name = prov.provName.length > 14 ? prov.provName.substring(0, 13) + '\u2026' : prov.provName;
                        html += '<span class="as-sub-tt-loc" title="' + prov.provName + '">' + name + '</span>';
                        html += '<span class="as-sub-tt-type">' + Math.round(prov.avgPing) + 'ms</span>';
                        html += '</div>';
                    }
                    html += '</div>';
                    return html;
                }
                fastestLink.addEventListener('mouseenter', function (e) {
                    // When something is selected (pinned) or peer detail is open, suppress hover previews
                    if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                    var html = buildFastestProvHtml();
                    if (html) tooltips.showSubTooltip(html, e);
                    // Preview lines for the #1 fastest provider + focus legend + show insight rect
                    var data = actions.computeSummaryData();
                    for (var j = 0; j < data.insights.length; j++) {
                        if (data.insights[j].type === 'fastest' && data.insights[j].topProviders && data.insights[j].topProviders.length > 0) {
                            var top = data.insights[j].topProviders[0];
                            actions.setLegendFocus(top.asNumber);
                            if (hooks.drawLinesForAs) hooks.drawLinesForAs(top.asNumber, top.peerIds, top.color);
                            if (hooks.filterPeerTable) hooks.filterPeerTable(top.peerIds);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(top.peerIds);
                            if (distributionState.donutFocused) {
                                actions.showInsightRect('fastest', {
                                    provName: top.provName || (top.asShort || top.asNumber),
                                    asNumber: top.asNumber,
                                    peerIds: top.peerIds,
                                    avgPing: top.avgPing,
                                    rank: 1,
                                    color: top.color || actions.getColorForAsNum(top.asNumber)
                                });
                                actions.animateDonutExpand(top.asNumber);
                            }
                            break;
                        }
                    }
                });
                fastestLink.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                    actions.clearLegendFocus();
                    tooltips.hideSubTooltip();
                    actions.hideInsightRect();
                    actions.restoreSummaryFromPreview();
                    actions.restoreDonutAfterPreview();
                });
                fastestLink.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (distributionState.peerDetailActive) actions.closePeerPopup();
                    if (tooltips.isPinnedTo(fastestLink)) {
                        tooltips.hideSubTooltip();
                        fastestLink.closest('.as-summary-insight').classList.remove('sub-filter-active');
                        distributionState.filterPeerIds = null;
                        distributionState.filterCategory = null;
                        distributionState.filterLabel = null;
                        distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null;
                        distributionState.insightActiveType = null;
                        actions.hideInsightRect();
                        if (distributionState.donutFocused) actions.animateDonutRevert();
                        if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                        if (distributionState.summarySelected) actions.activateHoverAll();
                        actions.renderCenter();
                        return;
                    }
                    var html = buildFastestProvHtml();
                    if (!html) return;
                    tooltips.showSubTooltip(html, e);
                    tooltips.pinSubTooltip(fastestLink);
                    attachFastestProvRowHandlers(document.getElementById('as-sub-tooltip'));
                    // Clear any other active highlights before adding ours
                    var activeBodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
                    if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                    fastestLink.closest('.as-summary-insight').classList.add('sub-filter-active');
                    // Track sub-filter state for data refresh preservation
                    distributionState.filterPeerIds = [];
                    distributionState.filterCategory = 'insight-fastest';
                    distributionState.filterLabel = 'fastest';
                    // Activate insight donut state — show insight rectangle for #1 fastest provider
                    var insData = actions.computeSummaryData();
                    for (var ij = 0; ij < insData.insights.length; ij++) {
                        if (insData.insights[ij].type === 'fastest' && insData.insights[ij].topProviders && insData.insights[ij].topProviders.length > 0) {
                            var topProv = insData.insights[ij].topProviders[0];
                            distributionState.insightActiveAsNum = topProv.asNumber;
                            distributionState.insightActiveType = 'fastest';
                            if (distributionState.donutFocused) {
                                actions.showInsightRect('fastest', {
                                    provName: topProv.provName,
                                    asNumber: topProv.asNumber,
                                    peerIds: topProv.peerIds,
                                    avgPing: topProv.avgPing,
                                    rank: 1,
                                    color: topProv.color || actions.getColorForAsNum(topProv.asNumber)
                                });
                            }
                            actions.setLegendFocus(topProv.asNumber);
                            // Also draw lines for #1 provider immediately
                            if (hooks.drawLinesForAs) hooks.drawLinesForAs(topProv.asNumber, topProv.peerIds, topProv.color);
                            if (hooks.filterPeerTable) hooks.filterPeerTable(topProv.peerIds);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(topProv.peerIds);
                            break;
                        }
                    }
                });
            }

            // "Most stable" link — hover shows peer list for that provider, click pins sub-panel
            var stableLink = bodyEl.querySelector('.as-stable-link');
            if (stableLink) {
                function buildStablePeersHtml() {
                    var data = actions.computeSummaryData();
                    var stableInsight = null;
                    for (var j = 0; j < data.insights.length; j++) {
                        if (data.insights[j].type === 'stable') { stableInsight = data.insights[j]; break; }
                    }
                    if (!stableInsight) return null;
                    var peerIds = stableInsight.peerIds;
                    var idSet = {};
                    for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                    var matchedPeers = [];
                    for (var i = 0; i < sourceData.peers.length; i++) {
                        if (idSet[sourceData.peers[i].id]) matchedPeers.push(sourceData.peers[i]);
                    }
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + stableInsight.provName + ' Peers</div>';
                    html += '<div class="as-sub-tt-nav as-grid-provider-click" data-as="' + stableInsight.asNumber + '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open provider panel</div>';
                    html += '</div>';
                    html += view.buildPeerListHtmlForSubSub(matchedPeers);
                    return { html: html, peerIds: peerIds, asNum: stableInsight.asNumber };
                }
                stableLink.addEventListener('mouseenter', function (e) {
                    // When something is selected (pinned) or peer detail is open, suppress hover previews
                    if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                    var asNum = stableLink.dataset.as;
                    if (asNum) actions.setLegendFocus(asNum);
                    var result = buildStablePeersHtml();
                    if (result) tooltips.showSubTooltip(result.html, e);
                    // Preview lines + filter for this provider + show insight rect
                    if (asNum) {
                        var peerIds = actions.getPeerIdsForAnyAs(asNum);
                        var color = actions.getColorForAsNum(asNum);
                        if (peerIds.length > 0 && hooks.drawLinesForAs) {
                            hooks.drawLinesForAs(asNum, peerIds, color);
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        if (distributionState.donutFocused) {
                            var insData = actions.computeSummaryData();
                            var stableIns = null;
                            for (var ij = 0; ij < insData.insights.length; ij++) {
                                if (insData.insights[ij].type === 'stable') { stableIns = insData.insights[ij]; break; }
                            }
                            if (stableIns) {
                                actions.showInsightRect('stable', {
                                    provName: stableIns.provName,
                                    asNumber: stableIns.asNumber,
                                    peerIds: stableIns.peerIds,
                                    durText: stableIns.durText,
                                    color: color
                                });
                            }
                            actions.animateDonutExpand(asNum);
                        }
                    }
                });
                stableLink.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                    actions.clearLegendFocus();
                    tooltips.hideSubTooltip();
                    actions.hideInsightRect();
                    actions.restoreSummaryFromPreview();
                    actions.restoreDonutAfterPreview();
                });
                stableLink.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (distributionState.peerDetailActive) actions.closePeerPopup();
                    // Toggle
                    if (tooltips.isPinnedTo(stableLink)) {
                        tooltips.hideSubTooltip();
                        stableLink.closest('.as-summary-insight').classList.remove('sub-filter-active');
                        distributionState.filterPeerIds = null;
                        distributionState.filterCategory = null;
                        distributionState.filterLabel = null;
                        distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null;
                        distributionState.insightActiveType = null;
                        actions.hideInsightRect();
                        if (distributionState.donutFocused) actions.animateDonutRevert();
                        if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                        if (distributionState.summarySelected) actions.activateHoverAll();
                        actions.renderCenter();
                        return;
                    }
                    var result = buildStablePeersHtml();
                    if (!result) return;
                    tooltips.showSubTooltip(result.html, e);
                    tooltips.pinSubTooltip(stableLink);
                    tooltips.attachSubTooltipHandlers();
                    var tip = document.getElementById('as-sub-tooltip');
                    if (tip) actions.attachProviderNavHandlers(tip);
                    // Clear any other active highlights before adding ours
                    var activeBodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
                    if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                    stableLink.closest('.as-summary-insight').classList.add('sub-filter-active');
                    // Track sub-filter state for data refresh preservation
                    distributionState.filterPeerIds = result.peerIds;
                    distributionState.filterCategory = 'insight-stable';
                    distributionState.filterLabel = result.asNum;
                    if (hooks.filterPeerTable) hooks.filterPeerTable(result.peerIds);
                    if (hooks.dimMapPeers) hooks.dimMapPeers(result.peerIds);
                    // Draw lines for this provider
                    var color = actions.getColorForAsNum(result.asNum);
                    if (hooks.drawLinesForAs && result.asNum) {
                        hooks.drawLinesForAs(result.asNum, result.peerIds, color);
                    }
                    // Activate insight donut state — show insight rectangle
                    distributionState.insightActiveAsNum = result.asNum;
                    distributionState.insightActiveType = 'stable';
                    if (distributionState.donutFocused) {
                        var insData = actions.computeSummaryData();
                        var stableIns = null;
                        for (var ij = 0; ij < insData.insights.length; ij++) {
                            if (insData.insights[ij].type === 'stable') { stableIns = insData.insights[ij]; break; }
                        }
                        if (stableIns) {
                            actions.showInsightRect('stable', {
                                provName: stableIns.provName,
                                asNumber: stableIns.asNumber,
                                peerIds: stableIns.peerIds,
                                durText: stableIns.durText,
                                color: color
                            });
                        }
                    }
                    actions.setLegendFocus(result.asNum);
                });
            }

            // Data insight provider sub-panels (Most sent/recv — hover shows providers ranked by bytes)
            var dataProvLinks = bodyEl.querySelectorAll('.as-data-providers-link');
            for (var i = 0; i < dataProvLinks.length; i++) {
                (function (el) {
                    var field = el.dataset.field;
                    var isRecv = field === 'bytesrecv';

                    function buildDataProviderHtml() {
                        var data = actions.computeSummaryData();
                        var insight = null;
                        for (var j = 0; j < data.insights.length; j++) {
                            if (data.insights[j].type === 'data-providers' && data.insights[j].field === field) {
                                insight = data.insights[j]; break;
                            }
                        }
                        if (!insight || !insight.topProviders) return null;

                        var title = isRecv ? 'Top Providers \u2014 Total Recv' : 'Top Providers \u2014 Total Sent';
                        var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                        html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + title + '</div>';
                        html += '</div>';
                        html += '<div class="as-sub-tt-scroll">';
                        for (var pi = 0; pi < insight.topProviders.length; pi++) {
                            var prov = insight.topProviders[pi];
                            var peerIdsJson = JSON.stringify(prov.peers.slice(0, 20).map(function (p) { return p.id; })).replace(/"/g, '&quot;');
                            html += '<div class="as-sub-tt-peer as-provider-row as-data-prov-row" data-as="' + prov.asNumber + '" data-peer-ids="' + peerIdsJson + '" data-field="' + field + '" data-rank="' + (pi + 1) + '" data-total-bytes="' + prov.totalBytes + '">';
                            html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
                            html += '<span class="as-grid-dot" style="background:' + prov.color + '"></span>';
                            var name = prov.provName.length > 14 ? prov.provName.substring(0, 13) + '\u2026' : prov.provName;
                            html += '<span class="as-sub-tt-loc" title="' + prov.provName + '">' + name + '</span>';
                            html += '<span class="as-sub-tt-type">' + distributionData.fmtBytes(prov.totalBytes) + '</span>';
                            html += '</div>';
                        }
                        html += '</div>';
                        return { html: html, insight: insight };
                    }

                    el.addEventListener('mouseenter', function (e) {
                        // When something is selected (pinned) or peer detail is open, suppress hover previews
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        var result = buildDataProviderHtml();
                        if (!result) return;
                        tooltips.showSubTooltip(result.html, e);
                        // Preview lines for the #1 data provider + focus legend + show insight rect
                        if (result.insight && result.insight.topProviders && result.insight.topProviders.length > 0) {
                            var top = result.insight.topProviders[0];
                            actions.setLegendFocus(top.asNumber);
                            var topPeerIds = top.peers.slice(0, 20).map(function (p) { return p.id; });
                            if (hooks.drawLinesForAs) hooks.drawLinesForAs(top.asNumber, topPeerIds, top.color);
                            if (hooks.filterPeerTable) hooks.filterPeerTable(topPeerIds);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(topPeerIds);
                            if (distributionState.donutFocused) {
                                var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                                actions.showInsightRect(rectType, {
                                    provName: top.provName,
                                    asNumber: top.asNumber,
                                    peers: top.peers,
                                    totalBytes: top.totalBytes,
                                    rank: 1,
                                    color: top.color || actions.getColorForAsNum(top.asNumber)
                                });
                                actions.animateDonutExpand(top.asNumber);
                            }
                        }
                    });
                    el.addEventListener('mouseleave', function () {
                        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                        actions.clearLegendFocus();
                        tooltips.hideSubTooltip();
                        actions.hideInsightRect();
                        actions.restoreSummaryFromPreview();
                        actions.restoreDonutAfterPreview();
                    });
                    el.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (distributionState.peerDetailActive) actions.closePeerPopup();
                        // Toggle: clicking same link unpins
                        if (tooltips.isPinnedTo(el)) {
                            tooltips.hideSubTooltip();
                            el.closest('.as-summary-insight').classList.remove('sub-filter-active');
                            distributionState.filterPeerIds = null;
                            distributionState.filterCategory = null;
                            distributionState.filterLabel = null;
                            distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null;
                            distributionState.insightActiveType = null;
                            actions.hideInsightRect();
                            if (distributionState.donutFocused) actions.animateDonutRevert();
                            if (hooks.filterPeerTable) hooks.filterPeerTable(null);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(null);
                            if (distributionState.summarySelected) actions.activateHoverAll();
                            actions.renderCenter();
                            return;
                        }
                        var result = buildDataProviderHtml();
                        if (!result) return;
                        tooltips.showSubTooltip(result.html, e);
                        tooltips.pinSubTooltip(el);
                        attachDataProviderRowHandlers(document.getElementById('as-sub-tooltip'), field);
                        // Clear any other active highlights before adding ours
                        var activeBodyEl = elements.panel ? elements.panel.querySelector('.as-detail-body') : null;
                        if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                        // Highlight this insight as active
                        el.closest('.as-summary-insight').classList.add('sub-filter-active');
                        // Track sub-filter state for data refresh preservation
                        distributionState.filterPeerIds = [];
                        distributionState.filterCategory = 'insight-data-' + field;
                        distributionState.filterLabel = field;
                        // Activate insight donut state — show insight rectangle for #1 data provider
                        var insDataResult = buildDataProviderHtml();
                        if (insDataResult && insDataResult.insight && insDataResult.insight.topProviders && insDataResult.insight.topProviders.length > 0) {
                            var topDataProv = insDataResult.insight.topProviders[0];
                            distributionState.insightActiveAsNum = topDataProv.asNumber;
                            distributionState.insightActiveType = 'data-' + field;
                            if (distributionState.donutFocused) {
                                var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                                actions.showInsightRect(rectType, {
                                    provName: topDataProv.provName,
                                    asNumber: topDataProv.asNumber,
                                    peers: topDataProv.peers,
                                    totalBytes: topDataProv.totalBytes,
                                    rank: 1,
                                    color: topDataProv.color || actions.getColorForAsNum(topDataProv.asNumber)
                                });
                            }
                            actions.setLegendFocus(topDataProv.asNumber);
                            var topDataPeerIds = topDataProv.peers.slice(0, 20).map(function (p) { return p.id; });
                            if (hooks.drawLinesForAs) hooks.drawLinesForAs(topDataProv.asNumber, topDataPeerIds, topDataProv.color);
                            if (hooks.filterPeerTable) hooks.filterPeerTable(topDataPeerIds);
                            if (hooks.dimMapPeers) hooks.dimMapPeers(topDataPeerIds);
                        }
                    });
                })(dataProvLinks[i]);
            }

            // "Show Private Networks" link — enter private network mode
            var pnLink = bodyEl.querySelector('.as-show-private-nets');
            if (pnLink) {
                pnLink.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (hooks.enterPrivateNetMode) hooks.enterPrivateNetMode();
                });
            }
        }

        function attachFastestProvRowHandlers(tip) {
            var provRows = tip.querySelectorAll('.as-fastest-prov-row');
            for (var pi = 0; pi < provRows.length; pi++) {
                (function (provRow) {
                    provRow.style.cursor = 'pointer';
                    provRow.addEventListener('mouseenter', function () {
                        if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                        var asNum = provRow.dataset.as;
                        var peerIds = JSON.parse(provRow.dataset.peerIds);
                        var rank = parseInt(provRow.dataset.rank) || 0;
                        // Focus legend on this provider
                        if (asNum) actions.setLegendFocus(asNum);
                        if (peerIds.length > 0 && hooks.drawLinesForAs && asNum) {
                            hooks.drawLinesForAs(asNum, peerIds, actions.getColorForAsNum(asNum));
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        // In focused mode, update insight rect for this provider
                        if (distributionState.donutFocused && asNum && options.donut.isInsightVisible()) {
                            var grp = sourceData.groups.find(function (g) { return g.asNumber === asNum; });
                            var avgPing = parseFloat(provRow.dataset.avgPing) || 0;
                            actions.showInsightRect('fastest', {
                                provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                                asNumber: asNum,
                                peerIds: peerIds,
                                avgPing: avgPing,
                                rank: rank,
                                color: actions.getColorForAsNum(asNum)
                            });
                            distributionState.insightActiveAsNum = asNum;
                        } else if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                    });
                    provRow.addEventListener('mouseleave', function () {
                        if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                        // On leave, restore to the pinned insight provider
                        if (options.donut.isInsightVisible()) {
                            actions.restoreInsightRectProvider();
                        } else {
                            actions.restoreSummaryFromPreview();
                        }
                    });
                    provRow.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var peerIds = JSON.parse(provRow.dataset.peerIds);
                        var asNum = provRow.dataset.as;
                        var rank = parseInt(provRow.dataset.rank) || 0;

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

                        var idSet = {};
                        for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                        var matchedPeers = [];
                        for (var i = 0; i < sourceData.peers.length; i++) {
                            if (idSet[sourceData.peers[i].id]) matchedPeers.push(sourceData.peers[i]);
                        }
                        matchedPeers.sort(function (a, b) { return (a.ping_ms || 9999) - (b.ping_ms || 9999); });

                        // Build sub-sub-tooltip with peers ranked by ping
                        var html = view.buildPingPeerListHtml(matchedPeers.slice(0, 20));
                        tooltips.showSubSubTooltip(html, e);
                        distributionState.subSubTooltipPinned = true;

                        // Track sub-sub state for data refresh preservation
                        distributionState.subSubFilterPeerIds = peerIds;
                        distributionState.subSubFilterProvider = asNum;
                        distributionState.subSubFilterColor = actions.getColorForAsNum(asNum);

                        if (hooks.drawLinesForAs && asNum) {
                            hooks.drawLinesForAs(asNum, peerIds, distributionState.subSubFilterColor);
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);

                        // Update insight rect to show selected provider
                        if (distributionState.donutFocused && options.donut.isInsightVisible()) {
                            var grp = sourceData.groups.find(function (g) { return g.asNumber === asNum; });
                            var avgPing = parseFloat(provRow.dataset.avgPing) || 0;
                            distributionState.insightActiveAsNum = asNum;
                            distributionState.insightActiveData = {
                                provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                                asNumber: asNum,
                                peerIds: peerIds,
                                avgPing: avgPing,
                                rank: rank,
                                color: actions.getColorForAsNum(asNum)
                            };
                            actions.showInsightRect('fastest', distributionState.insightActiveData);
                        }
                    });
                })(provRows[pi]);
            }
        }

        function attachDataProviderRowHandlers(tip, field) {
            var provRows = tip.querySelectorAll('.as-data-prov-row');
            for (var pi = 0; pi < provRows.length; pi++) {
                (function (provRow) {
                    provRow.style.cursor = 'pointer';
                    // Hover preview: show lines + filter for this provider's peers
                    provRow.addEventListener('mouseenter', function () {
                        if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                        var asNum = provRow.dataset.as;
                        var peerIds = JSON.parse(provRow.dataset.peerIds);
                        var rank = parseInt(provRow.dataset.rank) || 0;
                        // Focus legend on this provider
                        if (asNum) actions.setLegendFocus(asNum);
                        if (peerIds.length > 0 && hooks.drawLinesForAs && asNum) {
                            hooks.drawLinesForAs(asNum, peerIds, actions.getColorForAsNum(asNum));
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);
                        // In focused mode, update insight rect for this provider
                        if (distributionState.donutFocused && asNum && options.donut.isInsightVisible()) {
                            var grp = sourceData.groups.find(function (g) { return g.asNumber === asNum; });
                            var totalBytes = parseInt(provRow.dataset.totalBytes) || 0;
                            var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                            distributionState.insightActiveAsNum = asNum;
                            actions.showInsightRect(rectType, {
                                provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                                asNumber: asNum,
                                peers: peerIds,
                                totalBytes: totalBytes,
                                rank: rank,
                                color: actions.getColorForAsNum(asNum)
                            });
                        } else if (distributionState.donutFocused && asNum) {
                            actions.showFocusedCenterText(asNum);
                            actions.animateDonutExpand(asNum);
                        }
                    });
                    provRow.addEventListener('mouseleave', function () {
                        if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                        // On leave, restore to the pinned insight provider
                        if (options.donut.isInsightVisible()) {
                            actions.restoreInsightRectProvider();
                        } else {
                            actions.restoreSummaryFromPreview();
                        }
                    });
                    provRow.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var peerIds = JSON.parse(provRow.dataset.peerIds);
                        var asNum = provRow.dataset.as;
                        var rowField = provRow.dataset.field;

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

                        // Find matching peer objects from lastPeersRaw
                        var idSet = {};
                        for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                        var matchedPeers = [];
                        for (var i = 0; i < sourceData.peers.length; i++) {
                            if (idSet[sourceData.peers[i].id]) matchedPeers.push(sourceData.peers[i]);
                        }
                        // Sort by the relevant field
                        matchedPeers.sort(function (a, b) { return (b[rowField] || 0) - (a[rowField] || 0); });

                        // Build sub-sub-tooltip showing top 20 peers with bytes amounts
                        var html = view.buildDataPeerListHtml(matchedPeers.slice(0, 20), rowField);
                        tooltips.showSubSubTooltip(html, e);
                        distributionState.subSubTooltipPinned = true;

                        // Track sub-sub state for data refresh preservation
                        distributionState.subSubFilterPeerIds = peerIds;
                        distributionState.subSubFilterProvider = asNum;
                        distributionState.subSubFilterColor = actions.getColorForAsNum(asNum);

                        // Draw lines for this provider's peers
                        if (hooks.drawLinesForAs && asNum) {
                            hooks.drawLinesForAs(asNum, peerIds, distributionState.subSubFilterColor);
                        }
                        if (hooks.filterPeerTable) hooks.filterPeerTable(peerIds);
                        if (hooks.dimMapPeers) hooks.dimMapPeers(peerIds);

                        // Update insight rect to show selected data provider
                        if (distributionState.donutFocused && options.donut.isInsightVisible()) {
                            var grp = sourceData.groups.find(function (g) { return g.asNumber === asNum; });
                            var totalBytes = parseInt(provRow.dataset.totalBytes) || 0;
                            var rank = parseInt(provRow.dataset.rank) || 0;
                            var rectType = rowField === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                            distributionState.insightActiveAsNum = asNum;
                            distributionState.insightActiveData = {
                                provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                                asNumber: asNum,
                                peers: peerIds,
                                totalBytes: totalBytes,
                                rank: rank,
                                color: actions.getColorForAsNum(asNum)
                            };
                            actions.showInsightRect(rectType, distributionState.insightActiveData);
                        }
                    });
                })(provRows[pi]);
            }
        }

        return Object.freeze({
            attachSummaryLinkHandlers,
        });
    }

    global.BPMDistributionSummaryInsights = Object.freeze({ create });
})(window);
