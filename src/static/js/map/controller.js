/* ============================================================
   Bitcoin Peer Map — Canvas World Map with Real Bitcoin Peers
   Interaction Stabilization Pass
   ============================================================
   - Fetches real peers from the existing server backend
   - Renders them on a canvas world map (no Leaflet)
   - Private/overlay networks (Tor, I2P, CJDNS) placed in Antarctica
   - Visual peer lifecycle: arrival bloom → age brightness → fade-out
   - Inbound vs outbound peers have distinct pulse rhythms
   - Long-lived peers glow bright & steady; fresh peers dim & nervous
   - Rich hover tooltip with identity, location, network, performance
   - Collapsible bottom panel with full peer table
   - Bidirectional highlight: hover map node ↔ table row
   - Click table row → center map on that peer
   - Peer actions: disconnect, ban (24h)
   - Network badge click-to-filter + hover stats popover
   - Horizontal world wrapping (seamless pan)
   - Vertical lock at zoom 1, vertical clamping at all zooms
   - Antarctica annotation for private network peers
   ============================================================ */

(function (global) {
function create() {
    'use strict';
    const dashboard = window.BPMDashboard;
    const mapView = { width: 0, height: 0, nodes: [], target: { x: 0, y: 0, zoom: 1 } };

    const STORAGE_KEYS = Object.freeze({
        theme: 'bpm.theme',
        peerTableDisplay: 'bpm.peerTable.display',
        antarcticaDisclaimerSeen: 'bpm.antarcticaDisclaimerSeen',
    });
    const repositoryUrl = document.body.dataset.repositoryUrl;
    const repositoryDiscussionsUrl = `${repositoryUrl}/discussions`;
    const assetRevision = document.body.dataset.assetRevision;
    const mrow = window.BPMModal.row;
    const escapeHtml = window.BPMModal.escapeHtml;

    function staticAssetUrl(filename) {
        return `/static/assets/${filename}?v=${encodeURIComponent(assetRevision)}`;
    }

    async function fetchStaticJson(filename) {
        const response = await fetch(staticAssetUrl(filename));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════

    const CFG = {
        pollInterval: 10000,       // ms between /api/peers fetches
        infoPollInterval: 15000,   // ms between /api/info fetches
        nodeRadius: 3,             // base circle radius in px
        glowRadius: 14,            // outer glow radius in px
        fadeInDuration: 800,       // ms for opacity fade-in
        fadeOutDuration: 1500,     // ms for disconnected node fade-out
        minZoom: 1,
        maxZoom: 18,
        zoomStep: 1.15,
        panSmooth: 0.12,           // smoothing factor for view interpolation
        gridSpacing: 30,           // degrees between grid lines
        coastlineWidth: 1.0,

        // ── Arrival bloom (first ~5 seconds) ──
        arrivalDuration: 5000,     // ms — how long the arrival phase lasts
        arrivalRingMaxRadius: 28,  // px — expanding ring max radius
        arrivalRingDuration: 1200, // ms — how long the ring expansion takes
        arrivalPulseSpeed: 0.006,  // fast energetic pulse during arrival

        // ── Connection age -> brightness & steadiness ──
        ageBrightnessMin: 0.35,    // floor opacity for brand-new peers
        ageBrightnessMax: 1.0,     // ceiling opacity for veteran peers
        ageRampSeconds: 3600,      // seconds to go from min to max brightness (1 hour)

        // ── Pulse behaviour by direction ──
        // Base rates — new peers get additional "nervousness" on top
        pulseSpeedInbound: 0.0014,   // slower, calm breathing for inbound
        pulseSpeedOutbound: 0.0026,  // faster, sharper pulse for outbound
        pulseDepthInbound: 0.32,     // gentle but visible amplitude for inbound
        pulseDepthOutbound: 0.48,    // more pronounced for outbound
        // Nervousness: young peers pulse faster, veterans are steady
        nervousnessMax: 0.003,     // extra pulse speed added to young peers
        nervousnessRampSec: 1800,  // seconds for nervousness to decay to zero (30 min)

        // ── Ambient shimmer (residual twinkle for veteran peers) ──
        // Three sine waves at incommensurate frequencies; when they align
        // positively a peer gets a brief bright "twinkle."  Each node's
        // unique phase keeps the sparkles scattered across the map.
        shimmerStrength: 0.36,     // how bright the twinkle spikes get (0 = off)
        shimmerFreq1: 0.00293,    // primary wave   (period ≈ 2.1 s)
        shimmerFreq2: 0.00517,    // secondary wave  (period ≈ 1.2 s)
        shimmerFreq3: 0.00711,    // tertiary wave   (period ≈ 0.88 s)

        // ── Fade-out ──
        fadeOutEase: 2.0,          // exponent for ease-out curve
    };

    const preferences = window.BPMPreferences.create({ config: CFG, onAction(type) {
        switch (type) {
            case 'theme': for (const node of mapView.nodes) node.color = NET_COLORS[node.peer.network] || NET_COLOR_UNKNOWN; break;
            case 'map-style': markBasemapDirty(); break;
            case 'intervals': syncPollingIntervals(); break;
            case 'peer-interval': lastPeerFetchTime = Date.now(); startCountdownTimer(); break;
            case 'private-show': renderPnMiniDonut(); break;
            case 'private-hide': exitPrivateNetMode(); break;
        }
    } });
    const { advSettings, advColors, canvasLabelColors, nodeHighlightColor, NET_COLORS, NET_COLOR_UNKNOWN, readSavedDisplaySettings, writeSavedDisplaySettings, saveAdvSettings, openDisplaySettingsPopup, closeDisplaySettingsPopup } = preferences;

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const effectivePollInterval = window.BPMPolling.effectiveInterval;

    let polarPolygons = [];
    let nonPolarPolygons = [];

    /** Map brightness slider (0-100, centered at 50) to HSL lightness */


    /** Rebuild advColors from current advSettings */


    /** Toggle solid backgrounds on HUD overlays (map-overlay, flight-deck, btc-price-bar, right-overlay) */


    /** Convert HSL to "r,g,b" string for use in rgba() */


    /** Classify world polygons into polar vs non-polar for "Snow the Poles" */
    function classifyPolarPolygons() {
        polarPolygons = [];
        nonPolarPolygons = [];
        for (let i = 0; i < worldPolygons.length; i++) {
            const ring = worldPolygons[i][0];
            if (!ring || ring.length === 0) { nonPolarPolygons.push(worldPolygons[i]); continue; }
            let sumLat = 0;
            for (let j = 0; j < ring.length; j++) sumLat += ring[j][1];
            const avgLat = sumLat / ring.length;
            if (avgLat < -60 || avgLat > 66) polarPolygons.push(worldPolygons[i]);
            else nonPolarPolygons.push(worldPolygons[i]);
        }
    }

    // Map internal network names to display-friendly labels
    const NET_DISPLAY = {
        ipv4: 'IPv4', ipv6: 'IPv6', onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS',
    };

    const SERVICE_FLAGS = window.BPMServiceFlags;

    const serviceFlagDescription = window.BPMFormat.serviceFlagDescription;

    /** Build unique short abbreviation string from services array */
    function serviceAbbrev(services) {
        if (!services || !services.length) return '\u2014';
        return services.map(s => (Object.hasOwn(SERVICE_FLAGS, s) ? SERVICE_FLAGS[s].abbr : s.charAt(0))).join(' ');
    }

    /** Build full hover description from services array */
    function serviceHover(services) {
        if (!services || !services.length) return 'No service flags';
        return services.map(s => {
            const f = Object.hasOwn(SERVICE_FLAGS, s) ? SERVICE_FLAGS[s] : null;
            return f ? `${f.abbr} = ${serviceFlagDescription(f)}` : s;
        }).join('\n');
    }

    function serviceFlagFromAbbr(abbr) {
        for (const flag of Object.values(SERVICE_FLAGS)) {
            if (flag.abbr === abbr) return flag;
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    // CANVAS & VIEW STATE
    // ═══════════════════════════════════════════════════════════

    const basemapCanvas = document.getElementById('basemap');
    const baseCtx = basemapCanvas.getContext('2d', { alpha: false });
    const canvas = document.getElementById('worldmap');
    const ctx = canvas.getContext('2d');

  // canvas logical dimensions (CSS pixels)
    const BASEMAP_DPR_CAP = 1.5;
    const INTERACTION_DPR_CAP = 1;
    let basemapDpr = 1;
    let peerDpr = 1;

    // Static geography is projected into reusable viewport-space paths.
    // The cached basemap bitmap is transformed while the camera is moving,
    // then redrawn once at the settled view for sharp output.
    const basemapPaths = {
        grid: null,
        land: null,
        polar: null,
        lakes: null,
        borders: null,
        states: null,
    };
    let basemapView = null;
    let basemapDirty = true;
    let lastBasemapTransform = '';

    // Current view (smoothly interpolated each frame)
    let view = { x: 0, y: 0, zoom: 1 };
    // Target view (set instantly by user input, view lerps toward it)
    mapView.target = { x: 0, y: 0, zoom: 1 };

    // Mouse drag state
    let dragging = false;
    let dragStart = { x: 0, y: 0 };
    let dragViewStart = { x: 0, y: 0 };

    // ═══════════════════════════════════════════════════════════
    // NODE STATE
    // Nodes are built from /api/peers responses.
    // Each node has animation metadata (spawnTime, fadeOutStart).
    // ═══════════════════════════════════════════════════════════

    mapView.nodes = [];          // currently visible + fading-out nodes
      // peer ID highlighted via map↔table interaction

    // [MAP DOT FILTER] State for multi-peer dot grouping
       // Set of peer IDs to show when a map dot is clicked (null = no filter)
           // Array of nodes at clicked dot (for back navigation from drill-down)

    // [DISTRIBUTION] State for AS Distribution integration
        // Set of peer IDs to show when AS is selected (null = no filter)
          // Array of peer IDs to draw lines to (hover/selection)
            // Color string for AS lines
            // AS number for legend dot lookup
           // Array of {asNum, peerIds, color} for hover-all mode

    const privateState = dashboard.privateNetwork;

    const PRIVATE_NETS = new Set(['onion', 'i2p', 'cjdns']);

    // Network filter: Set of enabled network keys. When ALL networks are enabled, equivalent to "All".
    const ALL_NETS = new Set(['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns']);
      // start with all enabled

    /** Check if all networks are enabled (= "All" state) */
    function isAllNetsEnabled() {
        for (const n of ALL_NETS) {
            if (!dashboard.interaction.enabledNets.has(n)) return false;
        }
        return true;
    }

    /** Check if a node passes the current network filter */
    function passesNetFilter(netKey) {
        return dashboard.interaction.enabledNets.has(netKey);
    }

    // ═══════════════════════════════════════════════════════════
    // WORLD GEOMETRY STATE
    // Land polygons, lake polygons, borders, and cities loaded
    // from static assets. Each layer appears at different zoom levels.
    // ═══════════════════════════════════════════════════════════

    let worldPolygons = [];
    let lakePolygons = [];
    let borderLines = [];      // country border line strings
    let stateLines = [];       // state/province border line strings
    let cityPoints = [];       // { n: name, p: population, c: [lon,lat] }
    let countryLabels = [];    // { n: name, c: [lon,lat] } — country centroids (English)
    let stateLabels = [];      // { n: name, c: [lon,lat] } — state/province centroids (English)
    let worldReady = false;
    let lakesReady = false;
    let bordersReady = false;
    let statesReady = false;
    let citiesReady = false;
    let countryLabelsReady = false;
    let stateLabelsReady = false;
    // Zoom thresholds for progressive detail layers
    // Country borders render at ALL zoom levels (no threshold)
    // Label hierarchy: countries first → states → cities
    const ZOOM_SHOW_COUNTRY_LABELS = 1.5;  // country names appear (medium zoom)
    const ZOOM_SHOW_STATES         = 3.0;  // state/province borders appear
    const ZOOM_SHOW_STATE_LABELS   = 4.0;  // state/province names (after countries visible)
    const ZOOM_SHOW_CITIES_MAJOR   = 6.0;  // cities > 5M population
    const ZOOM_SHOW_CITIES_LARGE   = 8.0;  // cities > 1M population
    const ZOOM_SHOW_CITIES_MED     = 10.0; // cities > 300K population
    const ZOOM_SHOW_CITIES_ALL     = 12.0; // all cities
    const ZOOM_PREFETCH_STATES       = ZOOM_SHOW_STATES - 0.5;
    const ZOOM_PREFETCH_STATE_LABELS = ZOOM_SHOW_STATE_LABELS - 0.5;
    const ZOOM_PREFETCH_CITIES       = ZOOM_SHOW_CITIES_MAJOR - 0.5;

    // DOM references
    const clockEl = document.getElementById('clock');
    const tooltipEl = document.getElementById('node-tooltip');
    const antOverlay = document.getElementById('antarctica-modal-overlay');

      // Tooltip pins when user clicks a node or table row

    // ═══════════════════════════════════════════════════════════
    // PULSE ON CHANGE — Number animation system
    // Ported from legacy dashboard.js with all 4 modes
    // ═══════════════════════════════════════════════════════════

    // MINIMIZE BUTTON — Toggle peer panel collapsed state
    // ═══════════════════════════════════════════════════════════

    const nodeDashboard = window.BPMNodeDashboard.create({ config: CFG, onAction(action) {
        switch (action.type) {
            case 'intervals': syncPollingIntervals(); break;
            case 'refresh-peers': return fetchPeers();
            case 'settings': openDisplaySettingsPopup(action.anchor); break;
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
                if (window.BPMDistribution) {
                    if (!window.BPMDistribution.isFocusedMode()) {
                        window.BPMDistribution.enterFocusedMode();
                    }
                    // Open the dedicated IPv4/IPv6 network detail panel
                    window.BPMDistribution.openNetworkPanel(netKey);
                }
            }
                break;
            }
        }
    } });
    const { updateFlightDeck, infoPolling, openGeoDBDropdown, syncDbAutoUpdateTimer, fetchInfo, openRecentBlocksModal, openNodeInfoModal, openChainTipsModal, renderPeerDataStatus, updateHUD, getNetworkStats, systemStatsPolling, disconnectSystemStream, connectSystemStream } = nodeDashboard;

    const minimizeBtn = document.getElementById('btn-minimize');

    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = document.getElementById('peer-panel');
            if (panel) {
                panel.classList.toggle('collapsed');
                const isCollapsed = panel.classList.contains('collapsed');
                minimizeBtn.innerHTML = isCollapsed ? '&#9650;' : '&#9660;';
                minimizeBtn.title = isCollapsed ? 'Show peer list table' : 'Hide peer list table';
                scheduleDonutStackFit();
            }
        });
    }

    // ═══════════════════════════════════════════════════════════
    // BTC PRICE STATE
    // ═══════════════════════════════════════════════════════════

    // PRIVATE NETWORK MODE — Full Antarctica view for Tor/I2P/CJDNS
    // Circular donut + detail panel with cascading sub-tooltips
    // (mirrors the AS Distribution panel pattern)
    // ═══════════════════════════════════════════════════════════

    const privateNetwork = window.BPMPrivateNetwork.create({ mapView, settings: advSettings, onAction(action) {
        switch (action.type) {
            case 'highlight': dashboard.interaction.highlightedPeerId = action.peerId; break;
            case 'pin': dashboard.interaction.pinnedNode = mapView.nodes.find(node => node.peerId === action.peerId && node.alive) || null; break;
            case 'networks': dashboard.interaction.enabledNets = action.networks; break;
            case 'hide-tooltip': hideTooltip(); break;
            case 'clear-filter': clearMapDotFilter(); break;
            case 'badges': updateBadgeStates(); break;
            case 'table': peerTable.renderPeerTable(); break;
            case 'highlight-row': peerTable.highlightTableRow(action.peerId); break;
            case 'layout': scheduleDonutStackFit(); break;
            case 'disconnect': showDisconnectDialog(action.peerId, action.network); break;
        }
    } });
    const { privatePanel, cachePnElements, privatePopup, enterPrivateNetMode, exitPrivateNetMode, selectPrivatePeer, renderPnDonut, updatePrivateNetUI, renderPnMiniDonut, getPnMiniLegendDotPos } = privateNetwork;

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

        const nextScale = Math.max(minScale, Math.min(1, availableHeight / unscaledHeight));
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

    /** Render the mini private donut below the public AS donut (when private peers exist) */
    function drawPrivateNetworksText() {
        if (!privateState.privateNetMode) return;

        const fontSize1 = Math.max(12, Math.min(48, 18 * view.zoom));
        const fontSize2 = Math.max(10, Math.min(40, 15 * view.zoom));
        const fontSize3 = Math.max(6, Math.min(14, 5 * view.zoom));

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Tile "PRIVATE NETWORKS" at repeating positions across Antarctica
        const tileLons = [-160, -100, -40, 30, 90, 150];
        const tileRows = [
            { lat1: -72, lat2: -77, sub: -80 },
            { lat1: -78, lat2: -83, sub: -86 },
        ];

        for (let ri = 0; ri < tileRows.length; ri++) {
            const row = tileRows[ri];
            for (let ci = 0; ci < tileLons.length; ci++) {
                const lon = tileLons[ci];
                // Stagger odd rows
                const lonOff = (ri % 2 === 1) ? 30 : 0;
                const sLon = lon + lonOff;

                // Fade outer tiles for softer edges
                const distFromCenter = Math.abs(sLon) / 180;
                const alphaFade = 1 - distFromCenter * 0.5;

                const s1 = worldToScreen(sLon, row.lat1);
                const s2 = worldToScreen(sLon, row.lat2);

                // Skip if off screen
                if (s1.x < -200 || s1.x > mapView.width + 200) continue;
                if (s1.y < -200 || s1.y > mapView.height + 200) continue;

                // Big "PRIVATE" text
                ctx.font = `900 ${fontSize1}px 'Cinzel', serif`;
                ctx.fillStyle = `rgba(240, 136, 62, ${(0.22 * alphaFade).toFixed(3)})`;
                ctx.shadowColor = `rgba(240, 136, 62, ${(0.12 * alphaFade).toFixed(3)})`;
                ctx.shadowBlur = 20;
                ctx.fillText('P R I V A T E', s1.x, s1.y);

                // "NETWORKS" below
                ctx.font = `700 ${fontSize2}px 'Cinzel', serif`;
                ctx.fillStyle = `rgba(240, 136, 62, ${(0.16 * alphaFade).toFixed(3)})`;
                ctx.shadowBlur = 15;
                ctx.fillText('N E T W O R K S', s2.x, s2.y);

                // Subtitle on first row only
                if (ri === 0 && (ci === 2 || ci === 3)) {
                    const s3 = worldToScreen(sLon, row.sub);
                    ctx.font = `600 ${fontSize3}px 'JetBrains Mono', monospace`;
                    ctx.fillStyle = `rgba(240, 136, 62, ${(0.10 * alphaFade).toFixed(3)})`;
                    ctx.shadowBlur = 8;
                    ctx.fillText('NOT REAL LOCATIONS', s3.x, s3.y);
                }
            }
        }

        ctx.restore();
    }

    /** Network type → RGB color for private-net lines (must match PN_NET_COLORS_HEX) */
    const PN_LINE_COLORS = {
        onion: { r: 21, g: 101, b: 192 },
        i2p:   { r: 210, g: 153, b: 34 },
        cjdns: { r: 188, g: 140, b: 255 }
    };

    /** Get the page-coords origin for a private network's legend dot in the mini donut.
     *  Returns {x, y} or null. */
    function drawPrivateNetLines(wrapOffsets) {
        if (!privateState.privateNetMode && !privateState.pnMiniHover) return;

        const canvasRect = canvas.getBoundingClientRect();

        // Determine a fallback donut center origin
        const originElId = privateState.privateNetMode ? 'pn-donut-wrap' : 'pn-mini-donut';
        const originEl = document.getElementById(originElId);
        if (!originEl) return;
        const fallbackRect = originEl.getBoundingClientRect();
        const fallbackOriginX = (fallbackRect.left + fallbackRect.width / 2 - canvasRect.left) * (mapView.width / canvasRect.width);
        const fallbackOriginY = (fallbackRect.top + fallbackRect.height / 2 - canvasRect.top) * (mapView.height / canvasRect.height);

        // Determine which nodes to draw lines to (priority chain)
        let privateNodes;
        const selectedId = privateState.privateNetLinePeer;

        if (privateState.privateNetMode && privateState.pnPreviewPeerIds !== null) {
            // Panel row hover preview → specific peer IDs
            const idSet = new Set(privateState.pnPreviewPeerIds);
            privateNodes = mapView.nodes.filter(n => n.alive && idSet.has(n.peerId));
        } else if (privateState.privateNetMode && selectedId) {
            // Selected peer → only that peer
            const selectedNode = mapView.nodes.find(n => n.peerId === selectedId && n.alive);
            privateNodes = selectedNode ? [selectedNode] : [];
        } else if (privateState.privateNetMode && privateState.pnHoveredNet) {
            // Hovered donut segment → that network's peers
            privateNodes = mapView.nodes.filter(n => n.alive && n.peer.network === privateState.pnHoveredNet);
        } else if (privateState.privateNetMode && privateState.pnSelectedNet) {
            // Selected donut segment → that network's peers
            privateNodes = mapView.nodes.filter(n => n.alive && n.peer.network === privateState.pnSelectedNet);
        } else if (privateState.privateNetMode) {
            // No selection/hover → ALL private peers
            privateNodes = mapView.nodes.filter(n => n.alive && PRIVATE_NETS.has(n.peer.network));
        } else if (privateState.pnMiniHover && privateState.pnMiniHoverNet) {
            // Mini donut segment hover → that network's peers
            privateNodes = mapView.nodes.filter(n => n.alive && n.peer.network === privateState.pnMiniHoverNet);
        } else if (privateState.pnMiniHover) {
            // Mini donut hover → all private peers
            privateNodes = mapView.nodes.filter(n => n.alive && PRIVATE_NETS.has(n.peer.network));
        } else {
            return;
        }
        if (privateNodes.length === 0) return;

        ctx.save();
        const lineW = Math.max(1.2, 1.5 * Math.min(view.zoom / 1.5, 3));
        ctx.lineWidth = lineW;

        for (const node of privateNodes) {
            // Determine origin: insight rect, mini legend dot, or donut center.
            let originX = fallbackOriginX;
            let originY = fallbackOriginY;
            if (privateState.pnInsightRectVisible && privateState.privateNetMode) {
                // When insight rect is visible, lines come from the origin circle at the bottom
                const iro = privatePanel.getPnInsightRectOrigin();
                if (iro) {
                    originX = (iro.x - canvasRect.left) * (mapView.width / canvasRect.width);
                    originY = (iro.y - canvasRect.top) * (mapView.height / canvasRect.height);
                }
            } else if (privateState.pnMiniHover && !privateState.privateNetMode) {
                const dotPos = getPnMiniLegendDotPos(node.peer.network);
                if (dotPos) {
                    originX = (dotPos.x - canvasRect.left) * (mapView.width / canvasRect.width);
                    originY = (dotPos.y - canvasRect.top) * (mapView.height / canvasRect.height);
                }
            }

            // Find best screen position
            let bestS = null;
            let bestDist = Infinity;
            for (const off of wrapOffsets) {
                const s = worldToScreen(node.lon + off, node.lat);
                const dx = s.x - mapView.width / 2;
                const dy = s.y - mapView.height / 2;
                const d = dx * dx + dy * dy;
                if (d < bestDist) { bestDist = d; bestS = s; }
            }
            if (!bestS) continue;

            const c = PN_LINE_COLORS[node.peer.network] || { r: 240, g: 136, b: 62 };
            const dist = Math.sqrt((originX - bestS.x) ** 2 + (originY - bestS.y) ** 2);
            const isSelected = node.peerId === selectedId;
            const baseAlpha = isSelected ? 0.6 : 0.25;
            const alpha = Math.min(baseAlpha, 0.1 + (baseAlpha - 0.05) * (1 - dist / Math.max(mapView.width, mapView.height)));

            ctx.globalAlpha = 1;
            ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${alpha.toFixed(3)})`;
            ctx.lineWidth = isSelected ? lineW * 1.5 : lineW;

            ctx.beginPath();
            ctx.moveTo(originX, originY);
            ctx.lineTo(bestS.x, bestS.y);
            ctx.stroke();

            // Small dot at the peer position
            ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${isSelected ? 0.8 : 0.5})`;
            ctx.beginPath();
            ctx.arc(bestS.x, bestS.y, isSelected ? 5 : 3, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════
    // PRIVATE-NET GROUP SELECTION — multi-peer dot click list
    // ═══════════════════════════════════════════════════════════

    /** Show a pinned selection list for multiple private peers at one map dot */
    function showPnGroupSelectionList(group, mx, my) {
        let html = '';
        html += `<div class="tt-header"><span class="tt-peer-id" style="text-align:center;flex:1">${group.length} peers at this location</span><span class="tt-group-close" title="Close">\u2715</span></div>`;
        html += `<div class="tt-section tt-group-list">`;
        group.forEach((node, i) => {
            const netLabel = NET_DISPLAY[node.peer.network] || node.peer.network.toUpperCase();
            const netColor = rgba(node.color, 0.9);
            const addr = shortenAddr(node);
            html += `<div class="tt-row tt-group-row tt-group-clickable" data-peer-id="${escapeHtml(node.peerId)}">`;
            html += `<span class="tt-label" style="min-width:16px">${i + 1}.</span>`;
            html += `<span class="tt-net" style="color:${netColor};min-width:36px">${escapeHtml(netLabel)}</span>`;
            html += `<span class="tt-val" style="flex:1">${escapeHtml(addr)}</span>`;
            html += `</div>`;
        });
        html += `</div>`;

        tooltipEl.innerHTML = html;
        tooltipEl.classList.remove('hidden');
        tooltipEl.classList.add('pinned');
        tooltipEl.style.pointerEvents = 'auto';
        positionTooltip(mx, my);

        // Close button
        const closeBtn = tooltipEl.querySelector('.tt-group-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dashboard.interaction.pinnedNode = null;
                dashboard.interaction.groupedNodes = null;
                dashboard.interaction.highlightedPeerId = null;
                hideTooltip();
                peerTable.highlightTableRow(null);
                clearMapDotFilter();
            });
        }

        // Click a row to select that private peer
        tooltipEl.querySelectorAll('.tt-group-clickable').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const peerId = parseInt(row.dataset.peerId);
                hideTooltip();
                dashboard.interaction.groupedNodes = group; // preserve for back navigation
                selectPrivatePeer(peerId);
            });
        });
    }

    // ═══════════════════════════════════════════════════════════
    // PRIVATE-NET BIG POPUP — full peer detail for private peers
    // ═══════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════
    // WORLD MAP PROJECTION, PRIVATE-PEER PLACEMENT & DATA LOADING
    // ═══════════════════════════════════════════════════════════

    const mapTools = window.BPMWorldMap;
    const project = mapTools.project;
    const rgba = mapTools.rgba;
    const lerp = mapTools.lerp;
    const clamp = mapTools.clamp;
    const getAntarcticaPosition = mapTools.createAntarcticaLocator();

    function worldToScreen(lon, lat) {
        return mapTools.worldToScreen(lon, lat, mapView.width, mapView.height, view);
    }

    function screenToWorld(x, y) {
        return mapTools.screenToWorld(x, y, mapView.width, mapView.height, view);
    }

    const mapDataLoader = mapTools.createDataLoader({
        fetchJson: fetchStaticJson,
        thresholds: {
            states: ZOOM_PREFETCH_STATES,
            stateLabels: ZOOM_PREFETCH_STATE_LABELS,
            cities: ZOOM_PREFETCH_CITIES,
        },
        callbacks: {
            world(polygons) {
                worldPolygons = polygons;
                worldReady = true;
                classifyPolarPolygons();
                rebuildWorldPaths();
                markBasemapDirty();
            },
            lakes(polygons) {
                lakePolygons = polygons;
                lakesReady = true;
                rebuildLakePath();
                markBasemapDirty();
            },
            borders(lines) {
                borderLines = lines;
                bordersReady = true;
                rebuildBorderPath();
                markBasemapDirty();
            },
            states(lines) {
                stateLines = lines;
                statesReady = true;
                rebuildStatePath();
                markBasemapDirty();
            },
            cities(points) {
                cityPoints = points;
                citiesReady = true;
                projectBasemapPoints(cityPoints);
                markBasemapDirty();
            },
            countryLabels(labels) {
                countryLabels = labels;
                countryLabelsReady = true;
                projectBasemapPoints(countryLabels);
                markBasemapDirty();
            },
            stateLabels(labels) {
                stateLabels = labels;
                stateLabelsReady = true;
                projectBasemapPoints(stateLabels);
                markBasemapDirty();
            },
        },
    });

    const loadWorldGeometry = mapDataLoader.loadWorld;
    const loadLakeGeometry = mapDataLoader.loadLakes;
    const loadBorderGeometry = mapDataLoader.loadBorders;
    const loadStateGeometry = mapDataLoader.loadStates;
    const loadCityData = mapDataLoader.loadCities;
    const loadCountryLabels = mapDataLoader.loadCountryLabels;
    const loadStateLabels = mapDataLoader.loadStateLabels;
    const ensureZoomDetailLoaded = mapDataLoader.ensureZoomDetailLoaded;

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
    const peerRefresh = window.BPMPeerRefresh.create({
        onPeers: applyPeerSnapshot,
        onStatus: renderPeerDataStatus,
    });

    function fetchPeers() {
        return peerRefresh.refresh().then(() => { lastPeerFetchTime = Date.now(); });
    }

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
            const isPrivate = (
                peer.location_status === 'private' ||
                peer.location_status === 'unavailable' ||
                peer.location_status === 'pending'
            );

            if (isPrivate || (peer.lat === 0 && peer.lon === 0)) {
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
                    phase: Math.random() * Math.PI * 2,  // random pulse phase
                    spawnTime: now,                       // triggers fade-in animation
                    alive: true,
                    fadeOutStart: null,
                };
                mapView.nodes.push(newNode);
                aliveNodesByPeerId.set(peer.id, newNode);
            }
        }

        // ── Garbage collect fully faded-out nodes ──
        mapView.nodes = mapView.nodes.filter(n => {
            if (!n.alive && n.fadeOutStart) {
                return (now - n.fadeOutStart) < CFG.fadeOutDuration;
            }
            return true;
        });

        // Update flight deck network counts
        updateFlightDeck(peers);
        updateHUD();

        // [DISTRIBUTION] Update AS Distribution donut with latest peer data (always active)
        if (window.BPMDistribution) {
            window.BPMDistribution.update(dashboard.peers);
        }

        // Refresh the peer table panel
        peerTable.renderPeerTable();

        privatePopup.update();

        // [PRIVATE-NET] Update private network UI if in that mode
        updatePrivateNetUI();

        // [PRIVATE-NET] Auto-enter private mode if user only has private peers
        if (!privateState.privateNetMode && dashboard.peers.length > 0) {
            const publicPeers = dashboard.peers.filter(p => !PRIVATE_NETS.has(p.network));
            const privatePeers = dashboard.peers.filter(p => PRIVATE_NETS.has(p.network));
            if (publicPeers.length === 0 && privatePeers.length > 0) {
                enterPrivateNetMode();
            }
        }

        // [PRIVATE-NET] Update mini donut below public donut
        renderPnMiniDonut();

    }

    // ═══════════════════════════════════════════════════════════
    // DATA FETCHING — Node info from /api/info (block height)
    // ═══════════════════════════════════════════════════════════

    function sizeCanvas(targetCanvas, targetCtx, dpr) {
        const pixelWidth = Math.max(1, Math.round(mapView.width * dpr));
        const pixelHeight = Math.max(1, Math.round(mapView.height * dpr));
        if (targetCanvas.width !== pixelWidth || targetCanvas.height !== pixelHeight) {
            targetCanvas.width = pixelWidth;
            targetCanvas.height = pixelHeight;
        }
        targetCanvas.style.width = mapView.width + 'px';
        targetCanvas.style.height = mapView.height + 'px';
        targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resizePeerLayer(interacting) {
        const nativeDpr = window.devicePixelRatio || 1;
        const nextDpr = Math.min(nativeDpr, interacting ? INTERACTION_DPR_CAP : BASEMAP_DPR_CAP);
        if (nextDpr === peerDpr && canvas.width && canvas.height) return;
        peerDpr = nextDpr;
        sizeCanvas(canvas, ctx, peerDpr);
    }

    function resize() {
        mapView.width = window.innerWidth;
        mapView.height = window.innerHeight;
        basemapDpr = Math.min(window.devicePixelRatio || 1, BASEMAP_DPR_CAP);
        const peerCap = document.body.classList.contains('map-interacting') ? INTERACTION_DPR_CAP : BASEMAP_DPR_CAP;
        peerDpr = Math.min(window.devicePixelRatio || 1, peerCap);
        sizeCanvas(basemapCanvas, baseCtx, basemapDpr);
        sizeCanvas(canvas, ctx, peerDpr);
        rebuildBasemapPaths();
        basemapView = null;
        basemapCanvas.style.transform = 'none';
        lastBasemapTransform = 'none';
        markBasemapDirty();
        fitDonutStackToViewport();
    }

    function setMapInteraction(active) {
        document.body.classList.toggle('map-interacting', active);
        resizePeerLayer(active);
        if (!active && !basemapMatchesView()) markBasemapDirty();
    }

    function markBasemapDirty() {
        basemapDirty = true;
    }

    function basePoint(lon, lat) {
        const p = project(lon, lat);
        return { x: (p.x - 0.5) * mapView.width, y: (p.y - 0.5) * mapView.height };
    }

    function projectBasemapPoints(points) {
        if (!mapView.width || !mapView.height) return;
        for (const point of points) {
            const p = basePoint(point.c[0], point.c[1]);
            point.mapX = p.x;
            point.mapY = p.y;
        }
    }

    function buildPolygonPath(polygons) {
        if (!mapView.width || !mapView.height || polygons.length === 0) return null;
        const path = new Path2D();
        for (const polygon of polygons) {
            for (const ring of polygon) {
                for (let i = 0; i < ring.length; i++) {
                    const p = basePoint(ring[i][0], ring[i][1]);
                    if (i === 0) path.moveTo(p.x, p.y);
                    else path.lineTo(p.x, p.y);
                }
                path.closePath();
            }
        }
        return path;
    }

    function buildLinePath(lines) {
        if (!mapView.width || !mapView.height || lines.length === 0) return null;
        const path = new Path2D();
        for (const line of lines) {
            for (let i = 0; i < line.length; i++) {
                const p = basePoint(line[i][0], line[i][1]);
                if (i === 0) path.moveTo(p.x, p.y);
                else path.lineTo(p.x, p.y);
            }
        }
        return path;
    }

    function rebuildGridPath() {
        if (!mapView.width || !mapView.height) return;
        const path = new Path2D();
        for (let lon = -180; lon <= 180; lon += CFG.gridSpacing) {
            for (let lat = -85; lat <= 85; lat += 2) {
                const p = basePoint(lon, lat);
                if (lat === -85) path.moveTo(p.x, p.y);
                else path.lineTo(p.x, p.y);
            }
        }
        for (let lat = -60; lat <= 80; lat += CFG.gridSpacing) {
            for (let lon = -180; lon <= 180; lon += 2) {
                const p = basePoint(lon, lat);
                if (lon === -180) path.moveTo(p.x, p.y);
                else path.lineTo(p.x, p.y);
            }
        }
        basemapPaths.grid = path;
    }

    function rebuildWorldPaths() {
        basemapPaths.land = buildPolygonPath(worldPolygons);
        basemapPaths.polar = buildPolygonPath(polarPolygons);
    }

    function rebuildLakePath() {
        basemapPaths.lakes = buildPolygonPath(lakePolygons);
    }

    function rebuildBorderPath() {
        basemapPaths.borders = buildLinePath(borderLines);
    }

    function rebuildStatePath() {
        basemapPaths.states = buildLinePath(stateLines);
    }

    function rebuildBasemapPaths() {
        rebuildGridPath();
        rebuildWorldPaths();
        rebuildLakePath();
        rebuildBorderPath();
        rebuildStatePath();
        projectBasemapPoints(countryLabels);
        projectBasemapPoints(stateLabels);
        projectBasemapPoints(cityPoints);
    }

    // ═══════════════════════════════════════════════════════════
    // DRAWING — Grid, landmasses, lakes, borders, cities, nodes
    // Horizontal world wrapping: the map repeats seamlessly.
    // ═══════════════════════════════════════════════════════════

    /**
     * Returns longitude offsets for world rendering.
     * Computes which copies of the 360° world are visible on screen
     * so the map repeats seamlessly when panning horizontally.
     * Always runs — even at zoom 1, the user can pan horizontally
     * so we need to fill any exposed edges with adjacent copies.
     */
    function getWrapOffsetsFor(viewState, margin) {
        const worldWidthPx = mapView.width * viewState.zoom;
        const copiesNeeded = Math.ceil(mapView.width / worldWidthPx) + 2;
        const centerX = mapView.width / 2 - viewState.x * viewState.zoom;
        const offsets = [];
        for (let i = -copiesNeeded; i <= copiesNeeded; i++) {
            const leftPx = centerX - worldWidthPx / 2 + i * worldWidthPx;
            const rightPx = leftPx + worldWidthPx;
            if (rightPx > -margin && leftPx < mapView.width + margin) {
                offsets.push(i * 360);
            }
        }
        return offsets.length > 0 ? offsets : [0];
    }

    function getWrapOffsets() {
        return getWrapOffsetsFor(view, 200);
    }

    function getBasemapWrapOffsets() {
        return getWrapOffsetsFor(view, 0);
    }

    /** Draw subtle lat/lon grid lines (with wrap) */
    function drawGrid() {
        if (!advSettings.gridVisible || !basemapPaths.grid) return;
        drawLinePathCopies(basemapPaths.grid, advColors.gridColor, advColors.gridWidth);
    }

    /**
     * Draw a set of polygons (land or lakes) at a given longitude offset.
     * Each polygon has one or more rings: ring[0] = outer boundary,
     * ring[1+] = holes. Uses evenodd fill rule to cut out holes.
     */
    function setBasemapWorldTransform(lonOffset) {
        const zoom = view.zoom;
        const wrapX = mapView.width * lonOffset / 360;
        baseCtx.setTransform(
            basemapDpr * zoom, 0, 0, basemapDpr * zoom,
            basemapDpr * (mapView.width / 2 - view.x * zoom + wrapX * zoom),
            basemapDpr * (mapView.height / 2 - view.y * zoom)
        );
    }

    function drawPolygonSet(path, fillStyle, strokeStyle) {
        if (!path) return;
        baseCtx.fillStyle = fillStyle;
        baseCtx.strokeStyle = strokeStyle;
        baseCtx.lineWidth = CFG.coastlineWidth / view.zoom;
        for (const off of getBasemapWrapOffsets()) {
            setBasemapWorldTransform(off);
            baseCtx.fill(path, 'evenodd');
            baseCtx.stroke(path);
        }
    }

    /** Draw landmasses at all visible wrap positions */
    function drawLandmasses() {
        if (!worldReady) return;
        drawPolygonSet(basemapPaths.land, advColors.landFill, advColors.landStroke);
        // Overdraw polar regions with ice at snowPoles opacity (0-100 slider → 0-1 alpha)
        if (advSettings.snowPoles > 0 && basemapPaths.polar) {
            baseCtx.globalAlpha = advSettings.snowPoles / 100;
            drawPolygonSet(basemapPaths.polar, advColors.iceFill, advColors.iceStroke);
            baseCtx.globalAlpha = 1;
        }
    }

    /** Draw lakes on top of land using ocean colour to "carve" them out */
    function drawLakes() {
        if (!lakesReady) return;
        drawPolygonSet(basemapPaths.lakes, advColors.lakeFill, advColors.lakeStroke);
    }

    /**
     * Draw line strings (borders) at a given longitude offset.
     * Used for both country and state borders.
     */
    function drawLinePathCopies(path, strokeStyle, lineWidth) {
        if (!path) return;
        baseCtx.strokeStyle = strokeStyle;
        baseCtx.lineWidth = lineWidth / view.zoom;
        for (const off of getBasemapWrapOffsets()) {
            setBasemapWorldTransform(off);
            baseCtx.stroke(path);
        }
    }

    /** Draw country borders at all zoom levels — always visible, zoom-aware strokes */
    function drawCountryBorders() {
        if (!bordersReady) return;
        const bScale = advSettings.borderScale / 50;   // 0→0, 50→1 (default), 100→2
        if (bScale < 0.01) return;                      // slider at 0 = hidden
        const alpha = (0.25 + clamp((view.zoom - 1) / 3, 0, 1) * 0.15) * bScale;
        const strokeW = Math.max(0.5, 0.8 * view.zoom * bScale);
        const rgb = advColors.borderRGB;
        drawLinePathCopies(basemapPaths.borders, `rgba(${rgb},${alpha})`, strokeW);
    }

    function basemapPointToScreen(point, lonOffset) {
        if (point.mapX === undefined || point.mapY === undefined) {
            const p = basePoint(point.c[0], point.c[1]);
            point.mapX = p.x;
            point.mapY = p.y;
        }
        return {
            x: (point.mapX + mapView.width * lonOffset / 360) * view.zoom + mapView.width / 2 - view.x * view.zoom,
            y: point.mapY * view.zoom + mapView.height / 2 - view.y * view.zoom,
        };
    }

    /**
     * Draw country name labels (admin-0, English).
     * Appears at medium zoom, before state labels — this is the first text
     * layer so every continent has named countries as geographic context.
     * Font size scales with zoom; larger countries get bigger text.
     */
    function drawCountryLabels() {
        if (!countryLabelsReady || view.zoom < ZOOM_SHOW_COUNTRY_LABELS) return;

        // Fade in gradually over a zoom range
        const alpha = clamp((view.zoom - ZOOM_SHOW_COUNTRY_LABELS) / 0.8, 0, 1) * 0.55;

        // Font size scales with zoom, starts readable and grows
        const fontSize = clamp(8 + (view.zoom - ZOOM_SHOW_COUNTRY_LABELS) * 1.2, 8, 18);

        baseCtx.setTransform(basemapDpr, 0, 0, basemapDpr, 0, 0);
        baseCtx.font = `600 ${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
        baseCtx.textAlign = 'center';
        baseCtx.textBaseline = 'middle';

        const offsets = getBasemapWrapOffsets();

        for (const label of countryLabels) {
            for (const off of offsets) {
                const s = basemapPointToScreen(label, off);
                // Cull off-screen labels
                if (s.x < -150 || s.x > mapView.width + 150 || s.y < -30 || s.y > mapView.height + 30) continue;

                // Shadow behind text for readability against land
                baseCtx.fillStyle = `rgba(${canvasLabelColors.countryShadow},${alpha * 0.6})`;
                baseCtx.fillText(label.n, s.x + 1, s.y + 1);
                // Country name fill
                baseCtx.fillStyle = `rgba(${canvasLabelColors.countryText},${alpha})`;
                baseCtx.fillText(label.n, s.x, s.y);
            }
        }
    }

    /** Draw state/province borders (zoom >= ZOOM_SHOW_STATES), zoom-aware strokes */
    function drawStateBorders() {
        if (!statesReady || view.zoom < ZOOM_SHOW_STATES) return;
        const bScale = advSettings.borderScale / 50;
        if (bScale < 0.01) return;
        const alpha = clamp((view.zoom - ZOOM_SHOW_STATES) / 1.5, 0, 1) * 0.20 * bScale;
        const strokeW = Math.max(0.5, 0.5 * view.zoom * bScale);
        const rgb = advColors.borderRGB;
        drawLinePathCopies(basemapPaths.states, `rgba(${rgb},${alpha})`, strokeW);
    }

    /**
     * Draw state/province name labels (admin-1, English).
     * Only appears AFTER country labels are already visible.
     * Smaller and more subtle than country labels.
     */
    function drawStateLabels() {
        if (!stateLabelsReady || view.zoom < ZOOM_SHOW_STATE_LABELS) return;

        // Gradual fade-in over a zoom range
        const alpha = clamp((view.zoom - ZOOM_SHOW_STATE_LABELS) / 1.5, 0, 1) * 0.40;

        // Font size: smaller than country labels, scales gently
        const fontSize = clamp(7 + (view.zoom - ZOOM_SHOW_STATE_LABELS) * 0.6, 7, 13);

        baseCtx.setTransform(basemapDpr, 0, 0, basemapDpr, 0, 0);
        baseCtx.font = `${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
        baseCtx.textAlign = 'center';
        baseCtx.textBaseline = 'middle';

        const offsets = getBasemapWrapOffsets();

        for (const label of stateLabels) {
            for (const off of offsets) {
                const s = basemapPointToScreen(label, off);
                if (s.x < -100 || s.x > mapView.width + 100 || s.y < -20 || s.y > mapView.height + 20) continue;

                // Subtle state/province name
                baseCtx.fillStyle = `rgba(${canvasLabelColors.stateText},${alpha})`;
                baseCtx.fillText(label.n, s.x, s.y);
            }
        }
    }

    /**
     * Draw city labels. Cities are the LAST text layer — they only
     * appear at high zoom after countries and states are visible:
     *   zoom 6.0+  → mega-cities (>5M)
     *   zoom 8.0+  → large cities (>1M)
     *   zoom 10.0+ → medium cities (>300K)
     *   zoom 12.0+ → all cities
     */
    function drawCities() {
        if (!citiesReady || view.zoom < ZOOM_SHOW_CITIES_MAJOR) return;

        // Determine population cutoff based on zoom
        let minPop;
        if (view.zoom >= ZOOM_SHOW_CITIES_ALL)        minPop = 0;
        else if (view.zoom >= ZOOM_SHOW_CITIES_MED)    minPop = 300000;
        else if (view.zoom >= ZOOM_SHOW_CITIES_LARGE)  minPop = 1000000;
        else                                            minPop = 5000000;

        // Overall opacity fades in from the first threshold
        const alpha = clamp((view.zoom - ZOOM_SHOW_CITIES_MAJOR) / 0.5, 0, 1) * 0.7;

        const offsets = getBasemapWrapOffsets();
        baseCtx.setTransform(basemapDpr, 0, 0, basemapDpr, 0, 0);
        baseCtx.textAlign = 'left';
        baseCtx.textBaseline = 'middle';

        for (const city of cityPoints) {
            if (city.p < minPop) continue;

            for (const off of offsets) {
                const s = basemapPointToScreen(city, off);
                // Cull off-screen cities
                if (s.x < -50 || s.x > mapView.width + 50 || s.y < -20 || s.y > mapView.height + 20) continue;

                // Small dot
                baseCtx.fillStyle = `rgba(${canvasLabelColors.cityDot},${alpha * 0.5})`;
                baseCtx.beginPath();
                baseCtx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
                baseCtx.fill();

                // City name label
                const fontSize = city.p > 5000000 ? 10 : city.p > 1000000 ? 9 : 8;
                baseCtx.font = `${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
                baseCtx.fillStyle = `rgba(${canvasLabelColors.cityText},${alpha * 0.6})`;
                baseCtx.fillText(city.n, s.x + 5, s.y);
            }
        }
    }

    function renderBasemap() {
        baseCtx.setTransform(basemapDpr, 0, 0, basemapDpr, 0, 0);
        baseCtx.globalAlpha = 1;
        baseCtx.fillStyle = advColors.oceanFill;
        baseCtx.fillRect(0, 0, mapView.width, mapView.height);
        document.body.style.backgroundColor = advColors.oceanFill;

        drawGrid();
        drawLandmasses();
        drawLakes();
        drawCountryBorders();
        drawCountryLabels();
        drawStateBorders();
        drawStateLabels();
        drawCities();

        basemapView = { x: view.x, y: view.y, zoom: view.zoom };
        basemapCanvas.style.transform = 'none';
        lastBasemapTransform = 'none';
        basemapDirty = false;
    }

    function transformCachedBasemap() {
        if (!basemapView) return;
        const scale = view.zoom / basemapView.zoom;
        const translateX = mapView.width * 0.5 * (1 - scale) + view.zoom * (basemapView.x - view.x);
        const translateY = mapView.height * 0.5 * (1 - scale) + view.zoom * (basemapView.y - view.y);
        const transform = `matrix(${scale},0,0,${scale},${translateX},${translateY})`;
        if (transform !== lastBasemapTransform) {
            basemapCanvas.style.transform = transform;
            lastBasemapTransform = transform;
        }
    }

    function cameraSettled() {
        return Math.abs(view.x - mapView.target.x) < 0.25 &&
            Math.abs(view.y - mapView.target.y) < 0.25 &&
            Math.abs(view.zoom - mapView.target.zoom) < 0.001;
    }

    function basemapMatchesView() {
        return basemapView &&
            Math.abs(view.x - basemapView.x) < 0.25 &&
            Math.abs(view.y - basemapView.y) < 0.25 &&
            Math.abs(view.zoom - basemapView.zoom) < 0.001;
    }

    /**
     * Draw a single node at a specific screen position.
     * @param {number} brightness - connection-age brightness (0..1)
     */
    function drawNodeAt(sx, sy, c, r, gr, pulse, opacity, brightness) {
        // Outer glow (radial gradient) — modulated by brightness and pulse
        const grad = ctx.createRadialGradient(sx, sy, r, sx, sy, gr);
        grad.addColorStop(0, rgba(c, 0.55 * pulse * opacity * brightness));
        grad.addColorStop(0.5, rgba(c, 0.18 * pulse * opacity * brightness));
        grad.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, gr, 0, Math.PI * 2);
        ctx.fill();

        // Core dot — now subtly modulated by pulse for continuous twinkle
        const coreTwinkle = 0.88 + 0.12 * pulse;
        ctx.fillStyle = rgba(c, (0.5 + 0.4 * brightness) * opacity * coreTwinkle);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();

        // Centre highlight — white on dark themes, dark on light themes
        ctx.fillStyle = rgba(nodeHighlightColor, 0.65 * pulse * opacity * brightness);
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
    }

    /**
     * Draw the arrival bloom effect — an expanding ring + brief energetic glow.
     * Runs during the first CFG.arrivalDuration ms after a node spawns.
     * This is visually distinct from the steady-state glow: a one-time event
     * that says "a new peer just appeared here."
     */
    function drawArrivalBloom(sx, sy, c, ageMs, opacity) {
        // ── Expanding ring (first arrivalRingDuration ms) ──
        if (ageMs < CFG.arrivalRingDuration) {
            const t = ageMs / CFG.arrivalRingDuration;
            const ringR = CFG.nodeRadius + (CFG.arrivalRingMaxRadius - CFG.nodeRadius) * t;
            const ringAlpha = (1 - t) * 0.6 * opacity;
            ctx.strokeStyle = rgba(c, ringAlpha);
            ctx.lineWidth = Math.max(0.5, 2 * (1 - t));
            ctx.beginPath();
            ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // ── Soft bloom glow (entire arrival phase, fading out) ──
        const bloomT = ageMs / CFG.arrivalDuration;
        const bloomAlpha = (1 - bloomT) * 0.3 * opacity;
        if (bloomAlpha > 0.005) {
            const bloomR = CFG.glowRadius * 1.8;
            const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, bloomR);
            grad.addColorStop(0, rgba(c, bloomAlpha));
            grad.addColorStop(0.4, rgba(c, bloomAlpha * 0.4));
            grad.addColorStop(1, rgba(c, 0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(sx, sy, bloomR, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /**
     * Connection-age brightness.
     * New peers start dim, veteran peers glow fully.
     * Uses the node-reported conntime Unix timestamp to compute real age.
     */
    function getAgeBrightness(node, nowSec) {
        if (!node.peer.conntime || node.peer.conntime <= 0) return CFG.ageBrightnessMax;
        const ageSec = nowSec - node.peer.conntime;
        if (ageSec <= 0) return CFG.ageBrightnessMin;
        const t = clamp(ageSec / CFG.ageRampSeconds, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        return CFG.ageBrightnessMin + (CFG.ageBrightnessMax - CFG.ageBrightnessMin) * eased;
    }

    /**
     * Direction-aware pulse with nervousness decay.
     * - Inbound:  slow, gentle sinusoidal breathing
     * - Outbound: faster pulse with sharper abs-sin shape
     * - Young peers get extra "nervous" speed that decays with age
     */
    function getDirectionPulse(node, ageMs, connAgeSec) {
        const isInbound = node.peer.direction === 'IN';
        const baseSpeed = isInbound ? CFG.pulseSpeedInbound : CFG.pulseSpeedOutbound;
        const depth = isInbound ? CFG.pulseDepthInbound : CFG.pulseDepthOutbound;

        // Nervousness: young peers pulse faster, decays over time
        const nervT = clamp(connAgeSec / CFG.nervousnessRampSec, 0, 1);
        const nervousness = CFG.nervousnessMax * (1 - nervT);
        const speed = baseSpeed + nervousness;

        if (isInbound) {
            return (1 - depth) + depth * (0.5 + 0.5 * Math.sin(node.phase + ageMs * speed));
        } else {
            const raw = Math.abs(Math.sin(node.phase + ageMs * speed));
            return (1 - depth) + depth * raw;
        }
    }

    /**
     * Ambient shimmer — residual twinkle for long-lived peers.
     * Three sine waves at incommensurate frequencies are multiplied
     * together; positive products create brief bright spikes.
     * Returns a value in [0, 1], concentrated near 0 (mostly quiet,
     * occasional sparkles).
     */
    function getAmbientShimmer(phase, ageMs) {
        const w1 = Math.sin(phase * 3.71  + ageMs * CFG.shimmerFreq1);
        const w2 = Math.sin(phase * 7.13  + ageMs * CFG.shimmerFreq2);
        const w3 = Math.sin(phase * 11.07 + ageMs * CFG.shimmerFreq3);
        return Math.max(0, w1 * w2 * w3);
    }

    /**
     * Draw a single node on the canvas at all visible wrap positions.
     * Lifecycle phases:
     *   1. Arrival bloom (first ~5s) — expanding ring + energetic glow
     *   2. Connected state — brightness ramps with age, nervousness decays
     *   3. Fade-out — eased dissolve when peer disconnects
     */
    function drawNode(node, now, wrapOffsets) {
        if (now < node.spawnTime) return;
        const reducedMotion = reducedMotionQuery.matches;
        if (reducedMotion && !node.alive) return;

        // Network filter: skip nodes whose network isn't enabled
        // (but always draw fading-out nodes so they dissolve gracefully)
        if (!passesNetFilter(node.peer.network) && node.alive) return;

        // [DISTRIBUTION] Dim peers not in the selected AS
        let asDimFactor = 1;
        if (dashboard.interaction.asFilterPeerIds && node.alive && !dashboard.interaction.asFilterPeerIds.has(node.peerId)) {
            asDimFactor = 0.15;
        }
        // [PRIVATE-NET] Dim peers not matching selected or hovered network segment
        if (privateState.privateNetMode && node.alive && PRIVATE_NETS.has(node.peer.network)) {
            const activeNet = privateState.pnSelectedNet || privateState.pnHoveredNet;
            if (activeNet && node.peer.network !== activeNet) asDimFactor = 0.15;
        }

        const c = node.color;
        const ageMs = now - node.spawnTime;
        const nowSec = Math.floor(now / 1000);
        const connAgeSec = (node.peer.conntime > 0) ? Math.max(0, nowSec - node.peer.conntime) : 0;
        const inArrival = !reducedMotion && ageMs < CFG.arrivalDuration;

        // ── Connection-age brightness (dim newcomers, bright veterans) ──
        const brightness = getAgeBrightness(node, nowSec);

        // ── Fade-in: ease-out curve for smooth materialization ──
        let opacity = 1;
        if (!reducedMotion && ageMs < CFG.fadeInDuration) {
            const t = ageMs / CFG.fadeInDuration;
            opacity = 1 - Math.pow(1 - t, 2);
        }

        // ── Fade-out: eased curve so nodes dissolve gracefully ──
        if (!reducedMotion && !node.alive && node.fadeOutStart) {
            const fadeAge = now - node.fadeOutStart;
            const t = clamp(fadeAge / CFG.fadeOutDuration, 0, 1);
            opacity = Math.pow(1 - t, CFG.fadeOutEase);
            if (opacity <= 0.001) return;
        }

        // ── Pulse (direction-aware + nervousness for young peers) ──
        let pulse;
        if (reducedMotion) {
            pulse = 1;
        } else if (inArrival) {
            // During arrival: fast energetic pulse (unchanged)
            pulse = 0.55 + 0.45 * Math.abs(Math.sin(node.phase + ageMs * CFG.arrivalPulseSpeed));
        } else {
            pulse = getDirectionPulse(node, ageMs, connAgeSec);
            // Ambient shimmer: occasional bright twinkle spikes for all peers
            const shimmer = getAmbientShimmer(node.phase, ageMs);
            pulse = Math.min(pulse + CFG.shimmerStrength * shimmer, 1);
        }

        // Spawn "pop" scale effect (first 600ms)
        let scale = 1;
        if (!reducedMotion && ageMs < 600) {
            const t = ageMs / 600;
            scale = t < 0.6 ? (t / 0.6) * 1.4 : 1.4 - 0.4 * ((t - 0.6) / 0.4);
        }

        const r = CFG.nodeRadius * scale;
        const gr = CFG.glowRadius * scale * pulse;

        // [DISTRIBUTION] Apply dim factor to opacity
        const finalOpacity = opacity * asDimFactor;

        // Draw at each wrap offset
        for (const off of wrapOffsets) {
            const s = worldToScreen(node.lon + off, node.lat);
            // Skip if well off screen (with bloom margin)
            const margin = inArrival ? CFG.arrivalRingMaxRadius : gr;
            if (s.x < -margin || s.x > mapView.width + margin || s.y < -margin || s.y > mapView.height + margin) continue;

            // Arrival bloom effect (ring + glow) — drawn behind the node
            if (inArrival && node.alive) {
                drawArrivalBloom(s.x, s.y, c, ageMs, finalOpacity);
            }

            drawNodeAt(s.x, s.y, c, r, gr, pulse, finalOpacity, brightness);
        }
    }

    /**
     * Draw subtle connection lines between nearby nodes.
     * Only draws between nodes that are close on screen (< 250px apart)
     * and skips fading-out nodes to avoid visual clutter.
     * Uses wrap offsets so connections work across the date line.
     */
    function drawConnectionLines(now, wrapOffsets) {
        ctx.lineWidth = 0.5;
        let aliveNodes = mapView.nodes.filter(n => n.alive);
        // Respect network filter for connection lines too
        if (!isAllNetsEnabled()) {
            aliveNodes = aliveNodes.filter(n => passesNetFilter(n.peer.network));
        }

        for (const off of wrapOffsets) {
            for (let i = 0; i < aliveNodes.length; i++) {
                const j = (i + 1) % aliveNodes.length;
                const a = worldToScreen(aliveNodes[i].lon + off, aliveNodes[i].lat);
                const b = worldToScreen(aliveNodes[j].lon + off, aliveNodes[j].lat);

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 250 || dist < 20) continue;

                const alpha = 0.08 * (1 - dist / 250);
                ctx.strokeStyle = rgba(aliveNodes[i].color, alpha);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // [DISTRIBUTION] Resolve which wrap copy of each peer to draw lines to.
    // Prefers the copy visible on the current map view, breaking ties by
    // proximity to viewport center.  Falls back to closest-to-center among
    // all wrap copies when nothing is on-screen.
    // ═══════════════════════════════════════════════════════════

    /**
     * For each node, pick the best wrap-copy screen position to draw a line to.
     * Priority:
     *   1. On-screen copies (within viewport + small margin) → closest to viewport center
     *   2. Near-screen copies (within a wider margin) → closest to viewport center
     *   3. Any copy → closest to viewport center
     * The returned `dist` is to the *line origin* (legend dot), used for alpha fade.
     */
    function resolveAsLinePeers(matchingNodes, wrapOffsets, originX, originY) {
        const resolved = [];
        const vcx = mapView.width / 2;  // viewport center x
        const vcy = mapView.height / 2;  // viewport center y
        // Scale margins with canvas size so behaviour is resolution-independent
        const MARGIN_ONSCREEN = Math.max(mapView.width, mapView.height) * 0.05;   // ~5% beyond edges
        const MARGIN_NEAR     = Math.max(mapView.width, mapView.height) * 0.25;   // ~25% beyond edges

        for (const node of matchingNodes) {
            let bestS = null;
            let bestCenterDist = Infinity;
            let bestTier = 3;   // lower = better (1=on-screen, 2=near, 3=any)

            for (const off of wrapOffsets) {
                const s = worldToScreen(node.lon + off, node.lat);

                // Determine which tier this copy falls into
                let tier;
                if (s.x >= -MARGIN_ONSCREEN && s.x <= mapView.width + MARGIN_ONSCREEN &&
                    s.y >= -MARGIN_ONSCREEN && s.y <= mapView.height + MARGIN_ONSCREEN) {
                    tier = 1;  // on-screen
                } else if (s.x >= -MARGIN_NEAR && s.x <= mapView.width + MARGIN_NEAR &&
                           s.y >= -MARGIN_NEAR && s.y <= mapView.height + MARGIN_NEAR) {
                    tier = 2;  // near-screen
                } else {
                    tier = 3;  // far off-screen
                }

                // Distance to viewport center (used as tie-breaker within same tier)
                const dcx = s.x - vcx;
                const dcy = s.y - vcy;
                const dc2 = dcx * dcx + dcy * dcy;

                if (tier < bestTier || (tier === bestTier && dc2 < bestCenterDist)) {
                    bestTier = tier;
                    bestCenterDist = dc2;
                    bestS = s;
                }
            }

            if (bestS) {
                // dist to line origin — kept for alpha-fade calculation
                const odx = bestS.x - originX;
                const ody = bestS.y - originY;
                resolved.push({ node, sx: bestS.x, sy: bestS.y, dist: Math.sqrt(odx * odx + ody * ody) });
            }
        }
        return resolved;
    }

    // ═══════════════════════════════════════════════════════════
    // [DISTRIBUTION] Draw lines from LEGEND DOT to peers of a hovered/selected AS
    // Lines always originate from the legend dot, never the donut center.
    // Adapts to map pan/zoom since this runs every frame.
    // ═══════════════════════════════════════════════════════════

    function drawAsLines(wrapOffsets) {
        if (!dashboard.interaction.asLinePeerIds || !dashboard.interaction.asLineColor) return;
        const distribution = window.BPMDistribution;
        if (!distribution) return;

        // Lines originate from legend dots (top-8 direct, Others for non-top-8, donut center fallback)
        let lineOrigin = null;
        if (dashboard.interaction.asLineAsNum) {
            lineOrigin = distribution.getLineOriginForAs(dashboard.interaction.asLineAsNum);
        }
        if (!lineOrigin) return;

        const peerIdSet = new Set(dashboard.interaction.asLinePeerIds);
        const matchingNodes = mapView.nodes.filter(n => n.alive && peerIdSet.has(n.peerId));
        if (matchingNodes.length === 0) return;

        // Convert legend dot position from page coords to canvas logical coords
        const canvasRect = canvas.getBoundingClientRect();
        const originX = (lineOrigin.x - canvasRect.left) * (mapView.width / canvasRect.width);
        const originY = (lineOrigin.y - canvasRect.top) * (mapView.height / canvasRect.height);

        // Resolve screen positions: prefer on-screen copies, break ties by viewport center
        const resolved = resolveAsLinePeers(matchingNodes, wrapOffsets, originX, originY);
        if (resolved.length === 0) return;

        // Group by approximate screen position (within 8px = same dot)
        const SNAP = 8;
        const groups = [];
        for (const r of resolved) {
            let found = false;
            for (const g of groups) {
                if (Math.abs(g.cx - r.sx) < SNAP && Math.abs(g.cy - r.sy) < SNAP) {
                    g.items.push(r);
                    found = true;
                    break;
                }
            }
            if (!found) {
                groups.push({ cx: r.sx, cy: r.sy, items: [r] });
            }
        }

        // Line width from advSettings: slider 0→0.3px, 50→1.2px, 100→4px
        // Boost line width when zoomed in (single-peer zoom makes lines more visible)
        const lwSlider = advSettings.asLineWidth;
        const baseLineW = 0.3 + (lwSlider / 100) * 3.7;
        const zoomBoost = Math.min(view.zoom / 1.5, 3);  // up to 3x thicker when zoomed in
        const lineW = baseLineW * zoomBoost;
        // Fan spread from advSettings: slider 0→0%, 50→35%, 100→70% of line length
        const fanSlider = advSettings.asLineFan;
        const fanPct = (fanSlider / 100) * 0.7;
        const fanMax = 40 + (fanSlider / 100) * 120;  // 40px at 0, 160px at 100

        ctx.save();
        ctx.lineWidth = lineW;
        ctx.strokeStyle = dashboard.interaction.asLineColor;

        for (const g of groups) {
            const count = g.items.length;
            // All lines converge on the same dot position (no dot displacement)
            const destX = g.cx;
            const destY = g.cy;

            for (let i = 0; i < count; i++) {
                const r = g.items[i];
                const dist = r.dist;
                const alpha = Math.min(0.45, 0.15 + 0.3 * (1 - dist / Math.max(mapView.width, mapView.height)));
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.moveTo(originX, originY);

                if (count > 1) {
                    // Fan lines via curved paths — all arrive at same destination
                    const midX = (originX + destX) / 2;
                    const midY = (originY + destY) / 2;
                    const dx = destX - originX;
                    const dy = destY - originY;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const perpX = -dy / len;
                    const perpY = dx / len;
                    // Spread controlled by fan slider
                    const spread = Math.min(len * fanPct, fanMax);
                    const bulge = (i - (count - 1) / 2) * (spread / Math.max(1, count - 1));
                    ctx.quadraticCurveTo(midX + perpX * bulge, midY + perpY * bulge, destX, destY);
                } else {
                    ctx.lineTo(destX, destY);
                }
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    /** Draw lines for ALL AS groups simultaneously (hover-all mode).
     *  Each group draws from its own legend dot in its own color. */
    function drawAsLinesAll(wrapOffsets) {
        if (!dashboard.interaction.asLineGroups || dashboard.interaction.asLineGroups.length === 0) return;
        const distribution = window.BPMDistribution;
        if (!distribution) return;

        const canvasRect = canvas.getBoundingClientRect();
        const lwSlider = advSettings.asLineWidth;
        const baseLineW = 0.3 + (lwSlider / 100) * 3.7;
        const zoomBoost = Math.min(view.zoom / 1.5, 3);
        const lineW = baseLineW * zoomBoost;
        const fanSlider = advSettings.asLineFan;
        const fanPct = (fanSlider / 100) * 0.7;
        const fanMax = 40 + (fanSlider / 100) * 120;

        ctx.save();
        ctx.lineWidth = lineW;

        for (const grp of dashboard.interaction.asLineGroups) {
            // Lines originate from legend dots (top-8 direct, Others for non-top-8, donut center fallback)
            let lineOrigin = distribution.getLineOriginForAs(grp.asNum);
            if (!lineOrigin) continue;

            const originX = (lineOrigin.x - canvasRect.left) * (mapView.width / canvasRect.width);
            const originY = (lineOrigin.y - canvasRect.top) * (mapView.height / canvasRect.height);

            const peerIdSet = new Set(grp.peerIds);
            const matchingNodes = mapView.nodes.filter(n => n.alive && peerIdSet.has(n.peerId));
            if (matchingNodes.length === 0) continue;

            // Resolve screen positions: prefer on-screen copies, break ties by viewport center
            const resolved = resolveAsLinePeers(matchingNodes, wrapOffsets, originX, originY);
            if (resolved.length === 0) continue;

            // Group by approximate screen position (within 8px = same dot)
            const SNAP = 8;
            const groups = [];
            for (const r of resolved) {
                let found = false;
                for (const g of groups) {
                    if (Math.abs(g.cx - r.sx) < SNAP && Math.abs(g.cy - r.sy) < SNAP) {
                        g.items.push(r);
                        found = true;
                        break;
                    }
                }
                if (!found) groups.push({ cx: r.sx, cy: r.sy, items: [r] });
            }

            ctx.strokeStyle = grp.color;

            for (const g of groups) {
                const count = g.items.length;
                const destX = g.cx;
                const destY = g.cy;

                for (let i = 0; i < count; i++) {
                    const r = g.items[i];
                    const dist = r.dist;
                    const alpha = Math.min(0.45, 0.15 + 0.3 * (1 - dist / Math.max(mapView.width, mapView.height)));
                    ctx.globalAlpha = alpha;
                    ctx.beginPath();
                    ctx.moveTo(originX, originY);

                    if (count > 1) {
                        const midX = (originX + destX) / 2;
                        const midY = (originY + destY) / 2;
                        const dx = destX - originX;
                        const dy = destY - originY;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const perpX = -dy / len;
                        const perpY = dx / len;
                        const spread = Math.min(len * fanPct, fanMax);
                        const bulge = (i - (count - 1) / 2) * (spread / Math.max(1, count - 1));
                        ctx.quadraticCurveTo(midX + perpX * bulge, midY + perpY * bulge, destX, destY);
                    } else {
                        ctx.lineTo(destX, destY);
                    }
                    ctx.stroke();
                }
            }
        }

        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════
    // HUD — Peer count, block height, network badges
    // Updated every frame from current node state.
    // ═══════════════════════════════════════════════════════════

    // Countdown timer state
    let lastPeerFetchTime = 0;
    let countdownInterval = null;
    // Peer polling follows the visible or background interval.
    const peerPolling = window.BPMPolling.create({
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

    /** Antarctica modal is now CSS-centered; no per-frame repositioning needed */
    function updateAntarcticaNote() {
        // No-op: modal is centered via CSS flexbox on the overlay
    }

    /** Update the clock display in the topbar */
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

    /** Find ALL alive nodes within hit radius of screen coords. */
    function findNodesAtScreen(sx, sy) {
        const hitRadius = 12;
        const offsets = getWrapOffsets();
        const result = [];
        const seen = new Set();
        for (let i = mapView.nodes.length - 1; i >= 0; i--) {
            if (!mapView.nodes[i].alive) continue;
            if (seen.has(mapView.nodes[i].peerId)) continue;
            for (const off of offsets) {
                const s = worldToScreen(mapView.nodes[i].lon + off, mapView.nodes[i].lat);
                const dx = s.x - sx;
                const dy = s.y - sy;
                if (dx * dx + dy * dy < hitRadius * hitRadius) {
                    result.push(mapView.nodes[i]);
                    seen.add(mapView.nodes[i].peerId);
                    break;
                }
            }
        }
        return result;
    }

    /** Build a tooltip row: label + value, skipping empty values */
    function ttRow(label, value) {
        if (!value && value !== 0 && value !== false) return '';
        return `<div class="tt-row"><span class="tt-label">${escapeHtml(label)}</span><span class="tt-val">${escapeHtml(value)}</span></div>`;
    }

    /** Shorten an address for compact display (e.g. group list) */
    function shortenAddr(node) {
        const full = node.peer.addr || (node.peer.ip && node.peer.port ? `${node.peer.ip}:${node.peer.port}` : '—');
        if (full.length <= 28) return full;
        // Tor/I2P: show first 12 chars + ...
        if (full.includes('.onion') || full.includes('.b32.i2p')) {
            return full.substring(0, 12) + '...' + full.substring(full.lastIndexOf('.'));
        }
        return full.substring(0, 25) + '...';
    }

    /** Position the tooltip near cursor coordinates */
    function positionTooltip(mx, my) {
        const ttWidth = 260;
        const ttPad = 16;
        let tx = mx + ttPad;
        if (tx + ttWidth > mapView.width - 10) {
            tx = mx - ttPad - ttWidth;
        }
        let ty = my - 10;
        tooltipEl.style.left = Math.max(10, tx) + 'px';
        tooltipEl.style.top = Math.max(48, ty) + 'px';
    }

    /** Display hover tooltip for a group of nodes at one map dot.
     *  Single node: shows peer details. Multiple: shows compact numbered list. */
    function showGroupHoverTooltip(group, mx, my) {
        let html = '';
        if (group.length === 1) {
            // Single peer: show normal detail tooltip (non-interactive)
            html = buildPeerDetailHtml(group[0], false, false);
        } else {
            // Multi-peer: compact numbered list
            html += `<div class="tt-header"><span class="tt-peer-id" style="text-align:center;flex:1">${group.length} peers at this location</span></div>`;
            html += `<div class="tt-section tt-group-list">`;
            group.forEach((node, i) => {
                const netLabel = NET_DISPLAY[node.peer.network] || node.peer.network.toUpperCase();
                const netColor = rgba(node.color, 0.9);
                const addr = shortenAddr(node);
                html += `<div class="tt-row tt-group-row">`;
                html += `<span class="tt-label" style="min-width:16px">${i + 1}.</span>`;
                html += `<span class="tt-net" style="color:${netColor};min-width:36px">${escapeHtml(netLabel)}</span>`;
                html += `<span class="tt-val" style="flex:1">${escapeHtml(addr)}</span>`;
                html += `</div>`;
            });
            html += `</div>`;
        }
        tooltipEl.innerHTML = html;
        tooltipEl.classList.remove('hidden');
        tooltipEl.classList.remove('pinned');
        tooltipEl.style.pointerEvents = 'none';
        positionTooltip(mx, my);
    }

    /** Display pinned selection list for a multi-peer dot (clickable rows). */
    function showGroupSelectionList(group, mx, my) {
        let html = '';
        html += `<div class="tt-header"><span class="tt-peer-id" style="text-align:center;flex:1">${group.length} peers at this location</span><span class="tt-group-close" title="Close">\u2715</span></div>`;
        html += `<div class="tt-section tt-group-list">`;
        group.forEach((node, i) => {
            const netLabel = NET_DISPLAY[node.peer.network] || node.peer.network.toUpperCase();
            const netColor = rgba(node.color, 0.9);
            const addr = shortenAddr(node);
            html += `<div class="tt-row tt-group-row tt-group-clickable" data-peer-id="${escapeHtml(node.peerId)}">`;
            html += `<span class="tt-label" style="min-width:16px">${i + 1}.</span>`;
            html += `<span class="tt-net" style="color:${netColor};min-width:36px">${escapeHtml(netLabel)}</span>`;
            html += `<span class="tt-val" style="flex:1">${escapeHtml(addr)}</span>`;
            html += `</div>`;
        });
        html += `</div>`;

        tooltipEl.innerHTML = html;
        tooltipEl.classList.remove('hidden');
        tooltipEl.classList.add('pinned');
        tooltipEl.style.pointerEvents = 'auto';
        positionTooltip(mx, my);

        // Bind close button
        const closeBtn = tooltipEl.querySelector('.tt-group-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dashboard.interaction.pinnedNode = null;
                dashboard.interaction.groupedNodes = null;
                dashboard.interaction.highlightedPeerId = null;
                hideTooltip();
                peerTable.highlightTableRow(null);
                clearMapDotFilter();
            });
        }

        // Bind click on each row to drill into that peer
        tooltipEl.querySelectorAll('.tt-group-clickable').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const peerId = parseInt(row.dataset.peerId);
                const node = group.find(n => n.peerId === peerId);
                if (node) {
                    // Filter table to just this one peer
                    clearMapDotFilter();
                    dashboard.interaction.groupedNodes = null;
                    dashboard.interaction.mapFilterPeerIds = new Set([peerId]);
                    peerTable.renderPeerTable();
                    hideTooltip(); // close the group list tooltip

                    // [DISTRIBUTION] Open full peer detail FIRST (before zoom)
                    const distribution = window.BPMDistribution;
                    if (distribution) {
                        const rawPeers = distribution.getLastPeersRaw();
                        const peerData = rawPeers.find(p => p.id === peerId);
                        if (peerData) {
                            distribution.openPeerDetailPanel(peerData, 'map-group');
                        }
                    }

                    // Zoom to peer (same as table-row and single-dot click)
                    const p = project(node.lon, node.lat);
                    const topbarH2 = 40;
                    const panelH2 = peerTable.panelEl.classList.contains('collapsed') ? 32 : 340;
                    const visibleH2 = (mapView.height - panelH2) - topbarH2;
                    const targetSY = topbarH2 + visibleH2 * 0.35;
                    let z = 3;
                    for (; z <= CFG.maxZoom; z += 0.2) {
                        const ofc2 = (mapView.height / 2 - targetSY) / z;
                        const cY = (p.y - 0.5) * mapView.height - ofc2;
                        const mnY = (project(0, 85).y - 0.5) * mapView.height + mapView.height / (2 * z);
                        const mxY = (project(0, -85).y - 0.5) * mapView.height - mapView.height / (2 * z);
                        if (mnY < mxY && cY >= mnY && cY <= mxY) break;
                    }
                    z = Math.min(z, CFG.maxZoom);
                    const ofc2 = (mapView.height / 2 - targetSY) / z;
                    // Nudge peer slightly right of center so it's not behind the donut
                    const xNudge = (mapView.width * 0.04) / z;
                    view.x = (p.x - 0.5) * mapView.width - xNudge;
                    view.y = 0;
                    view.zoom = 1;
                    mapView.target.x = (p.x - 0.5) * mapView.width - xNudge;
                    mapView.target.y = (p.y - 0.5) * mapView.height - ofc2;
                    mapView.target.zoom = z;
                    dashboard.interaction.highlightedPeerId = peerId;
                    dashboard.interaction.pinnedNode = node;

                    if (!peerTable.panelEl.classList.contains('collapsed')) {
                        peerTable.highlightTableRow(peerId, true);
                    }
                }
            });
        });
    }

    /** Build the HTML for a single peer detail tooltip.
     *  @param {boolean} hasBackNav - show "← List" link in header
     *  @param {boolean} pinned - show disconnect button */
    function buildPeerDetailHtml(node, pinned, hasBackNav) {
        const netLabel = NET_DISPLAY[node.peer.network] || node.peer.network.toUpperCase();
        const netColor = rgba(node.color, 0.9);

        // Direction + connection type
        const dirLabel = node.peer.direction === 'IN' ? 'Inbound' : 'Outbound';
        const typeStr = node.peer.connection_type
            ? `${dirLabel} / ${node.peer.connection_type}`
            : dirLabel;

        // Address display
        const addrDisplay = (node.peer.ip && node.peer.port)
            ? `${node.peer.ip}:${node.peer.port}`
            : node.peer.addr || '—';

        // Location: build from parts, skip empties
        let locationParts = [];
        if (!node.isPrivate) {
            if (node.peer.city) locationParts.push(node.peer.city);
            if (node.peer.regionName) locationParts.push(node.peer.regionName);
            if (node.peer.country) locationParts.push(node.peer.country);
        }
        const locationStr = locationParts.length > 0
            ? escapeHtml(locationParts.join(', '))
            : '<span class="tt-muted">Private Network</span>';

        // Addrman
        const addrmanStr = node.isPrivate ? '—' : (node.peer.in_addrman ? 'Yes' : 'No');

        // Build tooltip HTML — grouped sections
        let html = '';

        // ── Header: left action | center #ID | right network ──
        html += `<div class="tt-header">`;
        if (hasBackNav) {
            html += `<a class="tt-back-link" href="#">&#8592; List</a>`;
        } else if (pinned) {
            html += `<a class="tt-back-link tt-exit-link" href="#">Exit</a>`;
        } else {
            html += `<span class="tt-back-link"></span>`;
        }
        html += `<span class="tt-peer-id">#${escapeHtml(node.peerId)}</span>`;
        html += `<span class="tt-net" style="color:${netColor}">${escapeHtml(netLabel)}</span>`;
        html += `</div>`;

        // ── Identity / Connection ──
        html += `<div class="tt-section">`;
        html += ttRow('Address', addrDisplay);
        html += ttRow('Type', typeStr);
        if (node.peer.subver) html += ttRow('Software', node.peer.subver);
        html += `</div>`;

        // ── Location ──
        html += `<div class="tt-section">`;
        html += `<div class="tt-row"><span class="tt-label">Location</span><span class="tt-val">${locationStr}</span></div>`;
        if (!node.isPrivate && node.peer.isp) html += ttRow('ISP', node.peer.isp);
        html += ttRow('Addrman', addrmanStr);
        html += `</div>`;

        // ── Performance ──
        html += `<div class="tt-section">`;
        html += ttRow('Ping', node.peer.ping_ms + 'ms');
        if (node.peer.conntime_fmt) html += ttRow('Uptime', node.peer.conntime_fmt);
        html += `</div>`;

        // ── Actions (only when pinned) ──
        if (pinned) {
            html += `<div class="tt-actions">`;
            html += `<button class="tt-action-btn tt-disconnect" data-id="${escapeHtml(node.peerId)}" data-net="${escapeHtml(node.peer.network)}">Disconnect</button>`;
            html += `</div>`;
        }

        return html;
    }

    /** Show a pinned single-peer detail tooltip with optional back navigation.
     *  @param {boolean} hasBackNav - if true, header shows "← List" */
    function showPinnedPeerDetail(node, mx, my, hasBackNav) {
        tooltipEl.innerHTML = buildPeerDetailHtml(node, true, hasBackNav);
        tooltipEl.classList.remove('hidden');
        tooltipEl.classList.add('pinned');
        tooltipEl.style.pointerEvents = 'auto';
        positionTooltip(mx, my);

        // Bind disconnect button
        const dcBtn = tooltipEl.querySelector('.tt-disconnect');
        if (dcBtn) {
            dcBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showDisconnectDialog(parseInt(dcBtn.dataset.id), dcBtn.dataset.net);
            });
        }

        // Bind back/exit link
        const backLink = tooltipEl.querySelector('.tt-back-link');
        if (backLink) {
            backLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (hasBackNav && dashboard.interaction.groupedNodes && dashboard.interaction.groupedNodes.length > 1) {
                    // Go back to group selection list
                    dashboard.interaction.pinnedNode = null;
                    dashboard.interaction.mapFilterPeerIds = new Set(dashboard.interaction.groupedNodes.map(n => n.peerId));
                    peerTable.renderPeerTable();
                    showGroupSelectionList(dashboard.interaction.groupedNodes, mx, my);
                } else {
                    // Exit: clear everything
                    dashboard.interaction.pinnedNode = null;
                    dashboard.interaction.highlightedPeerId = null;
                    dashboard.interaction.hoveredNode = null;
                    clearMapDotFilter();
                    hideTooltip();
                    peerTable.highlightTableRow(null);
                }
            });
        }
    }

    function hideTooltip() {
        tooltipEl.classList.add('hidden');
        tooltipEl.classList.remove('pinned');
        tooltipEl.style.pointerEvents = 'none';
        dashboard.interaction.hoveredNode = null;
        dashboard.interaction.pinnedNode = null;
    }

    /** Clear map dot filter and restore full peer table */
    function clearMapDotFilter() {
        dashboard.interaction.mapFilterPeerIds = null;
        dashboard.interaction.groupedNodes = null;
        peerTable.renderPeerTable();
    }

    // ═══════════════════════════════════════════════════════════
    // BOTTOM PEER PANEL — Full peer table with all columns
    // ═══════════════════════════════════════════════════════════

    const peerTable = window.BPMPeerTable.create({
        dashboard, mapView, preferences,
        onAction(action) {
            if (action.type === 'layout') scheduleDonutStackFit();
            else if (action.top !== undefined) fitDonutStackForPanelTop(action.top, action.immediate);
            else fitDonutStackToViewport();
        },
    });

    // ── Ban list modal (overlay — peer table stays visible underneath) ──
    const bansBtn = document.getElementById('btn-bans');
    const peerActions = window.BPMPeerActions.create({
        refreshPeers: fetchPeers,
    });
    peerActions.init(bansBtn);

    /**
     * Smoothly zoom the map to center on a node and show its pinned tooltip.
     * Used by table row clicks and the selectPeerById hook.
     */
    function zoomToPeer(node) {
        const p = project(node.lon, node.lat);

        // For southern peers (lat < -30), auto-collapse the panel so they're visible
        if (node.lat < -30 && !peerTable.panelEl.classList.contains('collapsed')) {
            peerTable.panelEl.classList.add('collapsed');
        }

        // Calculate visible map area
        const topbarH = 40;
        const panelH = peerTable.panelEl.classList.contains('collapsed') ? 32 : 340;
        const visibleTop = topbarH;
        const visibleBot = mapView.height - panelH;
        const visibleH = visibleBot - visibleTop;
        const targetScreenY = visibleTop + visibleH * 0.35;

        // Mercator world bounds for vertical clamping
        const yTop = project(0, 85).y;
        const yBot = project(0, -85).y;

        // Find minimum zoom that allows correct peer positioning
        let z = 3;
        for (; z <= CFG.maxZoom; z += 0.2) {
            const offsetFromCenter = (mapView.height / 2 - targetScreenY) / z;
            const candidateY = (p.y - 0.5) * mapView.height - offsetFromCenter;
            const minPanY = (yTop - 0.5) * mapView.height + mapView.height / (2 * z);
            const maxPanY = (yBot - 0.5) * mapView.height - mapView.height / (2 * z);
            if (minPanY < maxPanY && candidateY >= minPanY && candidateY <= maxPanY) {
                break;
            }
        }
        z = Math.min(z, CFG.maxZoom);

        const offsetFromCenter = (mapView.height / 2 - targetScreenY) / z;
        // Nudge peer slightly right of center so it's not behind the donut
        const xNudge = (mapView.width * 0.04) / z;
        const finalX = (p.x - 0.5) * mapView.width - xNudge;
        const finalY = (p.y - 0.5) * mapView.height - offsetFromCenter;

        // Reset view state to world baseline first (zoom 1, centered on peer longitude)
        view.x = finalX;
        view.y = 0;
        view.zoom = 1;
        // Then set the target to animate smoothly into the peer
        mapView.target.x = finalX;
        mapView.target.y = finalY;
        mapView.target.zoom = z;

        // Set selection state
        dashboard.interaction.highlightedPeerId = node.peerId;
        dashboard.interaction.pinnedNode = node;

        // Open pinned tooltip at the node's screen position (once view settles)
        setTimeout(() => {
            const offsets = getWrapOffsets();
            for (const off of offsets) {
                const s = worldToScreen(node.lon + off, node.lat);
                if (s.x > -50 && s.x < mapView.width + 50 && s.y > -50 && s.y < mapView.height + 50) {
                    showPinnedPeerDetail(node, s.x, s.y, false);
                    dashboard.interaction.hoveredNode = node;
                    break;
                }
            }
        }, 500);
    }

    // Table row click → center map on peer + open tooltip
    function handleTbodyClick(e) {
        const btn = e.target.closest('.peer-action-btn');
        if (btn) {
            e.stopPropagation();
            handlePeerAction(btn.dataset.action, parseInt(btn.dataset.id), btn.dataset.net);
            return;
        }

        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        const peerId = parseInt(row.dataset.id);
        const rowNet = row.dataset.net;

        // Private networks: enter private network mode and zoom to Antarctica
        const isPrivateNet = (rowNet === 'onion' || rowNet === 'i2p' || rowNet === 'cjdns');
        if (isPrivateNet) {
            enterPrivateNetMode(peerId);
            peerTable.highlightTableRow(peerId, true);
            row.classList.add('row-selected');
            setTimeout(() => row.classList.remove('row-selected'), 1500);
            return;
        }

        const node = mapView.nodes.find(n => n.peerId === peerId && n.alive);
        if (node) {
            // Clear any active map dot filter (table row click = direct navigation)
            clearMapDotFilter();
            dashboard.interaction.groupedNodes = null;
            dashboard.interaction.mapFilterPeerIds = new Set([node.peerId]);
            peerTable.renderPeerTable();

            // [DISTRIBUTION] Open full peer detail in right panel + animate donut
            const distribution = window.BPMDistribution;
            let bigPopupOpened = false;
            if (distribution) {
                const rawPeers = distribution.getLastPeersRaw();
                const peerData = rawPeers.find(p => p.id === peerId);
                if (peerData) {
                    distribution.openPeerDetailPanel(peerData, 'peerlist');
                    bigPopupOpened = true;
                }
            }

            if (bigPopupOpened) {
                // Zoom without opening small tooltip — big popup handles peer info
                const p = project(node.lon, node.lat);
                const topbarH2 = 40;
                const panelH2 = peerTable.panelEl.classList.contains('collapsed') ? 32 : 340;
                const visibleH2 = (mapView.height - panelH2) - topbarH2;
                const targetSY = topbarH2 + visibleH2 * 0.35;
                let z2 = 3;
                for (; z2 <= CFG.maxZoom; z2 += 0.2) {
                    const ofc = (mapView.height / 2 - targetSY) / z2;
                    const cY = (p.y - 0.5) * mapView.height - ofc;
                    const mnY = (project(0, 85).y - 0.5) * mapView.height + mapView.height / (2 * z2);
                    const mxY = (project(0, -85).y - 0.5) * mapView.height - mapView.height / (2 * z2);
                    if (mnY < mxY && cY >= mnY && cY <= mxY) break;
                }
                z2 = Math.min(z2, CFG.maxZoom);
                const ofc = (mapView.height / 2 - targetSY) / z2;
                // Nudge peer slightly right of center so it's not behind the donut
                const xNudge = (mapView.width * 0.04) / z2;
                view.x = (p.x - 0.5) * mapView.width - xNudge;
                view.y = 0;
                view.zoom = 1;
                mapView.target.x = (p.x - 0.5) * mapView.width - xNudge;
                mapView.target.y = (p.y - 0.5) * mapView.height - ofc;
                mapView.target.zoom = z2;
                dashboard.interaction.highlightedPeerId = node.peerId;
                dashboard.interaction.pinnedNode = node;
            } else {
                zoomToPeer(node);
            }
            peerTable.highlightTableRow(peerId, true);  // scroll into view on click

            row.classList.add('row-selected');
            setTimeout(() => row.classList.remove('row-selected'), 1500);
        }
    }

    function handleTbodyHover(e) {
        const row = e.target.closest('tr[data-id]');
        if (row) {
            dashboard.interaction.highlightedPeerId = parseInt(row.dataset.id);
        }
    }

    function handleTbodyLeave() {
        dashboard.interaction.highlightedPeerId = null;
    }

    peerTable.tbodyEl.addEventListener('click', handleTbodyClick);
    peerTable.tbodyEl.addEventListener('mouseover', handleTbodyHover);
    peerTable.tbodyEl.addEventListener('mouseleave', handleTbodyLeave);

    /** Show a confirmation dialog for disconnect with optional ban */
    function showDisconnectDialog(peerId, net) {
        peerActions.showDisconnectDialog(peerId, net);
    }

    /** Handle disconnect action from table row button */
    function handlePeerAction(action, peerId, net) {
        showDisconnectDialog(peerId, net || 'ipv4');
    }

    /** Show a temporary result notification */
    function showActionResult(msg, success) {
        peerActions.showResult(msg, success);
    }

    // ═══════════════════════════════════════════════════════════
    // NODE HIGHLIGHT RING — Draw highlight for map↔table interaction
    // ═══════════════════════════════════════════════════════════

    /** Draw a highlight ring around a node when it's highlighted via table hover.
     *  When pinned (selected), draws a brighter pulsing halo so it's
     *  unambiguous which peer is selected even in dense clusters. */
    function drawHighlightRing(node, now, wrapOffsets, forcePinned) {
        if (!node.alive) return;
        const isPinned = forcePinned || (dashboard.interaction.pinnedNode && dashboard.interaction.pinnedNode.peerId === node.peerId);
        const pulse = reducedMotionQuery.matches ? 1 : 0.7 + 0.3 * Math.sin(now * 0.005);
        const r = CFG.nodeRadius * 2.5;
        for (const off of wrapOffsets) {
            const s = worldToScreen(node.lon + off, node.lat);
            if (s.x < -r * 3 || s.x > mapView.width + r * 3 || s.y < -r * 3 || s.y > mapView.height + r * 3) continue;

            if (isPinned) {
                // Outer soft glow halo
                const glowR = r * 2.2;
                const grad = ctx.createRadialGradient(s.x, s.y, r, s.x, s.y, glowR);
                grad.addColorStop(0, rgba(node.color, 0.3 * pulse));
                grad.addColorStop(1, rgba(node.color, 0));
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
                ctx.fill();

                // Inner bright ring
                ctx.strokeStyle = rgba(node.color, 0.8 * pulse);
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                // Hover: subtle highlight ring (adapts to theme)
                ctx.strokeStyle = rgba(nodeHighlightColor, 0.5 * pulse);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // MAIN RENDER LOOP
    // Runs at ~60fps via requestAnimationFrame.
    // ═══════════════════════════════════════════════════════════

    /**
     * Clamp the view to prevent empty space.
     *
     * Horizontal: no clamping — the world wraps seamlessly, so the
     * user can pan left/right forever. getWrapOffsets() ensures we
     * always render enough copies to fill the viewport.
     *
     * Vertical:
     *   - At zoom <= 1: vertical panning is completely locked (centered)
     *   - At zoom > 1: panning is allowed but clamped so the Mercator
     *     world edges (±85°) never retreat inside the viewport.
     */
    function clampView() {
        // ── Horizontal: free (wrapping handles it) ──
        // No clamping on view.x or targetView.x

        // ── Vertical: Mercator bounds at ±85° latitude ──
        const yTop = project(0, 85).y;   // ~0.035
        const yBot = project(0, -85).y;  // ~0.965
        const centerY = ((yTop + yBot) / 2 - 0.5) * mapView.height;

        if (view.zoom <= 1.001) {
            // At zoom 1: lock vertical position — no panning at all
            view.y = centerY;
            mapView.target.y = centerY;
        } else {
            // Zoomed in: allow vertical pan within bounds.
            // World top in screen space = (yTop - 0.5) * H * zoom + H/2 - y * zoom
            // We want that to be <= 0 (world top at or above screen top)
            // => y >= (yTop - 0.5) * H + H / (2 * zoom)
            // Similarly, world bottom must be >= H (at or below screen bottom)
            // => y <= (yBot - 0.5) * H - H / (2 * zoom)
            let minPanY = (yTop - 0.5) * mapView.height + mapView.height / (2 * view.zoom);
            let maxPanY = (yBot - 0.5) * mapView.height - mapView.height / (2 * view.zoom);

            // [PRIVATE-NET] In private mode, relax south bound so camera can center
            // on Antarctica, and tighten north bound so user stays near the pole
            if (privateState.privateNetMode) {
                // Allow the view to push past the normal south edge (ocean beyond -85°)
                // so Antarctica can actually be centered on screen at moderate zoom
                const extraSouth = mapView.height * 0.35;
                maxPanY += extraSouth;
                // Restrict northward panning to ~50°S
                const pnNorthLimit = project(0, -50).y;
                const pnMinPanY = (pnNorthLimit - 0.5) * mapView.height;
                minPanY = Math.max(minPanY, pnMinPanY);
            }

            if (minPanY >= maxPanY) {
                // World doesn't fill screen vertically — center it
                view.y = centerY;
                mapView.target.y = centerY;
            } else {
                view.y = clamp(view.y, minPanY, maxPanY);
                mapView.target.y = clamp(mapView.target.y, minPanY, maxPanY);
            }
        }
    }

    let lastPeerFrameTime = 0;

    function frame(timestamp) {
        const now = Date.now();
        const interacting = document.body.classList.contains('map-interacting');
        const reducedMotion = reducedMotionQuery.matches;

        // Direct tracking keeps pointer-driven movement responsive. Programmatic
        // zoom and focus changes retain the existing eased camera movement.
        if (interacting || reducedMotion) {
            view.x = mapView.target.x;
            view.y = mapView.target.y;
            view.zoom = mapView.target.zoom;
        } else {
            view.x = lerp(view.x, mapView.target.x, CFG.panSmooth);
            view.y = lerp(view.y, mapView.target.y, CFG.panSmooth);
            view.zoom = lerp(view.zoom, mapView.target.zoom, CFG.panSmooth);
        }

        // Lock view within world bounds
        clampView();
        ensureZoomDetailLoaded(Math.max(view.zoom, mapView.target.zoom));

        const settled = cameraSettled();
        document.body.classList.toggle('map-camera-moving', !settled && !interacting);
        if (settled && !interacting) {
            view.x = mapView.target.x;
            view.y = mapView.target.y;
            view.zoom = mapView.target.zoom;
            if (basemapDirty || !basemapMatchesView()) renderBasemap();
        } else if (!basemapView) {
            renderBasemap();
        } else {
            transformCachedBasemap();
        }

        // Large peer sets draw at 20fps while idle; the usual limit is 30fps.
        // Reduced motion uses static effects at 10fps. Interaction stays responsive.
        const idleFps = reducedMotion ? 10 : mapView.nodes.length >= 250 ? 20 : 30;
        const frameInterval = (interacting || !settled) ? (1000 / 60) : (1000 / idleFps);
        if (timestamp - lastPeerFrameTime < frameInterval - 1) {
            requestAnimationFrame(frame);
            return;
        }
        lastPeerFrameTime = timestamp;

        ctx.setTransform(peerDpr, 0, 0, peerDpr, 0, 0);
        ctx.clearRect(0, 0, mapView.width, mapView.height);

        // Compute wrap offsets once per frame
        const wrapOffsets = getWrapOffsets();

        // [PRIVATE-NET] Draw "PRIVATE NETWORKS" text across Antarctica
        if (privateState.privateNetMode) {
            drawPrivateNetworksText();
        }

        // 9. Connection mesh lines between nearby peers (skip in private net mode)
        if (!privateState.privateNetMode) {
            drawConnectionLines(now, wrapOffsets);
        }

        // [DISTRIBUTION] 9b. Draw lines from map center to AS peers (hover/selection)
        if (!privateState.privateNetMode) {
            if (dashboard.interaction.asLineGroups && dashboard.interaction.asLineGroups.length > 0) {
                drawAsLinesAll(wrapOffsets);
            } else if (dashboard.interaction.asLinePeerIds && dashboard.interaction.asLinePeerIds.length > 0 && dashboard.interaction.asLineColor) {
                drawAsLines(wrapOffsets);
            }
        }

        // [PRIVATE-NET] Draw lines from donut to all private peers
        if (privateState.privateNetMode || privateState.pnMiniHover) {
            drawPrivateNetLines(wrapOffsets);
        }

        // 10. Peer nodes (alive + fading out)
        for (const node of mapView.nodes) {
            // In private net mode, only draw private network peers
            if (privateState.privateNetMode && !PRIVATE_NETS.has(node.peer.network)) continue;
            drawNode(node, now, wrapOffsets);
        }

        // 11. Highlight ring for map↔table cross-highlighting
        //     Draw for pinned node (selection) and/or hovered node
        if (dashboard.interaction.pinnedNode && dashboard.interaction.pinnedNode.alive) {
            drawHighlightRing(dashboard.interaction.pinnedNode, now, wrapOffsets);
        }
        // Group selection (multi-peer dot): draw glow ring on the shared location
        if (dashboard.interaction.groupedNodes && dashboard.interaction.groupedNodes.length > 1 && !dashboard.interaction.pinnedNode) {
            drawHighlightRing(dashboard.interaction.groupedNodes[0], now, wrapOffsets, true);
        }
        if (dashboard.interaction.highlightedPeerId !== null && (!dashboard.interaction.pinnedNode || dashboard.interaction.highlightedPeerId !== dashboard.interaction.pinnedNode.peerId)) {
            const hlNode = mapView.nodes.find(n => n.peerId === dashboard.interaction.highlightedPeerId && n.alive);
            if (hlNode) drawHighlightRing(hlNode, now, wrapOffsets);
        }

        requestAnimationFrame(frame);
    }

    // ═══════════════════════════════════════════════════════════
    // INTERACTION — Pan, zoom, touch, hover
    // ═══════════════════════════════════════════════════════════

    // ── Mouse pan ──
    let dragZoom = 1;  // zoom level when drag started
    let dragMoved = false;  // track if mouse moved during drag (vs click)
    canvas.addEventListener('mousedown', (e) => {
        if (wheelInteractionTimer) {
            clearTimeout(wheelInteractionTimer);
            wheelInteractionTimer = null;
        }
        dragging = true;
        setMapInteraction(true);
        dragMoved = false;
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
        dragViewStart.x = mapView.target.x;
        dragViewStart.y = mapView.target.y;
        dragZoom = view.zoom;  // capture current zoom for consistent drag speed
    });

    window.addEventListener('mousemove', (e) => {
        if (dragging) {
            // Pan the view by drag delta, scaled by zoom so drag feels 1:1 with the map
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
            mapView.target.x = dragViewStart.x - dx / dragZoom;
            // At zoom 1, vertical panning is locked (clampView enforces it)
            if (dragZoom > 1.001) {
                mapView.target.y = dragViewStart.y - dy / dragZoom;
            }
            if (dragMoved && !dashboard.interaction.groupedNodes) hideTooltip();
        } else {
            // Hover detection for tooltip + table highlight (group-aware)
            // Skip if mouse is over a UI panel (not the canvas),
            // but first clear any lingering hover state so tooltip/highlight
            // don't stay stuck when the cursor leaves the canvas.
            if (e.target !== canvas) {
                if (dashboard.interaction.hoveredNode && !dashboard.interaction.pinnedNode && !dashboard.interaction.groupedNodes) {
                    hideTooltip();
                    peerTable.highlightTableRow(null);
                    canvas.style.cursor = 'grab';
                }
                return;
            }
            // A pinned tooltip (single peer or group selection list) blocks hover
            const hasPinned = dashboard.interaction.pinnedNode || dashboard.interaction.groupedNodes;
            const group = findNodesAtScreen(e.clientX, e.clientY);
            if (group.length > 0) {
                // Don't override a pinned tooltip with hover
                if (!hasPinned) {
                    showGroupHoverTooltip(group, e.clientX, e.clientY);
                }
                dashboard.interaction.hoveredNode = group[0];
                if (!hasPinned) peerTable.highlightTableRow(group[0].peerId);
                canvas.style.cursor = 'pointer';
            } else if (dashboard.interaction.hoveredNode && !hasPinned) {
                hideTooltip();
                peerTable.highlightTableRow(null);
                canvas.style.cursor = 'grab';
            } else if (!hasPinned) {
                canvas.style.cursor = 'grab';
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        setMapInteraction(false);
        if (dragging && !dragMoved) {
            // [PRIVATE-NET] In private net mode, handle clicks on private peers
            if (privateState.privateNetMode) {
                const group = findNodesAtScreen(e.clientX, e.clientY);
                const privateGroup = group.filter(n => PRIVATE_NETS.has(n.peer.network));
                if (privateGroup.length > 1) {
                    // Multiple peers at this dot — show selection list
                    dashboard.interaction.pinnedNode = null;
                    dashboard.interaction.groupedNodes = privateGroup;
                    dashboard.interaction.mapFilterPeerIds = new Set(privateGroup.map(n => n.peerId));
                    peerTable.renderPeerTable();
                    showPnGroupSelectionList(privateGroup, e.clientX, e.clientY);
                } else if (privateGroup.length === 1) {
                    selectPrivatePeer(privateGroup[0].peerId);
                } else {
                    // Clicked empty space in private mode — deselect peer
                    privateState.privateNetSelectedPeerId = null;
                    privateState.privateNetLinePeer = null;
                    dashboard.interaction.pinnedNode = null;
                    dashboard.interaction.highlightedPeerId = null;
                    hideTooltip();
                    privatePopup.close();
                    privatePanel.hidePnSubTooltip();
                    // Dismiss insight rect if active
                    if (privateState.pnInsightRectVisible) {
                        privatePanel.hidePnInsightRect();
                        privatePanel.clearPnInsightState();
                    }
                    // In private mode, donut stays centered; otherwise un-focus if no panel
                    if (!privateState.privateNetMode && !privateState.pnSelectedNet) {
                        cachePnElements();
                        if (privateState.pnContainerEl) privateState.pnContainerEl.classList.remove('pn-focused');
                    }
                    updatePrivateNetUI();
                }
                dragging = false;
                return;
            }

            // This was a click, not a drag
            const group = findNodesAtScreen(e.clientX, e.clientY);
            if (group.length > 0) {
                // [PRIVATE-NET] If ALL peers in the group are private, enter private net mode.
                // Mixed groups (private + public) fall through to the normal selection flow
                // so public peers remain selectable from the multi-peer list.
                if (group.every(function(n) { return PRIVATE_NETS.has(n.peer.network); })) {
                    // Find the first private peer in the group and enter private mode with it
                    var privatePeer = group[0];
                    enterPrivateNetMode(privatePeer.peerId);
                    dragging = false;
                    return;
                }

                if (group.length === 1) {
                    const node = group[0];
                    // If clicking the same peer that's already shown in detail, close popup instead
                    const distribution = window.BPMDistribution;
                    if (dashboard.interaction.pinnedNode && dashboard.interaction.pinnedNode.peerId === node.peerId && distribution && distribution.isPeerDetailActive()) {
                        dashboard.interaction.pinnedNode = null;
                        dashboard.interaction.highlightedPeerId = null;
                        dashboard.interaction.hoveredNode = null;
                        hideTooltip();
                        peerTable.highlightTableRow(null);
                        clearMapDotFilter();
                        distribution.closePeerPopup();
                    } else {
                        // Single peer: open peer detail panel first, then zoom
                        // (must match table-row click order so focused-mode CSS
                        //  transitions settle before zoom targets are set)
                        clearMapDotFilter();
                        dashboard.interaction.groupedNodes = null;
                        dashboard.interaction.mapFilterPeerIds = new Set([node.peerId]);
                        peerTable.renderPeerTable();

                        // [DISTRIBUTION] Open full peer detail in right panel FIRST
                        if (distribution) {
                            const rawPeers = distribution.getLastPeersRaw();
                            const peerData = rawPeers.find(p => p.id === node.peerId);
                            if (peerData) {
                                distribution.openPeerDetailPanel(peerData, 'map');
                            }
                        }

                        // Zoom to peer (same code path as table-row click)
                        const p = project(node.lon, node.lat);
                        const topbarH2 = 40;
                        const panelH2 = peerTable.panelEl.classList.contains('collapsed') ? 32 : 340;
                        const visibleH2 = (mapView.height - panelH2) - topbarH2;
                        const targetSY = topbarH2 + visibleH2 * 0.35;
                        let z = 3;
                        for (; z <= CFG.maxZoom; z += 0.2) {
                            const ofc = (mapView.height / 2 - targetSY) / z;
                            const cY = (p.y - 0.5) * mapView.height - ofc;
                            const mnY = (project(0, 85).y - 0.5) * mapView.height + mapView.height / (2 * z);
                            const mxY = (project(0, -85).y - 0.5) * mapView.height - mapView.height / (2 * z);
                            if (mnY < mxY && cY >= mnY && cY <= mxY) break;
                        }
                        z = Math.min(z, CFG.maxZoom);
                        const ofc = (mapView.height / 2 - targetSY) / z;
                        // Nudge peer slightly right of center so it's not behind the donut
                        const xNudge = (mapView.width * 0.04) / z;
                        view.x = (p.x - 0.5) * mapView.width - xNudge;
                        view.y = 0;
                        view.zoom = 1;
                        mapView.target.x = (p.x - 0.5) * mapView.width - xNudge;
                        mapView.target.y = (p.y - 0.5) * mapView.height - ofc;
                        mapView.target.zoom = z;
                        dashboard.interaction.highlightedPeerId = node.peerId;
                        dashboard.interaction.pinnedNode = node;

                        if (!peerTable.panelEl.classList.contains('collapsed')) {
                            peerTable.highlightTableRow(node.peerId, true);
                        }
                    }
                } else {
                    // Multi-peer dot: show small pinned selection list near the dot
                    // Close any existing peer detail popup first
                    if (window.BPMDistribution) {
                        window.BPMDistribution.closePeerPopup();
                    }
                    dashboard.interaction.pinnedNode = null;  // no single peer pinned yet
                    dashboard.interaction.groupedNodes = group;
                    dashboard.interaction.mapFilterPeerIds = new Set(group.map(n => n.peerId));
                    peerTable.renderPeerTable();
                    showGroupSelectionList(group, e.clientX, e.clientY);
                }
            } else {
                // Clicked empty space — unpin tooltip + clear map filter
                if (dashboard.interaction.pinnedNode || dashboard.interaction.mapFilterPeerIds) {
                    dashboard.interaction.pinnedNode = null;
                    dashboard.interaction.highlightedPeerId = null;
                    dashboard.interaction.hoveredNode = null;
                    hideTooltip();
                    peerTable.highlightTableRow(null);
                    clearMapDotFilter();
                }
                // [PRIVATE-NET] Two-stage deselect: first deselect peer, then deselect segment → overview
                if (privateState.privateNetMode) {
                    if (privateState.privateNetSelectedPeerId || privateState.privateNetLinePeer) {
                        // Stage 1: deselect peer, go back to segment/overview view
                        privateState.privateNetSelectedPeerId = null;
                        privateState.privateNetLinePeer = null;
                        privatePopup.close();
                        dashboard.interaction.highlightedPeerId = null;
                        // Zoom back to Antarctica overview
                        const antCenter = project(40, -75);
                        mapView.target.x = (antCenter.x - 0.5) * mapView.width;
                        mapView.target.y = (antCenter.y - 0.5) * mapView.height;
                        mapView.target.zoom = 1.8;
                        renderPnDonut();
                    } else if (privateState.pnSelectedNet) {
                        // Stage 2: deselect segment → go to overview
                        privateState.pnSelectedNet = null;
                        privateState.pnHoveredNet = null;
                        privatePanel.hidePnSubTooltip();
                        privateState.pnPreviewPeerIds = null;
                        privatePanel.closePnDetailPanel();
                        document.body.classList.remove('pn-panel-open');
                        privatePanel.openPnOverviewPanel();
                        renderPnDonut();
                    }
                }
                // [DISTRIBUTION] Two-stage collapse: first close sub-panels, then main panel
                if (window.BPMDistribution) {
                    window.BPMDistribution.onMapClick();
                }
            }
        }
        dragging = false;
    });

    // ── Clear hover state when mouse leaves the browser window ──
    document.addEventListener('mouseleave', () => {
        if (dragging) {
            dragging = false;
            setMapInteraction(false);
        }
        if (dashboard.interaction.hoveredNode && !dashboard.interaction.pinnedNode && !dashboard.interaction.groupedNodes) {
            hideTooltip();
            peerTable.highlightTableRow(null);
            canvas.style.cursor = 'grab';
            dashboard.interaction.hoveredNode = null;
        }
    });

    // ── Mouse wheel zoom (zooms toward cursor position) ──
    let wheelInteractionTimer = null;
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        setMapInteraction(true);
        if (wheelInteractionTimer) clearTimeout(wheelInteractionTimer);
        wheelInteractionTimer = setTimeout(() => {
            wheelInteractionTimer = null;
            setMapInteraction(false);
        }, 140);
        const dir = e.deltaY < 0 ? 1 : -1;
        const factor = dir > 0 ? CFG.zoomStep : 1 / CFG.zoomStep;
        const newZoom = clamp(mapView.target.zoom * factor, CFG.minZoom, CFG.maxZoom);

        // Remember world point under cursor before zoom
        const mx = e.clientX;
        const my = e.clientY;
        const worldBefore = screenToWorld(mx, my);

        mapView.target.zoom = newZoom;

        // Adjust pan so the world point stays under the cursor after zoom
        const pBefore = project(worldBefore.lon, worldBefore.lat);
        const sxAfter = (pBefore.x - 0.5) * mapView.width * mapView.target.zoom + mapView.width / 2 - mapView.target.x * mapView.target.zoom;
        const syAfter = (pBefore.y - 0.5) * mapView.height * mapView.target.zoom + mapView.height / 2 - mapView.target.y * mapView.target.zoom;
        mapView.target.x += (sxAfter - mx) / mapView.target.zoom;
        mapView.target.y += (syAfter - my) / mapView.target.zoom;
    }, { passive: false });

    // ── Touch pan (single finger) ──
    let touchStart = null;
    let touchZoom = 1;
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            if (wheelInteractionTimer) {
                clearTimeout(wheelInteractionTimer);
                wheelInteractionTimer = null;
            }
            setMapInteraction(true);
            touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            dragViewStart.x = mapView.target.x;
            dragViewStart.y = mapView.target.y;
            touchZoom = view.zoom;
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (touchStart && e.touches.length === 1) {
            const dx = e.touches[0].clientX - touchStart.x;
            const dy = e.touches[0].clientY - touchStart.y;
            mapView.target.x = dragViewStart.x - dx / touchZoom;
            // At zoom 1, vertical panning is locked
            if (touchZoom > 1.001) {
                mapView.target.y = dragViewStart.y - dy / touchZoom;
            }
        }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
        touchStart = null;
        setMapInteraction(false);
    }, { passive: true });
    canvas.addEventListener('touchcancel', () => {
        touchStart = null;
        setMapInteraction(false);
    }, { passive: true });

    // ── Zoom buttons ──
    document.getElementById('zoom-in').addEventListener('click', () => {
        mapView.target.zoom = clamp(mapView.target.zoom * CFG.zoomStep, CFG.minZoom, CFG.maxZoom);
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
        mapView.target.zoom = clamp(mapView.target.zoom / CFG.zoomStep, CFG.minZoom, CFG.maxZoom);
    });
    document.getElementById('zoom-reset').addEventListener('click', () => {
        if (privateState.privateNetMode) {
            exitPrivateNetMode();
        } else {
            mapView.target.x = 0;
            mapView.target.y = 0;
            mapView.target.zoom = 1;
        }
    });

    // ═══════════════════════════════════════════════════════════
    // NETWORK BADGE CONTROLS — Click to filter, hover for stats
    // ═══════════════════════════════════════════════════════════

    const netBadges = document.querySelectorAll('.handle-nets .net-badge');
    const netPopover = document.getElementById('net-popover');
    const antCloseBtn = document.getElementById('ant-close');

    /** Update badge visual states to reflect the current multi-select filter */
    function updateBadgeStates() {
        const allOn = isAllNetsEnabled();
        netBadges.forEach(badge => {
            const net = badge.dataset.net;
            if (net === 'all') {
                badge.classList.toggle('active', allOn);
                badge.classList.toggle('dimmed', !allOn);
            } else {
                badge.classList.toggle('active', dashboard.interaction.enabledNets.has(net));
                badge.classList.toggle('dimmed', !dashboard.interaction.enabledNets.has(net));
            }
        });

        // Antarctica annotation visibility is controlled by showAntarcticaPeers setting
        // and persistent dismissal — no longer tied to filter toggles
    }

    // Click to toggle network badges (radio-then-additive model)
    // First click from "All" = radio (show only that network)
    // Subsequent clicks = additive toggle
    // Clicking "All" = reset to all
    netBadges.forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const net = badge.dataset.net;
            if (net === 'all') {
                // "All" → select everything
                dashboard.interaction.enabledNets = new Set(ALL_NETS);
            } else if (isAllNetsEnabled()) {
                // Currently showing All → radio: show only the clicked network
                dashboard.interaction.enabledNets = new Set([net]);
            } else {
                // Specific filter(s) active → additive toggle
                if (dashboard.interaction.enabledNets.has(net)) {
                    dashboard.interaction.enabledNets.delete(net);
                    // Don't allow empty selection — revert to All
                    if (dashboard.interaction.enabledNets.size === 0) {
                        dashboard.interaction.enabledNets = new Set(ALL_NETS);
                    }
                } else {
                    dashboard.interaction.enabledNets.add(net);
                }
            }
            updateBadgeStates();
            peerTable.renderPeerTable();
        });

        // Hover to show network stats popover (positioned above the badge)
        badge.addEventListener('mouseenter', () => {
            const net = badge.dataset.net;
            const stats = getNetworkStats(net);
            if (!stats) return;
            netPopover.innerHTML = stats;
            netPopover.classList.remove('hidden');
            // Position popover above the hovered badge
            const rect = badge.getBoundingClientRect();
            netPopover.style.left = rect.left + 'px';
            netPopover.style.top = (rect.top - netPopover.offsetHeight - 6) + 'px';
        });
        badge.addEventListener('mouseleave', () => {
            netPopover.classList.add('hidden');
        });
    });

    // Close Antarctica modal ("Got it" button or click outside)
    if (antCloseBtn) {
        antCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (antOverlay) antOverlay.classList.add('hidden');
        });
    }
    if (antOverlay) {
        antOverlay.addEventListener('click', (e) => {
            if (e.target === antOverlay) {
                antOverlay.classList.add('hidden');
            }
        });
    }

    function showAntarcticaDisclaimerOnce() {
        if (!peerTable.showAntarcticaPeers || !antOverlay) return;

        try {
            if (localStorage.getItem(STORAGE_KEYS.antarcticaDisclaimerSeen) === 'true') return;
            localStorage.setItem(STORAGE_KEYS.antarcticaDisclaimerSeen, 'true');
        } catch (e) {
            // Storage may be unavailable in restricted browser contexts.
        }

        antOverlay.classList.remove('hidden');
    }

    /** Build popover HTML for a network type or "all" */
    function syncPollingIntervals() {
        peerPolling.setIntervalMs(effectivePollInterval(CFG.pollInterval));
        infoPolling.setIntervalMs(effectivePollInterval(CFG.infoPollInterval));
        systemStatsPolling.setIntervalMs(effectivePollInterval(30000));
    }

    // ═══════════════════════════════════════════════════════════
    // DISPLAY SETTINGS POPUP — right overlay Update/Status rows
    // ═══════════════════════════════════════════════════════════

    /** Store latest system stats for modal use */
    function handleVisibilityChange() {
        syncPollingIntervals();
        startCountdownTimer();
        if (document.hidden) {
            disconnectSystemStream();
            return;
        }
        // The backend keeps sampling while this tab is hidden; show a fresh
        // snapshot immediately instead of waiting for the next foreground tick.
        peerPolling.run().catch(console.error);
        infoPolling.run().catch(console.error);
        systemStatsPolling.run().catch(console.error);
        connectSystemStream();
        updateClock();
    }

    // ═══════════════════════════════════════════════════════════
    // ADVANCED DISPLAY SETTINGS — delegated panel controller
    // ═══════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════
    // [DISTRIBUTION] — Module initialization (always-on, no toggle)
    // ═══════════════════════════════════════════════════════════

    function initAsDistribution() {
        if (!window.BPMDistribution) return;

        const distribution = window.BPMDistribution;
        distribution.init();

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
            drawLinesForAs: function (asNum, peerIds, color) {
                dashboard.interaction.asLineGroups = null; // clear multi-group mode
                dashboard.interaction.asLinePeerIds = peerIds;
                dashboard.interaction.asLineColor = color;
                dashboard.interaction.asLineAsNum = asNum;
            },
            drawLinesForAllAs: function (groups) {
                // groups = [{asNum, peerIds, color}, ...]
                dashboard.interaction.asLinePeerIds = null;
                dashboard.interaction.asLineColor = null;
                dashboard.interaction.asLineAsNum = null;
                dashboard.interaction.asLineGroups = groups;
            },
            clearAsLines: function () {
                dashboard.interaction.asLinePeerIds = null;
                dashboard.interaction.asLineColor = null;
                dashboard.interaction.asLineAsNum = null;
                dashboard.interaction.asLineGroups = null;
            },
            filterPeerTable: function (peerIds) {
                dashboard.interaction.asFilterPeerIds = peerIds ? new Set(peerIds) : null;
                peerTable.renderPeerTable();
            },
            dimMapPeers: function (peerIds) {
                dashboard.interaction.asFilterPeerIds = peerIds ? new Set(peerIds) : null;
            },
            zoomToPeerOnly: function (peerId) {
                // Zoom to peer without touching sub-panels or lines — just zoom + highlight
                const node = mapView.nodes.find(n => n.peerId === peerId && n.alive);
                if (!node) return;
                // Draw line from the peer's AS legend dot to this peer
                const distribution = window.BPMDistribution;
                if (distribution && node.peerId !== undefined) {
                    const peer = dashboard.peers.find(p => p.id === peerId);
                    if (peer && peer.as) {
                        const asMatch = peer.as.match(/^(AS\d+)/);
                        const peerAsNum = asMatch ? asMatch[1] : peer.as;
                        const color = distribution.getColorForAs(peerAsNum) || '#58a6ff';
                        dashboard.interaction.asLineGroups = null;
                        dashboard.interaction.asLinePeerIds = [peerId];
                        dashboard.interaction.asLineColor = color;
                        dashboard.interaction.asLineAsNum = peerAsNum;
                    }
                }
                // Zoom to peer but suppress the small map tooltip (big popup handles it)
                const p = project(node.lon, node.lat);
                const topbarH2 = 40;
                const panelH2 = peerTable.panelEl.classList.contains('collapsed') ? 32 : 340;
                const visibleH2 = (mapView.height - panelH2) - topbarH2;
                const targetSY = topbarH2 + visibleH2 * 0.35;
                let z = 3;
                for (; z <= CFG.maxZoom; z += 0.2) {
                    const ofc = (mapView.height / 2 - targetSY) / z;
                    const cY = (p.y - 0.5) * mapView.height - ofc;
                    const mnY = (project(0, 85).y - 0.5) * mapView.height + mapView.height / (2 * z);
                    const mxY = (project(0, -85).y - 0.5) * mapView.height - mapView.height / (2 * z);
                    if (mnY < mxY && cY >= mnY && cY <= mxY) break;
                }
                z = Math.min(z, CFG.maxZoom);
                const ofc = (mapView.height / 2 - targetSY) / z;
                // Nudge peer slightly right of center so it's not behind the donut
                const xNudge = (mapView.width * 0.04) / z;
                view.x = (p.x - 0.5) * mapView.width - xNudge;
                view.y = 0;
                view.zoom = 1;
                mapView.target.x = (p.x - 0.5) * mapView.width - xNudge;
                mapView.target.y = (p.y - 0.5) * mapView.height - ofc;
                mapView.target.zoom = z;
                dashboard.interaction.highlightedPeerId = node.peerId;
                dashboard.interaction.pinnedNode = node;
                // Don't show the small map tooltip — the big peer popup is being used instead
                peerTable.highlightTableRow(node.peerId);
            },
            resetMapZoom: function () {
                // Smoothly zoom the map back to default view
                mapView.target.x = 0;
                mapView.target.y = 0;
                mapView.target.zoom = 1;
                // Clear pinned node and tooltip
                dashboard.interaction.pinnedNode = null;
                dashboard.interaction.highlightedPeerId = null;
                hideTooltip();
                clearMapDotFilter();
            },
            clearPeerSelection: function () {
                // Clear selection state without resetting zoom
                dashboard.interaction.pinnedNode = null;
                dashboard.interaction.highlightedPeerId = null;
                dashboard.interaction.hoveredNode = null;
                hideTooltip();
                clearMapDotFilter();
            },
            hideMapTooltip: function () {
                // Hide the map peer tooltip without changing zoom
                dashboard.interaction.pinnedNode = null;
                hideTooltip();
            },
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
    // [DISTRIBUTION] Peer panel + topbar button wiring
    // ═══════════════════════════════════════════════════════════

    function initNewButtons() {
        // NODE-INFO button in peer panel handle
        const nodeInfoPeerBtn = document.getElementById('btn-node-info-peer');
        if (nodeInfoPeerBtn) {
            nodeInfoPeerBtn.addEventListener('click', (e) => { e.stopPropagation(); openNodeInfoModal(); });
        }

        // BLOCKS button in peer panel handle
        const recentBlocksBtn = document.getElementById('btn-recent-blocks');
        if (recentBlocksBtn) {
            recentBlocksBtn.addEventListener('click', (e) => { e.stopPropagation(); openRecentBlocksModal(); });
        }

        // GEOIP-DB button in peer panel handle
        const geoipDbPeerButton = document.getElementById('btn-geoip-db-peer');
        if (geoipDbPeerButton) {
            geoipDbPeerButton.addEventListener('click', (e) => { e.stopPropagation(); openGeoDBDropdown(); });
        }

        // CHAIN-TIPS button in peer panel handle
        const chainTipsButton = document.getElementById('btn-chain-tips');
        if (chainTipsButton) {
            chainTipsButton.addEventListener('click', (e) => { e.stopPropagation(); openChainTipsModal(); });
        }

        // Topbar gear icon → open primary Map Settings popup
        const topbarGear = document.getElementById('topbar-gear');
        if (topbarGear) {
            topbarGear.addEventListener('click', (e) => {
                e.stopPropagation();
                openDisplaySettingsPopup(topbarGear);
            });
        }

        // Topbar countdown → open display settings
        const topbarCountdown = document.getElementById('topbar-countdown');
        if (topbarCountdown) {
            topbarCountdown.addEventListener('click', (e) => {
                e.stopPropagation();
                openDisplaySettingsPopup(topbarCountdown);
            });
        }

        // Topbar status message → open display settings
        const topbarStatusMsg = document.getElementById('mo-status-msg');
        if (topbarStatusMsg) {
            topbarStatusMsg.style.cursor = 'pointer';
            topbarStatusMsg.addEventListener('click', (e) => {
                e.stopPropagation();
                openDisplaySettingsPopup(topbarStatusMsg);
            });
        }

        // [PRIVATE-NET] Mini donut: hover → draw lines to private peers, click → enter private mode
        const pnMiniDonut = document.getElementById('pn-mini-donut');
        if (pnMiniDonut) {
            pnMiniDonut.addEventListener('click', (e) => {
                e.stopPropagation();
                enterPrivateNetMode();
            });
            pnMiniDonut.addEventListener('mouseenter', () => {
                if (!privateState.privateNetMode) privateState.pnMiniHover = true;
            });
            pnMiniDonut.addEventListener('mouseleave', () => {
                privateState.pnMiniHover = false;
                privateState.pnMiniHoverNet = null;
            });
        }

        // [PRIVATE-NET] Exit button on donut
        const pnExitBtn = document.getElementById('pn-exit-btn');
        if (pnExitBtn) {
            pnExitBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                exitPrivateNetMode();
            });
        }

        // [PRIVATE-NET] Donut center click → open overview panel
        const pnDonutCenterEl = document.getElementById('pn-donut-center');
        if (pnDonutCenterEl) {
            pnDonutCenterEl.style.pointerEvents = 'auto';
            pnDonutCenterEl.style.cursor = 'pointer';
            pnDonutCenterEl.addEventListener('click', (e) => {
                e.stopPropagation();
                // If a peer is selected, deselect it first
                if (privateState.privateNetSelectedPeerId !== null) {
                    privateState.privateNetSelectedPeerId = null;
                    privateState.privateNetLinePeer = null;
                    dashboard.interaction.pinnedNode = null;
                    dashboard.interaction.highlightedPeerId = null;
                    privatePopup.close();
                }
                // Move donut to center and open overview panel
                cachePnElements();
                if (privateState.pnContainerEl) privateState.pnContainerEl.classList.add('pn-focused');
                privatePanel.openPnOverviewPanel();
                updatePrivateNetUI();
            });
        }

        // [PRIVATE-NET] Detail panel close button → exit private mode entirely
        const pnDetailClose = document.getElementById('pn-detail-close');
        if (pnDetailClose) {
            pnDetailClose.addEventListener('click', (e) => {
                e.stopPropagation();
                exitPrivateNetMode();
            });
        }

        // [PRIVATE-NET] Detail panel back button → go back to overview
        const pnDetailBack = document.getElementById('pn-detail-back');
        if (pnDetailBack) {
            pnDetailBack.addEventListener('click', (e) => {
                e.stopPropagation();
                privateState.pnSelectedNet = null;
                privatePanel.hidePnSubTooltip();
                privatePanel.updatePnOverviewPanel();
                updatePrivateNetUI();
                // Show/hide back button
                pnDetailBack.classList.add('hidden');
            });
        }

        // [PRIVATE-NET] Double-click on canvas to exit private net mode
        canvas.addEventListener('dblclick', (e) => {
            if (privateState.privateNetMode) {
                e.preventDefault();
                e.stopPropagation();
                exitPrivateNetMode();
            }
        });

    }

    // ═══════════════════════════════════════════════════════════
    // INIT — Start everything
    // ═══════════════════════════════════════════════════════════

    function init() {
        // Capture dark theme CSS defaults before any overrides
        preferences.init();

        // Load any saved advanced display settings from localStorage


        // Load and apply saved theme (or stay on dark default)


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
        loadWorldGeometry();
        loadLakeGeometry();
        loadBorderGeometry();
        loadCountryLabels();

        // Fetch real peer data immediately, then poll every 10s
        lastPeerFetchTime = Date.now();
        fetchPeers();
        peerPolling.start();
        startCountdownTimer();

        // Fetch node info (block height, BTC price, etc) immediately, then poll.
        // Once the first fetch resolves, start the DB auto-update timer if enabled.
        fetchInfo().then(() => syncDbAutoUpdateTimer());
        infoPolling.start();

        // System stats + NET speed: real-time SSE stream (dual-EMA smoothed, ~250ms updates)
        connectSystemStream();

        // Still fetch full system stats once for modal data (uptime, load, disk)
        systemStatsPolling.run();
        // Re-fetch full stats every 30s for modal freshness (uptime, load, disk only)
        systemStatsPolling.start();
        document.addEventListener('visibilitychange', handleVisibilityChange);

        showAntarcticaDisclaimerOnce();

        // Start the render loop (grid + nodes render immediately,
        // landmasses + lakes appear once JSON assets finish loading)
        requestAnimationFrame(frame);

        updateClock();
        setInterval(updateClock, 1000);

        // [DISTRIBUTION] Initialize AS Distribution module (always-on donut)
        initAsDistribution();

        // [DISTRIBUTION] Wire up new peer panel buttons and topbar gear
        initNewButtons();

        // Apply default visible row count to peer panel
        peerTable.applyMaxPeerRows();
    }

    return Object.freeze({ start: init });
}
global.BPMMapController = Object.freeze({ create });
})(window);
