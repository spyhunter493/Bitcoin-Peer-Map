import { queryAll, required, closest } from '../core/dom.js';
import { project, clamp } from './geometry.js';

/** @typedef {object} Options
 * @property {HTMLCanvasElement} canvas
 * @property {import('../types').MapView} mapView
 * @property {import('../types').Camera} view
 * @property {import('../types').DashboardConfig} config
 * @property {import('../types').MapInteraction} interaction
 * @property {import('../types').PrivateNetworkState} privateState
 * @property {Pick<ReturnType<typeof import('../peers/table.js').create>,
 * 'tbodyEl' | 'highlightTableRow' | 'renderPeerTable'>} peerTable
 * @property {Pick<ReturnType<typeof import('./navigation.js').create>,
 * 'clickMap' | 'selectTablePeer' | 'hideTooltip'>} mapNavigation
 * @property {Pick<ReturnType<typeof import('./renderer.js').create>,
 * 'setMapInteraction' | 'screenToWorld' | 'findNodesAtScreen'>} renderer
 * @property {ReturnType<typeof import('./tooltips.js').create>['showGroupHoverTooltip']} showGroupHoverTooltip
 * @property {(peerId: number, network: string) => void} showDisconnectDialog
 * @property {() => void} exitPrivateNetMode
 * @property {ReturnType<typeof import('../node/dashboard.js').create>['getNetworkStats']} getNetworkStats
 * @property {HTMLElement} antOverlay
 */

/** Binds map pointer/touch input, peer-table input, and network badge controls.
 * @param {Options} options
 */
export function create(options) {
    const { canvas, mapView, view, interaction, privateState, peerTable, mapNavigation,
        showGroupHoverTooltip, showDisconnectDialog, exitPrivateNetMode, getNetworkStats, antOverlay } = options;
    const { setMapInteraction, screenToWorld, findNodesAtScreen } = options.renderer;
    const hideTooltip = mapNavigation.hideTooltip;
    const CFG = options.config;
    const ALL_NETS = new Set(['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns']);

    // Mouse drag state
    let dragging = false;
    let dragStart = { x: 0, y: 0 };
    let dragViewStart = { x: 0, y: 0 };

    /** @param {MouseEvent} e */
    function handleTbodyClick(e) {
        const btn = closest('.peer-action-btn', e.target);
        if (btn) {
            e.stopPropagation();
            if (btn.dataset.action === 'disconnect') {
                showDisconnectDialog(parseInt(btn.dataset.id || ''), btn.dataset.net || 'ipv4');
                return;
            }
        }

        const row = closest('tr[data-id]', e.target);
        if (!row || !mapNavigation.selectTablePeer(Number(row.dataset.id))) return;
        row.classList.add('row-selected');
        setTimeout(() => row.classList.remove('row-selected'), 1500);
    }

    /** @param {MouseEvent} e */
    function handleTbodyHover(e) {
        const row = closest('tr[data-id]', e.target);
        if (row) {
            interaction.highlightedPeerId = parseInt(row.dataset.id || '');
        }
    }

    function handleTbodyLeave() {
        interaction.highlightedPeerId = null;
    }

    peerTable.tbodyEl.addEventListener('click', handleTbodyClick);
    peerTable.tbodyEl.addEventListener('mouseover', handleTbodyHover);
    peerTable.tbodyEl.addEventListener('mouseleave', handleTbodyLeave);

    // ── Mouse pan ──
    let dragZoom = 1; // zoom level when drag started
    let dragMoved = false; // track if mouse moved during drag (vs click)
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
        dragZoom = view.zoom; // capture current zoom for consistent drag speed
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
            if (dragMoved && !interaction.groupedNodes) hideTooltip();
        } else {
            // Hover detection for tooltip + table highlight (group-aware)
            // Skip if mouse is over a UI panel (not the canvas),
            // but first clear any lingering hover state so tooltip/highlight
            // don't stay stuck when the cursor leaves the canvas.
            if (e.target !== canvas) {
                if (
                    interaction.hoveredNode &&
                    !interaction.pinnedNode &&
                    !interaction.groupedNodes
                ) {
                    hideTooltip();
                    peerTable.highlightTableRow(null);
                    canvas.style.cursor = 'grab';
                }
                return;
            }
            // A pinned tooltip (single peer or group selection list) blocks hover
            const hasPinned = interaction.pinnedNode || interaction.groupedNodes;
            const group = findNodesAtScreen(e.clientX, e.clientY);
            if (group.length > 0) {
                // Don't override a pinned tooltip with hover
                if (!hasPinned) {
                    showGroupHoverTooltip(group, e.clientX, e.clientY);
                }
                interaction.hoveredNode = group[0];
                if (!hasPinned) peerTable.highlightTableRow(group[0].peerId);
                canvas.style.cursor = 'pointer';
            } else if (interaction.hoveredNode && !hasPinned) {
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
        if (dragging && !dragMoved) mapNavigation.clickMap(e.clientX, e.clientY);
        dragging = false;
    });

    // ── Clear hover state when mouse leaves the browser window ──
    document.addEventListener('mouseleave', () => {
        if (dragging) {
            dragging = false;
            setMapInteraction(false);
        }
        if (
            interaction.hoveredNode &&
            !interaction.pinnedNode &&
            !interaction.groupedNodes
        ) {
            hideTooltip();
            peerTable.highlightTableRow(null);
            canvas.style.cursor = 'grab';
            interaction.hoveredNode = null;
        }
    });

    // ── Mouse wheel zoom (zooms toward cursor position) ──
    /** @type {number | null} */
    let wheelInteractionTimer = null;
    canvas.addEventListener(
        'wheel',
        (e) => {
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
            const sxAfter =
                (pBefore.x - 0.5) * mapView.width * mapView.target.zoom +
                mapView.width / 2 -
                mapView.target.x * mapView.target.zoom;
            const syAfter =
                (pBefore.y - 0.5) * mapView.height * mapView.target.zoom +
                mapView.height / 2 -
                mapView.target.y * mapView.target.zoom;
            mapView.target.x += (sxAfter - mx) / mapView.target.zoom;
            mapView.target.y += (syAfter - my) / mapView.target.zoom;
        },
        { passive: false }
    );

    // ── Touch pan (single finger) ──
    /** @type {import('../types').Point | null} */
    let touchStart = null;
    let touchZoom = 1;
    canvas.addEventListener(
        'touchstart',
        (e) => {
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
        },
        { passive: true }
    );

    canvas.addEventListener(
        'touchmove',
        (e) => {
            if (touchStart && e.touches.length === 1) {
                const dx = e.touches[0].clientX - touchStart.x;
                const dy = e.touches[0].clientY - touchStart.y;
                mapView.target.x = dragViewStart.x - dx / touchZoom;
                // At zoom 1, vertical panning is locked
                if (touchZoom > 1.001) {
                    mapView.target.y = dragViewStart.y - dy / touchZoom;
                }
            }
        },
        { passive: true }
    );

    canvas.addEventListener(
        'touchend',
        () => {
            touchStart = null;
            setMapInteraction(false);
        },
        { passive: true }
    );
    canvas.addEventListener(
        'touchcancel',
        () => {
            touchStart = null;
            setMapInteraction(false);
        },
        { passive: true }
    );

    // ── Zoom buttons ──
    required('#zoom-in').addEventListener('click', () => {
        mapView.target.zoom = clamp(mapView.target.zoom * CFG.zoomStep, CFG.minZoom, CFG.maxZoom);
    });
    required('#zoom-out').addEventListener('click', () => {
        mapView.target.zoom = clamp(mapView.target.zoom / CFG.zoomStep, CFG.minZoom, CFG.maxZoom);
    });
    required('#zoom-reset').addEventListener('click', () => {
        if (privateState.privateNetMode) {
            exitPrivateNetMode();
        } else {
            mapView.target.x = 0;
            mapView.target.y = 0;
            mapView.target.zoom = 1;
        }
    });

    const netBadges = queryAll('.handle-nets .net-badge', document);
    const netPopover = required('#net-popover');
    const antCloseBtn = document.getElementById('ant-close');

    /** Update badge visual states to reflect the current multi-select filter */
    function updateBadgeStates() {
        const allOn = isAllNetsEnabled();
        netBadges.forEach((badge) => {
            const net = badge.dataset.net || '';
            if (net === 'all') {
                badge.classList.toggle('active', allOn);
                badge.classList.toggle('dimmed', !allOn);
                badge.setAttribute('aria-pressed', String(allOn));
            } else {
                badge.classList.toggle('active', interaction.enabledNets.has(net));
                badge.classList.toggle('dimmed', !interaction.enabledNets.has(net));
                badge.setAttribute('aria-pressed', String(interaction.enabledNets.has(net)));
            }
        });

        // Antarctica annotation visibility is controlled by showAntarcticaPeers setting
        // and persistent dismissal — no longer tied to filter toggles
    }

    // Click to toggle network badges (radio-then-additive model)
    // First click from "All" = radio (show only that network)
    // Subsequent clicks = additive toggle
    // Clicking "All" = reset to all
    netBadges.forEach((badge) => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const net = badge.dataset.net || '';
            if (net === 'all') {
                // "All" → select everything
                interaction.enabledNets = new Set(ALL_NETS);
            } else if (isAllNetsEnabled()) {
                // Currently showing All → radio: show only the clicked network
                interaction.enabledNets = new Set([net]);
            } else {
                // Specific filter(s) active → additive toggle
                if (interaction.enabledNets.has(net)) {
                    interaction.enabledNets.delete(net);
                    // Don't allow empty selection — revert to All
                    if (interaction.enabledNets.size === 0) {
                        interaction.enabledNets = new Set(ALL_NETS);
                    }
                } else {
                    interaction.enabledNets.add(net);
                }
            }
            updateBadgeStates();
            peerTable.renderPeerTable();
        });

        // Hover to show network stats popover (positioned above the badge)
        const showNetworkStats = () => {
            const net = badge.dataset.net || '';
            const stats = getNetworkStats(net);
            if (!stats) return;
            netPopover.innerHTML = stats;
            netPopover.classList.remove('hidden');
            // Position popover above the hovered badge
            const rect = badge.getBoundingClientRect();
            netPopover.style.left = rect.left + 'px';
            netPopover.style.top = rect.top - netPopover.offsetHeight - 6 + 'px';
        };
        const hideNetworkStats = () => {
            netPopover.classList.add('hidden');
        };
        badge.addEventListener('mouseenter', showNetworkStats);
        badge.addEventListener('focus', showNetworkStats);
        badge.addEventListener('mouseleave', hideNetworkStats);
        badge.addEventListener('blur', hideNetworkStats);
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

    /** Check if all networks are enabled (= "All" state) */
    function isAllNetsEnabled() {
        for (const n of ALL_NETS) {
            if (!interaction.enabledNets.has(n)) return false;
        }
        return true;
    }

    return Object.freeze({
        updateBadgeStates,
    });
}
