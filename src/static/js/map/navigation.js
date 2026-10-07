import { project } from './geometry.js';
import { peerCameraTarget } from './camera.js';
import { wrappedWorldDistance } from './world-wrap.js';
export { peerCameraTarget } from './camera.js';

/** @param {import('../types').MapNavigationOptions} options */
export function create(options) {
    const interaction = options.interaction;
    const privateNetworks = new Set(['onion', 'i2p', 'cjdns']);
    const schedule = options.schedule || globalThis.setTimeout.bind(globalThis);
    const cancel = options.cancelScheduled || globalThis.clearTimeout.bind(globalThis);
    /** @type {number | null} */
    let tooltipTimer = null;
    /** @type {number | null} */
    let pendingTooltipPeerId = null;

    /** @param {number} peerId */
    function nodeFor(peerId) {
        return options.getNodes().find((node) => node.alive && node.peerId === peerId && options.getPeer(peerId));
    }
    function cancelPendingTooltip() {
        if (tooltipTimer !== null) cancel(tooltipTimer);
        tooltipTimer = null;
        pendingTooltipPeerId = null;
    }
    function hideTooltip() {
        cancelPendingTooltip();
        options.tooltips.hide();
        interaction.hoveredNode = null;
        interaction.pinnedNode = null;
    }
    function clearMapDotFilter() {
        interaction.mapFilterPeerIds = null;
        interaction.groupedNodes = null;
        interaction.groupSelection = null;
        options.renderTable();
    }
    function closeGroup() {
        interaction.highlightedPeerId = null;
        hideTooltip();
        options.highlightRow(null);
        clearMapDotFilter();
    }

    /** @param {import('../types').MapNode} node @param {boolean} [smallTooltip] */
    function framePeer(node, smallTooltip = false) {
        cancelPendingTooltip();
        if (smallTooltip && node.lat < -30 && !options.isPanelCollapsed()) options.collapsePanel();
        const size = options.getSize();
        const target = peerCameraTarget(node, {
            ...size,
            panelCollapsed: options.isPanelCollapsed(),
            maxZoom: options.maxZoom,
        });
        Object.assign(options.view, { x: target.x, y: 0, zoom: 1 });
        Object.assign(options.target, target);
        interaction.highlightedPeerId = node.peerId;
        interaction.pinnedNode = node;
        if (!smallTooltip) return;
        pendingTooltipPeerId = node.peerId;
        tooltipTimer = schedule(() => {
            tooltipTimer = null;
            pendingTooltipPeerId = null;
            const current = nodeFor(node.peerId);
            if (!current || interaction.pinnedNode?.peerId !== current.peerId) return;
            const currentSize = options.getSize();
            for (const offset of options.getWrapOffsets()) {
                const point = options.worldToScreen(current.lon + offset, current.lat);
                if (
                    point.x > -50 &&
                    point.x < currentSize.width + 50 &&
                    point.y > -50 &&
                    point.y < currentSize.height + 50
                ) {
                    options.tooltips.showPinnedPeerDetail(current, point.x, point.y, false);
                    interaction.hoveredNode = current;
                    break;
                }
            }
        }, 500);
    }

    /** @param {number} peerId */
    function zoomToPeer(peerId) {
        const node = nodeFor(peerId);
        if (node) framePeer(node, true);
    }

    /** @param {number} peerId @param {'peerlist' | 'map' | 'map-group'} source @param {number[]} [groupPeerIds] */
    function selectPeer(peerId, source, groupPeerIds) {
        const node = nodeFor(peerId),
            peer = options.getPeer(peerId);
        if (!peer) return false;
        clearMapDotFilter();
        interaction.mapFilterPeerIds = new Set([peerId]);
        options.renderTable();
        if (source === 'map-group') hideTooltip();
        // The popup changes focused-mode layout, so open it before measuring the camera target.
        const opened = options.openPeerDetail(peer, source, groupPeerIds);
        if (node) framePeer(node, !opened);
        if (source === 'peerlist' || !options.isPanelCollapsed()) options.highlightRow(peerId, true);
        return true;
    }
    /** @param {number} peerId */
    function selectTablePeer(peerId) {
        const peer = options.getPeer(peerId);
        if (!peer) return false;
        if (privateNetworks.has(peer.network)) {
            cancelPendingTooltip();
            options.enterPrivateMode(peerId);
            options.highlightRow(peerId, true);
            return true;
        }
        return selectPeer(peerId, 'peerlist');
    }
    /** @param {number} peerId @param {boolean} privateGroup */
    function selectGroupPeer(peerId, privateGroup) {
        if (!nodeFor(peerId)) return;
        const group = (interaction.groupedNodes || []).filter((node) => nodeFor(node.peerId));
        if (!group.some((node) => node.peerId === peerId)) return;
        if (privateGroup) {
            hideTooltip();
            options.selectPrivatePeer(peerId);
        } else
            selectPeer(
                peerId,
                'map-group',
                group.map((node) => node.peerId)
            );
    }
    /** @param {import('../types').MapNode[]} group @param {number} mx @param {number} my @param {boolean} [privateGroup] */
    function selectGroup(group, mx, my, privateGroup = false) {
        cancelPendingTooltip();
        if (!privateGroup) options.closePeerPopup();
        interaction.pinnedNode = null;
        interaction.groupedNodes = group;
        interaction.mapFilterPeerIds = new Set(group.map((node) => node.peerId));
        options.renderTable();
        if (!interaction.groupSelection) {
            const point = options.screenToWorld(mx, my),
                size = options.getSize();
            interaction.groupSelection = {
                point: project(point.lon, point.lat),
                radiusX: 12 / (size.width * options.view.zoom),
                radiusY: 12 / (size.height * options.view.zoom),
                mx,
                my,
                privateGroup,
            };
        }
        options.tooltips.showGroupSelectionList(group, mx, my, privateGroup);
    }
    /** @param {boolean} hasBackNav @param {number} mx @param {number} my */
    function backFromTooltip(hasBackNav, mx, my) {
        if (hasBackNav && interaction.groupedNodes && interaction.groupedNodes.length > 1) {
            interaction.pinnedNode = null;
            interaction.mapFilterPeerIds = new Set(interaction.groupedNodes.map((node) => node.peerId));
            options.renderTable();
            options.tooltips.showGroupSelectionList(interaction.groupedNodes, mx, my);
        } else closeGroup();
    }
    /** @param {number} mx @param {number} my */
    function clickMap(mx, my) {
        const group = options.findNodesAtScreen(mx, my);
        if (options.isPrivateMode()) {
            const privateGroup = group.filter((node) => privateNetworks.has(node.peer.network));
            if (privateGroup.length > 1) selectGroup(privateGroup, mx, my, true);
            else if (privateGroup.length === 1) options.selectPrivatePeer(privateGroup[0].peerId);
            else options.clearPrivatePeer();
            return;
        }
        if (group.length && group.every((node) => privateNetworks.has(node.peer.network))) {
            cancelPendingTooltip();
            options.enterPrivateMode(group[0].peerId);
        } else if (group.length === 1) {
            const node = group[0];
            if (interaction.pinnedNode?.peerId === node.peerId && options.isPeerDetailActive()) {
                closeGroup();
                options.closePeerPopup();
            } else selectPeer(node.peerId, 'map');
        } else if (group.length > 1) selectGroup(group, mx, my);
        else {
            if (interaction.pinnedNode || interaction.mapFilterPeerIds) closeGroup();
            options.onMapClick();
        }
    }

    /** Called after nodes have been updated from the current snapshot, before rendering peer views. */
    function reconcile() {
        if (
            pendingTooltipPeerId !== null &&
            (!nodeFor(pendingTooltipPeerId) || interaction.pinnedNode?.peerId !== pendingTooltipPeerId)
        )
            cancelPendingTooltip();
        const selection = interaction.groupSelection;
        if (!selection) return;
        const group = options.getNodes().filter((node) => {
            if (!node.alive || (selection.privateGroup && !privateNetworks.has(node.peer.network))) return false;
            const point = project(node.lon, node.lat);
            const dx = wrappedWorldDistance(point.x, selection.point.x) / selection.radiusX;
            const dy = (point.y - selection.point.y) / selection.radiusY;
            return dx * dx + dy * dy < 1;
        });
        interaction.groupedNodes = group;
        interaction.mapFilterPeerIds = new Set(group.map((node) => node.peerId));
        options.tooltips.refreshGroup(group, selection.mx, selection.my, selection.privateGroup);
    }
    /** @param {number} peerId */
    function zoomToPeerOnly(peerId) {
        const node = nodeFor(peerId),
            peer = options.getPeer(peerId);
        if (!node || !peer) return;
        if (peer.as) {
            const provider = peer.as.match(/^(AS\d+)/)?.[1] || peer.as;
            drawLinesForAs(provider, [peerId], options.getProviderColor(provider) || '#58a6ff');
        }
        framePeer(node);
        options.highlightRow(peerId);
    }
    function resetMapZoom() {
        Object.assign(options.target, { x: 0, y: 0, zoom: 1 });
        clearPeerSelection();
    }
    function clearPeerSelection() {
        interaction.highlightedPeerId = null;
        hideTooltip();
        clearMapDotFilter();
    }
    /** @param {string} asNumber @param {number[]} peerIds @param {string | null} color */
    function drawLinesForAs(asNumber, peerIds, color) {
        interaction.asLineGroups = null;
        interaction.asLinePeerIds = peerIds;
        interaction.asLineColor = color;
        interaction.asLineAsNum = asNumber;
    }
    /** @param {Parameters<import('../types').DistributionHooks['drawLinesForAllAs']>[0]} groups */
    function drawLinesForAllAs(groups) {
        interaction.asLinePeerIds = null;
        interaction.asLineColor = null;
        interaction.asLineAsNum = null;
        interaction.asLineGroups = groups;
    }
    function clearAsLines() {
        interaction.asLinePeerIds = null;
        interaction.asLineColor = null;
        interaction.asLineAsNum = null;
        interaction.asLineGroups = null;
    }
    /** @param {number[] | null} peerIds */
    function dimMapPeers(peerIds) {
        interaction.asFilterPeerIds = peerIds ? new Set(peerIds) : null;
    }
    /** @param {number[] | null} peerIds */
    function filterPeerTable(peerIds) {
        dimMapPeers(peerIds);
        options.renderTable();
    }

    return Object.freeze({
        hideTooltip,
        clearMapDotFilter,
        closeGroup,
        selectTablePeer,
        selectGroupPeer,
        selectGroup,
        backFromTooltip,
        clickMap,
        reconcile,
        zoomToPeer,
        zoomToPeerOnly,
        resetMapZoom,
        clearPeerSelection,
        drawLinesForAs,
        drawLinesForAllAs,
        clearAsLines,
        filterPeerTable,
        dimMapPeers,
    });
}
