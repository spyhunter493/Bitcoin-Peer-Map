import * as BPMDistributionNavigation from './navigation.js';
import * as BPMDistributionSummaryInteractions from './summary-interactions.js';
import * as BPMDistributionInsightInteractions from './insight-interactions.js';
import * as BPMDistributionTooltips from './tooltips.js';
import BPMServiceFlags from '../peers/service-flags.js';
import * as BPMFormat from '../core/format.js';
import * as BPMDistributionDonut from './donut.js';
import * as BPMDistributionNetworkPanel from './network-panel.js';
import * as BPMDistributionSummaryPanel from './summary-panel.js';
import * as BPMPeerDetail from '../peers/detail.js';
import * as BPMDistributionModel from './model.js';
import * as BPMDistributionPresentation from './presentation.js';
import * as BPMDistributionControls from './controls.js';

const MAX_SEGMENTS = 8; // Top N groups in either lens, rest = "Others"
const DONUT_SIZE = 260; // SVG viewBox size
const DONUT_RADIUS = 116; // Outer radius of the donut ring
const DONUT_WIDTH = 28; // Width of the donut ring (default)
const DONUT_WIDTH_SELECTED = 40; // Width when selected (thicker)
const DONUT_WIDTH_DIMMED = 14; // Width when dimmed (thinner)

// Curated colour palette — 9 colours (8 AS + Others), distinct and accessible
const PALETTE = Object.freeze([
    '#f472b6', // pink
    '#3fb950', // green
    '#e3b341', // gold
    '#f07178', // coral
    '#8b5cf6', // purple
    '#d2a8ff', // lavender
    '#79c0ff', // light blue
    '#f0883e', // orange
    '#58a6ff', // blue (Others)
]);

const DONUT_ANIM_DURATION = 400; // ms for expand/revert animation
const DONUT_EXPAND_RATIO = 0.7; // expanded segment gets 70% of donut

/** Compose distribution components for one explicitly supplied dashboard.
 * @param {{
 * dashboard: ReturnType<typeof import('../core/dashboard-state.js').create>;
 * hooks?: Partial<import('../types').DistributionHooks>;
 * document?: Document;
 * }} options
 */
export function create({ dashboard, hooks: initialHooks = {}, document = globalThis.document }) {
    const distributionState = dashboard.distribution;
    const hooks = { ...initialHooks };
    let legendsHidden = false;
    let initialized = false;
    let disposed = false;
    /** @type {{container: HTMLElement | null; title: HTMLElement | null; lensToggle: HTMLElement | null; panel: HTMLElement | null}} */
    let elements = { container: null, title: null, lensToggle: null, panel: null };
    const model = BPMDistributionModel.create({
        dashboard, palette: PALETTE, maxSegments: MAX_SEGMENTS,
        connectionTypeLabels: BPMFormat.connectionLabels,
    });
    const {
        isCountryLens, getActiveGroups, getActiveSegments, getActiveTotalPeers,
        findActiveSegment, findActiveSegmentOrGroup, getPeerIdsForActiveEntity, getColorForActiveEntity,
        buildActiveScoreTooltip, peersByIds, getColorForAsNum, aggregateProvidersForPeers,
        computeSummaryData, getInsightDataForActive, isOthersSubProvider, getPeerIdsForAnyAs,
        getColorForAs,
    } = model;
    const SERVICE_FLAGS = BPMServiceFlags;

    // Connection type short labels
    const CONN_TYPE_LABELS = BPMFormat.connectionLabels;

    const CONN_TYPE_FULL = BPMFormat.connectionTypes;

    const distributionDonut = BPMDistributionDonut;
    const buildScoreTooltip = distributionDonut.buildScoreTooltip;
    const distributionNetworkPanel = BPMDistributionNetworkPanel;

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
                return elements.panel;
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

    function hideInsightRect() {
        donutController.hideInsight();
    }
    /** @param {Parameters<import('../types').DistributionNavigation['closeActiveInsight']>} args */
    function closeActiveInsight(...args) { if (disposed) return; return navigation.closeActiveInsight(...args); }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['renderCenter']>} args */
    function renderCenter(...args) { return presentation.renderCenter(...args); }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['renderLegend']>} args */
    function renderLegend(...args) { return presentation.renderLegend(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['clearLegendFocus']>} args */
    function clearLegendFocus(...args) { if (disposed) return; return navigation.clearLegendFocus(...args); }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['renderPanel']>} args */
    function renderPanel(...args) { return presentation.renderPanel(...args); }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['closePanel']>} args */
    function closePanel(...args) { return presentation.closePanel(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['navigateToProvider']>} args */
    function navigateToProvider(...args) { if (disposed) return; return navigation.navigateToProvider(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['onMapClick']>} args */
    function onMapClick(...args) { if (disposed) return false; return navigation.onMapClick(...args); }

    // DONUT CENTER DELEGATES
    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['showFocusedCenterText']>} args */
    function showFocusedCenterText(...args) { return presentation.showFocusedCenterText(...args); }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['showLegendHoverCenterText']>} args */
    function showLegendHoverCenterText(...args) { return presentation.showLegendHoverCenterText(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['onSegmentHover']>} args */
    function onSegmentHover(...args) { if (disposed) return; return navigation.onSegmentHover(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['onSegmentLeave']>} args */
    function onSegmentLeave(...args) { if (disposed) return; return navigation.onSegmentLeave(...args); }

    /** Add highlight class to the matching legend item
     * @param {string} asNum */
    function highlightLegendItem(asNum) {
        donutController.highlightLegend(asNum);
    }

    /** Remove highlight class from all legend items */
    function clearLegendHighlight() {
        donutController.clearLegendHighlight();
    }

    /** @param {Parameters<import('../types').DistributionNavigation['onSegmentClick']>} args */
    function onSegmentClick(...args) { if (disposed) return; return navigation.onSegmentClick(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['deselect']>} args */
    function deselect(...args) { if (disposed) return; return navigation.deselect(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['enterFocusedMode']>} args */
    function enterFocusedMode(...args) { if (disposed) return; return navigation.enterFocusedMode(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['exitFocusedMode']>} args */
    function exitFocusedMode(...args) { if (disposed) return; return navigation.exitFocusedMode(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['isFocusedMode']>} args */
    function isFocusedMode(...args) { return navigation.isFocusedMode(...args); }

    const peerDetailController = BPMPeerDetail.create({
        getPeers: () => dashboard.peers,
        getProviderColor: getColorForAsNum,
        connectionTypeLabels: CONN_TYPE_FULL,
        serviceFlags: SERVICE_FLAGS,
        onRequestClose: () => closePeerPopup(),
        onRequestPeer: (peer, source) => openPeerDetailPanel(peer, source),
        onRequestGroup: (peerIds) => openMultiPeerPopup(peerIds),
        onDisconnect: (peerId, network) => {
            hooks.showDisconnectDialog?.(peerId, network);
        },
    });

    /** @param {Parameters<import('../types').DistributionNavigation['closePeerPopup']>} args */
    function closePeerPopup(...args) { if (disposed) return; return navigation.closePeerPopup(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['openMultiPeerPopup']>} args */
    function openMultiPeerPopup(...args) { if (disposed) return; return navigation.openMultiPeerPopup(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['openPeerDetailPanel']>} args */
    function openPeerDetailPanel(...args) { if (disposed) return; return navigation.openPeerDetailPanel(...args); }

    /** Show peer ID and provider in donut center
     * @param {import('../types').Peer} peer
     * @param {string} color */
    function showPeerInDonutCenter(peer, color) {
        donutController.renderPeerCenter(peer, color);
    }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['updateLensChrome']>} args */
    function updateLensChrome(...args) { return presentation.updateLensChrome(...args); }

    function init() {
        if (disposed || initialized) return;
        controls.init();
        initialized = true;
    }

    /** Replace callbacks while preserving the live object held by child controllers.
     * @param {Partial<import('../types').DistributionHooks>} nextHooks */
    function setHooks(nextHooks) {
        if (disposed) return;
        for (const key of /** @type {(keyof import('../types').DistributionHooks)[]} */ (Object.keys(hooks))) delete hooks[key];
        Object.assign(hooks, nextHooks);
    }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['renderCountrySummaryPanel']>} args */
    function renderCountrySummaryPanel(...args) { return presentation.renderCountrySummaryPanel(...args); }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['renderSummaryPanel']>} args */
    function renderSummaryPanel(...args) { return presentation.renderSummaryPanel(...args); }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['summaryBuildPeerSummaryHtml']>} args */
    function summaryBuildPeerSummaryHtml(...args) { return presentation.summaryBuildPeerSummaryHtml(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['summaryRestoreDonutAfterPreview']>} args */
    function summaryRestoreDonutAfterPreview(...args) { if (disposed) return; return navigation.summaryRestoreDonutAfterPreview(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['summaryPreviewSummaryLines']>} args */
    function summaryPreviewSummaryLines(...args) { if (disposed) return; return navigation.summaryPreviewSummaryLines(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['summaryPreviewProviderLines']>} args */
    function summaryPreviewProviderLines(...args) { if (disposed) return; return navigation.summaryPreviewProviderLines(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['summaryPreviewSummaryCenterText']>} args */
    function summaryPreviewSummaryCenterText(...args) { if (disposed) return; return navigation.summaryPreviewSummaryCenterText(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['summaryRestoreSummaryFromPreview']>} args */
    function summaryRestoreSummaryFromPreview(...args) { if (disposed) return; return navigation.summaryRestoreSummaryFromPreview(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['summaryRestoreProviderFromPreview']>} args */
    function summaryRestoreProviderFromPreview(...args) { if (disposed) return; return navigation.summaryRestoreProviderFromPreview(...args); }

    /** @type {import('../types').DistributionSummaryInteractions['summaryAttachProviderClickHandlers']} */
    const summaryAttachProviderClickHandlers = (...args) => { if (!disposed) return summaryInteractions.summaryAttachProviderClickHandlers(...args); };

    /** @type {import('../types').DistributionSummaryInteractions['summaryAttachProviderNavHandlers']} */
    const summaryAttachProviderNavHandlers = (...args) => { if (!disposed) return summaryInteractions.summaryAttachProviderNavHandlers(...args); };
    /** @param {Parameters<import('../types').DistributionNavigation['summaryApplySummarySubFilter']>} args */
    function summaryApplySummarySubFilter(...args) { if (disposed) return; return navigation.summaryApplySummarySubFilter(...args); }

    /** @param {Parameters<import('../types').DistributionNavigation['summaryClearSummarySubFilter']>} args */
    function summaryClearSummarySubFilter(...args) { if (disposed) return; return navigation.summaryClearSummarySubFilter(...args); }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['summaryHighlightActiveSummaryRow']>} args */
    function summaryHighlightActiveSummaryRow(...args) { return presentation.summaryHighlightActiveSummaryRow(...args); }
    /** @param {Parameters<import('../types').DistributionNavigation['summaryApplySubFilter']>} args */
    function summaryApplySubFilter(...args) { if (disposed) return; return navigation.summaryApplySubFilter(...args); }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['summaryHighlightActiveSubRow']>} args */
    function summaryHighlightActiveSubRow(...args) { return presentation.summaryHighlightActiveSubRow(...args); }
    /** @param {Parameters<import('../types').DistributionNavigation['summaryClearSubFilter']>} args */
    function summaryClearSubFilter(...args) { if (disposed) return; return navigation.summaryClearSubFilter(...args); }

    /** @type {import('../types').DistributionSummaryInteractions['summaryAttachSummaryHandlers']} */
    const summaryAttachSummaryHandlers = (...args) => { if (!disposed) return summaryInteractions.summaryAttachSummaryHandlers(...args); };

    /** @type {import('../types').DistributionTooltips['tooltipIsPinnedTo']} */
    const tooltipIsPinnedTo = (...args) => tooltipController.tooltipIsPinnedTo(...args);

    /** @type {import('../types').DistributionSummaryInteractions['tooltipAttachSubTooltipHandlers']} */
    const tooltipAttachSubTooltipHandlers = (...args) => { if (!disposed) return summaryInteractions.tooltipAttachSubTooltipHandlers(...args); };

    /** @type {import('../types').DistributionTooltips['tooltipShowSubTooltip']} */
    const tooltipShowSubTooltip = (...args) => { if (!disposed) return tooltipController.tooltipShowSubTooltip(...args); };

    /** @type {import('../types').DistributionTooltips['tooltipPositionSubTooltip']} */
    const tooltipPositionSubTooltip = (...args) => { if (!disposed) return tooltipController.tooltipPositionSubTooltip(...args); };

    /** @type {import('../types').DistributionTooltips['tooltipHideSubTooltip']} */
    const tooltipHideSubTooltip = (...args) => { if (!disposed) return tooltipController.tooltipHideSubTooltip(...args); };

    /** @type {import('../types').DistributionTooltips['tooltipPinSubTooltip']} */
    const tooltipPinSubTooltip = (...args) => { if (!disposed) return tooltipController.tooltipPinSubTooltip(...args); };

    /** @type {import('../types').DistributionTooltips['tooltipShowSubSubTooltip']} */
    const tooltipShowSubSubTooltip = (...args) => { if (!disposed) return tooltipController.tooltipShowSubSubTooltip(...args); };

    /** @type {import('../types').DistributionTooltips['tooltipHideSubSubTooltip']} */
    const tooltipHideSubSubTooltip = (...args) => { if (!disposed) return tooltipController.tooltipHideSubSubTooltip(...args); };

    /** @type {import('../types').DistributionSummaryInteractions['tooltipAttachSubSubTooltipHandlers']} */
    const tooltipAttachSubSubTooltipHandlers = (...args) => { if (!disposed) return summaryInteractions.tooltipAttachSubSubTooltipHandlers(...args); };

    /** @type {import('../types').DistributionTooltips['tooltipHighlightSelectedPeerRow']} */
    const tooltipHighlightSelectedPeerRow = (...args) => { if (!disposed) return tooltipController.tooltipHighlightSelectedPeerRow(...args); };

    /** @type {import('../types').DistributionInsightInteractions['insightAttachSummaryLinkHandlers']} */
    const insightAttachSummaryLinkHandlers = (...args) => { if (!disposed) return insightInteractions.insightAttachSummaryLinkHandlers(...args); };

    /** @type {import('../types').DistributionInsightInteractions['insightAttachFastestProvRowHandlers']} */
    const insightAttachFastestProvRowHandlers = (...args) =>
        { if (!disposed) return insightInteractions.insightAttachFastestProvRowHandlers(...args); };

    /** @type {import('../types').DistributionInsightInteractions['insightAttachDataProviderRowHandlers']} */
    const insightAttachDataProviderRowHandlers = (...args) =>
        { if (!disposed) return insightInteractions.insightAttachDataProviderRowHandlers(...args); };

    /** @param {string} field */
    function buildDataProviderHtml(field) { return summaryView.buildDataProviderHtml(computeSummaryData(), field); }

    function buildStablePeersHtml() { return summaryView.buildStablePeersHtml(computeSummaryData(), dashboard.peers); }

    function buildFastestProvHtml() { return summaryView.buildFastestProvHtml(computeSummaryData()); }
    /** @param {Parameters<import('../types').DistributionNavigation['refreshSelectionViews']>} args */
    function refreshSelectionViews(...args) { if (disposed) return; return navigation.refreshSelectionViews(...args); }

    /** @param {import('../types').Peer[]} peers */
    function update(peers) {
        if (disposed) return;
        if (!model.update(peers)) return;
        const pendingCount = peers.filter(peer => peer.location_status === 'pending').length;
        const loading = peers.length > 0 && pendingCount / peers.length > 0.1;
        donutController.updateLoading(pendingCount, loading);
        peerDetailController.update();
        if (elements.container) elements.container.classList.toggle('no-data', getActiveTotalPeers() === 0 && !loading);
        if (!distributionState.peerDetailActive) {
            renderDonut();
            renderCenter();
            renderLegend();
        }
        refreshSelectionViews();
    }

    /** @param {Parameters<ReturnType<typeof import('./presentation.js').create>['getLineOriginForAs']>} args */
    function getLineOriginForAs(...args) { return presentation.getLineOriginForAs(...args); }

    /** Set legends hidden state (called from app.js when toggle changes)
     * @param {boolean} hidden */
    function setLegendsHidden(hidden) {
        if (disposed) return;
        legendsHidden = !!hidden;
    }

    /** Get the currently selected AS number */
    function getSelectedAs() { return distributionState.selectedProvider; }

    /** @param {Parameters<import('../types').DistributionNavigation['openNetworkPanel']>} args */
    function openNetworkPanel(...args) { if (disposed) return; return navigation.openNetworkPanel(...args); }

    const summaryInteractions = BPMDistributionSummaryInteractions.create({
        state: distributionState,
        isReconciling: () => navigation.isReconciling(),
        getSummaryView: () => summaryView,
        getGroups: () => model.providerGroups,
        actions: {
            previewCountry: (...args) => { if (!disposed) return navigation.previewCountry(...args); },
            restoreCountryPreview: (...args) => { if (!disposed) return navigation.restoreCountryPreview(...args); },
            selectCountryFromSummary: (...args) => { if (!disposed) return navigation.selectCountryFromSummary(...args); },
            dismissPanelTooltips: (...args) => { if (!disposed) return navigation.dismissPanelTooltips(...args); },
            previewNestedProvider: (...args) => { if (!disposed) return navigation.previewNestedProvider(...args); },
            selectNestedProvider: (...args) => { if (!disposed) return navigation.selectNestedProvider(...args); },
            enterPrivateFromTooltip: (...args) => { if (!disposed) return navigation.enterPrivateFromTooltip(...args); },
            previewConnectionProvider: (...args) => { if (!disposed) return navigation.previewConnectionProvider(...args); },
            selectConnectionProvider: (...args) => { if (!disposed) return navigation.selectConnectionProvider(...args); },
            previewOutboundTypeGroup: (...args) => { if (!disposed) return navigation.previewOutboundTypeGroup(...args); },
            selectOutboundTypeGroup: (...args) => { if (!disposed) return navigation.selectOutboundTypeGroup(...args); },
            previewConnectionDirection: (...args) => { if (!disposed) return navigation.previewConnectionDirection(...args); },
            selectConnectionDirection: (...args) => { if (!disposed) return navigation.selectConnectionDirection(...args); },
            selectOtherProviders: (...args) => { if (!disposed) return navigation.selectOtherProviders(...args); },
            previewTooltipPeer: (...args) => { if (!disposed) return navigation.previewTooltipPeer(...args); },
            restoreTooltipPeerPreview: (...args) => { if (!disposed) return navigation.restoreTooltipPeerPreview(...args); },
            selectPrimaryTooltipPeer: (...args) => { if (!disposed) return navigation.selectPrimaryTooltipPeer(...args); },
            selectSecondaryTooltipPeer: (...args) => { if (!disposed) return navigation.selectSecondaryTooltipPeer(...args); },
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
        getPanel: () => elements.panel,
        getDonut: () => donutController,
        actions: {
            previewNavigationProvider: (...args) => { if (!disposed) return navigation.previewNavigationProvider(...args); },
            selectAllProviders: (...args) => { if (!disposed) return navigation.selectAllProviders(...args); },
            selectHeaderProviders: (...args) => { if (!disposed) return navigation.selectHeaderProviders(...args); },
            previewFastestProviders: (...args) => { if (!disposed) return navigation.previewFastestProviders(...args); },
            selectFastestProviders: (...args) => { if (!disposed) return navigation.selectFastestProviders(...args); },
            previewStablePeers: (...args) => { if (!disposed) return navigation.previewStablePeers(...args); },
            selectStablePeers: (...args) => { if (!disposed) return navigation.selectStablePeers(...args); },
            previewDataProviders: (...args) => { if (!disposed) return navigation.previewDataProviders(...args); },
            selectDataProviders: (...args) => { if (!disposed) return navigation.selectDataProviders(...args); },
            enterPrivateFromSummary: (...args) => { if (!disposed) return navigation.enterPrivateFromSummary(...args); },
            previewFastestProvider: (...args) => { if (!disposed) return navigation.previewFastestProvider(...args); },
            selectFastestProvider: (...args) => { if (!disposed) return navigation.selectFastestProvider(...args); },
            previewDataProvider: (...args) => { if (!disposed) return navigation.previewDataProvider(...args); },
            selectDataProvider: (...args) => { if (!disposed) return navigation.selectDataProvider(...args); },
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
        getPanel: () => elements.panel,
        actions: {
            dismissTooltip: (level) => {
                // A peer popup can sit above either pinned list. Dismiss children
                // through the same transitions before closing the requested list.
                for (let stage = 0; stage < 3; stage++) {
                    navigation.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
                    if (level === 'primary' ? !distributionState.subTooltipPinned : !distributionState.subSubTooltipPinned) break;
                }
            },
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

    const navigation = BPMDistributionNavigation.create({
        getCountrySegments: () => model.countrySegments,
        state: distributionState,
        hooks,
        getPanel: () => elements.panel,
        getContainer: () => elements.container,
        getDonut: () => donutController,
        areLegendsHidden: () => legendsHidden,
        getPeerDetail: () => peerDetailController,
        getSegments: () => model.providerSegments,
        getGroups: () => model.providerGroups,
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

    const presentation = BPMDistributionPresentation.create({
        document, dashboard, state: distributionState, model, donut: donutController,
        getElements: () => elements, areLegendsHidden: () => legendsHidden,
        getNavigation: () => navigation, getInteractions: () => summaryInteractions,
        summaryView,
    });
    const controls = BPMDistributionControls.create({
        document, state: distributionState, donut: donutController,
        getNavigation: () => navigation, getElements: () => elements,
        onElements: next => { elements = next; }, updateLensChrome, renderCenter,
    });

    function dispose() {
        if (disposed) return;
        disposed = true;
        controls.dispose();
        if (initialized) {
            navigation.exitFocusedMode();
            navigation.deselect();
            tooltipController.tooltipHideSubTooltip();
            elements.panel?.classList.add('hidden');
            document.getElementById('as-overview-trigger')?.setAttribute('aria-expanded', 'false');
        }
        presentation.dispose();
        donutController.dispose();
        peerDetailController.dispose();
    }

    return Object.freeze({
        init, setHooks, update, deselect, onMapClick, getLineOriginForAs,
        getSelectedAs, getColorForAs, enterFocusedMode, exitFocusedMode,
        isFocusedMode, openPeerDetailPanel, closePeerPopup, openNetworkPanel,
        setLegendsHidden, isPeerDetailActive: () => distributionState.peerDetailActive,
        dispose,
    });
}
