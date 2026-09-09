/* ============================================================
   AS Distribution Analysis — JavaScript Module
   Isolated logic for the AS Distribution view.
   Delete this file to fully revert the feature.

   Integration points in app.js are marked with [AS-DISTRIBUTION].
   This module exposes window.ASDistribution for the main app to call.
   ============================================================ */

window.ASDistribution = (function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════

    const MAX_SEGMENTS = 8;      // Top N ASes in the donut, rest = "Others"
    const DONUT_SIZE = 260;      // SVG viewBox size
    const DONUT_RADIUS = 116;    // Outer radius of the donut ring
    const DONUT_WIDTH = 28;      // Width of the donut ring (default)
    const DONUT_WIDTH_SELECTED = 40;  // Width when selected (thicker)
    const DONUT_WIDTH_DIMMED = 14;    // Width when dimmed (thinner)

    // Curated colour palette — 9 colours (8 AS + Others), distinct and accessible
    const PALETTE = [
        '#f472b6',   // pink
        '#3fb950',   // green
        '#e3b341',   // gold
        '#f07178',   // coral
        '#8b5cf6',   // purple
        '#d2a8ff',   // lavender
        '#79c0ff',   // light blue
        '#f0883e',   // orange
        '#58a6ff',   // blue (Others)
    ];

    // ═══════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════

    const distributionState = window.BPMDistributionState.create();
    let asGroups = [];             // Aggregated AS data (sorted by count desc)
    let donutSegments = [];        // Top N + Others for donut rendering
    let countryGroups = [];        // Aggregated country/jurisdiction data
    let countryDonutSegments = []; // Top N + Others for country donut rendering
    let distributionScore = 0;        // 0-10 score
    let totalPeers = 0;
    let countryDistributionScore = 0;
    let countryTotalPeers = 0;

    let othersListOpen = false;    // True when Others popup is showing next to the donut
    let legendsHidden = false;     // True when "Display Top ISP/Net" toggle is OFF

    const DONUT_ANIM_DURATION = 400; // ms for expand/revert animation
    const DONUT_EXPAND_RATIO = 0.70; // expanded segment gets 70% of donut

    // DOM refs (cached on init)
    let containerEl = null;
    let titleEl = null;
    let lensToggleEl = null;
    let panelEl = null;
    let focusedCloseBtn = null;

    let lastPeersRaw = [];         // Raw peers from last update (for summary computation)

    // Integration hooks (set by app.js)
    let _drawLinesForAs = null;    // fn(asNumber, peerIds, color) — draw lines on canvas
    let _drawLinesForAllAs = null; // fn(groups) — draw lines for all AS groups at once
    let _clearAsLines = null;      // fn() — clear AS lines from canvas
    let _filterPeerTable = null;   // fn(peerIds | null) — filter peer table
    let _dimMapPeers = null;       // fn(peerIds | null) — dim non-matching peers
    let _zoomToPeerOnly = null;    // fn(peerId) — zoom to peer without deselecting AS panel
    let _resetMapZoom = null;      // fn() — smoothly zoom the map back to default view
    let _clearPeerSelection = null; // fn() — clear peer selection without zoom reset
    let _hideMapTooltip = null;    // fn() — hide the map peer tooltip
    let _enterPrivateNetMode = null; // fn(targetNet) — enter private network mode
    let _showDisconnectDialog = null; // fn(peerId, network) — shared peer-actions dialog

    // Service flag definitions (mirrored from app.js for hover expansion)
    var SERVICE_FLAGS = {
        'NETWORK':          { abbr: 'N',  label: 'Full chain history', rpc: 'NODE_NETWORK' },
        'WITNESS':          { abbr: 'W',  label: 'Segregated Witness', rpc: 'NODE_WITNESS' },
        'NETWORK_LIMITED':  { abbr: 'NL', label: 'Limited chain history', rpc: 'NODE_NETWORK_LIMITED' },
        'P2P_V2':           { abbr: 'P',  label: 'BIP324 v2 transport', rpc: 'P2P_V2' },
        'COMPACT_FILTERS':  { abbr: 'CF', label: 'Compact block filters', rpc: 'NODE_COMPACT_FILTERS' },
        'BLOOM':            { abbr: 'B',  label: 'Bloom filters', rpc: 'NODE_BLOOM' },
    };

    // Connection type short labels
    var CONN_TYPE_LABELS = {
        'outbound-full-relay': 'OUT/OFR',
        'block-relay-only': 'OUT/BRO',
        'manual': 'OUT/MAN',
        'addr-fetch': 'ADDR',
        'feeler': 'FEEL',
        'inbound': 'IN',
    };

    var CONN_TYPE_FULL = {
        'outbound-full-relay': 'Outbound Full Relay',
        'block-relay-only': 'Block Relay Only',
        'manual': 'Manual',
        'addr-fetch': 'Address Fetch',
        'feeler': 'Feeler',
        'inbound': 'Inbound',
    };

    // ═══════════════════════════════════════════════════════════
    // PARSING & AGGREGATION — delegated pure data module
    // ═══════════════════════════════════════════════════════════

    const distributionData = window.BPMDistributionData;
    const distributionDonut = window.BPMDistributionDonut;
    const parseAsNumber = distributionData.parseAsNumber;
    const parseAsOrg = distributionData.parseAsOrg;
    const fmtBytes = distributionData.fmtBytes;
    const fmtDuration = distributionData.fmtDuration;
    const buildDistributionGroup = distributionData.buildDistributionGroup;
    const getQuality = distributionDonut.getQuality;
    const buildScoreTooltip = distributionDonut.buildScoreTooltip;
    const escHtml = window.BPMModal.escapeHtml;
    const distributionNetworkPanel = window.BPMDistributionNetworkPanel;

    function aggregatePeers(peers) {
        const aggregation = distributionData.aggregateProviders(peers);
        totalPeers = aggregation.total;
        return aggregation.groups;
    }

    function aggregateCountryPeers(peers) {
        const aggregation = distributionData.aggregateCountries(peers);
        countryTotalPeers = aggregation.total;
        return aggregation.groups;
    }

    function calcDistributionScoreFor(groups, denominator) {
        return distributionData.distributionScore(groups, denominator);
    }

    function calcDistributionScore(groups) {
        return calcDistributionScoreFor(groups, totalPeers);
    }

    function buildDonutSegmentsFor(groups, denominator, othersNoun) {
        return distributionData.buildDonutSegments(groups, denominator, {
            maxSegments: MAX_SEGMENTS,
            palette: PALETTE,
            othersNoun: othersNoun,
        });
    }

    function buildDonutSegments(groups) {
        return buildDonutSegmentsFor(groups, totalPeers, 'providers');
    }

    function isCountryLens() {
        return distributionState.lens === 'country';
    }

    function getActiveGroups() {
        return isCountryLens() ? countryGroups : asGroups;
    }

    function getActiveSegments() {
        return isCountryLens() ? countryDonutSegments : donutSegments;
    }

    function getActiveTotalPeers() {
        return isCountryLens() ? countryTotalPeers : totalPeers;
    }

    function getActiveDistributionScore() {
        return isCountryLens() ? countryDistributionScore : distributionScore;
    }

    function getActiveEntityName(seg) {
        if (!seg) return '';
        if (seg.isOthers) return 'Others';
        return seg.asShort || seg.asName || seg.asNumber;
    }

    function getActiveEntityKind() {
        return isCountryLens() ? 'Country' : 'ISP';
    }

    function findActiveSegment(asNum) {
        var segments = getActiveSegments();
        return segments.find(function (s) { return s.asNumber === asNum; }) || null;
    }

    function findActiveGroup(asNum) {
        var groups = getActiveGroups();
        return groups.find(function (g) { return g.asNumber === asNum; }) || null;
    }

    function findActiveSegmentOrGroup(asNum) {
        var seg = findActiveSegment(asNum);
        if (seg) return seg;
        var grp = findActiveGroup(asNum);
        if (!grp) return null;
        var othersSeg = getActiveSegments().find(function (s) { return s.isOthers; });
        return {
            asNumber: grp.asNumber,
            asName: grp.asName,
            asShort: grp.asShort,
            countryCode: grp.countryCode || '',
            countryName: grp.countryName || '',
            isCountryGroup: !!grp.isCountryGroup,
            peerCount: grp.peerCount,
            percentage: grp.percentage,
            color: othersSeg ? othersSeg.color : '#58a6ff',
            riskLevel: grp.riskLevel,
            riskLabel: grp.riskLabel,
            peerIds: grp.peerIds,
            isOthers: false,
        };
    }

    function getPeerIdsForActiveEntity(asNum) {
        var seg = findActiveSegment(asNum);
        if (seg) return seg.peerIds;
        var grp = findActiveGroup(asNum);
        return grp ? grp.peerIds : [];
    }

    function getAllPeersForActiveSegment(seg) {
        if (!seg) return [];
        if (seg.isOthers && seg._othersGroups) {
            var all = [];
            for (var i = 0; i < seg._othersGroups.length; i++) {
                for (var j = 0; j < seg._othersGroups[i].peers.length; j++) {
                    all.push(seg._othersGroups[i].peers[j]);
                }
            }
            return all;
        }
        var grp = findActiveGroup(seg.asNumber);
        return grp ? grp.peers : [];
    }

    function getColorForActiveEntity(asNum) {
        var segments = getActiveSegments();
        for (var i = 0; i < segments.length; i++) {
            if (segments[i].asNumber === asNum) return segments[i].color;
            if (segments[i].isOthers && segments[i]._othersGroups) {
                for (var j = 0; j < segments[i]._othersGroups.length; j++) {
                    if (segments[i]._othersGroups[j].asNumber === asNum) return segments[i].color;
                }
            }
        }
        return PALETTE[PALETTE.length - 1];
    }

    function buildActiveScoreTooltip(score) {
        var q = getQuality(score);
        var noun = isCountryLens() ? 'countries and territories' : 'providers';
        return 'Distribution Score: ' + score.toFixed(1) + '/10 (' + q.word + ')\n'
             + 'Based on Herfindahl\u2013Hirschman Index (HHI)\n'
             + 'Higher = more evenly distributed peers across ' + noun;
    }

    // ═══════════════════════════════════════════════════════════
    // SUMMARY DATA COMPUTATION — delegated pure data module
    // ═══════════════════════════════════════════════════════════

    function getColorForAsNum(asNum) {
        return distributionData.colorForProvider(
            asNum,
            donutSegments,
            PALETTE[PALETTE.length - 1]
        );
    }

    function aggregateProvidersForPeers(peers) {
        return distributionData.aggregateProvidersForPeers(peers, donutSegments);
    }

    function computeSummaryData() {
        const data = distributionData.computeSummaryData({
            score: distributionScore,
            groups: asGroups,
            segments: donutSegments,
            peers: lastPeersRaw,
            connectionTypeLabels: CONN_TYPE_LABELS,
        });
        data.quality = getQuality(distributionScore);
        return data;
    }

    function computeCountrySummaryData() {
        const data = distributionData.computeCountrySummaryData(
            countryGroups,
            countryTotalPeers,
            countryDistributionScore
        );
        data.quality = getQuality(countryDistributionScore);
        return data;
    }

    // ═══════════════════════════════════════════════════════════
    // DONUT VIEW CONTROLLER — rendering delegated to distribution-donut.js
    // ═══════════════════════════════════════════════════════════

    const donutController = distributionDonut.create({
        state: distributionState,
        config: {
            size: DONUT_SIZE,
            radius: DONUT_RADIUS,
            width: DONUT_WIDTH,
            selectedWidth: DONUT_WIDTH_SELECTED,
            dimmedWidth: DONUT_WIDTH_DIMMED,
            expandedRatio: DONUT_EXPAND_RATIO,
            duration: DONUT_ANIM_DURATION,
            maxSegments: MAX_SEGMENTS,
        },
        getView: function () {
            return {
                segments: getActiveSegments(),
                groups: getActiveGroups(),
                totalPeers: getActiveTotalPeers(),
                countryLens: isCountryLens(),
            };
        },
        getColor: getColorForActiveEntity,
        onSegmentHover: onSegmentHover,
        onSegmentLeave: onSegmentLeave,
        onSegmentClick: onSegmentClick,
        onInsightClose: closeActiveInsight,
    });

    // Summary controllers share live state, data, DOM references, and integration hooks.
    const summaryController = window.BPMDistributionSummary.create({
        state: distributionState,
        donut: donutController,
        serviceFlags: SERVICE_FLAGS,
        connectionTypeLabels: CONN_TYPE_LABELS,
        data: {
            get peers() { return lastPeersRaw; },
            get groups() { return asGroups; },
            get segments() { return donutSegments; },
        },
        elements: {
            get panel() { return panelEl; },
            get container() { return containerEl; },
        },
        hooks: {
            get drawLinesForAs() { return _drawLinesForAs; },
            get drawLinesForAllAs() { return _drawLinesForAllAs; },
            get clearAsLines() { return _clearAsLines; },
            get filterPeerTable() { return _filterPeerTable; },
            get dimMapPeers() { return _dimMapPeers; },
            get zoomToPeerOnly() { return _zoomToPeerOnly; },
            get resetMapZoom() { return _resetMapZoom; },
            get enterPrivateNetMode() { return _enterPrivateNetMode; },
        },
        actions: {
            activateHoverAll,
            aggregateProvidersForPeers,
            animateDonutExpand,
            animateDonutRevert,
            buildActiveScoreTooltip,
            buildScoreTooltip,
            clearLegendFocus,
            clearLegendHighlight,
            closePeerPopup,
            computeCountrySummaryData,
            computeSummaryData,
            findActiveGroup,
            findActiveSegment,
            findActiveSegmentOrGroup,
            getActiveSegments,
            getActiveTotalPeers,
            getColorForActiveEntity,
            getColorForAsNum,
            getInsightDataForActive,
            getPeerIdsForActiveEntity,
            getPeerIdsForAnyAs,
            hideInsightRect,
            highlightLegendItem,
            isCountryLens,
            navigateToProvider,
            openPanel,
            openPeerDetailPanel,
            previewPeerInPopup,
            renderBackButton,
            renderCenter,
            renderLegend,
            restoreInsightRectProvider,
            restorePeerPopupToSelected,
            setLegendFocus,
            showFocusedCenterText,
            showInsightRect,
            showPeerInDonutCenter,
            updateInsightRectForPeer,
        },
    });

    function renderDonut() {
        donutController.renderDonut();
    }

    function animateDonutExpand(asNum) {
        donutController.animateExpand(asNum);
    }

    function animateDonutRevert() {
        donutController.animateRevert();
    }

    function stopDonutAnimation() {
        donutController.stopAnimation();
    }

    function showInsightRect(type, data) {
        donutController.showInsight(type, data);
    }

    function updateInsightRectForPeer(peer, provColor) {
        donutController.updateInsightPeer(peer, provColor, distributionState.insightActiveType);
    }

    function restoreInsightRectProvider() {
        if (!donutController.isInsightVisible() || !distributionState.insightActiveType || !distributionState.insightActiveAsNum) return;
        var data = getInsightDataForActive();
        if (data) showInsightRect(distributionState.insightActiveType, data);
        else if (distributionState.insightActiveData) showInsightRect(distributionState.insightActiveType, distributionState.insightActiveData);
    }

    function getInsightDataForActive() {
        if (!distributionState.insightActiveAsNum || !distributionState.insightActiveType) return null;
        var sumData = computeSummaryData();
        for (var i = 0; i < sumData.insights.length; i++) {
            var insight = sumData.insights[i];
            if (distributionState.insightActiveType === 'stable' && insight.type === 'stable') {
                return {
                    provName: insight.provName,
                    asNumber: insight.asNumber,
                    peerIds: insight.peerIds,
                    durText: insight.durText,
                    color: getColorForAsNum(insight.asNumber),
                };
            }
            if (distributionState.insightActiveType === 'fastest' && insight.type === 'fastest' && insight.topProviders) {
                for (var j = 0; j < insight.topProviders.length; j++) {
                    if (insight.topProviders[j].asNumber === distributionState.insightActiveAsNum) {
                        return {
                            provName: insight.topProviders[j].provName,
                            asNumber: insight.topProviders[j].asNumber,
                            peerIds: insight.topProviders[j].peerIds,
                            avgPing: insight.topProviders[j].avgPing,
                            rank: j + 1,
                            color: insight.topProviders[j].color ||
                                getColorForAsNum(insight.topProviders[j].asNumber),
                        };
                    }
                }
            }
            if (insight.type === 'data-providers' && insight.topProviders) {
                var matchesField = (
                    distributionState.insightActiveType === 'data-bytessent' && insight.field === 'bytessent'
                ) || (
                    distributionState.insightActiveType === 'data-bytesrecv' && insight.field === 'bytesrecv'
                );
                if (!matchesField) continue;
                for (var k = 0; k < insight.topProviders.length; k++) {
                    if (insight.topProviders[k].asNumber === distributionState.insightActiveAsNum) {
                        return {
                            provName: insight.topProviders[k].provName,
                            asNumber: insight.topProviders[k].asNumber,
                            peers: insight.topProviders[k].peers,
                            totalBytes: insight.topProviders[k].totalBytes,
                            rank: k + 1,
                            color: insight.topProviders[k].color ||
                                getColorForAsNum(insight.topProviders[k].asNumber),
                        };
                    }
                }
            }
        }
        return null;
    }

    function hideInsightRect() {
        donutController.hideInsight();
    }

    function closeActiveInsight() {
        hideInsightRect();
        distributionState.insightActiveAsNum = null;
        distributionState.insightActiveData = null;
        distributionState.insightActiveType = null;
        animateDonutRevert();
        renderCenter();
        if (distributionState.summarySelected) summaryController.clearSummarySubFilter();
    }

    function renderCenter() {
        var activePeerTotal = getActiveTotalPeers();
        donutController.clearLegendHover();
        if (distributionState.peerDetailActive) return;
        if (distributionState.donutFocused && distributionState.focusedHoverProvider && !distributionState.selectedProvider) {
            showFocusedCenterText(distributionState.focusedHoverProvider);
            return;
        }
        if (legendsHidden && !distributionState.donutFocused && distributionState.focusedHoverProvider && !distributionState.selectedProvider) {
            showLegendHoverCenterText(distributionState.focusedHoverProvider);
            return;
        }
        if (distributionState.insightActiveAsNum && distributionState.summarySelected &&
            !distributionState.selectedProvider && distributionState.donutFocused) {
            if (donutController.isInsightVisible()) {
                var insightData = getInsightDataForActive();
                if (insightData) showInsightRect(distributionState.insightActiveType, insightData);
            } else {
                showFocusedCenterText(distributionState.insightActiveAsNum);
            }
            return;
        }
        if (distributionState.donutFocused && distributionState.summarySelected &&
            distributionState.filterPeerIds && distributionState.filterLabel &&
            !distributionState.selectedProvider) {
            donutController.renderFilterCenter(
                distributionState.filterPeerIds.length,
                distributionState.filterLabel,
                activePeerTotal
            );
            return;
        }
        if (distributionState.donutFocused && distributionState.summarySelected &&
            distributionState.summaryPreviewPeerIds && distributionState.summaryPreviewLabel &&
            !distributionState.selectedProvider) {
            summaryController.previewSummaryCenterText(
                distributionState.summaryPreviewPeerIds,
                distributionState.summaryPreviewLabel
            );
            return;
        }
        if (distributionState.donutFocused && distributionState.activeNetwork && !distributionState.selectedProvider) {
            if (distributionState.filterPeerIds && distributionState.filterLabel) {
                donutController.renderFilterCenter(
                    distributionState.filterPeerIds.length,
                    distributionState.filterLabel,
                    activePeerTotal
                );
                return;
            }
            var networkKey = distributionState.activeNetwork;
            var networkPeerCount = lastPeersRaw.filter(function (peer) {
                return (peer.network || 'ipv4') === networkKey;
            }).length;
            donutController.renderNetworkCenter(networkKey, networkPeerCount, activePeerTotal);
            return;
        }
        if (distributionState.selectedProvider) {
            var segment = findActiveSegmentOrGroup(distributionState.selectedProvider);
            if (segment) {
                donutController.renderSelectedCenter(segment, {
                    focused: distributionState.donutFocused,
                    isSubProvider: isOthersSubProvider(distributionState.selectedProvider),
                    countryLens: isCountryLens(),
                    entityKind: getActiveEntityKind(),
                    onBack: backToOthersList,
                });
                return;
            }
        }
        donutController.renderScoreCenter(getActiveDistributionScore(), activePeerTotal, {
            countryLens: isCountryLens(),
            tooltip: buildActiveScoreTooltip(getActiveDistributionScore()),
        });
    }

    function renderLegend() {
        donutController.renderLegend();
    }

    function setLegendFocus(asNum) {
        if (distributionState.legendFocusProvider === asNum) return;
        distributionState.legendFocusProvider = asNum;
        renderLegend();
    }

    function clearLegendFocus() {
        if (!distributionState.legendFocusProvider) return;
        if (distributionState.subSubTooltipPinned) return;
        distributionState.legendFocusProvider = null;
        renderLegend();
    }

    // ═══════════════════════════════════════════════════════════
    // DETAIL PANEL — Right slide-in (pushes content)
    // ═══════════════════════════════════════════════════════════

    function openCountryPanel(countryId) {
        if (!panelEl) return;
        if (distributionState.peerDetailActive) closePeerPopup();

        var seg = findActiveSegment(countryId);
        var fullGroup = seg && seg.isOthers ? seg : findActiveGroup(countryId);
        if (!seg && fullGroup) seg = findActiveSegmentOrGroup(countryId);
        if (!seg || !fullGroup) return;

        renderBackButton();

        var asnEl = panelEl.querySelector('.as-detail-asn');
        var orgEl = panelEl.querySelector('.as-detail-org');
        var metaEl = panelEl.querySelector('.as-detail-meta');
        var barFill = panelEl.querySelector('.as-detail-bar-fill');
        var pctEl = panelEl.querySelector('.as-detail-pct');
        var riskEl = panelEl.querySelector('.as-detail-risk');

        var allPeers = getAllPeersForActiveSegment(seg);
        if (seg.isOthers) {
            fullGroup = buildDistributionGroup({
                asNumber: 'Others',
                asName: seg.asName,
                asShort: '',
                isCountryGroup: true
            }, allPeers, countryTotalPeers);
        }
        var providers = aggregateProvidersForPeers(allPeers);
        var titleCode = seg.isOthers ? 'Others' : (fullGroup.countryCode || fullGroup.asShort || 'Country');
        var titleName = seg.isOthers ? seg.asName : (fullGroup.countryName || fullGroup.asName || titleCode);

        if (asnEl) {
            asnEl.textContent = titleCode;
            asnEl.classList.remove('as-summary-title');
        }
        if (orgEl) orgEl.textContent = titleName;
        if (metaEl) {
            metaEl.innerHTML = '<span class="as-detail-type-badge">Jurisdiction</span>';
        }

        if (barFill) {
            barFill.style.width = seg.percentage.toFixed(1) + '%';
            barFill.style.background = seg.color;
        }
        if (pctEl) pctEl.textContent = seg.percentage.toFixed(1) + '% of geolocated peers';

        if (riskEl) {
            riskEl.className = 'as-detail-risk';
            if (seg.riskLevel !== 'low' && seg.riskLabel) {
                riskEl.classList.add('as-detail-risk-' + seg.riskLevel);
                riskEl.textContent = seg.riskLabel;
            } else {
                riskEl.textContent = '';
            }
        }

        var bodyEl = panelEl.querySelector('.as-detail-body');
        if (!bodyEl) return;

        var html = '';
        html += '<div class="modal-section-title">Summary</div>';
        html += summaryController.view.row('Total Peers', seg.peerCount);
        html += summaryController.view.row('Providers', providers.length);
        html += summaryController.view.row('Share', seg.percentage.toFixed(1) + '%');

        if (seg.isOthers && seg._othersGroups && seg._othersGroups.length > 0) {
            html += '<div class="modal-section-title">Countries &amp; Territories</div>';
            for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                var og = seg._othersGroups[oi];
                var oLabel = (og.countryCode || og.asShort || '') + '  ' + (og.countryName || og.asName || og.asNumber);
                html += summaryController.view.interactiveRow(oLabel, og.peerCount + ' peer' + (og.peerCount !== 1 ? 's' : ''), og.peerIds, 'country-group');
            }
        }

        if (fullGroup.connTypesList && fullGroup.connTypesList.length > 0) {
            html += '<div class="modal-section-title">Connections</div>';
            html += summaryController.view.row('Inbound', seg.isOthers ? allPeers.filter(function (p) { return p.direction === 'IN'; }).length : fullGroup.inboundCount);
            html += summaryController.view.row('Outbound', seg.isOthers ? allPeers.filter(function (p) { return p.direction !== 'IN'; }).length : fullGroup.outboundCount);
            for (var cti = 0; cti < fullGroup.connTypesList.length; cti++) {
                var ctItem = fullGroup.connTypesList[cti];
                var ctLabel = CONN_TYPE_LABELS[ctItem.type] || ctItem.type;
                html += summaryController.view.interactiveRow(ctLabel, ctItem.count, ctItem.peers.map(function (p) { return p.id; }), 'conntype');
            }
        }

        html += '<div class="modal-section-title">Performance</div>';
        html += summaryController.view.row('Avg Duration', fullGroup.avgDurationFmt || '\u2014');
        html += summaryController.view.row('Avg Ping', fullGroup.avgPingMs > 0 ? Math.round(fullGroup.avgPingMs) + 'ms' : '\u2014');
        html += summaryController.view.row('Data Sent', fullGroup.totalBytesSentFmt || fmtBytes(0));
        html += summaryController.view.row('Data Recv', fullGroup.totalBytesRecvFmt || fmtBytes(0));

        if (providers.length > 0) {
            html += '<div class="modal-section-title">Providers</div>';
            for (var pi = 0; pi < providers.length; pi++) {
                var prov = providers[pi];
                var pName = prov.name;
                if (pName.length > 24) pName = pName.substring(0, 23) + '\u2026';
                html += summaryController.view.interactiveRow(prov.asNumber + ' \u00b7 ' + pName, prov.peerCount + ' peer' + (prov.peerCount !== 1 ? 's' : ''), prov.peerIds, 'country-provider');
            }
        }

        if (fullGroup.versions && fullGroup.versions.length > 0) {
            html += '<div class="modal-section-title">Software</div>';
            for (var vi = 0; vi < fullGroup.versions.length; vi++) {
                html += summaryController.view.interactiveRow(fullGroup.versions[vi].subver, fullGroup.versions[vi].count + ' peer' + (fullGroup.versions[vi].count !== 1 ? 's' : ''), fullGroup.versions[vi].peers.map(function (p) { return p.id; }), 'software');
            }
        }

        if (fullGroup.servicesCombos && fullGroup.servicesCombos.length > 0) {
            html += '<div class="modal-section-title">Services</div>';
            for (var si = 0; si < fullGroup.servicesCombos.length; si++) {
                html += summaryController.view.interactiveRow(fullGroup.servicesCombos[si].abbrev, fullGroup.servicesCombos[si].count + ' peer' + (fullGroup.servicesCombos[si].count !== 1 ? 's' : ''), fullGroup.servicesCombos[si].peers.map(function (p) { return p.id; }), 'services');
            }
        }

        bodyEl.innerHTML = html;
        bodyEl.scrollTop = 0;
        summaryController.attachInteractiveRowHandlers(bodyEl, seg);
        summaryController.attachPanelBlankClickHandler(bodyEl);

        panelEl.classList.remove('hidden');
        void panelEl.offsetWidth;
        panelEl.classList.add('visible');
        document.body.classList.add('as-panel-open');
        document.body.classList.add('panel-focus-as');
        document.body.classList.remove('panel-focus-peers');
    }

    function openPanel(asNum) {
        if (!panelEl) return;
        if (isCountryLens()) {
            openCountryPanel(asNum);
            return;
        }
        if (distributionState.peerDetailActive) closePeerPopup();
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        var fullGroup;

        if (seg) {
            fullGroup = seg.isOthers ? seg : asGroups.find(function (g) { return g.asNumber === asNum; });
        } else {
            // Not a donut segment — find in asGroups (e.g. an "Others" sub-provider)
            fullGroup = asGroups.find(function (g) { return g.asNumber === asNum; });
            if (fullGroup) {
                seg = {
                    asNumber: fullGroup.asNumber,
                    asName: fullGroup.asName,
                    asShort: fullGroup.asShort,
                    peerCount: fullGroup.peerCount,
                    percentage: fullGroup.percentage,
                    color: getColorForAsNum(asNum),
                    riskLevel: fullGroup.riskLevel,
                    riskLabel: fullGroup.riskLabel,
                    peerIds: fullGroup.peerIds,
                    isOthers: false,
                    hostingLabel: fullGroup.hostingLabel,
                };
            }
        }
        if (!seg || !fullGroup) return;

        // Render back button
        renderBackButton();

        // Build header
        var asnEl = panelEl.querySelector('.as-detail-asn');
        var orgEl = panelEl.querySelector('.as-detail-org');
        var metaEl = panelEl.querySelector('.as-detail-meta');
        var barFill = panelEl.querySelector('.as-detail-bar-fill');
        var pctEl = panelEl.querySelector('.as-detail-pct');
        var riskEl = panelEl.querySelector('.as-detail-risk');

        if (asnEl) {
            asnEl.textContent = seg.isOthers ? 'Others' : seg.asNumber;
            asnEl.classList.remove('as-summary-title');
        }
        if (orgEl) orgEl.textContent = seg.isOthers ? seg.asName : (fullGroup.asName || seg.asNumber);

        // Meta badges
        if (metaEl && !seg.isOthers) {
            var hosting = fullGroup.hostingLabel || '';
            var hcls = hosting === 'Cloud/Hosting' ? 'hosting' : (hosting === 'Residential' ? 'residential' : '');
            metaEl.innerHTML = hosting ? '<span class="as-detail-type-badge ' + hcls + '">' + hosting + '</span>' : '';
        } else if (metaEl) {
            metaEl.innerHTML = '';
        }

        // Percentage bar
        if (barFill) {
            barFill.style.width = seg.percentage.toFixed(1) + '%';
            barFill.style.background = seg.color;
        }
        if (pctEl) pctEl.textContent = seg.percentage.toFixed(1) + '% of peers';

        // Risk label
        if (riskEl) {
            riskEl.className = 'as-detail-risk';
            if (seg.riskLevel !== 'low' && seg.riskLabel) {
                riskEl.classList.add('as-detail-risk-' + seg.riskLevel);
                riskEl.textContent = seg.riskLabel;
            } else {
                riskEl.textContent = '';
            }
        }

        // Build body
        var bodyEl = panelEl.querySelector('.as-detail-body');
        if (!bodyEl) return;

        var html = '';

        if (seg.isOthers) {
            // ── Others: enriched summary ──
            var allOtherPeers = [];
            if (seg._othersGroups) {
                for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                    for (var opi = 0; opi < seg._othersGroups[oi].peers.length; opi++) {
                        allOtherPeers.push(seg._othersGroups[oi].peers[opi]);
                    }
                }
            }

            html += '<div class="modal-section-title">Summary</div>';
            html += summaryController.view.row('Total Peers', seg.peerCount);
            html += summaryController.view.row('Providers', seg._othersGroups ? seg._othersGroups.length : '?');
            html += summaryController.view.row('Share', seg.percentage.toFixed(1) + '%');

            // Connection type breakdown for Others
            var otherConnMap = {};
            for (var oci = 0; oci < allOtherPeers.length; oci++) {
                var oct = allOtherPeers[oci].connection_type || 'unknown';
                if (!otherConnMap[oct]) otherConnMap[oct] = { count: 0, peers: [] };
                otherConnMap[oct].count++;
                otherConnMap[oct].peers.push(allOtherPeers[oci]);
            }
            var otherConnKeys = Object.keys(otherConnMap);
            for (var ock = 0; ock < otherConnKeys.length; ock++) {
                var octKey = otherConnKeys[ock];
                var octLabel = CONN_TYPE_LABELS[octKey] || octKey;
                var octPeerIds = otherConnMap[octKey].peers.map(function (p) { return p.id; });
                html += summaryController.view.interactiveRow(octLabel, otherConnMap[octKey].count, octPeerIds, 'conntype');
            }

            // Performance averages for Others
            var otherPings = [], otherDurations = [], otherSent = 0, otherRecv = 0;
            var nowSec = Math.floor(Date.now() / 1000);
            for (var opi2 = 0; opi2 < allOtherPeers.length; opi2++) {
                if (allOtherPeers[opi2].ping_ms > 0) otherPings.push(allOtherPeers[opi2].ping_ms);
                if (allOtherPeers[opi2].conntime > 0) {
                    var odur = nowSec - allOtherPeers[opi2].conntime;
                    if (odur > 0) otherDurations.push(odur);
                }
                otherSent += (allOtherPeers[opi2].bytessent || 0);
                otherRecv += (allOtherPeers[opi2].bytesrecv || 0);
            }
            var oAvgPing = otherPings.length > 0 ? otherPings.reduce(function (a, b) { return a + b; }, 0) / otherPings.length : 0;
            var oAvgDur = otherDurations.length > 0 ? otherDurations.reduce(function (a, b) { return a + b; }, 0) / otherDurations.length : 0;

            html += '<div class="modal-section-title">Performance</div>';
            html += summaryController.view.row('Avg Duration', fmtDuration(oAvgDur));
            html += summaryController.view.row('Avg Ping', oAvgPing > 0 ? Math.round(oAvgPing) + 'ms' : '\u2014');
            html += summaryController.view.row('Data Sent', fmtBytes(otherSent));
            html += summaryController.view.row('Data Recv', fmtBytes(otherRecv));

            if (seg._othersGroups && seg._othersGroups.length > 0) {
                html += '<div class="modal-section-title">All Providers</div>';
                for (var i = 0; i < seg._othersGroups.length; i++) {
                    var g = seg._othersGroups[i];
                    var gName = g.asShort || g.asName || g.asNumber;
                    if (gName.length > 24) gName = gName.substring(0, 23) + '\u2026';
                    html += summaryController.view.interactiveRow(
                        g.asNumber + ' \u00b7 ' + gName,
                        g.peerCount + ' peer' + (g.peerCount !== 1 ? 's' : ''),
                        g.peerIds,
                        'provider'
                    );
                }
            }
        } else {
            // ── Individual AS: connection types only (no duplicate inbound/outbound) ──
            html += '<div class="modal-section-title">Peers</div>';
            html += summaryController.view.interactiveRow('Total', fullGroup.peerCount, fullGroup.peerIds, 'conntype');

            // Show only connection types that exist, with short labels
            if (fullGroup.connTypesList && fullGroup.connTypesList.length > 0) {
                for (var cti = 0; cti < fullGroup.connTypesList.length; cti++) {
                    var ctItem = fullGroup.connTypesList[cti];
                    var ctLabel = CONN_TYPE_LABELS[ctItem.type] || ctItem.type;
                    var ctPeerIds = ctItem.peers.map(function (p) { return p.id; });
                    html += summaryController.view.interactiveRow(ctLabel, ctItem.count, ctPeerIds, 'conntype');
                }
            }

            html += '<div class="modal-section-title">Performance</div>';
            html += summaryController.view.row('Avg Duration', fullGroup.avgDurationFmt);
            html += summaryController.view.row('Avg Ping', fullGroup.avgPingMs > 0 ? Math.round(fullGroup.avgPingMs) + 'ms' : '\u2014');
            html += summaryController.view.row('Data Sent', fullGroup.totalBytesSentFmt);
            html += summaryController.view.row('Data Recv', fullGroup.totalBytesRecvFmt);

            if (fullGroup.versions && fullGroup.versions.length > 0) {
                html += '<div class="modal-section-title">Software</div>';
                for (var vi = 0; vi < fullGroup.versions.length; vi++) {
                    var vPeerIds = fullGroup.versions[vi].peers.map(function (p) { return p.id; });
                    html += summaryController.view.interactiveRow(fullGroup.versions[vi].subver, fullGroup.versions[vi].count + ' peer' + (fullGroup.versions[vi].count !== 1 ? 's' : ''), vPeerIds, 'software');
                }
            }

            if (fullGroup.countries && fullGroup.countries.length > 0) {
                html += '<div class="modal-section-title">Countries</div>';
                for (var ci = 0; ci < fullGroup.countries.length; ci++) {
                    var cPeerIds = fullGroup.countries[ci].peers.map(function (p) { return p.id; });
                    html += summaryController.view.interactiveRow(fullGroup.countries[ci].code + '  ' + fullGroup.countries[ci].name, fullGroup.countries[ci].count, cPeerIds, 'country');
                }
            }

            if (fullGroup.servicesCombos && fullGroup.servicesCombos.length > 0) {
                html += '<div class="modal-section-title">Services</div>';
                for (var si = 0; si < fullGroup.servicesCombos.length; si++) {
                    var sPeerIds = fullGroup.servicesCombos[si].peers.map(function (p) { return p.id; });
                    html += summaryController.view.interactiveRow(fullGroup.servicesCombos[si].abbrev, fullGroup.servicesCombos[si].count + ' peer' + (fullGroup.servicesCombos[si].count !== 1 ? 's' : ''), sPeerIds, 'services');
                }
            }
        }

        bodyEl.innerHTML = html;
        bodyEl.scrollTop = 0;

        // Attach hover/click handlers to all interactive rows
        summaryController.attachInteractiveRowHandlers(bodyEl, seg);
        summaryController.attachPanelBlankClickHandler(bodyEl);

        // Show panel with animation + push content
        panelEl.classList.remove('hidden');
        void panelEl.offsetWidth;
        panelEl.classList.add('visible');
        document.body.classList.add('as-panel-open');
        // Bring AS panel to front
        document.body.classList.add('panel-focus-as');
        document.body.classList.remove('panel-focus-peers');
    }

    function closePanel() {
        if (!panelEl) return;
        panelEl.classList.remove('visible');
        document.body.classList.remove('as-panel-open');
        document.body.classList.remove('panel-focus-as');
        setTimeout(function () {
            if (!panelEl.classList.contains('visible')) {
                panelEl.classList.add('hidden');
            }
        }, 310);
    }

    // ═══════════════════════════════════════════════════════════
    // SUMMARY STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /** Select the Summary Analysis view */
    function selectSummary() {
        if (distributionState.selectedProvider) deselect();
        distributionState.summarySelected = true;
        distributionState.hoveringAll = false;

        // Draw all lines (persistent)
        activateHoverAll();

        // Open the summary panel
        summaryController.openLensSummaryPanel();

        // Update donut center to show SUMMARY ANALYSIS as active
        renderCenter();
    }

    /** Deselect the Summary Analysis view */
    function deselectSummary() {
        if (!distributionState.summarySelected) return;
        distributionState.summarySelected = false;
        distributionState.panelHistory = [];
        distributionState.filterPeerIds = null;
        distributionState.filterLabel = null;
        distributionState.filterCategory = null;
        distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null;
        distributionState.insightActiveType = null;
        summaryController.tooltips.hideSubTooltip();
        summaryController.tooltips.hideSubSubTooltip();
        hideInsightRect();
        closePanel();
        deactivateHoverAll();
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        renderCenter();
    }

    // ═══════════════════════════════════════════════════════════
    // PANEL NAVIGATION — Back button, history, provider links
    // ═══════════════════════════════════════════════════════════

    /** Get peer IDs for any AS number (works for "Others" sub-providers too) */
    function getPeerIdsForAnyAs(asNum) {
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        if (seg) return seg.peerIds;
        var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
        return grp ? grp.peerIds : [];
    }

    /** Navigate to a provider's panel (with back button to return) */
    function navigateToProvider(asNum) {
        // Close any open map peer tooltip when navigating
        if (_hideMapTooltip) _hideMapTooltip();

        // Save current panel state to history
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
        var scrollTop = bodyEl ? bodyEl.scrollTop : 0;

        if (distributionState.summarySelected) {
            distributionState.panelHistory.push({ type: 'summary', scrollTop: scrollTop });
            distributionState.summarySelected = false;
        } else if (distributionState.selectedProvider) {
            distributionState.panelHistory.push({ type: 'provider', asNumber: distributionState.selectedProvider, scrollTop: scrollTop });
        }

        // Clear sub-filters and tooltips
        distributionState.filterPeerIds = null;
        distributionState.filterLabel = null;
        distributionState.filterCategory = null;
        summaryController.tooltips.hideSubTooltip();
        summaryController.tooltips.hideSubSubTooltip();

        // Navigate to provider panel
        distributionState.selectedProvider = asNum;
        openPanel(asNum);

        // Draw lines for this provider
        var peerIds = getPeerIdsForAnyAs(asNum);
        var color = getColorForAsNum(asNum);
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);
        if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);

        // Animate donut to expand this provider's segment
        animateDonutExpand(asNum);

        if (containerEl) containerEl.classList.add('as-legend-visible');
        renderCenter();
        renderLegend();
        // Zoom map out to world view when navigating to a new provider
        if (_resetMapZoom) _resetMapZoom();
    }

    /** Navigate back — always returns to distribution summary */
    function navigateBack() {
        // Close any open map peer tooltip when navigating back
        if (_hideMapTooltip) _hideMapTooltip();

        // Close Others popup if open
        if (othersListOpen) closeOthersListInDonut();

        // Always go back to distribution summary (clear all state)
        distributionState.activeNetwork = null;
        dismissPeerDetailView(false);
        distributionState.selectedProvider = null;
        distributionState.filterPeerIds = null;
        distributionState.filterLabel = null;
        distributionState.filterCategory = null;
        distributionState.insightActiveAsNum = null; distributionState.insightActiveData = null;
        distributionState.insightActiveType = null;
        distributionState.panelHistory = [];
        summaryController.tooltips.hideSubTooltip();
        summaryController.tooltips.hideSubSubTooltip();
        hideInsightRect();

        if (distributionState.donutFocused) {
            distributionState.summarySelected = true;
            summaryController.openLensSummaryPanel();
            animateDonutRevert();
            activateHoverAll();
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            renderCenter();
            renderLegend();
            if (_resetMapZoom) _resetMapZoom();
        } else {
            // Not in focused mode — exit fully
            deselect();
        }
    }

    /** Render the back button in the panel header (shown when history exists) */
    function renderBackButton() {
        if (!panelEl) return;
        var existing = panelEl.querySelector('.as-detail-back');
        if (distributionState.panelHistory.length > 0) {
            if (!existing) {
                existing = document.createElement('button');
                existing.className = 'as-detail-back';
                existing.title = 'Back';
                existing.innerHTML = '\u2190';  // ← left arrow = back
                existing.addEventListener('click', function (e) {
                    e.stopPropagation();
                    navigateBack();
                });
                var headerInfo = panelEl.querySelector('.as-detail-header-info');
                if (headerInfo) headerInfo.parentNode.insertBefore(existing, headerInfo);
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
        // Stage 0: If a network panel (IPv4/IPv6) is open, close it and return to summary
        if (distributionState.activeNetwork) {
            distributionState.activeNetwork = null;
            distributionState.selectedProvider = null;
            // If sub-tooltips are open, close those first
            if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
                summaryController.tooltips.hideSubTooltip();
                summaryController.tooltips.hideSubSubTooltip();
                distributionState.filterPeerIds = null;
                distributionState.filterLabel = null;
                distributionState.filterCategory = null;
            }
            // Return to summary view
            distributionState.summarySelected = true;
            distributionState.panelHistory = [];
            summaryController.openLensSummaryPanel();
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            activateHoverAll();
            renderDonut();
            renderCenter();
            renderLegend();
            return true;
        }

        // Stage 1: If peer detail popup is active, close it (and any sub-tooltips) in one click
        if (distributionState.peerDetailActive) {
            closePeerPopup();
            return true;
        }

        // Stage 1.5: If sub-tooltips are visible, close them
        if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
            summaryController.tooltips.hideSubTooltip();
            summaryController.tooltips.hideSubSubTooltip();
            // Restore to main state (summary or single AS)
            if (distributionState.summarySelected) {
                distributionState.filterPeerIds = null;
                distributionState.filterLabel = null;
                distributionState.filterCategory = null;
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                activateHoverAll();
                // Remove active highlights
                var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                if (bodyEl) {
                    var rows = bodyEl.querySelectorAll('.sub-filter-active');
                    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
                }
                // Revert donut expansion and center text (conn-provider sub-filter
                // may have expanded a segment and shown provider name in center)
                animateDonutRevert();
                renderCenter();
                renderLegend();
            } else if (distributionState.selectedProvider) {
                summaryController.clearSubFilter();
            }
            return true; // handled — don't close main panel
        }

        // Stage 2: If in a provider view, go back to summary
        if (distributionState.selectedProvider) {
            if (distributionState.donutFocused) {
                // In focused mode, go back to summary instead of closing
                if (othersListOpen) closeOthersListInDonut();
                distributionState.panelHistory = [];
                distributionState.selectedProvider = null;
                distributionState.hoveredProvider = null;
                animateDonutRevert();
                renderCenter();
                renderLegend();
                selectSummary();
                return true;
            }
            distributionState.panelHistory = [];
            deselect();
            return true;
        }

        // Stage 3: Close summary / exit focused mode
        if (distributionState.summarySelected) {
            if (distributionState.donutFocused) {
                exitFocusedMode();
            } else {
                deselectSummary();
            }
            return true;
        }

        // Stage 4: If just in focused mode with nothing selected, exit it
        if (distributionState.donutFocused) {
            exitFocusedMode();
            return true;
        }

        return false;
    }

    // ═══════════════════════════════════════════════════════════
    // FOCUSED MODE CENTER TEXT
    // ═══════════════════════════════════════════════════════════

    /** Check if an AS number belongs to an Others sub-provider (not in top-8 donut segments) */
    function isOthersSubProvider(asNum) {
        if (!asNum) return false;
        var inDonut = findActiveSegment(asNum);
        if (inDonut) return false;
        // Check if it exists in the active groups (real item, just not top-8)
        var grp = findActiveGroup(asNum);
        return !!grp;
    }

    /** Go back from an Others sub-provider to the Others segment with popup open */
    function backToOthersList() {
        var othersSeg = getActiveSegments().find(function (s) { return s.isOthers; });
        if (!othersSeg) return;
        // Clear sub-filters
        distributionState.filterPeerIds = null;
        distributionState.filterLabel = null;
        distributionState.filterCategory = null;
        summaryController.tooltips.hideSubTooltip();
        // Select the Others segment
        distributionState.selectedProvider = 'Others';
        openPanel('Others');
        if (_filterPeerTable) _filterPeerTable(othersSeg.peerIds);
        if (_dimMapPeers) _dimMapPeers(othersSeg.peerIds);
        if (_drawLinesForAs) _drawLinesForAs('Others', othersSeg.peerIds, othersSeg.color);
        animateDonutExpand('Others');
        renderCenter();
        renderLegend();
        // Re-open the popup list
        showOthersListInDonut();
    }

    // DONUT CENTER DELEGATES
    function showFocusedCenterText(asNum) {
        var segment = findActiveSegmentOrGroup(asNum);
        if (!segment) return;
        donutController.renderProviderCenter(segment, {
            isSubProvider: isOthersSubProvider(asNum),
            countryLens: isCountryLens(),
            entityKind: getActiveEntityKind(),
            onBack: backToOthersList,
        });
    }

    function showLegendHoverCenterText(asNum) {
        var segment = findActiveSegment(asNum);
        if (!segment) return;
        var rank = 0;
        var segments = getActiveSegments();
        for (var i = 0; i < segments.length; i++) {
            if (segments[i].isOthers) continue;
            rank++;
            if (segments[i].asNumber === asNum) break;
        }
        donutController.renderLegendHoverCenter(segment, {
            rank: rank,
            countryLens: isCountryLens(),
            entityKind: getActiveEntityKind(),
        });
    }

    function clearLegendHoverActive() {
        donutController.clearLegendHover();
    }

    /** Show scrollable Others provider list as a floating popup to the right of the donut.
     *  Each item is hoverable (preview lines) and clickable (opens provider panel). */
    function showOthersListInDonut() {
        var othersSeg = getActiveSegments().find(function (s) { return s.isOthers; });
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
        header.textContent = 'Others (' + othersSeg._othersGroups.length + (isCountryLens() ? ' countries)' : ' providers)');
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
                countSpan.textContent = g.peerCount;
                item.appendChild(nameSpan);
                item.appendChild(countSpan);
                item.title = (isCountryLens() ? (g.countryCode || '') : g.asNumber) + ' \u00b7 ' + (g.asName || g.asShort || '') + ' \u00b7 ' + g.peerCount + ' peer' + (g.peerCount !== 1 ? 's' : '');

                // Hover: preview lines and donut center for this provider's peers
                item.addEventListener('mouseenter', function () {
                    if (_drawLinesForAs) _drawLinesForAs(g.asNumber, g.peerIds, othersSeg.color);
                    if (_dimMapPeers) _dimMapPeers(g.peerIds);
                    showFocusedCenterText(g.asNumber);
                });
                item.dataset.as = g.asNumber;
                item.addEventListener('mouseleave', function () {
                    // Restore lines and donut center for current selection
                    if (distributionState.selectedProvider === 'Others') {
                        if (_drawLinesForAs) _drawLinesForAs('Others', othersSeg.peerIds, othersSeg.color);
                        if (_dimMapPeers) _dimMapPeers(othersSeg.peerIds);
                        showFocusedCenterText('Others');
                    } else if (distributionState.selectedProvider && isOthersSubProvider(distributionState.selectedProvider)) {
                        // Restore selected sub-provider's lines
                        var peerIds = getPeerIdsForAnyAs(distributionState.selectedProvider);
                        var color = getColorForAsNum(distributionState.selectedProvider);
                        if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, peerIds, color);
                        if (_dimMapPeers) _dimMapPeers(peerIds);
                        showFocusedCenterText(distributionState.selectedProvider);
                    } else {
                        activateHoverAll();
                        if (_dimMapPeers) _dimMapPeers(null);
                        renderCenter();
                    }
                });

                // Click: toggle or navigate to this provider's panel
                item.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (distributionState.selectedProvider === g.asNumber) {
                        // Toggle off — go back to Others list
                        backToOthersList();
                    } else {
                        if (isCountryLens()) {
                            distributionState.selectedProvider = g.asNumber;
                            openPanel(g.asNumber);
                            if (_filterPeerTable) _filterPeerTable(g.peerIds);
                            if (_dimMapPeers) _dimMapPeers(g.peerIds);
                            if (_drawLinesForAs) _drawLinesForAs(g.asNumber, g.peerIds, othersSeg.color);
                            renderCenter();
                            renderLegend();
                        } else {
                            // Select this sub-provider (keep popup open)
                            navigateToProvider(g.asNumber);
                        }
                        animateDonutExpand(g.asNumber);
                        updateOthersPopupHighlight();
                    }
                });

                listDiv.appendChild(item);
            })(groups[i]);
        }

        popup.appendChild(listDiv);

        // Position next to the donut wrap
        if (!donutController.appendToWrap(popup)) {
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
        var items = popup.querySelectorAll('.as-others-popup-item');
        for (var i = 0; i < items.length; i++) {
            if (items[i].dataset.as === distributionState.selectedProvider) {
                items[i].classList.add('as-others-popup-selected');
            } else {
                items[i].classList.remove('as-others-popup-selected');
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════

    function onSegmentHover(e) {
        var asNum = e.currentTarget.dataset.as;
        if (!asNum) return;
        // Don't show AS hover tooltip when a sub-tooltip is pinned or peer detail is active
        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
        distributionState.hoveredProvider = asNum;
        // No floating tooltip — legend highlighting replaces it
        highlightLegendItem(asNum);

        // In focused mode, show provider name in donut center on hover
        if (distributionState.donutFocused && !distributionState.selectedProvider) {
            distributionState.focusedHoverProvider = asNum;
            showFocusedCenterText(asNum);
        }

        // When legends are hidden (not focused), show provider info in donut center
        if (legendsHidden && !distributionState.donutFocused && !distributionState.selectedProvider) {
            distributionState.focusedHoverProvider = asNum;
            showLegendHoverCenterText(asNum);
        }

        // Temporarily remove all-hovered highlight so only this segment is bright
        if ((distributionState.hoveringAll || distributionState.summarySelected) && containerEl) {
            containerEl.classList.remove('as-all-hovered');
        }

        // Draw hover lines if nothing is selected, or if summary is selected (temporary override)
        if (!distributionState.selectedProvider) {
            var seg = findActiveSegment(asNum);
            if (seg && _drawLinesForAs) {
                _drawLinesForAs(asNum, seg.peerIds, seg.color);
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
            }
        }
    }

    function onSegmentLeave() {
        if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
        distributionState.hoveredProvider = null;
        clearLegendHighlight();

        // In focused mode, restore center text to default score display
        if (distributionState.donutFocused && !distributionState.selectedProvider) {
            distributionState.focusedHoverProvider = null;
            renderCenter();
        }

        // When legends are hidden (not focused), restore default center text
        if (legendsHidden && !distributionState.donutFocused && !distributionState.selectedProvider) {
            distributionState.focusedHoverProvider = null;
            clearLegendHoverActive();
            renderCenter();
        }

        // If there's an active sub-filter, restore to that instead of showing all
        if (distributionState.summarySelected && distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0 && !distributionState.selectedProvider) {
            summaryController.restoreSummaryFromPreview();
            return;
        }

        // If distributionState.hoveringAll or distributionState.summarySelected is active, restore all-lines state
        if ((distributionState.hoveringAll || distributionState.summarySelected) && !distributionState.selectedProvider) {
            activateHoverAll();
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            return;
        }

        // ONLY clear lines if nothing is selected — selection keeps its lines
        if (!distributionState.selectedProvider) {
            if (_clearAsLines) _clearAsLines();
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
        }
    }

    /** Add highlight class to the matching legend item */
    function highlightLegendItem(asNum) {
        donutController.highlightLegend(asNum);
    }

    /** Remove highlight class from all legend items */
    function clearLegendHighlight() {
        donutController.clearLegendHighlight();
    }

    /** Activate hover-all visual state: highlight all segments + draw all lines */
    function activateHoverAll() {
        if (containerEl) containerEl.classList.add('as-all-hovered');
        if (containerEl) containerEl.classList.add('as-legend-visible');
        // Build groups array and draw all lines
        var segments = getActiveSegments();
        if (_drawLinesForAllAs && segments.length > 0) {
            var groups = [];
            for (var i = 0; i < segments.length; i++) {
                var seg = segments[i];
                if (seg.peerIds && seg.peerIds.length > 0) {
                    groups.push({ asNum: seg.asNumber, peerIds: seg.peerIds, color: seg.color });
                }
            }
            _drawLinesForAllAs(groups);
        }
    }

    /** Deactivate hover-all visual state */
    function deactivateHoverAll() {
        if (containerEl) containerEl.classList.remove('as-all-hovered');
        if (containerEl) containerEl.classList.remove('as-legend-visible');
        if (_clearAsLines) _clearAsLines();
    }

    function onTitleEnter() {
        if (distributionState.selectedProvider || distributionState.summarySelected) return; // Don't override an active selection or summary
        distributionState.hoveringAll = true;
        activateHoverAll();
    }

    function onTitleLeave() {
        if (!distributionState.hoveringAll || distributionState.summarySelected) return;
        distributionState.hoveringAll = false;
        deactivateHoverAll();
    }

    function onSegmentClick(e) {
        var asNum = e.currentTarget.dataset.as;
        if (!asNum) return;

        // Close peer detail popup if open (user clicked a different segment)
        // Skip zoom reset — the segment view will set its own lines/filters
        if (distributionState.peerDetailActive) {
            closePeerPopup(true);
        }

        // Auto-enter focused mode if not already
        if (!distributionState.donutFocused) {
            distributionState.donutFocused = true;
            document.body.classList.add('donut-focused');
        }

        // If summary is active, close it and select this AS
        if (distributionState.summarySelected) {
            deselectSummary();
        }

        if (distributionState.selectedProvider === asNum) {
            // Deselect — go back to summary in focused mode
            if (distributionState.donutFocused) {
                if (othersListOpen) closeOthersListInDonut();
                distributionState.selectedProvider = null;
                distributionState.filterPeerIds = null;
                distributionState.filterLabel = null;
                distributionState.filterCategory = null;
                summaryController.tooltips.hideSubTooltip();
                closePanel();
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                animateDonutRevert();
                selectSummary();
                renderCenter();
                renderLegend();
            } else {
                animateDonutRevert();
                deselect();
            }
        } else {
            // Select this AS — clear any sub-filter from previous selection
            distributionState.filterPeerIds = null;
            distributionState.filterLabel = null;
            distributionState.filterCategory = null;
            summaryController.tooltips.hideSubTooltip();
            if (othersListOpen) closeOthersListInDonut();
            distributionState.selectedProvider = asNum;
            var seg = findActiveSegment(asNum);
            if (seg) {
                openPanel(asNum);
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(asNum, seg.peerIds, seg.color);

                // In focused mode, Others segment shows scrollable provider list inside donut
                if (distributionState.donutFocused && seg.isOthers) {
                    showOthersListInDonut();
                }
            }
            // Animate donut expansion
            animateDonutExpand(asNum);
            // Keep legend visible while selected
            if (containerEl) containerEl.classList.add('as-legend-visible');
            renderCenter();
            renderLegend();
            // Zoom map out to world view when selecting a new provider
            if (_resetMapZoom) _resetMapZoom();
        }
    }

    function deselect() {
        distributionState.activeNetwork = null;
        if (distributionState.summarySelected) {
            deselectSummary();
            return;
        }
        dismissPeerDetailView(false);
        distributionState.selectedProvider = null;
        distributionState.filterPeerIds = null;
        distributionState.filterLabel = null;
        distributionState.filterCategory = null;
        if (othersListOpen) closeOthersListInDonut();
        summaryController.tooltips.hideSubTooltip();
        hideInsightRect();
        closePanel();
        if (containerEl) containerEl.classList.remove('as-legend-visible');
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        if (_clearAsLines) _clearAsLines();
        if (donutController.getAnimationState() !== 'idle' &&
            donutController.getAnimationState() !== 'reverting') {
            animateDonutRevert();
        } else {
            renderDonut();
        }
        renderCenter();
        renderLegend();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            // The shared modal controller owns Escape while a peer action dialog is open.
            if (document.getElementById('disconnect-dialog')) return;
            // Close peer popup first
            if (distributionState.peerDetailActive && peerDetailController.isOpen()) {
                closePeerPopup();
                return;
            }
            if (distributionState.subSubTooltipPinned) {
                summaryController.tooltips.hideSubSubTooltip();
                // Restore to parent sub-filter state
                if (distributionState.summarySelected && distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0) {
                    if (_filterPeerTable) _filterPeerTable(distributionState.filterPeerIds);
                    if (_dimMapPeers) _dimMapPeers(distributionState.filterPeerIds);
                    // Re-draw lines for the parent sub-filter (not all lines)
                    if (_drawLinesForAllAs && donutSegments.length > 0) {
                        var idSet = {};
                        for (var i = 0; i < distributionState.filterPeerIds.length; i++) idSet[distributionState.filterPeerIds[i]] = true;
                        var groups = [];
                        for (var si = 0; si < donutSegments.length; si++) {
                            var seg = donutSegments[si];
                            var filteredIds = [];
                            for (var pi = 0; pi < seg.peerIds.length; pi++) {
                                if (idSet[seg.peerIds[pi]]) filteredIds.push(seg.peerIds[pi]);
                            }
                            if (filteredIds.length > 0) {
                                groups.push({ asNum: seg.asNumber, peerIds: filteredIds, color: seg.color });
                            }
                        }
                        _drawLinesForAllAs(groups);
                    }
                } else if (distributionState.summarySelected) {
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    activateHoverAll();
                }
                return;
            }
            if (distributionState.subTooltipPinned) {
                summaryController.tooltips.hideSubTooltip();
                // Restore to full summary or AS state
                if (distributionState.summarySelected) {
                    summaryController.clearSummarySubFilter();
                } else if (distributionState.selectedProvider) {
                    summaryController.clearSubFilter();
                }
                return;
            }
            // If a network panel is open, Escape goes back to summary
            if (distributionState.activeNetwork) {
                distributionState.activeNetwork = null;
                distributionState.selectedProvider = null;
                if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
                    summaryController.tooltips.hideSubTooltip();
                    summaryController.tooltips.hideSubSubTooltip();
                    distributionState.filterPeerIds = null;
                    distributionState.filterLabel = null;
                    distributionState.filterCategory = null;
                }
                distributionState.summarySelected = true;
                distributionState.panelHistory = [];
                summaryController.openLensSummaryPanel();
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                activateHoverAll();
                renderDonut();
                renderCenter();
                renderLegend();
                return;
            }
            if (distributionState.summarySelected) {
                if (distributionState.donutFocused) {
                    exitFocusedMode();
                } else {
                    deselectSummary();
                }
                return;
            }
            if (distributionState.selectedProvider) {
                deselect();
                return;
            }
            if (distributionState.donutFocused) {
                exitFocusedMode();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FOCUSED MODE — Donut moves to top-center, layout rearranges
    // ═══════════════════════════════════════════════════════════

    /** Enter focused mode: donut to top-center, BTC price to left, map controls to right */
    function enterFocusedMode() {
        if (distributionState.donutFocused) return;
        distributionState.donutFocused = true;
        document.body.classList.add('donut-focused');

        // Hide the legend (top 8 list) — it only shows in default mode or on interaction
        var legend = donutController.getLegendElement();
        if (legend) {
            legend.style.display = '';
        }

        // Activate hover-all to show lines from donut center in focused mode
        distributionState.hoveringAll = false;
        activateHoverAll();

        // Open summary panel automatically
        selectSummary();
    }

    /** Exit focused mode: everything returns to default positions */
    function exitFocusedMode() {
        if (!distributionState.donutFocused) return;
        distributionState.donutFocused = false;
        distributionState.focusedHoverProvider = null;
        dismissPeerDetailView(false);
        distributionState.activeNetwork = null;
        if (othersListOpen) closeOthersListInDonut();
        document.body.classList.remove('donut-focused');

        // Revert donut animation
        stopDonutAnimation();
        hideInsightRect();

        // Deselect everything
        if (distributionState.summarySelected) deselectSummary();
        else if (distributionState.selectedProvider) deselect();
        else closePanel(); // Network panel or other non-summary/non-AS state
        distributionState.hoveringAll = false;
        deactivateHoverAll();
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        if (_clearAsLines) _clearAsLines();

        // Auto zoom-out to default map view
        if (_resetMapZoom) _resetMapZoom();

        // Reset center display
        renderDonut();
        renderCenter();
        renderLegend();
    }

    /** Check if focused mode is active */
    function isFocusedMode() {
        return distributionState.donutFocused;
    }

    // ═══════════════════════════════════════════════════════════
    // PEER DETAIL POPUP — delegated view controller
    // ═══════════════════════════════════════════════════════════

    const peerDetailController = window.BPMDistributionPeerDetail.create({
        getPeers: () => lastPeersRaw,
        getProviderColor: getColorForAsNum,
        connectionTypeLabels: CONN_TYPE_FULL,
        serviceFlags: SERVICE_FLAGS,
        onRequestClose: () => closePeerPopup(),
        onRequestPeer: (peer, source) => openPeerDetailPanel(peer, source),
        onRequestGroup: peerIds => openMultiPeerPopup(peerIds),
        onDisconnect: (peerId, network) => {
            if (_showDisconnectDialog) _showDisconnectDialog(peerId, network);
        },
    });

    function dismissPeerDetailView(restoreFocus) {
        distributionState.peerDetailActive = false;
        distributionState.selectedPeerId = null;
        peerDetailController.close({ restoreFocus: restoreFocus !== false });
    }

    function previewPeerInPopup(peer) {
        if (distributionState.peerDetailActive) peerDetailController.previewPeer(peer);
    }

    function restorePeerPopupToSelected() {
        peerDetailController.restorePreview();
    }

    function closePeerPopup(skipZoomReset) {
        dismissPeerDetailView(!skipZoomReset);

        if (distributionState.summarySelected) {
            if (distributionState.insightActiveAsNum) {
                var peerIds = getPeerIdsForAnyAs(distributionState.insightActiveAsNum);
                var color = getColorForAsNum(distributionState.insightActiveAsNum);
                if (_drawLinesForAs) _drawLinesForAs(distributionState.insightActiveAsNum, peerIds, color);
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
            } else if (distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0) {
                summaryController.previewSummaryLines(distributionState.filterPeerIds);
            } else {
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                activateHoverAll();
            }
            renderCenter();
        } else if (distributionState.selectedProvider) {
            var seg = donutSegments.find(function (item) { return item.asNumber === distributionState.selectedProvider; });
            if (!seg) {
                var group = asGroups.find(function (item) { return item.asNumber === distributionState.selectedProvider; });
                if (group) {
                    var others = donutSegments.find(function (item) { return item.isOthers; });
                    seg = {
                        asNumber: distributionState.selectedProvider,
                        peerIds: group.peerIds,
                        color: others ? others.color : '#58a6ff'
                    };
                }
            }
            if (seg) {
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, seg.peerIds, seg.color);
            }
            renderCenter();
        } else {
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            if (_clearAsLines) _clearAsLines();
            renderCenter();
        }

        if (!skipZoomReset && _resetMapZoom) {
            _resetMapZoom();
        } else if (skipZoomReset && _clearPeerSelection) {
            _clearPeerSelection();
        }
        document.querySelectorAll('.as-sub-tt-peer-selected').forEach(function (element) {
            element.classList.remove('as-sub-tt-peer-selected');
        });
    }

    function openMultiPeerPopup(peerIds) {
        distributionState.peerDetailActive = true;
        distributionState.selectedPeerId = null;
        peerDetailController.openGroup(peerIds);
    }

    function openPeerDetailPanel(peer, source) {
        distributionState.peerDetailActive = true;
        distributionState.selectedPeerId = peer.id;

        var asNum = parseAsNumber(peer.as);
        var provColor = asNum ? getColorForAsNum(asNum) : '#6e7681';
        if (!distributionState.donutFocused) {
            distributionState.donutFocused = true;
            document.body.classList.add('donut-focused');
            if (!distributionState.summarySelected && !distributionState.selectedProvider) selectSummary();
            distributionState.peerDetailActive = true;
            distributionState.selectedPeerId = peer.id;
        }

        if (_drawLinesForAs && asNum) _drawLinesForAs(asNum, [peer.id], provColor);
        if (_filterPeerTable) _filterPeerTable([peer.id]);
        if (_dimMapPeers) _dimMapPeers([peer.id]);
        showPeerInDonutCenter(peer, provColor);
        peerDetailController.openPeer(peer, source);
    }

    /** Show peer ID and provider in donut center */
    function showPeerInDonutCenter(peer, color) {
        donutController.renderPeerCenter(peer, color);
    }

    // ═══════════════════════════════════════════════════════════
    // PUBLIC API — Called by app.js
    // ═══════════════════════════════════════════════════════════

    function updateLensChrome() {
        if (containerEl) {
            containerEl.dataset.lens = distributionState.lens;
        }
        if (titleEl) {
            if (isCountryLens()) {
                titleEl.innerHTML = '<span class="as-title-peer">Peer</span> <span class="as-title-provider">Countries</span><span class="as-title-subtitle" id="as-title-subtitle">(jurisdiction risk)</span>';
                titleEl.title = 'Country and territory peer distribution analysis';
            } else {
                titleEl.innerHTML = '<span class="as-title-peer">Peer</span> <span class="as-title-provider">Service Providers</span><span class="as-title-subtitle" id="as-title-subtitle">(IPv4/IPv6)</span>';
                titleEl.title = 'Autonomous System Peer Distribution Analysis';
            }
        }
        if (!lensToggleEl) return;
        var buttons = lensToggleEl.querySelectorAll('.as-lens-btn');
        for (var i = 0; i < buttons.length; i++) {
            var active = buttons[i].dataset.lens === distributionState.lens;
            buttons[i].classList.toggle('active', active);
            buttons[i].setAttribute('aria-selected', active ? 'true' : 'false');
        }
    }

    function clearSelectionForLensSwitch() {
        distributionState.selectedProvider = null;
        distributionState.hoveredProvider = null;
        distributionState.hoveringAll = false;
        distributionState.focusedHoverProvider = null;
        distributionState.summarySelected = false;
        distributionState.activeNetwork = null;
        distributionState.legendFocusProvider = null;
        distributionState.panelHistory = [];
        distributionState.filterPeerIds = null;
        distributionState.filterLabel = null;
        distributionState.filterCategory = null;
        distributionState.insightActiveAsNum = null;
        distributionState.insightActiveData = null;
        distributionState.insightActiveType = null;
        dismissPeerDetailView(false);
        if (othersListOpen) closeOthersListInDonut();
        summaryController.tooltips.hideSubTooltip();
        summaryController.tooltips.hideSubSubTooltip();
        hideInsightRect();
        closePanel();
        deactivateHoverAll();
        stopDonutAnimation();
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        if (_clearAsLines) _clearAsLines();
        if (containerEl) containerEl.classList.remove('as-legend-visible');
    }

    function setDistributionLens(lens) {
        if (lens !== 'provider' && lens !== 'country') return;
        if (distributionState.lens === lens) return;
        var wasFocused = distributionState.donutFocused;
        clearSelectionForLensSwitch();
        distributionState.lens = lens;
        updateLensChrome();
        renderDonut();
        renderCenter();
        renderLegend();
        if (wasFocused) {
            selectSummary();
            renderLegend();
        }
    }

    /** Initialize — cache DOM refs and attach events. Call once on page load. */
    function init() {
        containerEl = document.getElementById('as-distribution-container');
        titleEl = document.getElementById('as-donut-title');
        lensToggleEl = document.getElementById('as-lens-toggle');
        panelEl = document.getElementById('as-detail-panel');
        focusedCloseBtn = document.getElementById('as-focused-close');
        donutController.init({
            wrap: document.getElementById('as-donut-wrap'),
            svg: document.getElementById('as-donut'),
            center: document.getElementById('as-donut-center'),
            legend: document.getElementById('as-legend'),
            loading: containerEl ? containerEl.querySelector('.as-loading') : null,
            insight: document.getElementById('as-insight-rect'),
        });

        // Hover-all: title triggers all-segments highlight; click enters focused mode
        if (titleEl) {
            titleEl.addEventListener('mouseenter', onTitleEnter);
            titleEl.addEventListener('mouseleave', onTitleLeave);
            titleEl.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!distributionState.donutFocused) {
                    enterFocusedMode();
                }
            });
        }
        // Donut center: hover previews all lines, click enters focused mode
        // NOTE: We intentionally do NOT add separate mouseenter/mouseleave on as-score-label,
        // because the center already covers it. Adding handlers on the child causes
        // lines to disappear when the mouse moves from the label to the score value
        // (child mouseleave fires while still inside the parent).
        var center = donutController.getCenterElement();
        if (center) {
            center.addEventListener('mouseenter', onTitleEnter);
            center.addEventListener('mouseleave', onTitleLeave);
            center.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!distributionState.donutFocused) {
                    enterFocusedMode();
                }
            });
        }

        // Focused mode close button (back arrow near donut)
        if (focusedCloseBtn) {
            focusedCloseBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                exitFocusedMode();
            });
        }

        if (lensToggleEl) {
            var lensButtons = lensToggleEl.querySelectorAll('.as-lens-btn');
            for (var lbi = 0; lbi < lensButtons.length; lbi++) {
                lensButtons[lbi].addEventListener('click', function (e) {
                    e.stopPropagation();
                    setDistributionLens(e.currentTarget.dataset.lens);
                });
            }
        }

        // Close button on detail panel — exit fully
        var closeBtn = panelEl ? panelEl.querySelector('.as-detail-close') : null;
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                if (distributionState.donutFocused) {
                    exitFocusedMode();
                } else {
                    deselect();
                }
            });
        }

        // Clicking the AS detail panel brings it to front
        if (panelEl) {
            panelEl.addEventListener('click', function () {
                document.body.classList.add('panel-focus-as');
                document.body.classList.remove('panel-focus-peers');
            });
        }

        // Escape key
        document.addEventListener('keydown', onKeyDown);

        // Clear donut hover state when mouse leaves the browser window
        document.addEventListener('mouseleave', function () {
            if (distributionState.hoveredProvider && !distributionState.subTooltipPinned) {
                onSegmentLeave();
            }
            if (distributionState.focusedHoverProvider && !distributionState.selectedProvider) {
                distributionState.focusedHoverProvider = null;
                renderCenter();
            }
        });

        updateLensChrome();
    }

    /** Register integration callbacks from app.js */
    function setHooks(hooks) {
        _drawLinesForAs = hooks.drawLinesForAs || null;
        _drawLinesForAllAs = hooks.drawLinesForAllAs || null;
        _clearAsLines = hooks.clearAsLines || null;
        _filterPeerTable = hooks.filterPeerTable || null;
        _dimMapPeers = hooks.dimMapPeers || null;
        _zoomToPeerOnly = hooks.zoomToPeerOnly || null;
        _resetMapZoom = hooks.resetMapZoom || null;
        _clearPeerSelection = hooks.clearPeerSelection || null;
        _hideMapTooltip = hooks.hideMapTooltip || null;
        _enterPrivateNetMode = hooks.enterPrivateNetMode || null;
        _showDisconnectDialog = hooks.showDisconnectDialog || null;
    }

    /** Update with new peer data. Called after each fetchPeers(). */
    function update(peers) {
        lastPeersRaw = peers;

        // Check if >10% of peers are still being geolocated
        var pendingCount = 0;
        for (var pi = 0; pi < peers.length; pi++) {
            if (peers[pi].location_status === 'pending') pendingCount++;
        }
        var pendingPct = peers.length > 0 ? (pendingCount / peers.length) * 100 : 0;
        var isGeoLoading = pendingPct > 10;

        donutController.updateLoading(pendingCount, isGeoLoading);

        asGroups = aggregatePeers(peers);
        distributionScore = calcDistributionScore(asGroups);
        donutSegments = buildDonutSegments(asGroups);
        countryGroups = aggregateCountryPeers(peers);
        countryDistributionScore = calcDistributionScoreFor(countryGroups, countryTotalPeers);
        countryDonutSegments = buildDonutSegmentsFor(countryGroups, countryTotalPeers, 'countries');

        // If peer detail popup is open, skip all visual re-rendering to preserve
        // the donut expansion, lines, and center text for the selected peer.
        // Data is updated above so it's fresh when the popup is eventually closed.
        if (distributionState.peerDetailActive) {
            return;
        }

        // If a network panel (IPv4/IPv6) is open, do a lightweight refresh:
        // update the donut visuals and peer count in the header, but leave the
        // panel body DOM intact so that drill-down state, scroll position, and
        // pinned sub-tooltips are all preserved across the poll cycle.
        if (distributionState.activeNetwork) {
            renderDonut();
            renderCenter();
            renderLegend();
            // Update the header peer count without replacing the drill-down DOM.
            var networkRefresh = distributionNetworkPanel.refreshHeader(
                panelEl,
                lastPeersRaw,
                distributionState.activeNetwork
            );
            // Re-apply the correct dim/filter state: if a sub-filter is active
            // (user drilled into a country/provider/etc), preserve that narrow set.
            // Otherwise dim to the full network peer list.
            if (distributionState.subSubFilterPeerIds && distributionState.subSubFilterPeerIds.length > 0) {
                if (_filterPeerTable) _filterPeerTable(distributionState.subSubFilterPeerIds);
                if (_dimMapPeers) _dimMapPeers(distributionState.subSubFilterPeerIds);
                var ssAsNum = distributionState.subSubFilterProvider;
                if (ssAsNum && _drawLinesForAs) {
                    var ssColor = distributionState.subSubFilterColor || getColorForAsNum(ssAsNum);
                    _drawLinesForAs(ssAsNum, distributionState.subSubFilterPeerIds, ssColor);
                }
            } else if (distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0) {
                if (_filterPeerTable) _filterPeerTable(distributionState.filterPeerIds);
                if (_dimMapPeers) _dimMapPeers(distributionState.filterPeerIds);
                summaryController.previewSummaryLines(distributionState.filterPeerIds);
            } else {
                if (_filterPeerTable) _filterPeerTable(networkRefresh.peerIds);
                if (_dimMapPeers) _dimMapPeers(networkRefresh.peerIds);
            }
            return;
        }

        // Toggle no-data state on the container
        if (containerEl) {
            if (getActiveTotalPeers() === 0 && !isGeoLoading) containerEl.classList.add('no-data');
            else containerEl.classList.remove('no-data');
        }

        renderDonut();
        renderCenter();

        // Clear transient legend hover focus unless tooltips are pinned (DOM preserved).
        // When pinned, hover listeners are still attached so distributionState.legendFocusProvider stays valid.
        // The persistent sub-sub check in renderLegend handles the pinned case via distributionState.subSubFilterProvider.
        if (distributionState.legendFocusProvider && !distributionState.subTooltipPinned && !distributionState.subSubTooltipPinned) {
            distributionState.legendFocusProvider = null;
        }
        renderLegend();

        // If a selection is active, refresh the panel + filter + keep lines
        if (distributionState.selectedProvider) {
            var savedCategory = distributionState.filterCategory;
            var savedLabel = distributionState.filterLabel;

            var seg = findActiveSegmentOrGroup(distributionState.selectedProvider);
            if (seg) {
                if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
                    // Sub-tooltip is open — DON'T rebuild panel DOM or change filters.
                    // Keep current peer table filter and dim state intact so drill-down
                    // (e.g. Country > Provider > Peer) isn't disrupted by data refresh.
                    // Refresh lines/center with fresh data while preserving hover state.
                    if (savedCategory && savedLabel) {
                        var freshPeerIds = summaryController.findPeerIdsByCategoryLabel(seg, savedCategory, savedLabel);
                        if (freshPeerIds && freshPeerIds.length > 0) {
                            distributionState.filterPeerIds = freshPeerIds;
                            distributionState.filterCategory = savedCategory;
                            distributionState.filterLabel = savedLabel;
                        }
                    }
                    // Re-apply lines and center text (renderCenter/renderDonut already ran and reset them)
                    if (distributionState.hoveredPeerId) {
                        // Peer is being hovered — preserve that peer's visual state
                        var hPeer = lastPeersRaw.find(function (p) { return p.id === distributionState.hoveredPeerId; });
                        if (hPeer) {
                            var hAsNum = parseAsNumber(hPeer.as);
                            var hColor = hAsNum ? getColorForAsNum(hAsNum) : '#6e7681';
                            summaryController.previewProviderLines([distributionState.hoveredPeerId]);
                            if (distributionState.donutFocused) showPeerInDonutCenter(hPeer, hColor);
                        }
                    } else if (distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0) {
                        if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, distributionState.filterPeerIds, seg.color);
                        if (_filterPeerTable) _filterPeerTable(distributionState.filterPeerIds);
                        if (_dimMapPeers) _dimMapPeers(distributionState.filterPeerIds);
                        if (distributionState.donutFocused) {
                            showFocusedCenterText(distributionState.selectedProvider);
                            animateDonutExpand(distributionState.selectedProvider);
                        }
                    } else {
                        if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, seg.peerIds, seg.color);
                        if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                        if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                        if (distributionState.donutFocused) {
                            showFocusedCenterText(distributionState.selectedProvider);
                            animateDonutExpand(distributionState.selectedProvider);
                        }
                    }
                } else {
                    // No sub-tooltip pinned — safe to rebuild panel
                    // Preserve scroll position across data refresh
                    var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                    var savedScroll = bodyEl ? bodyEl.scrollTop : 0;
                    openPanel(distributionState.selectedProvider);
                    if (bodyEl && savedScroll > 0) bodyEl.scrollTop = savedScroll;

                    if (savedCategory && savedLabel) {
                        var freshPeerIds = summaryController.findPeerIdsByCategoryLabel(seg, savedCategory, savedLabel);
                        if (freshPeerIds && freshPeerIds.length > 0) {
                            distributionState.filterPeerIds = freshPeerIds;
                            distributionState.filterCategory = savedCategory;
                            distributionState.filterLabel = savedLabel;
                            if (_filterPeerTable) _filterPeerTable(freshPeerIds);
                            if (_dimMapPeers) _dimMapPeers(freshPeerIds);
                            if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, freshPeerIds, seg.color);
                            summaryController.highlightActiveSubRow();
                        } else {
                            distributionState.filterPeerIds = null;
                            distributionState.filterCategory = null;
                            distributionState.filterLabel = null;
                            summaryController.tooltips.hideSubTooltip();
                            if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                            if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                            if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, seg.peerIds, seg.color);
                        }
                    } else {
                        if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                        if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                        if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, seg.peerIds, seg.color);
                    }
                }
            } else {
                deselect();
            }
        }

        summaryController.refresh();
    }

    /** Get the donut center screen position for line drawing */
    function getDonutCenter() {
        return donutController.getDonutCenterPosition();
    }

    /** Get the screen position of a legend dot for a specific AS number.
     *  Returns {x, y} in page coords, or null if not found / legend not visible. */
    function getLegendDotPosition(asNum) {
        return donutController.getLegendDotPosition(asNum);
    }

    /** Get the position of the insight rect origin circle (bottom center dot). */
    function getInsightRectOrigin() {
        return donutController.getInsightOrigin();
    }

    /** Get the line origin position for a given AS number.
     *  - If insight rect is visible, lines come from the origin circle at the bottom.
     *  - If asNum is a top-8 segment, returns that segment's legend dot.
     *  - If asNum is in the "Others" group, returns the "Others" legend dot.
     *  - Final fallback: donut center (only when legend genuinely not rendered). */
    function getLineOriginForAs(asNum) {
        // When insight rect is visible, lines come from the origin circle at the bottom
        if (donutController.isInsightVisible()) {
            var origin = getInsightRectOrigin();
            if (origin) return origin;
        }
        // In focused mode or with legends hidden, lines come from donut center
        if (distributionState.donutFocused || legendsHidden) return getDonutCenter();

        // First: direct legend dot match (works for top-8 and selected AS)
        var direct = getLegendDotPosition(asNum);
        if (direct) return direct;

        // Second: check if this AS is inside the "Others" bucket
        var segments = getActiveSegments();
        if (segments) {
            for (var i = 0; i < segments.length; i++) {
                var seg = segments[i];
                if (seg.isOthers && seg._othersGroups) {
                    for (var j = 0; j < seg._othersGroups.length; j++) {
                        if (seg._othersGroups[j].asNumber === asNum) {
                            // Found in Others — use the Others legend dot
                            return getLegendDotPosition('Others');
                        }
                    }
                }
            }
        }

        // Final fallback: donut center (only when legend genuinely not rendered)
        return getDonutCenter();
    }

    /** Set legends hidden state (called from app.js when toggle changes) */
    function setLegendsHidden(hidden) {
        legendsHidden = !!hidden;
    }

    /** Get the currently selected AS number */
    function getSelectedAs() {
        return distributionState.selectedProvider;
    }

    /** Get the color for a given AS number */
    function getColorForAs(asNum) {
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        return seg ? seg.color : null;
    }

    // ═══════════════════════════════════════════════════════════
    // IPv4/IPv6 NETWORK DETAIL PANEL
    // ═══════════════════════════════════════════════════════════

    /** Open a dedicated network detail panel (IPv4 or IPv6) */
    function openNetworkPanel(netKey) {
        if (!panelEl) return;
        if (distributionState.peerDetailActive) closePeerPopup();

        var isRefresh = (distributionState.activeNetwork === netKey);
        if (!distributionState.donutFocused) {
            distributionState.donutFocused = true;
            document.body.classList.add('donut-focused');
        }

        distributionState.activeNetwork = netKey;
        if (!isRefresh) {
            distributionState.panelHistory = [{ type: 'summary', scrollTop: 0 }];
            renderBackButton();
        }

        var result = distributionNetworkPanel.render({
            panelElement: panelEl,
            peers: lastPeersRaw,
            segments: donutSegments,
            networkKey: netKey,
            isRefresh: isRefresh,
        });
        if (!result.bodyElement || !result.data.peerCount) return;

        summaryController.attachSummaryHandlers(result.bodyElement);

        if (_filterPeerTable) _filterPeerTable(result.data.peerIds);
        if (_dimMapPeers) _dimMapPeers(result.data.peerIds);
        activateHoverAll();
        renderCenter();
    }

    return {
        init: init,
        setHooks: setHooks,
        update: update,
        deselect: deselect,
        onMapClick: onMapClick,
        getLineOriginForAs: getLineOriginForAs,
        getSelectedAs: getSelectedAs,
        getColorForAs: getColorForAs,
        // Focused mode
        enterFocusedMode: enterFocusedMode,
        exitFocusedMode: exitFocusedMode,
        isFocusedMode: isFocusedMode,
        // Peer detail popup (from peer list or map dot)
        openPeerDetailPanel: openPeerDetailPanel,
        closePeerPopup: closePeerPopup,
        isPeerDetailActive: function () { return distributionState.peerDetailActive; },
        getLastPeersRaw: function () { return lastPeersRaw; },
        // Network panels (IPv4/IPv6)
        openNetworkPanel: openNetworkPanel,
        // Legend visibility
        setLegendsHidden: setLegendsHidden,
    };
})();
