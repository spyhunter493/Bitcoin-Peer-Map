import { queryAll, query } from '../core/dom.js';
import * as privateData from './private-data.js';

/** DOM and SVG presentation for both private-network donuts.
 * @param {import('./private-components').NetworkViewOptions} options */
export function create(options) {
    const { dashboard, document, mapView, lifecycle, bindings, onAction, panel } = options;
    const privateState = dashboard.privateNetwork;
    const HTMLElement = document.defaultView?.HTMLElement || globalThis.HTMLElement;
    const cachePnElements = panel.cachePnElements;
    const PN_NET_LABELS = privateData.labels;
    /** @type {Record<string, string>} */
    const PN_NET_COLORS_HEX = { onion: '#1565c0', i2p: '#d29922', cjdns: '#bc8cff' };
    const PN_DONUT_SIZE = 260, PN_DONUT_RADIUS = 116, PN_DONUT_WIDTH = 28,
        PN_DONUT_WIDTH_SELECTED = 40, PN_DONUT_WIDTH_DIMMED = 14, PN_INNER_RADIUS = 88;
    /** @param {number} cx
     * @param {number} cy
     * @param {number} startAngle
     * @param {number} endAngle
     *
     * @param {number} outerR
     * @param {number} innerR
     */
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

    /** @param {string} net */
    function getPnNetColor(net) {
        /** @type {Record<string, string>} */
        const varMap = { onion: '--net-tor', i2p: '--net-i2p', cjdns: '--net-cjdns' };
        const v = varMap[net];
        if (v) {
            const c = document.defaultView?.getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '';
            if (c) return c;
        }
        return PN_NET_COLORS_HEX[net] || '#f0883e';
    }

    function renderPnDonut() {
        cachePnElements();
        if (!privateState.pnDonutSvg) return;

        const { counts, total } = privateData.liveCounts(mapView.nodes);

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
                var peer = dashboard.peers.find(function (p) {
                    return p.id === dashboard.interaction.highlightedPeerId;
                });
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
                privateState.pnCenterLabel.textContent =
                    PN_NET_LABELS[dashboard.byId.get(privateState.privateNetSelectedPeerId)?.network || ''] || 'PEER';
                privateState.pnCenterLabel.style.color = '';
                privateState.pnCenterCount.textContent = '#' + privateState.privateNetSelectedPeerId;
                privateState.pnCenterCount.style.fontSize = '22px';
                privateState.pnCenterCount.style.fontFamily = '';
                privateState.pnCenterCount.style.color = '';
                privateState.pnCenterSub.textContent =
                    dashboard.byId.get(privateState.privateNetSelectedPeerId)?.direction === 'IN' ? 'inbound' : 'outbound';
            } else if (privateState.pnSelectedNet) {
                const seg = privateState.pnSegments.find((s) => s.net === privateState.pnSelectedNet);
                var netCount = seg ? seg.count : 0;
                var netPct = total > 0 ? Math.round((netCount / total) * 100) : 0;
                privateState.pnCenterLabel.textContent = netCount + ' PEER' + (netCount !== 1 ? 'S' : '');
                privateState.pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
                privateState.pnCenterCount.textContent = (
                    PN_NET_LABELS[privateState.pnSelectedNet] || privateState.pnSelectedNet
                ).toUpperCase();
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
        html +=
            '<circle cx="' +
            cx +
            '" cy="' +
            cy +
            '" r="' +
            (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) +
            '" fill="none" stroke="rgba(240,136,62,0.04)" stroke-width="' +
            PN_DONUT_WIDTH +
            '" />';
        // Outer decorative ring
        html +=
            '<circle cx="' +
            cx +
            '" cy="' +
            cy +
            '" r="' +
            (PN_DONUT_RADIUS + 3) +
            '" fill="none" stroke="rgba(240,136,62,0.08)" stroke-width="1" />';
        // Inner decorative ring
        html +=
            '<circle cx="' +
            cx +
            '" cy="' +
            cy +
            '" r="' +
            (PN_INNER_RADIUS - 3) +
            '" fill="none" stroke="rgba(240,136,62,0.06)" stroke-width="0.5" />';

        if (privateState.pnSegments.length === 0) {
            // Empty state
            html +=
                '<circle cx="' +
                cx +
                '" cy="' +
                cy +
                '" r="' +
                (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) +
                '" fill="none" stroke="#2d333b" stroke-width="' +
                PN_DONUT_WIDTH +
                '" opacity="0.5" />';
        } else if (privateState.pnSegments.length === 1) {
            const seg = privateState.pnSegments[0];
            const w = privateState.pnSelectedNet === seg.net ? PN_DONUT_WIDTH_SELECTED : PN_DONUT_WIDTH;
            html +=
                '<circle cx="' +
                cx +
                '" cy="' +
                cy +
                '" r="' +
                (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) +
                '" fill="none" stroke="' +
                seg.color +
                '" stroke-width="' +
                w +
                '" class="pn-donut-segment" data-net="' +
                seg.net +
                '" filter="url(#pn-donut-shadow)" style="cursor:pointer" />';
        } else {
            const totalGap = gap * privateState.pnSegments.length;
            const available = 2 * Math.PI - totalGap;
            let angle = -Math.PI / 2;
            const highlightNet =
                privateState.pnSelectedNet ||
                (privateState.privateNetSelectedPeerId !== null
                    ? dashboard.byId.get(privateState.privateNetSelectedPeerId)?.network
                    : null);

            html += '<g filter="url(#pn-donut-shadow)">';
            for (const seg of privateState.pnSegments) {
                const sweep = (seg.count / total) * available;
                if (sweep <= 0) continue;

                const startA = angle + gap / 2;
                const endA = angle + sweep + gap / 2;

                const isSelected = highlightNet === seg.net;
                const isDimmed = highlightNet && highlightNet !== seg.net;
                const segW = isSelected ? PN_DONUT_WIDTH_SELECTED : isDimmed ? PN_DONUT_WIDTH_DIMMED : PN_DONUT_WIDTH;
                const segOuter = PN_DONUT_RADIUS - (PN_DONUT_WIDTH - segW) / 2;
                const segInner = segOuter - segW;
                const d = pnDescribeArc(cx, cy, segOuter, segInner, startA, endA);

                let cls = 'pn-donut-segment';
                if (isSelected) cls += ' selected';
                if (isDimmed) cls += ' dimmed';

                html +=
                    '<path d="' + d + '" fill="' + seg.color + '" class="' + cls + '" data-net="' + seg.net + '" style="cursor:pointer" />';
                angle += sweep + gap;
            }
            html += '</g>';

            // 3D highlight overlay
            html +=
                '<circle cx="' +
                cx +
                '" cy="' +
                cy +
                '" r="' +
                (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) +
                '" fill="none" stroke="url(#pn-donut-highlight)" stroke-width="' +
                PN_DONUT_WIDTH +
                '" pointer-events="none" />';
        }

        privateState.pnDonutSvg.innerHTML = html;

        bindings.big(privateState.pnDonutSvg);
    }

    function renderPnMiniDonut() {
        const miniWrap = document.getElementById('pn-mini-donut');
        const miniSvg = document.getElementById('pn-mini-svg');
        const miniCount = document.getElementById('pn-mini-count');
        if (!miniWrap || !miniSvg) return;

        // Count private peers
        const { counts, total } = privateData.liveCounts(mapView.nodes);

        if (total === 0 || privateState.privateNetMode) {
            miniWrap.classList.remove('visible');
            if (!miniWrap.classList.contains('hidden')) miniWrap.classList.add('hidden');
            onAction({ type: 'layout' });
            return;
        }

        // Show mini donut
        miniWrap.classList.remove('hidden');
        lifecycle.frame(() => {
            miniWrap.classList.add('visible');
            onAction({ type: 'layout' });
        });

        // Mini center count (matches the big donut's "Private / count / Peers" layout)
        if (miniCount) miniCount.textContent = String(total);
        /** @type {{net: string; count: number; color: string}[]} */
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
            html +=
                '<circle cx="' +
                cx +
                '" cy="' +
                cy +
                '" r="' +
                (outerR + innerR) / 2 +
                '" fill="none" stroke="' +
                segs[0].color +
                '" stroke-width="' +
                (outerR - innerR) +
                '" class="pn-mini-segment" data-net="' +
                segs[0].net +
                '" style="cursor:pointer" />';
        } else if (segs.length > 1) {
            const gap = 0.03;
            const totalGap = gap * segs.length;
            const totalAngle = 2 * Math.PI - totalGap;
            let angle = -Math.PI / 2;
            for (const seg of segs) {
                const sweep = (seg.count / total) * totalAngle;
                const endA = angle + sweep;
                const d = pnDescribeArc(cx, cy, outerR, innerR, angle, endA);
                html +=
                    '<path d="' +
                    d +
                    '" fill="' +
                    seg.color +
                    '" class="pn-mini-segment" data-net="' +
                    seg.net +
                    '" style="cursor:pointer" />';
                angle = endA + gap;
            }
        }
        miniSvg.innerHTML = html;

        // Build mini legend (network breakdown list, sorted by count descending)
        const miniLegendEl = document.getElementById('pn-mini-legend');
        if (miniLegendEl) {
            const focusedNetwork = miniLegendEl.contains(document.activeElement) && document.activeElement instanceof HTMLElement
                ? document.activeElement.dataset.net : undefined;
            const sorted = segs.slice().sort((a, b) => b.count - a.count);
            let legendHtml = '';
            for (const seg of sorted) {
                const label = PN_NET_LABELS[seg.net] || seg.net.toUpperCase();
                legendHtml += '<button type="button" class="pn-mini-legend-item" data-net="' + seg.net + '">';
                legendHtml += '<span class="pn-mini-legend-dot" style="background:' + seg.color + '"></span>';
                legendHtml += '<span class="pn-mini-legend-name">' + label + '</span>';
                legendHtml += '<span class="pn-mini-legend-count">' + seg.count + '</span>';
                legendHtml += '</button>';
            }
            miniLegendEl.innerHTML = legendHtml;
            if (focusedNetwork) queryAll('.pn-mini-legend-item', miniLegendEl)
                .find(item => item.dataset.net === focusedNetwork)?.focus({ preventScroll: true });

            bindings.mini(miniSvg, miniLegendEl, segs, total);
        } else {
            bindings.mini(miniSvg, null, segs, total);
        }
        onAction({ type: 'layout' });
    }

    /** Draw "PRIVATE NETWORKS" text tiled across Antarctica on the canvas
     * @param {string} net */
    function getPnMiniLegendDotPos(net) {
        const legendEl = document.getElementById('pn-mini-legend');
        if (!legendEl) return null;
        const items = queryAll('.pn-mini-legend-item', legendEl);
        for (const item of items) {
            if (item.dataset.net === net) {
                const dot = query('.pn-mini-legend-dot', item);
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
    function dispose() {
        lifecycle.dispose();
        privateState.pnContainerEl?.classList.remove('visible', 'pn-focused');
        privateState.pnContainerEl?.classList.add('hidden');
        document.getElementById('pn-mini-donut')?.classList.remove('visible');
        document.getElementById('pn-mini-donut')?.classList.add('hidden');
    }
    return Object.freeze({ getPnNetColor, renderPnDonut, renderPnMiniDonut, getPnMiniLegendDotPos, dispose });
}
