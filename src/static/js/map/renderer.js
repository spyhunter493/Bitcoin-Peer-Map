import * as geometry from './geometry.js';
import { project, lerp, clamp } from './geometry.js';
import * as Basemap from './basemap.js';
import * as PeerRenderer from './peer-renderer.js';
import * as ConnectionRenderer from './connection-renderer.js';

/** @typedef {object} Options
 * @property {import('../types').MapView} mapView
 * @property {import('../types').Camera} view
 * @property {HTMLCanvasElement} canvas
 * @property {CanvasRenderingContext2D} ctx
 * @property {HTMLCanvasElement} basemapCanvas
 * @property {CanvasRenderingContext2D} baseCtx
 * @property {HTMLCanvasElement} connectionCanvas
 * @property {import('../types').DashboardConfig} config
 * @property {ReturnType<typeof import('../settings/preferences.js').create>} preferences
 * @property {import('../types').MapInteraction} interaction
 * @property {import('../types').PrivateNetworkState} privateState
 * @property {(node: import('../types').MapNode) => boolean} isMapNodeVisible
 * @property {() => boolean} showAntarcticaPeers
 * @property {() => import('../types').Point | null} getPrivateInsightOrigin
 * @property {(network: string) => import('../types').Point | null} getPnMiniLegendDotPos
 * @property {Pick<typeof import('../distribution/controller.js'), 'getLineOriginForAs'>} distribution
 * @property {import('../types').GeometryLoaderOptions['fetchJson']} fetchJson
 * @property {() => void} onResize
 */

/** Coordinates canvas sizing, camera animation, and rendering responsibilities.
 * @param {Options} options
 */
export function create(options) {
    const { mapView, view, canvas, ctx, basemapCanvas, baseCtx, interaction, privateState } = options;
    const CFG = options.config;
    const PRIVATE_NETS = new Set(['onion', 'i2p', 'cjdns']);
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const basemap = Basemap.create({ ...options, getDpr: () => basemapDpr, getWrapOffsetsFor });
    const peers = PeerRenderer.create({ ...options, reducedMotionQuery, worldToScreen, getWrapOffsets });
    const { connectionCanvas } = options;
    const connectionCtx = /** @type {CanvasRenderingContext2D} */ (connectionCanvas.getContext('2d'));
    const connections = ConnectionRenderer.create({ ...options, ctx: connectionCtx, worldToScreen });

    // canvas logical dimensions (CSS pixels)
    const BASEMAP_DPR_CAP = 1.5;
    const INTERACTION_DPR_CAP = 1;
    let basemapDpr = 1;
    let peerDpr = 1;

    let lastPeerFrameTime = 0;
    /** @type {unknown[] | null} */
    let lastScene = null;
    /** @type {unknown[] | null} */
    let lastConnections = null;
    /** @type {import('../types').MapNode[] | null} */
    let ageNodes = null;
    let ageVisibility = '';
    let brightnessChangesUntil = 0;
    let fadingUntil = 0;
    let animatedPeers = false;

    function invalidate() {
        lastScene = null;
        lastConnections = null;
    }
    // Labels drawn before a web font arrives must not remain in a cached layer.
    document.fonts.addEventListener('loadingdone', () => {
        basemap.markBasemapDirty();
        invalidate();
    });

    /** @param {unknown[] | null} previous @param {unknown[]} next */
    const sameScene = (previous, next) => previous?.length === next.length &&
        next.every((value, index) => value === previous[index]);

    /** Small state keys avoid walking every peer on idle animation frames. */
    function sceneKey() {
        return [view.x, view.y, view.zoom, mapView.width, mapView.height, peerDpr, mapView.nodes,
            [...interaction.enabledNets].join('|'), interaction.asFilterPeerIds,
            interaction.asLinePeerIds, interaction.asLineColor, interaction.asLineAsNum, interaction.asLineGroups,
            interaction.highlightedPeerId, interaction.pinnedNode, interaction.groupedNodes,
            privateState.privateNetMode, privateState.pnSelectedNet, privateState.pnHoveredNet,
            privateState.pnMiniHover, privateState.pnMiniHoverNet, privateState.pnPreviewPeerIds,
            privateState.privateNetLinePeer, privateState.pnInsightRectVisible, options.showAntarcticaPeers(),
            options.preferences.advSettings.asLineWidth, options.preferences.advSettings.asLineFan,
            ...connections.getLayoutKey()];
    }

    /** @param {number} lon
     * @param {number} lat */
    function worldToScreen(lon, lat) {
        return geometry.worldToScreen(lon, lat, mapView.width, mapView.height, view);
    }

    /** @param {number} x
     * @param {number} y */
    function screenToWorld(x, y) {
        return geometry.screenToWorld(x, y, mapView.width, mapView.height, view);
    }

    /** @param {HTMLCanvasElement} targetCanvas
     * @param {CanvasRenderingContext2D} targetCtx
     * @param {number} dpr */
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

    /** @param {boolean} interacting */
    function resizePeerLayer(interacting) {
        const nativeDpr = window.devicePixelRatio || 1;
        const nextDpr = Math.min(nativeDpr, interacting ? INTERACTION_DPR_CAP : BASEMAP_DPR_CAP);
        if (nextDpr === peerDpr && canvas.width && canvas.height) return;
        peerDpr = nextDpr;
        sizeCanvas(canvas, ctx, peerDpr);
        invalidate();
    }

    function resize() {
        mapView.width = window.innerWidth;
        mapView.height = window.innerHeight;
        basemapDpr = Math.min(window.devicePixelRatio || 1, BASEMAP_DPR_CAP);
        const peerCap = document.body.classList.contains('map-interacting') ? INTERACTION_DPR_CAP : BASEMAP_DPR_CAP;
        peerDpr = Math.min(window.devicePixelRatio || 1, peerCap);
        sizeCanvas(basemapCanvas, baseCtx, basemapDpr);
        sizeCanvas(canvas, ctx, peerDpr);
        basemap.resize();
        invalidate();
        options.onResize();
    }

    /** @param {boolean} active */
    function setMapInteraction(active) {
        document.body.classList.toggle('map-interacting', active);
        resizePeerLayer(active);
        if (!active && !basemap.basemapMatchesView()) basemap.markBasemapDirty();
    }

    /**
 * Returns longitude offsets for world rendering.
 * Computes which copies of the 360° world are visible on screen
 * so the map repeats seamlessly when panning horizontally.
 * Always runs — even at zoom 1, the user can pan horizontally
 * so we need to fill any exposed edges with adjacent copies.

 * @param {import('../types').Camera} viewState
 * @param {number} margin */
    function getWrapOffsetsFor(viewState, margin) {
        return geometry.worldWrapOffsets(mapView.width, viewState, margin);
    }

    function getWrapOffsets() {
        return getWrapOffsetsFor(view, 200);
    }

    function cameraSettled() {
        return (
            Math.abs(view.x - mapView.target.x) < 0.25 &&
            Math.abs(view.y - mapView.target.y) < 0.25 &&
            Math.abs(view.zoom - mapView.target.zoom) < 0.001
        );
    }

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
        const yTop = project(0, 85).y; // ~0.035
        const yBot = project(0, -85).y; // ~0.965
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

    /** @param {number} timestamp */
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
        basemap.ensureZoomDetailLoaded(Math.max(view.zoom, mapView.target.zoom));

        const settled = cameraSettled();
        document.body.classList.toggle('map-camera-moving', !settled && !interacting);
        if (settled && !interacting) {
            view.x = mapView.target.x;
            view.y = mapView.target.y;
            view.zoom = mapView.target.zoom;
        }
        basemap.draw(settled, interacting);

        const visibility = `${options.showAntarcticaPeers()}|${privateState.privateNetMode}|${[...interaction.enabledNets].join('|')}`;
        if (ageNodes !== mapView.nodes || ageVisibility !== visibility) {
            ageNodes = mapView.nodes;
            ageVisibility = visibility;
            brightnessChangesUntil = 0;
            fadingUntil = 0;
            animatedPeers = false;
            for (const node of mapView.nodes) {
                if (!options.isMapNodeVisible(node)) continue;
                if (privateState.privateNetMode && !PRIVATE_NETS.has(node.peer.network)) continue;
                if (!node.alive && node.fadeOutStart !== null) fadingUntil = Math.max(fadingUntil,
                    node.fadeOutStart + CFG.fadeOutDuration);
                if (node.alive && interaction.enabledNets.has(node.peer.network)) {
                    animatedPeers = true;
                    if (node.peer.conntime > 0) brightnessChangesUntil = Math.max(brightnessChangesUntil,
                        (node.peer.conntime + CFG.ageRampSeconds) * 1000);
                }
            }
        }

        // Animated peers retain their frame rate. Static scenes redraw only when
        // their state changes, including the once-per-second age brightness ramp.
        const idleFps = mapView.nodes.length >= 250 ? 20 : 30;
        const frameInterval = interacting || !settled ? 1000 / 60 : 1000 / idleFps;
        if (timestamp - lastPeerFrameTime < frameInterval - 1) {
            requestAnimationFrame(frame);
            return;
        }
        lastPeerFrameTime = timestamp;
        const scene = sceneKey();
        const fading = !reducedMotion && now < fadingUntil;
        const nextScene = [...scene, reducedMotion, fading,
            reducedMotion && now < brightnessChangesUntil ? Math.floor(now / 1000) : 0];
        if (settled && !interacting && (reducedMotion || (!animatedPeers && !fading)) &&
            sameScene(lastScene, nextScene)) {
            requestAnimationFrame(frame);
            return;
        }
        lastScene = nextScene;

        ctx.setTransform(peerDpr, 0, 0, peerDpr, 0, 0);
        ctx.clearRect(0, 0, mapView.width, mapView.height);

        // Compute wrap offsets once per frame
        const wrapOffsets = getWrapOffsets();

        if (!sameScene(lastConnections, scene)) {
            sizeCanvas(connectionCanvas, connectionCtx, peerDpr);
            connectionCtx.clearRect(0, 0, mapView.width, mapView.height);
            let hasConnections = false;

            // [PRIVATE-NET] Draw "PRIVATE NETWORKS" text across Antarctica
            if (privateState.privateNetMode) {
                connections.drawPrivateNetworksText(wrapOffsets);
                hasConnections = options.showAntarcticaPeers();
            }

            // 9. Connection mesh lines between nearby peers (skip in private net mode)
            if (!privateState.privateNetMode) {
                hasConnections = peers.drawConnectionLines(wrapOffsets, connectionCtx) > 0;
            }

            // [DISTRIBUTION] 9b. Draw lines from map center to AS peers (hover/selection)
            if (!privateState.privateNetMode) {
                if (interaction.asLineGroups && interaction.asLineGroups.length > 0) {
                    connections.drawAsLinesAll(wrapOffsets);
                    hasConnections = true;
                } else if (
                    interaction.asLinePeerIds &&
                    interaction.asLinePeerIds.length > 0 &&
                    interaction.asLineColor
                ) {
                    connections.drawAsLines(wrapOffsets);
                    hasConnections = true;
                }
            }

            // [PRIVATE-NET] Draw lines from donut to all private peers
            if (privateState.privateNetMode || privateState.pnMiniHover) {
                connections.drawPrivateNetLines(wrapOffsets);
                hasConnections ||= options.showAntarcticaPeers();
            }
            // Avoid compositing a full transparent surface in scenes without lines.
            if (connectionCanvas.hidden !== !hasConnections) connectionCanvas.hidden = !hasConnections;
            lastConnections = scene;
        }

        // 10. Peer nodes (alive + fading out)
        for (const node of mapView.nodes) {
            // In private net mode, only draw private network peers
            if (privateState.privateNetMode && !PRIVATE_NETS.has(node.peer.network)) continue;
            peers.drawNode(node, now, wrapOffsets);
        }

        // 11. Highlight ring for map↔table cross-highlighting
        //     Draw for pinned node (selection) and/or hovered node
        if (interaction.pinnedNode && interaction.pinnedNode.alive) {
            peers.drawHighlightRing(interaction.pinnedNode, now, wrapOffsets);
        }
        // Group selection (multi-peer dot): draw glow ring on the shared location
        if (
            interaction.groupedNodes &&
            interaction.groupedNodes.length > 1 &&
            !interaction.pinnedNode
        ) {
            peers.drawHighlightRing(interaction.groupedNodes[0], now, wrapOffsets, true);
        }
        if (
            interaction.highlightedPeerId !== null &&
            (!interaction.pinnedNode ||
                interaction.highlightedPeerId !== interaction.pinnedNode.peerId)
        ) {
            const hlNode = mapView.nodes.find((n) => n.peerId === interaction.highlightedPeerId && n.alive);
            if (hlNode) peers.drawHighlightRing(hlNode, now, wrapOffsets);
        }

        requestAnimationFrame(frame);
    }

    return Object.freeze({
        canvas,
        resize,
        setMapInteraction,
        worldToScreen,
        screenToWorld,
        getWrapOffsets,
        findNodesAtScreen: peers.findNodesAtScreen,
        invalidate,
        markBasemapDirty() { basemap.markBasemapDirty(); invalidate(); },
        loadGeometry: basemap.loadGeometry,
        start: () => requestAnimationFrame(frame),
    });
}
