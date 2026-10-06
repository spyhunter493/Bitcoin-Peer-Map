import { fmtPing } from '../core/ping.js';
import { query, queryAll } from '../core/dom.js';
import { escapeHtml } from '../core/modal.js';
import * as domState from '../core/dom-state.js';

/** @param {import('../types').MapTooltipOptions} options */
export function create(options) {
    /** Build a tooltip row: label + value, skipping empty values
     * @param {string} label
     * @param {unknown} value */
    function ttRow(label, value) {
        if (!value && value !== 0 && value !== false) return '';
        return `<div class="tt-row"><span class="tt-label">${escapeHtml(label)}</span><span class="tt-val">${escapeHtml(value)}</span></div>`;
    }

    /** Shorten an address for compact display (e.g. group list)
     * @param {import('../types').MapNode} node */
    function shortenAddr(node) {
        const full = node.peer.addr || (node.peer.ip && node.peer.port ? `${node.peer.ip}:${node.peer.port}` : '—');
        if (full.length <= 28) return full;
        // Tor/I2P: show first 12 chars + ...
        if (full.includes('.onion') || full.includes('.b32.i2p')) {
            return full.substring(0, 12) + '...' + full.substring(full.lastIndexOf('.'));
        }
        return full.substring(0, 25) + '...';
    }

    /** Position the tooltip near cursor coordinates
     * @param {number} mx
     * @param {number} my */
    function positionTooltip(mx, my) {
        const ttWidth = 260;
        const ttPad = 16;
        let tx = mx + ttPad;
        if (tx + ttWidth > options.getWidth() - 10) {
            tx = mx - ttPad - ttWidth;
        }
        let ty = my - 10;
        options.element.style.left = Math.max(10, tx) + 'px';
        options.element.style.top = Math.max(48, ty) + 'px';
    }

    /** Display hover tooltip for a group of nodes at one map dot.
     *  Single node: shows peer details. Multiple: shows compact numbered list.
     * @param {import('../types').MapNode[]} group
     * @param {number} mx
     * @param {number} my */
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
                const netLabel = options.networkLabels[node.peer.network] || node.peer.network.toUpperCase();
                const netColor = options.rgba(node.color, 0.9);
                const addr = shortenAddr(node);
                html += `<div class="tt-row tt-group-row">`;
                html += `<span class="tt-label" style="min-width:16px">${i + 1}.</span>`;
                html += `<span class="tt-net" style="color:${netColor};min-width:36px">${escapeHtml(netLabel)}</span>`;
                html += `<span class="tt-val" style="flex:1">${escapeHtml(addr)}</span>`;
                html += `</div>`;
            });
            html += `</div>`;
        }
        options.element.innerHTML = html;
        options.element.classList.remove('hidden');
        options.element.classList.remove('pinned');
        options.element.style.pointerEvents = 'none';
        positionTooltip(mx, my);
    }

    /** Build the HTML for a single peer detail tooltip.
     *  @param {boolean} hasBackNav - show "← List" link in header
     *  @param {boolean} pinned - show disconnect button
     *
     * @param {import('../types').MapNode} node
     */
    function buildPeerDetailHtml(node, pinned, hasBackNav) {
        const netLabel = options.networkLabels[node.peer.network] || node.peer.network.toUpperCase();
        const netColor = options.rgba(node.color, 0.9);

        // Direction + connection type
        const dirLabel = node.peer.direction === 'IN' ? 'Inbound' : 'Outbound';
        const typeStr = node.peer.connection_type ? `${dirLabel} / ${node.peer.connection_type}` : dirLabel;

        // Address display
        const addrDisplay =
            node.peer.ip && node.peer.port ? `${node.peer.ip}:${node.peer.port}` : node.peer.addr || '—';

        // Location: build from parts, skip empties
        let locationParts = [];
        if (!node.isPrivate) {
            if (node.peer.city) locationParts.push(node.peer.city);
            if (node.peer.regionName) locationParts.push(node.peer.regionName);
            if (node.peer.country) locationParts.push(node.peer.country);
        }
        const locationStr =
            locationParts.length > 0
                ? escapeHtml(locationParts.join(', '))
                : '<span class="tt-muted">Private Network</span>';

        // Addrman
        const addrmanStr = node.isPrivate ? '—' : node.peer.in_addrman ? 'Yes' : 'No';

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
        html += ttRow('Ping', fmtPing(node.peer.ping_ms));
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

    /** Display pinned selection list for a multi-peer dot (clickable rows).
     * @param {import('../types').MapNode[]} group
     * @param {number} mx
     * @param {number} my */
    function showGroupSelectionList(group, mx, my, privateGroup = false) {
        let html = '';
        html += `<div class="tt-header"><span class="tt-peer-id" style="text-align:center;flex:1">${group.length} peers at this location</span><span class="tt-group-close" title="Close">\u2715</span></div>`;
        html += `<div class="tt-section tt-group-list">`;
        group.forEach((node, i) => {
            const netLabel = options.networkLabels[node.peer.network] || node.peer.network.toUpperCase();
            const netColor = options.rgba(node.color, 0.9);
            const addr = shortenAddr(node);
            html += `<div class="tt-row tt-group-row tt-group-clickable" data-peer-id="${escapeHtml(node.peerId)}">`;
            html += `<span class="tt-label" style="min-width:16px">${i + 1}.</span>`;
            html += `<span class="tt-net" style="color:${netColor};min-width:36px">${escapeHtml(netLabel)}</span>`;
            html += `<span class="tt-val" style="flex:1">${escapeHtml(addr)}</span>`;
            html += `</div>`;
        });
        html += `</div>`;

        options.element.innerHTML = html;
        options.element.classList.remove('hidden');
        options.element.classList.add('pinned');
        options.element.style.pointerEvents = 'auto';
        positionTooltip(mx, my);

        // Bind close button
        const closeBtn = query('.tt-group-close', options.element);
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                options.onCloseGroup();
            });
        }

        // Bind click on each row to drill into that peer
        queryAll('.tt-group-clickable', options.element).forEach((row) => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                options.onSelectPeer(Number(row.dataset.peerId), privateGroup);
            });
        });
    }

    /** Show a pinned single-peer detail tooltip with optional back navigation.
     *  @param {boolean} hasBackNav - if true, header shows "← List"
     *
     * @param {import('../types').MapNode} node
     * @param {number} mx
     * @param {number} my
     */
    function showPinnedPeerDetail(node, mx, my, hasBackNav) {
        options.element.innerHTML = buildPeerDetailHtml(node, true, hasBackNav);
        options.element.classList.remove('hidden');
        options.element.classList.add('pinned');
        options.element.style.pointerEvents = 'auto';
        positionTooltip(mx, my);

        // Bind disconnect button
        const dcBtn = query('.tt-disconnect', options.element);
        if (dcBtn) {
            dcBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                options.onDisconnect(parseInt(dcBtn.dataset.id || ''), dcBtn.dataset.net || '');
            });
        }

        // Bind back/exit link
        const backLink = query('.tt-back-link', options.element);
        if (backLink) {
            backLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                options.onBack(hasBackNav, mx, my);
            });
        }
    }
    function hide() {
        options.element.classList.add('hidden');
        options.element.classList.remove('pinned');
        options.element.style.pointerEvents = 'none';
    }
    /** @param {import('../types').MapNode[]} group @param {number} mx @param {number} my @param {boolean} privateGroup */
    function refreshGroup(group, mx, my, privateGroup) {
        const restore = domState.capture(options.element);
        showGroupSelectionList(group, mx, my, privateGroup);
        restore();
    }
    return Object.freeze({ showGroupHoverTooltip, showGroupSelectionList, showPinnedPeerDetail, refreshGroup, hide });
}
