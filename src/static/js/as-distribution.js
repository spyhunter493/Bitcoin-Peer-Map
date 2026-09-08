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
    const INNER_RADIUS = DONUT_RADIUS - DONUT_WIDTH;

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

    let asGroups = [];             // Aggregated AS data (sorted by count desc)
    let donutSegments = [];        // Top N + Others for donut rendering
    let countryGroups = [];        // Aggregated country/jurisdiction data
    let countryDonutSegments = []; // Top N + Others for country donut rendering
    let activeDistributionLens = 'provider'; // 'provider' | 'country'
    let hoveredAs = null;          // AS number string currently hovered
    let hoveredAll = false;        // True when title or SUMMARY ANALYSIS is hovered
    let summarySelected = false;   // True when Summary Analysis panel is open
    let selectedAs = null;         // AS number string currently selected (clicked)
    let distributionScore = 0;        // 0-10 score
    let totalPeers = 0;
    let countryDistributionScore = 0;
    let countryTotalPeers = 0;
    let hasRenderedOnce = false;   // Track if we've ever rendered data
    let legendFocusAs = null;      // AS number to exclusively show in legend during panel hover
    let donutFocused = false;      // True when in focused mode (donut at top-center)
    let focusedHoverAs = null;     // AS hovered in focused mode (for center text display)
    let othersListOpen = false;    // True when Others popup is showing next to the donut
    let legendsHidden = false;     // True when "Display Top ISP/Net" toggle is OFF

    // Donut segment animation state
    let donutAnimState = 'idle';   // 'idle' | 'expanding' | 'expanded' | 'reverting'
    let donutAnimTarget = null;    // AS number being expanded
    let donutAnimProgress = 0;    // 0 to 1 progress
    let donutAnimFrame = null;    // requestAnimationFrame ID
    let donutAnimStartTime = 0;   // Animation start timestamp
    const DONUT_ANIM_DURATION = 400; // ms for expand/revert animation
    const DONUT_EXPAND_RATIO = 0.70; // expanded segment gets 70% of donut
    let donutAnimSafetyTimer = null; // Safety timeout to force-end stuck animations

    // DOM refs (cached on init)
    let containerEl = null;
    let titleEl = null;
    let donutWrapEl = null;
    let donutSvg = null;
    let donutCenter = null;
    let legendEl = null;
    let lensToggleEl = null;
    let panelEl = null;
    let loadingEl = null;
    let focusedCloseBtn = null;

    // Sub-filter state: when user clicks a sub-row (software, service, country, conn type, others provider)
    let subFilterPeerIds = null;   // Array of peer IDs for the active sub-filter, or null
    let subFilterLabel = null;     // Description of what's being sub-filtered
    let subFilterCategory = null;  // Category key ('software', 'conntype', 'country', 'services', 'provider')
    let subTooltipPinned = false;  // Whether the sub-tooltip is pinned (clicked vs hovered)
    let subSubTooltipPinned = false; // Whether the sub-sub-tooltip is pinned
    let subSubFilterPeerIds = null;  // Peer IDs at sub-sub level (specific provider within a category drill-down)
    let subSubFilterAsNum = null;    // AS number for the sub-sub drill-down provider
    let subSubFilterColor = null;    // Line color for the sub-sub drill-down provider
    let pinnedSubTooltipSrc = null;  // Source element that opened the pinned sub-tooltip
    let lastPeersRaw = [];         // Raw peers from last update (for summary computation)
    let panelHistory = [];         // Navigation stack [{type:'summary'|'provider', asNumber?, scrollTop?}]
    let peerDetailActive = false;  // True when peer detail panel is shown (from peer list/map click)
    let multiPeerGroupIds = null;   // Peer IDs from multi-peer dot click (for back navigation)
    let insightActiveAsNum = null;  // AS number to show in donut when an insight is active (Most Stable, Fastest, etc.)
    let insightActiveType = null;   // Type of insight active: 'stable', 'fastest', 'data-bytessent', 'data-bytesrecv'
    let insightActiveData = null;   // Full data object for the active insight provider (for restoring after peer hover)
    let insightRectEl = null;       // DOM ref for insight rectangle overlay
    let insightRectVisible = false; // Whether the insight rectangle is currently shown
    let hoveredPeerId = null;       // Peer ID currently being hovered in a subtooltip (for update preservation)
    let summaryPreviewPeerIds = null;  // Peer IDs for active summary hover preview (preservation across refresh)
    let summaryPreviewLabel = null;    // Label for active summary hover preview
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
    const parseAsNumber = distributionData.parseAsNumber;
    const parseAsOrg = distributionData.parseAsOrg;
    const fmtBytes = distributionData.fmtBytes;
    const fmtDuration = distributionData.fmtDuration;
    const buildDistributionGroup = distributionData.buildDistributionGroup;

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
        return activeDistributionLens === 'country';
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
    // SUMMARY DATA COMPUTATION
    // ═══════════════════════════════════════════════════════════

    /** Get all peer objects for a donut segment (handles Others bucket) */
    function getAllPeersForSegment(seg) {
        if (seg.isOthers && seg._othersGroups) {
            var all = [];
            for (var i = 0; i < seg._othersGroups.length; i++) {
                for (var j = 0; j < seg._othersGroups[i].peers.length; j++) {
                    all.push(seg._othersGroups[i].peers[j]);
                }
            }
            return all;
        }
        var grp = asGroups.find(function (g) { return g.asNumber === seg.asNumber; });
        return grp ? grp.peers : [];
    }

    /** Find the donut segment color for a given AS number.
     *  Peers in the "Others" bucket get the Others color. */
    function getColorForAsNum(asNum) {
        for (var i = 0; i < donutSegments.length; i++) {
            if (donutSegments[i].asNumber === asNum) return donutSegments[i].color;
            if (donutSegments[i].isOthers && donutSegments[i]._othersGroups) {
                for (var j = 0; j < donutSegments[i]._othersGroups.length; j++) {
                    if (donutSegments[i]._othersGroups[j].asNumber === asNum) return donutSegments[i].color;
                }
            }
        }
        return PALETTE[PALETTE.length - 1];
    }

    /** Generic: aggregate peers by a category key function.
     *  Returns [{label, peerCount, providerCount, peerIds, providers: [{asNumber, name, color, peerCount, peerIds, peers}]}]
     *  sorted by peerCount descending. */
    function aggregateSummaryByCategory(peers, getKey, getLabel) {
        var catMap = {};
        for (var i = 0; i < peers.length; i++) {
            var p = peers[i];
            var key = getKey(p);
            if (!key) continue;
            var asNum = parseAsNumber(p.as);
            if (!asNum) continue;
            var label = getLabel ? getLabel(p, key) : key;

            if (!catMap[key]) catMap[key] = { key: key, label: label, peerCount: 0, peerIds: [], providerMap: {} };
            catMap[key].peerCount++;
            catMap[key].peerIds.push(p.id);

            if (!catMap[key].providerMap[asNum]) {
                catMap[key].providerMap[asNum] = {
                    asNumber: asNum,
                    name: parseAsOrg(p.as) || asNum,
                    color: getColorForAsNum(asNum),
                    peerCount: 0,
                    peerIds: [],
                    peers: []
                };
            }
            catMap[key].providerMap[asNum].peerCount++;
            catMap[key].providerMap[asNum].peerIds.push(p.id);
            catMap[key].providerMap[asNum].peers.push(p);
        }

        var result = [];
        var keys = Object.keys(catMap);
        for (var k = 0; k < keys.length; k++) {
            var item = catMap[keys[k]];
            var providers = [];
            var pKeys = Object.keys(item.providerMap);
            for (var pk = 0; pk < pKeys.length; pk++) {
                providers.push(item.providerMap[pKeys[pk]]);
            }
            providers.sort(function (a, b) { return b.peerCount - a.peerCount; });
            result.push({
                key: item.key,
                label: item.label,
                peerCount: item.peerCount,
                providerCount: providers.length,
                peerIds: item.peerIds,
                providers: providers
            });
        }
        result.sort(function (a, b) { return b.peerCount - a.peerCount; });
        return result;
    }

    /** Aggregate peers by network type (IPv4, IPv6, Tor, I2P, CJDNS) */
    function aggregateSummaryNetworks(peers) {
        var netLabels = { 'ipv4': 'IPv4', 'ipv6': 'IPv6', 'onion': 'Tor', 'i2p': 'I2P', 'cjdns': 'CJDNS' };
        return aggregateSummaryByCategory(peers,
            function (p) { return p.network || 'ipv4'; },
            function (p, key) { return netLabels[key] || key; }
        );
    }

    /** Aggregate peers by hosting type (Cloud/Hosting, Proxy/VPN, Mobile, Residential) */
    function aggregateSummaryHosting(peers) {
        return aggregateSummaryByCategory(peers,
            function (p) {
                if (p.hosting) return 'cloud';
                if (p.proxy) return 'proxy';
                if (p.mobile) return 'mobile';
                return 'residential';
            },
            function (p, key) {
                var labels = { 'cloud': 'Cloud / Hosting', 'proxy': 'Proxy / VPN', 'mobile': 'Mobile', 'residential': 'Residential' };
                return labels[key] || key;
            }
        );
    }

    /** Aggregate peers by country */
    function aggregateSummaryCountries(peers) {
        return aggregateSummaryByCategory(peers,
            function (p) { return p.countryCode || null; },
            function (p, key) { return key + '  ' + (p.country || key); }
        );
    }

    /** Aggregate a peer slice by AS provider for country detail panels. */
    function aggregateProvidersForPeers(peers) {
        var providerMap = {};
        for (var i = 0; i < peers.length; i++) {
            var p = peers[i];
            var asNum = parseAsNumber(p.as);
            if (!asNum) continue;
            if (!providerMap[asNum]) {
                providerMap[asNum] = {
                    asNumber: asNum,
                    name: parseAsOrg(p.as) || asNum,
                    peerCount: 0,
                    peerIds: [],
                    peers: []
                };
            }
            providerMap[asNum].peerCount++;
            providerMap[asNum].peerIds.push(p.id);
            providerMap[asNum].peers.push(p);
        }
        var providers = [];
        var keys = Object.keys(providerMap);
        for (var k = 0; k < keys.length; k++) providers.push(providerMap[keys[k]]);
        providers.sort(function (a, b) { return b.peerCount - a.peerCount; });
        return providers;
    }

    /** Aggregate peers by software version */
    function aggregateSummarySoftware(peers) {
        return aggregateSummaryByCategory(peers,
            function (p) { return p.subver || 'Unknown'; },
            null
        );
    }

    /** Aggregate peers by service flag combo */
    function aggregateSummaryServices(peers) {
        return aggregateSummaryByCategory(peers,
            function (p) { return p.services_abbrev || '\u2014'; },
            null
        );
    }

    /** Build connection grid: each donut segment with IN/OUT counts and outbound subtypes */
    function buildConnectionGrid() {
        var grid = [];
        for (var i = 0; i < donutSegments.length; i++) {
            var seg = donutSegments[i];
            var peers = getAllPeersForSegment(seg);
            var inPeers = [], outPeers = [];
            for (var j = 0; j < peers.length; j++) {
                if (peers[j].connection_type === 'inbound') inPeers.push(peers[j]);
                else outPeers.push(peers[j]);
            }
            // Break out outbound by connection subtype
            var outSubtypes = {};
            for (var oj = 0; oj < outPeers.length; oj++) {
                var ct = outPeers[oj].connection_type || 'unknown';
                if (!outSubtypes[ct]) outSubtypes[ct] = [];
                outSubtypes[ct].push(outPeers[oj]);
            }
            var outSubList = [];
            for (var oKey in outSubtypes) {
                if (!outSubtypes.hasOwnProperty(oKey)) continue;
                outSubList.push({
                    type: oKey,
                    label: CONN_TYPE_LABELS[oKey] || oKey,
                    count: outSubtypes[oKey].length,
                    peerIds: outSubtypes[oKey].map(function (p) { return p.id; })
                });
            }
            var displayName = seg.isOthers ? 'Others' : (seg.asShort || seg.asName || seg.asNumber);
            if (displayName.length > 16) displayName = displayName.substring(0, 15) + '\u2026';
            var gridItem = {
                asNumber: seg.asNumber,
                name: displayName,
                color: seg.color,
                isOthers: seg.isOthers || false,
                inCount: inPeers.length,
                outCount: outPeers.length,
                inPeerIds: inPeers.map(function (p) { return p.id; }),
                outPeerIds: outPeers.map(function (p) { return p.id; }),
                totalPeerIds: peers.map(function (p) { return p.id; }),
                inPeers: inPeers,
                outPeers: outPeers,
                outSubtypes: outSubList,
                totalCount: peers.length
            };
            // Carry over sub-provider groups for the Others bucket
            if (seg.isOthers && seg._othersGroups) {
                gridItem._othersGroups = seg._othersGroups;
            }
            grid.push(gridItem);
        }
        return grid;
    }

    /** Compute 4 dynamic insights for the summary panel */
    function computeInsights() {
        var insights = [];
        var nowSec = Math.floor(Date.now() / 1000);

        // Insight 1: Most stable — provider with highest avg connection duration
        if (asGroups.length > 0) {
            var bestAvg = 0, bestGroup = null;
            for (var i = 0; i < asGroups.length; i++) {
                var g = asGroups[i];
                var totalDur = 0, durCount = 0;
                for (var j = 0; j < g.peers.length; j++) {
                    if (g.peers[j].conntime > 0) {
                        totalDur += (nowSec - g.peers[j].conntime);
                        durCount++;
                    }
                }
                var avg = durCount > 0 ? totalDur / durCount : 0;
                if (avg > bestAvg) { bestAvg = avg; bestGroup = g; }
            }
            if (bestGroup && bestAvg > 0) {
                insights.push({
                    type: 'stable',
                    icon: '\u23f3',
                    asNumber: bestGroup.asNumber,
                    provName: bestGroup.asShort || bestGroup.asNumber,
                    durText: fmtDuration(bestAvg),
                    peerIds: bestGroup.peers.map(function (p) { return p.id; }),
                    peers: bestGroup.peers
                });
            }
        }

        // Insight 2: Fastest connection — providers ranked by avg ping time (lowest first)
        if (asGroups.length > 0) {
            var pingProvList = [];
            for (var i = 0; i < asGroups.length; i++) {
                var g = asGroups[i];
                var totalPing = 0, pingCount = 0;
                for (var j = 0; j < g.peers.length; j++) {
                    if (g.peers[j].ping_ms > 0) {
                        totalPing += g.peers[j].ping_ms;
                        pingCount++;
                    }
                }
                if (pingCount > 0) {
                    var avgPing = totalPing / pingCount;
                    var peersSorted = g.peers.slice().sort(function (a, b) { return (a.ping_ms || 9999) - (b.ping_ms || 9999); });
                    pingProvList.push({
                        asNumber: g.asNumber,
                        provName: g.asShort || g.asName || g.asNumber,
                        color: getColorForAsNum(g.asNumber),
                        avgPing: avgPing,
                        peers: peersSorted,
                        peerIds: g.peerIds
                    });
                }
            }
            pingProvList.sort(function (a, b) { return a.avgPing - b.avgPing; });
            if (pingProvList.length > 0) {
                insights.push({
                    type: 'fastest',
                    icon: '\u26a1',
                    topProviders: pingProvList,
                    field: 'ping'
                });
            }
        }

        // Insight 3: Providers with most total bytes sent
        var sentByProvider = {};
        for (var i = 0; i < lastPeersRaw.length; i++) {
            var p = lastPeersRaw[i];
            var asNum = parseAsNumber(p.as);
            if (!asNum || !(p.bytessent > 0)) continue;
            if (!sentByProvider[asNum]) sentByProvider[asNum] = { asNumber: asNum, totalBytes: 0, peers: [] };
            sentByProvider[asNum].totalBytes += p.bytessent;
            sentByProvider[asNum].peers.push(p);
        }
        var sentProvList = [];
        for (var k in sentByProvider) {
            if (!sentByProvider.hasOwnProperty(k)) continue;
            var sp = sentByProvider[k];
            sp.peers.sort(function (a, b) { return (b.bytessent || 0) - (a.bytessent || 0); });
            var grp = asGroups.find(function (g) { return g.asNumber === sp.asNumber; });
            sp.provName = grp ? (grp.asShort || grp.asName || grp.asNumber) : sp.asNumber;
            sp.color = getColorForAsNum(sp.asNumber);
            sentProvList.push(sp);
        }
        sentProvList.sort(function (a, b) { return b.totalBytes - a.totalBytes; });
        if (sentProvList.length > 0) {
            insights.push({
                type: 'data-providers',
                icon: '\u2b06\ufe0f',
                label: 'Most data sent to <span style="color:var(--text-muted)">(by rank)</span>',
                topProviders: sentProvList,
                field: 'bytessent'
            });
        }

        // Insight 4: Providers with most total bytes received
        var recvByProvider = {};
        for (var i = 0; i < lastPeersRaw.length; i++) {
            var p = lastPeersRaw[i];
            var asNum = parseAsNumber(p.as);
            if (!asNum || !(p.bytesrecv > 0)) continue;
            if (!recvByProvider[asNum]) recvByProvider[asNum] = { asNumber: asNum, totalBytes: 0, peers: [] };
            recvByProvider[asNum].totalBytes += p.bytesrecv;
            recvByProvider[asNum].peers.push(p);
        }
        var recvProvList = [];
        for (var k in recvByProvider) {
            if (!recvByProvider.hasOwnProperty(k)) continue;
            var rp = recvByProvider[k];
            rp.peers.sort(function (a, b) { return (b.bytesrecv || 0) - (a.bytesrecv || 0); });
            var grp = asGroups.find(function (g) { return g.asNumber === rp.asNumber; });
            rp.provName = grp ? (grp.asShort || grp.asName || grp.asNumber) : rp.asNumber;
            rp.color = getColorForAsNum(rp.asNumber);
            recvProvList.push(rp);
        }
        recvProvList.sort(function (a, b) { return b.totalBytes - a.totalBytes; });
        if (recvProvList.length > 0) {
            insights.push({
                type: 'data-providers',
                icon: '\u2b07\ufe0f',
                label: 'Most data recv by <span style="color:var(--text-muted)">(by rank)</span>',
                topProviders: recvProvList,
                field: 'bytesrecv'
            });
        }

        return insights;
    }

    /** Compute all summary data */
    function computeSummaryData() {
        var peers = lastPeersRaw;
        return {
            score: distributionScore,
            quality: getQuality(distributionScore),
            uniqueProviders: asGroups.length,
            topProvider: asGroups.length > 0 ? asGroups[0] : null,
            insights: computeInsights(),
            connectionGrid: buildConnectionGrid(),
            networks: aggregateSummaryNetworks(peers),
            hosting: aggregateSummaryHosting(peers),
            countries: aggregateSummaryCountries(peers),
            software: aggregateSummarySoftware(peers),
            services: aggregateSummaryServices(peers)
        };
    }

    function computeCountrySummaryData() {
        return {
            score: countryDistributionScore,
            quality: getQuality(countryDistributionScore),
            uniqueCountries: countryGroups.length,
            totalPeers: countryTotalPeers,
            topCountry: countryGroups.length > 0 ? countryGroups[0] : null,
            countries: countryGroups
        };
    }

    // ═══════════════════════════════════════════════════════════
    // SVG DONUT RENDERING
    // ═══════════════════════════════════════════════════════════

    /** Create an SVG arc path for a donut segment */
    function describeArc(cx, cy, outerR, innerR, startAngle, endAngle) {
        var sweep = endAngle - startAngle;
        var actualEnd = sweep >= 2 * Math.PI ? startAngle + 2 * Math.PI - 0.001 : endAngle;
        var largeArc = sweep > Math.PI ? 1 : 0;

        var ox1 = cx + outerR * Math.cos(startAngle);
        var oy1 = cy + outerR * Math.sin(startAngle);
        var ox2 = cx + outerR * Math.cos(actualEnd);
        var oy2 = cy + outerR * Math.sin(actualEnd);
        var ix1 = cx + innerR * Math.cos(actualEnd);
        var iy1 = cy + innerR * Math.sin(actualEnd);
        var ix2 = cx + innerR * Math.cos(startAngle);
        var iy2 = cy + innerR * Math.sin(startAngle);

        return [
            'M ' + ox1 + ' ' + oy1,
            'A ' + outerR + ' ' + outerR + ' 0 ' + largeArc + ' 1 ' + ox2 + ' ' + oy2,
            'L ' + ix1 + ' ' + iy1,
            'A ' + innerR + ' ' + innerR + ' 0 ' + largeArc + ' 0 ' + ix2 + ' ' + iy2,
            'Z',
        ].join(' ');
    }

    /** Render the donut SVG */
    function renderDonut() {
        if (!donutSvg) return;

        var cx = DONUT_SIZE / 2;
        var cy = DONUT_SIZE / 2;
        var gap = 0.03; // gap between segments in radians
        var html = '';
        var segments = getActiveSegments();
        var activePeerTotal = getActiveTotalPeers();

        // SVG defs for 3D-style effects
        html += '<defs>';
        // Drop shadow for depth
        html += '<filter id="donut-shadow" x="-20%" y="-20%" width="140%" height="140%">';
        html += '<feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000" flood-opacity="0.55"/>';
        html += '</filter>';
        // Inner shadow for 3D ring illusion
        html += '<filter id="donut-inner-shadow" x="-10%" y="-10%" width="120%" height="120%">';
        html += '<feGaussianBlur in="SourceAlpha" stdDeviation="3" result="shadow"/>';
        html += '<feOffset dx="0" dy="2" result="shadow-offset"/>';
        html += '<feComposite in="SourceGraphic" in2="shadow-offset" operator="over"/>';
        html += '</filter>';
        // Highlight gradient for 3D ring top-light
        html += '<linearGradient id="donut-highlight" x1="0" y1="0" x2="0" y2="1">';
        html += '<stop offset="0%" stop-color="rgba(255,255,255,0.15)"/>';
        html += '<stop offset="50%" stop-color="rgba(255,255,255,0)"/>';
        html += '<stop offset="100%" stop-color="rgba(0,0,0,0.12)"/>';
        html += '</linearGradient>';
        html += '</defs>';

        // Background track ring (subtle)
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="rgba(88,166,255,0.04)" stroke-width="' + DONUT_WIDTH + '" />';

        // Outer decorative ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS + 3) + '" fill="none" stroke="rgba(88,166,255,0.08)" stroke-width="1" />';

        // Inner decorative ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (INNER_RADIUS - 3) + '" fill="none" stroke="rgba(88,166,255,0.06)" stroke-width="0.5" />';

        if (segments.length === 0) {
            // Empty state — pulsing gray ring
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="#2d333b" stroke-width="' + DONUT_WIDTH + '" opacity="0.5" />';
        } else if (segments.length === 1) {
            var seg = segments[0];
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="' + seg.color + '" stroke-width="' + DONUT_WIDTH + '" class="as-donut-segment" data-as="' + seg.asNumber + '" filter="url(#donut-shadow)" />';
        } else {
            var totalGap = gap * segments.length;
            var available = 2 * Math.PI - totalGap;

            // Calculate sweeps — either normal (data-proportional) or animated (expanded)
            var sweeps = [];
            var normalSweeps = [];
            for (var si = 0; si < segments.length; si++) {
                normalSweeps.push((segments[si].peerCount / activePeerTotal) * available);
            }

            if ((donutAnimState === 'expanding' || donutAnimState === 'expanded' || donutAnimState === 'reverting') && donutAnimTarget) {
                // Calculate expanded layout: target segment gets DONUT_EXPAND_RATIO, rest share the remainder
                var expandedSweeps = [];
                var targetIdx = -1;
                for (var si = 0; si < segments.length; si++) {
                    if (segments[si].asNumber === donutAnimTarget) {
                        targetIdx = si;
                        break;
                    }
                }
                if (targetIdx >= 0) {
                    var expandedSweep = available * DONUT_EXPAND_RATIO;
                    var remainingSpace = available - expandedSweep;
                    var otherTotal = activePeerTotal - segments[targetIdx].peerCount;
                    for (var si = 0; si < segments.length; si++) {
                        if (si === targetIdx) {
                            expandedSweeps.push(expandedSweep);
                        } else {
                            var share = otherTotal > 0 ? (segments[si].peerCount / otherTotal) : (1 / (segments.length - 1));
                            expandedSweeps.push(share * remainingSpace);
                        }
                    }
                } else {
                    expandedSweeps = normalSweeps.slice();
                }

                // Interpolate based on animation progress
                var t = donutAnimState === 'reverting' ? (1 - donutAnimProgress) : donutAnimProgress;
                // Smooth easing
                t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                for (var si = 0; si < segments.length; si++) {
                    sweeps.push(normalSweeps[si] + (expandedSweeps[si] - normalSweeps[si]) * t);
                }
            } else {
                sweeps = normalSweeps;
            }

            // Arrange segments: in expanded mode, non-target segments go to top, target at bottom
            var renderOrder = [];
            var targetIdx = -1;
            if ((donutAnimState !== 'idle') && donutAnimTarget) {
                for (var si = 0; si < segments.length; si++) {
                    if (segments[si].asNumber === donutAnimTarget) {
                        targetIdx = si;
                    } else {
                        renderOrder.push(si);
                    }
                }
                if (targetIdx >= 0) renderOrder.push(targetIdx);
            } else {
                for (var si = 0; si < segments.length; si++) renderOrder.push(si);
            }

            // Layout: others at top (starting at -PI/2), target fills bottom
            var angle = -Math.PI / 2;

            // If animating, re-order: non-target segments first (top), then target (bottom)
            var segAngles = [];
            for (var ri = 0; ri < renderOrder.length; ri++) {
                var idx = renderOrder[ri];
                var sweep = sweeps[idx];
                if (sweep <= 0) {
                    segAngles[idx] = { start: angle, end: angle };
                    continue;
                }
                segAngles[idx] = { start: angle + gap / 2, end: angle + sweep + gap / 2 };
                angle += sweep + gap;
            }

            // Calculate per-segment ring widths (animated: selected=thick, others=thin)
            var segWidths = [];
            var animT = 0;
            if ((donutAnimState === 'expanding' || donutAnimState === 'expanded' || donutAnimState === 'reverting') && donutAnimTarget) {
                animT = donutAnimState === 'reverting' ? (1 - donutAnimProgress) : donutAnimProgress;
                animT = animT < 0.5 ? 2 * animT * animT : 1 - Math.pow(-2 * animT + 2, 2) / 2;
            }
            for (var si = 0; si < segments.length; si++) {
                if (animT > 0 && donutAnimTarget) {
                    if (segments[si].asNumber === donutAnimTarget) {
                        segWidths.push(DONUT_WIDTH + (DONUT_WIDTH_SELECTED - DONUT_WIDTH) * animT);
                    } else {
                        segWidths.push(DONUT_WIDTH + (DONUT_WIDTH_DIMMED - DONUT_WIDTH) * animT);
                    }
                } else {
                    segWidths.push(DONUT_WIDTH);
                }
            }

            // Group for shadow on all segments
            html += '<g filter="url(#donut-shadow)">';
            for (var si = 0; si < segments.length; si++) {
                var seg = segments[si];
                if (!segAngles[si] || sweeps[si] <= 0) continue;

                var segW = segWidths[si];
                var segOuter = DONUT_RADIUS - (DONUT_WIDTH - segW) / 2;
                var segInner = segOuter - segW;
                var d = describeArc(cx, cy, segOuter, segInner, segAngles[si].start, segAngles[si].end);

                var cls = ['as-donut-segment'];
                if (selectedAs && selectedAs !== seg.asNumber) cls.push('dimmed');
                if (selectedAs === seg.asNumber) cls.push('selected');

                html += '<path d="' + d + '" fill="' + seg.color + '" class="' + cls.join(' ') + '" data-as="' + seg.asNumber + '" />';
            }
            html += '</g>';

            // 3D highlight overlay — a semi-transparent ring on top for depth illusion
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (DONUT_RADIUS - DONUT_WIDTH / 2) + '" fill="none" stroke="url(#donut-highlight)" stroke-width="' + DONUT_WIDTH + '" pointer-events="none" />';
        }

        donutSvg.innerHTML = html;

        // Hide loading once we have data
        if (segments.length > 0 && loadingEl) {
            loadingEl.style.display = 'none';
            hasRenderedOnce = true;
        }

        // Attach segment event listeners
        var segEls = donutSvg.querySelectorAll('.as-donut-segment');
        for (var i = 0; i < segEls.length; i++) {
            segEls[i].addEventListener('mouseenter', onSegmentHover);
            segEls[i].addEventListener('mouseleave', onSegmentLeave);
            segEls[i].addEventListener('click', onSegmentClick);
        }
    }

    /** Start donut expansion animation for a selected segment */
    function animateDonutExpand(asNum) {
        // Skip re-animation if already expanded to the same target
        if (donutAnimState === 'expanded' && donutAnimTarget === asNum) {
            renderDonut();  // Just re-render with fresh data (no animation)
            return;
        }
        if (donutAnimFrame) cancelAnimationFrame(donutAnimFrame);
        if (donutAnimSafetyTimer) clearTimeout(donutAnimSafetyTimer);
        donutAnimTarget = asNum;
        donutAnimState = 'expanding';
        donutAnimProgress = 0;
        donutAnimStartTime = performance.now();
        donutAnimFrame = requestAnimationFrame(donutAnimStep);
        // Safety: force-complete if animation gets stuck
        donutAnimSafetyTimer = setTimeout(function () {
            if (donutAnimState === 'expanding') {
                donutAnimState = 'expanded';
                donutAnimProgress = 1;
                donutAnimFrame = null;
                renderDonut();
            }
        }, DONUT_ANIM_DURATION + 200);
    }

    /** Start donut revert animation (back to proportional) */
    function animateDonutRevert() {
        if (donutAnimFrame) cancelAnimationFrame(donutAnimFrame);
        if (donutAnimSafetyTimer) clearTimeout(donutAnimSafetyTimer);
        donutAnimState = 'reverting';
        donutAnimProgress = 0;
        donutAnimStartTime = performance.now();
        donutAnimFrame = requestAnimationFrame(donutAnimStep);
        // Safety: force-complete if animation gets stuck
        donutAnimSafetyTimer = setTimeout(function () {
            if (donutAnimState === 'reverting') {
                donutAnimState = 'idle';
                donutAnimTarget = null;
                donutAnimProgress = 0;
                donutAnimFrame = null;
                renderDonut();
            }
        }, DONUT_ANIM_DURATION + 200);
    }

    /** Animation step — called each frame */
    function donutAnimStep(now) {
        var elapsed = now - donutAnimStartTime;
        donutAnimProgress = Math.min(1, elapsed / DONUT_ANIM_DURATION);

        renderDonut();

        if (donutAnimProgress < 1) {
            donutAnimFrame = requestAnimationFrame(donutAnimStep);
        } else {
            // Animation complete
            donutAnimFrame = null;
            if (donutAnimState === 'expanding') {
                donutAnimState = 'expanded';
                donutAnimProgress = 1;
            } else if (donutAnimState === 'reverting') {
                donutAnimState = 'idle';
                donutAnimTarget = null;
                donutAnimProgress = 0;
                // Final render at idle state
                renderDonut();
            }
        }
    }

    /** Force-stop any donut animation (safety) */
    function stopDonutAnimation() {
        if (donutAnimFrame) {
            cancelAnimationFrame(donutAnimFrame);
            donutAnimFrame = null;
        }
        if (donutAnimSafetyTimer) {
            clearTimeout(donutAnimSafetyTimer);
            donutAnimSafetyTimer = null;
        }
        donutAnimState = 'idle';
        donutAnimTarget = null;
        donutAnimProgress = 0;
    }

    // ═══════════════════════════════════════════════════════════
    // INSIGHT RECTANGLE — replaces donut for Score & Insights selections
    // ═══════════════════════════════════════════════════════════

    /** Show the insight rectangle overlay, hiding the donut SVG and center text.
     *  @param {string} type — 'stable' | 'fastest' | 'data-bytessent' | 'data-bytesrecv'
     *  @param {Object} data — insight-specific data */
    function showInsightRect(type, data) {
        if (!insightRectEl) return;

        var provColor = data.color || '#d29922';

        // Build the title, icon, and content based on insight type
        var icon = '', title = '', provName = '', statLine = '', metaLine = '', rankLine = '';

        if (type === 'stable') {
            icon = '\u23f3';
            title = 'Most Stable Network';
            provName = data.provName || '';
            var peerCount = data.peerIds ? data.peerIds.length : 0;
            metaLine = peerCount + ' peer' + (peerCount !== 1 ? 's' : '') + ' \u00b7 ' + (data.asNumber || '');
            statLine = 'avg ' + (data.durText || '');
        } else if (type === 'fastest') {
            icon = '\u26a1';
            title = 'Fastest Connection';
            provName = data.provName || '';
            var peerCount = data.peerIds ? data.peerIds.length : 0;
            metaLine = peerCount + ' peer' + (peerCount !== 1 ? 's' : '') + ' \u00b7 ' + (data.asNumber || '');
            statLine = data.avgPing ? data.avgPing.toFixed(1) + ' ms avg' : '';
            if (data.rank) {
                rankLine = 'Rank #' + data.rank;
            }
        } else if (type === 'data-bytessent') {
            icon = '\u2b06\ufe0f';
            title = 'Most Data Sent To';
            provName = data.provName || '';
            var peerCount = data.peers ? data.peers.length : 0;
            metaLine = peerCount + ' peer' + (peerCount !== 1 ? 's' : '') + ' \u00b7 ' + (data.asNumber || '');
            statLine = fmtBytes(data.totalBytes || 0);
            if (data.rank) {
                rankLine = 'Rank #' + data.rank;
            }
        } else if (type === 'data-bytesrecv') {
            icon = '\u2b07\ufe0f';
            title = 'Most Data Recv By';
            provName = data.provName || '';
            var peerCount = data.peers ? data.peers.length : 0;
            metaLine = peerCount + ' peer' + (peerCount !== 1 ? 's' : '') + ' \u00b7 ' + (data.asNumber || '');
            statLine = fmtBytes(data.totalBytes || 0);
            if (data.rank) {
                rankLine = 'Rank #' + data.rank;
            }
        }

        // Determine network color for the origin circle
        var originColor = provColor;

        var html = '';
        html += '<div class="as-insight-rect-inner">';
        html += '<div class="as-insight-rect-badge">Score &amp; Insights</div>';
        html += '<button class="as-insight-rect-close" title="Back">\u2190</button>';
        html += '<div class="as-insight-rect-content">';
        html += '<div class="as-insight-rect-icon">' + icon + '</div>';
        html += '<div class="as-insight-rect-title">' + escHtml(title) + '</div>';
        if (rankLine) {
            html += '<div class="as-insight-rect-rank" style="color:#d4a017">' + rankLine + '</div>';
        }
        html += '<div class="as-insight-rect-provider" style="color:' + provColor + '" title="' + escHtml(provName) + '">' + escHtml(provName) + '</div>';
        html += '<div class="as-insight-rect-meta">' + metaLine + '</div>';
        if (statLine) {
            html += '<div class="as-insight-rect-stat" style="color:' + provColor + '">' + statLine + '</div>';
        }
        html += '</div>';
        html += '<div class="as-insight-rect-origin" style="background:' + originColor + '; border-color:' + originColor + '"></div>';
        html += '</div>';

        insightRectEl.innerHTML = html;

        // Hide donut SVG and center, show rectangle
        if (donutSvg) donutSvg.style.opacity = '0';
        if (donutCenter) donutCenter.style.opacity = '0';
        insightRectEl.classList.add('visible');
        insightRectVisible = true;
        document.body.classList.add('insight-rect-active');

        // Bind close button
        var closeBtn = insightRectEl.querySelector('.as-insight-rect-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                hideInsightRect();
                // Clear the insight state and revert
                insightActiveAsNum = null; insightActiveData = null;
                insightActiveType = null;
                animateDonutRevert();
                renderCenter();
                // Restore summary all-lines
                if (summarySelected) {
                    clearSummarySubFilter();
                }
            });
        }
    }

    /** Update the insight rectangle content for a specific peer (hover/select from submenu).
     *  @param {Object} peer — raw peer data
     *  @param {string} provColor — color for the provider */
    function updateInsightRectForPeer(peer, provColor) {
        if (!insightRectEl || !insightRectVisible) return;
        var provEl = insightRectEl.querySelector('.as-insight-rect-provider');
        var metaEl = insightRectEl.querySelector('.as-insight-rect-meta');
        var statEl = insightRectEl.querySelector('.as-insight-rect-stat');
        var rankEl = insightRectEl.querySelector('.as-insight-rect-rank');

        if (rankEl) rankEl.style.display = 'none';
        if (provEl) {
            provEl.textContent = 'Peer #' + peer.id;
            provEl.title = 'Peer #' + peer.id;
            provEl.style.color = provColor;
        }
        if (metaEl) {
            var peerProvName = peer.asname || parseAsOrg(peer.as) || '';
            var asNum = parseAsNumber(peer.as) || '';
            metaEl.textContent = peerProvName + ' \u00b7 ' + asNum;
        }
        if (statEl) {
            // Show context-appropriate stat based on active insight type
            if (insightActiveType === 'fastest') {
                statEl.textContent = peer.ping_ms > 0 ? Math.round(peer.ping_ms) + ' ms' : '\u2014';
            } else if (insightActiveType === 'data-bytessent') {
                statEl.textContent = fmtBytes(peer.bytessent || 0) + ' sent';
            } else if (insightActiveType === 'data-bytesrecv') {
                statEl.textContent = fmtBytes(peer.bytesrecv || 0) + ' recv';
            } else {
                var connSec = peer.conntime ? (Math.floor(Date.now() / 1000) - peer.conntime) : 0;
                statEl.textContent = 'Uptime: ' + fmtDuration(connSec);
            }
            statEl.style.color = provColor;
        }
    }

    /** Restore the insight rectangle to its original provider-level content.
     *  Called when mouse leaves a peer in the submenu. */
    function restoreInsightRectProvider() {
        if (!insightRectVisible || !insightActiveType || !insightActiveAsNum) return;
        // Rebuild the rect with the original data
        var data = getInsightDataForActive();
        if (data) {
            showInsightRect(insightActiveType, data);
        } else if (insightActiveData) {
            // Use stored data for providers not in the top-N list
            showInsightRect(insightActiveType, insightActiveData);
        }
    }

    /** Get the current insight data for the active insight type/AS */
    function getInsightDataForActive() {
        if (!insightActiveAsNum || !insightActiveType) return null;
        var sumData = computeSummaryData();
        for (var i = 0; i < sumData.insights.length; i++) {
            var ins = sumData.insights[i];
            if (insightActiveType === 'stable' && ins.type === 'stable') {
                return {
                    provName: ins.provName,
                    asNumber: ins.asNumber,
                    peerIds: ins.peerIds,
                    durText: ins.durText,
                    color: getColorForAsNum(ins.asNumber)
                };
            }
            if (insightActiveType === 'fastest' && ins.type === 'fastest' && ins.topProviders) {
                for (var j = 0; j < ins.topProviders.length; j++) {
                    if (ins.topProviders[j].asNumber === insightActiveAsNum) {
                        return {
                            provName: ins.topProviders[j].provName,
                            asNumber: ins.topProviders[j].asNumber,
                            peerIds: ins.topProviders[j].peerIds,
                            avgPing: ins.topProviders[j].avgPing,
                            rank: j + 1,
                            color: ins.topProviders[j].color || getColorForAsNum(ins.topProviders[j].asNumber)
                        };
                    }
                }
            }
            if (ins.type === 'data-providers' && ins.topProviders) {
                var isRecv = insightActiveType === 'data-bytesrecv';
                var isSent = insightActiveType === 'data-bytessent';
                if ((isSent && ins.field === 'bytessent') || (isRecv && ins.field === 'bytesrecv')) {
                    for (var j = 0; j < ins.topProviders.length; j++) {
                        if (ins.topProviders[j].asNumber === insightActiveAsNum) {
                            return {
                                provName: ins.topProviders[j].provName,
                                asNumber: ins.topProviders[j].asNumber,
                                peers: ins.topProviders[j].peers,
                                totalBytes: ins.topProviders[j].totalBytes,
                                rank: j + 1,
                                color: ins.topProviders[j].color || getColorForAsNum(ins.topProviders[j].asNumber)
                            };
                        }
                    }
                }
            }
        }
        return null;
    }

    /** Hide the insight rectangle and restore the donut SVG + center text */
    function hideInsightRect() {
        if (!insightRectEl) return;
        insightRectEl.classList.remove('visible');
        insightRectVisible = false;
        document.body.classList.remove('insight-rect-active');
        // Show donut SVG and center
        if (donutSvg) donutSvg.style.opacity = '';
        if (donutCenter) donutCenter.style.opacity = '';
    }

    /** Get quality rating for a distribution score */
    function getQuality(score) {
        if (score >= 8) return { word: 'Excellent', cls: 'q-excellent' };
        if (score >= 6) return { word: 'Good', cls: 'q-good' };
        if (score >= 4) return { word: 'Moderate', cls: 'q-moderate' };
        if (score >= 2) return { word: 'Poor', cls: 'q-poor' };
        return { word: 'Critical', cls: 'q-critical' };
    }

    /** Build score tooltip text */
    function buildScoreTooltip(score) {
        var q = getQuality(score);
        return 'Distribution Score: ' + score.toFixed(1) + '/10 (' + q.word + ')\n'
             + 'Based on Herfindahl\u2013Hirschman Index (HHI)\n'
             + 'Higher = more evenly distributed peers across providers';
    }

    /** Update the donut center label.
     *  Layout: DISTRIBUTION | SCORE: heading | big number | quality word
     *  When AS selected: peer count heading | AS name | percentage */
    function renderCenter() {
        if (!donutCenter) return;
        var activePeerTotal = getActiveTotalPeers();
        var activeScore = getActiveDistributionScore();

        // Clear legend-hover pointer-events lock whenever center is re-rendered
        clearLegendHoverActive();

        // If peer detail panel is active, don't touch center text — showPeerInDonutCenter manages it
        if (peerDetailActive) return;


        // In focused mode with hover active, preserve the hover display during data updates
        if (donutFocused && focusedHoverAs && !selectedAs) {
            showFocusedCenterText(focusedHoverAs);
            return;
        }

        // With legends hidden and hover active, preserve provider info during data updates
        if (legendsHidden && !donutFocused && focusedHoverAs && !selectedAs) {
            showLegendHoverCenterText(focusedHoverAs);
            return;
        }

        // If an insight is active (Most Stable, Fastest, etc.) and no AS is selected,
        // refresh the insight rectangle (it replaces the donut)
        if (insightActiveAsNum && summarySelected && !selectedAs && donutFocused) {
            if (insightRectVisible) {
                // Rect is already visible — refresh its data
                var insData = getInsightDataForActive();
                if (insData) showInsightRect(insightActiveType, insData);
            } else {
                showFocusedCenterText(insightActiveAsNum);
            }
            return;
        }

        // If a summary sub-filter is active (e.g. IPv4, IPv6), show category info in donut center
        if (donutFocused && summarySelected && subFilterPeerIds && subFilterLabel && !selectedAs) {
            var distributionEl2 = donutCenter.querySelector('.as-score-distribution');
            var headingEl2 = donutCenter.querySelector('.as-score-heading');
            var scoreVal2 = donutCenter.querySelector('.as-score-value');
            var qualityEl2 = donutCenter.querySelector('.as-score-quality');
            var scoreLbl2 = donutCenter.querySelector('.as-score-label');
            if (distributionEl2) distributionEl2.style.display = 'none';
            if (headingEl2) {
                headingEl2.textContent = subFilterPeerIds.length + ' PEER' + (subFilterPeerIds.length !== 1 ? 'S' : '');
                headingEl2.style.color = 'var(--accent)';
                headingEl2.style.display = '';
            }
            if (scoreVal2) {
                scoreVal2.textContent = subFilterLabel;
                scoreVal2.className = 'as-score-value as-selected-mode';
                scoreVal2.style.color = 'var(--text-primary)';
                scoreVal2.title = subFilterLabel + ' — ' + subFilterPeerIds.length + ' peers';
            }
            if (qualityEl2) {
                var pctOfTotal = activePeerTotal > 0 ? ((subFilterPeerIds.length / activePeerTotal) * 100).toFixed(1) : '0.0';
                qualityEl2.textContent = pctOfTotal + '% of peers';
                qualityEl2.className = 'as-score-quality';
                qualityEl2.style.color = 'var(--text-secondary)';
            }
            if (scoreLbl2) {
                scoreLbl2.textContent = '';
            }
            return;
        }

        // If a summary row hover preview is active, preserve it across data refresh
        if (donutFocused && summarySelected && summaryPreviewPeerIds && summaryPreviewLabel && !selectedAs) {
            previewSummaryCenterText(summaryPreviewPeerIds, summaryPreviewLabel);
            return;
        }

        // If a network panel (IPv4/IPv6) is open, show network info in center
        if (donutFocused && activeNetworkPanel && !selectedAs) {
            // If a sub-filter is active within the network panel, show that category
            if (subFilterPeerIds && subFilterLabel) {
                var distributionEl2 = donutCenter.querySelector('.as-score-distribution');
                var headingEl2 = donutCenter.querySelector('.as-score-heading');
                var scoreVal2 = donutCenter.querySelector('.as-score-value');
                var qualityEl2 = donutCenter.querySelector('.as-score-quality');
                var scoreLbl2 = donutCenter.querySelector('.as-score-label');
                if (distributionEl2) distributionEl2.style.display = 'none';
                if (headingEl2) {
                    headingEl2.textContent = subFilterPeerIds.length + ' PEER' + (subFilterPeerIds.length !== 1 ? 'S' : '');
                    headingEl2.style.color = 'var(--accent)';
                    headingEl2.style.display = '';
                }
                if (scoreVal2) {
                    scoreVal2.textContent = subFilterLabel;
                    scoreVal2.className = 'as-score-value as-selected-mode';
                    scoreVal2.style.color = 'var(--text-primary)';
                    scoreVal2.title = subFilterLabel + ' — ' + subFilterPeerIds.length + ' peers';
                }
                if (qualityEl2) {
                    var pctOfTotal = activePeerTotal > 0 ? ((subFilterPeerIds.length / activePeerTotal) * 100).toFixed(1) : '0.0';
                    qualityEl2.textContent = pctOfTotal + '% of peers';
                    qualityEl2.className = 'as-score-quality';
                    qualityEl2.style.color = 'var(--text-secondary)';
                }
                if (scoreLbl2) {
                    scoreLbl2.textContent = '';
                }
                return;
            }
            // No sub-filter — show the network overview
            var npNetKey = activeNetworkPanel;
            var npNetLabel = npNetKey === 'ipv4' ? 'IPv4' : 'IPv6';
            var npNetColor = npNetKey === 'ipv4' ? 'var(--net-ipv4, #e3b341)' : 'var(--net-ipv6, #f07178)';
            var npNetPeers = lastPeersRaw.filter(function (p) {
                return (p.network || 'ipv4') === npNetKey;
            });
            var distributionEl3 = donutCenter.querySelector('.as-score-distribution');
            var headingEl3 = donutCenter.querySelector('.as-score-heading');
            var scoreVal3 = donutCenter.querySelector('.as-score-value');
            var qualityEl3 = donutCenter.querySelector('.as-score-quality');
            var scoreLbl3 = donutCenter.querySelector('.as-score-label');
            if (distributionEl3) distributionEl3.style.display = 'none';
            if (headingEl3) {
                headingEl3.textContent = npNetPeers.length + ' PEER' + (npNetPeers.length !== 1 ? 'S' : '');
                headingEl3.style.color = 'var(--accent)';
                headingEl3.style.display = '';
            }
            if (scoreVal3) {
                scoreVal3.textContent = npNetLabel;
                scoreVal3.className = 'as-score-value as-selected-mode';
                scoreVal3.style.color = npNetColor;
                scoreVal3.title = npNetLabel + ' Network — ' + npNetPeers.length + ' peers';
            }
            if (qualityEl3) {
                var pctOfTotal = activePeerTotal > 0 ? ((npNetPeers.length / activePeerTotal) * 100).toFixed(1) : '0.0';
                qualityEl3.textContent = pctOfTotal + '% of peers';
                qualityEl3.className = 'as-score-quality';
                qualityEl3.style.color = 'var(--text-secondary)';
            }
            if (scoreLbl3) {
                scoreLbl3.textContent = '';
            }
            return;
        }

        var distributionEl = donutCenter.querySelector('.as-score-distribution');
        var headingEl = donutCenter.querySelector('.as-score-heading');
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var qualityEl = donutCenter.querySelector('.as-score-quality');
        var scoreLbl = donutCenter.querySelector('.as-score-label');
        if (!scoreVal || !scoreLbl) return;

        // If an AS is selected, show AS info instead of score
        if (selectedAs) {
            var seg = findActiveSegmentOrGroup(selectedAs);
            if (seg) {
                var displayName = seg.isOthers ? 'Others' : (seg.asShort || seg.asName || seg.asNumber);
                if (displayName.length > 14) displayName = displayName.substring(0, 13) + '\u2026';

                // Show "← Others" back link for sub-groups, else active lens label
                var isSubProv = isOthersSubProvider(selectedAs);
                if (distributionEl) {
                    if (isSubProv && donutFocused) {
                        distributionEl.innerHTML = '<span class="as-others-back-link">\u2190 Others</span>';
                        distributionEl.style.color = '';
                    } else {
                        distributionEl.textContent = seg.isOthers ? 'Bucket:' : getActiveEntityKind();
                        distributionEl.style.color = 'var(--logo-primary)';
                    }
                    distributionEl.style.display = '';
                }
                // Hide the heading row — peer count moves to bottom label
                if (headingEl) {
                    headingEl.textContent = '';
                    headingEl.style.display = 'none';
                }
                scoreVal.textContent = displayName;
                scoreVal.className = 'as-score-value as-selected-mode';
                scoreVal.style.color = seg.color;
                scoreVal.title = seg.asNumber + ' \u00b7 ' + (seg.asName || '') + '\n'
                    + seg.peerCount + ' peers (' + seg.percentage.toFixed(1) + '%)';
                if (qualityEl) {
                    qualityEl.textContent = seg.asNumber === 'Others' ? '' : (isCountryLens() ? (seg.countryCode || '') : seg.asNumber);
                    qualityEl.className = 'as-score-quality';
                    qualityEl.style.color = seg.color;
                }
                if (scoreLbl) {
                    scoreLbl.textContent = seg.peerCount + ' PEER' + (seg.peerCount !== 1 ? 'S' : '');
                    scoreLbl.className = 'as-score-label as-provider-peers';
                    scoreLbl.style.color = '';
                }
                scoreLbl.classList.remove('as-summary-link');
                attachOthersBackHandler();
                return;
            }
        }

        // Reset any selected-mode / provider styling
        scoreVal.className = 'as-score-value';
        scoreVal.style.color = '';
        if (distributionEl) {
            distributionEl.textContent = 'DISTRIBUTION';
            distributionEl.style.display = '';
            distributionEl.style.color = '';
        }
        if (headingEl) {
            headingEl.style.color = '';
            headingEl.style.display = '';
        }
        if (qualityEl) {
            qualityEl.style.color = '';
        }
        if (scoreLbl) {
            scoreLbl.className = 'as-score-label';
            scoreLbl.style.color = '';
        }

        // Edge case: no locatable peers for the active lens.
        if (activePeerTotal === 0) {
            if (distributionEl) distributionEl.style.display = 'none';
            if (headingEl) headingEl.textContent = '';
            if (qualityEl) {
                qualityEl.textContent = '';
                qualityEl.className = 'as-score-quality q-nodata';
            }
            scoreVal.textContent = '\u2014';
            scoreVal.title = isCountryLens()
                ? 'No country data available for public peers'
                : 'No AS data available \u2014 all peers are on private or anonymous networks';
            scoreLbl.textContent = 'NO DATA';
            scoreLbl.classList.remove('as-summary-link');
            return;
        }

        // Normal: show distribution score
        var q = getQuality(activeScore);

        if (headingEl) {
            headingEl.textContent = 'SCORE:';
        }

        scoreVal.textContent = activeScore.toFixed(1);
        scoreVal.title = buildActiveScoreTooltip(activeScore);

        // Remove old score classes and add new
        scoreVal.classList.remove('as-score-excellent', 'as-score-good', 'as-score-moderate', 'as-score-poor', 'as-score-critical');
        if (activeScore >= 8) scoreVal.classList.add('as-score-excellent');
        else if (activeScore >= 6) scoreVal.classList.add('as-score-good');
        else if (activeScore >= 4) scoreVal.classList.add('as-score-moderate');
        else if (activeScore >= 2) scoreVal.classList.add('as-score-poor');
        else scoreVal.classList.add('as-score-critical');

        if (qualityEl) {
            qualityEl.textContent = q.word;
            qualityEl.className = 'as-score-quality ' + q.cls;
        }

        // Label just shows quality word below - no "DISTRIBUTION SUMMARY" text needed
        scoreLbl.textContent = '';
        scoreLbl.classList.remove('as-summary-link');
        scoreLbl.classList.remove('as-summary-active');
    }

    /** Render the legend */
    function renderLegend() {
        if (!legendEl) return;
        var html = '';
        var segments = getActiveSegments();
        var groups = getActiveGroups();
        var activePeerTotal = getActiveTotalPeers();
        var headerLabel = isCountryLens() ? 'COUNTRIES' : 'PROVIDERS';

        // When a provider is hovered in the panel, show only that provider in the legend
        var focusAs = legendFocusAs || (summarySelected && subSubTooltipPinned && subSubFilterAsNum ? subSubFilterAsNum : null);
        if (focusAs) {
            var seg = segments.find(function (s) { return s.asNumber === focusAs; });
            if (seg) {
                var displayName = seg.isOthers ? seg.asName : (seg.asShort || seg.asName || seg.asNumber);
                var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;
                html += '<div class="as-legend-item highlighted" data-as="' + seg.asNumber + '">';
                html += '<span class="as-legend-dot" style="background:' + seg.color + '"></span>';
                html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
                html += '<span class="as-legend-count">' + seg.peerCount + '</span>';
                html += '<span class="as-legend-pct">' + seg.percentage.toFixed(0) + '%</span>';
                html += '</div>';
            } else {
                // Provider is inside Others — show its actual name, not "Others"
                var grp = groups.find(function (g) { return g.asNumber === focusAs; });
                if (grp) {
                    var color = getColorForActiveEntity(focusAs);
                    var displayName = grp.asShort || grp.asName || grp.asNumber;
                    var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;
                    html += '<div class="as-legend-item highlighted" data-as="' + focusAs + '">';
                    html += '<span class="as-legend-dot" style="background:' + color + '"></span>';
                    html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
                    html += '<span class="as-legend-count">' + grp.peerCount + '</span>';
                    html += '<span class="as-legend-pct">' + (activePeerTotal > 0 ? (grp.peerCount / activePeerTotal * 100).toFixed(0) : 0) + '%</span>';
                    html += '</div>';
                }
            }
        } else if (selectedAs) {
            // When an AS is clicked (selected), show only that provider in the legend
            var seg = segments.find(function (s) { return s.asNumber === selectedAs; });
            if (!seg) {
                // Selected AS might be a sub-provider inside Others
                var grp = groups.find(function (g) { return g.asNumber === selectedAs; });
                if (grp) {
                    var color = getColorForActiveEntity(selectedAs);
                    var displayName = grp.asShort || grp.asName || grp.asNumber;
                    var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;
                    html += '<div class="as-legend-item selected" data-as="' + selectedAs + '">';
                    html += '<span class="as-legend-dot" style="background:' + color + '"></span>';
                    html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
                    html += '<span class="as-legend-count">' + grp.peerCount + '</span>';
                    html += '<span class="as-legend-pct">' + (activePeerTotal > 0 ? (grp.peerCount / activePeerTotal * 100).toFixed(0) : 0) + '%</span>';
                    html += '</div>';
                }
            } else {
                var displayName = seg.isOthers ? seg.asName : (seg.asShort || seg.asName || seg.asNumber);
                var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;
                html += '<div class="as-legend-item selected" data-as="' + seg.asNumber + '">';
                html += '<span class="as-legend-dot" style="background:' + seg.color + '"></span>';
                html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
                html += '<span class="as-legend-count">' + seg.peerCount + '</span>';
                html += '<span class="as-legend-pct">' + seg.percentage.toFixed(0) + '%</span>';
                html += '</div>';
            }
        } else {
            // Default state: show "TOP 8" header + all segments
            html += '<div class="as-legend-header">TOP ' + Math.min(MAX_SEGMENTS, segments.length) + ' ' + headerLabel + '</div>';
            for (var i = 0; i < segments.length; i++) {
                var seg = segments[i];
                var displayName = seg.isOthers ? seg.asName : (seg.asShort || seg.asName || seg.asNumber);
                var shortName = displayName.length > 18 ? displayName.substring(0, 17) + '\u2026' : displayName;

                html += '<div class="as-legend-item" data-as="' + seg.asNumber + '">';
                html += '<span class="as-legend-dot" style="background:' + seg.color + '"></span>';
                html += '<span class="as-legend-name" title="' + displayName + '">' + shortName + '</span>';
                html += '<span class="as-legend-count">' + seg.peerCount + '</span>';
                html += '<span class="as-legend-pct">' + seg.percentage.toFixed(0) + '%</span>';
                html += '</div>';
            }
        }
        legendEl.innerHTML = html;

        // Attach legend event listeners
        var items = legendEl.querySelectorAll('.as-legend-item');
        for (var li = 0; li < items.length; li++) {
            items[li].addEventListener('mouseenter', onSegmentHover);
            items[li].addEventListener('mouseleave', onSegmentLeave);
            items[li].addEventListener('click', onSegmentClick);
        }
    }

    /** Focus the legend on a single provider (used during panel hover/click) */
    function setLegendFocus(asNum) {
        if (legendFocusAs === asNum) return;
        legendFocusAs = asNum;
        renderLegend();
    }

    /** Clear the legend focus, returning to normal display */
    function clearLegendFocus() {
        if (!legendFocusAs) return;
        if (subSubTooltipPinned) return; // Don't clear while sub-sub is pinned
        legendFocusAs = null;
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
                    if (subTooltipPinned || peerDetailActive) return;
                    var countryId = rowEl.dataset.as;
                    var seg = findActiveSegmentOrGroup(countryId);
                    if (!seg) return;
                    highlightLegendItem(countryId);
                    if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                    if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                    if (_drawLinesForAs) _drawLinesForAs(countryId, seg.peerIds, seg.color);
                    if (donutFocused) {
                        focusedHoverAs = countryId;
                        showFocusedCenterText(countryId);
                    }
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (subTooltipPinned || peerDetailActive) return;
                    focusedHoverAs = null;
                    clearLegendHighlight();
                    if (summarySelected) {
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
                    panelHistory = [{ type: 'summary', scrollTop: scrollTop }];
                    summarySelected = false;
                    selectedAs = countryId;
                    subFilterPeerIds = null;
                    subFilterLabel = null;
                    subFilterCategory = null;
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
        var providersJson = JSON.stringify(catData.providers.map(function (prov) {
            return { a: prov.asNumber, n: prov.name, c: prov.color, pc: prov.peerCount, pi: prov.peerIds };
        })).replace(/"/g, '&quot;');
        var peerIdsJson = JSON.stringify(catData.peerIds).replace(/"/g, '&quot;');
        return '<div class="as-detail-sub-row as-interactive-row as-summary-row" data-peer-ids="' + peerIdsJson + '" data-providers="' + providersJson + '" data-cat-label="' + label.replace(/"/g, '&quot;') + '">'
             + '<span class="as-detail-sub-label">' + label + '</span>'
             + '<span class="as-detail-sub-val">' + value + '</span>'
             + '</div>';
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
        var seg = selectedAs ? findActiveSegment(selectedAs) : null;
        var allPeers = [];
        if (seg) {
            if (seg.isOthers && seg._othersGroups) {
                for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                    for (var opi = 0; opi < seg._othersGroups[oi].peers.length; opi++) {
                        allPeers.push(seg._othersGroups[oi].peers[opi]);
                    }
                }
            } else {
                var grp = findActiveGroup(selectedAs);
                if (grp) allPeers = grp.peers;
            }
        } else if (selectedAs) {
            // Fallback for sub-groups not in top donut segments.
            var grp = findActiveGroup(selectedAs);
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
                    hoveredPeerId = peerId; // Track for update preservation
                    if (summarySelected) {
                        previewSummaryLines([peerId]);
                    } else if (selectedAs) {
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
                            if (insightRectVisible) {
                                updateInsightRectForPeer(peer, color);
                            } else {
                                showPeerInDonutCenter(peer, color);
                                // Keep donut expanded for the provider context
                                if (subFilterCategory && subFilterCategory.indexOf('conn-') === 0 && subFilterLabel) {
                                    animateDonutExpand(subFilterLabel);
                                }
                            }
                        }
                    }
                });
                row.addEventListener('mouseleave', function () {
                    hoveredPeerId = null;

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
                                if (insightRectVisible) {
                                    updateInsightRectForPeer(selPeer, selColor);
                                } else {
                                    showPeerInDonutCenter(selPeer, selColor);
                                }
                            }
                        }
                        return;
                    }

                    // Restore lines/filter to parent state (selected provider or summary sub-filter)
                    if (summarySelected) {
                        restoreSummaryFromPreview();
                    } else if (selectedAs) {
                        restoreProviderFromPreview();
                    }
                    // Restore donut center display
                    if (donutFocused) {
                        if (insightRectVisible) {
                            restoreInsightRectProvider();
                        } else if (subFilterCategory && subFilterCategory.indexOf('conn-') === 0 && subFilterLabel) {
                            // Restore donut to show the provider (keep expanded)
                            showFocusedCenterText(subFilterLabel);
                            animateDonutExpand(subFilterLabel);
                        } else if (selectedAs) {
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
                if (subTooltipPinned || subSubTooltipPinned) {
                    hideSubTooltip();
                    hideSubSubTooltip();
                    if (summarySelected) {
                        subFilterPeerIds = null;
                        subFilterLabel = null;
                        subFilterCategory = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        activateHoverAll();
                        var rows = bodyEl.querySelectorAll('.sub-filter-active');
                        for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
                    } else if (selectedAs) {
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
                    if (subTooltipPinned || peerDetailActive) return;
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var category = rowEl.dataset.category;
                    var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                    var html = buildPeerSummaryHtml(peerIds, category, label);
                    showSubTooltip(html, e);
                    // Preview lines/filter for hovered sub-row
                    previewProviderLines(peerIds);
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (!subTooltipPinned) positionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (subTooltipPinned || peerDetailActive) return;
                    hideSubTooltip();
                    restoreProviderFromPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var category = rowEl.dataset.category;
                    var label = rowEl.querySelector('.as-detail-sub-label').textContent;
                    // Toggle: clicking same row unpins
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
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
        subTooltipPinned = false;
        pinnedSubTooltipSrc = null;
        hideSubSubTooltip();
    }

    /** Pin the sub-tooltip and remember the element that opened it. */
    function pinSubTooltip(srcEl) {
        subTooltipPinned = true;
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
        subSubTooltipPinned = false;
        subSubFilterPeerIds = null;
        subSubFilterAsNum = null;
        subSubFilterColor = null;
        // Clear provider row selection highlight in the sub-tooltip
        var subTip = document.getElementById('as-sub-tooltip');
        if (subTip) {
            var prevSel = subTip.querySelectorAll('.as-provider-row-selected');
            for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
        }
        // Clear legend focus when sub-sub dismisses
        if (legendFocusAs) {
            legendFocusAs = null;
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
        summaryPreviewPeerIds = null;
        summaryPreviewLabel = null;
        if (!donutFocused) return;
        if (subSubFilterAsNum && subSubTooltipPinned) {
            // A Level 3 provider is selected (sub-sub pinned) — keep donut on that provider
            showFocusedCenterText(subSubFilterAsNum);
            animateDonutExpand(subSubFilterAsNum);
        } else if (insightActiveAsNum) {
            // An insight is active (Most Stable, Fastest, etc.) — keep donut on that provider
            if (insightRectVisible) {
                restoreInsightRectProvider();
            }
            showFocusedCenterText(insightActiveAsNum);
            animateDonutExpand(insightActiveAsNum);
        } else if (subFilterCategory && subFilterCategory.indexOf('conn-') === 0 && subFilterLabel) {
            // A conn-provider/conn-out/conn-in sub-filter is active — keep donut on that
            showFocusedCenterText(subFilterLabel);
            animateDonutExpand(subFilterLabel);
        } else if (subFilterPeerIds && subFilterLabel && subFilterCategory === 'summary') {
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
        if (selectedAs && _drawLinesForAs) {
            var color = getColorForActiveEntity(selectedAs);
            _drawLinesForAs(selectedAs, peerIds, color);
        }
    }

    /** Preview category info in the donut center during hover (focused mode only).
     *  Shows the category label, peer count, and percentage without changing state. */
    function previewSummaryCenterText(peerIds, label) {
        if (!donutFocused || !donutCenter) return;
        summaryPreviewPeerIds = peerIds;
        summaryPreviewLabel = label;
        var distributionEl = donutCenter.querySelector('.as-score-distribution');
        var headingEl = donutCenter.querySelector('.as-score-heading');
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var qualityEl = donutCenter.querySelector('.as-score-quality');
        var scoreLbl = donutCenter.querySelector('.as-score-label');

        if (distributionEl) { distributionEl.style.display = 'none'; }
        if (headingEl) {
            headingEl.textContent = peerIds.length + ' PEER' + (peerIds.length !== 1 ? 'S' : '');
            headingEl.style.color = 'var(--accent)';
            headingEl.style.display = '';
        }
        if (scoreVal) {
            scoreVal.textContent = label;
            scoreVal.className = 'as-score-value as-selected-mode';
            scoreVal.style.color = 'var(--text-primary)';
            scoreVal.title = label + ' \u2014 ' + peerIds.length + ' peers';
        }
        if (qualityEl) {
            var pctOfTotal = totalPeers > 0 ? ((peerIds.length / totalPeers) * 100).toFixed(1) : '0.0';
            qualityEl.textContent = pctOfTotal + '% of peers';
            qualityEl.className = 'as-score-quality';
            qualityEl.style.color = 'var(--text-secondary)';
        }
        if (scoreLbl) {
            scoreLbl.textContent = '';
            scoreLbl.className = 'as-score-label';
        }
    }

    /** Restore lines/filter/dim after a hover preview ends (summary mode) */
    function restoreSummaryFromPreview() {
        // Don't restore if big peer popup is active — it manages its own line state
        if (peerDetailActive) return;
        if (subSubFilterPeerIds && subSubFilterAsNum) {
            // Was showing sub-sub (e.g. a specific provider within a category)
            var ssColor = subSubFilterColor || getColorForAsNum(subSubFilterAsNum);
            if (_drawLinesForAs) _drawLinesForAs(subSubFilterAsNum, subSubFilterPeerIds, ssColor);
            if (_filterPeerTable) _filterPeerTable(subSubFilterPeerIds);
            if (_dimMapPeers) _dimMapPeers(subSubFilterPeerIds);
        } else if (subFilterPeerIds && subFilterPeerIds.length > 0) {
            // Was showing a category filter (e.g. IPv6)
            previewSummaryLines(subFilterPeerIds);
        } else if (subTooltipPinned && (subFilterCategory === 'insight-fastest' || (subFilterCategory && subFilterCategory.indexOf('insight-data-') === 0))) {
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
                    if (donutFocused && asNum && insightRectVisible) {
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
            if (donutFocused && insightRectVisible) {
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
        if (subFilterPeerIds && subFilterPeerIds.length > 0) {
            previewProviderLines(subFilterPeerIds);
        } else if (selectedAs) {
            var allPeerIds = getPeerIdsForActiveEntity(selectedAs);
            var color = getColorForActiveEntity(selectedAs);
            if (_filterPeerTable) _filterPeerTable(allPeerIds);
            if (_dimMapPeers) _dimMapPeers(allPeerIds);
            if (_drawLinesForAs) _drawLinesForAs(selectedAs, allPeerIds, color);
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
                    if (subTooltipPinned || peerDetailActive) return;
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
                    if (!subTooltipPinned) positionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (subTooltipPinned || peerDetailActive) return;
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
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
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
                    if (peerDetailActive || subSubTooltipPinned) return;
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
                    if (peerDetailActive || subSubTooltipPinned) return;
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
                    legendFocusAs = asNum;
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
                    subSubTooltipPinned = true;

                    // Track sub-sub state for data refresh preservation
                    subSubFilterPeerIds = peerIds;
                    subSubFilterAsNum = asNum;
                    subSubFilterColor = getColorForAsNum(asNum);

                    // Draw lines for just this provider's peers
                    if (_drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, subSubFilterColor);
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
                    if (subTooltipPinned || peerDetailActive) return;
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
                    if (subTooltipPinned || peerDetailActive) return;
                    clearLegendFocus();
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                    restoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (peerDetailActive) closePeerPopup();
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
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
                    subFilterPeerIds = peerIds;
                    subFilterCategory = 'conn-provider';
                    subFilterLabel = asNum || '';
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
                    if (subTooltipPinned || peerDetailActive) return;
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
                    if (subTooltipPinned || peerDetailActive) return;
                    clearLegendFocus();
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                    restoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
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
                    subFilterPeerIds = peerIds;
                    subFilterCategory = 'conn-out';
                    subFilterLabel = rowEl.dataset.as || '';
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
                    if (subTooltipPinned || peerDetailActive) return;
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
                    if (subTooltipPinned || peerDetailActive) return;
                    clearLegendFocus();
                    hideSubTooltip();
                    restoreSummaryFromPreview();
                    restoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
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
                    subFilterPeerIds = peerIds;
                    subFilterCategory = 'conn-in';
                    subFilterLabel = rowEl.dataset.as || '';
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
                    if (subTooltipPinned || peerDetailActive) return;
                    var peerIds = JSON.parse(rowEl.dataset.peerIds);
                    var providers = JSON.parse(rowEl.dataset.providers);
                    var html = buildProviderListHtml(providers, 'Others', 'Others');
                    showSubTooltip(html, e);
                    previewSummaryLines(peerIds);
                    previewSummaryCenterText(peerIds, 'Others');
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (!subTooltipPinned) positionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (subTooltipPinned || peerDetailActive) return;
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
                    if (subTooltipPinned && pinnedSubTooltipSrc === rowEl) {
                        hideSubTooltip();
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
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
                    subFilterPeerIds = peerIds;
                    subFilterCategory = 'conn-others';
                    subFilterLabel = 'Others';

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
                    if (subTooltipPinned || peerDetailActive) return;
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
                    if (subTooltipPinned || peerDetailActive) return;
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
                    if (subTooltipPinned && pinnedSubTooltipSrc === el) {
                        hideSubTooltip();
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
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
                    subFilterPeerIds = [];
                    subFilterCategory = 'all-providers';
                    subFilterLabel = 'all-providers';
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
                        if (subTooltipPinned && pinnedSubTooltipSrc === el) {
                            hideSubTooltip();
                            subFilterPeerIds = null;
                            subFilterCategory = null;
                            subFilterLabel = null;
                            if (_filterPeerTable) _filterPeerTable(null);
                            if (_dimMapPeers) _dimMapPeers(null);
                            if (summarySelected) activateHoverAll();
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
                        subFilterPeerIds = [];
                        subFilterCategory = 'all-providers';
                        subFilterLabel = 'all-providers';
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
                if (subTooltipPinned || peerDetailActive) return;
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
                if (subTooltipPinned || peerDetailActive) return;
                clearLegendFocus();
                hideSubTooltip();
                hideInsightRect();
                restoreSummaryFromPreview();
                restoreDonutAfterPreview();
            });
            fastestLink.addEventListener('click', function (e) {
                e.stopPropagation();
                if (peerDetailActive) closePeerPopup();
                if (subTooltipPinned && pinnedSubTooltipSrc === fastestLink) {
                    hideSubTooltip();
                    fastestLink.closest('.as-summary-insight').classList.remove('sub-filter-active');
                    subFilterPeerIds = null;
                    subFilterCategory = null;
                    subFilterLabel = null;
                    insightActiveAsNum = null; insightActiveData = null;
                    insightActiveType = null;
                    hideInsightRect();
                    if (donutFocused) animateDonutRevert();
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (summarySelected) activateHoverAll();
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
                subFilterPeerIds = [];
                subFilterCategory = 'insight-fastest';
                subFilterLabel = 'fastest';
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
                if (subTooltipPinned || peerDetailActive) return;
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
                if (subTooltipPinned || peerDetailActive) return;
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
                if (subTooltipPinned && pinnedSubTooltipSrc === stableLink) {
                    hideSubTooltip();
                    stableLink.closest('.as-summary-insight').classList.remove('sub-filter-active');
                    subFilterPeerIds = null;
                    subFilterCategory = null;
                    subFilterLabel = null;
                    insightActiveAsNum = null; insightActiveData = null;
                    insightActiveType = null;
                    hideInsightRect();
                    if (donutFocused) animateDonutRevert();
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (summarySelected) activateHoverAll();
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
                subFilterPeerIds = result.peerIds;
                subFilterCategory = 'insight-stable';
                subFilterLabel = result.asNum;
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
                    if (subTooltipPinned || peerDetailActive) return;
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
                    if (subTooltipPinned || peerDetailActive) return;
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
                    if (subTooltipPinned && pinnedSubTooltipSrc === el) {
                        hideSubTooltip();
                        el.closest('.as-summary-insight').classList.remove('sub-filter-active');
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
                        insightActiveAsNum = null; insightActiveData = null;
                        insightActiveType = null;
                        hideInsightRect();
                        if (donutFocused) animateDonutRevert();
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (summarySelected) activateHoverAll();
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
                    subFilterPeerIds = [];
                    subFilterCategory = 'insight-data-' + field;
                    subFilterLabel = field;
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
                    if (peerDetailActive || subSubTooltipPinned) return;
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
                    if (donutFocused && asNum && insightRectVisible) {
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
                    if (peerDetailActive || subSubTooltipPinned) return;
                    // On leave, restore to the pinned insight provider
                    if (insightRectVisible) {
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
                    legendFocusAs = asNum;
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
                    subSubTooltipPinned = true;

                    // Track sub-sub state for data refresh preservation
                    subSubFilterPeerIds = peerIds;
                    subSubFilterAsNum = asNum;
                    subSubFilterColor = getColorForAsNum(asNum);

                    if (_drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, subSubFilterColor);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);

                    // Update insight rect to show selected provider
                    if (donutFocused && insightRectVisible) {
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
                    if (peerDetailActive || subSubTooltipPinned) return;
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
                    if (donutFocused && asNum && insightRectVisible) {
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
                    if (peerDetailActive || subSubTooltipPinned) return;
                    // On leave, restore to the pinned insight provider
                    if (insightRectVisible) {
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
                    legendFocusAs = asNum;
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
                    subSubTooltipPinned = true;

                    // Track sub-sub state for data refresh preservation
                    subSubFilterPeerIds = peerIds;
                    subSubFilterAsNum = asNum;
                    subSubFilterColor = getColorForAsNum(asNum);

                    // Draw lines for this provider's peers
                    if (_drawLinesForAs && asNum) {
                        _drawLinesForAs(asNum, peerIds, subSubFilterColor);
                    }
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);

                    // Update insight rect to show selected data provider
                    if (donutFocused && insightRectVisible) {
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
        if (subFilterPeerIds && label === subFilterLabel) {
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
        subFilterPeerIds = peerIds;
        subFilterCategory = 'summary';
        subFilterLabel = label;
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
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        insightActiveAsNum = null; insightActiveData = null;
        insightActiveType = null;
        hideSubTooltip();
        hideInsightRect();
        // Restore to showing all peers
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        // Re-draw all lines
        if (summarySelected) activateHoverAll();
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
        if (subFilterCategory === 'summary' && subFilterLabel) {
            var rows = bodyEl.querySelectorAll('.as-summary-row');
            for (var ri = 0; ri < rows.length; ri++) {
                if (rows[ri].dataset.catLabel === subFilterLabel) {
                    rows[ri].classList.add('sub-filter-active');
                }
            }
        }
        // Re-apply highlight to matching grid rows (conn-provider, conn-out, conn-in)
        if (subFilterCategory && subFilterCategory.indexOf('conn-') === 0 && subFilterLabel) {
            var gridSelector = subFilterCategory === 'conn-provider' ? '.as-conn-prov-row'
                : subFilterCategory === 'conn-out' ? '.as-conn-out-row'
                : subFilterCategory === 'conn-others' ? '.as-conn-others-row'
                : '.as-conn-dir-row';
            var gridRows = bodyEl.querySelectorAll(gridSelector);
            for (var gi = 0; gi < gridRows.length; gi++) {
                if (gridRows[gi].dataset.as === subFilterLabel) {
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
        if (selectedAs) deselect();
        summarySelected = true;
        hoveredAll = false;

        // Draw all lines (persistent)
        activateHoverAll();

        // Open the summary panel
        openLensSummaryPanel();

        // Update donut center to show SUMMARY ANALYSIS as active
        renderCenter();
    }

    /** Deselect the Summary Analysis view */
    function deselectSummary() {
        if (!summarySelected) return;
        summarySelected = false;
        panelHistory = [];
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
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

        if (summarySelected) {
            panelHistory.push({ type: 'summary', scrollTop: scrollTop });
            summarySelected = false;
        } else if (selectedAs) {
            panelHistory.push({ type: 'provider', asNumber: selectedAs, scrollTop: scrollTop });
        }

        // Clear sub-filters and tooltips
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        hideSubTooltip();
        hideSubSubTooltip();

        // Navigate to provider panel
        selectedAs = asNum;
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
        activeNetworkPanel = null;
        peerDetailActive = false;
        selectedAs = null;
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        insightActiveAsNum = null; insightActiveData = null;
        insightActiveType = null;
        panelHistory = [];
        hideSubTooltip();
        hideSubSubTooltip();
        hideInsightRect();

        if (donutFocused) {
            summarySelected = true;
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
        if (panelHistory.length > 0) {
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
        if (activeNetworkPanel) {
            activeNetworkPanel = null;
            selectedAs = null;
            // If sub-tooltips are open, close those first
            if (subTooltipPinned || subSubTooltipPinned) {
                hideSubTooltip();
                hideSubSubTooltip();
                subFilterPeerIds = null;
                subFilterLabel = null;
                subFilterCategory = null;
            }
            // Return to summary view
            summarySelected = true;
            panelHistory = [];
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
        if (subTooltipPinned || subSubTooltipPinned) {
            hideSubTooltip();
            hideSubSubTooltip();
            // Restore to main state (summary or single AS)
            if (summarySelected) {
                subFilterPeerIds = null;
                subFilterLabel = null;
                subFilterCategory = null;
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
            } else if (selectedAs) {
                clearSubFilter();
            }
            return true; // handled — don't close main panel
        }

        // Stage 2: If in a provider view, go back to summary
        if (selectedAs) {
            if (donutFocused) {
                // In focused mode, go back to summary instead of closing
                if (othersListOpen) closeOthersListInDonut();
                panelHistory = [];
                selectedAs = null;
                hoveredAs = null;
                animateDonutRevert();
                renderCenter();
                renderLegend();
                selectSummary();
                return true;
            }
            panelHistory = [];
            deselect();
            return true;
        }

        // Stage 3: Close summary / exit focused mode
        if (summarySelected) {
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
        if (subFilterPeerIds && category === subFilterCategory && label === subFilterLabel) {
            // Clicking the same filter — toggle off
            clearSubFilter();
            return;
        }
        subFilterPeerIds = peerIds;
        subFilterCategory = category || null;
        subFilterLabel = label || null;
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);

        // Draw lines for sub-filtered peers
        var seg = selectedAs ? findActiveSegment(selectedAs) : null;
        if (!seg && selectedAs) {
            var grp = findActiveGroup(selectedAs);
            if (grp) {
                var othersSeg = getActiveSegments().find(function (s) { return s.isOthers; });
                seg = { asNumber: selectedAs, peerIds: grp.peerIds, color: othersSeg ? othersSeg.color : '#58a6ff' };
            }
        }
        if (seg && _drawLinesForAs) {
            _drawLinesForAs(selectedAs, peerIds, seg.color);
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
            if (subFilterCategory && subFilterLabel
                && rows[ri].dataset.category === subFilterCategory
                && rows[ri].querySelector('.as-detail-sub-label').textContent === subFilterLabel) {
                rows[ri].classList.add('sub-filter-active');
            } else {
                rows[ri].classList.remove('sub-filter-active');
            }
        }
    }

    /** Clear the sub-filter (restore to full AS selection) */
    function clearSubFilter() {
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        hideSubTooltip();
        // Restore to full AS filter
        if (selectedAs) {
            var seg = findActiveSegment(selectedAs);
            if (!seg) {
                var grp = findActiveGroup(selectedAs);
                if (grp) {
                    var othersSeg = getActiveSegments().find(function (s) { return s.isOthers; });
                    seg = { asNumber: selectedAs, peerIds: grp.peerIds, color: othersSeg ? othersSeg.color : '#58a6ff' };
                }
            }
            if (seg) {
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
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
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        hideSubTooltip();
        // Select the Others segment
        selectedAs = 'Others';
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

    /** Attach click handler to the "← Others" back link in donut center */
    function attachOthersBackHandler() {
        if (!donutCenter) return;
        var backLink = donutCenter.querySelector('.as-others-back-link');
        if (backLink) {
            backLink.addEventListener('click', function (e) {
                e.stopPropagation();
                backToOthersList();
            });
        }
    }

    /** Show provider name in donut center during focused mode hover.
     *  Handles multi-line display for long names with dashes. */
    function showFocusedCenterText(asNum) {
        if (!donutCenter) return;
        var seg = findActiveSegmentOrGroup(asNum);
        if (!seg) return;

        var distributionEl = donutCenter.querySelector('.as-score-distribution');
        var headingEl = donutCenter.querySelector('.as-score-heading');
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var qualityEl = donutCenter.querySelector('.as-score-quality');
        var scoreLbl = donutCenter.querySelector('.as-score-label');

        // Show "← Others" back link for sub-providers, else "ISP" label
        var isSubProv = isOthersSubProvider(asNum);
        if (distributionEl) {
            if (isSubProv) {
                distributionEl.innerHTML = '<span class="as-others-back-link">\u2190 Others</span>';
                distributionEl.style.color = '';
            } else {
                distributionEl.textContent = seg.isOthers ? 'Bucket:' : getActiveEntityKind();
                distributionEl.style.color = 'var(--logo-primary)';
            }
            distributionEl.style.display = '';
        }

        // Hide the heading row — peer count moves to bottom label
        if (headingEl) {
            headingEl.textContent = '';
            headingEl.style.display = 'none';
        }

        // Build display name — smart line-breaking for names with dashes
        var name = seg.isOthers ? 'Others' : (seg.asShort || seg.asName || seg.asNumber);
        var displayLines = formatNameForDonut(name);

        if (scoreVal) {
            scoreVal.textContent = displayLines;
            scoreVal.className = 'as-score-value as-focused-provider';
            scoreVal.style.color = seg.color;
            scoreVal.title = (seg.asName || seg.asNumber) + '\n' + seg.peerCount + ' peers (' + seg.percentage.toFixed(1) + '%)';
        }
        if (qualityEl) {
            qualityEl.textContent = seg.asNumber === 'Others' ? (seg.asName || '') : (isCountryLens() ? (seg.countryCode || '') : seg.asNumber);
            qualityEl.className = 'as-score-quality';
            qualityEl.style.color = seg.color;
        }
        if (scoreLbl) {
            scoreLbl.textContent = seg.peerCount + ' PEER' + (seg.peerCount !== 1 ? 'S' : '');
            scoreLbl.className = 'as-score-label as-provider-peers';
            scoreLbl.style.color = '';
        }
        attachOthersBackHandler();
    }

    /** Show provider info in donut center when hovering a segment with legends hidden.
     *  Displays: Rank #N / ISP / PROVIDER-NAME / AS12345 / 16 PEERS
     *  Uses title-matching font (Cinzel 15px uppercase) to stay inside donut hole. */
    function showLegendHoverCenterText(asNum) {
        if (!donutCenter) return;
        var seg = findActiveSegment(asNum);
        if (!seg) return;

        // Disable pointer-events on center so it doesn't steal hover from segments
        donutCenter.classList.add('legend-hover-active');

        // Determine rank (1-based position in donutSegments, excluding Others)
        var rank = 0;
        var segments = getActiveSegments();
        for (var i = 0; i < segments.length; i++) {
            if (!segments[i].isOthers) {
                rank++;
                if (segments[i].asNumber === asNum) break;
            }
        }

        var distributionEl = donutCenter.querySelector('.as-score-distribution');
        var headingEl = donutCenter.querySelector('.as-score-heading');
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var qualityEl = donutCenter.querySelector('.as-score-quality');
        var scoreLbl = donutCenter.querySelector('.as-score-label');

        // Top line: "Rank #N" or "Bucket:" for Others
        if (distributionEl) {
            if (seg.isOthers) {
                distributionEl.textContent = 'Bucket:';
            } else {
                distributionEl.textContent = 'Rank #' + rank;
            }
            distributionEl.style.color = '#d4a017';
            distributionEl.style.display = '';
        }

        // Second line: "ISP" label
        if (headingEl) {
            headingEl.textContent = seg.isOthers ? '' : getActiveEntityKind();
            headingEl.style.color = 'var(--logo-primary)';
            headingEl.style.display = seg.isOthers ? 'none' : '';
        }

        // Provider name — title-matching font, smart line-breaking
        var name = seg.isOthers ? 'Others' : (seg.asShort || seg.asName || seg.asNumber);
        var displayLines = formatNameForDonut(name);
        if (scoreVal) {
            scoreVal.textContent = displayLines;
            scoreVal.className = 'as-score-value as-legend-hover-provider';
            scoreVal.style.color = seg.color;
            scoreVal.title = (seg.asName || seg.asNumber) + '\n' + seg.peerCount + ' peers (' + seg.percentage.toFixed(1) + '%)';
        }

        // AS number
        if (qualityEl) {
            qualityEl.textContent = seg.asNumber === 'Others' ? (seg.asName || '') : (isCountryLens() ? (seg.countryCode || '') : seg.asNumber);
            qualityEl.className = 'as-score-quality';
            qualityEl.style.color = seg.color;
        }

        // Peer count
        if (scoreLbl) {
            scoreLbl.textContent = seg.peerCount + ' PEER' + (seg.peerCount !== 1 ? 'S' : '');
            scoreLbl.className = 'as-score-label as-provider-peers';
            scoreLbl.style.color = '';
        }
    }

    /** Remove the legend-hover pointer-events lock from donut center */
    function clearLegendHoverActive() {
        if (donutCenter) donutCenter.classList.remove('legend-hover-active');
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
                    if (selectedAs === 'Others') {
                        if (_drawLinesForAs) _drawLinesForAs('Others', othersSeg.peerIds, othersSeg.color);
                        if (_dimMapPeers) _dimMapPeers(othersSeg.peerIds);
                        showFocusedCenterText('Others');
                    } else if (selectedAs && isOthersSubProvider(selectedAs)) {
                        // Restore selected sub-provider's lines
                        var peerIds = getPeerIdsForAnyAs(selectedAs);
                        var color = getColorForAsNum(selectedAs);
                        if (_drawLinesForAs) _drawLinesForAs(selectedAs, peerIds, color);
                        if (_dimMapPeers) _dimMapPeers(peerIds);
                        showFocusedCenterText(selectedAs);
                    } else {
                        activateHoverAll();
                        if (_dimMapPeers) _dimMapPeers(null);
                        renderCenter();
                    }
                });

                // Click: toggle or navigate to this provider's panel
                item.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (selectedAs === g.asNumber) {
                        // Toggle off — go back to Others list
                        backToOthersList();
                    } else {
                        if (isCountryLens()) {
                            selectedAs = g.asNumber;
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
        if (donutWrapEl) {
            donutWrapEl.appendChild(popup);
        } else {
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
            if (items[i].dataset.as === selectedAs) {
                items[i].classList.add('as-others-popup-selected');
            } else {
                items[i].classList.remove('as-others-popup-selected');
            }
        }
    }

    /** Format a provider name to fit inside the donut center.
     *  Breaks long names at dashes or spaces. */
    function formatNameForDonut(name) {
        if (!name) return '';
        // If it fits, just return it
        if (name.length <= 12) return name;
        // Try breaking at dashes first
        if (name.indexOf('-') !== -1) {
            var parts = name.split('-');
            var lines = [];
            var current = parts[0];
            for (var i = 1; i < parts.length; i++) {
                if ((current + '-' + parts[i]).length <= 12) {
                    current += '-' + parts[i];
                } else {
                    lines.push(current);
                    current = parts[i];
                }
            }
            lines.push(current);
            return lines.join('\n');
        }
        // Try breaking at spaces
        if (name.indexOf(' ') !== -1) {
            var words = name.split(' ');
            var lines = [];
            var current = words[0];
            for (var i = 1; i < words.length; i++) {
                if ((current + ' ' + words[i]).length <= 14) {
                    current += ' ' + words[i];
                } else {
                    lines.push(current);
                    current = words[i];
                }
            }
            lines.push(current);
            return lines.join('\n');
        }
        // Last resort: just return truncated
        return name.length > 16 ? name.substring(0, 15) + '\u2026' : name;
    }

    // ═══════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════

    function onSegmentHover(e) {
        var asNum = e.currentTarget.dataset.as;
        if (!asNum) return;
        // Don't show AS hover tooltip when a sub-tooltip is pinned or peer detail is active
        if (subTooltipPinned || peerDetailActive) return;
        hoveredAs = asNum;
        // No floating tooltip — legend highlighting replaces it
        highlightLegendItem(asNum);

        // In focused mode, show provider name in donut center on hover
        if (donutFocused && !selectedAs) {
            focusedHoverAs = asNum;
            showFocusedCenterText(asNum);
        }

        // When legends are hidden (not focused), show provider info in donut center
        if (legendsHidden && !donutFocused && !selectedAs) {
            focusedHoverAs = asNum;
            showLegendHoverCenterText(asNum);
        }

        // Temporarily remove all-hovered highlight so only this segment is bright
        if ((hoveredAll || summarySelected) && containerEl) {
            containerEl.classList.remove('as-all-hovered');
        }

        // Draw hover lines if nothing is selected, or if summary is selected (temporary override)
        if (!selectedAs) {
            var seg = findActiveSegment(asNum);
            if (seg && _drawLinesForAs) {
                _drawLinesForAs(asNum, seg.peerIds, seg.color);
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
            }
        }
    }

    function onSegmentLeave() {
        if (subTooltipPinned || peerDetailActive) return;
        hoveredAs = null;
        clearLegendHighlight();

        // In focused mode, restore center text to default score display
        if (donutFocused && !selectedAs) {
            focusedHoverAs = null;
            renderCenter();
        }

        // When legends are hidden (not focused), restore default center text
        if (legendsHidden && !donutFocused && !selectedAs) {
            focusedHoverAs = null;
            clearLegendHoverActive();
            renderCenter();
        }

        // If there's an active sub-filter, restore to that instead of showing all
        if (summarySelected && subFilterPeerIds && subFilterPeerIds.length > 0 && !selectedAs) {
            restoreSummaryFromPreview();
            return;
        }

        // If hoveredAll or summarySelected is active, restore all-lines state
        if ((hoveredAll || summarySelected) && !selectedAs) {
            activateHoverAll();
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            return;
        }

        // ONLY clear lines if nothing is selected — selection keeps its lines
        if (!selectedAs) {
            if (_clearAsLines) _clearAsLines();
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
        }
    }

    /** Add highlight class to the matching legend item */
    function highlightLegendItem(asNum) {
        if (!legendEl) return;
        var items = legendEl.querySelectorAll('.as-legend-item');
        for (var i = 0; i < items.length; i++) {
            if (items[i].dataset.as === asNum) {
                items[i].classList.add('highlighted');
            } else {
                items[i].classList.add('dimmed');
            }
        }
    }

    /** Remove highlight class from all legend items */
    function clearLegendHighlight() {
        if (!legendEl) return;
        var items = legendEl.querySelectorAll('.as-legend-item');
        for (var i = 0; i < items.length; i++) {
            items[i].classList.remove('highlighted');
            items[i].classList.remove('dimmed');
        }
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
        if (selectedAs || summarySelected) return; // Don't override an active selection or summary
        hoveredAll = true;
        activateHoverAll();
    }

    function onTitleLeave() {
        if (!hoveredAll || summarySelected) return;
        hoveredAll = false;
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
        if (summarySelected) {
            deselectSummary();
        }

        if (selectedAs === asNum) {
            // Deselect — go back to summary in focused mode
            if (donutFocused) {
                if (othersListOpen) closeOthersListInDonut();
                selectedAs = null;
                subFilterPeerIds = null;
                subFilterLabel = null;
                subFilterCategory = null;
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
            subFilterPeerIds = null;
            subFilterLabel = null;
            subFilterCategory = null;
            hideSubTooltip();
            if (othersListOpen) closeOthersListInDonut();
            selectedAs = asNum;
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
        activeNetworkPanel = null;
        if (summarySelected) {
            deselectSummary();
            return;
        }
        peerDetailActive = false;
        selectedAs = null;
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        if (othersListOpen) closeOthersListInDonut();
        hideSubTooltip();
        hideInsightRect();
        closePanel();
        if (containerEl) containerEl.classList.remove('as-legend-visible');
        if (_filterPeerTable) _filterPeerTable(null);
        if (_dimMapPeers) _dimMapPeers(null);
        if (_clearAsLines) _clearAsLines();
        if (donutAnimState !== 'idle' && donutAnimState !== 'reverting') {
            animateDonutRevert();
        } else {
            renderDonut();
        }
        renderCenter();
        renderLegend();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            // Close peer popup first
            if (peerDetailActive && peerPopupEl) {
                closePeerPopup();
                return;
            }
            if (subSubTooltipPinned) {
                hideSubSubTooltip();
                // Restore to parent sub-filter state
                if (summarySelected && subFilterPeerIds && subFilterPeerIds.length > 0) {
                    if (_filterPeerTable) _filterPeerTable(subFilterPeerIds);
                    if (_dimMapPeers) _dimMapPeers(subFilterPeerIds);
                    // Re-draw lines for the parent sub-filter (not all lines)
                    if (_drawLinesForAllAs && donutSegments.length > 0) {
                        var idSet = {};
                        for (var i = 0; i < subFilterPeerIds.length; i++) idSet[subFilterPeerIds[i]] = true;
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
                } else if (summarySelected) {
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    activateHoverAll();
                }
                return;
            }
            if (subTooltipPinned) {
                hideSubTooltip();
                // Restore to full summary or AS state
                if (summarySelected) {
                    clearSummarySubFilter();
                } else if (selectedAs) {
                    clearSubFilter();
                }
                return;
            }
            // If a network panel is open, Escape goes back to summary
            if (activeNetworkPanel) {
                activeNetworkPanel = null;
                selectedAs = null;
                if (subTooltipPinned || subSubTooltipPinned) {
                    hideSubTooltip();
                    hideSubSubTooltip();
                    subFilterPeerIds = null;
                    subFilterLabel = null;
                    subFilterCategory = null;
                }
                summarySelected = true;
                panelHistory = [];
                openLensSummaryPanel();
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                activateHoverAll();
                renderDonut();
                renderCenter();
                renderLegend();
                return;
            }
            if (summarySelected) {
                if (donutFocused) {
                    exitFocusedMode();
                } else {
                    deselectSummary();
                }
                return;
            }
            if (selectedAs) {
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
        if (legendEl) {
            legendEl.style.display = '';
        }

        // Activate hover-all to show lines from donut center in focused mode
        hoveredAll = false;
        activateHoverAll();

        // Open summary panel automatically
        selectSummary();
    }

    /** Exit focused mode: everything returns to default positions */
    function exitFocusedMode() {
        if (!donutFocused) return;
        donutFocused = false;
        focusedHoverAs = null;
        peerDetailActive = false;
        activeNetworkPanel = null;
        if (othersListOpen) closeOthersListInDonut();
        document.body.classList.remove('donut-focused');

        // Revert donut animation
        stopDonutAnimation();
        hideInsightRect();

        // Deselect everything
        if (summarySelected) deselectSummary();
        else if (selectedAs) deselect();
        else closePanel(); // Network panel or other non-summary/non-AS state
        hoveredAll = false;
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
    // PEER DETAIL POPUP — Floating popup for peer info
    // ═══════════════════════════════════════════════════════════

    var peerPopupEl = null;   // Current peer popup DOM element
    var selectedPeerData = null; // Full peer object for the currently selected peer

    /** Update the peer popup header to preview a hovered peer (without rebuilding the whole popup) */
    function previewPeerInPopup(peer) {
        if (!peerPopupEl || !peerDetailActive) return;
        var nameEl = peerPopupEl.querySelector('.peer-popup-name');
        var addrEl = peerPopupEl.querySelector('.peer-popup-addr');
        var metaEl = peerPopupEl.querySelector('.peer-popup-meta');
        var circleEl = peerPopupEl.querySelector('.peer-popup-circle');
        if (!nameEl) return;
        var asNum = parseAsNumber(peer.as);
        var provColor = asNum ? getColorForAsNum(asNum) : '#6e7681';
        var netColors = { 'ipv4': '#58a6ff', 'ipv6': '#3fb950', 'onion': '#1565c0', 'tor': '#1565c0', 'i2p': '#d29922', 'cjdns': '#bc8cff' };
        var netColor = netColors[(peer.network || 'ipv4').toLowerCase()] || '#58a6ff';
        nameEl.textContent = 'Peer #' + peer.id;
        nameEl.style.color = provColor;
        if (addrEl) addrEl.textContent = peer.addr || '';
        if (metaEl) metaEl.textContent = (peer.network || 'ipv4').toUpperCase() + ' \u00b7 ' + (peer.direction === 'IN' ? 'Inbound' : 'Outbound');
        if (circleEl) circleEl.style.background = netColor;
        // Add preview indicator
        peerPopupEl.classList.add('peer-popup-previewing');
    }

    /** Restore the peer popup to the selected peer's info */
    function restorePeerPopupToSelected() {
        if (!peerPopupEl || !peerDetailActive || !selectedPeerData) return;
        var peer = selectedPeerData;
        var nameEl = peerPopupEl.querySelector('.peer-popup-name');
        var addrEl = peerPopupEl.querySelector('.peer-popup-addr');
        var metaEl = peerPopupEl.querySelector('.peer-popup-meta');
        var circleEl = peerPopupEl.querySelector('.peer-popup-circle');
        if (!nameEl) return;
        var asNum = parseAsNumber(peer.as);
        var provColor = asNum ? getColorForAsNum(asNum) : '#6e7681';
        var netColors = { 'ipv4': '#58a6ff', 'ipv6': '#3fb950', 'onion': '#1565c0', 'tor': '#1565c0', 'i2p': '#d29922', 'cjdns': '#bc8cff' };
        var netColor = netColors[(peer.network || 'ipv4').toLowerCase()] || '#58a6ff';
        nameEl.textContent = 'Peer #' + peer.id;
        nameEl.style.color = provColor;
        if (addrEl) addrEl.textContent = peer.addr || '';
        if (metaEl) metaEl.textContent = (peer.network || 'ipv4').toUpperCase() + ' \u00b7 ' + (peer.direction === 'IN' ? 'Inbound' : 'Outbound');
        if (circleEl) circleEl.style.background = netColor;
        peerPopupEl.classList.remove('peer-popup-previewing');
    }

    /** Close the peer detail popup.
     *  @param {boolean} [skipZoomReset] - if true, skip resetting map zoom (used when
     *         transitioning to another view like a donut segment, not a full close) */
    function closePeerPopup(skipZoomReset) {
        peerDetailActive = false;
        selectedPeerId = null;
        selectedPeerData = null;
        multiPeerGroupIds = null;
        if (peerPopupEl) {
            peerPopupEl.classList.remove('visible');
            setTimeout(function () {
                if (peerPopupEl && peerPopupEl.parentNode) {
                    peerPopupEl.parentNode.removeChild(peerPopupEl);
                }
                peerPopupEl = null;
            }, 200);
        }
        // Restore previous line/filter state
        if (summarySelected) {
            if (insightActiveAsNum) {
                var peerIds = getPeerIdsForAnyAs(insightActiveAsNum);
                var color = getColorForAsNum(insightActiveAsNum);
                if (_drawLinesForAs) _drawLinesForAs(insightActiveAsNum, peerIds, color);
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
            } else if (subFilterPeerIds && subFilterPeerIds.length > 0) {
                // Restore to active sub-filter (e.g. IPv6, country, etc.)
                previewSummaryLines(subFilterPeerIds);
            } else {
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                activateHoverAll();
            }
            renderCenter();
        } else if (selectedAs) {
            var seg = donutSegments.find(function (s) { return s.asNumber === selectedAs; });
            if (!seg) {
                var grp = asGroups.find(function (g) { return g.asNumber === selectedAs; });
                if (grp) {
                    var othersSeg = donutSegments.find(function (s) { return s.isOthers; });
                    seg = { asNumber: selectedAs, peerIds: grp.peerIds, color: othersSeg ? othersSeg.color : '#58a6ff' };
                }
            }
            if (seg) {
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
            }
            renderCenter();
        } else {
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            if (_clearAsLines) _clearAsLines();
            renderCenter();
        }
        // Zoom map back out when closing peer detail (unless caller says skip)
        if (!skipZoomReset && _resetMapZoom) {
            _resetMapZoom();
        } else if (skipZoomReset && _clearPeerSelection) {
            // Clear selection state without resetting zoom (navigating to another view)
            _clearPeerSelection();
        }
        // Clear selected peer highlight
        var allSelected = document.querySelectorAll('.as-sub-tt-peer-selected');
        for (var i = 0; i < allSelected.length; i++) allSelected[i].classList.remove('as-sub-tt-peer-selected');
    }

    /** Open a floating popup showing the list of peers at a multi-peer dot.
     *  Selecting a peer from this list opens the full detail with a back button. */
    function openMultiPeerPopup(peerIds) {
        // Close any existing popup
        if (peerPopupEl && peerPopupEl.parentNode) {
            peerPopupEl.parentNode.removeChild(peerPopupEl);
            peerPopupEl = null;
        }

        peerDetailActive = true;
        multiPeerGroupIds = peerIds.slice();

        // Find matching peer objects
        var peers = [];
        var idSet = {};
        for (var i = 0; i < peerIds.length; i++) idSet[peerIds[i]] = true;
        for (var i = 0; i < lastPeersRaw.length; i++) {
            if (idSet[lastPeersRaw[i].id]) peers.push(lastPeersRaw[i]);
        }

        var html = '';
        html += '<div class="peer-popup-header" style="justify-content:center">';
        html += '<div class="peer-popup-title" style="text-align:center">';
        html += '<div class="peer-popup-name">' + peers.length + ' Peers at This Location</div>';
        if (peers[0]) {
            var loc = [peers[0].city, peers[0].regionName, peers[0].country].filter(function (s) { return s; }).join(', ');
            if (loc) html += '<div class="peer-popup-addr">' + escHtml(loc) + '</div>';
        }
        html += '</div>';
        html += '</div>';

        html += '<div class="peer-popup-scroll">';
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Select a Peer</div>';
        for (var pi = 0; pi < peers.length; pi++) {
            var p = peers[pi];
            var netLabel = (p.network || 'ipv4').toUpperCase();
            var netColor = '#58a6ff';
            if (p.network === 'ipv6') netColor = '#3fb950';
            else if (p.network === 'onion' || p.network === 'tor') netColor = '#da3633';
            else if (p.network === 'i2p') netColor = '#d29922';
            else if (p.network === 'cjdns') netColor = '#bc8cff';
            html += '<div class="as-detail-sub-row multi-peer-row" data-peer-id="' + p.id + '" style="cursor:pointer; padding:4px 0; border-bottom:1px solid rgba(88,166,255,0.06)">';
            html += '<span class="as-detail-sub-label" style="min-width:40px; color:' + netColor + '">#' + p.id + '</span>';
            html += '<span class="as-detail-sub-val" style="flex:1">' + escHtml(p.addr || '') + '</span>';
            html += '<span class="as-detail-sub-label" style="font-size:9px;color:var(--text-muted)">' + netLabel + '</span>';
            html += '</div>';
        }
        html += '</div>';
        html += '</div>';

        html += '<div class="peer-popup-footer">';
        html += '<button class="peer-popup-close" style="flex:1">Close</button>';
        html += '</div>';

        var popup = document.createElement('div');
        popup.className = 'peer-detail-popup';
        popup.innerHTML = html;
        document.body.appendChild(popup);
        peerPopupEl = popup;

        requestAnimationFrame(function () { popup.classList.add('visible'); });

        popup.addEventListener('click', function (e) { e.stopPropagation(); });

        // Close button
        var closeBtn = popup.querySelector('.peer-popup-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { closePeerPopup(); });

        // Peer row clicks — open detail with back button to list
        var rows = popup.querySelectorAll('.multi-peer-row');
        for (var ri = 0; ri < rows.length; ri++) {
            (function (row) {
                row.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var peerId = parseInt(row.dataset.peerId);
                    var peer = lastPeersRaw.find(function (p) { return p.id === peerId; });
                    if (peer) {
                        openPeerDetailPanel(peer, 'map-group');
                    }
                });
            })(rows[ri]);
        }
    }

    /** Open a floating popup showing full peer detail info.
     *  Does NOT take over the right panel — the summary/provider panel stays open.
     *  @param {Object} peer — raw peer data from lastPeersRaw
     *  @param {string} source — 'peerlist' | 'map' | 'panel' | 'map-group' */
    function openPeerDetailPanel(peer, source) {
        // Close any existing peer popup
        if (peerPopupEl && peerPopupEl.parentNode) {
            peerPopupEl.parentNode.removeChild(peerPopupEl);
            peerPopupEl = null;
        }

        peerDetailActive = true;
        selectedPeerId = peer.id;
        selectedPeerData = peer;

        // Find the provider for this peer
        var asNum = parseAsNumber(peer.as);
        var asOrg = parseAsOrg(peer.as);
        var asShort = peer.asname || '';
        var provColor = asNum ? getColorForAsNum(asNum) : '#6e7681';

        // Determine network color
        var netColors = {
            'ipv4': 'var(--net-ipv4, #58a6ff)',
            'ipv6': 'var(--net-ipv6, #3fb950)',
            'onion': 'var(--net-tor, #1565c0)',
            'tor': 'var(--net-tor, #1565c0)',
            'i2p': 'var(--net-i2p, #d29922)',
            'cjdns': 'var(--net-cjdns, #bc8cff)'
        };
        var netColor = netColors[(peer.network || 'ipv4').toLowerCase()] || 'var(--accent, #58a6ff)';
        var netLabelMap = { 'ipv4': 'IPv4', 'ipv6': 'IPv6', 'onion': 'Tor', 'tor': 'Tor', 'i2p': 'I2P', 'cjdns': 'CJDNS' };
        var netLabel = netLabelMap[(peer.network || 'ipv4').toLowerCase()] || (peer.network || 'IPv4').toUpperCase();

        // Enter focused mode if not already (for line drawing)
        if (!donutFocused) {
            donutFocused = true;
            document.body.classList.add('donut-focused');
            if (!summarySelected && !selectedAs) {
                selectSummary();
            }
            // Re-assert peer detail state after focused mode transition.
            // selectSummary() → openSummaryPanel() → closePeerPopup() clears
            // peerDetailActive/selectedPeerId/selectedPeerData during the cascade.
            // Without this, the next update() cycle won't early-return and will
            // re-render the donut/lines in summary-all mode, losing peer focus.
            peerDetailActive = true;
            selectedPeerId = peer.id;
            selectedPeerData = peer;
        }

        // Draw a single line to this peer
        if (_drawLinesForAs && asNum) {
            _drawLinesForAs(asNum, [peer.id], provColor);
        }
        if (_filterPeerTable) _filterPeerTable([peer.id]);
        if (_dimMapPeers) _dimMapPeers([peer.id]);

        // Show peer in donut center
        showPeerInDonutCenter(peer, provColor);

        // Build popup HTML
        var hasBackNav = (source === 'map-group' && multiPeerGroupIds);
        var html = '';
        html += '<div class="peer-popup-badge" style="border-color:' + netColor + ';color:' + netColor + '">' + netLabel + '</div>';
        html += '<div class="peer-popup-header">';
        if (hasBackNav) {
            html += '<span class="peer-popup-back" style="cursor:pointer;color:var(--accent);font-size:11px;font-weight:600;margin-right:4px">\u2190 List</span>';
        }
        html += '<div class="peer-popup-circle" style="background:' + netColor + '"></div>';
        html += '<div class="peer-popup-title">';
        html += '<div class="peer-popup-name" style="color:' + provColor + '">Peer #' + peer.id + '</div>';
        html += '<div class="peer-popup-addr">' + escHtml(peer.addr || '') + '</div>';
        html += '<div class="peer-popup-meta">' + (peer.network || 'ipv4').toUpperCase() + ' \u00b7 ' + (peer.direction === 'IN' ? 'Inbound' : 'Outbound') + '</div>';
        html += '</div>';
        html += '</div>';

        html += '<div class="peer-popup-scroll">';

        // Identity section
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Identity</div>';
        html += peerDetailRow('Peer ID', '#' + peer.id);
        html += peerDetailRow('Address', peer.addr || '\u2014');
        html += peerDetailRow('Network', (peer.network || 'ipv4').toUpperCase());
        html += peerDetailRow('Direction', peer.direction === 'IN' ? 'Inbound' : 'Outbound');
        html += peerDetailRow('Conn Type', CONN_TYPE_FULL[peer.connection_type] || peer.connection_type || '\u2014');
        if (peer.addrlocal) html += peerDetailRow('Your Addr', peer.addrlocal);
        html += '</div>';

        // Performance section
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Performance</div>';
        html += peerDetailRow('Ping', peer.ping_ms ? peer.ping_ms + ' ms' : '\u2014');
        html += peerDetailRow('Min Ping', peer.minping ? (peer.minping * 1000).toFixed(1) + ' ms' : '\u2014');
        html += peerDetailRow('Connected', peer.conntime_fmt || fmtDuration(peer.conntime ? (Math.floor(Date.now() / 1000) - peer.conntime) : 0));
        html += peerDetailRow('Last Send', peer.lastsend ? fmtDuration(Math.floor(Date.now() / 1000) - peer.lastsend) + ' ago' : '\u2014');
        html += peerDetailRow('Last Recv', peer.lastrecv ? fmtDuration(Math.floor(Date.now() / 1000) - peer.lastrecv) + ' ago' : '\u2014');
        html += peerDetailRow('Last Block', peer.last_block ? fmtDuration(Math.floor(Date.now() / 1000) - peer.last_block) + ' ago' : '\u2014');
        html += peerDetailRow('Last Tx', peer.last_transaction ? fmtDuration(Math.floor(Date.now() / 1000) - peer.last_transaction) + ' ago' : '\u2014');
        html += peerDetailRow('Bytes Sent', peer.bytessent_fmt || fmtBytes(peer.bytessent));
        html += peerDetailRow('Bytes Recv', peer.bytesrecv_fmt || fmtBytes(peer.bytesrecv));
        html += peerDetailRow('Time Offset', peer.timeoffset != null ? (peer.timeoffset === 0 ? '0s (synced)' : peer.timeoffset + 's') : '\u2014');
        html += '</div>';

        // Software section
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Software</div>';
        html += peerDetailRow('Version', peer.subver || '\u2014');
        html += peerDetailRow('Protocol', peer.version || '\u2014');
        html += peerDetailRow('Services', renderServiceFlagList(peer.services_abbrev || ''), true);
        html += peerDetailRow('Start Height', peer.startingheight || '\u2014');
        html += peerDetailRow('Synced Hdrs', peer.synced_headers || '\u2014');
        html += peerDetailRow('Synced Blks', peer.synced_blocks || '\u2014');
        if (peer.transport_protocol_type) html += peerDetailRow('Transport', peer.transport_protocol_type === 'v2' ? 'v2 (BIP324 encrypted)' : peer.transport_protocol_type);
        if (peer.session_id) html += peerDetailRow('Session ID', '<span style="font-size:9px;word-break:break-all">' + escHtml(peer.session_id) + '</span>', true);
        if (peer.minfeefilter != null) html += peerDetailRow('Min Fee Filter', peer.minfeefilter > 0 ? (peer.minfeefilter * 100000000).toFixed(0) + ' sat/kvB' : 'None');
        html += '</div>';

        // Location section
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Location</div>';
        html += peerDetailRow('Country', peer.country || '\u2014');
        html += peerDetailRow('Region', peer.regionName || '\u2014');
        html += peerDetailRow('City', peer.city || '\u2014');
        html += peerDetailRow('ISP', peer.isp || '\u2014');
        html += peerDetailRow('AS', asNum ? (asNum + ' ' + (asOrg || asShort || '')) : '\u2014');
        if (peer.mapped_as) html += peerDetailRow('Mapped AS', 'AS' + peer.mapped_as);
        html += '</div>';

        // Status section
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Status</div>';
        html += peerDetailRow('Relay Txs', peer.relaytxes != null ? (peer.relaytxes ? 'Yes' : 'No') : '\u2014');
        html += peerDetailRow('Addrman', peer.in_addrman ? 'Yes' : 'No');
        html += peerDetailRow('Addr Relay', peer.addr_relay_enabled != null ? (peer.addr_relay_enabled ? 'Yes' : 'No') : '\u2014');
        if (peer.addr_processed || peer.addr_rate_limited) html += peerDetailRow('Addr Stats', (peer.addr_processed || 0) + ' processed, ' + (peer.addr_rate_limited || 0) + ' limited');
        var hbParts = [];
        if (peer.bip152_hb_from) hbParts.push('From: Yes');
        if (peer.bip152_hb_to) hbParts.push('To: Yes');
        html += peerDetailRow('BIP152 HB', hbParts.length > 0 ? hbParts.join(', ') : 'No');
        if (peer.permissions && peer.permissions.length > 0) html += peerDetailRow('Permissions', peer.permissions.join(', '));
        if (peer.hosting) html += peerDetailRow('Hosting', 'Cloud/Hosting');
        if (peer.proxy) html += peerDetailRow('Proxy', 'VPN/Proxy');
        if (peer.mobile) html += peerDetailRow('Mobile', 'Mobile network');
        html += '</div>';

        html += '</div>'; // end peer-popup-scroll

        // Fixed bottom buttons
        html += '<div class="peer-popup-footer">';
        html += '<button class="peer-popup-disconnect" data-peer-id="' + peer.id + '">\u2716 Disconnect</button>';
        html += '<button class="peer-popup-close">Close</button>';
        html += '</div>';
        html += '<div class="peer-popup-resize-handle"></div>';

        // Create popup element
        var popup = document.createElement('div');
        popup.className = 'peer-detail-popup';
        popup.style.borderColor = netColor;
        popup.innerHTML = html;
        document.body.appendChild(popup);
        peerPopupEl = popup;

        // Animate in
        requestAnimationFrame(function () {
            popup.classList.add('visible');
        });

        // Prevent clicks from propagating to map
        popup.addEventListener('click', function (e) {
            e.stopPropagation();
        });

        // Make popup draggable by its header
        (function () {
            var header = popup.querySelector('.peer-popup-header');
            if (!header) return;
            header.style.cursor = 'grab';
            var isDragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
            header.addEventListener('mousedown', function (e) {
                if (e.target.closest('button, a, .peer-popup-back')) return;
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                var rect = popup.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;
                popup.classList.add('dragging');
                header.style.cursor = 'grabbing';
                e.preventDefault();
            });
            document.addEventListener('mousemove', function (e) {
                if (!isDragging) return;
                var dx = e.clientX - startX;
                var dy = e.clientY - startY;
                popup.style.left = (startLeft + dx) + 'px';
                popup.style.top = (startTop + dy) + 'px';
                popup.style.transform = 'none';
            });
            document.addEventListener('mouseup', function () {
                if (!isDragging) return;
                isDragging = false;
                popup.classList.remove('dragging');
                header.style.cursor = 'grab';
            });
        })();

        // Make popup resizable by bottom-right handle
        (function () {
            var handle = popup.querySelector('.peer-popup-resize-handle');
            if (!handle) return;
            var isResizing = false, startX, startY, startW, startH;
            handle.addEventListener('mousedown', function (e) {
                isResizing = true;
                startX = e.clientX;
                startY = e.clientY;
                var rect = popup.getBoundingClientRect();
                startW = rect.width;
                startH = rect.height;
                popup.classList.add('resizing');
                e.preventDefault();
                e.stopPropagation();
            });
            document.addEventListener('mousemove', function (e) {
                if (!isResizing) return;
                var newW = Math.max(260, startW + (e.clientX - startX));
                var newH = Math.max(200, startH + (e.clientY - startY));
                popup.style.width = newW + 'px';
                popup.style.maxHeight = 'none';
                popup.style.height = newH + 'px';
            });
            document.addEventListener('mouseup', function () {
                if (!isResizing) return;
                isResizing = false;
                popup.classList.remove('resizing');
            });
        })();

        // Bind back button (returns to multi-peer list)
        var backBtn = popup.querySelector('.peer-popup-back');
        if (backBtn) {
            backBtn.addEventListener('click', function () {
                openMultiPeerPopup(multiPeerGroupIds);
            });
        }

        // Bind close button
        var closeBtn = popup.querySelector('.peer-popup-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                closePeerPopup();
            });
        }

        // Bind disconnect button — shows Disconnect Only / Disconnect + Ban 24h / Cancel dialog
        var disconnBtn = popup.querySelector('.peer-popup-disconnect');
        if (disconnBtn) {
            disconnBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var peerId = parseInt(disconnBtn.dataset.peerId);
                if (isNaN(peerId)) return;
                var peerNet = (peer.network || 'ipv4').toLowerCase();
                var canBan = (peerNet === 'ipv4' || peerNet === 'ipv6');
                // Remove any existing dialog
                var existingDlg = document.getElementById('disconnect-dialog');
                if (existingDlg) existingDlg.remove();
                // Create the dialog overlay
                var overlay = document.createElement('div');
                overlay.id = 'disconnect-dialog';
                overlay.className = 'dialog-overlay';
                overlay.innerHTML = '<div class="dialog-box">' +
                    '<div class="dialog-title">Disconnect Peer ' + peerId + '</div>' +
                    '<div class="dialog-text">Choose an action for this peer:</div>' +
                    '<div class="dialog-actions">' +
                    '<button class="dialog-btn dialog-btn-disconnect" data-choice="disconnect">Disconnect Only</button>' +
                    (canBan ? '<button class="dialog-btn dialog-btn-ban" data-choice="ban">Disconnect + Ban 24h</button>' : '') +
                    '<button class="dialog-btn dialog-btn-cancel" data-choice="cancel">Cancel</button>' +
                    '</div></div>';
                document.body.appendChild(overlay);
                overlay.addEventListener('click', function (ev) {
                    var btn = ev.target.closest('.dialog-btn');
                    if (!btn && ev.target === overlay) { overlay.remove(); return; }
                    if (!btn) return;
                    var choice = btn.dataset.choice;
                    overlay.remove();
                    if (choice === 'cancel') return;
                    if (choice === 'ban') {
                        fetch('/api/peer/ban', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ peer_id: peerId })
                        }).then(function (r) { return r.json(); }).then(function (banData) {
                            if (!banData.success) {
                                disconnBtn.textContent = 'Ban failed: ' + (banData.error || '');
                                return;
                            }
                            fetch('/api/peer/disconnect', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ peer_id: peerId })
                            }).then(function (r) { return r.json(); }).then(function (dcData) {
                                if (dcData.success) {
                                    disconnBtn.textContent = '\u2714 Banned + Disconnected';
                                    disconnBtn.classList.add('disconnected');
                                    disconnBtn.disabled = true;
                                } else {
                                    disconnBtn.textContent = 'Banned but DC failed';
                                }
                            });
                        }).catch(function () { disconnBtn.textContent = 'Error'; });
                    } else {
                        fetch('/api/peer/disconnect', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ peer_id: peerId })
                        }).then(function (r) { return r.json(); }).then(function (data) {
                            if (data.success) {
                                disconnBtn.textContent = '\u2714 Disconnected';
                                disconnBtn.classList.add('disconnected');
                                disconnBtn.disabled = true;
                            } else {
                                disconnBtn.textContent = 'Failed: ' + (data.error || '');
                            }
                        }).catch(function () { disconnBtn.textContent = 'Error'; });
                    }
                });
            });
        }
    }

    /** Show peer ID and provider in donut center */
    function showPeerInDonutCenter(peer, color) {
        if (!donutCenter) return;
        var distributionEl = donutCenter.querySelector('.as-score-distribution');
        var headingEl = donutCenter.querySelector('.as-score-heading');
        var scoreVal = donutCenter.querySelector('.as-score-value');
        var qualityEl = donutCenter.querySelector('.as-score-quality');
        var scoreLbl = donutCenter.querySelector('.as-score-label');

        if (distributionEl) distributionEl.style.display = 'none';
        if (headingEl) {
            headingEl.textContent = 'PEER #' + peer.id;
            headingEl.style.color = color;
            headingEl.style.display = '';
        }
        if (scoreVal) {
            var provName = peer.asname || parseAsOrg(peer.as) || '';
            scoreVal.textContent = formatNameForDonut(provName);
            scoreVal.className = 'as-score-value as-focused-provider';
            scoreVal.style.color = color;
        }
        if (qualityEl) {
            qualityEl.textContent = parseAsNumber(peer.as) || '';
            qualityEl.className = 'as-score-quality';
            qualityEl.style.color = color;
        }
        if (scoreLbl) {
            scoreLbl.textContent = '';
            scoreLbl.classList.remove('as-summary-link');
        }
    }

    /** Build a simple key-value row for peer detail panel */
    function peerDetailRow(label, value, allowHtml) {
        var renderedValue = allowHtml ? value : escHtml(value);
        return '<div class="as-detail-sub-row"><span class="as-detail-sub-label">' + escHtml(label) + '</span><span class="as-detail-sub-val">' + renderedValue + '</span></div>';
    }

    /** HTML-escape untrusted values before inserting them into markup. */
    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function serviceFlagFromAbbr(abbr) {
        for (var key in SERVICE_FLAGS) {
            if (Object.prototype.hasOwnProperty.call(SERVICE_FLAGS, key) && SERVICE_FLAGS[key].abbr === abbr) {
                return SERVICE_FLAGS[key];
            }
        }
        return null;
    }

    /** Render service flag abbreviations as compact detail rows */
    function renderServiceFlagList(abbrev) {
        if (!abbrev || abbrev === '\u2014') return '\u2014';
        var flags = abbrev.split(/\s+/);
        var html = '<div class="service-flag-list">';
        for (var i = 0; i < flags.length; i++) {
            var flag = flags[i].trim();
            if (!flag) continue;
            var details = serviceFlagFromAbbr(flag);
            var label = details ? details.label : 'Unknown service flag';
            var rpc = details ? details.rpc : flag;
            var title = details ? serviceFlagDescription(details) : flag;
            html += '<div class="service-flag-row" title="' + escHtml(title) + '">'
                + '<span class="service-flag-abbr">' + escHtml(flag) + '</span>'
                + '<span class="service-flag-label">' + escHtml(label) + '</span>'
                + '<span class="service-flag-rpc">' + escHtml(rpc) + '</span>'
                + '</div>';
        }
        html += '</div>';
        return html;
    }

    // ═══════════════════════════════════════════════════════════
    // PUBLIC API — Called by app.js
    // ═══════════════════════════════════════════════════════════

    function updateLensChrome() {
        if (containerEl) {
            containerEl.dataset.lens = activeDistributionLens;
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
            var active = buttons[i].dataset.lens === activeDistributionLens;
            buttons[i].classList.toggle('active', active);
            buttons[i].setAttribute('aria-selected', active ? 'true' : 'false');
        }
    }

    function clearSelectionForLensSwitch() {
        selectedAs = null;
        hoveredAs = null;
        hoveredAll = false;
        focusedHoverAs = null;
        summarySelected = false;
        activeNetworkPanel = null;
        legendFocusAs = null;
        panelHistory = [];
        subFilterPeerIds = null;
        subFilterLabel = null;
        subFilterCategory = null;
        insightActiveAsNum = null;
        insightActiveData = null;
        insightActiveType = null;
        peerDetailActive = false;
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
        if (activeDistributionLens === lens) return;
        var wasFocused = donutFocused;
        clearSelectionForLensSwitch();
        activeDistributionLens = lens;
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
        donutWrapEl = document.getElementById('as-donut-wrap');
        donutSvg = document.getElementById('as-donut');
        donutCenter = document.getElementById('as-donut-center');
        legendEl = document.getElementById('as-legend');
        lensToggleEl = document.getElementById('as-lens-toggle');
        panelEl = document.getElementById('as-detail-panel');
        loadingEl = containerEl ? containerEl.querySelector('.as-loading') : null;
        focusedCloseBtn = document.getElementById('as-focused-close');
        insightRectEl = document.getElementById('as-insight-rect');

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
        // because donutCenter already covers it. Adding handlers on the child causes
        // lines to disappear when the mouse moves from the label to the score value
        // (child mouseleave fires while still inside the parent).
        if (donutCenter) {
            donutCenter.addEventListener('mouseenter', onTitleEnter);
            donutCenter.addEventListener('mouseleave', onTitleLeave);
            donutCenter.addEventListener('click', function (e) {
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
            if (hoveredAs && !subTooltipPinned) {
                onSegmentLeave();
            }
            if (focusedHoverAs && !selectedAs) {
                focusedHoverAs = null;
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

        // Show/hide the loading overlay
        if (loadingEl) {
            if (isGeoLoading) {
                loadingEl.textContent = 'Locating ' + pendingCount + ' peer' + (pendingCount !== 1 ? 's' : '') + '\u2026';
                loadingEl.style.display = '';
            } else if (hasRenderedOnce) {
                loadingEl.style.display = 'none';
            }
        }

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
        if (activeNetworkPanel) {
            renderDonut();
            renderCenter();
            renderLegend();
            // Update the header peer count (displayed in .as-detail-org)
            var netKey = activeNetworkPanel;
            var refreshPeers = lastPeersRaw.filter(function (p) {
                return (p.network || 'ipv4') === netKey;
            });
            var orgRefresh = panelEl ? panelEl.querySelector('.as-detail-org') : null;
            if (orgRefresh) {
                orgRefresh.textContent = refreshPeers.length + ' peer' + (refreshPeers.length !== 1 ? 's' : '') + ' connected';
            }
            // Re-apply the correct dim/filter state: if a sub-filter is active
            // (user drilled into a country/provider/etc), preserve that narrow set.
            // Otherwise dim to the full network peer list.
            if (subSubFilterPeerIds && subSubFilterPeerIds.length > 0) {
                if (_filterPeerTable) _filterPeerTable(subSubFilterPeerIds);
                if (_dimMapPeers) _dimMapPeers(subSubFilterPeerIds);
                var ssAsNum = subSubFilterAsNum;
                if (ssAsNum && _drawLinesForAs) {
                    var ssColor = subSubFilterColor || getColorForAsNum(ssAsNum);
                    _drawLinesForAs(ssAsNum, subSubFilterPeerIds, ssColor);
                }
            } else if (subFilterPeerIds && subFilterPeerIds.length > 0) {
                if (_filterPeerTable) _filterPeerTable(subFilterPeerIds);
                if (_dimMapPeers) _dimMapPeers(subFilterPeerIds);
                previewSummaryLines(subFilterPeerIds);
            } else {
                var refreshIds = refreshPeers.map(function (p) { return p.id; });
                if (_filterPeerTable) _filterPeerTable(refreshIds);
                if (_dimMapPeers) _dimMapPeers(refreshIds);
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
        // When pinned, hover listeners are still attached so legendFocusAs stays valid.
        // The persistent sub-sub check in renderLegend handles the pinned case via subSubFilterAsNum.
        if (legendFocusAs && !subTooltipPinned && !subSubTooltipPinned) {
            legendFocusAs = null;
        }
        renderLegend();

        // If a selection is active, refresh the panel + filter + keep lines
        if (selectedAs) {
            var savedCategory = subFilterCategory;
            var savedLabel = subFilterLabel;

            var seg = findActiveSegmentOrGroup(selectedAs);
            if (seg) {
                if (subTooltipPinned || subSubTooltipPinned) {
                    // Sub-tooltip is open — DON'T rebuild panel DOM or change filters.
                    // Keep current peer table filter and dim state intact so drill-down
                    // (e.g. Country > Provider > Peer) isn't disrupted by data refresh.
                    // Refresh lines/center with fresh data while preserving hover state.
                    if (savedCategory && savedLabel) {
                        var freshPeerIds = findPeerIdsByCategoryLabel(seg, savedCategory, savedLabel);
                        if (freshPeerIds && freshPeerIds.length > 0) {
                            subFilterPeerIds = freshPeerIds;
                            subFilterCategory = savedCategory;
                            subFilterLabel = savedLabel;
                        }
                    }
                    // Re-apply lines and center text (renderCenter/renderDonut already ran and reset them)
                    if (hoveredPeerId) {
                        // Peer is being hovered — preserve that peer's visual state
                        var hPeer = lastPeersRaw.find(function (p) { return p.id === hoveredPeerId; });
                        if (hPeer) {
                            var hAsNum = parseAsNumber(hPeer.as);
                            var hColor = hAsNum ? getColorForAsNum(hAsNum) : '#6e7681';
                            previewProviderLines([hoveredPeerId]);
                            if (donutFocused) showPeerInDonutCenter(hPeer, hColor);
                        }
                    } else if (subFilterPeerIds && subFilterPeerIds.length > 0) {
                        if (_drawLinesForAs) _drawLinesForAs(selectedAs, subFilterPeerIds, seg.color);
                        if (_filterPeerTable) _filterPeerTable(subFilterPeerIds);
                        if (_dimMapPeers) _dimMapPeers(subFilterPeerIds);
                        if (donutFocused) {
                            showFocusedCenterText(selectedAs);
                            animateDonutExpand(selectedAs);
                        }
                    } else {
                        if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
                        if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                        if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                        if (donutFocused) {
                            showFocusedCenterText(selectedAs);
                            animateDonutExpand(selectedAs);
                        }
                    }
                } else {
                    // No sub-tooltip pinned — safe to rebuild panel
                    // Preserve scroll position across data refresh
                    var bodyEl = panelEl ? panelEl.querySelector('.as-detail-body') : null;
                    var savedScroll = bodyEl ? bodyEl.scrollTop : 0;
                    openPanel(selectedAs);
                    if (bodyEl && savedScroll > 0) bodyEl.scrollTop = savedScroll;

                    if (savedCategory && savedLabel) {
                        var freshPeerIds = findPeerIdsByCategoryLabel(seg, savedCategory, savedLabel);
                        if (freshPeerIds && freshPeerIds.length > 0) {
                            subFilterPeerIds = freshPeerIds;
                            subFilterCategory = savedCategory;
                            subFilterLabel = savedLabel;
                            if (_filterPeerTable) _filterPeerTable(freshPeerIds);
                            if (_dimMapPeers) _dimMapPeers(freshPeerIds);
                            if (_drawLinesForAs) _drawLinesForAs(selectedAs, freshPeerIds, seg.color);
                            highlightActiveSubRow();
                        } else {
                            subFilterPeerIds = null;
                            subFilterCategory = null;
                            subFilterLabel = null;
                            hideSubTooltip();
                            if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                            if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                            if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
                        }
                    } else {
                        if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                        if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                        if (_drawLinesForAs) _drawLinesForAs(selectedAs, seg.peerIds, seg.color);
                    }
                }
            } else {
                deselect();
            }
        }

        // If summary is active, refresh — but DON'T rebuild the panel DOM if a
        // sub-tooltip is pinned (that destroys pinnedSubTooltipSrc and resets state).
        // Instead, just refresh lines/filters with fresh peer data.
        if (summarySelected) {
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
            if (subTooltipPinned || subSubTooltipPinned) {
                // Sub-tooltip is open — preserve DOM. Refresh lines/filters with fresh peer data.

                // PRIORITY 1: Sub-sub-tooltip pinned (e.g. IPv6 → Provider → Peers)
                // Draw lines only for the specific provider, not the entire category.
                if (subSubTooltipPinned && subSubFilterAsNum) {
                    var provGroup = asGroups.find(function (g) { return g.asNumber === subSubFilterAsNum; });
                    if (provGroup) {
                        var freshProvPeerIds = provGroup.peerIds;
                        // If there's a parent category filter (e.g. "IPv6"), intersect
                        if (subFilterCategory === 'summary' && subFilterLabel) {
                            var freshSumData = computeSummaryData();
                            var freshCatPeerIds = null;
                            var allCats = [freshSumData.networks, freshSumData.hosting, freshSumData.countries, freshSumData.software, freshSumData.services];
                            for (var ci = 0; ci < allCats.length; ci++) {
                                if (!allCats[ci]) continue;
                                for (var ri = 0; ri < allCats[ci].length; ri++) {
                                    if (allCats[ci][ri].label === subFilterLabel) {
                                        freshCatPeerIds = allCats[ci][ri].peerIds;
                                        break;
                                    }
                                }
                                if (freshCatPeerIds) break;
                            }
                            if (freshCatPeerIds) {
                                subFilterPeerIds = freshCatPeerIds;
                                var catSet = {};
                                for (var i = 0; i < freshCatPeerIds.length; i++) catSet[freshCatPeerIds[i]] = true;
                                freshProvPeerIds = [];
                                for (var i = 0; i < provGroup.peerIds.length; i++) {
                                    if (catSet[provGroup.peerIds[i]]) freshProvPeerIds.push(provGroup.peerIds[i]);
                                }
                            }
                        } else if (subFilterCategory === 'conn-others') {
                            // Others bucket — intersect provider with fresh Others peers
                            var othersSeg = donutSegments.find(function (s) { return s.isOthers; });
                            if (othersSeg) {
                                subFilterPeerIds = othersSeg.peerIds;
                                var othSet = {};
                                for (var i = 0; i < othersSeg.peerIds.length; i++) othSet[othersSeg.peerIds[i]] = true;
                                freshProvPeerIds = [];
                                for (var i = 0; i < provGroup.peerIds.length; i++) {
                                    if (othSet[provGroup.peerIds[i]]) freshProvPeerIds.push(provGroup.peerIds[i]);
                                }
                            }
                        }
                        subSubFilterPeerIds = freshProvPeerIds;
                        var ssColor = subSubFilterColor || getColorForAsNum(subSubFilterAsNum);
                        // If a peer is currently being hovered, preserve that single-peer view
                        if (hoveredPeerId && freshProvPeerIds.indexOf(hoveredPeerId) >= 0) {
                            if (_drawLinesForAs) _drawLinesForAs(subSubFilterAsNum, [hoveredPeerId], ssColor);
                            if (_filterPeerTable) _filterPeerTable([hoveredPeerId]);
                            if (_dimMapPeers) _dimMapPeers([hoveredPeerId]);
                            // Preserve hovered peer's center text
                            if (donutFocused) {
                                var hPeer = lastPeersRaw.find(function (p) { return p.id === hoveredPeerId; });
                                if (hPeer) showPeerInDonutCenter(hPeer, ssColor);
                            }
                        } else {
                            if (_drawLinesForAs) _drawLinesForAs(subSubFilterAsNum, freshProvPeerIds, ssColor);
                            if (_filterPeerTable) _filterPeerTable(freshProvPeerIds);
                            if (_dimMapPeers) _dimMapPeers(freshProvPeerIds);
                            // Restore center text to the selected provider
                            if (donutFocused) {
                                showFocusedCenterText(subSubFilterAsNum);
                                animateDonutExpand(subSubFilterAsNum);
                            }
                        }
                    }
                }
                // PRIORITY 2: Sub-tooltip pinned at category level (e.g. "IPv6" showing providers)
                else if (subFilterPeerIds && subFilterCategory && subFilterLabel) {
                    if (subFilterCategory === 'summary') {
                        // Standard summary category — look up fresh peer IDs
                        var freshSumData = computeSummaryData();
                        var freshPeerIds = null;
                        var allCats = [freshSumData.networks, freshSumData.hosting, freshSumData.countries, freshSumData.software, freshSumData.services];
                        for (var ci = 0; ci < allCats.length; ci++) {
                            if (!allCats[ci]) continue;
                            for (var ri = 0; ri < allCats[ci].length; ri++) {
                                if (allCats[ci][ri].label === subFilterLabel) {
                                    freshPeerIds = allCats[ci][ri].peerIds;
                                    break;
                                }
                            }
                            if (freshPeerIds) break;
                        }
                        if (freshPeerIds && freshPeerIds.length > 0) {
                            subFilterPeerIds = freshPeerIds;
                            // If a provider row is being hovered in the sub-tooltip, preserve that
                            if (legendFocusAs) {
                                var hovProvGroup = asGroups.find(function (g) { return g.asNumber === legendFocusAs; });
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
                                    var hovColor = getColorForAsNum(legendFocusAs);
                                    if (_drawLinesForAs) _drawLinesForAs(legendFocusAs, hovPeerIds, hovColor);
                                    if (_filterPeerTable) _filterPeerTable(hovPeerIds);
                                    if (_dimMapPeers) _dimMapPeers(hovPeerIds);
                                    if (donutFocused) {
                                        showFocusedCenterText(legendFocusAs);
                                        animateDonutExpand(legendFocusAs);
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
                    } else if (subFilterCategory === 'insight-stable') {
                        // "Most stable" insight — refresh by AS number stored in subFilterLabel
                        var provGroup = asGroups.find(function (g) { return g.asNumber === subFilterLabel; });
                        if (provGroup) {
                            subFilterPeerIds = provGroup.peerIds;
                            var color = getColorForAsNum(subFilterLabel);
                            if (_drawLinesForAs) _drawLinesForAs(subFilterLabel, provGroup.peerIds, color);
                            if (_filterPeerTable) _filterPeerTable(provGroup.peerIds);
                            if (_dimMapPeers) _dimMapPeers(provGroup.peerIds);
                            // Preserve insight rect state
                            insightActiveAsNum = subFilterLabel;
                            if (donutFocused && insightRectVisible) {
                                var insRectData = getInsightDataForActive();
                                if (insRectData) showInsightRect(insightActiveType, insRectData);
                            } else if (donutFocused) {
                                showFocusedCenterText(subFilterLabel);
                                animateDonutExpand(subFilterLabel);
                            }
                        }
                    } else if (subFilterCategory === 'conn-provider') {
                        // Connection by Provider row — refresh by AS number in subFilterLabel
                        var provGroup = asGroups.find(function (g) { return g.asNumber === subFilterLabel; });
                        if (provGroup) {
                            subFilterPeerIds = provGroup.peerIds;
                            var color = getColorForAsNum(subFilterLabel);
                            // If a peer is being hovered, preserve that single-peer view
                            if (hoveredPeerId && provGroup.peerIds.indexOf(hoveredPeerId) >= 0) {
                                if (_drawLinesForAs) _drawLinesForAs(subFilterLabel, [hoveredPeerId], color);
                                if (_filterPeerTable) _filterPeerTable([hoveredPeerId]);
                                if (_dimMapPeers) _dimMapPeers([hoveredPeerId]);
                                if (donutFocused) {
                                    var hPeer = lastPeersRaw.find(function (p) { return p.id === hoveredPeerId; });
                                    if (hPeer) showPeerInDonutCenter(hPeer, color);
                                }
                            } else {
                                if (_drawLinesForAs) _drawLinesForAs(subFilterLabel, provGroup.peerIds, color);
                                if (_filterPeerTable) _filterPeerTable(provGroup.peerIds);
                                if (_dimMapPeers) _dimMapPeers(provGroup.peerIds);
                                // Preserve donut state for this provider
                                if (donutFocused) {
                                    showFocusedCenterText(subFilterLabel);
                                    animateDonutExpand(subFilterLabel);
                                }
                            }
                        }
                    } else if (subFilterCategory === 'conn-out') {
                        // Outbound connection row — refresh outbound peers for the AS
                        var provGroup = asGroups.find(function (g) { return g.asNumber === subFilterLabel; });
                        if (provGroup) {
                            var outPeerIds = [];
                            for (var i = 0; i < provGroup.peers.length; i++) {
                                if (provGroup.peers[i].direction === 'outbound') outPeerIds.push(provGroup.peers[i].id);
                            }
                            subFilterPeerIds = outPeerIds;
                            if (_filterPeerTable) _filterPeerTable(outPeerIds);
                            if (_dimMapPeers) _dimMapPeers(outPeerIds);
                            // Preserve donut state for this provider
                            if (donutFocused) {
                                showFocusedCenterText(subFilterLabel);
                                animateDonutExpand(subFilterLabel);
                            }
                        }
                    } else if (subFilterCategory === 'conn-in') {
                        // Inbound connection row — refresh inbound peers for the AS
                        var provGroup = asGroups.find(function (g) { return g.asNumber === subFilterLabel; });
                        if (provGroup) {
                            var inPeerIds = [];
                            for (var i = 0; i < provGroup.peers.length; i++) {
                                if (provGroup.peers[i].direction === 'inbound') inPeerIds.push(provGroup.peers[i].id);
                            }
                            subFilterPeerIds = inPeerIds;
                            if (_filterPeerTable) _filterPeerTable(inPeerIds);
                            if (_dimMapPeers) _dimMapPeers(inPeerIds);
                            // Preserve donut state for this provider
                            if (donutFocused) {
                                showFocusedCenterText(subFilterLabel);
                                animateDonutExpand(subFilterLabel);
                            }
                        }
                    } else if (subFilterCategory === 'conn-others') {
                        // Others bucket — refresh from the Others donut segment
                        var othersSeg = donutSegments.find(function (s) { return s.isOthers; });
                        if (othersSeg) {
                            var freshOthersPeerIds = othersSeg.peerIds;
                            subFilterPeerIds = freshOthersPeerIds;
                            // If a provider is being hovered, intersect with Others peers
                            if (legendFocusAs) {
                                var hovProvGroup = asGroups.find(function (g) { return g.asNumber === legendFocusAs; });
                                if (hovProvGroup) {
                                    var othSet = {};
                                    for (var oi = 0; oi < freshOthersPeerIds.length; oi++) othSet[freshOthersPeerIds[oi]] = true;
                                    var hovPeerIds = [];
                                    for (var hoi = 0; hoi < hovProvGroup.peerIds.length; hoi++) {
                                        if (othSet[hovProvGroup.peerIds[hoi]]) hovPeerIds.push(hovProvGroup.peerIds[hoi]);
                                    }
                                    var hovColor = getColorForAsNum(legendFocusAs);
                                    if (_drawLinesForAs) _drawLinesForAs(legendFocusAs, hovPeerIds, hovColor);
                                    if (_filterPeerTable) _filterPeerTable(hovPeerIds);
                                    if (_dimMapPeers) _dimMapPeers(hovPeerIds);
                                    if (donutFocused) {
                                        showFocusedCenterText(legendFocusAs);
                                        animateDonutExpand(legendFocusAs);
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
                    } else if (subFilterCategory === 'insight-fastest' || subFilterCategory === 'insight-data-bytessent' || subFilterCategory === 'insight-data-bytesrecv') {
                        // Insight ranking categories — preserve DOM, refresh lines for active provider
                        if (insightActiveAsNum) {
                            var insProvGroup = asGroups.find(function (g) { return g.asNumber === insightActiveAsNum; });
                            if (insProvGroup) {
                                var insColor = getColorForAsNum(insightActiveAsNum);
                                // If sub-sub is drilled into a specific provider, respect that
                                if (subSubTooltipPinned && subSubFilterAsNum) {
                                    var ssProvGroup = asGroups.find(function (g) { return g.asNumber === subSubFilterAsNum; });
                                    if (ssProvGroup) {
                                        subSubFilterPeerIds = ssProvGroup.peerIds;
                                        var ssColor = subSubFilterColor || getColorForAsNum(subSubFilterAsNum);
                                        if (hoveredPeerId && ssProvGroup.peerIds.indexOf(hoveredPeerId) >= 0) {
                                            if (_drawLinesForAs) _drawLinesForAs(subSubFilterAsNum, [hoveredPeerId], ssColor);
                                            if (_filterPeerTable) _filterPeerTable([hoveredPeerId]);
                                            if (_dimMapPeers) _dimMapPeers([hoveredPeerId]);
                                            // Preserve hovered peer's center text
                                            if (donutFocused) {
                                                var hPeer = lastPeersRaw.find(function (p) { return p.id === hoveredPeerId; });
                                                if (hPeer) showPeerInDonutCenter(hPeer, ssColor);
                                            }
                                        } else {
                                            if (_drawLinesForAs) _drawLinesForAs(subSubFilterAsNum, ssProvGroup.peerIds, ssColor);
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
                    if (insightActiveAsNum && donutFocused && !hoveredPeerId) {
                        if (insightRectVisible) {
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
                var savedSumCategory = subFilterCategory;
                var savedSumLabel = subFilterLabel;
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
                        subFilterPeerIds = freshPeerIds;
                        subFilterCategory = savedSumCategory;
                        subFilterLabel = savedSumLabel;
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
                        subFilterPeerIds = null;
                        subFilterCategory = null;
                        subFilterLabel = null;
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
                        if (insightRectVisible) {
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
        if (!donutWrapEl) return null;
        var rect = donutWrapEl.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    /** Get the screen position of a legend dot for a specific AS number.
     *  Returns {x, y} in page coords, or null if not found / legend not visible. */
    function getLegendDotPosition(asNum) {
        if (!legendEl) return null;
        var items = legendEl.querySelectorAll('.as-legend-item');
        for (var i = 0; i < items.length; i++) {
            if (items[i].dataset.as === asNum) {
                var dot = items[i].querySelector('.as-legend-dot');
                if (dot) {
                    var rect = dot.getBoundingClientRect();
                    // Check if actually visible (legend might be hidden)
                    if (rect.width === 0 && rect.height === 0) return null;
                    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                }
            }
        }
        return null;
    }

    /** Get the position of the insight rect origin circle (bottom center dot). */
    function getInsightRectOrigin() {
        if (!insightRectEl || !insightRectVisible) return null;
        var originDot = insightRectEl.querySelector('.as-insight-rect-origin');
        if (originDot) {
            var rect = originDot.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
        }
        return null;
    }

    /** Get the line origin position for a given AS number.
     *  - If insight rect is visible, lines come from the origin circle at the bottom.
     *  - If asNum is a top-8 segment, returns that segment's legend dot.
     *  - If asNum is in the "Others" group, returns the "Others" legend dot.
     *  - Final fallback: donut center (only when legend genuinely not rendered). */
    function getLineOriginForAs(asNum) {
        // When insight rect is visible, lines come from the origin circle at the bottom
        if (insightRectVisible) {
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
        return selectedAs;
    }

    /** Get the color for a given AS number */
    function getColorForAs(asNum) {
        var seg = donutSegments.find(function (s) { return s.asNumber === asNum; });
        return seg ? seg.color : null;
    }

    // ═══════════════════════════════════════════════════════════
    // IPv4/IPv6 NETWORK DETAIL PANEL
    // ═══════════════════════════════════════════════════════════

    /** State for network panels */
    var activeNetworkPanel = null; // 'ipv4' | 'ipv6' | null

    /** Open a dedicated network detail panel (IPv4 or IPv6) */
    function openNetworkPanel(netKey) {
        if (!panelEl) return;
        if (peerDetailActive) closePeerPopup();

        var isRefresh = (activeNetworkPanel === netKey);

        // Enter focused mode if not already
        if (!donutFocused) {
            donutFocused = true;
            document.body.classList.add('donut-focused');
        }

        activeNetworkPanel = netKey;
        var netLabel = netKey === 'ipv4' ? 'IPv4' : 'IPv6';
        var netColor = netKey === 'ipv4' ? 'var(--net-ipv4, #e3b341)' : 'var(--net-ipv6, #f07178)';

        // Filter peers to this network
        var netPeers = lastPeersRaw.filter(function (p) {
            return (p.network || 'ipv4') === netKey;
        });

        // Only set panel history on initial open, not on refresh
        if (!isRefresh) {
            panelHistory = [{ type: 'summary', scrollTop: 0 }];
            renderBackButton();
        }

        // --- Header ---
        var asnEl = panelEl.querySelector('.as-detail-asn');
        var orgEl = panelEl.querySelector('.as-detail-org');
        var metaEl = panelEl.querySelector('.as-detail-meta');
        var barFill = panelEl.querySelector('.as-detail-bar-fill');
        var pctEl = panelEl.querySelector('.as-detail-pct');
        var riskEl = panelEl.querySelector('.as-detail-risk');

        if (asnEl) {
            asnEl.innerHTML = '<span style="color:' + netColor + '">' + netLabel + '</span> <span style="color:var(--logo-primary, #4a90d9)">Network</span>';
            asnEl.classList.remove('as-summary-title');
        }
        if (orgEl) {
            orgEl.textContent = netPeers.length + ' peer' + (netPeers.length !== 1 ? 's' : '') + ' connected';
        }
        if (metaEl) metaEl.innerHTML = '';
        if (barFill) barFill.style.width = '0%';
        if (pctEl) pctEl.textContent = '';
        if (riskEl) { riskEl.className = 'as-detail-risk'; riskEl.textContent = ''; }

        // --- Body ---
        var bodyEl = panelEl.querySelector('.as-detail-body');
        if (!bodyEl) return;
        var html = '';

        if (netPeers.length === 0) {
            html += '<div class="pn-panel-empty">No ' + netLabel + ' peers connected</div>';
            bodyEl.innerHTML = html;
            bodyEl.scrollTop = 0;
            showNetworkPanel();
            return;
        }

        // ── Section 1: Stats ──
        var inbound = 0, outbound = 0, totalPing = 0, pingCount = 0;
        var totalBytesSent = 0, totalBytesRecv = 0;
        for (var si = 0; si < netPeers.length; si++) {
            var sp = netPeers[si];
            if (sp.direction === 'IN') inbound++; else outbound++;
            if (sp.ping_ms > 0) { totalPing += sp.ping_ms; pingCount++; }
            totalBytesSent += (sp.bytessent || 0);
            totalBytesRecv += (sp.bytesrecv || 0);
        }
        var avgPing = pingCount > 0 ? Math.round(totalPing / pingCount) : null;

        html += '<div class="modal-section-title">Stats</div>';
        html += row('Total Peers', netPeers.length);
        html += row('Inbound', inbound);
        html += row('Outbound', outbound);
        if (avgPing !== null) html += row('Avg Ping', avgPing + ' ms');
        html += row('Bytes Sent', fmtBytes(totalBytesSent));
        html += row('Bytes Recv', fmtBytes(totalBytesRecv));

        // ── Section 2: Connections by Provider — collapsed "See providers" link ──
        // Build provider data for the drill-down sub-tooltip
        var providerMap = {};
        for (var ci = 0; ci < netPeers.length; ci++) {
            var cp = netPeers[ci];
            var cpAsNum = parseAsNumber(cp.as);
            if (!cpAsNum) continue;
            if (!providerMap[cpAsNum]) {
                providerMap[cpAsNum] = {
                    asNumber: cpAsNum,
                    name: parseAsOrg(cp.as) || cpAsNum,
                    color: getColorForAsNum(cpAsNum),
                    peerCount: 0,
                    peerIds: [],
                    peers: []
                };
            }
            providerMap[cpAsNum].peerCount++;
            providerMap[cpAsNum].peerIds.push(cp.id);
            providerMap[cpAsNum].peers.push(cp);
        }
        var npProviders = [];
        var npProvKeys = Object.keys(providerMap);
        for (var npk = 0; npk < npProvKeys.length; npk++) npProviders.push(providerMap[npProvKeys[npk]]);
        npProviders.sort(function (a, b) { return b.peerCount - a.peerCount; });

        // Use a single interactive row that opens the provider list (same as summary Networks rows)
        var allNetPeerIds = netPeers.map(function (p) { return p.id; });
        var npCatData = {
            label: netLabel + ' Connections by Provider',
            peerCount: netPeers.length,
            providerCount: npProviders.length,
            peerIds: allNetPeerIds,
            providers: npProviders
        };
        html += '<div class="modal-section-title" title="' + netLabel + ' peer connections grouped by AS provider">' + netLabel + ' Connections by Provider</div>';
        html += summaryInteractiveRow('See providers (' + npProviders.length + ')', netPeers.length + 'p / ' + npProviders.length + 'prov', npCatData);

        // ── Section 3: Hosting ──
        var hostingData = aggregateSummaryByCategory(netPeers,
            function (p) {
                if (p.hosting) return 'cloud';
                if (p.proxy) return 'proxy';
                if (p.mobile) return 'mobile';
                return 'residential';
            },
            function (p, key) {
                var labels = { 'cloud': 'Cloud / Hosting', 'proxy': 'Proxy / VPN', 'mobile': 'Mobile', 'residential': 'Residential' };
                return labels[key] || key;
            }
        );
        html += '<div class="modal-section-title" title="Peer connections grouped by hosting type">Hosting</div>';
        for (var hi = 0; hi < hostingData.length; hi++) {
            html += summaryInteractiveRow(hostingData[hi].label, hostingData[hi].peerCount + 'p / ' + hostingData[hi].providerCount + 'prov', hostingData[hi]);
        }

        // ── Section 4: Countries ──
        var countryData = aggregateSummaryByCategory(netPeers,
            function (p) { return p.countryCode || null; },
            function (p, key) { return key + '  ' + (p.country || key); }
        );
        html += '<div class="modal-section-title" title="Geographic distribution of ' + netLabel + ' peers by country">Countries</div>';
        for (var coi = 0; coi < countryData.length; coi++) {
            html += summaryInteractiveRow(countryData[coi].label, countryData[coi].peerCount + 'p / ' + countryData[coi].providerCount + 'prov', countryData[coi]);
        }

        // ── Section 5: Software ──
        var swData = aggregateSummaryByCategory(netPeers,
            function (p) { return p.subver || 'Unknown'; },
            null
        );
        html += '<div class="modal-section-title" title="Bitcoin Core client versions on ' + netLabel + ' peers">Software</div>';
        for (var swi = 0; swi < swData.length; swi++) {
            html += summaryInteractiveRow(swData[swi].label, swData[swi].peerCount + 'p / ' + swData[swi].providerCount + 'prov', swData[swi]);
        }

        // ── Section 6: Services ──
        var svcData = aggregateSummaryByCategory(netPeers,
            function (p) { return p.services_abbrev || '\u2014'; },
            null
        );
        html += '<div class="modal-section-title" title="Service flags on ' + netLabel + ' peers">Services</div>';
        for (var svci = 0; svci < svcData.length; svci++) {
            html += summaryInteractiveRow(svcData[svci].label, svcData[svci].peerCount + 'p / ' + svcData[svci].providerCount + 'prov', svcData[svci]);
        }

        bodyEl.innerHTML = html;
        if (!isRefresh) bodyEl.scrollTop = 0;

        // Attach drill-down handlers (reuse summary pattern)
        attachSummaryRowHandlers(bodyEl);
        attachGridHandlers(bodyEl);
        attachSummaryLinkHandlers(bodyEl);
        attachPanelBlankClickHandler(bodyEl);

        showNetworkPanel();

        // Filter peer table and map to show only this network's peers
        var netPeerIds = netPeers.map(function (p) { return p.id; });
        if (_filterPeerTable) _filterPeerTable(netPeerIds);
        if (_dimMapPeers) _dimMapPeers(netPeerIds);
        activateHoverAll();

        // Update donut center to show network info (IPv4/IPv6 label, peer count, %)
        renderCenter();
    }

    /** Show the network panel (reuses #as-detail-panel) */
    function showNetworkPanel() {
        if (!panelEl) return;
        panelEl.classList.remove('hidden');
        void panelEl.offsetWidth;
        panelEl.classList.add('visible');
        document.body.classList.add('as-panel-open');
        document.body.classList.add('panel-focus-as');
        document.body.classList.remove('panel-focus-peers');
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
