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
    let donutFocused = false;      // True when in focused mode (donut at top-center)
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

    // DOM references associated with filter interactions remain local to this view.
    let pinnedSubTooltipSrc = null;  // Source element that opened the pinned sub-tooltip
    let lastPeersRaw = [];         // Raw peers from last update (for summary computation)
    let peerDetailActive = false;  // True when peer detail panel is shown (from peer list/map click)
    let insightActiveAsNum = null;  // AS number to show in donut when an insight is active (Most Stable, Fastest, etc.)
    let insightActiveType = null;   // Type of insight active: 'stable', 'fastest', 'data-bytessent', 'data-bytesrecv'
    let insightActiveData = null;   // Full data object for the active insight provider (for restoring after peer hover)
    let selectedPeerId = null;      // Peer ID that was clicked/selected (persists through hover cycles)

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

    function serviceFlagDescription(flag) {
        return flag.rpc ? flag.label + ' (' + flag.rpc + ')' : flag.label;
    }

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
        donutController.updateInsightPeer(peer, provColor, insightActiveType);
    }

    function restoreInsightRectProvider() {
        if (!donutController.isInsightVisible() || !insightActiveType || !insightActiveAsNum) return;
        var data = getInsightDataForActive();
        if (data) showInsightRect(insightActiveType, data);
        else if (insightActiveData) showInsightRect(insightActiveType, insightActiveData);
    }

    function getInsightDataForActive() {
        if (!insightActiveAsNum || !insightActiveType) return null;
        var sumData = computeSummaryData();
        for (var i = 0; i < sumData.insights.length; i++) {
            var insight = sumData.insights[i];
            if (insightActiveType === 'stable' && insight.type === 'stable') {
                return {
                    provName: insight.provName,
                    asNumber: insight.asNumber,
                    peerIds: insight.peerIds,
                    durText: insight.durText,
                    color: getColorForAsNum(insight.asNumber),
                };
            }
            if (insightActiveType === 'fastest' && insight.type === 'fastest' && insight.topProviders) {
                for (var j = 0; j < insight.topProviders.length; j++) {
                    if (insight.topProviders[j].asNumber === insightActiveAsNum) {
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
                    insightActiveType === 'data-bytessent' && insight.field === 'bytessent'
                ) || (
                    insightActiveType === 'data-bytesrecv' && insight.field === 'bytesrecv'
                );
                if (!matchesField) continue;
                for (var k = 0; k < insight.topProviders.length; k++) {
                    if (insight.topProviders[k].asNumber === insightActiveAsNum) {
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
        insightActiveAsNum = null;
        insightActiveData = null;
        insightActiveType = null;
        animateDonutRevert();
        renderCenter();
        if (distributionState.summarySelected) clearSummarySubFilter();
    }

    function renderCenter() {
        var activePeerTotal = getActiveTotalPeers();
        donutController.clearLegendHover();
        if (peerDetailActive) return;
        if (donutFocused && distributionState.focusedHoverProvider && !distributionState.selectedProvider) {
            showFocusedCenterText(distributionState.focusedHoverProvider);
            return;
        }
        if (legendsHidden && !donutFocused && distributionState.focusedHoverProvider && !distributionState.selectedProvider) {
            showLegendHoverCenterText(distributionState.focusedHoverProvider);
            return;
        }
        if (insightActiveAsNum && distributionState.summarySelected &&
            !distributionState.selectedProvider && donutFocused) {
            if (donutController.isInsightVisible()) {
                var insightData = getInsightDataForActive();
                if (insightData) showInsightRect(insightActiveType, insightData);
            } else {
                showFocusedCenterText(insightActiveAsNum);
            }
            return;
        }
        if (donutFocused && distributionState.summarySelected &&
            distributionState.filterPeerIds && distributionState.filterLabel &&
            !distributionState.selectedProvider) {
            donutController.renderFilterCenter(
                distributionState.filterPeerIds.length,
                distributionState.filterLabel,
                activePeerTotal
            );
            return;
        }
        if (donutFocused && distributionState.summarySelected &&
            distributionState.summaryPreviewPeerIds && distributionState.summaryPreviewLabel &&
            !distributionState.selectedProvider) {
            previewSummaryCenterText(
                distributionState.summaryPreviewPeerIds,
                distributionState.summaryPreviewLabel
            );
            return;
        }
        if (donutFocused && distributionState.activeNetwork && !distributionState.selectedProvider) {
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
                    focused: donutFocused,
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
        if (peerDetailActive) closePeerPopup();

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
        html += row('Total Peers', seg.peerCount);
        html += row('Providers', providers.length);
        html += row('Share', seg.percentage.toFixed(1) + '%');

        if (seg.isOthers && seg._othersGroups && seg._othersGroups.length > 0) {
            html += '<div class="modal-section-title">Countries &amp; Territories</div>';
            for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                var og = seg._othersGroups[oi];
                var oLabel = (og.countryCode || og.asShort || '') + '  ' + (og.countryName || og.asName || og.asNumber);
                html += interactiveRow(oLabel, og.peerCount + ' peer' + (og.peerCount !== 1 ? 's' : ''), og.peerIds, 'country-group');
            }
        }

        if (fullGroup.connTypesList && fullGroup.connTypesList.length > 0) {
            html += '<div class="modal-section-title">Connections</div>';
            html += row('Inbound', seg.isOthers ? allPeers.filter(function (p) { return p.direction === 'IN'; }).length : fullGroup.inboundCount);
            html += row('Outbound', seg.isOthers ? allPeers.filter(function (p) { return p.direction !== 'IN'; }).length : fullGroup.outboundCount);
            for (var cti = 0; cti < fullGroup.connTypesList.length; cti++) {
                var ctItem = fullGroup.connTypesList[cti];
                var ctLabel = CONN_TYPE_LABELS[ctItem.type] || ctItem.type;
                html += interactiveRow(ctLabel, ctItem.count, ctItem.peers.map(function (p) { return p.id; }), 'conntype');
            }
        }

        html += '<div class="modal-section-title">Performance</div>';
        html += row('Avg Duration', fullGroup.avgDurationFmt || '\u2014');
        html += row('Avg Ping', fullGroup.avgPingMs > 0 ? Math.round(fullGroup.avgPingMs) + 'ms' : '\u2014');
        html += row('Data Sent', fullGroup.totalBytesSentFmt || fmtBytes(0));
        html += row('Data Recv', fullGroup.totalBytesRecvFmt || fmtBytes(0));

        if (providers.length > 0) {
            html += '<div class="modal-section-title">Providers</div>';
            for (var pi = 0; pi < providers.length; pi++) {
                var prov = providers[pi];
                var pName = prov.name;
                if (pName.length > 24) pName = pName.substring(0, 23) + '\u2026';
                html += interactiveRow(prov.asNumber + ' \u00b7 ' + pName, prov.peerCount + ' peer' + (prov.peerCount !== 1 ? 's' : ''), prov.peerIds, 'country-provider');
            }
        }

        if (fullGroup.versions && fullGroup.versions.length > 0) {
            html += '<div class="modal-section-title">Software</div>';
            for (var vi = 0; vi < fullGroup.versions.length; vi++) {
                html += interactiveRow(fullGroup.versions[vi].subver, fullGroup.versions[vi].count + ' peer' + (fullGroup.versions[vi].count !== 1 ? 's' : ''), fullGroup.versions[vi].peers.map(function (p) { return p.id; }), 'software');
            }
        }

        if (fullGroup.servicesCombos && fullGroup.servicesCombos.length > 0) {
            html += '<div class="modal-section-title">Services</div>';
            for (var si = 0; si < fullGroup.servicesCombos.length; si++) {
                html += interactiveRow(fullGroup.servicesCombos[si].abbrev, fullGroup.servicesCombos[si].count + ' peer' + (fullGroup.servicesCombos[si].count !== 1 ? 's' : ''), fullGroup.servicesCombos[si].peers.map(function (p) { return p.id; }), 'services');
            }
        }

        bodyEl.innerHTML = html;
        bodyEl.scrollTop = 0;
        attachInteractiveRowHandlers(bodyEl, seg);
        attachPanelBlankClickHandler(bodyEl);

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
        if (peerDetailActive) closePeerPopup();
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
            html += row('Total Peers', seg.peerCount);
            html += row('Providers', seg._othersGroups ? seg._othersGroups.length : '?');
            html += row('Share', seg.percentage.toFixed(1) + '%');

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
                html += interactiveRow(octLabel, otherConnMap[octKey].count, octPeerIds, 'conntype');
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
            html += row('Avg Duration', fmtDuration(oAvgDur));
            html += row('Avg Ping', oAvgPing > 0 ? Math.round(oAvgPing) + 'ms' : '\u2014');
            html += row('Data Sent', fmtBytes(otherSent));
            html += row('Data Recv', fmtBytes(otherRecv));

            if (seg._othersGroups && seg._othersGroups.length > 0) {
                html += '<div class="modal-section-title">All Providers</div>';
                for (var i = 0; i < seg._othersGroups.length; i++) {
                    var g = seg._othersGroups[i];
                    var gName = g.asShort || g.asName || g.asNumber;
                    if (gName.length > 24) gName = gName.substring(0, 23) + '\u2026';
                    html += interactiveRow(
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
            html += interactiveRow('Total', fullGroup.peerCount, fullGroup.peerIds, 'conntype');

            // Show only connection types that exist, with short labels
            if (fullGroup.connTypesList && fullGroup.connTypesList.length > 0) {
                for (var cti = 0; cti < fullGroup.connTypesList.length; cti++) {
                    var ctItem = fullGroup.connTypesList[cti];
                    var ctLabel = CONN_TYPE_LABELS[ctItem.type] || ctItem.type;
                    var ctPeerIds = ctItem.peers.map(function (p) { return p.id; });
                    html += interactiveRow(ctLabel, ctItem.count, ctPeerIds, 'conntype');
                }
            }

            html += '<div class="modal-section-title">Performance</div>';
            html += row('Avg Duration', fullGroup.avgDurationFmt);
            html += row('Avg Ping', fullGroup.avgPingMs > 0 ? Math.round(fullGroup.avgPingMs) + 'ms' : '\u2014');
            html += row('Data Sent', fullGroup.totalBytesSentFmt);
            html += row('Data Recv', fullGroup.totalBytesRecvFmt);

            if (fullGroup.versions && fullGroup.versions.length > 0) {
                html += '<div class="modal-section-title">Software</div>';
                for (var vi = 0; vi < fullGroup.versions.length; vi++) {
                    var vPeerIds = fullGroup.versions[vi].peers.map(function (p) { return p.id; });
                    html += interactiveRow(fullGroup.versions[vi].subver, fullGroup.versions[vi].count + ' peer' + (fullGroup.versions[vi].count !== 1 ? 's' : ''), vPeerIds, 'software');
                }
            }

            if (fullGroup.countries && fullGroup.countries.length > 0) {
                html += '<div class="modal-section-title">Countries</div>';
                for (var ci = 0; ci < fullGroup.countries.length; ci++) {
                    var cPeerIds = fullGroup.countries[ci].peers.map(function (p) { return p.id; });
                    html += interactiveRow(fullGroup.countries[ci].code + '  ' + fullGroup.countries[ci].name, fullGroup.countries[ci].count, cPeerIds, 'country');
                }
            }

            if (fullGroup.servicesCombos && fullGroup.servicesCombos.length > 0) {
                html += '<div class="modal-section-title">Services</div>';
                for (var si = 0; si < fullGroup.servicesCombos.length; si++) {
                    var sPeerIds = fullGroup.servicesCombos[si].peers.map(function (p) { return p.id; });
                    html += interactiveRow(fullGroup.servicesCombos[si].abbrev, fullGroup.servicesCombos[si].count + ' peer' + (fullGroup.servicesCombos[si].count !== 1 ? 's' : ''), sPeerIds, 'services');
                }
            }
        }

        bodyEl.innerHTML = html;
        bodyEl.scrollTop = 0;

        // Attach hover/click handlers to all interactive rows
        attachInteractiveRowHandlers(bodyEl, seg);
        attachPanelBlankClickHandler(bodyEl);

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
    // SUMMARY ANALYSIS PANEL
    // ═══════════════════════════════════════════════════════════

    /** Open the Summary Analysis panel (reuses the same #as-detail-panel) */
    function openLensSummaryPanel() {
        if (isCountryLens()) openCountrySummaryPanel();
        else openSummaryPanel();
    }

    function countrySummaryRow(group) {
        var label = (group.countryCode || group.asShort || '') + '  ' + (group.countryName || group.asName || group.asNumber);
        return '<div class="as-detail-sub-row as-country-summary-row" data-as="' + escHtml(group.asNumber) + '">'
             + '<span class="as-detail-sub-label">' + escHtml(label) + '</span>'
             + '<span class="as-detail-sub-val">' + group.peerCount + 'p / ' + group.percentage.toFixed(0) + '%</span>'
             + '</div>';
    }

    function openCountrySummaryPanel() {
        if (!panelEl) return;
        if (peerDetailActive) closePeerPopup();
        var data = computeCountrySummaryData();

        renderBackButton();

        var asnEl = panelEl.querySelector('.as-detail-asn');
        var orgEl = panelEl.querySelector('.as-detail-org');
        var metaEl = panelEl.querySelector('.as-detail-meta');
        var barFill = panelEl.querySelector('.as-detail-bar-fill');
        var pctEl = panelEl.querySelector('.as-detail-pct');
        var riskEl = panelEl.querySelector('.as-detail-risk');

        if (asnEl) {
            asnEl.innerHTML = '<span style="color:var(--logo-primary, #4a90d9)">PEER COUNTRY</span><br><span style="color:var(--logo-accent, #7ec8e3)">DISTRIBUTION</span> <span style="color:var(--logo-primary, #4a90d9)">SUMMARY</span>';
            asnEl.classList.add('as-summary-title');
        }
        if (orgEl) {
            orgEl.textContent = data.uniqueCountries + ' countries / territories';
        }
        if (metaEl) {
            metaEl.innerHTML = '<span class="as-detail-type-badge">' + data.quality.word + '</span>';
        }
        var scorePct = (data.score / 10) * 100;
        if (barFill) {
            barFill.style.width = scorePct.toFixed(1) + '%';
            barFill.style.background = data.score >= 8 ? 'var(--ok)' : data.score >= 6 ? 'var(--ok-bright)' : data.score >= 4 ? 'var(--warn)' : 'var(--err)';
        }
        if (pctEl) {
            pctEl.textContent = 'Score: ' + data.score.toFixed(1) + ' / 10';
            pctEl.title = buildActiveScoreTooltip(data.score);
        }
        if (riskEl) {
            riskEl.className = 'as-detail-risk';
            riskEl.textContent = '';
        }

        var bodyEl = panelEl.querySelector('.as-detail-body');
        if (!bodyEl) return;

        var html = '';
        html += '<div class="modal-section-title" title="Distribution score based on Herfindahl-Hirschman Index (HHI). Higher score = more evenly distributed peers across countries and territories.">Score &amp; Concentration</div>';
        html += row('Jurisdiction Score', data.score.toFixed(1) + ' / 10');
        html += row('Quality', data.quality.word);
        html += row('Geolocated Peers', data.totalPeers);
        html += row('Countries', data.uniqueCountries);
        if (data.topCountry) {
            var topLabel = (data.topCountry.countryCode || data.topCountry.asShort || '') + '  ' + (data.topCountry.countryName || data.topCountry.asName);
            html += row('Top Country', escHtml(topLabel) + ' (' + data.topCountry.peerCount + ')');
        }

        html += '<div class="modal-section-title" title="Click a country to inspect the providers, connection types, software, and services behind that slice.">Countries &amp; Territories</div>';
        if (data.countries.length === 0) {
            html += '<div class="pn-panel-empty">No country data available</div>';
        } else {
            for (var ci = 0; ci < data.countries.length; ci++) {
                html += countrySummaryRow(data.countries[ci]);
            }
        }

        bodyEl.innerHTML = html;
        bodyEl.scrollTop = 0;
        attachCountrySummaryRowHandlers(bodyEl);
        attachPanelBlankClickHandler(bodyEl);

        panelEl.classList.remove('hidden');
        void panelEl.offsetWidth;
        panelEl.classList.add('visible');
        document.body.classList.add('as-panel-open');
        document.body.classList.add('panel-focus-as');
        document.body.classList.remove('panel-focus-peers');
    }

    function attachCountrySummaryRowHandlers(bodyEl) {
        var rows = bodyEl.querySelectorAll('.as-country-summary-row');
        for (var ri = 0; ri < rows.length; ri++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    var countryId = rowEl.dataset.as;
                    var seg = findActiveSegmentOrGroup(countryId);
                    if (!seg) return;
                    highlightLegendItem(countryId);
                    if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                    if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                    if (_drawLinesForAs) _drawLinesForAs(countryId, seg.peerIds, seg.color);
                    if (donutFocused) {
                        distributionState.focusedHoverProvider = countryId;
                        showFocusedCenterText(countryId);
                    }
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    distributionState.focusedHoverProvider = null;
                    clearLegendHighlight();
                    if (distributionState.summarySelected) {
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        activateHoverAll();
                    } else {
                        if (_clearAsLines) _clearAsLines();
                    }
                    renderCenter();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (peerDetailActive) closePeerPopup();
                    var countryId = rowEl.dataset.as;
                    var seg = findActiveSegmentOrGroup(countryId);
                    if (!seg) return;

                    var scrollTop = bodyEl ? bodyEl.scrollTop : 0;
                    distributionState.panelHistory = [{ type: 'summary', scrollTop: scrollTop }];
                    distributionState.summarySelected = false;
                    distributionState.selectedProvider = countryId;
                    distributionState.filterPeerIds = null;
                    distributionState.filterLabel = null;
                    distributionState.filterCategory = null;
                    hideSubTooltip();
                    hideSubSubTooltip();

                    openPanel(countryId);
                    if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                    if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                    if (_drawLinesForAs) _drawLinesForAs(countryId, seg.peerIds, seg.color);
                    animateDonutExpand(countryId);
                    if (containerEl) containerEl.classList.add('as-legend-visible');
                    renderCenter();
                    renderLegend();
                    if (_resetMapZoom) _resetMapZoom();
                });
            })(rows[ri]);
        }
    }

    function openSummaryPanel() {
        if (!panelEl) return;
        if (peerDetailActive) closePeerPopup();
        var data = computeSummaryData();

        // Render back button (hidden for summary unless navigated from provider)
        renderBackButton();

        // --- Header ---
        var asnEl = panelEl.querySelector('.as-detail-asn');
        var orgEl = panelEl.querySelector('.as-detail-org');
        var metaEl = panelEl.querySelector('.as-detail-meta');
        var barFill = panelEl.querySelector('.as-detail-bar-fill');
        var pctEl = panelEl.querySelector('.as-detail-pct');
        var riskEl = panelEl.querySelector('.as-detail-risk');

        if (asnEl) {
            asnEl.innerHTML = '<span style="color:var(--logo-primary, #4a90d9)">PEER ISP</span><br><span style="color:var(--logo-accent, #7ec8e3)">DISTRIBUTION</span> <span style="color:var(--logo-primary, #4a90d9)">SUMMARY</span>';
            asnEl.classList.add('as-summary-title');
        }
        // Clickable provider count in header (no peer count)
        if (orgEl) {
            orgEl.innerHTML = '<span class="as-panel-link as-all-providers-link" title="View all providers">'
                + data.uniqueProviders + ' unique providers</span>';
        }

        if (metaEl) {
            metaEl.innerHTML = '<span class="as-detail-type-badge">' + data.quality.word + '</span>';
        }

        // Score bar (distribution score 0-10 → percentage 0-100)
        var scorePct = (data.score / 10) * 100;
        var scoreTooltip = buildScoreTooltip(data.score);
        if (barFill) {
            barFill.style.width = scorePct.toFixed(1) + '%';
            barFill.style.background = data.score >= 8 ? 'var(--ok)' : data.score >= 6 ? 'var(--ok-bright)' : data.score >= 4 ? 'var(--warn)' : 'var(--err)';
        }
        if (pctEl) { pctEl.textContent = 'Score: ' + data.score.toFixed(1) + ' / 10'; pctEl.title = scoreTooltip; }
        if (riskEl) {
            riskEl.className = 'as-detail-risk';
            riskEl.textContent = '';
        }

        // --- Body ---
        var bodyEl = panelEl.querySelector('.as-detail-body');
        if (!bodyEl) return;

        var html = '';

        // ── Section 1: Score + Insights ──
        html += '<div class="modal-section-title" title="Distribution score based on Herfindahl\u2013Hirschman Index (HHI). Higher score = more evenly distributed peers across providers.">Score &amp; Insights</div>';
        html += '<div class="modal-row"><span class="modal-label" title="' + scoreTooltip.replace(/"/g, '&quot;') + '">Distribution Score</span><span class="modal-val">' + data.score.toFixed(1) + ' / 10</span></div>';
        html += '<div class="modal-row"><span class="modal-label" title="Quality rating based on the distribution score">Quality</span><span class="modal-val">' + data.quality.word + '</span></div>';
        html += '<div class="modal-row"><span class="modal-label" title="Number of distinct Autonomous Systems (AS/ISPs) your peers connect through">Unique Providers</span>'
             + '<span class="modal-val as-panel-link as-all-providers-link" title="View all providers">' + data.uniqueProviders + '</span></div>';
        if (data.topProvider) {
            var topName = data.topProvider.asShort || data.topProvider.asNumber;
            html += '<div class="modal-row"><span class="modal-label" title="The AS provider with the most peers connected to your node">Top Provider</span>'
                 + '<span class="modal-val as-panel-link as-navigate-provider" data-as="' + data.topProvider.asNumber + '" title="View ' + topName + ' panel">'
                 + topName + ' (' + data.topProvider.peerCount + ')</span></div>';
        }

        // Dynamic insights — each is a simple label row with hover/click sub-panel
        for (var ii = 0; ii < data.insights.length; ii++) {
            var ins = data.insights[ii];
            html += '<div class="as-summary-insight">';
            html += '<span class="as-insight-icon">' + ins.icon + '</span>';
            if (ins.type === 'stable') {
                var stablePeerJson = JSON.stringify(ins.peerIds).replace(/"/g, '&quot;');
                html += '<span class="as-insight-text as-panel-link as-stable-link" data-as="' + ins.asNumber + '" data-peer-ids="' + stablePeerJson + '">Most stable: ' + ins.provName + ' (avg ' + ins.durText + ')</span>';
            } else if (ins.type === 'fastest') {
                html += '<span class="as-insight-text as-panel-link as-fastest-link" title="Providers ranked by average ping time">Fastest connection <span style="color:var(--text-muted)">(by rank)</span></span>';
            } else if (ins.type === 'data-providers') {
                html += '<span class="as-insight-text as-panel-link as-data-providers-link" data-field="' + ins.field + '" title="Providers ranked by total bytes">' + ins.label + '</span>';
            } else {
                html += '<span class="as-insight-text">' + ins.text + '</span>';
            }
            html += '</div>';
        }

        // ── Section 2: Connections by Provider (3 rows per provider) ──
        html += '<div class="modal-section-title" title="Inbound and outbound peer connections grouped by AS provider. Click provider name to view its panel, click IN/OUT to see peer lists.">Connections by Provider</div>';
        for (var gi = 0; gi < data.connectionGrid.length; gi++) {
            var gItem = data.connectionGrid[gi];
            var totalJson = JSON.stringify(gItem.totalPeerIds).replace(/"/g, '&quot;');
            var inJson = JSON.stringify(gItem.inPeerIds).replace(/"/g, '&quot;');
            var outJson = JSON.stringify(gItem.outPeerIds).replace(/"/g, '&quot;');
            var outSubJson = JSON.stringify(gItem.outSubtypes).replace(/"/g, '&quot;');

            if (gItem.isOthers && gItem._othersGroups) {
                // Others row — 3-level: click shows provider list, then provider → peer list
                var othersProvJson = JSON.stringify(gItem._othersGroups.map(function (g) {
                    return { a: g.asNumber, n: g.asShort || g.asName || g.asNumber, c: g.color || getColorForAsNum(g.asNumber), pc: g.peerCount, pi: g.peerIds };
                })).replace(/"/g, '&quot;');
                html += '<div class="as-detail-sub-row as-conn-others-row" data-peer-ids="' + totalJson + '" data-providers="' + othersProvJson + '" data-as="' + gItem.asNumber + '" style="cursor:pointer">';
                html += '<span class="as-detail-sub-label"><span class="as-grid-dot" style="background:' + gItem.color + '; display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; vertical-align:middle"></span>';
                html += '<span style="color:' + gItem.color + '">' + gItem.name + '</span></span>';
                html += '<span class="as-detail-sub-val">' + gItem.totalCount + '</span>';
                html += '</div>';
            } else {
                // Provider name row (total) — click pins sub-tooltip, "Open provider panel" link inside navigates
                html += '<div class="as-detail-sub-row as-conn-prov-row" data-peer-ids="' + totalJson + '" data-as="' + gItem.asNumber + '" style="cursor:pointer">';
                html += '<span class="as-detail-sub-label"><span class="as-grid-dot" style="background:' + gItem.color + '; display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; vertical-align:middle"></span>';
                html += '<span style="color:' + gItem.color + '">' + gItem.name + '</span></span>';
                html += '<span class="as-detail-sub-val">' + gItem.totalCount + '</span>';
                html += '</div>';
            }
            // In row
            if (gItem.inCount > 0) {
                html += '<div class="as-detail-sub-row as-interactive-row as-conn-dir-row" data-peer-ids="' + inJson + '" data-as="' + gItem.asNumber + '" data-category="conntype" style="padding-left:22px">';
                html += '<span class="as-detail-sub-label">In</span>';
                html += '<span class="as-detail-sub-val">' + gItem.inCount + '</span>';
                html += '</div>';
            }
            // Out row
            if (gItem.outCount > 0) {
                html += '<div class="as-detail-sub-row as-conn-out-row" data-peer-ids="' + outJson + '" data-as="' + gItem.asNumber + '" data-out-subtypes="' + outSubJson + '" data-category="conntype" style="padding-left:22px; cursor:pointer">';
                html += '<span class="as-detail-sub-label">Out</span>';
                html += '<span class="as-detail-sub-val">' + gItem.outCount + '</span>';
                html += '</div>';
            }
        }

        // ── Section 3: Networks ──
        html += '<div class="modal-section-title" title="Peer connections grouped by network protocol. IPv4/IPv6 are clearnet, Tor/I2P/CJDNS are anonymous overlay networks.">Networks</div>';
        for (var ni = 0; ni < data.networks.length; ni++) {
            var net = data.networks[ni];
            html += summaryInteractiveRow(net.label, net.peerCount + 'p / ' + net.providerCount + 'prov', net);
        }
        // "Private Networks" link at bottom of Networks section
        html += '<div class="as-detail-sub-row as-interactive-row as-show-private-nets" style="cursor:pointer" title="Close the public network panel and switch to the Private Networks panel (Tor, I2P, CJDNS)">';
        html += '<span class="as-detail-sub-label">* Private Networks</span>';
        html += '</div>';

        // ── Section 4: Hosting ──
        html += '<div class="modal-section-title" title="Peer connections grouped by hosting type. Cloud/Hosting = datacenter, Residential = home ISP, Proxy/VPN = anonymizing relay, Mobile = cellular.">Hosting</div>';
        for (var hi = 0; hi < data.hosting.length; hi++) {
            var host = data.hosting[hi];
            html += summaryInteractiveRow(host.label, host.peerCount + 'p / ' + host.providerCount + 'prov', host);
        }

        // ── Section 5: Countries ──
        html += '<div class="modal-section-title" title="Geographic distribution of peers by country, with provider count showing how many distinct AS providers operate in each country.">Countries</div>';
        for (var ci = 0; ci < data.countries.length; ci++) {
            var country = data.countries[ci];
            html += summaryInteractiveRow(country.label, country.peerCount + 'p / ' + country.providerCount + 'prov', country);
        }

        // ── Section 6: Software ──
        html += '<div class="modal-section-title" title="Bitcoin Core client versions running on your peers, grouped by user agent string. Multiple versions is healthy for network resilience.">Software</div>';
        for (var si = 0; si < data.software.length; si++) {
            var sw = data.software[si];
            html += summaryInteractiveRow(sw.label, sw.peerCount + 'p / ' + sw.providerCount + 'prov', sw);
        }

        // ── Section 7: Services ──
        html += '<div class="modal-section-title" title="Service flag combinations advertised by peers. N=Full Chain, W=SegWit, NL=Pruned, P=BIP324 v2, CF=Compact Filters, B=Bloom.">Services</div>';
        for (var svi = 0; svi < data.services.length; svi++) {
            var svc = data.services[svi];
            html += summaryInteractiveRow(svc.label, svc.peerCount + 'p / ' + svc.providerCount + 'prov', svc);
        }

        bodyEl.innerHTML = html;
        bodyEl.scrollTop = 0;

        // Attach drill-down handlers for summary rows
        attachSummaryRowHandlers(bodyEl);
        attachGridHandlers(bodyEl);
        attachSummaryLinkHandlers(bodyEl);
        attachPanelBlankClickHandler(bodyEl);

        // Show panel
        panelEl.classList.remove('hidden');
        void panelEl.offsetWidth;
        panelEl.classList.add('visible');
        document.body.classList.add('as-panel-open');
        document.body.classList.add('panel-focus-as');
        document.body.classList.remove('panel-focus-peers');
    }

    /** Build a summary interactive row that drills down to providers.
     *  Stores provider data in a data attribute for the click handler. */
    function summaryInteractiveRow(label, value, catData) {
        var providersJson = escHtml(JSON.stringify(catData.providers.map(function (prov) {
            return {
                a: prov.asNumber,
                n: prov.name,
                c: prov.color,
                pc: prov.peerCount,
                pi: prov.peerIds
            };
        })));
        var peerIdsJson = escHtml(JSON.stringify(catData.peerIds));
        var safeLabel = escHtml(label);
        var safeValue = escHtml(value);
        return '<div class="as-detail-sub-row as-interactive-row as-summary-row" ' +
            'role="button" tabindex="0" aria-label="' + safeLabel + ': ' + safeValue + '" ' +
            'data-peer-ids="' + peerIdsJson + '" data-providers="' + providersJson +
            '" data-cat-label="' + safeLabel + '">' +
            '<span class="as-detail-sub-label">' + safeLabel + '</span>' +
            '<span class="as-detail-sub-val">' + safeValue + '</span></div>';
    }

    function row(label, value) {
        return '<div class="modal-row"><span class="modal-label">' + label + '</span><span class="modal-val">' + value + '</span></div>';
    }

    /** Build an interactive sub-row with hover/click support.
     *  peerIds: array of peer IDs for this row's peers
     *  category: 'conntype' | 'software' | 'services' | 'country' | 'provider' */
    function interactiveRow(label, value, peerIds, category) {
        var peerIdsJson = JSON.stringify(peerIds).replace(/"/g, '&quot;');
        return '<div class="as-detail-sub-row as-interactive-row" data-peer-ids="' + peerIdsJson + '" data-category="' + category + '">'
             + '<span class="as-detail-sub-label">' + label + '</span>'
             + '<span class="as-detail-sub-val">' + value + '</span>'
             + '</div>';
    }

    /** Build a compact hover summary for a set of peers */
    function buildPeerSummaryHtml(peerIds, category, label) {
        // Find the actual peer objects from the current AS group
        var seg = distributionState.selectedProvider ? findActiveSegment(distributionState.selectedProvider) : null;
        var allPeers = [];
        if (seg) {
            if (seg.isOthers && seg._othersGroups) {
                for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                    for (var opi = 0; opi < seg._othersGroups[oi].peers.length; opi++) {
                        allPeers.push(seg._othersGroups[oi].peers[opi]);
                    }
                }
            } else {
                var grp = findActiveGroup(distributionState.selectedProvider);
                if (grp) allPeers = grp.peers;
            }
        } else if (distributionState.selectedProvider) {
            // Fallback for sub-groups not in top donut segments.
            var grp = findActiveGroup(distributionState.selectedProvider);
            if (grp) allPeers = grp.peers;
        }

        var idSet = {};
        for (var ii = 0; ii < peerIds.length; ii++) idSet[peerIds[ii]] = true;
        var matchedPeers = [];
        for (var mi = 0; mi < allPeers.length; mi++) {
            if (idSet[allPeers[mi].id]) matchedPeers.push(allPeers[mi]);
        }

        var html = '';

        // For services category, show full service name expansion at the top
        if (category === 'services' && label && label !== '\u2014') {
            html += '<div class="as-sub-tt-section">';
            var abbrs = label.split(/\s+/);
            for (var ai = 0; ai < abbrs.length; ai++) {
                var found = false;
                for (var fk in SERVICE_FLAGS) {
                    if (SERVICE_FLAGS.hasOwnProperty(fk) && SERVICE_FLAGS[fk].abbr === abbrs[ai]) {
                        html += '<div class="as-sub-tt-flag">' + escHtml(abbrs[ai]) + ' = ' + escHtml(serviceFlagDescription(SERVICE_FLAGS[fk])) + '</div>';
                        found = true;
                        break;
                    }
                }
                if (!found) html += '<div class="as-sub-tt-flag">' + escHtml(abbrs[ai]) + '</div>';
            }
            html += '</div>';
        }

        // Show first 6 peers, rest hidden behind expandable "+N more (show)"
        var initialShow = 6;
        var hasMore = matchedPeers.length > initialShow;

        html += '<div class="as-sub-tt-scroll">';
        for (var pi = 0; pi < matchedPeers.length; pi++) {
            var p = matchedPeers[pi];
            var ct = p.connection_type || 'unknown';
            var ctLabel = CONN_TYPE_LABELS[ct] || ct;
            var loc = (p.city || '') + (p.city && p.country ? ', ' : '') + (p.country || '');
            // Truncate location to keep layout tight
            if (loc.length > 16) loc = loc.substring(0, 15) + '\u2026';
            var peerAs = parseAsNumber(p.as) || '';
            var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
            html += '<div class="as-sub-tt-peer' + extraClass + '" data-peer-id="' + p.id + '" data-as="' + peerAs + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
            html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + ctLabel + '</span>';
            if (loc) html += '<span class="as-sub-tt-loc">' + loc + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (hasMore) {
            var remaining = matchedPeers.length - initialShow;
            html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    /** Attach hover handlers to individual peer rows inside a tooltip element.
     *  On hover: draws a line to just that one peer and filters the table/map.
     *  On leave: restores the parent filter (summary or provider mode). */
    function attachPeerRowHoverHandlers(tip) {
        var peerRows = tip.querySelectorAll('.as-sub-tt-peer[data-peer-id]');
        for (var pri = 0; pri < peerRows.length; pri++) {
            (function (row) {
                row.addEventListener('mouseenter', function () {
                    var peerId = parseInt(row.dataset.peerId);
                    if (isNaN(peerId)) return;
                    distributionState.hoveredPeerId = peerId; // Track for update preservation
                    if (distributionState.summarySelected) {
                        previewSummaryLines([peerId]);
                    } else if (distributionState.selectedProvider) {
                        previewProviderLines([peerId]);
                    }
                    // Preview this peer in the popup if a different peer is selected
                    if (peerDetailActive && peerId !== selectedPeerId) {
                        var peer = lastPeersRaw.find(function (p) { return p.id === peerId; });
                        if (peer) previewPeerInPopup(peer);
                    }
                    // In focused mode, show peer info in donut center or update insight rect
                    if (donutFocused) {
                        var peer = lastPeersRaw.find(function (p) { return p.id === peerId; });
                        if (peer) {
                            var asNum = row.dataset.as || parseAsNumber(peer.as);
                            var color = asNum ? getColorForAsNum(asNum) : '#6e7681';
                            if (donutController.isInsightVisible()) {
                                updateInsightRectForPeer(peer, color);
                            } else {
                                showPeerInDonutCenter(peer, color);
                                // Keep donut expanded for the provider context
                                if (distributionState.filterCategory && distributionState.filterCategory.indexOf('conn-') === 0 && distributionState.filterLabel) {
                                    animateDonutExpand(distributionState.filterLabel);
                                }
                            }
                        }
                    }
                });
                row.addEventListener('mouseleave', function () {
                    distributionState.hoveredPeerId = null;

                    // If a peer is selected (popup open), restore to that peer's state
                    if (peerDetailActive && selectedPeerId) {
                        restorePeerPopupToSelected();
                        var selPeer = lastPeersRaw.find(function (p) { return p.id === selectedPeerId; });
                        if (selPeer) {
                            var selAsNum = parseAsNumber(selPeer.as);
                            var selColor = selAsNum ? getColorForAsNum(selAsNum) : '#6e7681';
                            // Restore line/filter to selected peer
                            if (_drawLinesForAs && selAsNum) _drawLinesForAs(selAsNum, [selectedPeerId], selColor);
                            if (_filterPeerTable) _filterPeerTable([selectedPeerId]);
                            if (_dimMapPeers) _dimMapPeers([selectedPeerId]);
                            // Restore donut center / insight rect to selected peer
                            if (donutFocused) {
                                if (donutController.isInsightVisible()) {
                                    updateInsightRectForPeer(selPeer, selColor);
                                } else {
                                    showPeerInDonutCenter(selPeer, selColor);
                                }
                            }
                        }
                        return;
                    }

                    // Restore lines/filter to parent state (selected provider or summary sub-filter)
                    if (distributionState.summarySelected) {
                        restoreSummaryFromPreview();
                    } else if (distributionState.selectedProvider) {
                        restoreProviderFromPreview();
                    }
                    // Restore donut center display
                    if (donutFocused) {
                        if (donutController.isInsightVisible()) {
                            restoreInsightRectProvider();
                        } else if (distributionState.filterCategory && distributionState.filterCategory.indexOf('conn-') === 0 && distributionState.filterLabel) {
                            // Restore donut to show the provider (keep expanded)
                            showFocusedCenterText(distributionState.filterLabel);
                            animateDonutExpand(distributionState.filterLabel);
                        } else if (distributionState.selectedProvider) {
                            renderCenter();
                        } else {
                            renderCenter();
                        }
                    }
                });
            })(peerRows[pri]);
        }
    }

    /** Attach expand/collapse and peer-click handlers to the sub-tooltip after rendering */
    function attachSubTooltipHandlers() {
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) return;

        // Peer ID click → zoom to peer on map and open the large peer detail popup
        var idLinks = tip.querySelectorAll('.as-sub-tt-id-link');
        for (var li = 0; li < idLinks.length; li++) {
            (function (link) {
                link.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerId = parseInt(link.dataset.peerId);
                    if (isNaN(peerId)) return;
                    // Zoom to peer on map — panel stays open for navigation
                    if (_zoomToPeerOnly) _zoomToPeerOnly(peerId);
                    // Find the peer data and open the large popup
                    var peer = lastPeersRaw.find(function (p) { return p.id === peerId; });
                    if (peer) {
                        openPeerDetailPanel(peer, 'panel');
                        highlightSelectedPeerRow(peerId);
                    }
                });
            })(idLinks[li]);
        }

        // Peer row hover → preview line to individual peer
        attachPeerRowHoverHandlers(tip);

        var showMore = tip.querySelector('.as-sub-tt-show-more');
        var showLess = tip.querySelector('.as-sub-tt-show-less');
        if (!showMore || !showLess) return;

        showMore.addEventListener('click', function (e) {
            e.stopPropagation();
            // Show all extra peers
            var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
            for (var i = 0; i < extras.length; i++) {
                extras[i].style.display = '';
            }
            showMore.style.display = 'none';
            showLess.style.display = '';

            // Add scroll container class if many peers
            var peerList = tip.querySelector('.as-sub-tt-scroll');
            if (peerList) peerList.classList.add('as-sub-tt-expanded');
        });

        showLess.addEventListener('click', function (e) {
            e.stopPropagation();
            // Hide extra peers
            var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
            for (var i = 0; i < extras.length; i++) {
                extras[i].style.display = 'none';
            }
            showLess.style.display = 'none';
            showMore.style.display = '';

            var peerList = tip.querySelector('.as-sub-tt-scroll');
            if (peerList) peerList.classList.remove('as-sub-tt-expanded');
        });
    }

    /** Clicking blank space in the panel body closes any open sub-panels */
    function attachPanelBlankClickHandler(bodyEl) {
        bodyEl.addEventListener('click', function (e) {
            // Only close if clicking on the body itself, not on interactive children
            if (e.target === bodyEl || e.target.classList.contains('modal-section-title') ||
                e.target.classList.contains('modal-row') || e.target.classList.contains('modal-label') ||
                e.target.classList.contains('modal-val')) {
                if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
                    hideSubTooltip();
                    hideSubSubTooltip();
                    if (distributionState.summarySelected) {
                        distributionState.filterPeerIds = null;
                        distributionState.filterLabel = null;
                        distributionState.filterCategory = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        activateHoverAll();
                        var rows = bodyEl.querySelectorAll('.sub-filter-active');
                        for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
                    } else if (distributionState.selectedProvider) {
                        clearSubFilter();
                    }
                }
            }
        });
    }

    /** Attach hover and click handlers to interactive rows in the detail panel */
    function attachInteractiveRowHandlers(bodyEl, seg) {
        var rows = bodyEl.querySelectorAll('.as-interactive-row');
        for (var ri = 0; ri < rows.length; ri++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', function (e) {
                    // When something is selected (pinned) or peer detail is open, suppress hover previews
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var category = rowEl.dataset.category;
                    var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                    var html = buildPeerSummaryHtml(peerIds, category, label);
                    showSubTooltip(html, e);
                    // Preview lines/filter for hovered sub-row
                    previewProviderLines(peerIds);
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (!distributionState.subTooltipPinned) positionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    hideSubTooltip();
                    restoreProviderFromPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var category = rowEl.dataset.category;
                    var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                    // Toggle: clicking same row unpins
                    if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        clearSubFilter();
                        return;
                    }
                    applySubFilter(peerIds, category, label);
                    var html = buildPeerSummaryHtml(peerIds, category, label);
                    showSubTooltip(html, e);
                    pinSubTooltip(rowEl);
                });
            })(rows[ri]);
        }
    }

    /** Show the sub-row hover tooltip */
    function showSubTooltip(html, event) {
        // Always close sub-sub tooltip when opening a new sub-tooltip
        hideSubSubTooltip();
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'as-sub-tooltip';
            tip.className = 'as-sub-tooltip';
            document.body.appendChild(tip);
        }
        tip.innerHTML = html;
        tip.classList.remove('hidden');
        tip.style.display = '';
        positionSubTooltip(event);
        attachSubTooltipHandlers();
    }

    function positionSubTooltip(event) {
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) return;
        var rect = tip.getBoundingClientRect();
        var pad = 12;
        // Position to the left of the detail panel
        var panelRect = panelEl ? panelEl.getBoundingClientRect() : { left: window.innerWidth };
        var x = panelRect.left - rect.width - pad;
        if (x < pad) x = pad;
        var y = event.clientY - rect.height / 2;
        if (y < pad) y = pad;
        if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    }

    function hideSubTooltip() {
        var tip = document.getElementById('as-sub-tooltip');
        if (tip) {
            tip.classList.add('hidden');
            tip.style.display = 'none';
            tip.style.pointerEvents = 'none';
        }
        distributionState.subTooltipPinned = false;
        pinnedSubTooltipSrc = null;
        hideSubSubTooltip();
    }

    /** Pin the sub-tooltip and remember the element that opened it. */
    function pinSubTooltip(srcEl) {
        distributionState.subTooltipPinned = true;
        pinnedSubTooltipSrc = srcEl || null;
        var tip = document.getElementById('as-sub-tooltip');
        if (tip) tip.style.pointerEvents = 'auto';
    }

    // ═══════════════════════════════════════════════════════════
    // SUB-SUB-TOOLTIP — Third-level drill-down (Provider → Peers)
    // ═══════════════════════════════════════════════════════════

    /** Show the sub-sub-tooltip with peer list for a specific provider */
    function showSubSubTooltip(html, event) {
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'as-sub-sub-tooltip';
            tip.className = 'as-sub-tooltip as-sub-sub-tooltip';
            document.body.appendChild(tip);
        }
        tip.innerHTML = html;
        tip.classList.remove('hidden');
        tip.style.display = '';
        tip.style.pointerEvents = 'auto';
        positionSubSubTooltip(event);
        attachSubSubTooltipHandlers();
    }

    function positionSubSubTooltip(event) {
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (!tip) return;
        var subTip = document.getElementById('as-sub-tooltip');
        var rect = tip.getBoundingClientRect();
        var pad = 12;
        // Position to the left of the sub-tooltip
        var anchor = subTip ? subTip.getBoundingClientRect() : (panelEl ? panelEl.getBoundingClientRect() : { left: window.innerWidth });
        var x = anchor.left - rect.width - pad;
        if (x < pad) x = pad;
        var y = event ? event.clientY - rect.height / 2 : anchor.top;
        if (y < pad) y = pad;
        if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    }

    function hideSubSubTooltip() {
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (tip) {
            tip.classList.add('hidden');
            tip.style.display = 'none';
            tip.style.pointerEvents = 'none';
        }
        distributionState.subSubTooltipPinned = false;
        distributionState.subSubFilterPeerIds = null;
        distributionState.subSubFilterProvider = null;
        distributionState.subSubFilterColor = null;
        // Clear provider row selection highlight in the sub-tooltip
        var subTip = document.getElementById('as-sub-tooltip');
        if (subTip) {
            var prevSel = subTip.querySelectorAll('.as-provider-row-selected');
            for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
        }
        // Clear legend focus when sub-sub dismisses
        if (distributionState.legendFocusProvider) {
            distributionState.legendFocusProvider = null;
            renderLegend();
        }
    }

    /** Attach peer-click and expand handlers to the sub-sub-tooltip */
    function attachSubSubTooltipHandlers() {
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (!tip) return;

        // Peer ID click → zoom to peer on map and open the large peer detail popup
        var idLinks = tip.querySelectorAll('.as-sub-tt-id-link');
        for (var li = 0; li < idLinks.length; li++) {
            (function (link) {
                link.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerId = parseInt(link.dataset.peerId);
                    if (isNaN(peerId)) return;
                    // Zoom to peer on map — panel stays open for navigation
                    if (_zoomToPeerOnly) _zoomToPeerOnly(peerId);
                    // Find the peer data and open the large popup
                    var peer = lastPeersRaw.find(function (p) { return p.id === peerId; });
                    if (peer) {
                        openPeerDetailPanel(peer, 'panel');
                        highlightSelectedPeerRow(peerId);
                    }
                });
            })(idLinks[li]);
        }

        // Peer row hover → preview line to individual peer
        attachPeerRowHoverHandlers(tip);

        var showMore = tip.querySelector('.as-sub-tt-show-more');
        var showLess = tip.querySelector('.as-sub-tt-show-less');
        if (!showMore || !showLess) return;

        showMore.addEventListener('click', function (e) {
            e.stopPropagation();
            var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
            for (var i = 0; i < extras.length; i++) extras[i].style.display = '';
            showMore.style.display = 'none';
            showLess.style.display = '';
            var peerList = tip.querySelector('.as-sub-tt-scroll');
            if (peerList) peerList.classList.add('as-sub-tt-expanded');
        });

        showLess.addEventListener('click', function (e) {
            e.stopPropagation();
            var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
            for (var i = 0; i < extras.length; i++) extras[i].style.display = 'none';
            showLess.style.display = 'none';
            showMore.style.display = '';
            var peerList = tip.querySelector('.as-sub-tt-scroll');
            if (peerList) peerList.classList.remove('as-sub-tt-expanded');
        });
    }

    /** Build provider list HTML for the sub-tooltip in summary drill-down mode.
     *  providers: [{asNumber, name, color, peerCount, peerIds, peers}] */
    function buildProviderListHtml(providers, catLabel, navAsNum) {
        var privateNetMap = { 'Tor': 'onion', 'I2P': 'i2p', 'CJDNS': 'cjdns' };
        var html = '';
        html += '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
        html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + catLabel + '</div>';
        // For private network categories, add link to private network panel
        if (privateNetMap[catLabel]) {
            html += '<div class="as-sub-tt-nav as-private-net-link" data-net="' + privateNetMap[catLabel] + '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open ' + catLabel + ' Network panel</div>';
        }
        // Optional nav link to open a provider/segment panel
        if (navAsNum) {
            html += '<div class="as-sub-tt-nav as-grid-provider-click" data-as="' + navAsNum + '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open ' + catLabel + ' panel</div>';
        }
        // For service flag categories, expand abbreviations to full descriptions
        if (catLabel) {
            var abbrs = catLabel.split(/\s+/);
            for (var ai = 0; ai < abbrs.length; ai++) {
                for (var fk in SERVICE_FLAGS) {
                    if (SERVICE_FLAGS.hasOwnProperty(fk) && SERVICE_FLAGS[fk].abbr === abbrs[ai]) {
                        html += '<div class="as-sub-tt-flag" style="font-size:10px; color:var(--text-secondary)">' + escHtml(abbrs[ai]) + ' = ' + escHtml(serviceFlagDescription(SERVICE_FLAGS[fk])) + '</div>';
                        break;
                    }
                }
            }
        }
        html += '</div>';

        html += '<div class="as-sub-tt-scroll">';
        for (var i = 0; i < providers.length; i++) {
            var prov = providers[i];
            var peerIdsJson = JSON.stringify(prov.peerIds || prov.pi).replace(/"/g, '&quot;');
            html += '<div class="as-sub-tt-peer as-provider-row" data-as="' + (prov.asNumber || prov.a) + '" data-peer-ids="' + peerIdsJson + '">';
            html += '<span class="as-grid-dot" style="background:' + (prov.color || prov.c) + '"></span>';
            html += '<span class="as-sub-tt-id as-provider-click" style="cursor:pointer">' + (prov.asNumber || prov.a) + '</span>';
            var name = (prov.name || prov.n || '');
            if (name.length > 18) name = name.substring(0, 17) + '\u2026';
            html += '<span class="as-sub-tt-loc" title="' + (prov.name || prov.n || '') + '">' + name + '</span>';
            html += '<span class="as-sub-tt-type">' + (prov.peerCount || prov.pc) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    /** Build peer list HTML for the sub-sub-tooltip */
    function buildPeerListHtmlForSubSub(peers) {
        var html = '';
        var initialShow = 6;
        var hasMore = peers.length > initialShow;

        html += '<div class="as-sub-tt-scroll">';
        for (var pi = 0; pi < peers.length; pi++) {
            var p = peers[pi];
            var ct = p.connection_type || 'unknown';
            var ctLabel = CONN_TYPE_LABELS[ct] || ct;
            var loc = (p.city || '') + (p.city && p.country ? ', ' : '') + (p.country || '');
            if (loc.length > 16) loc = loc.substring(0, 15) + '\u2026';
            var peerAs = parseAsNumber(p.as) || '';
            var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
            html += '<div class="as-sub-tt-peer' + extraClass + '" data-peer-id="' + p.id + '" data-as="' + peerAs + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
            html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + ctLabel + '</span>';
            if (loc) html += '<span class="as-sub-tt-loc">' + loc + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (hasMore) {
            var remaining = peers.length - initialShow;
            html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    /** Highlight the selected peer row in both sub-tooltip and sub-sub-tooltip */
    function highlightSelectedPeerRow(peerId) {
        selectedPeerId = peerId;
        // Remove previous selected highlights
        var allSelected = document.querySelectorAll('.as-sub-tt-peer-selected');
        for (var i = 0; i < allSelected.length; i++) allSelected[i].classList.remove('as-sub-tt-peer-selected');
        // Add highlight to matching row(s)
        var tips = [document.getElementById('as-sub-tooltip'), document.getElementById('as-sub-sub-tooltip')];
        for (var ti = 0; ti < tips.length; ti++) {
            if (!tips[ti]) continue;
            var rows = tips[ti].querySelectorAll('.as-sub-tt-peer[data-peer-id]');
            for (var ri = 0; ri < rows.length; ri++) {
                if (parseInt(rows[ri].dataset.peerId) === peerId) {
                    rows[ri].classList.add('as-sub-tt-peer-selected');
                }
            }
        }
    }

    /** Restore the donut visual state after a hover preview ends.
     *  Checks for active sub-filters, insights, or selections and restores appropriately
     *  instead of blindly reverting to the default distribution score display. */
    function restoreDonutAfterPreview() {
        distributionState.summaryPreviewPeerIds = null;
        distributionState.summaryPreviewLabel = null;
        if (!donutFocused) return;
        if (distributionState.subSubFilterProvider && distributionState.subSubTooltipPinned) {
            // A Level 3 provider is selected (sub-sub pinned) — keep donut on that provider
            showFocusedCenterText(distributionState.subSubFilterProvider);
            animateDonutExpand(distributionState.subSubFilterProvider);
        } else if (insightActiveAsNum) {
            // An insight is active (Most Stable, Fastest, etc.) — keep donut on that provider
            if (donutController.isInsightVisible()) {
                restoreInsightRectProvider();
            }
            showFocusedCenterText(insightActiveAsNum);
            animateDonutExpand(insightActiveAsNum);
        } else if (distributionState.filterCategory && distributionState.filterCategory.indexOf('conn-') === 0 && distributionState.filterLabel) {
            // A conn-provider/conn-out/conn-in sub-filter is active — keep donut on that
            showFocusedCenterText(distributionState.filterLabel);
            animateDonutExpand(distributionState.filterLabel);
        } else if (distributionState.filterPeerIds && distributionState.filterLabel && distributionState.filterCategory === 'summary') {
            // A summary category sub-filter is active (IPv4, etc.) — show category info
            animateDonutRevert();
            renderCenter();
        } else {
            // No active sub-filter — revert to default
            animateDonutRevert();
            renderCenter();
        }
    }

    // ═══════════════════════════════════════════════════════════
    // HOVER PREVIEW HELPERS — draw lines and filter peer table
    // without changing sub-filter state, purely visual preview
    // ═══════════════════════════════════════════════════════════

    /** Preview lines/filter for a set of peer IDs in summary mode (grouped by AS) */
    function previewSummaryLines(peerIds) {
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);
        if (_drawLinesForAllAs && donutSegments.length > 0) {
            var idSet = {};
            for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
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
    }

    /** Preview lines/filter for a set of peer IDs in provider mode (single AS) */
    function previewProviderLines(peerIds) {
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);
        if (distributionState.selectedProvider && _drawLinesForAs) {
            var color = getColorForActiveEntity(distributionState.selectedProvider);
            _drawLinesForAs(distributionState.selectedProvider, peerIds, color);
        }
    }

    /** Preview category info in the donut center during hover (focused mode only).
     *  Shows the category label, peer count, and percentage without changing state. */
    function previewSummaryCenterText(peerIds, label) {
        if (!donutFocused) return;
        distributionState.summaryPreviewPeerIds = peerIds;
        distributionState.summaryPreviewLabel = label;
        donutController.renderFilterCenter(peerIds.length, label, getActiveTotalPeers());
    }

    /** Restore lines/filter/dim after a hover preview ends (summary mode) */
    function restoreSummaryFromPreview() {
        // Don't restore if big peer popup is active — it manages its own line state
        if (peerDetailActive) return;
        if (distributionState.subSubFilterPeerIds && distributionState.subSubFilterProvider) {
            // Was showing sub-sub (e.g. a specific provider within a category)
            var ssColor = distributionState.subSubFilterColor || getColorForAsNum(distributionState.subSubFilterProvider);
            if (_drawLinesForAs) _drawLinesForAs(distributionState.subSubFilterProvider, distributionState.subSubFilterPeerIds, ssColor);
            if (_filterPeerTable) _filterPeerTable(distributionState.subSubFilterPeerIds);
            if (_dimMapPeers) _dimMapPeers(distributionState.subSubFilterPeerIds);
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
                    if (asNum) setLegendFocus(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    if (donutFocused && asNum && donutController.isInsightVisible()) {
                        restoreInsightRectProvider();
                    } else if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                    return;
                }
            }
            // Fallback: show all
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            activateHoverAll();
        } else if (insightActiveAsNum) {
            // Insight is active (e.g. Most Stable clicked) — restore to showing the insight's provider
            var asNum = insightActiveAsNum;
            var peerIds = getPeerIdsForAnyAs(asNum);
            var color = getColorForAsNum(asNum);
            if (asNum) setLegendFocus(asNum);
            if (peerIds.length > 0 && _drawLinesForAs) {
                _drawLinesForAs(asNum, peerIds, color);
            }
            if (_filterPeerTable) _filterPeerTable(peerIds);
            if (_dimMapPeers) _dimMapPeers(peerIds);
            if (donutFocused && donutController.isInsightVisible()) {
                restoreInsightRectProvider();
            } else if (donutFocused) {
                showFocusedCenterText(asNum);
                animateDonutExpand(asNum);
            }
        } else {
            // No filter — show all
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            activateHoverAll();
        }
    }

    /** Restore lines/filter/dim after a hover preview ends (provider mode) */
    function restoreProviderFromPreview() {
        // Don't restore if big peer popup is active — it manages its own line state
        if (peerDetailActive) return;
        if (distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0) {
            previewProviderLines(distributionState.filterPeerIds);
        } else if (distributionState.selectedProvider) {
            var allPeerIds = getPeerIdsForActiveEntity(distributionState.selectedProvider);
            var color = getColorForActiveEntity(distributionState.selectedProvider);
            if (_filterPeerTable) _filterPeerTable(allPeerIds);
            if (_dimMapPeers) _dimMapPeers(allPeerIds);
            if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, allPeerIds, color);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // SUMMARY DRILL-DOWN HANDLERS
    // ═══════════════════════════════════════════════════════════

    /** Attach hover/click handlers to summary interactive rows (sections 3-7).
     *  These rows drill down to provider list, not peer list. */
    function attachSummaryRowHandlers(bodyEl) {
        var rows = bodyEl.querySelectorAll('.as-summary-row');
        for (var ri = 0; ri < rows.length; ri++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', function (e) {
                    // When something is selected (pinned) or peer detail is open, suppress hover previews
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var providers = JSON.parse(rowEl.dataset.providers);
                    var catLabel = rowEl.dataset.catLabel;
                    var html = buildProviderListHtml(providers, catLabel);
                    showSubTooltip(html, e);
                    // Preview lines/filter for hovered category
                    previewSummaryLines(peerIds);
                    // Preview category info in donut center
                    previewSummaryCenterText(peerIds, catLabel);
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (!distributionState.subTooltipPinned) positionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                    restoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (peerDetailActive) closePeerPopup();
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var providers = JSON.parse(rowEl.dataset.providers);
                    var catLabel = rowEl.dataset.catLabel;

                    // Toggle: clicking same row unpins
                    if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        clearSummarySubFilter();
                        restoreDonutAfterPreview();
                        return;
                    }

                    // Apply sub-filter for all peers in this category
                    applySummarySubFilter(peerIds, catLabel);

                    // Immediately update the donut to reflect the new category
                    restoreDonutAfterPreview();

                    // Pin the sub-tooltip with provider list
                    var html = buildProviderListHtml(providers, catLabel);
                    showSubTooltip(html, e);
                    pinSubTooltip(rowEl);
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

    /** Attach click handlers for provider rows in the sub-tooltip (summary mode).
     *  Hovering previews lines on the map; clicking opens the sub-sub-tooltip with that provider's peers. */
    function attachProviderClickHandlers(tip) {
        var provRows = tip.querySelectorAll('.as-provider-row');
        for (var pi = 0; pi < provRows.length; pi++) {
            (function (provRow) {
                provRow.style.cursor = 'pointer';
                // Hover preview: show lines + filter for this provider's peers
                provRow.addEventListener('mouseenter', function () {
                    if (peerDetailActive || distributionState.subSubTooltipPinned) return;
                    var asNum = provRow.dataset.as;
                    var peerIds = JSON.parse(provRow.dataset.peerIds);
                    // Focus legend on this provider
                    if (asNum) setLegendFocus(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // In focused mode, show provider in donut center + animate
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                provRow.addEventListener('mouseleave', function () {
                    if (peerDetailActive || distributionState.subSubTooltipPinned) return;
                    clearLegendFocus();
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
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }

                    var asNum = provRow.dataset.as;
                    // Keep legend focused on this provider while sub-sub is pinned
                    distributionState.legendFocusProvider = asNum;
                    renderLegend();

                    // Highlight this provider row as selected in the sub-tooltip
                    var tip = document.getElementById('as-sub-tooltip');
                    if (tip) {
                        var prevSel = tip.querySelectorAll('.as-provider-row-selected');
                        for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
                    }
                    provRow.classList.add('as-provider-row-selected');

                    var html = buildPeerListHtmlForSubSub(matchedPeers);
                    showSubSubTooltip(html, e);
                    distributionState.subSubTooltipPinned = true;

                    // Track sub-sub state for data refresh preservation
                    distributionState.subSubFilterPeerIds = peerIds;
                    distributionState.subSubFilterProvider = asNum;
                    distributionState.subSubFilterColor = getColorForAsNum(asNum);

                    // Draw lines for just this provider's peers
                    if (_drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, distributionState.subSubFilterColor);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
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
                    if (_enterPrivateNetMode && netKey) _enterPrivateNetMode(netKey);
                });
            })(pnLinks[pnli]);
        }
    }

    /** Attach handlers for the Connections by Provider section (Section 2 of summary panel) */
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
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }
                    // Find the provider name for the header
                    var provName = asNum;
                    var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
                    if (grp) provName = grp.asShort || grp.asName || asNum;
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + provName + ' Peers</div>';
                    html += '<div class="as-sub-tt-nav as-grid-provider-click" data-as="' + asNum + '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open provider panel</div>';
                    html += '</div>';
                    html += buildPeerListHtmlForSubSub(matchedPeers);
                    return html;
                }
                rowEl.addEventListener('mouseenter', function (e) {
                    // When something is selected (pinned) or peer detail is open, suppress hover previews
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var asNum = rowEl.dataset.as;
                    if (asNum) setLegendFocus(asNum);
                    var html = buildProvPeerHtml();
                    if (html) showSubTooltip(html, e);
                    // Preview lines for this provider
                    if (asNum && peerIds.length > 0) {
                        var color = getColorForAsNum(asNum);
                        if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);
                        if (_filterPeerTable) _filterPeerTable(peerIds);
                        if (_dimMapPeers) _dimMapPeers(peerIds);
                    }
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    clearLegendFocus();
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                    restoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (peerDetailActive) closePeerPopup();
                    if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        distributionState.filterPeerIds = null;
                        distributionState.filterCategory = null;
                        distributionState.filterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (distributionState.summarySelected) activateHoverAll();
                        restoreDonutAfterPreview();
                        return;
                    }
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var html = buildProvPeerHtml();
                    if (!html) return;
                    showSubTooltip(html, e);
                    pinSubTooltip(rowEl);
                    attachSubTooltipHandlers();
                    var tipEl = document.getElementById('as-sub-tooltip');
                    if (tipEl) attachProviderNavHandlers(tipEl);
                    // Clear any active insight state when selecting a provider
                    if (insightActiveAsNum || insightActiveType) {
                        insightActiveAsNum = null; insightActiveData = null;
                        insightActiveType = null;
                        hideInsightRect();
                    }
                    // Clear all highlights before setting new ones
                    var activeBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                    if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                    // Highlight this row as the active selection
                    rowEl.classList.add('sub-filter-active');
                    // Track sub-filter state for data refresh preservation
                    var asNum = rowEl.dataset.as;
                    distributionState.filterPeerIds = peerIds;
                    distributionState.filterCategory = 'conn-provider';
                    distributionState.filterLabel = asNum || '';
                    // Draw lines for this provider's peers
                    if (asNum && _drawLinesForAs) {
                        var color = getColorForAsNum(asNum);
                        _drawLinesForAs(asNum, peerIds, color);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // Keep donut expanded for this provider while viewing its peers
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
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
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }
                    html += '<div style="border-top:1px solid rgba(88,166,255,0.1); margin-top:4px; padding-top:4px">';
                    html += buildPeerListHtmlForSubSub(matchedPeers);
                    html += '</div>';
                    return html;
                }
                rowEl.addEventListener('mouseenter', function (e) {
                    // When something is selected (pinned) or peer detail is open, suppress hover previews
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var asNum = rowEl.dataset.as;
                    if (asNum) setLegendFocus(asNum);
                    var html = buildOutSubHtml();
                    if (html) showSubTooltip(html, e);
                    if (asNum && peerIds.length > 0) {
                        var color = getColorForAsNum(asNum);
                        if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);
                        if (_filterPeerTable) _filterPeerTable(peerIds);
                        if (_dimMapPeers) _dimMapPeers(peerIds);
                    }
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    clearLegendFocus();
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                    restoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        distributionState.filterPeerIds = null;
                        distributionState.filterCategory = null;
                        distributionState.filterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (distributionState.summarySelected) activateHoverAll();
                        restoreDonutAfterPreview();
                        return;
                    }
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var html = buildOutSubHtml();
                    if (!html) return;
                    showSubTooltip(html, e);
                    pinSubTooltip(rowEl);
                    attachSubTooltipHandlers();
                    // Clear insight state
                    if (insightActiveAsNum || insightActiveType) { insightActiveAsNum = null; insightActiveData = null; insightActiveType = null; hideInsightRect(); }
                    var activeBodyOut = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                    if (activeBodyOut) { var prev = activeBodyOut.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                    // Highlight this row as the active selection
                    rowEl.classList.add('sub-filter-active');
                    // Track sub-filter state for data refresh preservation
                    distributionState.filterPeerIds = peerIds;
                    distributionState.filterCategory = 'conn-out';
                    distributionState.filterLabel = rowEl.dataset.as || '';
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // Keep donut expanded for the parent provider
                    var asNum = rowEl.dataset.as;
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
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
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Inbound Peers</div>';
                    html += '</div>';
                    html += buildPeerListHtmlForSubSub(matchedPeers);
                    return html;
                }
                rowEl.addEventListener('mouseenter', function (e) {
                    // When something is selected (pinned) or peer detail is open, suppress hover previews
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var asNum = rowEl.dataset.as;
                    if (asNum) setLegendFocus(asNum);
                    var html = buildDirPeerHtml();
                    if (html) showSubTooltip(html, e);
                    if (asNum && peerIds.length > 0) {
                        var color = getColorForAsNum(asNum);
                        if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);
                        if (_filterPeerTable) _filterPeerTable(peerIds);
                        if (_dimMapPeers) _dimMapPeers(peerIds);
                    }
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    clearLegendFocus();
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                    restoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        distributionState.filterPeerIds = null;
                        distributionState.filterCategory = null;
                        distributionState.filterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (distributionState.summarySelected) activateHoverAll();
                        restoreDonutAfterPreview();
                        return;
                    }
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var html = buildDirPeerHtml();
                    if (!html) return;
                    showSubTooltip(html, e);
                    pinSubTooltip(rowEl);
                    attachSubTooltipHandlers();
                    // Clear insight state
                    if (insightActiveAsNum || insightActiveType) { insightActiveAsNum = null; insightActiveData = null; insightActiveType = null; hideInsightRect(); }
                    var activeBodyIn = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                    if (activeBodyIn) { var prev = activeBodyIn.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                    // Highlight this row as the active selection
                    rowEl.classList.add('sub-filter-active');
                    // Track sub-filter state for data refresh preservation
                    distributionState.filterPeerIds = peerIds;
                    distributionState.filterCategory = 'conn-in';
                    distributionState.filterLabel = rowEl.dataset.as || '';
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // Keep donut expanded for the parent provider
                    var asNum = rowEl.dataset.as;
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
            })(connDirRows[cdi]);
        }

        // Others row — 3-level: hover/click shows provider list, then provider → peer list
        var connOthersRows = bodyEl.querySelectorAll('.as-conn-others-row');
        for (var coi2 = 0; coi2 < connOthersRows.length; coi2++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', function (e) {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var providers = JSON.parse(rowEl.dataset.providers);
                    var html = buildProviderListHtml(providers, 'Others', 'Others');
                    showSubTooltip(html, e);
                    previewSummaryLines(peerIds);
                    previewSummaryCenterText(peerIds, 'Others');
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (!distributionState.subTooltipPinned) positionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                    restoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (peerDetailActive) closePeerPopup();
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var providers = JSON.parse(rowEl.dataset.providers);

                    // Toggle: clicking same row unpins
                    if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        distributionState.filterPeerIds = null;
                        distributionState.filterCategory = null;
                        distributionState.filterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (distributionState.summarySelected) activateHoverAll();
                        restoreDonutAfterPreview();
                        return;
                    }

                    // Clear insight state
                    if (insightActiveAsNum || insightActiveType) {
                        insightActiveAsNum = null; insightActiveData = null;
                        insightActiveType = null;
                        hideInsightRect();
                    }
                    // Clear all highlights before setting new ones
                    var activeBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                    if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                    rowEl.classList.add('sub-filter-active');

                    // Track sub-filter state — use 'conn-others' so refresh
                    // rebuilds from the Others donut segment, not summary categories
                    distributionState.filterPeerIds = peerIds;
                    distributionState.filterCategory = 'conn-others';
                    distributionState.filterLabel = 'Others';

                    // Draw lines grouped by AS for the Others peers
                    if (_drawLinesForAllAs && donutSegments.length > 0) {
                        var idSet = {};
                        for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
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
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);

                    restoreDonutAfterPreview();

                    // Pin the sub-tooltip with provider list + "Open Others panel" nav link
                    var html = buildProviderListHtml(providers, 'Others', 'Others');
                    showSubTooltip(html, e);
                    pinSubTooltip(rowEl);
                    var tipEl2 = document.getElementById('as-sub-tooltip');
                    attachProviderClickHandlers(tipEl2);
                    attachProviderNavHandlers(tipEl2);
                });
            })(connOthersRows[coi2]);
        }
    }

    /** Attach handlers for clickable links in the summary panel (provider nav, peer select, all-providers, longest peers, data insights) */
    function attachSummaryLinkHandlers(bodyEl) {
        // "Navigate to provider" links — hover previews lines to that provider's peers, click navigates
        var navLinks = bodyEl.querySelectorAll('.as-navigate-provider');
        for (var i = 0; i < navLinks.length; i++) {
            (function (el) {
                el.addEventListener('mouseenter', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    var asNum = el.dataset.as;
                    if (!asNum) return;
                    // Focus legend on this provider
                    setLegendFocus(asNum);
                    var peerIds = getPeerIdsForAnyAs(asNum);
                    var color = getColorForAsNum(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs) {
                        _drawLinesForAs(asNum, peerIds, color);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // In focused mode, show provider in donut center + animate
                    if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                el.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    clearLegendFocus();
                    restoreSummaryFromPreview();
                    restoreDonutAfterPreview();
                });
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var asNum = el.dataset.as;
                    if (asNum) navigateToProvider(asNum);
                });
            })(navLinks[i]);
        }

        // "All providers" links — opens sub-tooltip with all providers
        var allProvLinks = bodyEl.querySelectorAll('.as-all-providers-link');
        for (var i = 0; i < allProvLinks.length; i++) {
            (function (el) {
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (peerDetailActive) closePeerPopup();
                    // Toggle: clicking same link unpins
                    if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === el) {
                        hideSubTooltip();
                        distributionState.filterPeerIds = null;
                        distributionState.filterCategory = null;
                        distributionState.filterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (distributionState.summarySelected) activateHoverAll();
                        return;
                    }
                    var allProvs = asGroups.map(function (g) {
                        return { asNumber: g.asNumber, name: g.asShort || g.asName || g.asNumber, color: getColorForAsNum(g.asNumber), peerCount: g.peerCount, peerIds: g.peerIds, peers: g.peers };
                    });
                    var html = buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')');
                    showSubTooltip(html, e);
                    pinSubTooltip(el);
                    var tip = document.getElementById('as-sub-tooltip');
                    if (tip) {
                        attachProviderClickHandlers(tip);
                        attachProviderNavHandlers(tip);
                    }
                    // Track sub-filter state for data refresh preservation
                    distributionState.filterPeerIds = [];
                    distributionState.filterCategory = 'all-providers';
                    distributionState.filterLabel = 'all-providers';
                });
            })(allProvLinks[i]);
        }

        // Header provider links
        if (panelEl) {
            var headerProvLinks = panelEl.querySelectorAll('.as-detail-header-info .as-all-providers-link');
            for (var i = 0; i < headerProvLinks.length; i++) {
                (function (el) {
                    el.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === el) {
                            hideSubTooltip();
                            distributionState.filterPeerIds = null;
                            distributionState.filterCategory = null;
                            distributionState.filterLabel = null;
                            if (_filterPeerTable) _filterPeerTable(null);
                            if (_dimMapPeers) _dimMapPeers(null);
                            if (distributionState.summarySelected) activateHoverAll();
                            return;
                        }
                        var allProvs = asGroups.map(function (g) {
                            return { asNumber: g.asNumber, name: g.asShort || g.asName || g.asNumber, color: getColorForAsNum(g.asNumber), peerCount: g.peerCount, peerIds: g.peerIds, peers: g.peers };
                        });
                        var html = buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')');
                        showSubTooltip(html, e);
                        pinSubTooltip(el);
                        var tip = document.getElementById('as-sub-tooltip');
                        if (tip) {
                            attachProviderClickHandlers(tip);
                            attachProviderNavHandlers(tip);
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
                var data = computeSummaryData();
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
                if (distributionState.subTooltipPinned || peerDetailActive) return;
                var html = buildFastestProvHtml();
                if (html) showSubTooltip(html, e);
                // Preview lines for the #1 fastest provider + focus legend + show insight rect
                var data = computeSummaryData();
                for (var j = 0; j < data.insights.length; j++) {
                    if (data.insights[j].type === 'fastest' && data.insights[j].topProviders && data.insights[j].topProviders.length > 0) {
                        var top = data.insights[j].topProviders[0];
                        setLegendFocus(top.asNumber);
                        if (_drawLinesForAs) _drawLinesForAs(top.asNumber, top.peerIds, top.color);
                        if (_filterPeerTable) _filterPeerTable(top.peerIds);
                        if (_dimMapPeers) _dimMapPeers(top.peerIds);
                        if (donutFocused) {
                            showInsightRect('fastest', {
                                provName: top.provName || (top.asShort || top.asNumber),
                                asNumber: top.asNumber,
                                peerIds: top.peerIds,
                                avgPing: top.avgPing,
                                rank: 1,
                                color: top.color || getColorForAsNum(top.asNumber)
                            });
                            animateDonutExpand(top.asNumber);
                        }
                        break;
                    }
                }
            });
            fastestLink.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || peerDetailActive) return;
                clearLegendFocus();
                hideSubTooltip();
                hideInsightRect();
                restoreSummaryFromPreview();
                restoreDonutAfterPreview();
            });
            fastestLink.addEventListener('click', function (e) {
                e.stopPropagation();
                if (peerDetailActive) closePeerPopup();
                if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === fastestLink) {
                    hideSubTooltip();
                    fastestLink.closest('.as-summary-insight').classList.remove('sub-filter-active');
                    distributionState.filterPeerIds = null;
                    distributionState.filterCategory = null;
                    distributionState.filterLabel = null;
                    insightActiveAsNum = null; insightActiveData = null;
                    insightActiveType = null;
                    hideInsightRect();
                    if (donutFocused) animateDonutRevert();
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (distributionState.summarySelected) activateHoverAll();
                    renderCenter();
                    return;
                }
                var html = buildFastestProvHtml();
                if (!html) return;
                showSubTooltip(html, e);
                pinSubTooltip(fastestLink);
                attachFastestProvRowHandlers(document.getElementById('as-sub-tooltip'));
                // Clear any other active highlights before adding ours
                var activeBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                fastestLink.closest('.as-summary-insight').classList.add('sub-filter-active');
                // Track sub-filter state for data refresh preservation
                distributionState.filterPeerIds = [];
                distributionState.filterCategory = 'insight-fastest';
                distributionState.filterLabel = 'fastest';
                // Activate insight donut state — show insight rectangle for #1 fastest provider
                var insData = computeSummaryData();
                for (var ij = 0; ij < insData.insights.length; ij++) {
                    if (insData.insights[ij].type === 'fastest' && insData.insights[ij].topProviders && insData.insights[ij].topProviders.length > 0) {
                        var topProv = insData.insights[ij].topProviders[0];
                        insightActiveAsNum = topProv.asNumber;
                        insightActiveType = 'fastest';
                        if (donutFocused) {
                            showInsightRect('fastest', {
                                provName: topProv.provName,
                                asNumber: topProv.asNumber,
                                peerIds: topProv.peerIds,
                                avgPing: topProv.avgPing,
                                rank: 1,
                                color: topProv.color || getColorForAsNum(topProv.asNumber)
                            });
                        }
                        setLegendFocus(topProv.asNumber);
                        // Also draw lines for #1 provider immediately
                        if (_drawLinesForAs) _drawLinesForAs(topProv.asNumber, topProv.peerIds, topProv.color);
                        if (_filterPeerTable) _filterPeerTable(topProv.peerIds);
                        if (_dimMapPeers) _dimMapPeers(topProv.peerIds);
                        break;
                    }
                }
            });
        }

        // "Most stable" link — hover shows peer list for that provider, click pins sub-panel
        var stableLink = bodyEl.querySelector('.as-stable-link');
        if (stableLink) {
            function buildStablePeersHtml() {
                var data = computeSummaryData();
                var stableInsight = null;
                for (var j = 0; j < data.insights.length; j++) {
                    if (data.insights[j].type === 'stable') { stableInsight = data.insights[j]; break; }
                }
                if (!stableInsight) return null;
                var peerIds = stableInsight.peerIds;
                var idSet = {};
                for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
                var matchedPeers = [];
                for (var i = 0; i < lastPeersRaw.length; i++) {
                    if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                }
                var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + stableInsight.provName + ' Peers</div>';
                html += '<div class="as-sub-tt-nav as-grid-provider-click" data-as="' + stableInsight.asNumber + '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open provider panel</div>';
                html += '</div>';
                html += buildPeerListHtmlForSubSub(matchedPeers);
                return { html: html, peerIds: peerIds, asNum: stableInsight.asNumber };
            }
            stableLink.addEventListener('mouseenter', function (e) {
                // When something is selected (pinned) or peer detail is open, suppress hover previews
                if (distributionState.subTooltipPinned || peerDetailActive) return;
                var asNum = stableLink.dataset.as;
                if (asNum) setLegendFocus(asNum);
                var result = buildStablePeersHtml();
                if (result) showSubTooltip(result.html, e);
                // Preview lines + filter for this provider + show insight rect
                if (asNum) {
                    var peerIds = getPeerIdsForAnyAs(asNum);
                    var color = getColorForAsNum(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs) {
                        _drawLinesForAs(asNum, peerIds, color);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    if (donutFocused) {
                        var insData = computeSummaryData();
                        var stableIns = null;
                        for (var ij = 0; ij < insData.insights.length; ij++) {
                            if (insData.insights[ij].type === 'stable') { stableIns = insData.insights[ij]; break; }
                        }
                        if (stableIns) {
                            showInsightRect('stable', {
                                provName: stableIns.provName,
                                asNumber: stableIns.asNumber,
                                peerIds: stableIns.peerIds,
                                durText: stableIns.durText,
                                color: color
                            });
                        }
                        animateDonutExpand(asNum);
                    }
                }
            });
            stableLink.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || peerDetailActive) return;
                clearLegendFocus();
                hideSubTooltip();
                hideInsightRect();
                restoreSummaryFromPreview();
                restoreDonutAfterPreview();
            });
            stableLink.addEventListener('click', function (e) {
                e.stopPropagation();
                if (peerDetailActive) closePeerPopup();
                // Toggle
                if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === stableLink) {
                    hideSubTooltip();
                    stableLink.closest('.as-summary-insight').classList.remove('sub-filter-active');
                    distributionState.filterPeerIds = null;
                    distributionState.filterCategory = null;
                    distributionState.filterLabel = null;
                    insightActiveAsNum = null; insightActiveData = null;
                    insightActiveType = null;
                    hideInsightRect();
                    if (donutFocused) animateDonutRevert();
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (distributionState.summarySelected) activateHoverAll();
                    renderCenter();
                    return;
                }
                var result = buildStablePeersHtml();
                if (!result) return;
                showSubTooltip(result.html, e);
                pinSubTooltip(stableLink);
                attachSubTooltipHandlers();
                var tip = document.getElementById('as-sub-tooltip');
                if (tip) attachProviderNavHandlers(tip);
                // Clear any other active highlights before adding ours
                var activeBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                if (activeBodyEl) { var prev = activeBodyEl.querySelectorAll('.sub-filter-active'); for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active'); }
                stableLink.closest('.as-summary-insight').classList.add('sub-filter-active');
                // Track sub-filter state for data refresh preservation
                distributionState.filterPeerIds = result.peerIds;
                distributionState.filterCategory = 'insight-stable';
                distributionState.filterLabel = result.asNum;
                if (_filterPeerTable) _filterPeerTable(result.peerIds);
                if (_dimMapPeers) _dimMapPeers(result.peerIds);
                // Draw lines for this provider
                var color = getColorForAsNum(result.asNum);
                if (_drawLinesForAs && result.asNum) {
                    _drawLinesForAs(result.asNum, result.peerIds, color);
                }
                // Activate insight donut state — show insight rectangle
                insightActiveAsNum = result.asNum;
                insightActiveType = 'stable';
                if (donutFocused) {
                    var insData = computeSummaryData();
                    var stableIns = null;
                    for (var ij = 0; ij < insData.insights.length; ij++) {
                        if (insData.insights[ij].type === 'stable') { stableIns = insData.insights[ij]; break; }
                    }
                    if (stableIns) {
                        showInsightRect('stable', {
                            provName: stableIns.provName,
                            asNumber: stableIns.asNumber,
                            peerIds: stableIns.peerIds,
                            durText: stableIns.durText,
                            color: color
                        });
                    }
                }
                setLegendFocus(result.asNum);
            });
        }

        // Data insight provider sub-panels (Most sent/recv — hover shows providers ranked by bytes)
        var dataProvLinks = bodyEl.querySelectorAll('.as-data-providers-link');
        for (var i = 0; i < dataProvLinks.length; i++) {
            (function (el) {
                var field = el.dataset.field;
                var isRecv = field === 'bytesrecv';

                function buildDataProviderHtml() {
                    var data = computeSummaryData();
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
                        html += '<span class="as-sub-tt-type">' + fmtBytes(prov.totalBytes) + '</span>';
                        html += '</div>';
                    }
                    html += '</div>';
                    return { html: html, insight: insight };
                }

                el.addEventListener('mouseenter', function (e) {
                    // When something is selected (pinned) or peer detail is open, suppress hover previews
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    var result = buildDataProviderHtml();
                    if (!result) return;
                    showSubTooltip(result.html, e);
                    // Preview lines for the #1 data provider + focus legend + show insight rect
                    if (result.insight && result.insight.topProviders && result.insight.topProviders.length > 0) {
                        var top = result.insight.topProviders[0];
                        setLegendFocus(top.asNumber);
                        var topPeerIds = top.peers.slice(0, 20).map(function (p) { return p.id; });
                        if (_drawLinesForAs) _drawLinesForAs(top.asNumber, topPeerIds, top.color);
                        if (_filterPeerTable) _filterPeerTable(topPeerIds);
                        if (_dimMapPeers) _dimMapPeers(topPeerIds);
                        if (donutFocused) {
                            var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                            showInsightRect(rectType, {
                                provName: top.provName,
                                asNumber: top.asNumber,
                                peers: top.peers,
                                totalBytes: top.totalBytes,
                                rank: 1,
                                color: top.color || getColorForAsNum(top.asNumber)
                            });
                            animateDonutExpand(top.asNumber);
                        }
                    }
                });
                el.addEventListener('mouseleave', function () {
                    if (distributionState.subTooltipPinned || peerDetailActive) return;
                    clearLegendFocus();
                    hideSubTooltip();
                    hideInsightRect();
                    restoreSummaryFromPreview();
                    restoreDonutAfterPreview();
                });
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (peerDetailActive) closePeerPopup();
                    // Toggle: clicking same link unpins
                    if (distributionState.subTooltipPinned && pinnedSubTooltipSrc === el) {
                        hideSubTooltip();
                        el.closest('.as-summary-insight').classList.remove('sub-filter-active');
                        distributionState.filterPeerIds = null;
                        distributionState.filterCategory = null;
                        distributionState.filterLabel = null;
                        insightActiveAsNum = null; insightActiveData = null;
                        insightActiveType = null;
                        hideInsightRect();
                        if (donutFocused) animateDonutRevert();
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (distributionState.summarySelected) activateHoverAll();
                        renderCenter();
                        return;
                    }
                    var result = buildDataProviderHtml();
                    if (!result) return;
                    showSubTooltip(result.html, e);
                    pinSubTooltip(el);
                    attachDataProviderRowHandlers(document.getElementById('as-sub-tooltip'), field);
                    // Clear any other active highlights before adding ours
                    var activeBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
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
                        insightActiveAsNum = topDataProv.asNumber;
                        insightActiveType = 'data-' + field;
                        if (donutFocused) {
                            var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                            showInsightRect(rectType, {
                                provName: topDataProv.provName,
                                asNumber: topDataProv.asNumber,
                                peers: topDataProv.peers,
                                totalBytes: topDataProv.totalBytes,
                                rank: 1,
                                color: topDataProv.color || getColorForAsNum(topDataProv.asNumber)
                            });
                        }
                        setLegendFocus(topDataProv.asNumber);
                        var topDataPeerIds = topDataProv.peers.slice(0, 20).map(function (p) { return p.id; });
                        if (_drawLinesForAs) _drawLinesForAs(topDataProv.asNumber, topDataPeerIds, topDataProv.color);
                        if (_filterPeerTable) _filterPeerTable(topDataPeerIds);
                        if (_dimMapPeers) _dimMapPeers(topDataPeerIds);
                    }
                });
            })(dataProvLinks[i]);
        }

        // "Show Private Networks" link — enter private network mode
        var pnLink = bodyEl.querySelector('.as-show-private-nets');
        if (pnLink) {
            pnLink.addEventListener('click', function (e) {
                e.stopPropagation();
                if (_enterPrivateNetMode) _enterPrivateNetMode();
            });
        }
    }

    /** Attach handlers for fastest connection provider rows.
     *  Clicking a provider shows sub-sub-tooltip with its peers ranked by ping. */
    function attachFastestProvRowHandlers(tip) {
        var provRows = tip.querySelectorAll('.as-fastest-prov-row');
        for (var pi = 0; pi < provRows.length; pi++) {
            (function (provRow) {
                provRow.style.cursor = 'pointer';
                provRow.addEventListener('mouseenter', function () {
                    if (peerDetailActive || distributionState.subSubTooltipPinned) return;
                    var asNum = provRow.dataset.as;
                    var peerIds = JSON.parse(provRow.dataset.peerIds);
                    var rank = parseInt(provRow.dataset.rank) || 0;
                    // Focus legend on this provider
                    if (asNum) setLegendFocus(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // In focused mode, update insight rect for this provider
                    if (donutFocused && asNum && donutController.isInsightVisible()) {
                        var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
                        var avgPing = parseFloat(provRow.dataset.avgPing) || 0;
                        showInsightRect('fastest', {
                            provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                            asNumber: asNum,
                            peerIds: peerIds,
                            avgPing: avgPing,
                            rank: rank,
                            color: getColorForAsNum(asNum)
                        });
                        insightActiveAsNum = asNum;
                    } else if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                provRow.addEventListener('mouseleave', function () {
                    if (peerDetailActive || distributionState.subSubTooltipPinned) return;
                    // On leave, restore to the pinned insight provider
                    if (donutController.isInsightVisible()) {
                        restoreInsightRectProvider();
                    } else {
                        restoreSummaryFromPreview();
                    }
                });
                provRow.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerIds = JSON.parse(provRow.dataset.peerIds);
                    var asNum = provRow.dataset.as;
                    var rank = parseInt(provRow.dataset.rank) || 0;

                    // Keep legend focused on this provider while sub-sub is pinned
                    distributionState.legendFocusProvider = asNum;
                    renderLegend();

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
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }
                    matchedPeers.sort(function (a, b) { return (a.ping_ms || 9999) - (b.ping_ms || 9999); });

                    // Build sub-sub-tooltip with peers ranked by ping
                    var html = buildPingPeerListHtml(matchedPeers.slice(0, 20));
                    showSubSubTooltip(html, e);
                    distributionState.subSubTooltipPinned = true;

                    // Track sub-sub state for data refresh preservation
                    distributionState.subSubFilterPeerIds = peerIds;
                    distributionState.subSubFilterProvider = asNum;
                    distributionState.subSubFilterColor = getColorForAsNum(asNum);

                    if (_drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, distributionState.subSubFilterColor);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);

                    // Update insight rect to show selected provider
                    if (donutFocused && donutController.isInsightVisible()) {
                        var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
                        var avgPing = parseFloat(provRow.dataset.avgPing) || 0;
                        insightActiveAsNum = asNum;
                        insightActiveData = {
                            provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                            asNumber: asNum,
                            peerIds: peerIds,
                            avgPing: avgPing,
                            rank: rank,
                            color: getColorForAsNum(asNum)
                        };
                        showInsightRect('fastest', insightActiveData);
                    }
                });
            })(provRows[pi]);
        }
    }

    /** Build peer list HTML for ping sub-sub-tooltip. */
    function buildPingPeerListHtml(peers) {
        var html = '';
        var initialShow = 8;
        var hasMore = peers.length > initialShow;

        html += '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
        html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Peers \u2014 By Ping</div>';
        html += '</div>';
        html += '<div class="as-sub-tt-scroll">';
        for (var pi = 0; pi < peers.length; pi++) {
            var p = peers[pi];
            var peerAs = parseAsNumber(p.as) || '';
            var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
            html += '<div class="as-sub-tt-peer' + extraClass + '" data-peer-id="' + p.id + '" data-as="' + peerAs + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
            html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
            html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + (p.ping_ms > 0 ? Math.round(p.ping_ms) + 'ms' : '\u2014') + '</span>';
            var ct = p.connection_type || 'unknown';
            html += '<span class="as-sub-tt-loc">' + (CONN_TYPE_LABELS[ct] || ct) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (hasMore) {
            var remaining = peers.length - initialShow;
            html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    /** Attach click handlers for data provider rows in the sub-tooltip.
     *  Clicking a provider shows sub-sub-tooltip with that provider's top 20 peers. */
    function attachDataProviderRowHandlers(tip, field) {
        var provRows = tip.querySelectorAll('.as-data-prov-row');
        for (var pi = 0; pi < provRows.length; pi++) {
            (function (provRow) {
                provRow.style.cursor = 'pointer';
                // Hover preview: show lines + filter for this provider's peers
                provRow.addEventListener('mouseenter', function () {
                    if (peerDetailActive || distributionState.subSubTooltipPinned) return;
                    var asNum = provRow.dataset.as;
                    var peerIds = JSON.parse(provRow.dataset.peerIds);
                    var rank = parseInt(provRow.dataset.rank) || 0;
                    // Focus legend on this provider
                    if (asNum) setLegendFocus(asNum);
                    if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                    // In focused mode, update insight rect for this provider
                    if (donutFocused && asNum && donutController.isInsightVisible()) {
                        var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
                        var totalBytes = parseInt(provRow.dataset.totalBytes) || 0;
                        var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                        insightActiveAsNum = asNum;
                        showInsightRect(rectType, {
                            provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                            asNumber: asNum,
                            peers: peerIds,
                            totalBytes: totalBytes,
                            rank: rank,
                            color: getColorForAsNum(asNum)
                        });
                    } else if (donutFocused && asNum) {
                        showFocusedCenterText(asNum);
                        animateDonutExpand(asNum);
                    }
                });
                provRow.addEventListener('mouseleave', function () {
                    if (peerDetailActive || distributionState.subSubTooltipPinned) return;
                    // On leave, restore to the pinned insight provider
                    if (donutController.isInsightVisible()) {
                        restoreInsightRectProvider();
                    } else {
                        restoreSummaryFromPreview();
                    }
                });
                provRow.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerIds = JSON.parse(provRow.dataset.peerIds);
                    var asNum = provRow.dataset.as;
                    var rowField = provRow.dataset.field;

                    // Keep legend focused on this provider while sub-sub is pinned
                    distributionState.legendFocusProvider = asNum;
                    renderLegend();

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
                    for (var i = 0; i < lastPeersRaw.length; i++) {
                        if (idSet[lastPeersRaw[i].id]) matchedPeers.push(lastPeersRaw[i]);
                    }
                    // Sort by the relevant field
                    matchedPeers.sort(function (a, b) { return (b[rowField] || 0) - (a[rowField] || 0); });

                    // Build sub-sub-tooltip showing top 20 peers with bytes amounts
                    var html = buildDataPeerListHtml(matchedPeers.slice(0, 20), rowField);
                    showSubSubTooltip(html, e);
                    distributionState.subSubTooltipPinned = true;

                    // Track sub-sub state for data refresh preservation
                    distributionState.subSubFilterPeerIds = peerIds;
                    distributionState.subSubFilterProvider = asNum;
                    distributionState.subSubFilterColor = getColorForAsNum(asNum);

                    // Draw lines for this provider's peers
                    if (_drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, distributionState.subSubFilterColor);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);

                    // Update insight rect to show selected data provider
                    if (donutFocused && donutController.isInsightVisible()) {
                        var grp = asGroups.find(function (g) { return g.asNumber === asNum; });
                        var totalBytes = parseInt(provRow.dataset.totalBytes) || 0;
                        var rank = parseInt(provRow.dataset.rank) || 0;
                        var rectType = rowField === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                        insightActiveAsNum = asNum;
                        insightActiveData = {
                            provName: grp ? (grp.asShort || grp.asName || asNum) : asNum,
                            asNumber: asNum,
                            peers: peerIds,
                            totalBytes: totalBytes,
                            rank: rank,
                            color: getColorForAsNum(asNum)
                        };
                        showInsightRect(rectType, insightActiveData);
                    }
                });
            })(provRows[pi]);
        }
    }

    /** Build peer list HTML for data sub-sub-tooltip showing bytes amounts.
     *  Shows 6-10 initially with scroll for the rest. */
    function buildDataPeerListHtml(peers, field) {
        var html = '';
        var initialShow = 8;
        var hasMore = peers.length > initialShow;
        var isRecv = field === 'bytesrecv';
        var title = isRecv ? 'Top Peers \u2014 Bytes Received' : 'Top Peers \u2014 Bytes Sent';

        html += '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
        html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + title + '</div>';
        html += '</div>';
        html += '<div class="as-sub-tt-scroll">';
        for (var pi = 0; pi < peers.length; pi++) {
            var p = peers[pi];
            var peerAs = parseAsNumber(p.as) || '';
            var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
            html += '<div class="as-sub-tt-peer' + extraClass + '" data-peer-id="' + p.id + '" data-as="' + peerAs + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
            html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
            html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + fmtBytes(p[field]) + '</span>';
            var ct = p.connection_type || 'unknown';
            html += '<span class="as-sub-tt-loc">' + (CONN_TYPE_LABELS[ct] || ct) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (hasMore) {
            var remaining = peers.length - initialShow;
            html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    /** Attach provider navigation handlers (clicking a provider name navigates to its panel) */
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
                            hideSubTooltip();
                            navigateToProvider(asNum);
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
                        hideSubTooltip();
                        navigateToProvider(asNum);
                    }
                });
            })(provClicks[i]);
        }
    }

    /** Apply a sub-filter in summary mode */
    function applySummarySubFilter(peerIds, label) {
        // Close peer detail popup when selecting from panel
        if (peerDetailActive) closePeerPopup();
        if (distributionState.filterPeerIds && label === distributionState.filterLabel) {
            clearSummarySubFilter();
            return;
        }
        // Clear any active insight state when switching to a different category
        if (insightActiveAsNum || insightActiveType) {
            insightActiveAsNum = null; insightActiveData = null;
            insightActiveType = null;
            hideInsightRect();
            if (donutFocused) animateDonutRevert();
        }
        distributionState.filterPeerIds = peerIds;
        distributionState.filterCategory = 'summary';
        distributionState.filterLabel = label;
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);
        // Draw lines for the filtered peers — group by AS for colored lines
        if (_drawLinesForAllAs && donutSegments.length > 0) {
            var idSet = {};
            for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
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
        highlightActiveSummaryRow();
        // Zoom map out to world view when selecting a new category
        if (_resetMapZoom) _resetMapZoom();
    }

    function clearSummarySubFilter() {
        distributionState.filterPeerIds = null;
        distributionState.filterLabel = null;
        distributionState.filterCategory = null;
        insightActiveAsNum = null; insightActiveData = null;
        insightActiveType = null;
        hideSubTooltip();
        hideInsightRect();
        // Restore to showing all peers
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        // Re-draw all lines
        if (distributionState.summarySelected) activateHoverAll();
        // Remove active highlights from both summary rows and insight rows
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
        if (bodyEl) {
            var rows = bodyEl.querySelectorAll('.sub-filter-active');
            for (var ri = 0; ri < rows.length; ri++) rows[ri].classList.remove('sub-filter-active');
        }
        // Revert donut expansion and center text (a conn-provider sub-filter
        // may have expanded a segment and shown provider name in center)
        animateDonutRevert();
        renderCenter();
        renderLegend();
    }

    function highlightActiveSummaryRow() {
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
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
        openLensSummaryPanel();

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
        insightActiveAsNum = null; insightActiveData = null;
        insightActiveType = null;
        hideSubTooltip();
        hideSubSubTooltip();
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
        hideSubTooltip();
        hideSubSubTooltip();

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
        insightActiveAsNum = null; insightActiveData = null;
        insightActiveType = null;
        distributionState.panelHistory = [];
        hideSubTooltip();
        hideSubSubTooltip();
        hideInsightRect();

        if (donutFocused) {
            distributionState.summarySelected = true;
            openLensSummaryPanel();
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
                hideSubTooltip();
                hideSubSubTooltip();
                distributionState.filterPeerIds = null;
                distributionState.filterLabel = null;
                distributionState.filterCategory = null;
            }
            // Return to summary view
            distributionState.summarySelected = true;
            distributionState.panelHistory = [];
            openLensSummaryPanel();
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            activateHoverAll();
            renderDonut();
            renderCenter();
            renderLegend();
            return true;
        }

        // Stage 1: If peer detail popup is active, close it (and any sub-tooltips) in one click
        if (peerDetailActive) {
            closePeerPopup();
            return true;
        }

        // Stage 1.5: If sub-tooltips are visible, close them
        if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
            hideSubTooltip();
            hideSubSubTooltip();
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
                clearSubFilter();
            }
            return true; // handled — don't close main panel
        }

        // Stage 2: If in a provider view, go back to summary
        if (distributionState.selectedProvider) {
            if (donutFocused) {
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
            if (donutFocused) {
                exitFocusedMode();
            } else {
                deselectSummary();
            }
            return true;
        }

        // Stage 4: If just in focused mode with nothing selected, exit it
        if (donutFocused) {
            exitFocusedMode();
            return true;
        }

        return false;
    }

    /** Apply a sub-filter: show only these peers on the map and in the peer list.
     *  category and label are used to re-apply the filter after data refreshes. */
    function applySubFilter(peerIds, category, label) {
        if (distributionState.filterPeerIds && category === distributionState.filterCategory && label === distributionState.filterLabel) {
            // Clicking the same filter — toggle off
            clearSubFilter();
            return;
        }
        distributionState.filterPeerIds = peerIds;
        distributionState.filterCategory = category || null;
        distributionState.filterLabel = label || null;
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);

        // Draw lines for sub-filtered peers
        var seg = distributionState.selectedProvider ? findActiveSegment(distributionState.selectedProvider) : null;
        if (!seg && distributionState.selectedProvider) {
            var grp = findActiveGroup(distributionState.selectedProvider);
            if (grp) {
                var othersSeg = getActiveSegments().find(function (s) { return s.isOthers; });
                seg = { asNumber: distributionState.selectedProvider, peerIds: grp.peerIds, color: othersSeg ? othersSeg.color : '#58a6ff' };
            }
        }
        if (seg && _drawLinesForAs) {
            _drawLinesForAs(distributionState.selectedProvider, peerIds, seg.color);
        }

        // Highlight the active row
        highlightActiveSubRow();
    }

    /** Highlight the sub-filter-active row in the detail panel body */
    function highlightActiveSubRow() {
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
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

    /** Clear the sub-filter (restore to full AS selection) */
    function clearSubFilter() {
        distributionState.filterPeerIds = null;
        distributionState.filterLabel = null;
        distributionState.filterCategory = null;
        hideSubTooltip();
        // Restore to full AS filter
        if (distributionState.selectedProvider) {
            var seg = findActiveSegment(distributionState.selectedProvider);
            if (!seg) {
                var grp = findActiveGroup(distributionState.selectedProvider);
                if (grp) {
                    var othersSeg = getActiveSegments().find(function (s) { return s.isOthers; });
                    seg = { asNumber: distributionState.selectedProvider, peerIds: grp.peerIds, color: othersSeg ? othersSeg.color : '#58a6ff' };
                }
            }
            if (seg) {
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, seg.peerIds, seg.color);
            }
        }
        // Remove active highlights
        var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
        if (bodyEl) {
            var rows = bodyEl.querySelectorAll('.as-interactive-row');
            for (var ri = 0; ri < rows.length; ri++) {
                rows[ri].classList.remove('sub-filter-active');
            }
        }
    }

    /** Find fresh peer IDs by matching category+label in the current AS group data.
     *  This allows sub-filters to survive data refreshes — new peers matching the
     *  criteria get included, disconnected peers drop out. */
    function findPeerIdsByCategoryLabel(seg, category, label) {
        var fullGroup = seg.isOthers ? seg : findActiveGroup(seg.asNumber);
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
                var ctLabel = CONN_TYPE_LABELS[ctList[i].type] || ctList[i].type;
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
                    var cl = CONN_TYPE_LABELS[ct] || ct;
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
            var providers = aggregateProvidersForPeers(fullGroup.peers);
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
        hideSubTooltip();
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
        if (distributionState.subTooltipPinned || peerDetailActive) return;
        distributionState.hoveredProvider = asNum;
        // No floating tooltip — legend highlighting replaces it
        highlightLegendItem(asNum);

        // In focused mode, show provider name in donut center on hover
        if (donutFocused && !distributionState.selectedProvider) {
            distributionState.focusedHoverProvider = asNum;
            showFocusedCenterText(asNum);
        }

        // When legends are hidden (not focused), show provider info in donut center
        if (legendsHidden && !donutFocused && !distributionState.selectedProvider) {
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
        if (distributionState.subTooltipPinned || peerDetailActive) return;
        distributionState.hoveredProvider = null;
        clearLegendHighlight();

        // In focused mode, restore center text to default score display
        if (donutFocused && !distributionState.selectedProvider) {
            distributionState.focusedHoverProvider = null;
            renderCenter();
        }

        // When legends are hidden (not focused), restore default center text
        if (legendsHidden && !donutFocused && !distributionState.selectedProvider) {
            distributionState.focusedHoverProvider = null;
            clearLegendHoverActive();
            renderCenter();
        }

        // If there's an active sub-filter, restore to that instead of showing all
        if (distributionState.summarySelected && distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0 && !distributionState.selectedProvider) {
            restoreSummaryFromPreview();
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
        if (peerDetailActive) {
            closePeerPopup(true);
        }

        // Auto-enter focused mode if not already
        if (!donutFocused) {
            donutFocused = true;
            document.body.classList.add('donut-focused');
        }

        // If summary is active, close it and select this AS
        if (distributionState.summarySelected) {
            deselectSummary();
        }

        if (distributionState.selectedProvider === asNum) {
            // Deselect — go back to summary in focused mode
            if (donutFocused) {
                if (othersListOpen) closeOthersListInDonut();
                distributionState.selectedProvider = null;
                distributionState.filterPeerIds = null;
                distributionState.filterLabel = null;
                distributionState.filterCategory = null;
                hideSubTooltip();
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
            hideSubTooltip();
            if (othersListOpen) closeOthersListInDonut();
            distributionState.selectedProvider = asNum;
            var seg = findActiveSegment(asNum);
            if (seg) {
                openPanel(asNum);
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(asNum, seg.peerIds, seg.color);

                // In focused mode, Others segment shows scrollable provider list inside donut
                if (donutFocused && seg.isOthers) {
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
        hideSubTooltip();
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
            if (peerDetailActive && peerDetailController.isOpen()) {
                closePeerPopup();
                return;
            }
            if (distributionState.subSubTooltipPinned) {
                hideSubSubTooltip();
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
                hideSubTooltip();
                // Restore to full summary or AS state
                if (distributionState.summarySelected) {
                    clearSummarySubFilter();
                } else if (distributionState.selectedProvider) {
                    clearSubFilter();
                }
                return;
            }
            // If a network panel is open, Escape goes back to summary
            if (distributionState.activeNetwork) {
                distributionState.activeNetwork = null;
                distributionState.selectedProvider = null;
                if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
                    hideSubTooltip();
                    hideSubSubTooltip();
                    distributionState.filterPeerIds = null;
                    distributionState.filterLabel = null;
                    distributionState.filterCategory = null;
                }
                distributionState.summarySelected = true;
                distributionState.panelHistory = [];
                openLensSummaryPanel();
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                activateHoverAll();
                renderDonut();
                renderCenter();
                renderLegend();
                return;
            }
            if (distributionState.summarySelected) {
                if (donutFocused) {
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
            if (donutFocused) {
                exitFocusedMode();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FOCUSED MODE — Donut moves to top-center, layout rearranges
    // ═══════════════════════════════════════════════════════════

    /** Enter focused mode: donut to top-center, BTC price to left, map controls to right */
    function enterFocusedMode() {
        if (donutFocused) return;
        donutFocused = true;
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
        if (!donutFocused) return;
        donutFocused = false;
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
        return donutFocused;
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
        peerDetailActive = false;
        selectedPeerId = null;
        peerDetailController.close({ restoreFocus: restoreFocus !== false });
    }

    function previewPeerInPopup(peer) {
        if (peerDetailActive) peerDetailController.previewPeer(peer);
    }

    function restorePeerPopupToSelected() {
        peerDetailController.restorePreview();
    }

    function closePeerPopup(skipZoomReset) {
        dismissPeerDetailView(!skipZoomReset);

        if (distributionState.summarySelected) {
            if (insightActiveAsNum) {
                var peerIds = getPeerIdsForAnyAs(insightActiveAsNum);
                var color = getColorForAsNum(insightActiveAsNum);
                if (_drawLinesForAs) _drawLinesForAs(insightActiveAsNum, peerIds, color);
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
            } else if (distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0) {
                previewSummaryLines(distributionState.filterPeerIds);
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
        peerDetailActive = true;
        selectedPeerId = null;
        peerDetailController.openGroup(peerIds);
    }

    function openPeerDetailPanel(peer, source) {
        peerDetailActive = true;
        selectedPeerId = peer.id;

        var asNum = parseAsNumber(peer.as);
        var provColor = asNum ? getColorForAsNum(asNum) : '#6e7681';
        if (!donutFocused) {
            donutFocused = true;
            document.body.classList.add('donut-focused');
            if (!distributionState.summarySelected && !distributionState.selectedProvider) selectSummary();
            peerDetailActive = true;
            selectedPeerId = peer.id;
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
        insightActiveAsNum = null;
        insightActiveData = null;
        insightActiveType = null;
        dismissPeerDetailView(false);
        if (othersListOpen) closeOthersListInDonut();
        hideSubTooltip();
        hideSubSubTooltip();
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
        var wasFocused = donutFocused;
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
                if (!donutFocused) {
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
                if (!donutFocused) {
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
                if (donutFocused) {
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
        if (peerDetailActive) {
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
                previewSummaryLines(distributionState.filterPeerIds);
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
                        var freshPeerIds = findPeerIdsByCategoryLabel(seg, savedCategory, savedLabel);
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
                            previewProviderLines([distributionState.hoveredPeerId]);
                            if (donutFocused) showPeerInDonutCenter(hPeer, hColor);
                        }
                    } else if (distributionState.filterPeerIds && distributionState.filterPeerIds.length > 0) {
                        if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, distributionState.filterPeerIds, seg.color);
                        if (_filterPeerTable) _filterPeerTable(distributionState.filterPeerIds);
                        if (_dimMapPeers) _dimMapPeers(distributionState.filterPeerIds);
                        if (donutFocused) {
                            showFocusedCenterText(distributionState.selectedProvider);
                            animateDonutExpand(distributionState.selectedProvider);
                        }
                    } else {
                        if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, seg.peerIds, seg.color);
                        if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                        if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                        if (donutFocused) {
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
                        var freshPeerIds = findPeerIdsByCategoryLabel(seg, savedCategory, savedLabel);
                        if (freshPeerIds && freshPeerIds.length > 0) {
                            distributionState.filterPeerIds = freshPeerIds;
                            distributionState.filterCategory = savedCategory;
                            distributionState.filterLabel = savedLabel;
                            if (_filterPeerTable) _filterPeerTable(freshPeerIds);
                            if (_dimMapPeers) _dimMapPeers(freshPeerIds);
                            if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, freshPeerIds, seg.color);
                            highlightActiveSubRow();
                        } else {
                            distributionState.filterPeerIds = null;
                            distributionState.filterCategory = null;
                            distributionState.filterLabel = null;
                            hideSubTooltip();
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

        // If summary is active, refresh — but DON'T rebuild the panel DOM if a
        // sub-tooltip is pinned (that destroys pinnedSubTooltipSrc and resets state).
        // Instead, just refresh lines/filters with fresh peer data.
        if (distributionState.summarySelected) {
            if (isCountryLens()) {
                var countrySumBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                var countrySumScroll = countrySumBodyEl ? countrySumBodyEl.scrollTop : 0;
                openCountrySummaryPanel();
                if (countrySumBodyEl && countrySumScroll > 0) countrySumBodyEl.scrollTop = countrySumScroll;
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                activateHoverAll();
                renderCenter();
                renderLegend();
                return;
            }
            if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
                // Sub-tooltip is open — preserve DOM. Refresh lines/filters with fresh peer data.

                // PRIORITY 1: Sub-sub-tooltip pinned (e.g. IPv6 → Provider → Peers)
                // Draw lines only for the specific provider, not the entire category.
                if (distributionState.subSubTooltipPinned && distributionState.subSubFilterProvider) {
                    var provGroup = asGroups.find(function (g) { return g.asNumber === distributionState.subSubFilterProvider; });
                    if (provGroup) {
                        var freshProvPeerIds = provGroup.peerIds;
                        // If there's a parent category filter (e.g. "IPv6"), intersect
                        if (distributionState.filterCategory === 'summary' && distributionState.filterLabel) {
                            var freshSumData = computeSummaryData();
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
                            var othersSeg = donutSegments.find(function (s) { return s.isOthers; });
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
                        var ssColor = distributionState.subSubFilterColor || getColorForAsNum(distributionState.subSubFilterProvider);
                        // If a peer is currently being hovered, preserve that single-peer view
                        if (distributionState.hoveredPeerId && freshProvPeerIds.indexOf(distributionState.hoveredPeerId) >= 0) {
                            if (_drawLinesForAs) _drawLinesForAs(distributionState.subSubFilterProvider, [distributionState.hoveredPeerId], ssColor);
                            if (_filterPeerTable) _filterPeerTable([distributionState.hoveredPeerId]);
                            if (_dimMapPeers) _dimMapPeers([distributionState.hoveredPeerId]);
                            // Preserve hovered peer's center text
                            if (donutFocused) {
                                var hPeer = lastPeersRaw.find(function (p) { return p.id === distributionState.hoveredPeerId; });
                                if (hPeer) showPeerInDonutCenter(hPeer, ssColor);
                            }
                        } else {
                            if (_drawLinesForAs) _drawLinesForAs(distributionState.subSubFilterProvider, freshProvPeerIds, ssColor);
                            if (_filterPeerTable) _filterPeerTable(freshProvPeerIds);
                            if (_dimMapPeers) _dimMapPeers(freshProvPeerIds);
                            // Restore center text to the selected provider
                            if (donutFocused) {
                                showFocusedCenterText(distributionState.subSubFilterProvider);
                                animateDonutExpand(distributionState.subSubFilterProvider);
                            }
                        }
                    }
                }
                // PRIORITY 2: Sub-tooltip pinned at category level (e.g. "IPv6" showing providers)
                else if (distributionState.filterPeerIds && distributionState.filterCategory && distributionState.filterLabel) {
                    if (distributionState.filterCategory === 'summary') {
                        // Standard summary category — look up fresh peer IDs
                        var freshSumData = computeSummaryData();
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
                                var hovProvGroup = asGroups.find(function (g) { return g.asNumber === distributionState.legendFocusProvider; });
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
                                    var hovColor = getColorForAsNum(distributionState.legendFocusProvider);
                                    if (_drawLinesForAs) _drawLinesForAs(distributionState.legendFocusProvider, hovPeerIds, hovColor);
                                    if (_filterPeerTable) _filterPeerTable(hovPeerIds);
                                    if (_dimMapPeers) _dimMapPeers(hovPeerIds);
                                    if (donutFocused) {
                                        showFocusedCenterText(distributionState.legendFocusProvider);
                                        animateDonutExpand(distributionState.legendFocusProvider);
                                    }
                                }
                            } else {
                                if (_filterPeerTable) _filterPeerTable(freshPeerIds);
                                if (_dimMapPeers) _dimMapPeers(freshPeerIds);
                                if (_drawLinesForAllAs && donutSegments.length > 0) {
                                    var idSet = {};
                                    for (var i = 0; i < freshPeerIds.length; i++) idSet[freshPeerIds[i]] = true;
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
                            }
                        }
                    } else if (distributionState.filterCategory === 'insight-stable') {
                        // "Most stable" insight — refresh by AS number stored in distributionState.filterLabel
                        var provGroup = asGroups.find(function (g) { return g.asNumber === distributionState.filterLabel; });
                        if (provGroup) {
                            distributionState.filterPeerIds = provGroup.peerIds;
                            var color = getColorForAsNum(distributionState.filterLabel);
                            if (_drawLinesForAs) _drawLinesForAs(distributionState.filterLabel, provGroup.peerIds, color);
                            if (_filterPeerTable) _filterPeerTable(provGroup.peerIds);
                            if (_dimMapPeers) _dimMapPeers(provGroup.peerIds);
                            // Preserve insight rect state
                            insightActiveAsNum = distributionState.filterLabel;
                            if (donutFocused && donutController.isInsightVisible()) {
                                var insRectData = getInsightDataForActive();
                                if (insRectData) showInsightRect(insightActiveType, insRectData);
                            } else if (donutFocused) {
                                showFocusedCenterText(distributionState.filterLabel);
                                animateDonutExpand(distributionState.filterLabel);
                            }
                        }
                    } else if (distributionState.filterCategory === 'conn-provider') {
                        // Connection by Provider row — refresh by AS number in distributionState.filterLabel
                        var provGroup = asGroups.find(function (g) { return g.asNumber === distributionState.filterLabel; });
                        if (provGroup) {
                            distributionState.filterPeerIds = provGroup.peerIds;
                            var color = getColorForAsNum(distributionState.filterLabel);
                            // If a peer is being hovered, preserve that single-peer view
                            if (distributionState.hoveredPeerId && provGroup.peerIds.indexOf(distributionState.hoveredPeerId) >= 0) {
                                if (_drawLinesForAs) _drawLinesForAs(distributionState.filterLabel, [distributionState.hoveredPeerId], color);
                                if (_filterPeerTable) _filterPeerTable([distributionState.hoveredPeerId]);
                                if (_dimMapPeers) _dimMapPeers([distributionState.hoveredPeerId]);
                                if (donutFocused) {
                                    var hPeer = lastPeersRaw.find(function (p) { return p.id === distributionState.hoveredPeerId; });
                                    if (hPeer) showPeerInDonutCenter(hPeer, color);
                                }
                            } else {
                                if (_drawLinesForAs) _drawLinesForAs(distributionState.filterLabel, provGroup.peerIds, color);
                                if (_filterPeerTable) _filterPeerTable(provGroup.peerIds);
                                if (_dimMapPeers) _dimMapPeers(provGroup.peerIds);
                                // Preserve donut state for this provider
                                if (donutFocused) {
                                    showFocusedCenterText(distributionState.filterLabel);
                                    animateDonutExpand(distributionState.filterLabel);
                                }
                            }
                        }
                    } else if (distributionState.filterCategory === 'conn-out') {
                        // Outbound connection row — refresh outbound peers for the AS
                        var provGroup = asGroups.find(function (g) { return g.asNumber === distributionState.filterLabel; });
                        if (provGroup) {
                            var outPeerIds = [];
                            for (var i = 0; i < provGroup.peers.length; i++) {
                                if (provGroup.peers[i].direction === 'outbound') outPeerIds.push(provGroup.peers[i].id);
                            }
                            distributionState.filterPeerIds = outPeerIds;
                            if (_filterPeerTable) _filterPeerTable(outPeerIds);
                            if (_dimMapPeers) _dimMapPeers(outPeerIds);
                            // Preserve donut state for this provider
                            if (donutFocused) {
                                showFocusedCenterText(distributionState.filterLabel);
                                animateDonutExpand(distributionState.filterLabel);
                            }
                        }
                    } else if (distributionState.filterCategory === 'conn-in') {
                        // Inbound connection row — refresh inbound peers for the AS
                        var provGroup = asGroups.find(function (g) { return g.asNumber === distributionState.filterLabel; });
                        if (provGroup) {
                            var inPeerIds = [];
                            for (var i = 0; i < provGroup.peers.length; i++) {
                                if (provGroup.peers[i].direction === 'inbound') inPeerIds.push(provGroup.peers[i].id);
                            }
                            distributionState.filterPeerIds = inPeerIds;
                            if (_filterPeerTable) _filterPeerTable(inPeerIds);
                            if (_dimMapPeers) _dimMapPeers(inPeerIds);
                            // Preserve donut state for this provider
                            if (donutFocused) {
                                showFocusedCenterText(distributionState.filterLabel);
                                animateDonutExpand(distributionState.filterLabel);
                            }
                        }
                    } else if (distributionState.filterCategory === 'conn-others') {
                        // Others bucket — refresh from the Others donut segment
                        var othersSeg = donutSegments.find(function (s) { return s.isOthers; });
                        if (othersSeg) {
                            var freshOthersPeerIds = othersSeg.peerIds;
                            distributionState.filterPeerIds = freshOthersPeerIds;
                            // If a provider is being hovered, intersect with Others peers
                            if (distributionState.legendFocusProvider) {
                                var hovProvGroup = asGroups.find(function (g) { return g.asNumber === distributionState.legendFocusProvider; });
                                if (hovProvGroup) {
                                    var othSet = {};
                                    for (var oi = 0; oi < freshOthersPeerIds.length; oi++) othSet[freshOthersPeerIds[oi]] = true;
                                    var hovPeerIds = [];
                                    for (var hoi = 0; hoi < hovProvGroup.peerIds.length; hoi++) {
                                        if (othSet[hovProvGroup.peerIds[hoi]]) hovPeerIds.push(hovProvGroup.peerIds[hoi]);
                                    }
                                    var hovColor = getColorForAsNum(distributionState.legendFocusProvider);
                                    if (_drawLinesForAs) _drawLinesForAs(distributionState.legendFocusProvider, hovPeerIds, hovColor);
                                    if (_filterPeerTable) _filterPeerTable(hovPeerIds);
                                    if (_dimMapPeers) _dimMapPeers(hovPeerIds);
                                    if (donutFocused) {
                                        showFocusedCenterText(distributionState.legendFocusProvider);
                                        animateDonutExpand(distributionState.legendFocusProvider);
                                    }
                                }
                            } else {
                                if (_filterPeerTable) _filterPeerTable(freshOthersPeerIds);
                                if (_dimMapPeers) _dimMapPeers(freshOthersPeerIds);
                                if (_drawLinesForAllAs && donutSegments.length > 0) {
                                    var idSet = {};
                                    for (var i = 0; i < freshOthersPeerIds.length; i++) idSet[freshOthersPeerIds[i]] = true;
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
                            }
                        }
                    } else if (distributionState.filterCategory === 'insight-fastest' || distributionState.filterCategory === 'insight-data-bytessent' || distributionState.filterCategory === 'insight-data-bytesrecv') {
                        // Insight ranking categories — preserve DOM, refresh lines for active provider
                        if (insightActiveAsNum) {
                            var insProvGroup = asGroups.find(function (g) { return g.asNumber === insightActiveAsNum; });
                            if (insProvGroup) {
                                var insColor = getColorForAsNum(insightActiveAsNum);
                                // If sub-sub is drilled into a specific provider, respect that
                                if (distributionState.subSubTooltipPinned && distributionState.subSubFilterProvider) {
                                    var ssProvGroup = asGroups.find(function (g) { return g.asNumber === distributionState.subSubFilterProvider; });
                                    if (ssProvGroup) {
                                        distributionState.subSubFilterPeerIds = ssProvGroup.peerIds;
                                        var ssColor = distributionState.subSubFilterColor || getColorForAsNum(distributionState.subSubFilterProvider);
                                        if (distributionState.hoveredPeerId && ssProvGroup.peerIds.indexOf(distributionState.hoveredPeerId) >= 0) {
                                            if (_drawLinesForAs) _drawLinesForAs(distributionState.subSubFilterProvider, [distributionState.hoveredPeerId], ssColor);
                                            if (_filterPeerTable) _filterPeerTable([distributionState.hoveredPeerId]);
                                            if (_dimMapPeers) _dimMapPeers([distributionState.hoveredPeerId]);
                                            // Preserve hovered peer's center text
                                            if (donutFocused) {
                                                var hPeer = lastPeersRaw.find(function (p) { return p.id === distributionState.hoveredPeerId; });
                                                if (hPeer) showPeerInDonutCenter(hPeer, ssColor);
                                            }
                                        } else {
                                            if (_drawLinesForAs) _drawLinesForAs(distributionState.subSubFilterProvider, ssProvGroup.peerIds, ssColor);
                                            if (_filterPeerTable) _filterPeerTable(ssProvGroup.peerIds);
                                            if (_dimMapPeers) _dimMapPeers(ssProvGroup.peerIds);
                                        }
                                    }
                                } else {
                                    if (_drawLinesForAs) _drawLinesForAs(insightActiveAsNum, insProvGroup.peerIds, insColor);
                                    if (_filterPeerTable) _filterPeerTable(insProvGroup.peerIds);
                                    if (_dimMapPeers) _dimMapPeers(insProvGroup.peerIds);
                                }
                            }
                        }
                    }
                    // Preserve insight rect state for all insight categories
                    // (but skip if a peer is being hovered — that takes priority)
                    if (insightActiveAsNum && donutFocused && !distributionState.hoveredPeerId) {
                        if (donutController.isInsightVisible()) {
                            var insRectData = getInsightDataForActive();
                            if (insRectData) showInsightRect(insightActiveType, insRectData);
                        } else {
                            showFocusedCenterText(insightActiveAsNum);
                            animateDonutExpand(insightActiveAsNum);
                        }
                    }
                } else {
                    // No sub-filter, just keep all-lines going
                    activateHoverAll();
                }
            } else {
                // No sub-tooltip pinned — safe to rebuild the panel
                var savedSumCategory = distributionState.filterCategory;
                var savedSumLabel = distributionState.filterLabel;
                var savedInsightAsNum = insightActiveAsNum;
                var savedInsightType = insightActiveType;

                // Preserve scroll position across data refresh
                var sumBodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                var savedSumScroll = sumBodyEl ? sumBodyEl.scrollTop : 0;
                openSummaryPanel();
                if (sumBodyEl && savedSumScroll > 0) sumBodyEl.scrollTop = savedSumScroll;

                // Restore insight state after panel rebuild
                insightActiveAsNum = savedInsightAsNum;
                insightActiveType = savedInsightType;

                if (savedSumCategory === 'summary' && savedSumLabel) {
                    var freshSumData = computeSummaryData();
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
                        if (_filterPeerTable) _filterPeerTable(freshPeerIds);
                        if (_dimMapPeers) _dimMapPeers(freshPeerIds);
                        highlightActiveSummaryRow();
                        if (_drawLinesForAllAs && donutSegments.length > 0) {
                            var idSet = {};
                            for (var i = 0; i < freshPeerIds.length; i++) idSet[freshPeerIds[i]] = true;
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
                    } else {
                        distributionState.filterPeerIds = null;
                        distributionState.filterCategory = null;
                        distributionState.filterLabel = null;
                        hideSubTooltip();
                        hideSubSubTooltip();
                        activateHoverAll();
                    }
                } else if (savedInsightAsNum) {
                    // Insight was active (e.g. Most Stable, Fastest) — preserve its rect/line state
                    var insightPeerIds = getPeerIdsForAnyAs(savedInsightAsNum);
                    var insightColor = getColorForAsNum(savedInsightAsNum);
                    if (insightPeerIds.length > 0 && _drawLinesForAs) {
                        _drawLinesForAs(savedInsightAsNum, insightPeerIds, insightColor);
                    }
                    if (_filterPeerTable) _filterPeerTable(insightPeerIds);
                    if (_dimMapPeers) _dimMapPeers(insightPeerIds);
                    setLegendFocus(savedInsightAsNum);
                    if (donutFocused) {
                        if (donutController.isInsightVisible()) {
                            var insRectData = getInsightDataForActive();
                            if (insRectData) showInsightRect(insightActiveType, insRectData);
                        } else {
                            showFocusedCenterText(savedInsightAsNum);
                            animateDonutExpand(savedInsightAsNum);
                        }
                    }
                } else {
                    activateHoverAll();
                }
            }
        }
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
        if (donutFocused || legendsHidden) return getDonutCenter();

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
        if (peerDetailActive) closePeerPopup();

        var isRefresh = (distributionState.activeNetwork === netKey);
        if (!donutFocused) {
            donutFocused = true;
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

        attachSummaryRowHandlers(result.bodyElement);
        attachGridHandlers(result.bodyElement);
        attachSummaryLinkHandlers(result.bodyElement);
        attachPanelBlankClickHandler(result.bodyElement);

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
        isPeerDetailActive: function () { return peerDetailActive; },
        getLastPeersRaw: function () { return lastPeersRaw; },
        // Network panels (IPv4/IPv6)
        openNetworkPanel: openNetworkPanel,
        // Legend visibility
        setLegendsHidden: setLegendsHidden,
    };
})();
