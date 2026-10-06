/** @typedef {Pick<import('./renderer.js').Options,
 * 'mapView' | 'view' | 'canvas' | 'ctx' | 'preferences' | 'interaction' | 'privateState' |
 * 'isMapNodeVisible' | 'showAntarcticaPeers' | 'getPrivateInsightOrigin' |
 * 'getPnMiniLegendDotPos' | 'distribution'> & {
 * worldToScreen(lon: number, lat: number): import('../types').Point;
 * }} Options */

/** Draws connections from distribution and private-network UI to wrapped map peers.
 * @param {Options} options
 */
export function create(options) {
    const { mapView, view, canvas, ctx, interaction, privateState, isMapNodeVisible, worldToScreen } = options;
    const { advSettings } = options.preferences;
    const PRIVATE_NETS = new Set(['onion', 'i2p', 'cjdns']);

    /** Draw private network labels across Antarctica. */
    function drawPrivateNetworksText() {
        if (!privateState.privateNetMode || !options.showAntarcticaPeers()) return;

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
                const lonOff = ri % 2 === 1 ? 30 : 0;
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
                    ctx.fillStyle = `rgba(240, 136, 62, ${(0.1 * alphaFade).toFixed(3)})`;
                    ctx.shadowBlur = 8;
                    ctx.fillText('NOT REAL LOCATIONS', s3.x, s3.y);
                }
            }
        }

        ctx.restore();
    }

    /** Network type → RGB color for private-net lines (must match PN_NET_COLORS_HEX)
     * @type {Record<string, import('../types').RGB>} */
    const PN_LINE_COLORS = {
        onion: { r: 21, g: 101, b: 192 },
        i2p: { r: 210, g: 153, b: 34 },
        cjdns: { r: 188, g: 140, b: 255 },
    };

    /** Get the page-coords origin for a private network's legend dot in the mini donut.
     *  Returns {x, y} or null.
     * @param {number[]} wrapOffsets */
    function drawPrivateNetLines(wrapOffsets) {
        if (!options.showAntarcticaPeers()) return;
        if (!privateState.privateNetMode && !privateState.pnMiniHover) return;

        const canvasRect = canvas.getBoundingClientRect();

        // Determine a fallback donut center origin
        const originElId = privateState.privateNetMode ? 'pn-donut-wrap' : 'pn-mini-donut';
        const originEl = document.getElementById(originElId);
        if (!originEl) return;
        const fallbackRect = originEl.getBoundingClientRect();
        const fallbackOriginX =
            (fallbackRect.left + fallbackRect.width / 2 - canvasRect.left) * (mapView.width / canvasRect.width);
        const fallbackOriginY =
            (fallbackRect.top + fallbackRect.height / 2 - canvasRect.top) * (mapView.height / canvasRect.height);

        // Determine which nodes to draw lines to (priority chain)
        let privateNodes;
        const selectedId = privateState.privateNetLinePeer;

        if (privateState.privateNetMode && privateState.pnPreviewPeerIds !== null) {
            // Panel row hover preview → specific peer IDs
            const idSet = new Set(privateState.pnPreviewPeerIds);
            privateNodes = mapView.nodes.filter((n) => n.alive && idSet.has(n.peerId));
        } else if (privateState.privateNetMode && selectedId) {
            // Selected peer → only that peer
            const selectedNode = mapView.nodes.find((n) => n.peerId === selectedId && n.alive);
            privateNodes = selectedNode ? [selectedNode] : [];
        } else if (privateState.privateNetMode && privateState.pnHoveredNet) {
            // Hovered donut segment → that network's peers
            privateNodes = mapView.nodes.filter((n) => n.alive && n.peer.network === privateState.pnHoveredNet);
        } else if (privateState.privateNetMode && privateState.pnSelectedNet) {
            // Selected donut segment → that network's peers
            privateNodes = mapView.nodes.filter((n) => n.alive && n.peer.network === privateState.pnSelectedNet);
        } else if (privateState.privateNetMode) {
            // No selection/hover → ALL private peers
            privateNodes = mapView.nodes.filter((n) => n.alive && PRIVATE_NETS.has(n.peer.network));
        } else if (privateState.pnMiniHover && privateState.pnMiniHoverNet) {
            // Mini donut segment hover → that network's peers
            privateNodes = mapView.nodes.filter((n) => n.alive && n.peer.network === privateState.pnMiniHoverNet);
        } else if (privateState.pnMiniHover) {
            // Mini donut hover → all private peers
            privateNodes = mapView.nodes.filter((n) => n.alive && PRIVATE_NETS.has(n.peer.network));
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
                const iro = options.getPrivateInsightOrigin();
                if (iro) {
                    originX = (iro.x - canvasRect.left) * (mapView.width / canvasRect.width);
                    originY = (iro.y - canvasRect.top) * (mapView.height / canvasRect.height);
                }
            } else if (privateState.pnMiniHover && !privateState.privateNetMode) {
                const dotPos = options.getPnMiniLegendDotPos(node.peer.network);
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
                if (d < bestDist) {
                    bestDist = d;
                    bestS = s;
                }
            }
            if (!bestS) continue;

            const c = PN_LINE_COLORS[node.peer.network] || { r: 240, g: 136, b: 62 };
            const dist = Math.sqrt((originX - bestS.x) ** 2 + (originY - bestS.y) ** 2);
            const isSelected = node.peerId === selectedId;
            const baseAlpha = isSelected ? 0.6 : 0.25;
            const alpha = Math.min(
                baseAlpha,
                0.1 + (baseAlpha - 0.05) * (1 - dist / Math.max(mapView.width, mapView.height))
            );

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

    /**
 * For each node, pick the best wrap-copy screen position to draw a line to.
 * Priority:
 *   1. On-screen copies (within viewport + small margin) → closest to viewport center
 *   2. Near-screen copies (within a wider margin) → closest to viewport center
 *   3. Any copy → closest to viewport center
 * The returned `dist` is to the *line origin* (legend dot), used for alpha fade.

 * @param {import('../types').MapNode[]} matchingNodes
 * @param {number[]} wrapOffsets
 * @param {number} originX
 * @param {number} originY */
    function resolveAsLinePeers(matchingNodes, wrapOffsets, originX, originY) {
        const resolved = [];
        const vcx = mapView.width / 2; // viewport center x
        const vcy = mapView.height / 2; // viewport center y
        // Scale margins with canvas size so behaviour is resolution-independent
        const MARGIN_ONSCREEN = Math.max(mapView.width, mapView.height) * 0.05; // ~5% beyond edges
        const MARGIN_NEAR = Math.max(mapView.width, mapView.height) * 0.25; // ~25% beyond edges

        for (const node of matchingNodes) {
            if (!isMapNodeVisible(node)) continue;
            let bestS = null;
            let bestCenterDist = Infinity;
            let bestTier = 3; // lower = better (1=on-screen, 2=near, 3=any)

            for (const off of wrapOffsets) {
                const s = worldToScreen(node.lon + off, node.lat);

                // Determine which tier this copy falls into
                let tier;
                if (
                    s.x >= -MARGIN_ONSCREEN &&
                    s.x <= mapView.width + MARGIN_ONSCREEN &&
                    s.y >= -MARGIN_ONSCREEN &&
                    s.y <= mapView.height + MARGIN_ONSCREEN
                ) {
                    tier = 1; // on-screen
                } else if (
                    s.x >= -MARGIN_NEAR &&
                    s.x <= mapView.width + MARGIN_NEAR &&
                    s.y >= -MARGIN_NEAR &&
                    s.y <= mapView.height + MARGIN_NEAR
                ) {
                    tier = 2; // near-screen
                } else {
                    tier = 3; // far off-screen
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

    /** @param {number[]} wrapOffsets */
    function drawAsLines(wrapOffsets) {
        if (!interaction.asLinePeerIds || !interaction.asLineColor) return;
        const distribution = options.distribution;
        if (!distribution) return;

        // Lines originate from legend dots (top-8 direct, Others for non-top-8, donut center fallback)
        let lineOrigin = null;
        if (interaction.asLineAsNum) {
            lineOrigin = distribution.getLineOriginForAs(interaction.asLineAsNum);
        }
        if (!lineOrigin) return;

        const peerIdSet = new Set(interaction.asLinePeerIds);
        const matchingNodes = mapView.nodes.filter((n) => n.alive && peerIdSet.has(n.peerId));
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
        const zoomBoost = Math.min(view.zoom / 1.5, 3); // up to 3x thicker when zoomed in
        const lineW = baseLineW * zoomBoost;
        // Fan spread from advSettings: slider 0→0%, 50→35%, 100→70% of line length
        const fanSlider = advSettings.asLineFan;
        const fanPct = (fanSlider / 100) * 0.7;
        const fanMax = 40 + (fanSlider / 100) * 120; // 40px at 0, 160px at 100

        ctx.save();
        ctx.lineWidth = lineW;
        ctx.strokeStyle = interaction.asLineColor;

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
     *  Each group draws from its own legend dot in its own color.
     * @param {number[]} wrapOffsets */
    function drawAsLinesAll(wrapOffsets) {
        if (!interaction.asLineGroups || interaction.asLineGroups.length === 0) return;
        const distribution = options.distribution;
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

        for (const grp of interaction.asLineGroups) {
            // Lines originate from legend dots (top-8 direct, Others for non-top-8, donut center fallback)
            let lineOrigin = distribution.getLineOriginForAs(grp.asNum);
            if (!lineOrigin) continue;

            const originX = (lineOrigin.x - canvasRect.left) * (mapView.width / canvasRect.width);
            const originY = (lineOrigin.y - canvasRect.top) * (mapView.height / canvasRect.height);

            const peerIdSet = new Set(grp.peerIds);
            const matchingNodes = mapView.nodes.filter((n) => n.alive && peerIdSet.has(n.peerId));
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

    return Object.freeze({
        // Origins can move during panel transitions without changing selection.
        // Include their current geometry when deciding whether cached lines match.
        getLayoutKey() {
            /** @type {number[]} */
            const key = [];
            /** @param {import('../types').Point | null} point */
            const addPoint = point => { key.push(point?.x ?? -1, point?.y ?? -1); };
            if (interaction.asLineGroups?.length) {
                for (const group of interaction.asLineGroups) addPoint(options.distribution.getLineOriginForAs(group.asNum));
            } else if (interaction.asLinePeerIds?.length && interaction.asLineAsNum) {
                addPoint(options.distribution.getLineOriginForAs(interaction.asLineAsNum));
            }
            if (privateState.privateNetMode || privateState.pnMiniHover) {
                const el = document.getElementById(privateState.privateNetMode ? 'pn-donut-wrap' : 'pn-mini-donut');
                const rect = el?.getBoundingClientRect();
                key.push(rect?.left ?? -1, rect?.top ?? -1, rect?.width ?? -1, rect?.height ?? -1);
                if (privateState.pnInsightRectVisible) addPoint(options.getPrivateInsightOrigin());
                if (privateState.pnMiniHover) {
                    for (const net of PRIVATE_NETS) addPoint(options.getPnMiniLegendDotPos(net));
                }
            }
            if (key.length) {
                const rect = canvas.getBoundingClientRect();
                key.push(rect.left, rect.top, rect.width, rect.height);
            }
            return key;
        },
        drawPrivateNetworksText,
        drawPrivateNetLines,
        drawAsLines,
        drawAsLinesAll,
    });
}
