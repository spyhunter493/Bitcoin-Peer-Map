/* Private-network navigation, donut presentation, and peer selection. */
(function(global) {
'use strict';
function create({ mapView, settings: advSettings, onAction }) {
const dashboard = global.BPMDashboard;
const privateState = dashboard.privateNetwork;
const PRIVATE_NETS = new Set(['onion','i2p','cjdns']);
const ALL_NETS = new Set(['ipv4','ipv6',...PRIVATE_NETS]);
const SERVICE_FLAGS = global.BPMServiceFlags;
const project = global.BPMWorldMap.project;
    const { fmtBytes: pnFmtBytes, fmtDuration: pnFmtDuration } = window.BPMFormat;

    const privatePanel = window.BPMPrivateNetworkPanel.create({
        state: privateState,
        getColor: getPnNetColor,
        onAction(action) {
            if (action.type === 'select') selectPrivatePeer(action.peerId);
            else if (action.type === 'highlight') onAction(action);
            else if (action.type === 'redraw') renderPnDonut();
        },
    });
    const cachePnElements = privatePanel.cachePnElements;

    const PN_CONN_TYPE_FULL = window.BPMFormat.connectionTypes;

    const privatePopup = window.BPMPeerDetail.create({
        getPeers: () => dashboard.peers,
        privateNetwork: true,
        connectionTypeLabels: PN_CONN_TYPE_FULL,
        serviceFlags: SERVICE_FLAGS,
        onRequestClose: () => {
            privatePopup.close();
            privateState.privateNetSelectedPeerId = null;
            privateState.privateNetLinePeer = null;
            onAction({ type: 'highlight', peerId: null });
            onAction({ type: 'pin', peerId: null });
            if (!privateState.privateNetMode && !privateState.pnSelectedNet) {
                privateState.pnContainerEl?.classList.remove('pn-focused');
            }
            updatePrivateNetUI();
        },
        onDisconnect: (peerId, network) => onAction({ type: 'disconnect', peerId, network }),
    });

    // Donut configuration
    const PN_DONUT_SIZE = 260;
    const PN_DONUT_RADIUS = 116;
    const PN_DONUT_WIDTH = 28;
    const PN_DONUT_WIDTH_SELECTED = 40;
    const PN_DONUT_WIDTH_DIMMED = 14;
    const PN_INNER_RADIUS = PN_DONUT_RADIUS - PN_DONUT_WIDTH;



    /** Enter private network mode: zoom to Antarctica, show circular donut */
    /** Enter private network mode: zoom to Antarctica, show circular donut.
     *  If targetNet is provided, skip overview and go directly to that net's panel. */
    function enterPrivateNetMode(selectedPeerId, targetNet) {
        if (privateState.privateNetMode) {
            if (selectedPeerId != null) selectPrivatePeer(selectedPeerId);
            return;
        }
        privateState.privateNetMode = true;
        document.body.classList.add('private-net-mode');

        // Close any existing AS distribution panels/tooltips
        if (window.BPMDistribution) {
            window.BPMDistribution.closePeerPopup();
            window.BPMDistribution.deselect();
            if (window.BPMDistribution.isFocusedMode()) {
                window.BPMDistribution.exitFocusedMode();
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
            requestAnimationFrame(() => {
                privateState.pnContainerEl.classList.add('visible', 'pn-focused');
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
            setTimeout(() => privatePanel.openPnDetailPanel(targetNet), 200);
        } else {
            setTimeout(() => privatePanel.openPnOverviewPanel(), 200);
        }

        // Select the triggering peer if provided
        if (selectedPeerId != null) {
            setTimeout(() => selectPrivatePeer(selectedPeerId), 300);
        }
    }

    /** Exit private network mode: return to normal public view */
    function exitPrivateNetMode() {
        if (!privateState.privateNetMode) return;
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
            setTimeout(() => privateState.pnContainerEl.classList.add('hidden'), 500);
        }
        if (privateState.pnDetailPanelEl) {
            privateState.pnDetailPanelEl.classList.remove('visible');
            setTimeout(() => privateState.pnDetailPanelEl.classList.add('hidden'), 350);
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

    /** Select a specific private peer in Antarctica view */
    function selectPrivatePeer(peerId) {
        const node = mapView.nodes.find(n => n.peerId === peerId && n.alive);
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
        if (privateState.pnContainerEl) privateState.pnContainerEl.classList.add('pn-focused');

        privatePopup.openPeer(peerId, 'private', 350);

        updatePrivateNetUI();
    }

    // ── SVG Arc Path (same approach as AS distribution donut) ──

    function pnDescribeArc(cx, cy, outerR, innerR, startAngle, endAngle) {
        const sweep = endAngle - startAngle;
        const actualEnd = sweep >= 2 * Math.PI ? startAngle + 2 * Math.PI - 0.001 : endAngle;
        const largeArc = sweep > Math.PI ? 1 : 0;
        const ox1 = cx + outerR * Math.cos(startAngle);
        const oy1 = cy + outerR * Math.sin(startAngle);
        const ox2 = cx + outerR * Math.cos(actualEnd);
        const oy2 = cy + outerR * Math.sin(actualEnd);
        const ix1 = cx + innerR * Math.cos(actualEnd);
        const iy1 = cy + innerR * Math.sin(actualEnd);
        const ix2 = cx + innerR * Math.cos(startAngle);
        const iy2 = cy + innerR * Math.sin(startAngle);
        return [
            'M ' + ox1 + ' ' + oy1,
            'A ' + outerR + ' ' + outerR + ' 0 ' + largeArc + ' 1 ' + ox2 + ' ' + oy2,
            'L ' + ix1 + ' ' + iy1,
            'A ' + innerR + ' ' + innerR + ' 0 ' + largeArc + ' 0 ' + ix2 + ' ' + iy2,
            'Z',
        ].join(' ');
    }

    // ── Network metadata ──

    const PN_NET_COLORS_HEX = { onion: '#1565c0', i2p: '#d29922', cjdns: '#bc8cff' };
    const PN_NET_LABELS = { onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' };

    function getPnNetColor(net) {
        const varMap = { onion: '--net-tor', i2p: '--net-i2p', cjdns: '--net-cjdns' };
        const v = varMap[net];
        if (v) {
            const c = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
            if (c) return c;
        }
        return PN_NET_COLORS_HEX[net] || '#f0883e';
    }

    // ── Circular Donut Renderer ──

    function renderPnDonut() {
        cachePnElements();
        if (!privateState.pnDonutSvg) return;

        const privateNodes = mapView.nodes.filter(n => n.alive && PRIVATE_NETS.has(n.peer.network));
        const counts = { onion: 0, i2p: 0, cjdns: 0 };
        for (const n of privateNodes) {
            if (counts.hasOwnProperty(n.peer.network)) counts[n.peer.network]++;
        }
        const total = privateNodes.length;

        // Build segments
        privateState.pnSegments = [];
        for (const net of ['onion', 'i2p', 'cjdns']) {
            if (counts[net] > 0) {
                privateState.pnSegments.push({ net, count: counts[net], color: getPnNetColor(net), label: PN_NET_LABELS[net] });
            }
        }

        // Update center text
        if (privateState.pnCenterLabel && privateState.pnCenterCount && privateState.pnCenterSub) {
            // If a peer row is hovered in a sub-tooltip, preserve that peer's info
            if (dashboard.interaction.highlightedPeerId && privateState.pnSubTooltipPinned) {
                var peer = dashboard.peers.find(function(p) { return p.id === dashboard.interaction.highlightedPeerId; });
                if (peer) {
                    var netLabel = PN_NET_LABELS[peer.network] || peer.network || 'PEER';
                    var netColor = getPnNetColor(peer.network);
                    privateState.pnCenterLabel.textContent = netLabel.toUpperCase();
                    privateState.pnCenterLabel.style.color = netColor;
                    privateState.pnCenterCount.textContent = '#' + dashboard.interaction.highlightedPeerId;
                    privateState.pnCenterCount.style.fontSize = '22px';
                    privateState.pnCenterCount.style.fontFamily = '';
                    privateState.pnCenterCount.style.color = netColor;
                    privateState.pnCenterSub.textContent = peer.direction === 'IN' ? 'inbound' : 'outbound';
                }
            // If a category row preview is active (hover or pinned), preserve it across refresh
            } else if (privateState.pnCenterPreviewLabel && privateState.pnCenterPreviewPeerIds) {
                var cnt = privateState.pnCenterPreviewPeerIds.length;
                privateState.pnCenterLabel.textContent = cnt + ' PEER' + (cnt !== 1 ? 'S' : '');
                privateState.pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
                privateState.pnCenterCount.textContent = privateState.pnCenterPreviewLabel.toUpperCase();
                privateState.pnCenterCount.style.fontSize = '17px';
                privateState.pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
                privateState.pnCenterCount.style.color = '';
                var pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
                privateState.pnCenterSub.innerHTML = pct + '% of anonymous<br>peers';
            } else if (privateState.privateNetSelectedPeerId !== null) {
                privateState.pnCenterLabel.textContent = PN_NET_LABELS[dashboard.byId.get(privateState.privateNetSelectedPeerId)?.network] || 'PEER';
                privateState.pnCenterLabel.style.color = '';
                privateState.pnCenterCount.textContent = '#' + privateState.privateNetSelectedPeerId;
                privateState.pnCenterCount.style.fontSize = '22px';
                privateState.pnCenterCount.style.fontFamily = '';
                privateState.pnCenterCount.style.color = '';
                privateState.pnCenterSub.textContent = dashboard.byId.get(privateState.privateNetSelectedPeerId)?.direction === 'IN' ? 'inbound' : 'outbound';
            } else if (privateState.pnSelectedNet) {
                const seg = privateState.pnSegments.find(s => s.net === privateState.pnSelectedNet);
                var netCount = seg ? seg.count : 0;
                var netPct = total > 0 ? Math.round((netCount / total) * 100) : 0;
                privateState.pnCenterLabel.textContent = netCount + ' PEER' + (netCount !== 1 ? 'S' : '');
                privateState.pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
                privateState.pnCenterCount.textContent = (PN_NET_LABELS[privateState.pnSelectedNet] || privateState.pnSelectedNet).toUpperCase();
                privateState.pnCenterCount.style.fontSize = '22px';
                privateState.pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
                privateState.pnCenterCount.style.color = seg ? seg.color : '';
                privateState.pnCenterSub.innerHTML = netPct + '% of anonymous<br>peers';
            } else {
                var totalAllPeers = dashboard.peers.length || total;
                var pnPct = totalAllPeers > 0 ? Math.round((total / totalAllPeers) * 100) : 0;
                privateState.pnCenterLabel.textContent = total + ' PEER' + (total !== 1 ? 'S' : '');
                privateState.pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
                privateState.pnCenterCount.textContent = 'PRIVATE NETWORKS';
                privateState.pnCenterCount.style.fontSize = '13px';
                privateState.pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
                privateState.pnCenterCount.style.color = '';
                privateState.pnCenterSub.innerHTML = pnPct + '% of total<br>connections';
            }
        }

        // Render SVG
        const cx = PN_DONUT_SIZE / 2;
        const cy = PN_DONUT_SIZE / 2;
        const gap = 0.03;
        let html = '';

        // Defs for 3D effects
        html += '<defs>';
        html += '<filter id="pn-donut-shadow" x="-20%" y="-20%" width="140%" height="140%">';
        html += '<feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000" flood-opacity="0.55"/>';
        html += '</filter>';
        html += '<linearGradient id="pn-donut-highlight" x1="0" y1="0" x2="0" y2="1">';
        html += '<stop offset="0%" stop-color="rgba(255,255,255,0.12)"/>';
        html += '<stop offset="50%" stop-color="rgba(255,255,255,0)"/>';
        html += '<stop offset="100%" stop-color="rgba(0,0,0,0.10)"/>';
        html += '</linearGradient>';
        html += '</defs>';

        // Background track ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) + '" fill="none" stroke="rgba(240,136,62,0.04)" stroke-width="' + PN_DONUT_WIDTH + '" />';
        // Outer decorative ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_DONUT_RADIUS + 3) + '" fill="none" stroke="rgba(240,136,62,0.08)" stroke-width="1" />';
        // Inner decorative ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_INNER_RADIUS - 3) + '" fill="none" stroke="rgba(240,136,62,0.06)" stroke-width="0.5" />';

        if (privateState.pnSegments.length === 0) {
            // Empty state
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) + '" fill="none" stroke="#2d333b" stroke-width="' + PN_DONUT_WIDTH + '" opacity="0.5" />';
        } else if (privateState.pnSegments.length === 1) {
            const seg = privateState.pnSegments[0];
            const w = (privateState.pnSelectedNet === seg.net) ? PN_DONUT_WIDTH_SELECTED : PN_DONUT_WIDTH;
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) + '" fill="none" stroke="' + seg.color + '" stroke-width="' + w + '" class="pn-donut-segment" data-net="' + seg.net + '" filter="url(#pn-donut-shadow)" style="cursor:pointer" />';
        } else {
            const totalGap = gap * privateState.pnSegments.length;
            const available = 2 * Math.PI - totalGap;
            let angle = -Math.PI / 2;
            const highlightNet = privateState.pnSelectedNet || (privateState.privateNetSelectedPeerId !== null ? dashboard.byId.get(privateState.privateNetSelectedPeerId)?.network : null);

            html += '<g filter="url(#pn-donut-shadow)">';
            for (const seg of privateState.pnSegments) {
                const sweep = (seg.count / total) * available;
                if (sweep <= 0) continue;

                const startA = angle + gap / 2;
                const endA = angle + sweep + gap / 2;

                const isSelected = highlightNet === seg.net;
                const isDimmed = highlightNet && highlightNet !== seg.net;
                const segW = isSelected ? PN_DONUT_WIDTH_SELECTED : (isDimmed ? PN_DONUT_WIDTH_DIMMED : PN_DONUT_WIDTH);
                const segOuter = PN_DONUT_RADIUS - (PN_DONUT_WIDTH - segW) / 2;
                const segInner = segOuter - segW;
                const d = pnDescribeArc(cx, cy, segOuter, segInner, startA, endA);

                let cls = 'pn-donut-segment';
                if (isSelected) cls += ' selected';
                if (isDimmed) cls += ' dimmed';

                html += '<path d="' + d + '" fill="' + seg.color + '" class="' + cls + '" data-net="' + seg.net + '" style="cursor:pointer" />';
                angle += sweep + gap;
            }
            html += '</g>';

            // 3D highlight overlay
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) + '" fill="none" stroke="url(#pn-donut-highlight)" stroke-width="' + PN_DONUT_WIDTH + '" pointer-events="none" />';
        }

        privateState.pnDonutSvg.innerHTML = html;

        // Attach segment event handlers (hover preview + click)
        // Safe: innerHTML above replaced all children, so old listeners are GC'd with old elements
        privateState.pnDonutSvg.querySelectorAll('.pn-donut-segment').forEach(el => {
            el.addEventListener('click', onPnSegmentClick);
            el.addEventListener('mouseenter', onPnSegmentHover);
            el.addEventListener('mouseleave', onPnSegmentLeave);
        });
    }

    /** Hover over a donut segment → preview network, dim others, draw lines to that net's peers */
    function onPnSegmentHover(e) {
        if (privateState.pnSelectedNet || privateState.privateNetSelectedPeerId !== null) return;
        const net = e.currentTarget.dataset.net;
        const seg = privateState.pnSegments.find(s => s.net === net);
        if (!seg) return;
        privateState.pnHoveredNet = net;
        if (privateState.pnCenterLabel) privateState.pnCenterLabel.textContent = seg.label.toUpperCase();
        if (privateState.pnCenterCount) {
            privateState.pnCenterCount.textContent = seg.count;
            privateState.pnCenterCount.style.color = seg.color;
        }
        if (privateState.pnCenterSub) privateState.pnCenterSub.textContent = 'peers';

        // Dim non-matching donut segments
        if (privateState.pnDonutSvg) {
            privateState.pnDonutSvg.querySelectorAll('.pn-donut-segment').forEach(el => {
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
            privateState.pnDonutSvg.querySelectorAll('.pn-donut-segment').forEach(el => {
                el.classList.remove('dimmed');
            });
        }
    }

    /** Handle click on a donut segment */
    function onPnSegmentClick(e) {
        e.stopPropagation();
        const net = e.currentTarget.dataset.net;
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
            if (privateState.pnContainerEl) privateState.pnContainerEl.classList.add('pn-focused');
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
            privateState.pnDonutSvg.querySelectorAll('.pn-donut-segment').forEach(el => {
                if (el.dataset.net === savedSelectedNet) el.classList.add('selected');
                else el.classList.add('dimmed');
            });
        } else if (savedHoveredNet && privateState.pnDonutSvg) {
            privateState.pnDonutSvg.querySelectorAll('.pn-donut-segment').forEach(el => {
                if (el.dataset.net !== savedHoveredNet) el.classList.add('dimmed');
            });
        }

        // If insight rect was visible, re-hide the donut SVG/center (renderPnDonut restores them)
        if (savedInsightRectVisible && savedInsightType) {
            if (privateState.pnDonutSvg) privateState.pnDonutSvg.style.opacity = '0';
            var pnDonutCenter = document.getElementById('pn-donut-center');
            if (pnDonutCenter) pnDonutCenter.style.opacity = '0';
        }

        const restorePrivatePanel = window.BPMDomState.capture(privateState.pnDetailPanelEl);

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
            const allPN = mapView.nodes.filter(n => n.alive && PRIVATE_NETS.has(n.peer.network));
            const rawPeers = allPN.map(n => dashboard.peers.find(p => p.id === n.peerId)).filter(Boolean);
            const updatedPeer = rawPeers.find(p => p.id === savedInsightPeerId);
            if (updatedPeer) {
                privateState.pnInsightActiveData = privatePanel.buildPnInsightData(updatedPeer, savedInsightType);
                privatePanel.showPnInsightRect(savedInsightType, privateState.pnInsightActiveData);
            } else {
                privatePanel.hidePnInsightRect();
                privatePanel.clearPnInsightState();
            }

            // Re-highlight the active insight row in the rebuilt panel
            if (privateState.pnDetailBodyEl) {
                privateState.pnDetailBodyEl.querySelectorAll('.pn-insight-row').forEach(r => {
                    if (r.dataset.insightType === savedInsightType &&
                        parseInt(r.dataset.peerId) === savedInsightPeerId) {
                        r.classList.add('pn-insight-active');
                    }
                });
            }
        }

        privatePanel.refreshPinnedPreview();
        restorePrivatePanel();
        onAction({ type: 'table' });
    }


    function renderPnMiniDonut() {
        const miniWrap = document.getElementById('pn-mini-donut');
        const miniSvg = document.getElementById('pn-mini-svg');
        const miniCount = document.getElementById('pn-mini-count');
        if (!miniWrap || !miniSvg) return;

        // Count private peers
        const privateNodes = mapView.nodes.filter(n => n.alive && PRIVATE_NETS.has(n.peer.network));
        const total = privateNodes.length;

        if (total === 0 || privateState.privateNetMode) {
            miniWrap.classList.remove('visible');
            if (!miniWrap.classList.contains('hidden')) miniWrap.classList.add('hidden');
            onAction({ type: 'layout' });
            return;
        }

        // Show mini donut
        miniWrap.classList.remove('hidden');
        requestAnimationFrame(() => {
            miniWrap.classList.add('visible');
            onAction({ type: 'layout' });
        });

        // Build mini segments
        const counts = { onion: 0, i2p: 0, cjdns: 0 };
        for (const n of privateNodes) {
            if (counts.hasOwnProperty(n.peer.network)) counts[n.peer.network]++;
        }

        // Mini center count (matches the big donut's "Private / count / Peers" layout)
        if (miniCount) miniCount.textContent = total;
        const segs = [];
        for (const net of ['onion', 'i2p', 'cjdns']) {
            if (counts[net] > 0) segs.push({ net, count: counts[net], color: getPnNetColor(net) });
        }

        const cx = PN_DONUT_SIZE / 2;
        const cy = PN_DONUT_SIZE / 2;
        const outerR = PN_DONUT_RADIUS;
        const innerR = PN_INNER_RADIUS;
        let html = '';
        if (segs.length === 1) {
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((outerR + innerR) / 2) + '" fill="none" stroke="' + segs[0].color + '" stroke-width="' + (outerR - innerR) + '" class="pn-mini-segment" data-net="' + segs[0].net + '" style="cursor:pointer" />';
        } else if (segs.length > 1) {
            const gap = 0.03;
            const totalGap = gap * segs.length;
            const totalAngle = 2 * Math.PI - totalGap;
            let angle = -Math.PI / 2;
            for (const seg of segs) {
                const sweep = (seg.count / total) * totalAngle;
                const endA = angle + sweep;
                const d = pnDescribeArc(cx, cy, outerR, innerR, angle, endA);
                html += '<path d="' + d + '" fill="' + seg.color + '" class="pn-mini-segment" data-net="' + seg.net + '" style="cursor:pointer" />';
                angle = endA + gap;
            }
        }
        miniSvg.innerHTML = html;

        // Attach hover/click to mini donut segments
        miniSvg.querySelectorAll('.pn-mini-segment').forEach(el => {
            el.addEventListener('mouseenter', (e) => {
                e.stopPropagation();
                const net = el.dataset.net;
                privateState.pnMiniHoverNet = net;
                privateState.pnMiniHover = true;
                // Dim other segments
                miniSvg.querySelectorAll('.pn-mini-segment').forEach(s => {
                    if (s.dataset.net !== net) s.style.opacity = '0.3';
                    else s.style.opacity = '1';
                });
                // Dim other legend items
                const miniLegendEl = document.getElementById('pn-mini-legend');
                if (miniLegendEl) {
                    miniLegendEl.querySelectorAll('.pn-mini-legend-item').forEach(item => {
                        if (item.dataset.net !== net) item.classList.add('dimmed');
                        else { item.classList.remove('dimmed'); item.classList.add('highlighted'); }
                    });
                }
                // When legends hidden, show network info in mini donut center
                if (!advSettings.showDonutLegends) {
                    const seg = segs.find(s => s.net === net);
                    const label = PN_NET_LABELS[net] || net.toUpperCase();
                    const miniCenter = document.getElementById('pn-mini-center');
                    if (miniCenter) {
                        const labelEl = miniCenter.querySelector('.pn-mini-center-label');
                        const countEl = miniCenter.querySelector('.pn-mini-center-count');
                        const subEl = miniCenter.querySelector('.pn-mini-center-sub');
                        if (labelEl) labelEl.textContent = label;
                        if (countEl) {
                            countEl.textContent = seg ? seg.count : '';
                            countEl.style.color = seg ? seg.color : '';
                        }
                        if (subEl) subEl.textContent = 'peers';
                    }
                }
            });
            el.addEventListener('mouseleave', () => {
                privateState.pnMiniHoverNet = null;
                // Undim all segments
                miniSvg.querySelectorAll('.pn-mini-segment').forEach(s => s.style.opacity = '');
                const miniLegendEl = document.getElementById('pn-mini-legend');
                if (miniLegendEl) {
                    miniLegendEl.querySelectorAll('.pn-mini-legend-item').forEach(item => {
                        item.classList.remove('dimmed', 'highlighted');
                    });
                }
                // When legends hidden, restore default mini donut center text
                if (!advSettings.showDonutLegends) {
                    const miniCenter = document.getElementById('pn-mini-center');
                    if (miniCenter) {
                        const labelEl = miniCenter.querySelector('.pn-mini-center-label');
                        const countEl = miniCenter.querySelector('.pn-mini-center-count');
                        const subEl = miniCenter.querySelector('.pn-mini-center-sub');
                        if (labelEl) labelEl.textContent = 'Private';
                        if (countEl) {
                            countEl.textContent = total;
                            countEl.style.color = '';
                        }
                        if (subEl) subEl.textContent = 'Peers';
                    }
                }
            });
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const net = el.dataset.net;
                privateState.pnMiniHover = false;
                privateState.pnMiniHoverNet = null;
                enterPrivateNetMode(null, net);
            });
        });

        // Build mini legend (network breakdown list, sorted by count descending)
        const miniLegendEl = document.getElementById('pn-mini-legend');
        if (miniLegendEl) {
            const sorted = segs.slice().sort((a, b) => b.count - a.count);
            let legendHtml = '';
            for (const seg of sorted) {
                const label = PN_NET_LABELS[seg.net] || seg.net.toUpperCase();
                legendHtml += '<div class="pn-mini-legend-item" data-net="' + seg.net + '">';
                legendHtml += '<span class="pn-mini-legend-dot" style="background:' + seg.color + '"></span>';
                legendHtml += '<span class="pn-mini-legend-name">' + label + '</span>';
                legendHtml += '<span class="pn-mini-legend-count">' + seg.count + '</span>';
                legendHtml += '</div>';
            }
            miniLegendEl.innerHTML = legendHtml;

            // Attach hover/click to mini legend items (same behavior as segment hover)
            miniLegendEl.querySelectorAll('.pn-mini-legend-item').forEach(item => {
                item.addEventListener('mouseenter', () => {
                    const net = item.dataset.net;
                    privateState.pnMiniHoverNet = net;
                    privateState.pnMiniHover = true;
                    // Dim other segments
                    miniSvg.querySelectorAll('.pn-mini-segment').forEach(s => {
                        s.style.opacity = s.dataset.net !== net ? '0.3' : '1';
                    });
                    // Dim other legend items
                    miniLegendEl.querySelectorAll('.pn-mini-legend-item').forEach(li => {
                        if (li.dataset.net !== net) li.classList.add('dimmed');
                        else { li.classList.remove('dimmed'); li.classList.add('highlighted'); }
                    });
                });
                item.addEventListener('mouseleave', () => {
                    privateState.pnMiniHoverNet = null;
                    miniSvg.querySelectorAll('.pn-mini-segment').forEach(s => s.style.opacity = '');
                    miniLegendEl.querySelectorAll('.pn-mini-legend-item').forEach(li => {
                        li.classList.remove('dimmed', 'highlighted');
                    });
                });
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const net = item.dataset.net;
                    privateState.pnMiniHover = false;
                    privateState.pnMiniHoverNet = null;
                    enterPrivateNetMode(null, net);
                });
            });
        }
        onAction({ type: 'layout' });
    }

    /** Draw "PRIVATE NETWORKS" text tiled across Antarctica on the canvas */

    function getPnMiniLegendDotPos(net) {
        const legendEl = document.getElementById('pn-mini-legend');
        if (!legendEl) return null;
        const items = legendEl.querySelectorAll('.pn-mini-legend-item');
        for (const item of items) {
            if (item.dataset.net === net) {
                const dot = item.querySelector('.pn-mini-legend-dot');
                if (dot) {
                    const r = dot.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                    }
                }
            }
        }
        return null;
    }

    /** Draw lines from the donut to private peers.
     *  Priority chain (first match wins):
     *  1. pnPreviewPeerIds set (panel row hover) → lines to those specific peers
     *  2. privateNetLinePeer set (selected peer) → line to that one peer
     *  3. pnHoveredNet set (donut segment hover) → lines to that net's peers
     *  4. pnSelectedNet set (donut segment selected) → lines to that net's peers
     *  5. privateNetMode with nothing selected → lines to ALL private peers
     *  6. pnMiniHover (default view) → lines from mini legend dots to private peers
     *  7. pnMiniHoverNet (default view segment hover) → lines from that legend dot */

return Object.freeze({ privatePanel, cachePnElements, privatePopup, enterPrivateNetMode, exitPrivateNetMode, selectPrivatePeer, renderPnDonut, updatePrivateNetUI, renderPnMiniDonut, getPnMiniLegendDotPos });
}
global.BPMPrivateNetwork = Object.freeze({ create });
})(window);
