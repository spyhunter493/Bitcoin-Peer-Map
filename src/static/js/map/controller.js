import * as BPMMapNavigation from './navigation.js';
import * as BPMMapTooltips from './tooltips.js';
import { required } from '../core/dom.js';
import * as BPMMapRenderer from './renderer.js';
import * as BPMMapInput from './input.js';
import * as BPMMapControls from './controls.js';
import { dashboard as BPMDashboard } from '../core/dashboard-state.js';
import * as BPMPreferences from '../settings/preferences.js';
import * as BPMPolling from '../core/polling.js';
import * as BPMNodeDashboard from '../node/dashboard.js';
import * as BPMDistributionController from '../distribution/controller.js';
import * as BPMPrivateNetwork from '../peers/private-network.js';
import * as BPMWorldMap from './geometry.js';
import * as BPMPeerRefresh from '../peers/refresh.js';
import * as BPMPeerTable from '../peers/table.js';
import * as BPMPeerActions from '../peers/actions.js';
import * as BPMModal from '../core/modal.js';
function create() {
    'use strict';
    const dashboard = BPMDashboard;
    const BPMDistribution = BPMDistributionController.create({ dashboard });
    /** @type {import('../types').MapView} */
    const mapView = { width: 0, height: 0, nodes: [], target: { x: 0, y: 0, zoom: 1 } };

    const STORAGE_KEYS = Object.freeze({
        theme: 'bpm.theme',
        peerTableDisplay: 'bpm.peerTable.display',
        antarcticaDisclaimerSeen: 'bpm.antarcticaDisclaimerSeen',
    });
    const assetRevision = document.body.dataset.assetRevision || '';

    /** @param {string} filename */
    function staticAssetUrl(filename) {
        return `/static/assets/${filename}?v=${encodeURIComponent(assetRevision)}`;
    }

    /** @param {string} filename */
    async function fetchStaticJson(filename) {
        const response = await fetch(staticAssetUrl(filename));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════

    const CFG = {
        pollInterval: 10000, // ms between /api/peers fetches
        infoPollInterval: 15000, // ms between /api/info fetches
        nodeRadius: 3, // base circle radius in px
        glowRadius: 14, // outer glow radius in px
        fadeInDuration: 800, // ms for opacity fade-in
        fadeOutDuration: 1500, // ms for disconnected node fade-out
        minZoom: 1,
        maxZoom: 18,
        zoomStep: 1.15,
        panSmooth: 0.12, // smoothing factor for view interpolation
        gridSpacing: 30, // degrees between grid lines
        coastlineWidth: 1.0,

        // ── Arrival bloom (first ~5 seconds) ──
        arrivalDuration: 5000, // ms — how long the arrival phase lasts
        arrivalRingMaxRadius: 28, // px — expanding ring max radius
        arrivalRingDuration: 1200, // ms — how long the ring expansion takes
        arrivalPulseSpeed: 0.006, // fast energetic pulse during arrival

        // ── Connection age -> brightness & steadiness ──
        ageBrightnessMin: 0.35, // floor opacity for brand-new peers
        ageBrightnessMax: 1.0, // ceiling opacity for veteran peers
        ageRampSeconds: 3600, // seconds to go from min to max brightness (1 hour)

        // ── Pulse behaviour by direction ──
        // Base rates — new peers get additional "nervousness" on top
        pulseSpeedInbound: 0.0014, // slower, calm breathing for inbound
        pulseSpeedOutbound: 0.0026, // faster, sharper pulse for outbound
        pulseDepthInbound: 0.32, // gentle but visible amplitude for inbound
        pulseDepthOutbound: 0.48, // more pronounced for outbound
        // Nervousness: young peers pulse faster, veterans are steady
        nervousnessMax: 0.003, // extra pulse speed added to young peers
        nervousnessRampSec: 1800, // seconds for nervousness to decay to zero (30 min)

        // ── Ambient shimmer (residual twinkle for veteran peers) ──
        // Three sine waves at incommensurate frequencies; when they align
        // positively a peer gets a brief bright "twinkle."  Each node's
        // unique phase keeps the sparkles scattered across the map.
        shimmerStrength: 0.36, // how bright the twinkle spikes get (0 = off)
        shimmerFreq1: 0.00293, // primary wave   (period ≈ 2.1 s)
        shimmerFreq2: 0.00517, // secondary wave  (period ≈ 1.2 s)
        shimmerFreq3: 0.00711, // tertiary wave   (period ≈ 0.88 s)

        // ── Fade-out ──
        fadeOutEase: 2.0, // exponent for ease-out curve
    };

    const preferences = BPMPreferences.create({
        distribution: BPMDistribution,
        config: CFG,
        onAction(type) {
            switch (type) {
                case 'theme':
                    for (const node of mapView.nodes) node.color = NET_COLORS[node.peer.network] || NET_COLOR_UNKNOWN;
                    renderer.invalidate();
                    break;
                case 'map-style':
                    markBasemapDirty();
                    break;
                case 'intervals':
                    syncPollingIntervals();
                    break;
                case 'peer-interval':
                    lastPeerFetchTime = Date.now();
                    startCountdownTimer();
                    break;
                case 'private-show':
                    renderPnMiniDonut();
                    break;
                case 'private-hide':
                    finishInitialViewSelection();
                    exitPrivateNetMode();
                    break;
            }
        },
    });
    const {
        advSettings,
        NET_COLORS,
        NET_COLOR_UNKNOWN,
    } = preferences;

    const effectivePollInterval = BPMPolling.effectiveInterval;

    // Map internal network names to display-friendly labels
    /** @type {Record<string, string>} */
    const NET_DISPLAY = {
        ipv4: 'IPv4',
        ipv6: 'IPv6',
        onion: 'Tor',
        i2p: 'I2P',
        cjdns: 'CJDNS',
    };

    // ═══════════════════════════════════════════════════════════
    // CANVAS & VIEW STATE
    // ═══════════════════════════════════════════════════════════

    /** @type {HTMLCanvasElement} */
    const basemapCanvas = required('#basemap');
    /** @param {HTMLCanvasElement} canvas @param {CanvasRenderingContext2DSettings} [options] */
    function canvasContext(canvas, options) {
        const context = canvas.getContext('2d', options);
        if (!context) throw new Error('Canvas rendering is unavailable');
        return context;
    }
    const baseCtx = canvasContext(basemapCanvas, { alpha: false });
    /** @type {HTMLCanvasElement} */
    const canvas = required('#worldmap');
    const ctx = canvasContext(canvas);

    // Current view (smoothly interpolated each frame)
    const view = { x: 0, y: 0, zoom: 1 };
    // Target view (set instantly by user input, view lerps toward it)
    mapView.target = { x: 0, y: 0, zoom: 1 };

    // ═══════════════════════════════════════════════════════════
    // PEER SNAPSHOT & NETWORK INTEGRATION
    // ═══════════════════════════════════════════════════════════

    const privateState = dashboard.privateNetwork;

    const PRIVATE_NETS = new Set(['onion', 'i2p', 'cjdns']);

    // Choose a startup view from the first applied snapshot, unless the user
    // navigates while that snapshot is still loading. Polling only updates data.
    let initialViewPending = true;

    function finishInitialViewSelection() {
        initialViewPending = false;
        document.removeEventListener('click', preserveInitialViewNavigation, true);
        document.removeEventListener('pointerdown', preserveInitialViewNavigation, true);
        document.removeEventListener('wheel', preserveInitialViewNavigation, true);
    }

    /** @param {Event} event */
    function preserveInitialViewNavigation(event) {
        if (!(event.target instanceof Element)) return;
        const selector = event.type === 'click'
            ? '#worldmap, .zoom-btn, .net-badge, .fd-net-chip, #as-distribution-container, #as-detail-panel, #pn-container, #pn-detail-panel, #peer-tbody'
            : '#worldmap';
        if (event.target.closest(selector)) finishInitialViewSelection();
    }

    // DOM references
    const clockEl = required('#clock');
    /** @type {HTMLTemplateElement} */
    const antTemplate = required('#antarctica-disclaimer-template');
    /** @type {import('../types').ModalController | null} */
    let antDialog = null;

    // ═══════════════════════════════════════════════════════════
    // NODE DASHBOARD
    // ═══════════════════════════════════════════════════════════

    const nodeDashboard = BPMNodeDashboard.create({
        dashboard,
        config: CFG,
        onAction(action) {
            switch (action.type) {
                case 'intervals':
                    syncPollingIntervals();
                    break;
                case 'refresh-peers':
                    return fetchPeers();
                case 'network': {
                    const netKey = action.network;
                    if (PRIVATE_NETS.has(netKey)) {
                        // Private network chip → enter private mode + open that network's panel
                        if (!privateState.privateNetMode) {
                            enterPrivateNetMode(null, netKey);
                        } else {
                            // Already in private mode — just switch to this network
                            privateState.pnSelectedNet = netKey;
                            cachePnElements();
                            if (privateState.pnContainerEl) privateState.pnContainerEl.classList.add('pn-focused');
                            privatePanel.openPnDetailPanel(netKey);
                            updatePrivateNetUI();
                        }
                    } else {
                        // Public network chip (ipv4/ipv6) → exit private mode if active, open network panel
                        if (privateState.privateNetMode) exitPrivateNetMode();
                        if (BPMDistribution) {
                            if (!BPMDistribution.isFocusedMode()) {
                                BPMDistribution.enterFocusedMode();
                            }
                            // Open the dedicated IPv4/IPv6 network detail panel
                            BPMDistribution.openNetworkPanel(netKey);
                        }
                    }
                    break;
                }
            }
        },
    });
    const {
        updateFlightDeck,
        infoPolling,
        fetchInfo,
        renderPeerDataStatus,
        updateHUD,
        getNetworkStats,
    } = nodeDashboard;

    // ═══════════════════════════════════════════════════════════
    // PRIVATE NETWORK MODE — Full Antarctica view for Tor/I2P/CJDNS
    // Circular donut + detail panel with cascading sub-tooltips
    // (mirrors the AS Distribution panel pattern)
    // ═══════════════════════════════════════════════════════════

    const privateNetwork = BPMPrivateNetwork.create({
        dashboard,
        distribution: BPMDistribution,
        mapView,
        settings: advSettings,
        onAction(action) {
            switch (action.type) {
                case 'highlight':
                    dashboard.interaction.highlightedPeerId = action.peerId;
                    break;
                case 'pin':
                    dashboard.interaction.pinnedNode =
                        mapView.nodes.find((node) => node.peerId === action.peerId && node.alive) || null;
                    break;
                case 'networks':
                    dashboard.interaction.enabledNets = action.networks;
                    break;
                case 'hide-tooltip':
                    hideTooltip();
                    break;
                case 'clear-filter':
                    clearMapDotFilter();
                    break;
                case 'badges':
                    updateBadgeStates();
                    break;
                case 'table':
                    peerTable.renderPeerTable();
                    break;
                case 'highlight-row':
                    peerTable.highlightTableRow(action.peerId);
                    break;
                case 'layout':
                    scheduleDonutStackFit();
                    break;
                case 'disconnect':
                    showDisconnectDialog(action.peerId, action.network);
                    break;
            }
        },
    });
    const {
        privatePanel,
        cachePnElements,
        privatePopup,
        enterPrivateNetMode,
        exitPrivateNetMode,
        selectPrivatePeer,
        updatePrivateNetUI,
        renderPnMiniDonut,
        getPnMiniLegendDotPos,
    } = privateNetwork;

    const renderer = BPMMapRenderer.create({
        mapView,
        view,
        canvas,
        ctx,
        basemapCanvas,
        baseCtx,
        connectionCanvas: required('#map-connections'),
        config: CFG,
        preferences,
        interaction: dashboard.interaction,
        privateState,
        isMapNodeVisible,
        showAntarcticaPeers: () => peerTable.showAntarcticaPeers,
        getPrivateInsightOrigin: () => privatePanel.getPnInsightRectOrigin(),
        getPnMiniLegendDotPos,
        distribution: BPMDistribution,
        fetchJson: fetchStaticJson,
        onResize: fitDonutStackToViewport,
    });
    const { resize, worldToScreen, screenToWorld, getWrapOffsets, findNodesAtScreen,
        markBasemapDirty } = renderer;

    /** @param {HTMLElement} container
     * @param {string} scale
     * @param {boolean} [immediate] */
    function applyDonutStackFitScale(container, scale, immediate) {
        if (!immediate) {
            container.style.setProperty('--as-donut-fit-scale', scale);
            return;
        }

        const previousTransition = container.style.transition;
        container.style.transition = 'none';
        container.style.setProperty('--as-donut-fit-scale', scale);
        container.offsetHeight;
        requestAnimationFrame(() => {
            container.style.transition = previousTransition;
        });
    }

    /** @param {number} panelTop
     * @param {boolean} [immediate] */
    function fitDonutStackForPanelTop(panelTop, immediate) {
        const container = document.getElementById('as-distribution-container');
        if (!container) return;

        if (privateState.privateNetMode || document.body.classList.contains('donut-focused')) {
            applyDonutStackFitScale(container, '1', immediate);
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const unscaledHeight = container.offsetHeight || containerRect.height;
        const top = parseFloat(getComputedStyle(container).top) || containerRect.top;
        const availableHeight = panelTop - top - 18;

        const minScale = 0.45;

        if (unscaledHeight <= 0 || availableHeight <= 0) {
            applyDonutStackFitScale(container, String(minScale), immediate);
            return;
        }

        // Coverage and explicit controls increase the stack height. Fit the whole
        // stack even when a larger table leaves less than the former minimum.
        const nextScale = Math.min(1, availableHeight / unscaledHeight);
        applyDonutStackFitScale(container, nextScale.toFixed(3), immediate);
    }

    function fitDonutStackToViewport() {
        const container = document.getElementById('as-distribution-container');
        if (!container) return;

        const panel = document.getElementById('peer-panel');
        if (!panel || panel.classList.contains('collapsed')) {
            applyDonutStackFitScale(container, '1', false);
            return;
        }

        fitDonutStackForPanelTop(panel.getBoundingClientRect().top, false);
    }

    function scheduleDonutStackFit() {
        requestAnimationFrame(() => {
            fitDonutStackToViewport();
            requestAnimationFrame(fitDonutStackToViewport);
        });
        setTimeout(fitDonutStackToViewport, 480);
    }

    // ═══════════════════════════════════════════════════════════
    // PRIVATE-PEER PLACEMENT
    // ═══════════════════════════════════════════════════════════

    const mapTools = BPMWorldMap;
    const rgba = mapTools.rgba;
    const getAntarcticaPosition = mapTools.createAntarcticaLocator();

    // ═══════════════════════════════════════════════════════════
    // DATA FETCHING — Real peers from /api/peers
    // ═══════════════════════════════════════════════════════════

    /**
     * Fetch peers from the backend and transform them into canvas nodes.
     * - Peers with valid lat/lon and location_status "ok" use real coords
     * - Private/unavailable/pending peers go to Antarctica
     * - Existing nodes that are no longer in the response start fading out
     * - New nodes fade in with a spawn animation
     */
    const peerRefresh = BPMPeerRefresh.create({
        onPeers: applyPeerSnapshot,
        onStatus: renderPeerDataStatus,
    });

    function fetchPeers() {
        return peerRefresh.refresh().then(() => {
            lastPeerFetchTime = Date.now();
        });
    }

    /** @param {import('../types').Peer[]} peers */
    function applyPeerSnapshot(peers) {
        dashboard.replace(peers);

        const now = Date.now();

        // Build a set of peer IDs from this response
        const currentIds = new Set();
        for (const p of peers) currentIds.add(p.id);

        const aliveNodesByPeerId = new Map();
        for (const node of mapView.nodes) {
            if (node.alive) aliveNodesByPeerId.set(node.peerId, node);
        }

        // ── Mark departed peers for fade-out ──
        // If a node was alive and is no longer in the response, start its fade-out
        for (const node of mapView.nodes) {
            if (node.alive && !currentIds.has(node.peerId)) {
                node.alive = false;
                node.fadeOutStart = now;
            }
        }

        if (privateState.privateNetSelectedPeerId !== null && !currentIds.has(privateState.privateNetSelectedPeerId)) {
            privateState.privateNetSelectedPeerId = null;
            privateState.privateNetLinePeer = null;
            dashboard.interaction.highlightedPeerId = null;
            dashboard.interaction.pinnedNode = null;
            privatePopup.close();
        }

        // ── Add or update existing peers ──
        for (const peer of peers) {
            const existing = aliveNodesByPeerId.get(peer.id);

            // Determine map coordinates
            let lat, lon;
            let isPrivate =
                peer.location_status === 'private' ||
                peer.location_status === 'unavailable' ||
                peer.location_status === 'pending';

            if (isPrivate || peer.lat == null || peer.lon == null || (peer.lat === 0 && peer.lon === 0)) {
                isPrivate = true;
                // Place in Antarctica with stable position
                const pos = getAntarcticaPosition(peer.addr || `peer-${peer.id}`);
                lat = pos.lat;
                lon = pos.lon;
            } else {
                lat = peer.lat;
                lon = peer.lon;
            }

            // Resolve network colour
            const netKey = peer.network || 'ipv4';
            const color = NET_COLORS[netKey] || NET_COLOR_UNKNOWN;

            if (existing) {
                // ── Update in place (peer still connected) ──
                existing.lat = lat;
                existing.lon = lon;
                existing.peer = peer;
                existing.color = color;
                existing.isPrivate = isPrivate;
            } else {
                // ── New peer — create node with spawn animation ──
                const newNode = {
                    peerId: peer.id,
                    lat,
                    lon,
                    peer,
                    color,
                    isPrivate,
                    // Animation state
                    phase: Math.random() * Math.PI * 2, // random pulse phase
                    spawnTime: now, // triggers fade-in animation
                    alive: true,
                    fadeOutStart: null,
                };
                mapView.nodes.push(newNode);
                aliveNodesByPeerId.set(peer.id, newNode);
            }
        }

        // ── Garbage collect fully faded-out nodes ──
        mapView.nodes = mapView.nodes.filter((n) => {
            if (!n.alive && n.fadeOutStart) {
                return now - n.fadeOutStart < CFG.fadeOutDuration;
            }
            return true;
        });

        mapNavigation.reconcile();

        // Update flight deck network counts
        updateFlightDeck(peers);
        updateHUD();

        // [DISTRIBUTION] Update AS Distribution donut with latest peer data (always active)
        if (BPMDistribution) {
            BPMDistribution.update(dashboard.peers);
        }

        // Refresh the peer table panel
        peerTable.renderPeerTable();

        privatePopup.update();

        // [PRIVATE-NET] Update private network UI if in that mode
        updatePrivateNetUI();

        // [PRIVATE-NET] Default to private mode only for a private-only startup
        // snapshot. An empty snapshot also settles the initial world view.
        if (initialViewPending) {
            finishInitialViewSelection();
            if (!privateState.privateNetMode && dashboard.peers.length > 0 &&
                dashboard.peers.every((peer) => PRIVATE_NETS.has(peer.network))) {
                enterPrivateNetMode();
            }
        }

        // [PRIVATE-NET] Update mini donut below public donut
        renderPnMiniDonut();
    }

    // ═══════════════════════════════════════════════════════════
    // HUD — Peer count, block height, network badges
    // ═══════════════════════════════════════════════════════════

    // Countdown timer state
    let lastPeerFetchTime = 0;
    /** @type {number | null} */
    let countdownInterval = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    let clockInterval = null;
    // Peer polling follows the visible or background interval.
    const peerPolling = BPMPolling.create({
        task: fetchPeers,
        intervalMs: effectivePollInterval(CFG.pollInterval),
    });

    function startCountdownTimer() {
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = null;
        if (document.hidden) return;
        countdownInterval = setInterval(() => {
            peerRefresh.renderStatus();
            const cdEl = document.getElementById('mo-countdown');
            if (!cdEl) return;
            const elapsed = Date.now() - lastPeerFetchTime;
            const remaining = Math.max(0, Math.ceil((CFG.pollInterval - elapsed) / 1000));
            cdEl.textContent = remaining + 's';
        }, 1000);
    }

    /** Antarctica modal is now CSS-centered; no per-frame repositioning needed
     * Update the clock display in the topbar */
    function updateClock() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        clockEl.textContent = `${h}:${m}:${s}`;
    }

    // ═══════════════════════════════════════════════════════════
    // TOOLTIP — Rich peer inspection on hover
    // ═══════════════════════════════════════════════════════════

    /** @param {Parameters<ReturnType<typeof BPMMapTooltips.create>['showGroupHoverTooltip']>} args */
    function showGroupHoverTooltip(...args) {
        return mapTooltips.showGroupHoverTooltip(...args);
    }

    function hideTooltip() {
        mapNavigation.hideTooltip();
    }

    /** Clear map dot filter and restore full peer table */
    function clearMapDotFilter() {
        mapNavigation.clearMapDotFilter();
    }

    // ═══════════════════════════════════════════════════════════
    // BOTTOM PEER PANEL — Full peer table with all columns
    // ═══════════════════════════════════════════════════════════

    const peerTable = BPMPeerTable.create({
        dashboard,
        mapView,
        preferences,
        onAction(action) {
            if (action.type === 'layout') scheduleDonutStackFit();
            else if (action.type === 'clear-filter') {
                const filter = action.filter;
                // Leaving the private view follows Return: start from the public
                // world with All networks rather than reviving hidden scopes.
                const publicReset = filter === 'all' || filter === 'private-mode';
                if (publicReset) {
                    finishInitialViewSelection();
                    exitPrivateNetMode();
                }
                if (publicReset || filter === 'provider') {
                    BPMDistribution.deselect();
                    dashboard.distribution.resetNavigation();
                    dashboard.distribution.insightActiveAsNum = null;
                    dashboard.distribution.insightActiveType = null;
                    dashboard.distribution.insightActiveData = null;
                    mapNavigation.filterPeerTable(null);
                }
                if (publicReset || filter === 'map') {
                    if (dashboard.distribution.peerDetailActive) BPMDistribution.closePeerPopup(true);
                    mapNavigation.closeGroup();
                }
                if (publicReset || filter === 'network') {
                    dashboard.interaction.enabledNets = new Set(['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns']);
                    updateBadgeStates();
                }
                if (filter === 'private-network') {
                    const group = privateState.pnFilter;
                    privateState.pnSelectedNet = null;
                    privatePanel.hidePnSubTooltip();
                    privatePanel.openPnOverviewPanel();
                    updatePrivateNetUI();
                    // The group descriptor still applies across private networks;
                    // its chip remains removable after the old popover closes.
                    privateState.pnFilter = group;
                } else if (filter === 'private-filter') {
                    privatePanel.hidePnSubTooltip();
                    updatePrivateNetUI();
                }
                peerTable.renderPeerTable();
            }
            else if (action.type === 'antarctica') {
                if (!action.visible) {
                    if (dashboard.interaction.pinnedNode?.isPrivate || dashboard.interaction.groupedNodes?.some((node) => node.isPrivate)) {
                        mapNavigation.closeGroup();
                    } else if (dashboard.interaction.hoveredNode?.isPrivate) {
                        dashboard.interaction.hoveredNode = null;
                        if (!dashboard.interaction.pinnedNode && !dashboard.interaction.groupedNodes) {
                            hideTooltip();
                            peerTable.highlightTableRow(null);
                        }
                    }
                    canvas.style.cursor = 'grab';
                    antDialog?.close();
                }
            } else if (action.top !== undefined) fitDonutStackForPanelTop(action.top, action.immediate);
            else fitDonutStackToViewport();
        },
    });

    /** @param {import('../types').MapNode} node */
    function isMapNodeVisible(node) {
        return peerTable.showAntarcticaPeers || !node.isPrivate;
    }

    // ── Ban list modal (overlay — peer table stays visible underneath) ──
    const bansBtn = document.getElementById('btn-bans');
    const peerActions = BPMPeerActions.create({
        refreshPeers: fetchPeers,
    });
    peerActions.init(bansBtn);

    const mapTooltips = BPMMapTooltips.create({
        element: required('#node-tooltip'),
        getWidth: () => mapView.width,
        networkLabels: NET_DISPLAY,
        rgba,
        onCloseGroup: () => mapNavigation.closeGroup(),
        onSelectPeer: (peerId, privateGroup) => mapNavigation.selectGroupPeer(peerId, privateGroup),
        onBack: (hasBackNav, mx, my) => mapNavigation.backFromTooltip(hasBackNav, mx, my),
        onDisconnect: showDisconnectDialog,
    });
    const mapNavigation = BPMMapNavigation.create({
        interaction: dashboard.interaction,
        view,
        target: mapView.target,
        maxZoom: CFG.maxZoom,
        getNodes: () => mapView.nodes,
        getPeer: (peerId) => dashboard.byId.get(peerId),
        getSize: () => ({ width: mapView.width, height: mapView.height }),
        isPanelCollapsed: () => peerTable.panelEl.classList.contains('collapsed'),
        collapsePanel: () => peerTable.panelEl.classList.add('collapsed'),
        getWrapOffsets,
        worldToScreen,
        screenToWorld,
        findNodesAtScreen,
        tooltips: mapTooltips,
        renderTable: () => peerTable.renderPeerTable(),
        highlightRow: (peerId, scroll) => peerTable.highlightTableRow(peerId, scroll),
        openPeerDetail: (peer, source, groupPeerIds) => {
            BPMDistribution.openPeerDetailPanel(peer, source, groupPeerIds);
            return true;
        },
        closePeerPopup: () => BPMDistribution.closePeerPopup(),
        isPeerDetailActive: () => BPMDistribution.isPeerDetailActive(),
        onMapClick: () => BPMDistribution.onMapClick(),
        getProviderColor: (provider) => BPMDistribution.getColorForAs(provider),
        isPrivateMode: () => privateState.privateNetMode,
        enterPrivateMode: (peerId) => enterPrivateNetMode(peerId),
        selectPrivatePeer,
        clearPrivatePeer: () => privateNetwork.clearPeerFromMap(),
    });

    const mapInput = BPMMapInput.create({
        canvas,
        mapView,
        view,
        config: CFG,
        interaction: dashboard.interaction,
        privateState,
        peerTable,
        mapNavigation,
        renderer,
        showGroupHoverTooltip,
        showDisconnectDialog,
        exitPrivateNetMode,
        getNetworkStats,
    });
    const controls = BPMMapControls.create({
        canvas,
        interaction: dashboard.interaction,
        privateState,
        privateNetwork,
        nodeDashboard,
        openDisplaySettingsPopup: preferences.openDisplaySettingsPopup,
        onPanelResize: scheduleDonutStackFit,
    });
    function updateBadgeStates() {
        mapInput.updateBadgeStates();
    }

    /** Show a confirmation dialog for disconnect with optional ban
     * @param {number} peerId
     * @param {string} net */
    function showDisconnectDialog(peerId, net) {
        peerActions.showDisconnectDialog(peerId, net);
    }

    function showAntarcticaDisclaimerOnce() {
        if (!peerTable.showAntarcticaPeers || antDialog?.isOpen()) return;

        try {
            if (localStorage.getItem(STORAGE_KEYS.antarcticaDisclaimerSeen) === 'true') return;
            localStorage.setItem(STORAGE_KEYS.antarcticaDisclaimerSeen, 'true');
        } catch (e) {
            // Storage may be unavailable in restricted browser contexts.
        }

        antDialog = BPMModal.open({
            id: 'antarctica-modal-overlay', title: 'Private peer location disclaimer',
            showHeader: false, ariaLabel: 'Private peer location disclaimer',
            overlayClass: 'ant-modal-overlay', boxClass: 'ant-modal', maxWidth: 400,
            contentHtml: antTemplate.innerHTML, initialFocusSelector: '#ant-close',
            onClose: () => { antDialog = null; },
        });
        required(':scope > :first-child', antDialog.overlay).id = 'antarctica-note';
        required('#ant-close', antDialog.overlay).addEventListener('click', () => antDialog?.close());
    }

    function syncPollingIntervals() {
        peerPolling.setIntervalMs(effectivePollInterval(CFG.pollInterval));
        infoPolling.setIntervalMs(effectivePollInterval(CFG.infoPollInterval));
    }

    // ═══════════════════════════════════════════════════════════
    // DISPLAY SETTINGS POPUP — right overlay Update/Status rows
    // ═══════════════════════════════════════════════════════════

    /** Refresh dashboard snapshots immediately when the tab becomes visible. */
    function handleVisibilityChange() {
        syncPollingIntervals();
        startCountdownTimer();
        if (document.hidden) return;
        // Fetch a fresh snapshot instead of waiting for the next foreground tick.
        peerPolling.run().catch(console.error);
        infoPolling.run().catch(console.error);
        updateClock();
    }

    // ═══════════════════════════════════════════════════════════
    // [DISTRIBUTION] — Module initialization (always-on, no toggle)
    // ═══════════════════════════════════════════════════════════

    function initAsDistribution() {
        if (!BPMDistribution) return;

        const distribution = BPMDistribution;
        distribution.init();
        const distributionContainer = document.getElementById('as-distribution-container');
        if (distributionContainer) {
            // Focus and hover reveal native legend controls, changing stack height.
            new ResizeObserver(fitDonutStackToViewport).observe(distributionContainer);
        }

        // Apply initial "Display Top ISP/Net" toggle state
        if (!advSettings.showDonutLegends) {
            const asCont = document.getElementById('as-distribution-container');
            if (asCont) asCont.classList.add('legends-hidden');
            const pnMiniLegend = document.getElementById('pn-mini-legend');
            if (pnMiniLegend) pnMiniLegend.style.display = 'none';
            distribution.setLegendsHidden(true);
        }

        // Provide integration hooks
        distribution.setHooks({
            drawLinesForAs: mapNavigation.drawLinesForAs,
            drawLinesForAllAs: mapNavigation.drawLinesForAllAs,
            clearAsLines: mapNavigation.clearAsLines,
            filterPeerTable: mapNavigation.filterPeerTable,
            dimMapPeers: mapNavigation.dimMapPeers,
            zoomToPeerOnly: mapNavigation.zoomToPeerOnly,
            resetMapZoom: mapNavigation.resetMapZoom,
            clearPeerSelection: mapNavigation.clearPeerSelection,
            hideMapTooltip: mapNavigation.hideTooltip,
            enterPrivateNetMode: function (targetNet) {
                enterPrivateNetMode(null, targetNet || null);
            },
            showDisconnectDialog: function (peerId, network) {
                peerActions.showDisconnectDialog(peerId, network);
            },
        });

        // Donut is always active — feed it initial data if available
        if (dashboard.peers.length > 0) {
            distribution.update(dashboard.peers);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // INIT — Start everything
    // ═══════════════════════════════════════════════════════════

    /** Release feature-owned requests, timers and listeners when leaving the page.
     * BFCache suspension retains the dashboard so returning preserves its view.
     * @param {PageTransitionEvent} event */
    function handlePageHide(event) {
        if (event.persisted) return;
        dispose();
    }

    let disposed = false;
    function dispose() {
        if (disposed) return;
        disposed = true;
        finishInitialViewSelection();
        peerPolling.stop();
        peerRefresh.dispose();
        renderer.stop();
        if (countdownInterval !== null) clearInterval(countdownInterval);
        if (clockInterval !== null) clearInterval(clockInterval);
        peerTable.dispose();
        nodeDashboard.dispose();
        privateNetwork.dispose();
        BPMDistribution.dispose();
        preferences.dispose();
        mapView.nodes = [];
        dashboard.clear();
        antDialog?.close(false);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('pagehide', handlePageHide);
    }

    let started = false;
    function init() {
        if (started || disposed) return;
        started = true;
        // Capture dark theme CSS defaults before any overrides
        preferences.init();

        // Restore table layout preferences before peer rows render.
        peerTable.loadTableDisplaySettings();
        peerTable.applyPanelOpacity();
        peerTable.updateAutoFitBtn();
        peerTable.renderPeerTableHead();
        peerTable.renderPeerTable();

        // Setup canvas size and DPI scaling
        resize();
        window.addEventListener('resize', resize);

        // Load the layers visible at the initial zoom. More detailed geography is
        // fetched shortly before its zoom threshold is reached.
        renderer.loadGeometry();

        // Fetch real peer data immediately, then poll every 10s
        document.addEventListener('click', preserveInitialViewNavigation, true);
        document.addEventListener('pointerdown', preserveInitialViewNavigation, true);
        document.addEventListener('wheel', preserveInitialViewNavigation, { capture: true, passive: true });
        lastPeerFetchTime = Date.now();
        fetchPeers();
        peerPolling.start();
        startCountdownTimer();

        // Fetch node info and metrics immediately, then poll.
        fetchInfo();
        infoPolling.start();

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pagehide', handlePageHide);

        showAntarcticaDisclaimerOnce();

        // Start the render loop (grid + nodes render immediately,
        // landmasses + lakes appear once JSON assets finish loading)
        renderer.start();

        updateClock();
        clockInterval = setInterval(updateClock, 1000);

        // [DISTRIBUTION] Initialize AS Distribution module (always-on donut)
        initAsDistribution();

        // [DISTRIBUTION] Wire up new peer panel buttons and topbar gear
        controls.init();

        // Apply default visible row count to peer panel
        peerTable.applyMaxPeerRows();
    }

    return Object.freeze({ start: init, dispose });
}
export { create };
