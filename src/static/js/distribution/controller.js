import * as BPMDistributionNavigation from './navigation.js';
import * as BPMDistributionSummaryInteractions from './summary-interactions.js';
import * as BPMDistributionInsightInteractions from './insight-interactions.js';
import * as BPMDistributionTooltips from './tooltips.js';
import { query, queryAll, required, closest } from '../core/dom.js';
import { dashboard as BPMDashboard } from '../core/dashboard-state.js';
import BPMServiceFlags from '../peers/service-flags.js';
import * as BPMFormat from '../core/format.js';
import * as BPMDistributionData from './data.js';
import * as BPMDistributionDonut from './donut.js';
import * as BPMDistributionNetworkPanel from './network-panel.js';
import * as BPMDistributionCountryPanel from './country-panel.js';
import * as BPMDistributionProviderPanel from './provider-panel.js';
import * as BPMDistributionSummaryPanel from './summary-panel.js';
import * as BPMPeerDetail from '../peers/detail.js';
const dashboard = BPMDashboard;

/** @type {string | null} */
let snapshotSignature = null;

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════

const MAX_SEGMENTS = 8; // Top N groups in either lens, rest = "Others"
const DONUT_SIZE = 260; // SVG viewBox size
const DONUT_RADIUS = 116; // Outer radius of the donut ring
const DONUT_WIDTH = 28; // Width of the donut ring (default)
const DONUT_WIDTH_SELECTED = 40; // Width when selected (thicker)
const DONUT_WIDTH_DIMMED = 14; // Width when dimmed (thinner)

// Curated colour palette — 9 colours (8 AS + Others), distinct and accessible
const PALETTE = [
    '#f472b6', // pink
    '#3fb950', // green
    '#e3b341', // gold
    '#f07178', // coral
    '#8b5cf6', // purple
    '#d2a8ff', // lavender
    '#79c0ff', // light blue
    '#f0883e', // orange
    '#58a6ff', // blue (Others)
];

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════

const distributionState = dashboard.distribution;
/** @type {import('../types').DistributionGroup[]} */
let asGroups = []; // Aggregated AS data (sorted by count desc)
/** @type {import('../types').DistributionSegment[]} */
let donutSegments = []; // Top N + Others for donut rendering
/** @type {import('../types').DistributionGroup[]} */
let countryGroups = []; // Aggregated country/jurisdiction data
/** @type {import('../types').DistributionSegment[]} */
let countryDonutSegments = []; // Top N + Others for country donut rendering
let distributionScore = 0; // 0-10 score
let totalPeers = 0;
let countryDistributionScore = 0;
let countryTotalPeers = 0;

let legendsHidden = false; // True when "Display Top ISP/Net" toggle is OFF

const DONUT_ANIM_DURATION = 400; // ms for expand/revert animation
const DONUT_EXPAND_RATIO = 0.7; // expanded segment gets 70% of donut

// DOM refs (cached on init)
/** @type {HTMLElement | null} */
let containerEl = null;
/** @type {HTMLElement | null} */
let titleEl = null;
/** @type {HTMLElement | null} */
let lensToggleEl = null;
/** @type {HTMLElement | null} */
let panelEl = null;
/** @type {HTMLElement | null} */
let focusedCloseBtn = null;

// Integration hooks (set by the map controller)
/** @type {import('../types').DistributionHooks['drawLinesForAs'] | null} */
let _drawLinesForAs = null; // fn(asNumber, peerIds, color) — draw lines on canvas
/** @type {import('../types').DistributionHooks['drawLinesForAllAs'] | null} */
let _drawLinesForAllAs = null; // fn(groups) — draw lines for all AS groups at once
/** @type {import('../types').DistributionHooks['clearAsLines'] | null} */
let _clearAsLines = null; // fn() — clear AS lines from canvas
/** @type {import('../types').DistributionHooks['filterPeerTable'] | null} */
let _filterPeerTable = null; // fn(peerIds | null) — filter peer table
/** @type {import('../types').DistributionHooks['dimMapPeers'] | null} */
let _dimMapPeers = null; // fn(peerIds | null) — dim non-matching peers
/** @type {import('../types').DistributionHooks['zoomToPeerOnly'] | null} */
let _zoomToPeerOnly = null; // fn(peerId) — zoom to peer without deselecting AS panel
/** @type {import('../types').DistributionHooks['resetMapZoom'] | null} */
let _resetMapZoom = null; // fn() — smoothly zoom the map back to default view
/** @type {import('../types').DistributionHooks['clearPeerSelection'] | null} */
let _clearPeerSelection = null; // fn() — clear peer selection without zoom reset
/** @type {import('../types').DistributionHooks['hideMapTooltip'] | null} */
let _hideMapTooltip = null; // fn() — hide the map peer tooltip
/** @type {import('../types').DistributionHooks['enterPrivateNetMode'] | null} */
let _enterPrivateNetMode = null; // fn(targetNet) — enter private network mode
/** @type {import('../types').DistributionHooks['showDisconnectDialog'] | null} */
let _showDisconnectDialog = null; // fn(peerId, network) — shared peer-actions dialog

const SERVICE_FLAGS = BPMServiceFlags;

// Connection type short labels
const CONN_TYPE_LABELS = BPMFormat.connectionLabels;

const CONN_TYPE_FULL = BPMFormat.connectionTypes;

// ═══════════════════════════════════════════════════════════
// PARSING & AGGREGATION — delegated pure data module
// ═══════════════════════════════════════════════════════════

const distributionData = BPMDistributionData;
const distributionDonut = BPMDistributionDonut;
const buildDistributionGroup = distributionData.buildDistributionGroup;
const getQuality = distributionDonut.getQuality;
const buildScoreTooltip = distributionDonut.buildScoreTooltip;
const distributionNetworkPanel = BPMDistributionNetworkPanel;
const countryPanel = BPMDistributionCountryPanel;
const providerPanel = BPMDistributionProviderPanel;

/** @param {import('../types').Peer[]} peers */
function aggregatePeers(peers) {
    const aggregation = distributionData.aggregateProviders(peers);
    totalPeers = aggregation.total;
    return aggregation.groups;
}

/** @param {import('../types').Peer[]} peers */
function aggregateCountryPeers(peers) {
    const aggregation = distributionData.aggregateCountries(peers);
    countryTotalPeers = aggregation.total;
    return aggregation.groups;
}

/** @param {import('../types').DistributionGroup[]} groups
 * @param {number} denominator */
function calcDistributionScoreFor(groups, denominator) {
    return distributionData.distributionScore(groups, denominator);
}

/** @param {import('../types').DistributionGroup[]} groups */
function calcDistributionScore(groups) {
    return calcDistributionScoreFor(groups, totalPeers);
}

/** @param {import('../types').DistributionGroup[]} groups
 * @param {number} denominator
 * @param {string} othersNoun */
function buildDonutSegmentsFor(groups, denominator, othersNoun) {
    return distributionData.buildDonutSegments(groups, denominator, {
        maxSegments: MAX_SEGMENTS,
        palette: PALETTE,
        othersNoun: othersNoun,
    });
}

/** @param {import('../types').DistributionGroup[]} groups */
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

function getActiveEntityKind() {
    return isCountryLens() ? 'Country' : 'ISP';
}

/** @param {string} asNum */
function findActiveSegment(asNum) {
    var segments = getActiveSegments();
    return (
        segments.find(function (s) {
            return s.asNumber === asNum;
        }) || null
    );
}

/** @param {string | null} asNum */
function findActiveGroup(asNum) {
    var groups = getActiveGroups();
    return (
        groups.find(function (g) {
            return g.asNumber === asNum;
        }) || null
    );
}

/** @param {string} asNum */
function findActiveSegmentOrGroup(asNum) {
    var seg = findActiveSegment(asNum);
    if (seg) return seg;
    var grp = findActiveGroup(asNum);
    if (!grp) return null;
    const othersSeg = getActiveSegments().find(function (s) {
        return s.isOthers;
    });
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

/** @param {string} asNum */
function getPeerIdsForActiveEntity(asNum) {
    var seg = findActiveSegment(asNum);
    if (seg) return seg.peerIds;
    var grp = findActiveGroup(asNum);
    return grp ? grp.peerIds : [];
}

/** @param {import('../types').DistributionSegment} seg */
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

/** @param {string | null} asNum */
function getColorForActiveEntity(asNum) {
    var segments = getActiveSegments();
    for (var i = 0; i < segments.length; i++) {
        if (segments[i].asNumber === asNum) return segments[i].color;
        const otherGroups = segments[i]._othersGroups;
        if (segments[i].isOthers && otherGroups) {
            for (var j = 0; j < otherGroups.length; j++) {
                if (otherGroups[j].asNumber === asNum) return segments[i].color;
            }
        }
    }
    return PALETTE[PALETTE.length - 1];
}

/** @param {number} score */
function buildActiveScoreTooltip(score) {
    var q = getQuality(score);
    var noun = isCountryLens() ? 'countries and territories' : 'providers';
    return (
        'Distribution Score: ' +
        score.toFixed(1) +
        '/10 (' +
        q.word +
        ')\n' +
        'Based on Herfindahl\u2013Hirschman Index (HHI)\n' +
        'Higher = more evenly distributed peers across ' +
        noun + '\nAmong public peers with known ' + (isCountryLens() ? 'country' : 'provider') + ' only.\n' +
        distributionData.coverageLabel(distributionData.distributionCoverage(dashboard.peers, isCountryLens() ? 'country' : 'provider'))
    );
}

// ═══════════════════════════════════════════════════════════
// SUMMARY DATA COMPUTATION — delegated pure data module
// ═══════════════════════════════════════════════════════════

/** Resolve transient row IDs against the current snapshot.
 * @param {number[]} peerIds
 * @param {import('../types').Peer[]} [peers]
 */
function peersByIds(peerIds, peers = dashboard.peers) {
    const ids = new Set(peerIds);
    return peers.filter((peer) => ids.has(peer.id));
}

/** @param {string | null} asNum */
function getColorForAsNum(asNum) {
    return distributionData.colorForProvider(asNum, donutSegments, PALETTE[PALETTE.length - 1]);
}

/** @param {import('../types').Peer[]} peers */
function aggregateProvidersForPeers(peers) {
    return distributionData.aggregateProvidersForPeers(peers, donutSegments);
}

function computeSummaryData() {
    const data = distributionData.computeSummaryData({
        score: distributionScore,
        groups: asGroups,
        segments: donutSegments,
        peers: dashboard.peers,
        connectionTypeLabels: CONN_TYPE_LABELS,
    });
    return { ...data, quality: data.coverage.known ? getQuality(distributionScore) : { word: 'Unavailable', cls: '' } };
}

function computeCountrySummaryData() {
    const data = distributionData.computeCountrySummaryData(countryGroups, countryTotalPeers, countryDistributionScore, dashboard.peers);
    return { ...data, quality: data.coverage.known ? getQuality(countryDistributionScore) : { word: 'Unavailable', cls: '' } };
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

const summaryView = BPMDistributionSummaryPanel.create({
    serviceFlags: SERVICE_FLAGS,
    connectionTypeLabels: CONN_TYPE_LABELS,
    elements: {
        get panel() {
            return panelEl;
        },
    },
    actions: { buildScoreTooltip, buildActiveScoreTooltip, getColorForAsNum },
});

function renderDonut() {
    donutController.renderDonut();
}

/** @param {string} asNum */
function animateDonutExpand(asNum) {
    donutController.animateExpand(asNum);
}

function animateDonutRevert() {
    donutController.animateRevert();
}

function stopDonutAnimation() {
    donutController.stopAnimation();
}

/** @param {string} type
 * @param {import('../types').InsightPresentation} data
 */
function showInsightRect(type, data) {
    donutController.showInsight(type, data);
}

/** @param {import('../types').Peer} peer
 * @param {string} provColor */
function updateInsightRectForPeer(peer, provColor) {
    if (distributionState.insightActiveType)
        donutController.updateInsightPeer(peer, provColor, distributionState.insightActiveType);
}

function restoreInsightRectProvider() {
    if (
        !donutController.isInsightVisible() ||
        !distributionState.insightActiveType ||
        !distributionState.insightActiveAsNum
    )
        return;
    var data = getInsightDataForActive();
    if (data && distributionState.insightActiveType) showInsightRect(distributionState.insightActiveType, data);
    else if (distributionState.insightActiveData)
        showInsightRect(distributionState.insightActiveType, distributionState.insightActiveData);
}

function getInsightDataForActive() {
    if (!distributionState.insightActiveAsNum || !distributionState.insightActiveType) return null;
    var sumData = computeSummaryData();
    for (var i = 0; i < sumData.insights.length; i++) {
        const insightItem = sumData.insights[i];
        var insight = insightItem;
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
                        color: insight.topProviders[j].color || getColorForAsNum(insight.topProviders[j].asNumber),
                    };
                }
            }
        }
        if (insight.type === 'data-providers' && insight.topProviders) {
            var matchesField =
                (distributionState.insightActiveType === 'data-bytessent' && insight.field === 'bytessent') ||
                (distributionState.insightActiveType === 'data-bytesrecv' && insight.field === 'bytesrecv');
            if (!matchesField) continue;
            for (var k = 0; k < insight.topProviders.length; k++) {
                if (insight.topProviders[k].asNumber === distributionState.insightActiveAsNum) {
                    return {
                        provName: insight.topProviders[k].provName,
                        asNumber: insight.topProviders[k].asNumber,
                        peerIds: insight.topProviders[k].peers.map((peer) => peer.id),
                        totalBytes: insight.topProviders[k].totalBytes,
                        rank: k + 1,
                        color: insight.topProviders[k].color || getColorForAsNum(insight.topProviders[k].asNumber),
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
/** @param {Parameters<import('../types').DistributionNavigation['closeActiveInsight']>} args */
function closeActiveInsight(...args) {
    return navigation.closeActiveInsight(...args);
}

function renderCenter() {
    const coverage = distributionData.distributionCoverage(dashboard.peers, isCountryLens() ? 'country' : 'provider');
    const coverageEl = document.getElementById('as-coverage');
    if (coverageEl) coverageEl.textContent = distributionData.coverageLabel(coverage);
    var activePeerTotal = getActiveTotalPeers();
    donutController.clearLegendHover();
    if (distributionState.peerDetailActive) return;
    if (
        distributionState.donutFocused &&
        distributionState.focusedHoverProvider &&
        !distributionState.selectedProvider
    ) {
        showFocusedCenterText(distributionState.focusedHoverProvider);
        return;
    }
    if (
        legendsHidden &&
        !distributionState.donutFocused &&
        distributionState.focusedHoverProvider &&
        !distributionState.selectedProvider
    ) {
        showLegendHoverCenterText(distributionState.focusedHoverProvider);
        return;
    }
    if (
        distributionState.insightActiveAsNum &&
        distributionState.summarySelected &&
        !distributionState.selectedProvider &&
        distributionState.donutFocused
    ) {
        if (donutController.isInsightVisible()) {
            var insightData = getInsightDataForActive();
            if (insightData && distributionState.insightActiveType)
                showInsightRect(distributionState.insightActiveType, insightData);
        } else {
            showFocusedCenterText(distributionState.insightActiveAsNum);
        }
        return;
    }
    if (
        distributionState.donutFocused &&
        distributionState.summarySelected &&
        distributionState.filterPeerIds &&
        distributionState.filterLabel &&
        !distributionState.selectedProvider
    ) {
        donutController.renderFilterCenter(
            distributionState.filterPeerIds.length,
            distributionState.filterLabel,
            dashboard.peers.length,
            'connected peers'
        );
        return;
    }
    if (
        distributionState.donutFocused &&
        distributionState.summarySelected &&
        distributionState.summaryPreviewPeerIds &&
        distributionState.summaryPreviewLabel &&
        !distributionState.selectedProvider
    ) {
        summaryPreviewSummaryCenterText(distributionState.summaryPreviewPeerIds, distributionState.summaryPreviewLabel);
        return;
    }
    if (distributionState.donutFocused && distributionState.activeNetwork && !distributionState.selectedProvider) {
        if (distributionState.filterPeerIds && distributionState.filterLabel) {
            donutController.renderFilterCenter(
                distributionState.filterPeerIds.length,
                distributionState.filterLabel,
                dashboard.peers.length,
                'connected peers'
            );
            return;
        }
        var networkKey = distributionState.activeNetwork;
        var networkPeerCount = dashboard.peers.filter(function (peer) {
            return (peer.network || 'ipv4') === networkKey;
        }).length;
        donutController.renderNetworkCenter(networkKey, networkPeerCount, dashboard.peers.length, 'connected peers');
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

/** @param {Parameters<import('../types').DistributionNavigation['clearLegendFocus']>} args */
function clearLegendFocus(...args) {
    return navigation.clearLegendFocus(...args);
}

// ═══════════════════════════════════════════════════════════
// DETAIL PANEL — Right slide-in (pushes content)
// ═══════════════════════════════════════════════════════════

function showPanel() {
    if (!panelEl) return;
    panelEl.classList.remove('hidden');
    void panelEl.offsetWidth;
    panelEl.classList.add('visible');
    document.body.classList.add('as-panel-open');
    document.body.classList.add('panel-focus-as');
    document.body.classList.remove('panel-focus-peers');
}

/** @param {string} countryId */
function renderCountryPanel(countryId) {
    if (!panelEl) return;
    var seg = findActiveSegment(countryId);
    var fullGroup = seg && seg.isOthers ? seg : findActiveGroup(countryId);
    if (!seg && fullGroup) seg = findActiveSegmentOrGroup(countryId);
    if (!seg || !fullGroup) return;

    var allPeers = getAllPeersForActiveSegment(seg);
    if (seg.isOthers) {
        fullGroup = buildDistributionGroup(
            {
                asNumber: 'Others',
                asName: seg.asName,
                asShort: '',
                isCountryGroup: true,
            },
            allPeers,
            countryTotalPeers
        );
    }
    renderBackButton();
    if (
        !countryPanel.render({
            panelEl,
            segment: seg,
            group: fullGroup,
            peers: allPeers,
            providers: aggregateProvidersForPeers(allPeers),
            summaryView,
            attachInteractiveRowHandlers: summaryAttachInteractiveRowHandlers,
            attachPanelBlankClickHandler: summaryAttachPanelBlankClickHandler,
            connectionTypeLabels: CONN_TYPE_LABELS,
            coverage: distributionData.distributionCoverage(dashboard.peers, 'country'),
        })
    )
        return;
    showPanel();
}

/** @param {string} asNum */
function renderPanel(asNum) {
    if (isCountryLens()) {
        renderCountryPanel(asNum);
        return;
    }
    if (!panelEl) return;
    const resolved = providerPanel.resolve(asNum, donutSegments, asGroups, getColorForAsNum);
    if (!resolved) return;
    renderBackButton();
    if (
        !providerPanel.render({
            panelEl,
            segment: resolved.segment,
            group: resolved.group,
            summaryView,
            attachInteractiveRowHandlers: summaryAttachInteractiveRowHandlers,
            attachPanelBlankClickHandler: summaryAttachPanelBlankClickHandler,
            connectionTypeLabels: CONN_TYPE_LABELS,
            coverage: distributionData.distributionCoverage(dashboard.peers),
        })
    )
        return;
    showPanel();
}

function closePanel() {
    if (!panelEl) return;
    panelEl.classList.remove('visible');
    document.body.classList.remove('as-panel-open');
    document.body.classList.remove('panel-focus-as');
    setTimeout(function () {
        if (panelEl && !panelEl.classList.contains('visible')) {
            panelEl.classList.add('hidden');
        }
    }, 310);
}

// ═══════════════════════════════════════════════════════════
// PANEL NAVIGATION — Back button, history, provider links
// ═══════════════════════════════════════════════════════════

/** Get peer IDs for any provider, including those inside Others.
 * @param {string} asNum */
function getPeerIdsForAnyAs(asNum) {
    return providerPanel.peerIdsFor(asNum, donutSegments, asGroups);
}
/** @param {Parameters<import('../types').DistributionNavigation['navigateToProvider']>} args */
function navigateToProvider(...args) {
    return navigation.navigateToProvider(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['renderBackButton']>} args */
function renderBackButton(...args) {
    return navigation.renderBackButton(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['onMapClick']>} args */
function onMapClick(...args) {
    return navigation.onMapClick(...args);
}

// ═══════════════════════════════════════════════════════════
// FOCUSED MODE CENTER TEXT
// ═══════════════════════════════════════════════════════════

/** Check if an AS number belongs to an Others sub-provider (not in top-8 donut segments)
 * @param {string} asNum */
function isOthersSubProvider(asNum) {
    if (!asNum) return false;
    var inDonut = findActiveSegment(asNum);
    if (inDonut) return false;
    // Check if it exists in the active groups (real item, just not top-8)
    var grp = findActiveGroup(asNum);
    return !!grp;
}
/** @param {Parameters<import('../types').DistributionNavigation['backToOthersList']>} args */
function backToOthersList(...args) {
    return navigation.backToOthersList(...args);
}

// DONUT CENTER DELEGATES
/** @param {string | null} asNum */
function showFocusedCenterText(asNum) {
    if (!asNum) return;
    var segment = findActiveSegmentOrGroup(asNum);
    if (!segment) return;
    donutController.renderProviderCenter(segment, {
        isSubProvider: isOthersSubProvider(asNum),
        countryLens: isCountryLens(),
        entityKind: getActiveEntityKind(),
        onBack: backToOthersList,
    });
}

/** @param {string} asNum */
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

/** @param {Parameters<import('../types').DistributionNavigation['onSegmentHover']>} args */
function onSegmentHover(...args) {
    return navigation.onSegmentHover(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['onSegmentLeave']>} args */
function onSegmentLeave(...args) {
    return navigation.onSegmentLeave(...args);
}

/** Add highlight class to the matching legend item
 * @param {string} asNum */
function highlightLegendItem(asNum) {
    donutController.highlightLegend(asNum);
}

/** Remove highlight class from all legend items */
function clearLegendHighlight() {
    donutController.clearLegendHighlight();
}

/** @param {Parameters<import('../types').DistributionNavigation['onTitleEnter']>} args */
function onTitleEnter(...args) {
    return navigation.onTitleEnter(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['onTitleLeave']>} args */
function onTitleLeave(...args) {
    return navigation.onTitleLeave(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['onSegmentClick']>} args */
function onSegmentClick(...args) {
    return navigation.onSegmentClick(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['deselect']>} args */
function deselect(...args) {
    return navigation.deselect(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['onKeyDown']>} args */
function onKeyDown(...args) {
    return navigation.onKeyDown(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['enterFocusedMode']>} args */
function enterFocusedMode(...args) {
    return navigation.enterFocusedMode(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['exitFocusedMode']>} args */
function exitFocusedMode(...args) {
    return navigation.exitFocusedMode(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['isFocusedMode']>} args */
function isFocusedMode(...args) {
    return navigation.isFocusedMode(...args);
}

// ═══════════════════════════════════════════════════════════
// PEER DETAIL POPUP — delegated view controller
// ═══════════════════════════════════════════════════════════

const peerDetailController = BPMPeerDetail.create({
    getPeers: () => dashboard.peers,
    getProviderColor: getColorForAsNum,
    connectionTypeLabels: CONN_TYPE_FULL,
    serviceFlags: SERVICE_FLAGS,
    onRequestClose: () => closePeerPopup(),
    onRequestPeer: (peer, source) => openPeerDetailPanel(peer, source),
    onRequestGroup: (peerIds) => openMultiPeerPopup(peerIds),
    onDisconnect: (peerId, network) => {
        if (_showDisconnectDialog) _showDisconnectDialog(peerId, network);
    },
});

/** @param {Parameters<import('../types').DistributionNavigation['closePeerPopup']>} args */
function closePeerPopup(...args) {
    return navigation.closePeerPopup(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['openMultiPeerPopup']>} args */
function openMultiPeerPopup(...args) {
    return navigation.openMultiPeerPopup(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['openPeerDetailPanel']>} args */
function openPeerDetailPanel(...args) {
    return navigation.openPeerDetailPanel(...args);
}

/** Show peer ID and provider in donut center
 * @param {import('../types').Peer} peer
 * @param {string} color */
function showPeerInDonutCenter(peer, color) {
    donutController.renderPeerCenter(peer, color);
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API — Called by map and private-network features
// ═══════════════════════════════════════════════════════════

function updateLensChrome() {
    if (containerEl) {
        containerEl.dataset.lens = distributionState.lens;
    }
    if (titleEl) {
        if (isCountryLens()) {
            titleEl.innerHTML =
                '<span class="as-title-peer">Peer</span> <span class="as-title-provider">Countries</span><span class="as-title-subtitle" id="as-title-subtitle">(jurisdiction risk)</span>';
            titleEl.title = 'Country and territory peer distribution analysis';
        } else {
            titleEl.innerHTML =
                '<span class="as-title-peer">Peer</span> <span class="as-title-provider">Service Providers</span><span class="as-title-subtitle" id="as-title-subtitle">(IPv4/IPv6)</span>';
            titleEl.title = 'Autonomous System Peer Distribution Analysis';
        }
    }
    if (!lensToggleEl) return;
    var buttons = queryAll('.as-lens-btn', lensToggleEl);
    for (var i = 0; i < buttons.length; i++) {
        var active = buttons[i].dataset.lens === distributionState.lens;
        buttons[i].classList.toggle('active', active);
        buttons[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
}

/** @param {Parameters<import('../types').DistributionNavigation['setDistributionLens']>} args */
function setDistributionLens(...args) {
    return navigation.setDistributionLens(...args);
}

/** Initialize — cache DOM refs and attach events. Call once on page load. */
function init() {
    containerEl = document.getElementById('as-distribution-container');
    titleEl = document.getElementById('as-donut-title');
    lensToggleEl = document.getElementById('as-lens-toggle');
    panelEl = document.getElementById('as-detail-panel');
    panelEl?.addEventListener(
        'click',
        (event) => {
            const row = closest('[data-filter]', event.target);
            if (row) navigation.setFilterDescriptor(JSON.parse(row.dataset.filter || 'null'));
        },
        true
    );
    focusedCloseBtn = document.getElementById('as-focused-close');
    donutController.init({
        wrap: document.getElementById('as-donut-wrap'),
        svg: document.getElementById('as-donut'),
        center: document.getElementById('as-donut-center'),
        legend: document.getElementById('as-legend'),
        loading: containerEl ? query('.as-loading', containerEl) : null,
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
        var lensButtons = queryAll('.as-lens-btn', lensToggleEl);
        for (var lbi = 0; lbi < lensButtons.length; lbi++) {
            lensButtons[lbi].addEventListener('click', function (e) {
                e.stopPropagation();
                setDistributionLens(
                    e.currentTarget instanceof Element ? e.currentTarget.getAttribute('data-lens') || '' : ''
                );
            });
        }
    }

    // Close button on detail panel — exit fully
    var closeBtn = panelEl ? query('.as-detail-close', panelEl) : null;
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
            navigation.clearFocusedHover();
            renderCenter();
        }
    });

    updateLensChrome();
}

/** Register integration callbacks from the map controller
 *
 * @param {Partial<import('../types').DistributionHooks>} hooks
 */
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

function renderCountrySummaryPanel() {
    if (!panelEl) return;
    renderBackButton();
    var bodyEl = summaryView.renderCountry(computeCountrySummaryData());
    if (!bodyEl) return;
    summaryAttachCountrySummaryRowHandlers(bodyEl);
    summaryAttachPanelBlankClickHandler(bodyEl);
}
/** @type {import('../types').DistributionSummaryInteractions['summaryAttachCountrySummaryRowHandlers']} */
const summaryAttachCountrySummaryRowHandlers = (...args) =>
    summaryInteractions.summaryAttachCountrySummaryRowHandlers(...args);

function renderSummaryPanel() {
    if (!panelEl) return;
    renderBackButton();
    var bodyEl = summaryView.renderProvider(computeSummaryData());
    if (!bodyEl) return;
    summaryAttachSummaryHandlers(bodyEl);
}

/** @param {number[]} peerIds
 * @param {string} category
 * @param {string} label */
function summaryBuildPeerSummaryHtml(peerIds, category, label) {
    // Find the actual peer objects from the current AS group
    var seg = distributionState.selectedProvider ? findActiveSegment(distributionState.selectedProvider) : null;
    /** @type {import('../types').Peer[]} */
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

    var matchedPeers = peersByIds(peerIds, allPeers);

    return summaryView.buildPeerSummaryHtml(matchedPeers, category, label);
}
/** @type {import('../types').DistributionSummaryInteractions['summaryAttachPanelBlankClickHandler']} */
const summaryAttachPanelBlankClickHandler = (...args) =>
    summaryInteractions.summaryAttachPanelBlankClickHandler(...args);

/** @type {import('../types').DistributionSummaryInteractions['summaryAttachInteractiveRowHandlers']} */
const summaryAttachInteractiveRowHandlers = (...args) =>
    summaryInteractions.summaryAttachInteractiveRowHandlers(...args);
/** @param {Parameters<import('../types').DistributionNavigation['summaryRestoreDonutAfterPreview']>} args */
function summaryRestoreDonutAfterPreview(...args) {
    return navigation.summaryRestoreDonutAfterPreview(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['summaryPreviewSummaryLines']>} args */
function summaryPreviewSummaryLines(...args) {
    return navigation.summaryPreviewSummaryLines(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['summaryPreviewProviderLines']>} args */
function summaryPreviewProviderLines(...args) {
    return navigation.summaryPreviewProviderLines(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['summaryPreviewSummaryCenterText']>} args */
function summaryPreviewSummaryCenterText(...args) {
    return navigation.summaryPreviewSummaryCenterText(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['summaryRestoreSummaryFromPreview']>} args */
function summaryRestoreSummaryFromPreview(...args) {
    return navigation.summaryRestoreSummaryFromPreview(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['summaryRestoreProviderFromPreview']>} args */
function summaryRestoreProviderFromPreview(...args) {
    return navigation.summaryRestoreProviderFromPreview(...args);
}

/** @type {import('../types').DistributionSummaryInteractions['summaryAttachProviderClickHandlers']} */
const summaryAttachProviderClickHandlers = (...args) => summaryInteractions.summaryAttachProviderClickHandlers(...args);

/** @type {import('../types').DistributionSummaryInteractions['summaryAttachProviderNavHandlers']} */
const summaryAttachProviderNavHandlers = (...args) => summaryInteractions.summaryAttachProviderNavHandlers(...args);
/** @param {Parameters<import('../types').DistributionNavigation['summaryApplySummarySubFilter']>} args */
function summaryApplySummarySubFilter(...args) {
    return navigation.summaryApplySummarySubFilter(...args);
}

/** @param {Parameters<import('../types').DistributionNavigation['summaryClearSummarySubFilter']>} args */
function summaryClearSummarySubFilter(...args) {
    return navigation.summaryClearSummarySubFilter(...args);
}

function summaryHighlightActiveSummaryRow() {
    var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
    if (!bodyEl) return;
    // Clear ALL highlights first (summary rows + insight rows + grid rows)
    var allActive = queryAll('.sub-filter-active', bodyEl);
    for (var ai = 0; ai < allActive.length; ai++) allActive[ai].classList.remove('sub-filter-active');
    // Re-apply highlight to matching summary row
    if (distributionState.filterCategory === 'summary' && distributionState.filterLabel) {
        var rows = queryAll('.as-summary-row', bodyEl);
        for (var ri = 0; ri < rows.length; ri++) {
            if (rows[ri].dataset.catLabel === distributionState.filterLabel) {
                rows[ri].classList.add('sub-filter-active');
            }
        }
    }
    // Re-apply highlight to matching grid rows (conn-provider, conn-out, conn-in)
    if (
        distributionState.filterCategory &&
        distributionState.filterCategory.indexOf('conn-') === 0 &&
        distributionState.filterLabel
    ) {
        var gridSelector =
            distributionState.filterCategory === 'conn-provider'
                ? '.as-conn-prov-row'
                : distributionState.filterCategory === 'conn-out'
                  ? '.as-conn-out-row'
                  : distributionState.filterCategory === 'conn-others'
                    ? '.as-conn-others-row'
                    : '.as-conn-dir-row';
        var gridRows = queryAll(gridSelector, bodyEl);
        for (var gi = 0; gi < gridRows.length; gi++) {
            if (gridRows[gi].dataset.as === distributionState.filterLabel) {
                gridRows[gi].classList.add('sub-filter-active');
            }
        }
    }
}
/** @param {Parameters<import('../types').DistributionNavigation['summaryApplySubFilter']>} args */
function summaryApplySubFilter(...args) {
    return navigation.summaryApplySubFilter(...args);
}

function summaryHighlightActiveSubRow() {
    var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
    if (!bodyEl) return;
    var rows = queryAll('.as-interactive-row', bodyEl);
    for (var ri = 0; ri < rows.length; ri++) {
        if (
            distributionState.filterCategory &&
            distributionState.filterLabel &&
            rows[ri].dataset.category === distributionState.filterCategory &&
            required('.as-detail-sub-label', rows[ri]).textContent === distributionState.filterLabel
        ) {
            rows[ri].classList.add('sub-filter-active');
        } else {
            rows[ri].classList.remove('sub-filter-active');
        }
    }
}
/** @param {Parameters<import('../types').DistributionNavigation['summaryClearSubFilter']>} args */
function summaryClearSubFilter(...args) {
    return navigation.summaryClearSubFilter(...args);
}

/** @type {import('../types').DistributionSummaryInteractions['summaryAttachSummaryHandlers']} */
const summaryAttachSummaryHandlers = (...args) => summaryInteractions.summaryAttachSummaryHandlers(...args);

/** @type {import('../types').DistributionTooltips['tooltipIsPinnedTo']} */
const tooltipIsPinnedTo = (...args) => tooltipController.tooltipIsPinnedTo(...args);

/** @type {import('../types').DistributionSummaryInteractions['tooltipAttachSubTooltipHandlers']} */
const tooltipAttachSubTooltipHandlers = (...args) => summaryInteractions.tooltipAttachSubTooltipHandlers(...args);

/** @type {import('../types').DistributionTooltips['tooltipShowSubTooltip']} */
const tooltipShowSubTooltip = (...args) => tooltipController.tooltipShowSubTooltip(...args);

/** @type {import('../types').DistributionTooltips['tooltipPositionSubTooltip']} */
const tooltipPositionSubTooltip = (...args) => tooltipController.tooltipPositionSubTooltip(...args);

/** @type {import('../types').DistributionTooltips['tooltipHideSubTooltip']} */
const tooltipHideSubTooltip = (...args) => tooltipController.tooltipHideSubTooltip(...args);

/** @type {import('../types').DistributionTooltips['tooltipPinSubTooltip']} */
const tooltipPinSubTooltip = (...args) => tooltipController.tooltipPinSubTooltip(...args);

/** @type {import('../types').DistributionTooltips['tooltipShowSubSubTooltip']} */
const tooltipShowSubSubTooltip = (...args) => tooltipController.tooltipShowSubSubTooltip(...args);

/** @type {import('../types').DistributionTooltips['tooltipHideSubSubTooltip']} */
const tooltipHideSubSubTooltip = (...args) => tooltipController.tooltipHideSubSubTooltip(...args);

/** @type {import('../types').DistributionSummaryInteractions['tooltipAttachSubSubTooltipHandlers']} */
const tooltipAttachSubSubTooltipHandlers = (...args) => summaryInteractions.tooltipAttachSubSubTooltipHandlers(...args);

/** @type {import('../types').DistributionTooltips['tooltipHighlightSelectedPeerRow']} */
const tooltipHighlightSelectedPeerRow = (...args) => tooltipController.tooltipHighlightSelectedPeerRow(...args);

/** @type {import('../types').DistributionInsightInteractions['insightAttachSummaryLinkHandlers']} */
const insightAttachSummaryLinkHandlers = (...args) => insightInteractions.insightAttachSummaryLinkHandlers(...args);

/** @type {import('../types').DistributionInsightInteractions['insightAttachFastestProvRowHandlers']} */
const insightAttachFastestProvRowHandlers = (...args) =>
    insightInteractions.insightAttachFastestProvRowHandlers(...args);

/** @type {import('../types').DistributionInsightInteractions['insightAttachDataProviderRowHandlers']} */
const insightAttachDataProviderRowHandlers = (...args) =>
    insightInteractions.insightAttachDataProviderRowHandlers(...args);

/** @param {string} field */
function buildDataProviderHtml(field) {
    return summaryView.buildDataProviderHtml(computeSummaryData(), field);
}

function buildStablePeersHtml() {
    return summaryView.buildStablePeersHtml(computeSummaryData(), dashboard.peers);
}

function buildFastestProvHtml() {
    return summaryView.buildFastestProvHtml(computeSummaryData());
}
/** @param {Parameters<import('../types').DistributionNavigation['refreshSelectionViews']>} args */
function refreshSelectionViews(...args) {
    return navigation.refreshSelectionViews(...args);
}

/** Update with new peer data. Called after each fetchPeers().
 * @param {import('../types').Peer[]} peers */
function update(peers) {
    dashboard.replace(peers);
    const signature = JSON.stringify(peers);
    if (signature === snapshotSignature) return;
    snapshotSignature = signature;
    const pendingCount = peers.filter((peer) => peer.location_status === 'pending').length;
    const loading = peers.length > 0 && pendingCount / peers.length > 0.1;
    donutController.updateLoading(pendingCount, loading);
    asGroups = aggregatePeers(peers);
    distributionScore = calcDistributionScore(asGroups);
    donutSegments = buildDonutSegments(asGroups);
    countryGroups = aggregateCountryPeers(peers);
    countryDistributionScore = calcDistributionScoreFor(countryGroups, countryTotalPeers);
    countryDonutSegments = buildDonutSegmentsFor(countryGroups, countryTotalPeers, 'countries');
    peerDetailController.update();
    if (containerEl) containerEl.classList.toggle('no-data', getActiveTotalPeers() === 0 && !loading);
    if (!distributionState.peerDetailActive) {
        renderDonut();
        renderCenter();
        renderLegend();
    }
    refreshSelectionViews();
}

/** Get the donut center screen position for line drawing */
function getDonutCenter() {
    return donutController.getDonutCenterPosition();
}

/** Get the screen position of a legend dot for a specific AS number.
 *  Returns {x, y} in page coords, or null if not found / legend not visible.
 * @param {string} asNum */
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
 *  - Final fallback: donut center (only when legend genuinely not rendered).
 * @param {string} asNum */
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

/** Set legends hidden state (called from app.js when toggle changes)
 * @param {boolean} hidden */
function setLegendsHidden(hidden) {
    legendsHidden = !!hidden;
}

/** Get the currently selected AS number */
function getSelectedAs() {
    return distributionState.selectedProvider;
}

/** Get the color for a given AS number
 * @param {string | null} asNum */
function getColorForAs(asNum) {
    var seg = donutSegments.find(function (s) {
        return s.asNumber === asNum;
    });
    return seg ? seg.color : null;
}
/** @param {Parameters<import('../types').DistributionNavigation['openNetworkPanel']>} args */
function openNetworkPanel(...args) {
    return navigation.openNetworkPanel(...args);
}

export { init };
export { setHooks };
export { update };
export { deselect };
export { onMapClick };
export { getLineOriginForAs };
export { getSelectedAs };
export { getColorForAs };
export { enterFocusedMode };
export { exitFocusedMode };
export { isFocusedMode };
export { openPeerDetailPanel };
export { closePeerPopup };
export const isPeerDetailActive = function () {
    return distributionState.peerDetailActive;
};
export { openNetworkPanel };
export { setLegendsHidden };

const summaryInteractions = BPMDistributionSummaryInteractions.create({
    state: distributionState,
    isReconciling: () => navigation.isReconciling(),
    getSummaryView: () => summaryView,
    getGroups: () => asGroups,
    actions: {
        previewCountry: (...args) => navigation.previewCountry(...args),
        restoreCountryPreview: (...args) => navigation.restoreCountryPreview(...args),
        selectCountryFromSummary: (...args) => navigation.selectCountryFromSummary(...args),
        dismissPanelTooltips: (...args) => navigation.dismissPanelTooltips(...args),
        previewNestedProvider: (...args) => navigation.previewNestedProvider(...args),
        selectNestedProvider: (...args) => navigation.selectNestedProvider(...args),
        enterPrivateFromTooltip: (...args) => navigation.enterPrivateFromTooltip(...args),
        previewConnectionProvider: (...args) => navigation.previewConnectionProvider(...args),
        selectConnectionProvider: (...args) => navigation.selectConnectionProvider(...args),
        previewOutboundTypeGroup: (...args) => navigation.previewOutboundTypeGroup(...args),
        selectOutboundTypeGroup: (...args) => navigation.selectOutboundTypeGroup(...args),
        previewConnectionDirection: (...args) => navigation.previewConnectionDirection(...args),
        selectConnectionDirection: (...args) => navigation.selectConnectionDirection(...args),
        selectOtherProviders: (...args) => navigation.selectOtherProviders(...args),
        previewTooltipPeer: (...args) => navigation.previewTooltipPeer(...args),
        restoreTooltipPeerPreview: (...args) => navigation.restoreTooltipPeerPreview(...args),
        selectPrimaryTooltipPeer: (...args) => navigation.selectPrimaryTooltipPeer(...args),
        selectSecondaryTooltipPeer: (...args) => navigation.selectSecondaryTooltipPeer(...args),
        clearLegendFocus: (...args) => clearLegendFocus(...args),
        closePeerPopup: (...args) => closePeerPopup(...args),
        insightAttachSummaryLinkHandlers: (...args) => insightAttachSummaryLinkHandlers(...args),
        navigateToProvider: (...args) => navigateToProvider(...args),
        peersByIds: (...args) => peersByIds(...args),
        summaryApplySubFilter: (...args) => summaryApplySubFilter(...args),
        summaryApplySummarySubFilter: (...args) => summaryApplySummarySubFilter(...args),
        summaryBuildPeerSummaryHtml: (...args) => summaryBuildPeerSummaryHtml(...args),
        summaryClearSubFilter: (...args) => summaryClearSubFilter(...args),
        summaryClearSummarySubFilter: (...args) => summaryClearSummarySubFilter(...args),
        summaryPreviewProviderLines: (...args) => summaryPreviewProviderLines(...args),
        summaryPreviewSummaryCenterText: (...args) => summaryPreviewSummaryCenterText(...args),
        summaryPreviewSummaryLines: (...args) => summaryPreviewSummaryLines(...args),
        summaryRestoreDonutAfterPreview: (...args) => summaryRestoreDonutAfterPreview(...args),
        summaryRestoreProviderFromPreview: (...args) => summaryRestoreProviderFromPreview(...args),
        summaryRestoreSummaryFromPreview: (...args) => summaryRestoreSummaryFromPreview(...args),
        tooltipHideSubTooltip: (...args) => tooltipHideSubTooltip(...args),
        tooltipIsPinnedTo: (...args) => tooltipIsPinnedTo(...args),
        tooltipPinSubTooltip: (...args) => tooltipPinSubTooltip(...args),
        tooltipPositionSubTooltip: (...args) => tooltipPositionSubTooltip(...args),
        tooltipShowSubTooltip: (...args) => tooltipShowSubTooltip(...args),
    },
});

const insightInteractions = BPMDistributionInsightInteractions.create({
    state: distributionState,
    getPanel: () => panelEl,
    getDonut: () => donutController,
    actions: {
        previewNavigationProvider: (...args) => navigation.previewNavigationProvider(...args),
        selectAllProviders: (...args) => navigation.selectAllProviders(...args),
        selectHeaderProviders: (...args) => navigation.selectHeaderProviders(...args),
        previewFastestProviders: (...args) => navigation.previewFastestProviders(...args),
        selectFastestProviders: (...args) => navigation.selectFastestProviders(...args),
        previewStablePeers: (...args) => navigation.previewStablePeers(...args),
        selectStablePeers: (...args) => navigation.selectStablePeers(...args),
        previewDataProviders: (...args) => navigation.previewDataProviders(...args),
        selectDataProviders: (...args) => navigation.selectDataProviders(...args),
        enterPrivateFromSummary: (...args) => navigation.enterPrivateFromSummary(...args),
        previewFastestProvider: (...args) => navigation.previewFastestProvider(...args),
        selectFastestProvider: (...args) => navigation.selectFastestProvider(...args),
        previewDataProvider: (...args) => navigation.previewDataProvider(...args),
        selectDataProvider: (...args) => navigation.selectDataProvider(...args),
        clearLegendFocus: (...args) => clearLegendFocus(...args),
        hideInsightRect: (...args) => hideInsightRect(...args),
        navigateToProvider: (...args) => navigateToProvider(...args),
        restoreInsightRectProvider: (...args) => restoreInsightRectProvider(...args),
        summaryRestoreDonutAfterPreview: (...args) => summaryRestoreDonutAfterPreview(...args),
        summaryRestoreSummaryFromPreview: (...args) => summaryRestoreSummaryFromPreview(...args),
        tooltipHideSubTooltip: (...args) => tooltipHideSubTooltip(...args),
    },
});

const tooltipController = BPMDistributionTooltips.create({
    getSummaryView: () => summaryView,
    state: distributionState,
    getPanel: () => panelEl,
    actions: {
        clearSecondaryFilter: () => navigation.clearSecondaryFilter(),
        aggregateProvidersForPeers: (...args) => aggregateProvidersForPeers(...args),
        buildFastestProvHtml: (...args) => buildFastestProvHtml(...args),
        buildDataProviderHtml: (...args) => buildDataProviderHtml(...args),
        summaryAttachProviderClickHandlers: (...args) => summaryAttachProviderClickHandlers(...args),
        insightAttachFastestProvRowHandlers: (...args) => insightAttachFastestProvRowHandlers(...args),
        insightAttachDataProviderRowHandlers: (...args) => insightAttachDataProviderRowHandlers(...args),
        summaryAttachProviderNavHandlers: (...args) => summaryAttachProviderNavHandlers(...args),
        tooltipAttachSubSubTooltipHandlers: (...args) => tooltipAttachSubSubTooltipHandlers(...args),
        tooltipAttachSubTooltipHandlers: (...args) => tooltipAttachSubTooltipHandlers(...args),
    },
});

/** Live integration hooks; registration may happen after module construction. */
function getHooks() {
    return {
        get drawLinesForAs() {
            return _drawLinesForAs || undefined;
        },
        get drawLinesForAllAs() {
            return _drawLinesForAllAs || undefined;
        },
        get clearAsLines() {
            return _clearAsLines || undefined;
        },
        get filterPeerTable() {
            return _filterPeerTable || undefined;
        },
        get dimMapPeers() {
            return _dimMapPeers || undefined;
        },
        get zoomToPeerOnly() {
            return _zoomToPeerOnly || undefined;
        },
        get resetMapZoom() {
            return _resetMapZoom || undefined;
        },
        get clearPeerSelection() {
            return _clearPeerSelection || undefined;
        },
        get hideMapTooltip() {
            return _hideMapTooltip || undefined;
        },
        get enterPrivateNetMode() {
            return _enterPrivateNetMode || undefined;
        },
        get showDisconnectDialog() {
            return _showDisconnectDialog || undefined;
        },
    };
}

const navigation = BPMDistributionNavigation.create({
    getCountrySegments: () => countryDonutSegments,
    state: distributionState,
    hooks: getHooks(),
    getPanel: () => panelEl,
    getContainer: () => containerEl,
    getDonut: () => donutController,
    areLegendsHidden: () => legendsHidden,
    getPeerDetail: () => peerDetailController,
    getSegments: () => donutSegments,
    getGroups: () => asGroups,
    getTooltips: () => tooltipController,
    getDashboard: () => dashboard,
    getNetworkPanel: () => distributionNetworkPanel,
    getSummaryView: () => summaryView,
    actions: {
        insightAttachDataProviderRowHandlers: (...args) => insightAttachDataProviderRowHandlers(...args),
        insightAttachFastestProvRowHandlers: (...args) => insightAttachFastestProvRowHandlers(...args),
        animateDonutExpand: (...args) => animateDonutExpand(...args),
        animateDonutRevert: (...args) => animateDonutRevert(...args),
        buildDataProviderHtml: (...args) => buildDataProviderHtml(...args),
        buildFastestProvHtml: (...args) => buildFastestProvHtml(...args),
        buildStablePeersHtml: (...args) => buildStablePeersHtml(...args),
        clearLegendHighlight: (...args) => clearLegendHighlight(...args),
        closePanel: (...args) => closePanel(...args),
        computeSummaryData: (...args) => computeSummaryData(...args),
        findActiveSegment: (...args) => findActiveSegment(...args),
        findActiveSegmentOrGroup: (...args) => findActiveSegmentOrGroup(...args),
        getActiveSegments: (...args) => getActiveSegments(...args),
        getActiveTotalPeers: (...args) => getActiveTotalPeers(...args),
        getColorForActiveEntity: (...args) => getColorForActiveEntity(...args),
        getColorForAsNum: (...args) => getColorForAsNum(...args),
        getInsightDataForActive: (...args) => getInsightDataForActive(...args),
        getPeerIdsForActiveEntity: (...args) => getPeerIdsForActiveEntity(...args),
        getPeerIdsForAnyAs: (...args) => getPeerIdsForAnyAs(...args),
        hideInsightRect: (...args) => hideInsightRect(...args),
        highlightLegendItem: (...args) => highlightLegendItem(...args),
        isCountryLens: (...args) => isCountryLens(...args),
        isOthersSubProvider: (...args) => isOthersSubProvider(...args),
        peersByIds: (...args) => peersByIds(...args),
        renderCenter: (...args) => renderCenter(...args),
        renderCountrySummaryPanel: (...args) => renderCountrySummaryPanel(...args),
        renderDonut: (...args) => renderDonut(...args),
        renderLegend: (...args) => renderLegend(...args),
        renderPanel: (...args) => renderPanel(...args),
        renderSummaryPanel: (...args) => renderSummaryPanel(...args),
        restoreInsightRectProvider: (...args) => restoreInsightRectProvider(...args),
        showFocusedCenterText: (...args) => showFocusedCenterText(...args),
        showInsightRect: (...args) => showInsightRect(...args),
        showLegendHoverCenterText: (...args) => showLegendHoverCenterText(...args),
        showPeerInDonutCenter: (...args) => showPeerInDonutCenter(...args),
        stopDonutAnimation: (...args) => stopDonutAnimation(...args),
        summaryAttachProviderClickHandlers: (...args) => summaryAttachProviderClickHandlers(...args),
        summaryAttachProviderNavHandlers: (...args) => summaryAttachProviderNavHandlers(...args),
        summaryAttachSummaryHandlers: (...args) => summaryAttachSummaryHandlers(...args),
        summaryHighlightActiveSubRow: (...args) => summaryHighlightActiveSubRow(...args),
        summaryHighlightActiveSummaryRow: (...args) => summaryHighlightActiveSummaryRow(...args),
        tooltipAttachSubTooltipHandlers: (...args) => tooltipAttachSubTooltipHandlers(...args),
        tooltipHideSubSubTooltip: (...args) => tooltipHideSubSubTooltip(...args),
        tooltipHideSubTooltip: (...args) => tooltipHideSubTooltip(...args),
        tooltipHighlightSelectedPeerRow: (...args) => tooltipHighlightSelectedPeerRow(...args),
        tooltipIsPinnedTo: (...args) => tooltipIsPinnedTo(...args),
        tooltipPinSecondary: (...args) => tooltipPinSecondary(...args),
        tooltipPinSubTooltip: (...args) => tooltipPinSubTooltip(...args),
        tooltipShowSubSubTooltip: (...args) => tooltipShowSubSubTooltip(...args),
        tooltipShowSubTooltip: (...args) => tooltipShowSubTooltip(...args),
        updateInsightRectForPeer: (...args) => updateInsightRectForPeer(...args),
        updateLensChrome: (...args) => updateLensChrome(...args),
    },
});

function tooltipPinSecondary() {
    tooltipController.tooltipPinSecondary();
}
