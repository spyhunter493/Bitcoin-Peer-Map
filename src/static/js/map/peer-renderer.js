import { rgba, clamp } from './geometry.js';

/** @typedef {Pick<import('./renderer.js').Options,
 * 'mapView' | 'ctx' | 'config' | 'preferences' | 'interaction' | 'privateState' |
 * 'isMapNodeVisible'> & {
 * reducedMotionQuery: MediaQueryList;
 * worldToScreen(lon: number, lat: number): import('../types').Point;
 * getWrapOffsets(): number[];
 * }} Options */

/** Owns peer animation, highlights, mesh rendering, and map hit testing.
 * @param {Options} options
 */
export function create(options) {
    const { mapView, ctx, interaction, privateState, isMapNodeVisible,
        reducedMotionQuery, worldToScreen, getWrapOffsets } = options;
    const CFG = options.config;
    const { nodeHighlightColor } = options.preferences;
    const PRIVATE_NETS = new Set(['onion', 'i2p', 'cjdns']);
    const ALL_NETS = new Set(['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns']);
    const isAllNetsEnabled = () => [...ALL_NETS].every(net => interaction.enabledNets.has(net));
    /** @param {string} network */
    const passesNetFilter = network => interaction.enabledNets.has(network);
    // Reuse the expensive radial gradients at large peer counts. Only the glow
    // radius is quantized (within 0.125 CSS pixels); pulse/opacity stay continuous.
    /** @type {Map<string, {canvas: HTMLCanvasElement; radius: number}>} */
    const glows = new Map();
    /** @param {import('../types').RGB} color @param {number} core @param {number} glow */
    function glowSprite(color, core, glow) {
        const radius = Math.max(core + 0.25, Math.round(glow * 4) / 4);
        const key = `${color.r},${color.g},${color.b},${core},${radius}`;
        let sprite = glows.get(key);
        if (!sprite) {
            const canvas = document.createElement('canvas');
            const extent = Math.ceil(radius + 1);
            canvas.width = canvas.height = extent * 4;
            const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
            context.scale(2, 2);
            const gradient = context.createRadialGradient(extent, extent, core, extent, extent, radius);
            gradient.addColorStop(0, rgba(color, 0.55));
            gradient.addColorStop(0.5, rgba(color, 0.18));
            gradient.addColorStop(1, rgba(color, 0));
            context.fillStyle = gradient;
            context.beginPath();
            context.arc(extent, extent, radius, 0, Math.PI * 2);
            context.fill();
            sprite = { canvas, radius: extent };
            if (glows.size >= 256) glows.delete(glows.keys().next().value || '');
            glows.set(key, sprite);
        }
        return sprite;
    }

    /**
 * Draw a single node at a specific screen position.
 * @param {number} brightness - connection-age brightness (0..1)

 *
 * @param {number} sx
 * @param {number} sy
 * @param {number} r
 * @param {number} gr
 * @param {number} pulse
 * @param {number} opacity
 * @param {import('../types').RGB} c
 * @param {boolean} cached
 */
    function drawNodeAt(sx, sy, c, r, gr, pulse, opacity, brightness, cached) {
        // Outer glow (radial gradient) — modulated by brightness and pulse
        if (cached) {
            const sprite = glowSprite(c, r, gr);
            const alpha = ctx.globalAlpha;
            ctx.globalAlpha = alpha * pulse * opacity * brightness;
            ctx.drawImage(sprite.canvas, sx - sprite.radius, sy - sprite.radius, sprite.radius * 2, sprite.radius * 2);
            ctx.globalAlpha = alpha;
        } else {
            const grad = ctx.createRadialGradient(sx, sy, r, sx, sy, gr);
            grad.addColorStop(0, rgba(c, 0.55 * pulse * opacity * brightness));
            grad.addColorStop(0.5, rgba(c, 0.18 * pulse * opacity * brightness));
            grad.addColorStop(1, rgba(c, 0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(sx, sy, gr, 0, Math.PI * 2);
            ctx.fill();
        }

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

 * @param {number} sx
 * @param {number} sy
 * @param {import('../types').RGB} c
 * @param {number} ageMs
 * @param {number} opacity */
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

 * @param {import('../types').MapNode} node
 * @param {number} nowSec */
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

 * @param {import('../types').MapNode} node
 * @param {number} ageMs
 * @param {number} connAgeSec */
    function getDirectionPulse(node, ageMs, connAgeSec) {
        const isInbound = node.peer.direction === 'IN';
        const baseSpeed = isInbound ? CFG.pulseSpeedInbound : CFG.pulseSpeedOutbound;
        const depth = isInbound ? CFG.pulseDepthInbound : CFG.pulseDepthOutbound;

        // Nervousness: young peers pulse faster, decays over time
        const nervT = clamp(connAgeSec / CFG.nervousnessRampSec, 0, 1);
        const nervousness = CFG.nervousnessMax * (1 - nervT);
        const speed = baseSpeed + nervousness;

        if (isInbound) {
            return 1 - depth + depth * (0.5 + 0.5 * Math.sin(node.phase + ageMs * speed));
        } else {
            const raw = Math.abs(Math.sin(node.phase + ageMs * speed));
            return 1 - depth + depth * raw;
        }
    }

    /**
 * Ambient shimmer — residual twinkle for long-lived peers.
 * Three sine waves at incommensurate frequencies are multiplied
 * together; positive products create brief bright spikes.
 * Returns a value in [0, 1], concentrated near 0 (mostly quiet,
 * occasional sparkles).

 * @param {number} phase
 * @param {number} ageMs */
    function getAmbientShimmer(phase, ageMs) {
        const w1 = Math.sin(phase * 3.71 + ageMs * CFG.shimmerFreq1);
        const w2 = Math.sin(phase * 7.13 + ageMs * CFG.shimmerFreq2);
        const w3 = Math.sin(phase * 11.07 + ageMs * CFG.shimmerFreq3);
        return Math.max(0, w1 * w2 * w3);
    }

    /**
 * Draw a single node on the canvas at all visible wrap positions.
 * Lifecycle phases:
 *   1. Arrival bloom (first ~5s) — expanding ring + energetic glow
 *   2. Connected state — brightness ramps with age, nervousness decays
 *   3. Fade-out — eased dissolve when peer disconnects

 * @param {import('../types').MapNode} node
 * @param {number} now
 * @param {number[]} wrapOffsets */
    function drawNode(node, now, wrapOffsets) {
        if (!isMapNodeVisible(node)) return;
        if (now < node.spawnTime) return;
        const reducedMotion = reducedMotionQuery.matches;
        if (reducedMotion && !node.alive) return;

        // Network filter: skip nodes whose network isn't enabled
        // (but always draw fading-out nodes so they dissolve gracefully)
        if (!passesNetFilter(node.peer.network) && node.alive) return;

        // [DISTRIBUTION] Dim peers not in the selected AS
        let asDimFactor = 1;
        if (
            interaction.asFilterPeerIds &&
            node.alive &&
            !interaction.asFilterPeerIds.has(node.peerId)
        ) {
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
        const connAgeSec = node.peer.conntime > 0 ? Math.max(0, nowSec - node.peer.conntime) : 0;
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
            if (s.x < -margin || s.x > mapView.width + margin || s.y < -margin || s.y > mapView.height + margin)
                continue;

            // Arrival bloom effect (ring + glow) — drawn behind the node
            if (inArrival && node.alive) {
                drawArrivalBloom(s.x, s.y, c, ageMs, finalOpacity);
            }

            drawNodeAt(s.x, s.y, c, r, gr, pulse, finalOpacity, brightness,
                mapView.nodes.length >= 250 && ageMs >= CFG.arrivalDuration);
        }
    }

    /**
 * Draw subtle connection lines between nearby nodes.
 * Only draws between nodes that are close on screen (< 250px apart)
 * and skips fading-out nodes to avoid visual clutter.
 * Uses wrap offsets so connections work across the date line.

 * @param {number[]} wrapOffsets
 * @param {CanvasRenderingContext2D} [ctx] */
    function drawConnectionLines(wrapOffsets, ctx = options.ctx) {
        let drawn = 0;
        ctx.lineWidth = 0.5;
        let aliveNodes = mapView.nodes.filter((n) => n.alive && isMapNodeVisible(n));
        // Respect network filter for connection lines too
        if (!isAllNetsEnabled()) {
            aliveNodes = aliveNodes.filter((n) => passesNetFilter(n.peer.network));
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
                drawn++;
            }
        }
        return drawn;
    }

    /** Draw a highlight ring around a node when it's highlighted via table hover.
     *  When pinned (selected), draws a brighter pulsing halo so it's
     *  unambiguous which peer is selected even in dense clusters.
     * @param {import('../types').MapNode} node
     * @param {number} now
     * @param {number[]} wrapOffsets
     * @param {boolean} [forcePinned] */
    function drawHighlightRing(node, now, wrapOffsets, forcePinned) {
        if (!node.alive || !isMapNodeVisible(node)) return;
        const isPinned =
            forcePinned ||
            (interaction.pinnedNode && interaction.pinnedNode.peerId === node.peerId);
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

    /** Find ALL alive nodes within hit radius of screen coords.
     * @param {number} sx
     * @param {number} sy */
    function findNodesAtScreen(sx, sy) {
        const hitRadius = 12;
        const offsets = getWrapOffsets();
        const result = [];
        const seen = new Set();
        for (let i = mapView.nodes.length - 1; i >= 0; i--) {
            if (!mapView.nodes[i].alive) continue;
            if (!isMapNodeVisible(mapView.nodes[i])) continue;
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

    return Object.freeze({
        drawNode,
        drawConnectionLines,
        drawHighlightRing,
        findNodesAtScreen,
    });
}
