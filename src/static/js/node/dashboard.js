import * as API from '../core/api.js';
import { create as createLifecycle } from '../core/lifecycle.js';
import * as polling from '../core/polling.js';
import { fmtBytesShort } from '../core/format.js';
import * as nodeMonitor from './monitor.js';
import { renderUpdateStatus } from '../core/version.js';
import * as geoipSettings from '../settings/geoip.js';
import * as data from './dashboard-data.js';
import * as dashboardView from './dashboard-view.js';
import * as dashboardControls from './dashboard-controls.js';

/** Compose node polling, derived data, presentation and interactions.
 * @param {{
 * dashboard: ReturnType<typeof import('../core/dashboard-state.js').create>;
 * config: import('../types').DashboardConfig;
 * onAction: (action: import('../types').NodeAction) => void | Promise<void>;
 * document?: Document;
 * clock?: Pick<Window, 'setTimeout' | 'clearTimeout' | 'requestAnimationFrame' | 'cancelAnimationFrame' | 'setInterval' | 'clearInterval'>;
 * nowSeconds?: () => number; api?: typeof API; storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
 * }} options */
export function create(options) {
    const { dashboard, config, onAction } = options;
    const document = options.document || globalThis.document;
    const clock = options.clock || document.defaultView || undefined;
    const nowSeconds = options.nowSeconds || (() => Date.now() / 1000);
    const api = options.api || API;
    let storage = options.storage;
    if (storage === undefined) {
        try { storage = document.defaultView?.localStorage || null; }
        catch { storage = null; }
    }
    let lifecycle = createLifecycle(clock);
    /** @type {import('../types').NodeDisplayInfo | null} */
    let lastNodeInfo = null;
    /** @type {import('../types').NodeRefreshState} */
    const refreshState = { stale: false, lastSuccessfulRefresh: null };
    const ui = { counts: data.networkCounts([]), scores: /** @type {Record<string, number | null>} */ ({ ipv4: null, ipv6: null }),
        networkDetails: /** @type {Record<string, import('../types').NetworkDetails>} */ ({}) };
    /** @type {ReturnType<typeof dashboardView.create>} */
    let view;
    /** @type {ReturnType<typeof dashboardControls.create>} */
    let controls;
    /** @type {ReturnType<typeof nodeMonitor.create>} */
    let monitor;
    /** @type {ReturnType<typeof geoipSettings.create>} */
    let settings;
    let initialized = false, generation = 0;
    let requests = new AbortController();
    let previousInternetState = 'green', lastRestoredToastTime = 0;
    let intervalMs = document.hidden ? Math.max(config.infoPollInterval, 60000) : config.infoPollInterval;
    const createPoller = () => polling.create({ task: refreshNodeInfo, intervalMs, clock });
    let poller = createPoller();
    // Keep the public polling handle stable while each lifecycle owns its pending read.
    const infoPolling = Object.freeze({
        run: () => poller.run(), start: () => poller.start(), stop: () => poller.stop(),
        /** @param {number} value */
        setIntervalMs(value) { poller.setIntervalMs(value); intervalMs = value; },
    });
    function fetchInfo() { return infoPolling.run(); }
    async function refreshNodeInfo() {
        if (!initialized) return;
        const requestGeneration = generation;
        try {
            /** @type {import('../types').NodeInfo} */
            const info = await api.getJson('/api/info', { signal: requests.signal }, 35_000);
            if (!initialized || requestGeneration !== generation) return;
            if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Invalid node info response');
            lastNodeInfo = info;
            refreshState.lastSuccessfulRefresh = nowSeconds() * 1000;
            refreshState.stale = false;
            renderUpdateStatus(info.updates, document);
            if (info.internet_state) {
                view.updateInternetDot(info.internet_state);
                const now = nowSeconds() * 1000;
                if (info.internet_state === 'green' && previousInternetState !== 'green' && now - lastRestoredToastTime > 60000) {
                    controls.showConnectionRestoredToast();
                    lastRestoredToastTime = now;
                }
                previousInternetState = info.internet_state;
            }
            if (info.api_available === false && !info.geo_db_only_mode) void controls.checkApiDownPrompt();
            view.updateNodeTrafficTotals(info.node_traffic);
            view.updateTrafficRates();
            view.renderNodeMetricsValues();
            if (info.network_scores) {
                ui.scores.ipv4 = info.network_scores.ipv4;
                ui.scores.ipv6 = info.network_scores.ipv6;
            }
            ui.networkDetails = info.network_details || {};
            view.updateHUD();
            monitor.refreshNodeInfo();
        } catch (error) {
            if (!initialized || requestGeneration !== generation) return;
            refreshState.stale = refreshState.lastSuccessfulRefresh !== null;
            if (lastNodeInfo) lastNodeInfo = { ...lastNodeInfo, node_traffic: null, node_metrics: undefined };
            view.updateNodeTrafficTotals(null);
            view.updateTrafficRates();
            view.renderNodeMetricsValues();
            view.updateHUD();
            monitor.refreshNodeInfo();
            console.error('[Bitcoin Peer Map] Failed to fetch info:', error);
        }
    }
    function init() {
        if (initialized) return;
        initialized = true;
        if (generation > 0) { poller.stop(); poller = createPoller(); }
        generation++;
        if (!lifecycle.isActive()) lifecycle = createLifecycle(clock);
        if (requests.signal.aborted) requests = new AbortController();
        const environment = { document, dashboard, nowSeconds, getNodeInfo: () => lastNodeInfo, getRefreshState: () => refreshState, ui };
        view = dashboardView.create({ ...environment, lifecycle: lifecycle.replace('view') });
        controls = dashboardControls.create({ ...environment, lifecycle: lifecycle.replace('controls'), view, api,
            storage: storage || null, fetchInfo, fetchPeers: () => { void onAction({ type: 'refresh-peers' }); }, onAction });
        monitor = nodeMonitor.create({ ...environment, api, formatBytes: fmtBytesShort });
        settings = geoipSettings.create({ ...environment, clock, refreshInfo: fetchInfo });
    }
    function dispose() {
        if (!initialized) return;
        initialized = false;
        generation++;
        requests.abort();
        infoPolling.stop();
        lastNodeInfo = null;
        refreshState.stale = false;
        refreshState.lastSuccessfulRefresh = null;
        ui.counts = data.networkCounts([]);
        ui.scores = { ipv4: null, ipv6: null };
        ui.networkDetails = {};
        controls.dispose();
        monitor.dispose();
        settings.dispose();
        view.dispose();
        lifecycle.dispose();
    }
    init();
    return Object.freeze({ init, dispose, infoPolling, fetchInfo,
        /** @param {import('../types').Peer[]} peers */
        updateFlightDeck: peers => { if (initialized) view.updateFlightDeck(peers); },
        openGeoDBDropdown: () => { if (initialized) settings.open(); },
        openRecentBlocksModal: () => { if (initialized) monitor.openRecentBlocks(); },
        openNodeInfoModal: () => { if (initialized) monitor.openNodeInfo(); },
        openChainTipsModal: () => { if (initialized) monitor.openChainTips(); },
        /** @param {import('../types').PeerDataStatus} status */
        renderPeerDataStatus: status => { if (initialized) view.renderPeerDataStatus(status); },
        updateHUD: () => { if (initialized) view.updateHUD(); },
        /** @param {string} network */
        getNetworkStats: network => initialized ? view.getNetworkStats(network) : null,
    });
}
