import { queryAll, query } from '../core/dom.js';
import * as BPMWorldMap from '../map/geometry.js';
import * as BPMDomState from '../core/dom-state.js';
import * as privateData from './private-data.js';

/** Navigation and listeners are isolated from calculation and SVG presentation.
 * @param {import('./private-components').NetworkControlsOptions} options */
export function create(options) {
    const { dashboard, document, mapView, lifecycle, onAction, privatePopup, view,
        settings: advSettings, distribution: BPMDistribution, panel: privatePanel } = options;
    const privateState = dashboard.privateNetwork;
    const Element = document.defaultView?.Element || globalThis.Element;
    const PRIVATE_NETS = new Set(privateData.networks);
    const ALL_NETS = new Set(['ipv4', 'ipv6', ...PRIVATE_NETS]);
    const PN_NET_LABELS = privateData.labels;
    const project = BPMWorldMap.project;
    const cachePnElements = privatePanel.cachePnElements;
    const { renderPnDonut, renderPnMiniDonut } = view;
    /** Enter private network mode: zoom to Antarctica, show circular donut.
     *  If targetNet is provided, skip overview and go directly to that net's panel.
     *
     * @param {number | null} [selectedPeerId]
     * @param {string | null} [targetNet]
     */
    function enterPrivateNetMode(selectedPeerId, targetNet) {
        if (privateState.privateNetMode) {
            if (selectedPeerId != null) selectPrivatePeer(selectedPeerId);
            return;
        }
        const transition = lifecycle.replace('mode-transition');
        privateState.privateNetMode = true;
        document.body.classList.add('private-net-mode');

        // Close any existing AS distribution panels/tooltips
        if (BPMDistribution) {
            BPMDistribution.closePeerPopup();
            BPMDistribution.deselect();
            if (BPMDistribution.isFocusedMode()) {
                BPMDistribution.exitFocusedMode();
            }
        }
        onAction({ type: 'hide-tooltip' });
        onAction({ type: 'clear-filter' });
        onAction({ type: 'highlight', peerId: null });
        onAction({ type: 'pin', peerId: null });

        // Reset state — but apply targetNet if provided
        privateState.pnSelectedNet = targetNet || null;
        privatePanel.hidePnSubTooltip();
        privateState.pnMiniHover = false;

        // Switch badge filters to only active private networks
        const activePrivateNets = new Set();
        for (const n of mapView.nodes) {
            if (n.alive && PRIVATE_NETS.has(n.peer.network)) activePrivateNets.add(n.peer.network);
        }
        onAction({ type: 'networks', networks: activePrivateNets.size > 0 ? activePrivateNets : new Set(PRIVATE_NETS) });
        onAction({ type: 'badges' });

        // Show donut container — centered at top with panel open
        cachePnElements();
        if (privateState.pnContainerEl) {
            privateState.pnContainerEl.classList.remove('hidden');
            transition.frame(() => {
                privateState.pnContainerEl?.classList.add('visible', 'pn-focused');
            });
        }

        // Zoom to Antarctica — moderate zoom so the whole continent is visible
        const antCenter = project(40, -75);
        mapView.target.x = (antCenter.x - 0.5) * mapView.width;
        mapView.target.y = (antCenter.y - 0.5) * mapView.height;
        mapView.target.zoom = 1.8;

        // Focus the donut and open panel
        updatePrivateNetUI();
        if (targetNet) {
            // Go directly to the target network's detail panel
            transition.timeout(() => privatePanel.openPnDetailPanel(targetNet), 200);
        } else {
            transition.timeout(() => privatePanel.openPnOverviewPanel(), 200);
        }

        // Select the triggering peer if provided
        if (selectedPeerId != null) {
            transition.timeout(() => selectPrivatePeer(selectedPeerId), 300);
        }
    }

    /** Exit private network mode: return to normal public view */
    function exitPrivateNetMode() {
        if (!privateState.privateNetMode) return;
        const transition = lifecycle.replace('mode-transition');
        privateState.privateNetMode = false;
        privateState.privateNetSelectedPeerId = null;
        privateState.privateNetLinePeer = null;
        privateState.pnSelectedNet = null;
        privateState.pnHoveredNet = null;
        privateState.pnPreviewPeerIds = null;

        // Clear insight rect state
        privatePanel.hidePnInsightRect();
        privateState.pnInsightActiveType = null;
        privateState.pnInsightActivePeerId = null;
        privateState.pnInsightActiveData = null;

        document.body.classList.remove('private-net-mode', 'pn-panel-open');

        // Hide sub-tooltips
        privatePanel.hidePnSubTooltip();

        // Hide private network UI
        cachePnElements();
        if (privateState.pnContainerEl) {
            privateState.pnContainerEl.classList.remove('visible', 'pn-focused');
            transition.timeout(() => privateState.pnContainerEl?.classList.add('hidden'), 500);
        }
        if (privateState.pnDetailPanelEl) {
            privateState.pnDetailPanelEl.classList.remove('visible');
            transition.timeout(() => privateState.pnDetailPanelEl?.classList.add('hidden'), 350);
        }

        // Clear state
        onAction({ type: 'hide-tooltip' });
        privatePopup.close();
        onAction({ type: 'clear-filter' });
        onAction({ type: 'highlight', peerId: null });
        onAction({ type: 'pin', peerId: null });

        // Restore badge filters to All (or previous state)
        onAction({ type: 'networks', networks: new Set(ALL_NETS) });
        onAction({ type: 'badges' });

        // Zoom back to world view
        mapView.target.x = 0;
        mapView.target.y = 0;
        mapView.target.zoom = 1;

        // Immediately re-show the mini donut (don't wait for next poll cycle)
        renderPnMiniDonut();
        onAction({ type: 'table' });
    }

    /** Select a specific private peer in Antarctica view
     * @param {number} peerId */
    function selectPrivatePeer(peerId) {
        const node = mapView.nodes.find((n) => n.peerId === peerId && n.alive);
        if (!node) return;

        privateState.privateNetSelectedPeerId = node.peerId;
        privateState.privateNetLinePeer = peerId;
        onAction({ type: 'highlight', peerId });
        onAction({ type: 'pin', peerId });

        // Zoom to the peer in Antarctica — moderate zoom so donut stays
        // close; offset slightly right so line isn't straight vertical
        const p = project(node.lon, node.lat);
        mapView.target.x = (p.x - 0.5) * mapView.width - mapView.width * 0.04;
        mapView.target.y = (p.y - 0.5) * mapView.height;
        mapView.target.zoom = 2.5;

        onAction({ type: 'hide-tooltip' });
        privatePanel.hidePnSubTooltip();

        // Dismiss insight rect if selecting a different peer than the active insight's peer
        if (privateState.pnInsightRectVisible && privateState.pnInsightActivePeerId !== peerId) {
            privatePanel.hidePnInsightRect();
            privatePanel.clearPnInsightState();
        }

        // Move donut to top-center (focused state)
        cachePnElements();
        if (privateState.pnContainerEl) privateState.pnContainerEl?.classList.add('pn-focused');

        privatePopup.openPeer(peerId, 'private', 350);

        updatePrivateNetUI();
    }

    /** Hover over a donut segment → preview network, dim others, draw lines to that net's peers
     * @param {MouseEvent} e */
    function onPnSegmentHover(e) {
        if (privateState.pnSelectedNet || privateState.privateNetSelectedPeerId !== null) return;
        const net = e.currentTarget instanceof Element ? e.currentTarget.getAttribute('data-net') || '' : '';
        const seg = privateState.pnSegments.find((s) => s.net === net);
        if (!seg) return;
        privateState.pnHoveredNet = net;
        if (privateState.pnCenterLabel) privateState.pnCenterLabel.textContent = seg.label.toUpperCase();
        if (privateState.pnCenterCount) {
            privateState.pnCenterCount.textContent = String(seg.count);
            privateState.pnCenterCount.style.color = seg.color;
        }
        if (privateState.pnCenterSub) privateState.pnCenterSub.textContent = 'peers';

        // Dim non-matching donut segments
        if (privateState.pnDonutSvg) {
            queryAll('.pn-donut-segment', privateState.pnDonutSvg).forEach((el) => {
                if (el.dataset.net !== net) el.classList.add('dimmed');
                else el.classList.remove('dimmed');
            });
        }
    }

    /** Leave a donut segment → restore center, undim, clear hover lines */
    function onPnSegmentLeave() {
        if (privateState.pnSelectedNet || privateState.privateNetSelectedPeerId !== null) return;
        privateState.pnHoveredNet = null;
        const total = privateState.pnSegments.reduce((s, seg) => s + seg.count, 0);
        var totalAllPeers = dashboard.peers.length || total;
        var pnPct = totalAllPeers > 0 ? Math.round((total / totalAllPeers) * 100) : 0;
        if (privateState.pnCenterLabel) {
            privateState.pnCenterLabel.textContent = total + ' PEER' + (total !== 1 ? 'S' : '');
            privateState.pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
        }
        if (privateState.pnCenterCount) {
            privateState.pnCenterCount.textContent = 'PRIVATE NETWORKS';
            privateState.pnCenterCount.style.fontSize = '13px';
            privateState.pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
            privateState.pnCenterCount.style.color = '';
        }
        if (privateState.pnCenterSub) privateState.pnCenterSub.innerHTML = pnPct + '% of total<br>connections';

        // Undim all segments
        if (privateState.pnDonutSvg) {
            queryAll('.pn-donut-segment', privateState.pnDonutSvg).forEach((el) => {
                el.classList.remove('dimmed');
            });
        }
    }

    /** Handle click on a donut segment
     * @param {MouseEvent} e */
    function onPnSegmentClick(e) {
        e.stopPropagation();
        const net = e.currentTarget instanceof Element ? e.currentTarget.getAttribute('data-net') || '' : '';
        if (!net) return;

        // Dismiss insight rect when switching to a network selection
        if (privateState.pnInsightRectVisible) {
            privatePanel.hidePnInsightRect();
            privatePanel.clearPnInsightState();
        }

        // Toggle: click same segment deselects
        if (privateState.pnSelectedNet === net) {
            privateState.pnSelectedNet = null;
            privatePanel.closePnDetailPanel();
            document.body.classList.remove('pn-panel-open');
            // In private mode, donut always stays centered at top
            if (!privateState.privateNetMode) {
                cachePnElements();
                if (privateState.pnContainerEl) privateState.pnContainerEl.classList.remove('pn-focused');
            }
        } else {
            privateState.pnSelectedNet = net;
            cachePnElements();
            if (privateState.pnContainerEl) privateState.pnContainerEl?.classList.add('pn-focused');
            privatePanel.openPnDetailPanel(net);
        }
        updatePrivateNetUI();
    }

    /** Update all private network UI (donut + panel if open).
     *  Preserves donut visual state (selected/hovered segment, center text)
     *  so the 10-second poll refresh doesn't reset the UI. */
    function updatePrivateNetUI() {
        if (!privateState.privateNetMode) return;

        // Save donut state before rebuild
        const savedSelectedNet = privateState.pnSelectedNet;
        const savedHoveredNet = privateState.pnHoveredNet;
        // Save insight rect state before rebuild
        const savedInsightType = privateState.pnInsightActiveType;
        const savedInsightPeerId = privateState.pnInsightActivePeerId;
        const savedInsightRectVisible = privateState.pnInsightRectVisible;

        renderPnDonut();

        // Restore donut visual state after SVG rebuild
        // (renderPnDonut resets innerHTML, losing DOM classes)
        if (savedSelectedNet && privateState.pnDonutSvg) {
            queryAll('.pn-donut-segment', privateState.pnDonutSvg).forEach((el) => {
                if (el.dataset.net === savedSelectedNet) el.classList.add('selected');
                else el.classList.add('dimmed');
            });
        } else if (savedHoveredNet && privateState.pnDonutSvg) {
            queryAll('.pn-donut-segment', privateState.pnDonutSvg).forEach((el) => {
                if (el.dataset.net !== savedHoveredNet) el.classList.add('dimmed');
            });
        }

        // If insight rect was visible, re-hide the donut SVG/center (renderPnDonut restores them)
        if (savedInsightRectVisible && savedInsightType) {
            if (privateState.pnDonutSvg) privateState.pnDonutSvg.style.opacity = '0';
            var pnDonutCenter = document.getElementById('pn-donut-center');
            if (pnDonutCenter) pnDonutCenter.style.opacity = '0';
        }

        const restorePrivatePanel = BPMDomState.capture(privateState.pnDetailPanelEl);

        // Only update detail panel content — do NOT close/reopen it
        if (privateState.pnDetailPanelEl && privateState.pnDetailPanelEl.classList.contains('visible')) {
            if (privateState.pnSelectedNet) {
                privatePanel.updatePnDetailPanel(privateState.pnSelectedNet);
            } else {
                privatePanel.updatePnOverviewPanel();
            }
        }

        // Restore insight rect state after panel rebuild (updatePnOverviewPanel rebuilds HTML)
        if (savedInsightType && savedInsightPeerId !== null) {
            privateState.pnInsightActiveType = savedInsightType;
            privateState.pnInsightActivePeerId = savedInsightPeerId;
            privateState.privateNetLinePeer = savedInsightPeerId;
            privateState.pnPreviewPeerIds = [savedInsightPeerId];

            // Try to find the updated peer data for a fresh stat
            const allPN = mapView.nodes.filter((n) => n.alive && PRIVATE_NETS.has(n.peer.network));
            const rawPeers = allPN.map((n) => dashboard.peers.find((p) => p.id === n.peerId)).filter((peer) => peer !== undefined);
            const updatedPeer = rawPeers.find((p) => p.id === savedInsightPeerId);
            if (updatedPeer) {
                privateState.pnInsightActiveData = privatePanel.buildPnInsightData(updatedPeer, savedInsightType);
                privatePanel.showPnInsightRect(savedInsightType, privateState.pnInsightActiveData);
            } else {
                privatePanel.hidePnInsightRect();
                privatePanel.clearPnInsightState();
            }

            // Re-highlight the active insight row in the rebuilt panel
            if (privateState.pnDetailBodyEl) {
                queryAll('.pn-insight-row', privateState.pnDetailBodyEl).forEach((r) => {
                    if (r.dataset.insightType === savedInsightType && parseInt(r.dataset.peerId || '') === savedInsightPeerId) {
                        r.classList.add('pn-insight-active');
                    }
                });
            }
        }

        privatePanel.refreshPinnedPreview();
        restorePrivatePanel();
        onAction({ type: 'table' });
    }

    /** Clear a private peer after clicking empty map space. */
    function clearPeerFromMap() {
        privateState.privateNetSelectedPeerId = null;
        privateState.privateNetLinePeer = null;
        dashboard.interaction.pinnedNode = null;
        dashboard.interaction.highlightedPeerId = null;
        onAction({ type: 'hide-tooltip' });
        privatePopup.close();
        privatePanel.hidePnSubTooltip();
        if (privateState.pnInsightRectVisible) {
            privatePanel.hidePnInsightRect();
            privatePanel.clearPnInsightState();
        }
        if (!privateState.privateNetMode && !privateState.pnSelectedNet) {
            cachePnElements();
            privateState.pnContainerEl?.classList.remove('pn-focused');
        }
        updatePrivateNetUI();
    }
    /** @param {SVGElement} svg */
    function bindBig(svg) {
        const listeners = lifecycle.replace('big');
        queryAll('.pn-donut-segment', svg).forEach(element => {
            listeners.listen(element, 'click', onPnSegmentClick);
            listeners.listen(element, 'mouseenter', onPnSegmentHover);
            listeners.listen(element, 'mouseleave', onPnSegmentLeave);
        });
    }

    /** @param {HTMLElement} miniSvg @param {HTMLElement | null} miniLegendEl
     * @param {{net: string; count: number; color: string}[]} segs @param {number} total */
    function bindMini(miniSvg, miniLegendEl, segs, total) {
        const listeners = lifecycle.replace('mini');
        // Attach hover/click to mini donut segments
        queryAll('.pn-mini-segment', miniSvg).forEach((el) => {
            listeners.listen(el, 'mouseenter', (e) => {
                e.stopPropagation();
                const net = el.dataset.net || '';
                privateState.pnMiniHoverNet = net;
                privateState.pnMiniHover = true;
                // Dim other segments
                queryAll('.pn-mini-segment', miniSvg).forEach((s) => {
                    if (s.dataset.net !== net) s.style.opacity = '0.3';
                    else s.style.opacity = '1';
                });
                // Dim other legend items
                const miniLegendEl = document.getElementById('pn-mini-legend');
                if (miniLegendEl) {
                    queryAll('.pn-mini-legend-item', miniLegendEl).forEach((item) => {
                        if (item.dataset.net !== net) item.classList.add('dimmed');
                        else {
                            item.classList.remove('dimmed');
                            item.classList.add('highlighted');
                        }
                    });
                }
                // When legends hidden, show network info in mini donut center
                if (!advSettings.showDonutLegends) {
                    const seg = segs.find((s) => s.net === net);
                    const label = PN_NET_LABELS[net] || net.toUpperCase();
                    const miniCenter = document.getElementById('pn-mini-center');
                    if (miniCenter) {
                        const labelEl = query('.pn-mini-center-label', miniCenter);
                        const countEl = query('.pn-mini-center-count', miniCenter);
                        const subEl = query('.pn-mini-center-sub', miniCenter);
                        if (labelEl) labelEl.textContent = label;
                        if (countEl) {
                            countEl.textContent = String(seg ? seg.count : '');
                            countEl.style.color = seg ? seg.color : '';
                        }
                        if (subEl) subEl.textContent = 'peers';
                    }
                }
            });
            listeners.listen(el, 'mouseleave', () => {
                privateState.pnMiniHoverNet = null;
                // Undim all segments
                queryAll('.pn-mini-segment', miniSvg).forEach((s) => (s.style.opacity = ''));
                const miniLegendEl = document.getElementById('pn-mini-legend');
                if (miniLegendEl) {
                    queryAll('.pn-mini-legend-item', miniLegendEl).forEach((item) => {
                        item.classList.remove('dimmed', 'highlighted');
                    });
                }
                // When legends hidden, restore default mini donut center text
                if (!advSettings.showDonutLegends) {
                    const miniCenter = document.getElementById('pn-mini-center');
                    if (miniCenter) {
                        const labelEl = query('.pn-mini-center-label', miniCenter);
                        const countEl = query('.pn-mini-center-count', miniCenter);
                        const subEl = query('.pn-mini-center-sub', miniCenter);
                        if (labelEl) labelEl.textContent = 'Private';
                        if (countEl) {
                            countEl.textContent = String(total);
                            countEl.style.color = '';
                        }
                        if (subEl) subEl.textContent = 'Peers';
                    }
                }
            });
            listeners.listen(el, 'click', (e) => {
                e.stopPropagation();
                const net = el.dataset.net || '';
                privateState.pnMiniHover = false;
                privateState.pnMiniHoverNet = null;
                enterPrivateNetMode(null, net);
            });
        });


        if (miniLegendEl) {
            // Attach hover/click to mini legend items (same behavior as segment hover)
            queryAll('.pn-mini-legend-item', miniLegendEl).forEach((item) => {
                listeners.listen(item, 'mouseenter', () => {
                    const net = item.dataset.net || '';
                    privateState.pnMiniHoverNet = net;
                    privateState.pnMiniHover = true;
                    // Dim other segments
                    queryAll('.pn-mini-segment', miniSvg).forEach((s) => {
                        s.style.opacity = s.dataset.net !== net ? '0.3' : '1';
                    });
                    // Dim other legend items
                    queryAll('.pn-mini-legend-item', miniLegendEl).forEach((li) => {
                        if (li.dataset.net !== net) li.classList.add('dimmed');
                        else {
                            li.classList.remove('dimmed');
                            li.classList.add('highlighted');
                        }
                    });
                });
                listeners.listen(item, 'mouseleave', () => {
                    privateState.pnMiniHoverNet = null;
                    queryAll('.pn-mini-segment', miniSvg).forEach((s) => (s.style.opacity = ''));
                    queryAll('.pn-mini-legend-item', miniLegendEl).forEach((li) => {
                        li.classList.remove('dimmed', 'highlighted');
                    });
                });
                listeners.listen(item, 'click', (e) => {
                    e.stopPropagation();
                    const net = item.dataset.net || '';
                    privateState.pnMiniHover = false;
                    privateState.pnMiniHoverNet = null;
                    enterPrivateNetMode(null, net);
                });
            });
        }
    }
    function closePopup() {
        privatePopup.close();
        privateState.privateNetSelectedPeerId = null;
        privateState.privateNetLinePeer = null;
        onAction({ type: 'highlight', peerId: null });
        onAction({ type: 'pin', peerId: null });
        if (!privateState.privateNetMode && !privateState.pnSelectedNet) privateState.pnContainerEl?.classList.remove('pn-focused');
        updatePrivateNetUI();
    }
    function dispose() {
        lifecycle.dispose();
        privatePopup.dispose();
        privateState.privateNetMode = false;
        privateState.privateNetSelectedPeerId = null;
        privateState.privateNetLinePeer = null;
        privateState.pnSelectedNet = privateState.pnHoveredNet = null;
        privateState.pnMiniHoverNet = null;
        privateState.pnMiniHover = false;
        privateState.pnInsightActiveType = null;
        privateState.pnInsightActivePeerId = null;
        privateState.pnInsightActiveData = null;
        privateState.pnInsightRectVisible = false;
        document.body.classList.remove('private-net-mode');
    }
    return Object.freeze({ enterPrivateNetMode, exitPrivateNetMode, selectPrivatePeer, onPnSegmentHover, onPnSegmentLeave, onPnSegmentClick, updatePrivateNetUI, clearPeerFromMap, bindBig, bindMini, closePopup, dispose });
}
