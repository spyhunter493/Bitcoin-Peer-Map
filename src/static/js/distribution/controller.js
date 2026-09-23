import { query, queryAll, required, closest } from '../core/dom.js';
import { dashboard as BPMDashboard } from '../core/dashboard-state.js';
import BPMServiceFlags from '../peers/service-flags.js';
import * as BPMFormat from '../core/format.js';
import * as BPMDistributionData from './data.js';
import * as BPMDistributionDonut from './donut.js';
import * as BPMModal from '../core/modal.js';
import * as BPMDistributionNetworkPanel from './network-panel.js';
import * as BPMDistributionCountryPanel from './country-panel.js';
import * as BPMDistributionProviderPanel from './provider-panel.js';
import * as BPMDistributionSummaryPanel from './summary-panel.js';
import * as BPMPeerDetail from '../peers/detail.js';
import * as BPMDomState from '../core/dom-state.js';
import * as BPMPeerFilters from '../peers/filters.js';
const dashboard = BPMDashboard;
let reconciling = false;
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

let othersListOpen = false; // True when Others popup is showing next to the donut
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

// Integration hooks (set by app.js)
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
const parseAsNumber = distributionData.parseAsNumber;
const parseAsOrg = distributionData.parseAsOrg;
const buildDistributionGroup = distributionData.buildDistributionGroup;
const getQuality = distributionDonut.getQuality;
const buildScoreTooltip = distributionDonut.buildScoreTooltip;
const escHtml = BPMModal.escapeHtml;
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
        noun
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
    return { ...data, quality: getQuality(distributionScore) };
}

function computeCountrySummaryData() {
    const data = distributionData.computeCountrySummaryData(countryGroups, countryTotalPeers, countryDistributionScore);
    return { ...data, quality: getQuality(countryDistributionScore) };
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

const escapeHtml = escHtml;
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
    if (distributionState.insightActiveType) donutController.updateInsightPeer(peer, provColor, distributionState.insightActiveType);
}

function restoreInsightRectProvider() {
    if (!donutController.isInsightVisible() || !distributionState.insightActiveType || !distributionState.insightActiveAsNum) return;
    var data = getInsightDataForActive();
    if (data && distributionState.insightActiveType) showInsightRect(distributionState.insightActiveType, data);
    else if (distributionState.insightActiveData) showInsightRect(distributionState.insightActiveType, distributionState.insightActiveData);
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

function closeActiveInsight() {
    hideInsightRect();
    distributionState.insightActiveAsNum = null;
    distributionState.insightActiveData = null;
    distributionState.insightActiveType = null;
    animateDonutRevert();
    renderCenter();
    if (distributionState.summarySelected) summaryClearSummarySubFilter();
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
    if (
        distributionState.insightActiveAsNum &&
        distributionState.summarySelected &&
        !distributionState.selectedProvider &&
        distributionState.donutFocused
    ) {
        if (donutController.isInsightVisible()) {
            var insightData = getInsightDataForActive();
            if (insightData && distributionState.insightActiveType) showInsightRect(distributionState.insightActiveType, insightData);
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
        donutController.renderFilterCenter(distributionState.filterPeerIds.length, distributionState.filterLabel, activePeerTotal);
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
            donutController.renderFilterCenter(distributionState.filterPeerIds.length, distributionState.filterLabel, activePeerTotal);
            return;
        }
        var networkKey = distributionState.activeNetwork;
        var networkPeerCount = dashboard.peers.filter(function (peer) {
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

/** @param {string} asNum */
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
function openCountryPanel(countryId) {
    if (!panelEl) return;
    if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
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
        })
    )
        return;
    showPanel();
}

/** @param {string} asNum */
function openPanel(asNum) {
    if (isCountryLens()) {
        openCountryPanel(asNum);
        return;
    }
    if (!panelEl) return;
    if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
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
    summaryOpenLensSummaryPanel();

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
    distributionState.insightActiveAsNum = null;
    distributionState.insightActiveData = null;
    distributionState.insightActiveType = null;
    tooltipHideSubTooltip();
    tooltipHideSubSubTooltip();
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

/** Get peer IDs for any provider, including those inside Others.
 * @param {string} asNum */
function getPeerIdsForAnyAs(asNum) {
    return providerPanel.peerIdsFor(asNum, donutSegments, asGroups);
}

/** Navigate to a provider's panel (with back button to return)
 * @param {string} asNum */
function navigateToProvider(asNum) {
    // Close any open map peer tooltip when navigating
    if (_hideMapTooltip) _hideMapTooltip();

    // Save current panel state to history
    var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
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
    tooltipHideSubTooltip();
    tooltipHideSubSubTooltip();

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
    distributionState.insightActiveAsNum = null;
    distributionState.insightActiveData = null;
    distributionState.insightActiveType = null;
    distributionState.panelHistory = [];
    tooltipHideSubTooltip();
    tooltipHideSubSubTooltip();
    hideInsightRect();

    if (distributionState.donutFocused) {
        distributionState.summarySelected = true;
        summaryOpenLensSummaryPanel();
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
    var existing = query('.as-detail-back', panelEl);
    if (distributionState.panelHistory.length > 0) {
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
    // Stage 0: If a network panel (IPv4/IPv6) is open, close it and return to summary
    if (distributionState.activeNetwork) {
        distributionState.activeNetwork = null;
        distributionState.selectedProvider = null;
        // If sub-tooltips are open, close those first
        if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
            tooltipHideSubTooltip();
            tooltipHideSubSubTooltip();
            distributionState.filterPeerIds = null;
            distributionState.filterLabel = null;
            distributionState.filterCategory = null;
        }
        // Return to summary view
        distributionState.summarySelected = true;
        distributionState.panelHistory = [];
        summaryOpenLensSummaryPanel();
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
        tooltipHideSubTooltip();
        tooltipHideSubSubTooltip();
        // Restore to main state (summary or single AS)
        if (distributionState.summarySelected) {
            distributionState.filterPeerIds = null;
            distributionState.filterLabel = null;
            distributionState.filterCategory = null;
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            activateHoverAll();
            // Remove active highlights
            var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
            if (bodyEl) {
                var rows = queryAll('.sub-filter-active', bodyEl);
                for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
            }
            // Revert donut expansion and center text (conn-provider sub-filter
            // may have expanded a segment and shown provider name in center)
            animateDonutRevert();
            renderCenter();
            renderLegend();
        } else if (distributionState.selectedProvider) {
            summaryClearSubFilter();
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

/** Go back from an Others sub-provider to the Others segment with popup open */
function backToOthersList() {
    const othersSeg = getActiveSegments().find(function (s) {
        return s.isOthers;
    });
    if (!othersSeg) return;
    // Clear sub-filters
    distributionState.filterPeerIds = null;
    distributionState.filterLabel = null;
    distributionState.filterCategory = null;
    tooltipHideSubTooltip();
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

function clearLegendHoverActive() {
    donutController.clearLegendHover();
}

/** Show scrollable Others provider list as a floating popup to the right of the donut.
 *  Each item is hoverable (preview lines) and clickable (opens provider panel). */
function showOthersListInDonut() {
    const othersSeg = getActiveSegments().find(function (s) {
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
            countSpan.textContent = String(g.peerCount);
            item.appendChild(nameSpan);
            item.appendChild(countSpan);
            item.title =
                (isCountryLens() ? g.countryCode || '' : g.asNumber) +
                ' \u00b7 ' +
                (g.asName || g.asShort || '') +
                ' \u00b7 ' +
                g.peerCount +
                ' peer' +
                (g.peerCount !== 1 ? 's' : '');

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
    var items = queryAll('.as-others-popup-item', popup);
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

/** @param {MouseEvent} e */
function onSegmentHover(e) {
    var asNum = e.currentTarget instanceof Element ? e.currentTarget.getAttribute('data-as') || '' : '';
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
        if (seg && _drawLinesForAs && distributionState.selectedProvider) {
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
    if (distributionState.summarySelected && distributionState.filterPeerIds !== null && !distributionState.selectedProvider) {
        summaryRestoreSummaryFromPreview();
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

/** Add highlight class to the matching legend item
 * @param {string} asNum */
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

/** @param {MouseEvent} e */
function onSegmentClick(e) {
    var asNum = e.currentTarget instanceof Element ? e.currentTarget.getAttribute('data-as') || '' : '';
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
            tooltipHideSubTooltip();
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
        tooltipHideSubTooltip();
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
    tooltipHideSubTooltip();
    hideInsightRect();
    closePanel();
    if (containerEl) containerEl.classList.remove('as-legend-visible');
    if (_filterPeerTable) _filterPeerTable(null);
    if (_dimMapPeers) _dimMapPeers(null);
    if (_clearAsLines) _clearAsLines();
    if (donutController.getAnimationState() !== 'idle' && donutController.getAnimationState() !== 'reverting') {
        animateDonutRevert();
    } else {
        renderDonut();
    }
    renderCenter();
    renderLegend();
}

/** @param {KeyboardEvent} e */
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
            tooltipHideSubSubTooltip();
            // Restore to parent sub-filter state
            if (distributionState.summarySelected && distributionState.filterPeerIds !== null) {
                if (_filterPeerTable) _filterPeerTable(distributionState.filterPeerIds);
                if (_dimMapPeers) _dimMapPeers(distributionState.filterPeerIds);
                // Re-draw lines for the parent sub-filter (not all lines)
                if (_drawLinesForAllAs && donutSegments.length > 0) {
                    /** @type {Record<number, boolean>} */
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
            tooltipHideSubTooltip();
            // Restore to full summary or AS state
            if (distributionState.summarySelected) {
                summaryClearSummarySubFilter();
            } else if (distributionState.selectedProvider) {
                summaryClearSubFilter();
            }
            return;
        }
        // If a network panel is open, Escape goes back to summary
        if (distributionState.activeNetwork) {
            distributionState.activeNetwork = null;
            distributionState.selectedProvider = null;
            if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
                tooltipHideSubTooltip();
                tooltipHideSubSubTooltip();
                distributionState.filterPeerIds = null;
                distributionState.filterLabel = null;
                distributionState.filterCategory = null;
            }
            distributionState.summarySelected = true;
            distributionState.panelHistory = [];
            summaryOpenLensSummaryPanel();
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

/** @param {boolean} [restoreFocus] */
function dismissPeerDetailView(restoreFocus) {
    distributionState.peerDetailActive = false;
    distributionState.selectedPeerId = null;
    peerDetailController.close({ restoreFocus: restoreFocus !== false });
}

/** @param {import('../types').Peer} peer */
function previewPeerInPopup(peer) {
    if (distributionState.peerDetailActive) peerDetailController.previewPeer(peer);
}

function restorePeerPopupToSelected() {
    peerDetailController.restorePreview();
}

/** @param {boolean} [skipZoomReset] */
function closePeerPopup(skipZoomReset) {
    dismissPeerDetailView(!skipZoomReset);

    if (distributionState.summarySelected) {
        if (distributionState.insightActiveAsNum) {
            var peerIds = getPeerIdsForAnyAs(distributionState.insightActiveAsNum);
            var color = getColorForAsNum(distributionState.insightActiveAsNum);
            if (_drawLinesForAs) _drawLinesForAs(distributionState.insightActiveAsNum, peerIds, color);
            if (_filterPeerTable) _filterPeerTable(peerIds);
            if (_dimMapPeers) _dimMapPeers(peerIds);
        } else if (distributionState.filterPeerIds !== null) {
            summaryPreviewSummaryLines(distributionState.filterPeerIds);
        } else {
            if (_filterPeerTable) _filterPeerTable(null);
            if (_dimMapPeers) _dimMapPeers(null);
            activateHoverAll();
        }
        renderCenter();
    } else if (distributionState.selectedProvider) {
        var seg = donutSegments.find(function (item) {
            return item.asNumber === distributionState.selectedProvider;
        });
        if (!seg) {
            var group = asGroups.find(function (item) {
                return item.asNumber === distributionState.selectedProvider;
            });
            if (group) {
                var others = donutSegments.find(function (item) {
                    return item.isOthers;
                });
                seg = {
                    ...group,
                    asNumber: distributionState.selectedProvider,
                    peerIds: group.peerIds,
                    color: others ? others.color : '#58a6ff',
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
    queryAll('.as-sub-tt-peer-selected', document).forEach(function (element) {
        element.classList.remove('as-sub-tt-peer-selected');
    });
}

/** @param {number[]} peerIds */
function openMultiPeerPopup(peerIds) {
    distributionState.peerDetailActive = true;
    distributionState.selectedPeerId = null;
    peerDetailController.openGroup(peerIds);
}

/** @param {import('../types').Peer} peer
 * @param {string} source
 * @param {number[]} [groupPeerIds] */
function openPeerDetailPanel(peer, source, groupPeerIds) {
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
    if (groupPeerIds) peerDetailController.openGroup(groupPeerIds);
    peerDetailController.openPeer(peer.id, source);
}

/** Show peer ID and provider in donut center
 * @param {import('../types').Peer} peer
 * @param {string} color */
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
    tooltipHideSubTooltip();
    tooltipHideSubSubTooltip();
    hideInsightRect();
    closePanel();
    deactivateHoverAll();
    stopDonutAnimation();
    if (_filterPeerTable) _filterPeerTable(null);
    if (_dimMapPeers) _dimMapPeers(null);
    if (_clearAsLines) _clearAsLines();
    if (containerEl) containerEl.classList.remove('as-legend-visible');
}

/**
 * @param {string} lens
 */
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
    panelEl?.addEventListener(
        'click',
        (event) => {
            const row = closest('[data-filter]', event.target);
            if (row) distributionState.filterDescriptor = JSON.parse(row.dataset.filter || 'null');
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
                setDistributionLens(e.currentTarget instanceof Element ? e.currentTarget.getAttribute('data-lens') || '' : '');
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
            distributionState.focusedHoverProvider = null;
            renderCenter();
        }
    });

    updateLensChrome();
}

/** Register integration callbacks from app.js
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

// summary interactions owned by this distribution controller.
function summaryOpenLensSummaryPanel() {
    if (isCountryLens()) summaryOpenCountrySummaryPanel();
    else summaryOpenSummaryPanel();
}

function summaryOpenCountrySummaryPanel() {
    if (!panelEl) return;
    if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
    renderBackButton();
    var bodyEl = summaryView.renderCountry(computeCountrySummaryData());
    if (!bodyEl) return;
    summaryAttachCountrySummaryRowHandlers(bodyEl);
    summaryAttachPanelBlankClickHandler(bodyEl);
}

/** @param {HTMLElement} bodyEl */
function summaryAttachCountrySummaryRowHandlers(bodyEl) {
    var rows = queryAll('.as-country-summary-row', bodyEl);
    for (var ri = 0; ri < rows.length; ri++) {
        (function (rowEl) {
            rowEl.addEventListener('mouseenter', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                var countryId = rowEl.dataset.as || '';
                var seg = findActiveSegmentOrGroup(countryId);
                if (!seg) return;
                highlightLegendItem(countryId);
                if (_filterPeerTable) _filterPeerTable(seg.peerIds);
                if (_dimMapPeers) _dimMapPeers(seg.peerIds);
                if (_drawLinesForAs) _drawLinesForAs(countryId, seg.peerIds, seg.color);
                if (distributionState.donutFocused) {
                    distributionState.focusedHoverProvider = countryId;
                    showFocusedCenterText(countryId);
                }
            });
            rowEl.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
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
                if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
                var countryId = rowEl.dataset.as || '';
                var seg = findActiveSegmentOrGroup(countryId);
                if (!seg) return;

                var scrollTop = bodyEl ? bodyEl.scrollTop : 0;
                distributionState.panelHistory = [{ type: 'summary', scrollTop: scrollTop }];
                distributionState.summarySelected = false;
                distributionState.selectedProvider = countryId;
                distributionState.filterPeerIds = null;
                distributionState.filterLabel = null;
                distributionState.filterCategory = null;
                tooltipHideSubTooltip();
                tooltipHideSubSubTooltip();

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

function summaryOpenSummaryPanel() {
    if (!panelEl) return;
    if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
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

/** @param {HTMLElement} bodyEl */
function summaryAttachPanelBlankClickHandler(bodyEl) {
    bodyEl.addEventListener('click', function (e) {
        if (!(e.target instanceof Element)) return;
        // Only close if clicking on the body itself, not on interactive children
        if (
            e.target === bodyEl ||
            e.target.classList.contains('modal-section-title') ||
            e.target.classList.contains('modal-row') ||
            e.target.classList.contains('modal-label') ||
            e.target.classList.contains('modal-val')
        ) {
            if (distributionState.subTooltipPinned || distributionState.subSubTooltipPinned) {
                tooltipHideSubTooltip();
                tooltipHideSubSubTooltip();
                if (distributionState.summarySelected) {
                    distributionState.filterPeerIds = null;
                    distributionState.filterLabel = null;
                    distributionState.filterCategory = null;
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    activateHoverAll();
                    var rows = queryAll('.sub-filter-active', bodyEl);
                    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('sub-filter-active');
                } else if (distributionState.selectedProvider) {
                    summaryClearSubFilter();
                }
            }
        }
    });
}

/** @param {HTMLElement} bodyEl
 * @param {import('../types').DistributionSegment} seg */
function summaryAttachInteractiveRowHandlers(bodyEl, seg) {
    var rows = queryAll('.as-interactive-row', bodyEl);
    for (var ri = 0; ri < rows.length; ri++) {
        (function (rowEl) {
            rowEl.addEventListener('mouseenter', function (e) {
                // When something is selected (pinned) or peer detail is open, suppress hover previews
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                var category = rowEl.dataset.category || '';
                var label = required('.as-detail-sub-label', rowEl).textContent;
                var html = summaryBuildPeerSummaryHtml(peerIds, category, label);
                tooltipShowSubTooltip(html, e);
                // Preview lines/filter for hovered sub-row
                summaryPreviewProviderLines(peerIds);
            });
            rowEl.addEventListener('mousemove', function (e) {
                if (!distributionState.subTooltipPinned) tooltipPositionSubTooltip(e);
            });
            rowEl.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                tooltipHideSubTooltip();
                summaryRestoreProviderFromPreview();
            });
            rowEl.addEventListener('click', function (e) {
                e.stopPropagation();
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                var category = rowEl.dataset.category || '';
                var label = required('.as-detail-sub-label', rowEl).textContent;
                // Toggle: clicking same row unpins
                if (tooltipIsPinnedTo(rowEl)) {
                    tooltipHideSubTooltip();
                    summaryClearSubFilter();
                    return;
                }
                summaryApplySubFilter(peerIds, category, label);
                var html = summaryBuildPeerSummaryHtml(peerIds, category, label);
                tooltipShowSubTooltip(html, e);
                tooltipPinSubTooltip(rowEl);
            });
        })(rows[ri]);
    }
}

function summaryRestoreDonutAfterPreview() {
    distributionState.summaryPreviewPeerIds = null;
    distributionState.summaryPreviewLabel = null;
    if (!distributionState.donutFocused) return;
    if (distributionState.subSubFilterProvider && distributionState.subSubTooltipPinned) {
        // A Level 3 provider is selected (sub-sub pinned) — keep donut on that provider
        showFocusedCenterText(distributionState.subSubFilterProvider);
        animateDonutExpand(distributionState.subSubFilterProvider);
    } else if (distributionState.insightActiveAsNum) {
        // An insight is active (Most Stable, Fastest, etc.) — keep donut on that provider
        if (donutController.isInsightVisible()) {
            restoreInsightRectProvider();
        }
        showFocusedCenterText(distributionState.insightActiveAsNum);
        animateDonutExpand(distributionState.insightActiveAsNum);
    } else if (
        distributionState.filterCategory &&
        distributionState.filterCategory.indexOf('conn-') === 0 &&
        distributionState.filterLabel
    ) {
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

/** @param {number[]} peerIds */
function summaryPreviewSummaryLines(peerIds) {
    if (_filterPeerTable) _filterPeerTable(peerIds);
    if (_dimMapPeers) _dimMapPeers(peerIds);
    if (_drawLinesForAllAs && donutSegments.length > 0) {
        /** @type {Record<number, boolean>} */
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

/** @param {number[]} peerIds */
function summaryPreviewProviderLines(peerIds) {
    if (_filterPeerTable) _filterPeerTable(peerIds);
    if (_dimMapPeers) _dimMapPeers(peerIds);
    if (distributionState.selectedProvider && _drawLinesForAs) {
        var color = getColorForActiveEntity(distributionState.selectedProvider);
        _drawLinesForAs(distributionState.selectedProvider, peerIds, color);
    }
}

/** @param {number[]} peerIds
 * @param {string} label */
function summaryPreviewSummaryCenterText(peerIds, label) {
    if (!distributionState.donutFocused) return;
    distributionState.summaryPreviewPeerIds = peerIds;
    distributionState.summaryPreviewLabel = label;
    donutController.renderFilterCenter(peerIds.length, label, getActiveTotalPeers());
}

function summaryRestoreSummaryFromPreview() {
    // Don't restore if big peer popup is active — it manages its own line state
    if (distributionState.peerDetailActive) return;
    if (distributionState.subSubFilterPeerIds && distributionState.subSubFilterProvider) {
        // Was showing sub-sub (e.g. a specific provider within a category)
        var ssColor = distributionState.subSubFilterColor || getColorForAsNum(distributionState.subSubFilterProvider);
        if (_drawLinesForAs) _drawLinesForAs(distributionState.subSubFilterProvider, distributionState.subSubFilterPeerIds, ssColor);
        if (_filterPeerTable) _filterPeerTable(distributionState.subSubFilterPeerIds);
        if (_dimMapPeers) _dimMapPeers(distributionState.subSubFilterPeerIds);
    } else if (distributionState.filterPeerIds !== null) {
        // Was showing a category filter (e.g. IPv6)
        summaryPreviewSummaryLines(distributionState.filterPeerIds);
    } else if (
        distributionState.subTooltipPinned &&
        (distributionState.filterCategory === 'insight-fastest' ||
            (distributionState.filterCategory && distributionState.filterCategory.indexOf('insight-data-') === 0))
    ) {
        // Rank list pinned — default to showing #1 ranked provider
        var tip = document.getElementById('as-sub-tooltip');
        if (tip) {
            var firstRow = query('.as-fastest-prov-row, .as-data-prov-row', tip);
            if (firstRow) {
                var asNum = firstRow.dataset.as || '';
                /** @type {number[]} */
                var peerIds = JSON.parse(firstRow.dataset.peerIds || '[]');
                if (asNum) setLegendFocus(asNum);
                if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                    _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                }
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
                if (distributionState.donutFocused && asNum && donutController.isInsightVisible()) {
                    restoreInsightRectProvider();
                } else if (distributionState.donutFocused && asNum) {
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
    } else if (distributionState.insightActiveAsNum) {
        // Insight is active (e.g. Most Stable clicked) — restore to showing the insight's provider
        var asNum = distributionState.insightActiveAsNum;
        var peerIds = getPeerIdsForAnyAs(asNum);
        var color = getColorForAsNum(asNum);
        if (asNum) setLegendFocus(asNum);
        if (peerIds.length > 0 && _drawLinesForAs) {
            _drawLinesForAs(asNum, peerIds, color);
        }
        if (_filterPeerTable) _filterPeerTable(peerIds);
        if (_dimMapPeers) _dimMapPeers(peerIds);
        if (distributionState.donutFocused && donutController.isInsightVisible()) {
            restoreInsightRectProvider();
        } else if (distributionState.donutFocused) {
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

function summaryRestoreProviderFromPreview() {
    // Don't restore if big peer popup is active — it manages its own line state
    if (distributionState.peerDetailActive) return;
    if (distributionState.filterPeerIds !== null) {
        summaryPreviewProviderLines(distributionState.filterPeerIds);
    } else if (distributionState.selectedProvider) {
        var allPeerIds = getPeerIdsForActiveEntity(distributionState.selectedProvider);
        var color = getColorForActiveEntity(distributionState.selectedProvider);
        if (_filterPeerTable) _filterPeerTable(allPeerIds);
        if (_dimMapPeers) _dimMapPeers(allPeerIds);
        if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, allPeerIds, color);
    }
}

/** @param {HTMLElement} bodyEl */
function summaryAttachSummaryRowHandlers(bodyEl) {
    var rows = queryAll('.as-summary-row', bodyEl);
    for (var ri = 0; ri < rows.length; ri++) {
        (function (rowEl) {
            rowEl.addEventListener('mouseenter', function (e) {
                // When something is selected (pinned) or peer detail is open, suppress hover previews
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                /** @type {Parameters<typeof summaryView.buildProviderListHtml>[0]} */
                var providers = JSON.parse(rowEl.dataset.providers || '');
                var catLabel = rowEl.dataset.catLabel || '';
                var html = summaryView.buildProviderListHtml(providers, catLabel);
                tooltipShowSubTooltip(html, e);
                // Preview lines/filter for hovered category
                summaryPreviewSummaryLines(peerIds);
                // Preview category info in donut center
                summaryPreviewSummaryCenterText(peerIds, catLabel);
            });
            rowEl.addEventListener('mousemove', function (e) {
                if (!distributionState.subTooltipPinned) tooltipPositionSubTooltip(e);
            });
            rowEl.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                tooltipHideSubTooltip();
                summaryRestoreSummaryFromPreview();
                summaryRestoreDonutAfterPreview();
            });
            rowEl.addEventListener('click', function (e) {
                e.stopPropagation();
                if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                /** @type {Parameters<typeof summaryView.buildProviderListHtml>[0]} */
                var providers = JSON.parse(rowEl.dataset.providers || '');
                var catLabel = rowEl.dataset.catLabel || '';

                // Toggle: clicking same row unpins
                if (tooltipIsPinnedTo(rowEl)) {
                    tooltipHideSubTooltip();
                    summaryClearSummarySubFilter();
                    summaryRestoreDonutAfterPreview();
                    return;
                }

                // Apply sub-filter for all peers in this category
                summaryApplySummarySubFilter(peerIds, catLabel);

                // Immediately update the donut to reflect the new category
                summaryRestoreDonutAfterPreview();

                // Pin the sub-tooltip with provider list
                var html = summaryView.buildProviderListHtml(providers, catLabel);
                tooltipShowSubTooltip(html, e);
                tooltipPinSubTooltip(rowEl);
                summaryAttachProviderClickHandlers(required('#as-sub-tooltip'));
            });
            rowEl.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                rowEl.click();
            });
        })(rows[ri]);
    }
}

/** @param {HTMLElement} tip */
function summaryAttachProviderClickHandlers(tip) {
    var provRows = queryAll('.as-provider-row', tip);
    for (var pi = 0; pi < provRows.length; pi++) {
        (function (provRow) {
            provRow.style.cursor = 'pointer';
            // Hover preview: show lines + filter for this provider's peers
            provRow.addEventListener('mouseenter', function () {
                if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                var asNum = provRow.dataset.as || '';
                /** @type {number[]} */
                var peerIds = JSON.parse(provRow.dataset.peerIds || '');
                // Focus legend on this provider
                if (asNum) setLegendFocus(asNum);
                if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                    _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                }
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
                // In focused mode, show provider in donut center + animate
                if (distributionState.donutFocused && asNum) {
                    showFocusedCenterText(asNum);
                    animateDonutExpand(asNum);
                }
            });
            provRow.addEventListener('mouseleave', function () {
                if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                clearLegendFocus();
                summaryRestoreSummaryFromPreview();
                summaryRestoreDonutAfterPreview();
            });
            provRow.addEventListener('click', function (e) {
                e.stopPropagation();
                /** @type {number[]} */
                var peerIds = JSON.parse(provRow.dataset.peerIds || '');

                // Find matching peer objects from lastPeersRaw
                var matchedPeers = peersByIds(peerIds);

                var asNum = provRow.dataset.as || '';
                // Keep legend focused on this provider while sub-sub is pinned
                distributionState.legendFocusProvider = asNum;
                renderLegend();

                // Highlight this provider row as selected in the sub-tooltip
                var tip = document.getElementById('as-sub-tooltip');
                if (tip) {
                    var prevSel = queryAll('.as-provider-row-selected', tip);
                    for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
                }
                provRow.classList.add('as-provider-row-selected');

                var html = summaryView.buildPeerListHtmlForSubSub(matchedPeers);
                tooltipShowSubSubTooltip(html, e);
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
    var pnLinks = queryAll('.as-private-net-link', tip);
    for (var pnli = 0; pnli < pnLinks.length; pnli++) {
        (function (linkEl) {
            linkEl.addEventListener('click', function (e) {
                e.stopPropagation();
                var netKey = linkEl.dataset.net || '';
                if (_enterPrivateNetMode && netKey) _enterPrivateNetMode(netKey);
            });
        })(pnLinks[pnli]);
    }
}

/** @param {HTMLElement} bodyEl */
function summaryAttachGridHandlers(bodyEl) {
    // Provider total rows — hover/click shows all peers for this provider
    var connProvRows = queryAll('.as-conn-prov-row', bodyEl);
    for (var cpi = 0; cpi < connProvRows.length; cpi++) {
        (function (rowEl) {
            function buildProvPeerHtml() {
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                if (peerIds.length === 0) return null;
                var asNum = rowEl.dataset.as || '';
                var matchedPeers = peersByIds(peerIds);
                // Find the provider name for the header
                var provName = asNum;
                var grp = asGroups.find(function (g) {
                    return g.asNumber === asNum;
                });
                if (grp) provName = grp.asShort || grp.asName || asNum;
                var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                html +=
                    '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' +
                    escapeHtml(provName) +
                    ' Peers</div>';
                html +=
                    '<div class="as-sub-tt-nav as-grid-provider-click" data-as="' +
                    asNum +
                    '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open provider panel</div>';
                html += '</div>';
                html += summaryView.buildPeerListHtmlForSubSub(matchedPeers);
                return html;
            }
            rowEl.addEventListener('mouseenter', function (e) {
                // When something is selected (pinned) or peer detail is open, suppress hover previews
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                var asNum = rowEl.dataset.as || '';
                if (asNum) setLegendFocus(asNum);
                var html = buildProvPeerHtml();
                if (html) tooltipShowSubTooltip(html, e);
                // Preview lines for this provider
                if (asNum && peerIds.length > 0) {
                    var color = getColorForAsNum(asNum);
                    if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                }
                if (distributionState.donutFocused && asNum) {
                    showFocusedCenterText(asNum);
                    animateDonutExpand(asNum);
                }
            });
            rowEl.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                clearLegendFocus();
                tooltipHideSubTooltip();
                summaryRestoreSummaryFromPreview();
                summaryRestoreDonutAfterPreview();
            });
            rowEl.addEventListener('click', function (e) {
                e.stopPropagation();
                if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
                if (tooltipIsPinnedTo(rowEl)) {
                    tooltipHideSubTooltip();
                    distributionState.filterPeerIds = null;
                    distributionState.filterCategory = null;
                    distributionState.filterLabel = null;
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (distributionState.summarySelected) activateHoverAll();
                    summaryRestoreDonutAfterPreview();
                    return;
                }
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                var html = buildProvPeerHtml();
                if (!html) return;
                tooltipShowSubTooltip(html, e);
                tooltipPinSubTooltip(rowEl);
                tooltipAttachSubTooltipHandlers();
                var tipEl = document.getElementById('as-sub-tooltip');
                if (tipEl) summaryAttachProviderNavHandlers(tipEl);
                // Clear any active insight state when selecting a provider
                if (distributionState.insightActiveAsNum || distributionState.insightActiveType) {
                    distributionState.insightActiveAsNum = null;
                    distributionState.insightActiveData = null;
                    distributionState.insightActiveType = null;
                    hideInsightRect();
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
                if (distributionState.donutFocused && asNum) {
                    showFocusedCenterText(asNum);
                    animateDonutExpand(asNum);
                }
            });
        })(connProvRows[cpi]);
    }

    // Out rows — hover/click shows outbound subtypes breakdown
    var connOutRows = queryAll('.as-conn-out-row', bodyEl);
    for (var coi = 0; coi < connOutRows.length; coi++) {
        (function (rowEl) {
            function buildOutSubHtml() {
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                if (peerIds.length === 0) return null;
                /** @type {{label: string; count: number}[]} */
                var subtypes = JSON.parse(rowEl.dataset.outSubtypes || '');
                var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Outbound Peers</div>';
                html += '</div>';
                html += '<div class="as-sub-tt-scroll">';
                for (var si = 0; si < subtypes.length; si++) {
                    var st = subtypes[si];
                    html += '<div class="as-sub-tt-peer">';
                    html += '<span class="as-sub-tt-id" style="font-weight:600; min-width:60px">' + escapeHtml(st.label) + '</span>';
                    html += '<span class="as-sub-tt-type">' + st.count + ' peer' + (st.count !== 1 ? 's' : '') + '</span>';
                    html += '</div>';
                }
                html += '</div>';
                // Also include full peer list below subtypes
                var matchedPeers = peersByIds(peerIds);
                html += '<div style="border-top:1px solid rgba(88,166,255,0.1); margin-top:4px; padding-top:4px">';
                html += summaryView.buildPeerListHtmlForSubSub(matchedPeers);
                html += '</div>';
                return html;
            }
            rowEl.addEventListener('mouseenter', function (e) {
                // When something is selected (pinned) or peer detail is open, suppress hover previews
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                var asNum = rowEl.dataset.as || '';
                if (asNum) setLegendFocus(asNum);
                var html = buildOutSubHtml();
                if (html) tooltipShowSubTooltip(html, e);
                if (asNum && peerIds.length > 0) {
                    var color = getColorForAsNum(asNum);
                    if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                }
                if (distributionState.donutFocused && asNum) {
                    showFocusedCenterText(asNum);
                    animateDonutExpand(asNum);
                }
            });
            rowEl.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                clearLegendFocus();
                tooltipHideSubTooltip();
                summaryRestoreSummaryFromPreview();
                summaryRestoreDonutAfterPreview();
            });
            rowEl.addEventListener('click', function (e) {
                e.stopPropagation();
                if (tooltipIsPinnedTo(rowEl)) {
                    tooltipHideSubTooltip();
                    distributionState.filterPeerIds = null;
                    distributionState.filterCategory = null;
                    distributionState.filterLabel = null;
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (distributionState.summarySelected) activateHoverAll();
                    summaryRestoreDonutAfterPreview();
                    return;
                }
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                var html = buildOutSubHtml();
                if (!html) return;
                tooltipShowSubTooltip(html, e);
                tooltipPinSubTooltip(rowEl);
                tooltipAttachSubTooltipHandlers();
                // Clear insight state
                if (distributionState.insightActiveAsNum || distributionState.insightActiveType) {
                    distributionState.insightActiveAsNum = null;
                    distributionState.insightActiveData = null;
                    distributionState.insightActiveType = null;
                    hideInsightRect();
                }
                var activeBodyOut = panelEl ? query('.as-detail-body', panelEl) : null;
                if (activeBodyOut) {
                    var prev = queryAll('.sub-filter-active', activeBodyOut);
                    for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
                }
                // Highlight this row as the active selection
                rowEl.classList.add('sub-filter-active');
                // Track sub-filter state for data refresh preservation
                distributionState.filterPeerIds = peerIds;
                distributionState.filterCategory = 'conn-out';
                distributionState.filterLabel = rowEl.dataset.as || '';
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
                // Keep donut expanded for the parent provider
                var asNum = rowEl.dataset.as || '';
                if (distributionState.donutFocused && asNum) {
                    showFocusedCenterText(asNum);
                    animateDonutExpand(asNum);
                }
            });
        })(connOutRows[coi]);
    }

    // In rows already have .as-interactive-row class — handled by attachInteractiveRowHandlers if in provider panel,
    // but here in summary we need explicit handling. The .as-conn-dir-row In rows:
    var connDirRows = queryAll('.as-conn-dir-row', bodyEl);
    for (var cdi = 0; cdi < connDirRows.length; cdi++) {
        (function (rowEl) {
            function buildDirPeerHtml() {
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                if (peerIds.length === 0) return null;
                var matchedPeers = peersByIds(peerIds);
                var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Inbound Peers</div>';
                html += '</div>';
                html += summaryView.buildPeerListHtmlForSubSub(matchedPeers);
                return html;
            }
            rowEl.addEventListener('mouseenter', function (e) {
                // When something is selected (pinned) or peer detail is open, suppress hover previews
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                var asNum = rowEl.dataset.as || '';
                if (asNum) setLegendFocus(asNum);
                var html = buildDirPeerHtml();
                if (html) tooltipShowSubTooltip(html, e);
                if (asNum && peerIds.length > 0) {
                    var color = getColorForAsNum(asNum);
                    if (_drawLinesForAs) _drawLinesForAs(asNum, peerIds, color);
                    if (_filterPeerTable) _filterPeerTable(peerIds);
                    if (_dimMapPeers) _dimMapPeers(peerIds);
                }
                if (distributionState.donutFocused && asNum) {
                    showFocusedCenterText(asNum);
                    animateDonutExpand(asNum);
                }
            });
            rowEl.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                clearLegendFocus();
                tooltipHideSubTooltip();
                summaryRestoreSummaryFromPreview();
                summaryRestoreDonutAfterPreview();
            });
            rowEl.addEventListener('click', function (e) {
                e.stopPropagation();
                if (tooltipIsPinnedTo(rowEl)) {
                    tooltipHideSubTooltip();
                    distributionState.filterPeerIds = null;
                    distributionState.filterCategory = null;
                    distributionState.filterLabel = null;
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (distributionState.summarySelected) activateHoverAll();
                    summaryRestoreDonutAfterPreview();
                    return;
                }
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                var html = buildDirPeerHtml();
                if (!html) return;
                tooltipShowSubTooltip(html, e);
                tooltipPinSubTooltip(rowEl);
                tooltipAttachSubTooltipHandlers();
                // Clear insight state
                if (distributionState.insightActiveAsNum || distributionState.insightActiveType) {
                    distributionState.insightActiveAsNum = null;
                    distributionState.insightActiveData = null;
                    distributionState.insightActiveType = null;
                    hideInsightRect();
                }
                var activeBodyIn = panelEl ? query('.as-detail-body', panelEl) : null;
                if (activeBodyIn) {
                    var prev = queryAll('.sub-filter-active', activeBodyIn);
                    for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
                }
                // Highlight this row as the active selection
                rowEl.classList.add('sub-filter-active');
                // Track sub-filter state for data refresh preservation
                distributionState.filterPeerIds = peerIds;
                distributionState.filterCategory = 'conn-in';
                distributionState.filterLabel = rowEl.dataset.as || '';
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
                // Keep donut expanded for the parent provider
                var asNum = rowEl.dataset.as || '';
                if (distributionState.donutFocused && asNum) {
                    showFocusedCenterText(asNum);
                    animateDonutExpand(asNum);
                }
            });
        })(connDirRows[cdi]);
    }

    // Others row — 3-level: hover/click shows provider list, then provider → peer list
    var connOthersRows = queryAll('.as-conn-others-row', bodyEl);
    for (var coi2 = 0; coi2 < connOthersRows.length; coi2++) {
        (function (rowEl) {
            rowEl.addEventListener('mouseenter', function (e) {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                /** @type {Parameters<typeof summaryView.buildProviderListHtml>[0]} */
                var providers = JSON.parse(rowEl.dataset.providers || '');
                var html = summaryView.buildProviderListHtml(providers, 'Others', 'Others');
                tooltipShowSubTooltip(html, e);
                summaryPreviewSummaryLines(peerIds);
                summaryPreviewSummaryCenterText(peerIds, 'Others');
            });
            rowEl.addEventListener('mousemove', function (e) {
                if (!distributionState.subTooltipPinned) tooltipPositionSubTooltip(e);
            });
            rowEl.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                tooltipHideSubTooltip();
                summaryRestoreSummaryFromPreview();
                summaryRestoreDonutAfterPreview();
            });
            rowEl.addEventListener('click', function (e) {
                e.stopPropagation();
                if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
                /** @type {number[]} */
                var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                /** @type {Parameters<typeof summaryView.buildProviderListHtml>[0]} */
                var providers = JSON.parse(rowEl.dataset.providers || '');

                // Toggle: clicking same row unpins
                if (tooltipIsPinnedTo(rowEl)) {
                    tooltipHideSubTooltip();
                    distributionState.filterPeerIds = null;
                    distributionState.filterCategory = null;
                    distributionState.filterLabel = null;
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (distributionState.summarySelected) activateHoverAll();
                    summaryRestoreDonutAfterPreview();
                    return;
                }

                // Clear insight state
                if (distributionState.insightActiveAsNum || distributionState.insightActiveType) {
                    distributionState.insightActiveAsNum = null;
                    distributionState.insightActiveData = null;
                    distributionState.insightActiveType = null;
                    hideInsightRect();
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
                distributionState.filterPeerIds = peerIds;
                distributionState.filterCategory = 'conn-others';
                distributionState.filterLabel = 'Others';

                // Draw lines grouped by AS for the Others peers
                if (_drawLinesForAllAs && donutSegments.length > 0) {
                    /** @type {Record<number, boolean>} */
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

                summaryRestoreDonutAfterPreview();

                // Pin the sub-tooltip with provider list + "Open Others panel" nav link
                var html = summaryView.buildProviderListHtml(providers, 'Others', 'Others');
                tooltipShowSubTooltip(html, e);
                tooltipPinSubTooltip(rowEl);
                const tipEl2 = required('#as-sub-tooltip');
                summaryAttachProviderClickHandlers(tipEl2);
                summaryAttachProviderNavHandlers(tipEl2);
            });
        })(connOthersRows[coi2]);
    }
}

/** @param {HTMLElement} tip */
function summaryAttachProviderNavHandlers(tip) {
    var provRows = queryAll('.as-provider-row', tip);
    for (var i = 0; i < provRows.length; i++) {
        (function (provRow) {
            var nameEl = query('.as-provider-click', provRow);
            if (nameEl) {
                nameEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var asNum = provRow.dataset.as || '';
                    if (asNum) {
                        tooltipHideSubTooltip();
                        navigateToProvider(asNum);
                    }
                });
            }
        })(provRows[i]);
    }
    // Also handle standalone provider-click links (e.g. "Open provider panel" in sub-tooltips)
    var provClicks = queryAll('.as-grid-provider-click', tip);
    for (var i = 0; i < provClicks.length; i++) {
        (function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                var asNum = el.dataset.as || '';
                if (asNum) {
                    tooltipHideSubTooltip();
                    navigateToProvider(asNum);
                }
            });
        })(provClicks[i]);
    }
}

/** @param {number[]} peerIds
 * @param {string} label */
function summaryApplySummarySubFilter(peerIds, label) {
    // Close peer detail popup when selecting from panel
    if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
    if (distributionState.filterPeerIds && label === distributionState.filterLabel) {
        summaryClearSummarySubFilter();
        return;
    }
    // Clear any active insight state when switching to a different category
    if (distributionState.insightActiveAsNum || distributionState.insightActiveType) {
        distributionState.insightActiveAsNum = null;
        distributionState.insightActiveData = null;
        distributionState.insightActiveType = null;
        hideInsightRect();
        if (distributionState.donutFocused) animateDonutRevert();
    }
    distributionState.filterPeerIds = peerIds;
    distributionState.filterCategory = 'summary';
    distributionState.filterLabel = label;
    if (_filterPeerTable) _filterPeerTable(peerIds);
    if (_dimMapPeers) _dimMapPeers(peerIds);
    // Draw lines for the filtered peers — group by AS for colored lines
    if (_drawLinesForAllAs && donutSegments.length > 0) {
        /** @type {Record<number, boolean>} */
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
    summaryHighlightActiveSummaryRow();
    // Zoom map out to world view when selecting a new category
    if (_resetMapZoom) _resetMapZoom();
}

function summaryClearSummarySubFilter() {
    distributionState.filterPeerIds = null;
    distributionState.filterLabel = null;
    distributionState.filterCategory = null;
    distributionState.insightActiveAsNum = null;
    distributionState.insightActiveData = null;
    distributionState.insightActiveType = null;
    tooltipHideSubTooltip();
    hideInsightRect();
    // Restore to showing all peers
    if (_filterPeerTable) _filterPeerTable(null);
    if (_dimMapPeers) _dimMapPeers(null);
    // Re-draw all lines
    if (distributionState.summarySelected) activateHoverAll();
    // Remove active highlights from both summary rows and insight rows
    var bodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
    if (bodyEl) {
        var rows = queryAll('.sub-filter-active', bodyEl);
        for (var ri = 0; ri < rows.length; ri++) rows[ri].classList.remove('sub-filter-active');
    }
    // Revert donut expansion and center text (a conn-provider sub-filter
    // may have expanded a segment and shown provider name in center)
    animateDonutRevert();
    renderCenter();
    renderLegend();
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
    if (distributionState.filterCategory && distributionState.filterCategory.indexOf('conn-') === 0 && distributionState.filterLabel) {
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

/** @param {number[]} peerIds
 * @param {string} category
 * @param {string} label */
function summaryApplySubFilter(peerIds, category, label) {
    if (distributionState.filterPeerIds && category === distributionState.filterCategory && label === distributionState.filterLabel) {
        // Clicking the same filter — toggle off
        summaryClearSubFilter();
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
            const othersSeg = getActiveSegments().find(function (s) {
                return s.isOthers;
            });
            seg = {
                ...grp,
                asNumber: distributionState.selectedProvider,
                peerIds: grp.peerIds,
                color: othersSeg ? othersSeg.color : '#58a6ff',
            };
        }
    }
    if (seg && _drawLinesForAs && distributionState.selectedProvider) {
        _drawLinesForAs(distributionState.selectedProvider, peerIds, seg.color);
    }

    // Highlight the active row
    summaryHighlightActiveSubRow();
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

function summaryClearSubFilter() {
    distributionState.filterPeerIds = null;
    distributionState.filterLabel = null;
    distributionState.filterCategory = null;
    tooltipHideSubTooltip();
    // Restore to full AS filter
    if (distributionState.selectedProvider) {
        var seg = findActiveSegment(distributionState.selectedProvider);
        if (!seg) {
            var grp = findActiveGroup(distributionState.selectedProvider);
            if (grp) {
                const othersSeg = getActiveSegments().find(function (s) {
                    return s.isOthers;
                });
                seg = {
                    ...grp,
                    asNumber: distributionState.selectedProvider,
                    peerIds: grp.peerIds,
                    color: othersSeg ? othersSeg.color : '#58a6ff',
                };
            }
        }
        if (seg) {
            if (_filterPeerTable) _filterPeerTable(seg.peerIds);
            if (_dimMapPeers) _dimMapPeers(seg.peerIds);
            if (_drawLinesForAs) _drawLinesForAs(distributionState.selectedProvider, seg.peerIds, seg.color);
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

/** @param {HTMLElement} bodyEl */
function summaryAttachSummaryHandlers(bodyEl) {
    summaryAttachSummaryRowHandlers(bodyEl);
    summaryAttachGridHandlers(bodyEl);
    insightAttachSummaryLinkHandlers(bodyEl);
    summaryAttachPanelBlankClickHandler(bodyEl);
}

// tooltip interactions owned by this distribution controller.
/** @type {HTMLElement | null} */
let pinnedSubTooltipSrc = null;

/** @param {HTMLElement} element */
function tooltipIsPinnedTo(element) {
    return distributionState.subTooltipPinned && pinnedSubTooltipSrc === element;
}

/** @param {HTMLElement} tip */
function tooltipAttachPeerRowHoverHandlers(tip) {
    var peerRows = queryAll('.as-sub-tt-peer[data-peer-id]', tip);
    for (var pri = 0; pri < peerRows.length; pri++) {
        (function (row) {
            row.addEventListener('mouseenter', function () {
                var peerId = parseInt(row.dataset.peerId || '');
                if (isNaN(peerId)) return;
                distributionState.hoveredPeerId = peerId; // Track for update preservation
                if (distributionState.summarySelected) {
                    summaryPreviewSummaryLines([peerId]);
                } else if (distributionState.selectedProvider) {
                    summaryPreviewProviderLines([peerId]);
                }
                // Preview this peer in the popup if a different peer is selected
                if (distributionState.peerDetailActive && peerId !== distributionState.selectedPeerId) {
                    var peer = dashboard.peers.find(function (p) {
                        return p.id === peerId;
                    });
                    if (peer) previewPeerInPopup(peer);
                }
                // In focused mode, show peer info in donut center or update insight rect
                if (distributionState.donutFocused) {
                    var peer = dashboard.peers.find(function (p) {
                        return p.id === peerId;
                    });
                    if (peer) {
                        var asNum = row.dataset.as || distributionData.parseAsNumber(peer.as);
                        var color = asNum ? getColorForAsNum(asNum) : '#6e7681';
                        if (donutController.isInsightVisible()) {
                            updateInsightRectForPeer(peer, color);
                        } else {
                            showPeerInDonutCenter(peer, color);
                            // Keep donut expanded for the provider context
                            if (
                                distributionState.filterCategory &&
                                distributionState.filterCategory.indexOf('conn-') === 0 &&
                                distributionState.filterLabel
                            ) {
                                animateDonutExpand(distributionState.filterLabel);
                            }
                        }
                    }
                }
            });
            row.addEventListener('mouseleave', function () {
                distributionState.hoveredPeerId = null;

                // If a peer is selected (popup open), restore to that peer's state
                if (distributionState.peerDetailActive && distributionState.selectedPeerId) {
                    restorePeerPopupToSelected();
                    var selPeer = dashboard.peers.find(function (p) {
                        return p.id === distributionState.selectedPeerId;
                    });
                    if (selPeer) {
                        var selAsNum = distributionData.parseAsNumber(selPeer.as);
                        var selColor = selAsNum ? getColorForAsNum(selAsNum) : '#6e7681';
                        // Restore line/filter to selected peer
                        if (_drawLinesForAs && selAsNum) _drawLinesForAs(selAsNum, [distributionState.selectedPeerId], selColor);
                        if (_filterPeerTable) _filterPeerTable([distributionState.selectedPeerId]);
                        if (_dimMapPeers) _dimMapPeers([distributionState.selectedPeerId]);
                        // Restore donut center / insight rect to selected peer
                        if (distributionState.donutFocused) {
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
                    summaryRestoreSummaryFromPreview();
                } else if (distributionState.selectedProvider) {
                    summaryRestoreProviderFromPreview();
                }
                // Restore donut center display
                if (distributionState.donutFocused) {
                    if (donutController.isInsightVisible()) {
                        restoreInsightRectProvider();
                    } else if (
                        distributionState.filterCategory &&
                        distributionState.filterCategory.indexOf('conn-') === 0 &&
                        distributionState.filterLabel
                    ) {
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

function tooltipAttachSubTooltipHandlers() {
    var tip = document.getElementById('as-sub-tooltip');
    if (!tip) return;

    // Peer ID click → zoom to peer on map and open the large peer detail popup
    var idLinks = queryAll('.as-sub-tt-id-link', tip);
    for (var li = 0; li < idLinks.length; li++) {
        (function (link) {
            link.addEventListener('click', function (e) {
                e.stopPropagation();
                var peerId = parseInt(link.dataset.peerId || '');
                if (isNaN(peerId)) return;
                // Zoom to peer on map — panel stays open for navigation
                if (_zoomToPeerOnly) _zoomToPeerOnly(peerId);
                // Find the peer data and open the large popup
                var peer = dashboard.peers.find(function (p) {
                    return p.id === peerId;
                });
                if (peer) {
                    openPeerDetailPanel(peer, 'panel');
                    tooltipHighlightSelectedPeerRow(peerId);
                }
            });
        })(idLinks[li]);
    }

    // Peer row hover → preview line to individual peer
    tooltipAttachPeerRowHoverHandlers(tip);

    const showMore = query('.as-sub-tt-show-more', tip);
    const showLess = query('.as-sub-tt-show-less', tip);
    if (!showMore || !showLess) return;

    showMore.addEventListener('click', function (e) {
        e.stopPropagation();
        // Show all extra peers
        var extras = queryAll('.as-sub-tt-peer-extra', tip);
        for (var i = 0; i < extras.length; i++) {
            extras[i].style.display = '';
        }
        showMore.style.display = 'none';
        showLess.style.display = '';

        // Add scroll container class if many peers
        var peerList = query('.as-sub-tt-scroll', tip);
        if (peerList) peerList.classList.add('as-sub-tt-expanded');
    });

    showLess.addEventListener('click', function (e) {
        e.stopPropagation();
        // Hide extra peers
        var extras = queryAll('.as-sub-tt-peer-extra', tip);
        for (var i = 0; i < extras.length; i++) {
            extras[i].style.display = 'none';
        }
        showLess.style.display = 'none';
        showMore.style.display = '';

        var peerList = query('.as-sub-tt-scroll', tip);
        if (peerList) peerList.classList.remove('as-sub-tt-expanded');
    });
}

/** @param {string} html
 * @param {MouseEvent} event */
function tooltipShowSubTooltip(html, event) {
    // Always close sub-sub tooltip when opening a new sub-tooltip
    tooltipHideSubSubTooltip();
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
    tooltipPositionSubTooltip(event);
    tooltipAttachSubTooltipHandlers();
}

/** @param {MouseEvent} event */
function tooltipPositionSubTooltip(event) {
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

function tooltipHideSubTooltip() {
    var tip = document.getElementById('as-sub-tooltip');
    if (tip) {
        tip.classList.add('hidden');
        tip.style.display = 'none';
        tip.style.pointerEvents = 'none';
    }
    distributionState.subTooltipPinned = false;
    pinnedSubTooltipSrc = null;
    tooltipHideSubSubTooltip();
}

/** @param {HTMLElement} srcEl */
function tooltipPinSubTooltip(srcEl) {
    distributionState.subTooltipPinned = true;
    pinnedSubTooltipSrc = srcEl || null;
    var tip = document.getElementById('as-sub-tooltip');
    if (tip) tip.style.pointerEvents = 'auto';
}

/** @param {string} html
 * @param {MouseEvent} event */
function tooltipShowSubSubTooltip(html, event) {
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
    tooltipPositionSubSubTooltip(event);
    tooltipAttachSubSubTooltipHandlers();
}

/** @param {MouseEvent} event */
function tooltipPositionSubSubTooltip(event) {
    var tip = document.getElementById('as-sub-sub-tooltip');
    if (!tip) return;
    var subTip = document.getElementById('as-sub-tooltip');
    var rect = tip.getBoundingClientRect();
    var pad = 12;
    // Position to the left of the sub-tooltip
    var anchor = subTip ? subTip.getBoundingClientRect() : panelEl ? panelEl.getBoundingClientRect() : { left: window.innerWidth, top: 0 };
    var x = anchor.left - rect.width - pad;
    if (x < pad) x = pad;
    var y = event ? event.clientY - rect.height / 2 : anchor.top;
    if (y < pad) y = pad;
    if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
}

function tooltipHideSubSubTooltip() {
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
        var prevSel = queryAll('.as-provider-row-selected', subTip);
        for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
    }
    // Clear legend focus when sub-sub dismisses
    if (distributionState.legendFocusProvider) {
        distributionState.legendFocusProvider = null;
        renderLegend();
    }
}

function tooltipAttachSubSubTooltipHandlers() {
    var tip = document.getElementById('as-sub-sub-tooltip');
    if (!tip) return;

    // Peer ID click → zoom to peer on map and open the large peer detail popup
    var idLinks = queryAll('.as-sub-tt-id-link', tip);
    for (var li = 0; li < idLinks.length; li++) {
        (function (link) {
            link.addEventListener('click', function (e) {
                e.stopPropagation();
                var peerId = parseInt(link.dataset.peerId || '');
                if (isNaN(peerId)) return;
                // Zoom to peer on map — panel stays open for navigation
                if (_zoomToPeerOnly) _zoomToPeerOnly(peerId);
                // Find the peer data and open the large popup
                var peer = dashboard.peers.find(function (p) {
                    return p.id === peerId;
                });
                if (peer) {
                    openPeerDetailPanel(peer, 'panel');
                    tooltipHighlightSelectedPeerRow(peerId);
                }
            });
        })(idLinks[li]);
    }

    // Peer row hover → preview line to individual peer
    tooltipAttachPeerRowHoverHandlers(tip);

    const showMore = query('.as-sub-tt-show-more', tip);
    const showLess = query('.as-sub-tt-show-less', tip);
    if (!showMore || !showLess) return;

    showMore.addEventListener('click', function (e) {
        e.stopPropagation();
        var extras = queryAll('.as-sub-tt-peer-extra', tip);
        for (var i = 0; i < extras.length; i++) extras[i].style.display = '';
        showMore.style.display = 'none';
        showLess.style.display = '';
        var peerList = query('.as-sub-tt-scroll', tip);
        if (peerList) peerList.classList.add('as-sub-tt-expanded');
    });

    showLess.addEventListener('click', function (e) {
        e.stopPropagation();
        var extras = queryAll('.as-sub-tt-peer-extra', tip);
        for (var i = 0; i < extras.length; i++) extras[i].style.display = 'none';
        showLess.style.display = 'none';
        showMore.style.display = '';
        var peerList = query('.as-sub-tt-scroll', tip);
        if (peerList) peerList.classList.remove('as-sub-tt-expanded');
    });
}

/** @param {number} peerId */
function tooltipHighlightSelectedPeerRow(peerId) {
    distributionState.selectedPeerId = peerId;
    // Remove previous selected highlights
    var allSelected = queryAll('.as-sub-tt-peer-selected', document);
    for (var i = 0; i < allSelected.length; i++) allSelected[i].classList.remove('as-sub-tt-peer-selected');
    // Add highlight to matching row(s)
    var tips = [document.getElementById('as-sub-tooltip'), document.getElementById('as-sub-sub-tooltip')];
    for (var ti = 0; ti < tips.length; ti++) {
        if (!tips[ti]) continue;
        var rows = queryAll('.as-sub-tt-peer[data-peer-id]', tips[ti]);
        for (var ri = 0; ri < rows.length; ri++) {
            if (parseInt(rows[ri].dataset.peerId || '') === peerId) {
                rows[ri].classList.add('as-sub-tt-peer-selected');
            }
        }
    }
}

// insight interactions owned by this distribution controller.
/** @param {HTMLElement} bodyEl */
function insightAttachSummaryLinkHandlers(bodyEl) {
    // "Navigate to provider" links — hover previews lines to that provider's peers, click navigates
    var navLinks = queryAll('.as-navigate-provider', bodyEl);
    for (var i = 0; i < navLinks.length; i++) {
        (function (el) {
            el.addEventListener('mouseenter', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                var asNum = el.dataset.as || '';
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
                if (distributionState.donutFocused && asNum) {
                    showFocusedCenterText(asNum);
                    animateDonutExpand(asNum);
                }
            });
            el.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                clearLegendFocus();
                summaryRestoreSummaryFromPreview();
                summaryRestoreDonutAfterPreview();
            });
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                var asNum = el.dataset.as || '';
                if (asNum) navigateToProvider(asNum);
            });
        })(navLinks[i]);
    }

    // "All providers" links — opens sub-tooltip with all providers
    var allProvLinks = queryAll('.as-all-providers-link', bodyEl);
    for (var i = 0; i < allProvLinks.length; i++) {
        (function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
                // Toggle: clicking same link unpins
                if (tooltipIsPinnedTo(el)) {
                    tooltipHideSubTooltip();
                    distributionState.filterPeerIds = null;
                    distributionState.filterCategory = null;
                    distributionState.filterLabel = null;
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (distributionState.summarySelected) activateHoverAll();
                    return;
                }
                var allProvs = asGroups.map(function (g) {
                    return {
                        asNumber: g.asNumber,
                        name: g.asShort || g.asName || g.asNumber,
                        color: getColorForAsNum(g.asNumber),
                        peerCount: g.peerCount,
                        peerIds: g.peerIds,
                        peers: g.peers,
                    };
                });
                var html = summaryView.buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')');
                tooltipShowSubTooltip(html, e);
                tooltipPinSubTooltip(el);
                var tip = document.getElementById('as-sub-tooltip');
                if (tip) {
                    summaryAttachProviderClickHandlers(tip);
                    summaryAttachProviderNavHandlers(tip);
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
        var headerProvLinks = queryAll('.as-detail-header-info .as-all-providers-link', panelEl);
        for (var i = 0; i < headerProvLinks.length; i++) {
            (function (el) {
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (tooltipIsPinnedTo(el)) {
                        tooltipHideSubTooltip();
                        distributionState.filterPeerIds = null;
                        distributionState.filterCategory = null;
                        distributionState.filterLabel = null;
                        if (_filterPeerTable) _filterPeerTable(null);
                        if (_dimMapPeers) _dimMapPeers(null);
                        if (distributionState.summarySelected) activateHoverAll();
                        return;
                    }
                    var allProvs = asGroups.map(function (g) {
                        return {
                            asNumber: g.asNumber,
                            name: g.asShort || g.asName || g.asNumber,
                            color: getColorForAsNum(g.asNumber),
                            peerCount: g.peerCount,
                            peerIds: g.peerIds,
                            peers: g.peers,
                        };
                    });
                    var html = summaryView.buildProviderListHtml(allProvs, 'All Providers (' + allProvs.length + ')');
                    tooltipShowSubTooltip(html, e);
                    tooltipPinSubTooltip(el);
                    var tip = document.getElementById('as-sub-tooltip');
                    if (tip) {
                        summaryAttachProviderClickHandlers(tip);
                        summaryAttachProviderNavHandlers(tip);
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
    const fastestLink = query('.as-fastest-link', bodyEl);
    if (fastestLink) {
        fastestLink.addEventListener('mouseenter', function (e) {
            // When something is selected (pinned) or peer detail is open, suppress hover previews
            if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
            var html = buildFastestProvHtml();
            if (html) tooltipShowSubTooltip(html, e);
            // Preview lines for the #1 fastest provider + focus legend + show insight rect
            var data = computeSummaryData();
            for (var j = 0; j < data.insights.length; j++) {
                const insightItem = data.insights[j];
                if (insightItem.type === 'fastest' && insightItem.topProviders && insightItem.topProviders.length > 0) {
                    var top = insightItem.topProviders[0];
                    setLegendFocus(top.asNumber);
                    if (_drawLinesForAs) _drawLinesForAs(top.asNumber, top.peerIds, top.color);
                    if (_filterPeerTable) _filterPeerTable(top.peerIds);
                    if (_dimMapPeers) _dimMapPeers(top.peerIds);
                    if (distributionState.donutFocused) {
                        showInsightRect('fastest', {
                            provName: top.provName || top.asNumber,
                            asNumber: top.asNumber,
                            peerIds: top.peerIds,
                            avgPing: top.avgPing,
                            rank: 1,
                            color: top.color || getColorForAsNum(top.asNumber),
                        });
                        animateDonutExpand(top.asNumber);
                    }
                    break;
                }
            }
        });
        fastestLink.addEventListener('mouseleave', function () {
            if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
            clearLegendFocus();
            tooltipHideSubTooltip();
            hideInsightRect();
            summaryRestoreSummaryFromPreview();
            summaryRestoreDonutAfterPreview();
        });
        fastestLink.addEventListener('click', function (e) {
            e.stopPropagation();
            if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
            if (tooltipIsPinnedTo(fastestLink)) {
                tooltipHideSubTooltip();
                fastestLink.closest('.as-summary-insight')?.classList.remove('sub-filter-active');
                distributionState.filterPeerIds = null;
                distributionState.filterCategory = null;
                distributionState.filterLabel = null;
                distributionState.insightActiveAsNum = null;
                distributionState.insightActiveData = null;
                distributionState.insightActiveType = null;
                hideInsightRect();
                if (distributionState.donutFocused) animateDonutRevert();
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                if (distributionState.summarySelected) activateHoverAll();
                renderCenter();
                return;
            }
            var html = buildFastestProvHtml();
            if (!html) return;
            tooltipShowSubTooltip(html, e);
            tooltipPinSubTooltip(fastestLink);
            insightAttachFastestProvRowHandlers(required('#as-sub-tooltip'));
            // Clear any other active highlights before adding ours
            var activeBodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
            if (activeBodyEl) {
                var prev = queryAll('.sub-filter-active', activeBodyEl);
                for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
            }
            fastestLink.closest('.as-summary-insight')?.classList.add('sub-filter-active');
            // Track sub-filter state for data refresh preservation
            distributionState.filterPeerIds = [];
            distributionState.filterCategory = 'insight-fastest';
            distributionState.filterLabel = 'fastest';
            // Activate insight donut state — show insight rectangle for #1 fastest provider
            var insData = computeSummaryData();
            for (var ij = 0; ij < insData.insights.length; ij++) {
                const insightItem = insData.insights[ij];
                if (insightItem.type === 'fastest' && insightItem.topProviders && insightItem.topProviders.length > 0) {
                    var topProv = insightItem.topProviders[0];
                    distributionState.insightActiveAsNum = topProv.asNumber;
                    distributionState.insightActiveType = 'fastest';
                    if (distributionState.donutFocused) {
                        showInsightRect('fastest', {
                            provName: topProv.provName,
                            asNumber: topProv.asNumber,
                            peerIds: topProv.peerIds,
                            avgPing: topProv.avgPing,
                            rank: 1,
                            color: topProv.color || getColorForAsNum(topProv.asNumber),
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
    const stableLink = query('.as-stable-link', bodyEl);
    if (stableLink) {
        stableLink.addEventListener('mouseenter', function (e) {
            // When something is selected (pinned) or peer detail is open, suppress hover previews
            if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
            var asNum = stableLink.dataset.as || '';
            if (asNum) setLegendFocus(asNum);
            var result = buildStablePeersHtml();
            if (result) tooltipShowSubTooltip(result.html, e);
            // Preview lines + filter for this provider + show insight rect
            if (asNum) {
                var peerIds = getPeerIdsForAnyAs(asNum);
                var color = getColorForAsNum(asNum);
                if (peerIds.length > 0 && _drawLinesForAs) {
                    _drawLinesForAs(asNum, peerIds, color);
                }
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
                if (distributionState.donutFocused) {
                    var insData = computeSummaryData();
                    var stableIns = null;
                    for (var ij = 0; ij < insData.insights.length; ij++) {
                        const insightItem = insData.insights[ij];
                        if (insightItem.type === 'stable') {
                            stableIns = insightItem;
                            break;
                        }
                    }
                    if (stableIns) {
                        showInsightRect('stable', {
                            provName: stableIns.provName,
                            asNumber: stableIns.asNumber,
                            peerIds: stableIns.peerIds,
                            durText: stableIns.durText,
                            color: color,
                        });
                    }
                    animateDonutExpand(asNum);
                }
            }
        });
        stableLink.addEventListener('mouseleave', function () {
            if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
            clearLegendFocus();
            tooltipHideSubTooltip();
            hideInsightRect();
            summaryRestoreSummaryFromPreview();
            summaryRestoreDonutAfterPreview();
        });
        stableLink.addEventListener('click', function (e) {
            e.stopPropagation();
            if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
            // Toggle
            if (tooltipIsPinnedTo(stableLink)) {
                tooltipHideSubTooltip();
                stableLink.closest('.as-summary-insight')?.classList.remove('sub-filter-active');
                distributionState.filterPeerIds = null;
                distributionState.filterCategory = null;
                distributionState.filterLabel = null;
                distributionState.insightActiveAsNum = null;
                distributionState.insightActiveData = null;
                distributionState.insightActiveType = null;
                hideInsightRect();
                if (distributionState.donutFocused) animateDonutRevert();
                if (_filterPeerTable) _filterPeerTable(null);
                if (_dimMapPeers) _dimMapPeers(null);
                if (distributionState.summarySelected) activateHoverAll();
                renderCenter();
                return;
            }
            var result = buildStablePeersHtml();
            if (!result) return;
            tooltipShowSubTooltip(result.html, e);
            tooltipPinSubTooltip(stableLink);
            tooltipAttachSubTooltipHandlers();
            var tip = document.getElementById('as-sub-tooltip');
            if (tip) summaryAttachProviderNavHandlers(tip);
            // Clear any other active highlights before adding ours
            var activeBodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
            if (activeBodyEl) {
                var prev = queryAll('.sub-filter-active', activeBodyEl);
                for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
            }
            stableLink.closest('.as-summary-insight')?.classList.add('sub-filter-active');
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
            distributionState.insightActiveAsNum = result.asNum;
            distributionState.insightActiveType = 'stable';
            if (distributionState.donutFocused) {
                var insData = computeSummaryData();
                var stableIns = null;
                for (var ij = 0; ij < insData.insights.length; ij++) {
                    const insightItem = insData.insights[ij];
                    if (insightItem.type === 'stable') {
                        stableIns = insightItem;
                        break;
                    }
                }
                if (stableIns) {
                    showInsightRect('stable', {
                        provName: stableIns.provName,
                        asNumber: stableIns.asNumber,
                        peerIds: stableIns.peerIds,
                        durText: stableIns.durText,
                        color: color,
                    });
                }
            }
            setLegendFocus(result.asNum);
        });
    }

    // Data insight provider sub-panels (Most sent/recv — hover shows providers ranked by bytes)
    var dataProvLinks = queryAll('.as-data-providers-link', bodyEl);
    for (var i = 0; i < dataProvLinks.length; i++) {
        (function (el) {
            const field = el.dataset.field === 'bytesrecv' ? 'bytesrecv' : 'bytessent';
            var isRecv = field === 'bytesrecv';

            el.addEventListener('mouseenter', function (e) {
                // When something is selected (pinned) or peer detail is open, suppress hover previews
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                var result = buildDataProviderHtml(field);
                if (!result) return;
                tooltipShowSubTooltip(result.html, e);
                // Preview lines for the #1 data provider + focus legend + show insight rect
                if (result.insight && result.insight.topProviders && result.insight.topProviders.length > 0) {
                    var top = result.insight.topProviders[0];
                    setLegendFocus(top.asNumber);
                    var topPeerIds = top.peers.slice(0, 20).map(function (p) {
                        return p.id;
                    });
                    if (_drawLinesForAs) _drawLinesForAs(top.asNumber, topPeerIds, top.color);
                    if (_filterPeerTable) _filterPeerTable(topPeerIds);
                    if (_dimMapPeers) _dimMapPeers(topPeerIds);
                    if (distributionState.donutFocused) {
                        var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                        showInsightRect(rectType, {
                            provName: top.provName,
                            asNumber: top.asNumber,
                            peerIds: top.peers.map((peer) => peer.id),
                            totalBytes: top.totalBytes,
                            rank: 1,
                            color: top.color || getColorForAsNum(top.asNumber),
                        });
                        animateDonutExpand(top.asNumber);
                    }
                }
            });
            el.addEventListener('mouseleave', function () {
                if (distributionState.subTooltipPinned || distributionState.peerDetailActive) return;
                clearLegendFocus();
                tooltipHideSubTooltip();
                hideInsightRect();
                summaryRestoreSummaryFromPreview();
                summaryRestoreDonutAfterPreview();
            });
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                if (distributionState.peerDetailActive && !reconciling) closePeerPopup();
                // Toggle: clicking same link unpins
                if (tooltipIsPinnedTo(el)) {
                    tooltipHideSubTooltip();
                    el.closest('.as-summary-insight')?.classList.remove('sub-filter-active');
                    distributionState.filterPeerIds = null;
                    distributionState.filterCategory = null;
                    distributionState.filterLabel = null;
                    distributionState.insightActiveAsNum = null;
                    distributionState.insightActiveData = null;
                    distributionState.insightActiveType = null;
                    hideInsightRect();
                    if (distributionState.donutFocused) animateDonutRevert();
                    if (_filterPeerTable) _filterPeerTable(null);
                    if (_dimMapPeers) _dimMapPeers(null);
                    if (distributionState.summarySelected) activateHoverAll();
                    renderCenter();
                    return;
                }
                var result = buildDataProviderHtml(field);
                if (!result) return;
                tooltipShowSubTooltip(result.html, e);
                tooltipPinSubTooltip(el);
                insightAttachDataProviderRowHandlers(required('#as-sub-tooltip'), field);
                // Clear any other active highlights before adding ours
                var activeBodyEl = panelEl ? query('.as-detail-body', panelEl) : null;
                if (activeBodyEl) {
                    var prev = queryAll('.sub-filter-active', activeBodyEl);
                    for (var ai = 0; ai < prev.length; ai++) prev[ai].classList.remove('sub-filter-active');
                }
                // Highlight this insight as active
                el.closest('.as-summary-insight')?.classList.add('sub-filter-active');
                // Track sub-filter state for data refresh preservation
                distributionState.filterPeerIds = [];
                distributionState.filterCategory = 'insight-data-' + field;
                distributionState.filterLabel = field;
                // Activate insight donut state — show insight rectangle for #1 data provider
                var insDataResult = buildDataProviderHtml(field);
                if (
                    insDataResult &&
                    insDataResult.insight &&
                    insDataResult.insight.topProviders &&
                    insDataResult.insight.topProviders.length > 0
                ) {
                    var topDataProv = insDataResult.insight.topProviders[0];
                    distributionState.insightActiveAsNum = topDataProv.asNumber;
                    distributionState.insightActiveType = 'data-' + field;
                    if (distributionState.donutFocused) {
                        var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                        showInsightRect(rectType, {
                            provName: topDataProv.provName,
                            asNumber: topDataProv.asNumber,
                            peerIds: topDataProv.peers.map((peer) => peer.id),
                            totalBytes: topDataProv.totalBytes,
                            rank: 1,
                            color: topDataProv.color || getColorForAsNum(topDataProv.asNumber),
                        });
                    }
                    setLegendFocus(topDataProv.asNumber);
                    var topDataPeerIds = topDataProv.peers.slice(0, 20).map(function (p) {
                        return p.id;
                    });
                    if (_drawLinesForAs) _drawLinesForAs(topDataProv.asNumber, topDataPeerIds, topDataProv.color);
                    if (_filterPeerTable) _filterPeerTable(topDataPeerIds);
                    if (_dimMapPeers) _dimMapPeers(topDataPeerIds);
                }
            });
        })(dataProvLinks[i]);
    }

    // "Show Private Networks" link — enter private network mode
    var pnLink = query('.as-show-private-nets', bodyEl);
    if (pnLink) {
        pnLink.addEventListener('click', function (e) {
            e.stopPropagation();
            if (_enterPrivateNetMode) _enterPrivateNetMode();
        });
    }
}

/** @param {HTMLElement} tip */
function insightAttachFastestProvRowHandlers(tip) {
    var provRows = queryAll('.as-fastest-prov-row', tip);
    for (var pi = 0; pi < provRows.length; pi++) {
        (function (provRow) {
            provRow.style.cursor = 'pointer';
            provRow.addEventListener('mouseenter', function () {
                if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                var asNum = provRow.dataset.as || '';
                /** @type {number[]} */
                var peerIds = JSON.parse(provRow.dataset.peerIds || '');
                var rank = parseInt(provRow.dataset.rank || '') || 0;
                // Focus legend on this provider
                if (asNum) setLegendFocus(asNum);
                if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                    _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                }
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
                // In focused mode, update insight rect for this provider
                if (distributionState.donutFocused && asNum && donutController.isInsightVisible()) {
                    var grp = asGroups.find(function (g) {
                        return g.asNumber === asNum;
                    });
                    var avgPing = parseFloat(provRow.dataset.avgPing || '') || 0;
                    showInsightRect('fastest', {
                        provName: grp ? grp.asShort || grp.asName || asNum : asNum,
                        asNumber: asNum,
                        peerIds: peerIds,
                        avgPing: avgPing,
                        rank: rank,
                        color: getColorForAsNum(asNum),
                    });
                    distributionState.insightActiveAsNum = asNum;
                } else if (distributionState.donutFocused && asNum) {
                    showFocusedCenterText(asNum);
                    animateDonutExpand(asNum);
                }
            });
            provRow.addEventListener('mouseleave', function () {
                if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                // On leave, restore to the pinned insight provider
                if (donutController.isInsightVisible()) {
                    restoreInsightRectProvider();
                } else {
                    summaryRestoreSummaryFromPreview();
                }
            });
            provRow.addEventListener('click', function (e) {
                e.stopPropagation();
                /** @type {number[]} */
                var peerIds = JSON.parse(provRow.dataset.peerIds || '');
                var asNum = provRow.dataset.as || '';
                var rank = parseInt(provRow.dataset.rank || '') || 0;

                // Keep legend focused on this provider while sub-sub is pinned
                distributionState.legendFocusProvider = asNum;
                renderLegend();

                // Highlight this provider row as selected in the sub-tooltip
                var tip = document.getElementById('as-sub-tooltip');
                if (tip) {
                    var prevSel = queryAll('.as-provider-row-selected', tip);
                    for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
                }
                provRow.classList.add('as-provider-row-selected');

                var matchedPeers = peersByIds(peerIds);
                matchedPeers.sort(function (a, b) {
                    return (a.ping_ms || 9999) - (b.ping_ms || 9999);
                });

                // Build sub-sub-tooltip with peers ranked by ping
                var html = summaryView.buildPingPeerListHtml(matchedPeers.slice(0, 20));
                tooltipShowSubSubTooltip(html, e);
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
                if (distributionState.donutFocused && donutController.isInsightVisible()) {
                    var grp = asGroups.find(function (g) {
                        return g.asNumber === asNum;
                    });
                    var avgPing = parseFloat(provRow.dataset.avgPing || '') || 0;
                    distributionState.insightActiveAsNum = asNum;
                    distributionState.insightActiveData = {
                        provName: grp ? grp.asShort || grp.asName || asNum : asNum,
                        asNumber: asNum,
                        peerIds: peerIds,
                        avgPing: avgPing,
                        rank: rank,
                        color: getColorForAsNum(asNum),
                    };
                    showInsightRect('fastest', distributionState.insightActiveData);
                }
            });
        })(provRows[pi]);
    }
}

/** @param {HTMLElement} tip
 * @param {string} field */
function insightAttachDataProviderRowHandlers(tip, field) {
    var provRows = queryAll('.as-data-prov-row', tip);
    for (var pi = 0; pi < provRows.length; pi++) {
        (function (provRow) {
            provRow.style.cursor = 'pointer';
            // Hover preview: show lines + filter for this provider's peers
            provRow.addEventListener('mouseenter', function () {
                if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                var asNum = provRow.dataset.as || '';
                /** @type {number[]} */
                var peerIds = JSON.parse(provRow.dataset.peerIds || '');
                var rank = parseInt(provRow.dataset.rank || '') || 0;
                // Focus legend on this provider
                if (asNum) setLegendFocus(asNum);
                if (peerIds.length > 0 && _drawLinesForAs && asNum) {
                    _drawLinesForAs(asNum, peerIds, getColorForAsNum(asNum));
                }
                if (_filterPeerTable) _filterPeerTable(peerIds);
                if (_dimMapPeers) _dimMapPeers(peerIds);
                // In focused mode, update insight rect for this provider
                if (distributionState.donutFocused && asNum && donutController.isInsightVisible()) {
                    var grp = asGroups.find(function (g) {
                        return g.asNumber === asNum;
                    });
                    var totalBytes = parseInt(provRow.dataset.totalBytes || '') || 0;
                    var rectType = field === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                    distributionState.insightActiveAsNum = asNum;
                    showInsightRect(rectType, {
                        provName: grp ? grp.asShort || grp.asName || asNum : asNum,
                        asNumber: asNum,
                        peerIds,
                        totalBytes: totalBytes,
                        rank: rank,
                        color: getColorForAsNum(asNum),
                    });
                } else if (distributionState.donutFocused && asNum) {
                    showFocusedCenterText(asNum);
                    animateDonutExpand(asNum);
                }
            });
            provRow.addEventListener('mouseleave', function () {
                if (distributionState.peerDetailActive || distributionState.subSubTooltipPinned) return;
                // On leave, restore to the pinned insight provider
                if (donutController.isInsightVisible()) {
                    restoreInsightRectProvider();
                } else {
                    summaryRestoreSummaryFromPreview();
                }
            });
            provRow.addEventListener('click', function (e) {
                e.stopPropagation();
                /** @type {number[]} */
                var peerIds = JSON.parse(provRow.dataset.peerIds || '');
                var asNum = provRow.dataset.as || '';
                const rowField = provRow.dataset.field === 'bytesrecv' ? 'bytesrecv' : 'bytessent';

                // Keep legend focused on this provider while sub-sub is pinned
                distributionState.legendFocusProvider = asNum;
                renderLegend();

                // Highlight this provider row as selected in the sub-tooltip
                var tip = document.getElementById('as-sub-tooltip');
                if (tip) {
                    var prevSel = queryAll('.as-provider-row-selected', tip);
                    for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
                }
                provRow.classList.add('as-provider-row-selected');

                // Find matching peer objects from lastPeersRaw
                var matchedPeers = peersByIds(peerIds);
                // Sort by the relevant field
                matchedPeers.sort(function (a, b) {
                    return (b[rowField] || 0) - (a[rowField] || 0);
                });

                // Build sub-sub-tooltip showing top 20 peers with bytes amounts
                var html = summaryView.buildDataPeerListHtml(matchedPeers.slice(0, 20), rowField);
                tooltipShowSubSubTooltip(html, e);
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
                if (distributionState.donutFocused && donutController.isInsightVisible()) {
                    var grp = asGroups.find(function (g) {
                        return g.asNumber === asNum;
                    });
                    var totalBytes = parseInt(provRow.dataset.totalBytes || '') || 0;
                    var rank = parseInt(provRow.dataset.rank || '') || 0;
                    var rectType = rowField === 'bytesrecv' ? 'data-bytesrecv' : 'data-bytessent';
                    distributionState.insightActiveAsNum = asNum;
                    distributionState.insightActiveData = {
                        provName: grp ? grp.asShort || grp.asName || asNum : asNum,
                        asNumber: asNum,
                        peerIds,
                        totalBytes: totalBytes,
                        rank: rank,
                        color: getColorForAsNum(asNum),
                    };
                    showInsightRect(rectType, distributionState.insightActiveData);
                }
            });
        })(provRows[pi]);
    }
}

/** @param {string} field */
function buildDataProviderHtml(field) {
    const isRecv = field === 'bytesrecv';
    var data = computeSummaryData();
    var insight = null;
    for (var j = 0; j < data.insights.length; j++) {
        const insightItem = data.insights[j];
        if (insightItem.type === 'data-providers' && insightItem.field === field) {
            insight = insightItem;
            break;
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
        var peerIdsJson = BPMModal.escapeHtml(
            JSON.stringify(
                prov.peers.slice(0, 20).map(function (p) {
                    return p.id;
                })
            )
        );
        html +=
            '<div class="as-sub-tt-peer as-provider-row as-data-prov-row" data-as="' +
            escapeHtml(prov.asNumber) +
            '" data-peer-ids="' +
            peerIdsJson +
            '" data-field="' +
            field +
            '" data-rank="' +
            (pi + 1) +
            '" data-total-bytes="' +
            prov.totalBytes +
            '">';
        html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
        html += '<span class="as-grid-dot" style="background:' + prov.color + '"></span>';
        var name = prov.provName.length > 14 ? prov.provName.substring(0, 13) + '\u2026' : prov.provName;
        html += '<span class="as-sub-tt-loc" title="' + escapeHtml(prov.provName) + '">' + escapeHtml(name) + '</span>';
        html += '<span class="as-sub-tt-type">' + distributionData.fmtBytes(prov.totalBytes) + '</span>';
        html += '</div>';
    }
    html += '</div>';
    return { html: html, insight: insight };
}

function buildStablePeersHtml() {
    var data = computeSummaryData();
    var stableInsight = null;
    for (var j = 0; j < data.insights.length; j++) {
        const insightItem = data.insights[j];
        if (insightItem.type === 'stable') {
            stableInsight = insightItem;
            break;
        }
    }
    if (!stableInsight) return null;
    var peerIds = stableInsight.peerIds;
    var matchedPeers = peersByIds(peerIds);
    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
    html +=
        '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' +
        escapeHtml(stableInsight.provName) +
        ' Peers</div>';
    html +=
        '<div class="as-sub-tt-nav as-grid-provider-click" data-as="' +
        escapeHtml(stableInsight.asNumber) +
        '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open provider panel</div>';
    html += '</div>';
    html += summaryView.buildPeerListHtmlForSubSub(matchedPeers);
    return { html: html, peerIds: peerIds, asNum: stableInsight.asNumber };
}

function buildFastestProvHtml() {
    var data = computeSummaryData();
    var fastInsight = null;
    for (var j = 0; j < data.insights.length; j++) {
        const insightItem = data.insights[j];
        if (insightItem.type === 'fastest') {
            fastInsight = insightItem;
            break;
        }
    }
    if (!fastInsight || !fastInsight.topProviders) return null;
    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
    html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Fastest Connection \u2014 Avg Ping</div>';
    html += '</div>';
    html += '<div class="as-sub-tt-scroll">';
    for (var pi = 0; pi < fastInsight.topProviders.length; pi++) {
        var prov = fastInsight.topProviders[pi];
        var peerIdsJson = BPMModal.escapeHtml(JSON.stringify(prov.peerIds.slice(0, 20)));
        html +=
            '<div class="as-sub-tt-peer as-provider-row as-fastest-prov-row" data-as="' +
            escapeHtml(prov.asNumber) +
            '" data-peer-ids="' +
            peerIdsJson +
            '" data-rank="' +
            (pi + 1) +
            '" data-avg-ping="' +
            prov.avgPing.toFixed(1) +
            '">';
        html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
        html += '<span class="as-grid-dot" style="background:' + prov.color + '"></span>';
        var name = prov.provName.length > 14 ? prov.provName.substring(0, 13) + '\u2026' : prov.provName;
        html += '<span class="as-sub-tt-loc" title="' + escapeHtml(prov.provName) + '">' + escapeHtml(name) + '</span>';
        html += '<span class="as-sub-tt-type">' + Math.round(prov.avgPing) + 'ms</span>';
        html += '</div>';
    }
    html += '</div>';
    return html;
}

function refreshSelectionViews() {
    if (!panelEl || (!distributionState.selectedProvider && !distributionState.summarySelected && !distributionState.activeNetwork)) return;
    const restorePanel = BPMDomState.capture(panelEl);
    const pinnedKey = pinnedSubTooltipSrc ? BPMDomState.key(pinnedSubTooltipSrc) : null;
    const category = distributionState.filterCategory;
    const label = distributionState.filterLabel || '';
    const topGroups = {
        provider: donutSegments.filter((segment) => !segment.isOthers).map((segment) => segment.asNumber),
        country: countryDonutSegments.filter((segment) => !segment.isOthers).map((segment) => segment.asNumber),
    };
    let scope = dashboard.peers;
    if (distributionState.activeNetwork) scope = scope.filter((peer) => peer.network === distributionState.activeNetwork);
    else if (distributionState.selectedProvider)
        scope = BPMPeerFilters.resolve(
            scope,
            {
                kind: distributionState.selectedProvider === 'Others' ? 'others' : isCountryLens() ? 'country' : 'provider',
                key:
                    distributionState.selectedProvider === 'Others'
                        ? isCountryLens()
                            ? 'country'
                            : 'provider'
                        : distributionState.selectedProvider,
            },
            topGroups
        );

    let descriptor = distributionState.filterDescriptor;
    if (category && category !== 'summary') descriptor = BPMPeerFilters.forCategory(category, label, scope);
    distributionState.filterDescriptor = descriptor;
    const filtered = BPMPeerFilters.resolve(scope, descriptor, topGroups);
    distributionState.filterPeerIds = category ? filtered.map((peer) => peer.id) : null;
    const secondary = distributionState.subSubFilterProvider;
    const secondaryPeers = secondary ? filtered.filter((peer) => parseAsNumber(peer.as) === secondary) : null;
    distributionState.subSubFilterPeerIds = secondaryPeers ? secondaryPeers.map((peer) => peer.id) : null;

    reconciling = true;
    try {
        if (distributionState.activeNetwork) {
            const result = distributionNetworkPanel.render({
                panelElement: panelEl,
                peers: dashboard.peers,
                segments: donutSegments,
                networkKey: distributionState.activeNetwork,
                isRefresh: true,
            });
            if (result.bodyElement) summaryAttachSummaryHandlers(result.bodyElement);
        } else if (distributionState.selectedProvider) {
            if (scope.length) openPanel(distributionState.selectedProvider);
            else {
                required('.as-detail-body', panelEl).innerHTML = '<div class="pn-panel-empty">No matching peers connected</div>';
                required('.as-detail-pct', panelEl).textContent = '0 peers';
            }
        } else summaryOpenLensSummaryPanel();
    } finally {
        reconciling = false;
    }
    restorePanel();
    pinnedSubTooltipSrc = pinnedKey
        ? Array.from(queryAll('*', panelEl)).find((element) => BPMDomState.key(element) === pinnedKey) || null
        : null;
    summaryHighlightActiveSummaryRow();
    summaryHighlightActiveSubRow();

    // Refresh pinned lists from descriptors, keeping their shells and geometry.
    const tip = document.getElementById('as-sub-tooltip');
    if (tip && distributionState.subTooltipPinned && category) {
        const restoreTip = BPMDomState.capture(tip);
        let html;
        if (category === 'summary' || category === 'conn-others') {
            const providers = aggregateProvidersForPeers(filtered);
            html = summaryView.buildProviderListHtml(providers, label);
        } else if (category === 'insight-fastest') html = buildFastestProvHtml() || '';
        else if (category.startsWith('insight-data-')) html = buildDataProviderHtml(category.slice('insight-data-'.length))?.html || '';
        else if (category === 'insight-stable') html = summaryView.buildPeerSummaryHtml(filtered, category, label);
        else html = summaryView.buildPeerSummaryHtml(filtered, category, label);
        tip.innerHTML = html;
        tooltipAttachSubTooltipHandlers();
        if (category === 'summary' || category === 'conn-others') summaryAttachProviderClickHandlers(tip);
        if (category === 'insight-fastest') insightAttachFastestProvRowHandlers(tip);
        else if (category.startsWith('insight-data-')) insightAttachDataProviderRowHandlers(tip, category.slice(13));
        summaryAttachProviderNavHandlers(tip);
        if (secondary)
            queryAll('.as-provider-row', tip).forEach((row) => {
                row.classList.toggle('as-provider-row-selected', row.dataset.as === secondary);
            });
        restoreTip();
    }
    const field = category === 'insight-data-bytesrecv' ? 'bytesrecv' : 'bytessent';
    const subTip = document.getElementById('as-sub-sub-tooltip');
    if (subTip && distributionState.subSubTooltipPinned && secondaryPeers) {
        const restore = BPMDomState.capture(subTip);
        subTip.innerHTML =
            category === 'insight-fastest'
                ? summaryView.buildPingPeerListHtml(
                      secondaryPeers.slice().sort((a, b) => (a.ping_ms || Infinity) - (b.ping_ms || Infinity))
                  )
                : category && category.startsWith('insight-data-')
                  ? summaryView.buildDataPeerListHtml(
                        secondaryPeers.slice().sort((a, b) => (b[field] || 0) - (a[field] || 0)),
                        field
                    )
                  : summaryView.buildPeerListHtmlForSubSub(secondaryPeers);
        tooltipAttachSubSubTooltipHandlers();
        restore();
    }
    let visible = secondaryPeers || filtered;
    if (!secondary && category?.startsWith('insight-') && distributionState.insightActiveAsNum) {
        visible = visible.filter((peer) => parseAsNumber(peer.as) === distributionState.insightActiveAsNum);
    }
    const peer = distributionState.selectedPeerId === null ? undefined : dashboard.byId.get(distributionState.selectedPeerId);
    const hovered = distributionState.hoveredPeerId === null ? undefined : dashboard.byId.get(distributionState.hoveredPeerId);
    if (peer && distributionState.peerDetailActive) visible = [peer];
    else if (hovered && visible.some((item) => item.id === hovered.id)) visible = [hovered];
    const ids = visible.map((item) => item.id);
    const filtering = category || distributionState.selectedProvider || distributionState.activeNetwork || peer || secondary;
    if (_filterPeerTable) _filterPeerTable(filtering ? ids : null);
    if (_dimMapPeers) _dimMapPeers(filtering ? ids : null);
    if (filtering) summaryPreviewSummaryLines(ids);
    else if (distributionState.summarySelected) activateHoverAll();
    if (peer && distributionState.peerDetailActive) showPeerInDonutCenter(peer, getColorForAsNum(parseAsNumber(peer.as)));
    else if (distributionState.insightActiveAsNum) {
        const data = getInsightDataForActive();
        if (data && distributionState.insightActiveType) showInsightRect(distributionState.insightActiveType, data);
        else hideInsightRect();
    }
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

// ═══════════════════════════════════════════════════════════
// IPv4/IPv6 NETWORK DETAIL PANEL
// ═══════════════════════════════════════════════════════════

/** Open a dedicated network detail panel (IPv4 or IPv6)
 * @param {string} netKey */
function openNetworkPanel(netKey) {
    if (!panelEl) return;
    if (distributionState.peerDetailActive && !reconciling) closePeerPopup();

    var isRefresh = distributionState.activeNetwork === netKey;
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
        peers: dashboard.peers,
        segments: donutSegments,
        networkKey: netKey,
        isRefresh: isRefresh,
    });
    if (!result.bodyElement || !result.data.peerCount) return;

    summaryAttachSummaryHandlers(result.bodyElement);

    if (_filterPeerTable) _filterPeerTable(result.data.peerIds);
    if (_dimMapPeers) _dimMapPeers(result.data.peerIds);
    activateHoverAll();
    renderCenter();
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
