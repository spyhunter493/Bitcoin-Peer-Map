/* Private-network peer detail popup and actions. */
(function (global) {
    'use strict';

    /** @param {import('../types').PrivatePeerDetailOptions} options
     *  @returns {import('../types').PrivatePeerDetailController} */
    function create(options) {
        const privateState = options.state;
        const sourceData = options.data;
        const actions = options.actions;

        function pnDetailHtmlRow(label, value) {
            return '<div class="as-detail-sub-row"><span class="as-detail-sub-label">' + actions.pnEsc(label) + '</span><span class="as-detail-sub-val">' + value + '</span></div>';
        }

        // Text is the default; only locally constructed markup uses the HTML helper.
        function pnDetailRow(label, value) {
            return pnDetailHtmlRow(label, actions.pnEsc(value));
        }

        function closePnBigPopup() {
            if (privateState.pnPopupTimer) { clearTimeout(privateState.pnPopupTimer); privateState.pnPopupTimer = null; }
            if (privateState.pnBigPopupEl && privateState.pnBigPopupEl.parentNode) {
                privateState.pnBigPopupEl.classList.remove('visible');
                const el = privateState.pnBigPopupEl;
                privateState.pnBigPopupEl = null;
                setTimeout(() => {
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                }, 250);
            } else {
                privateState.pnBigPopupEl = null;
            }
        }

        function closePnBigPopupSync() {
            if (privateState.pnBigPopupEl && privateState.pnBigPopupEl.parentNode) {
                privateState.pnBigPopupEl.parentNode.removeChild(privateState.pnBigPopupEl);
            }
            privateState.pnBigPopupEl = null;
        }

        function showPnBigPopup(node) {
            // Remove any existing popup immediately (no animation delay)
            closePnBigPopupSync();

            // Find raw peer data for full details
            const peer = sourceData.lastPeers.find(p => p.id === node.peerId);
            if (!peer) return;

            // Network display
            const netColorMap = {
                onion: 'var(--net-tor, #1565c0)',
                i2p:   'var(--net-i2p, #d29922)',
                cjdns: 'var(--net-cjdns, #bc8cff)',
            };
            const netLabelMap = { onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' };
            const netKey = (peer.network || 'onion').toLowerCase();
            const netColor = netColorMap[netKey] || 'var(--accent, #58a6ff)';
            const netLabel = netLabelMap[netKey] || netKey.toUpperCase();

            const nowSec = Math.floor(Date.now() / 1000);

            // Build popup HTML — same structure as AS distribution peer-detail-popup
            let html = '';
            html += `<div class="peer-popup-badge" style="border-color:${netColor};color:${netColor}">${netLabel}</div>`;
            html += '<div class="peer-popup-header">';
            html += `<div class="peer-popup-circle" style="background:${netColor}"></div>`;
            html += '<div class="peer-popup-title">';
            html += `<div class="peer-popup-name" style="color:${netColor}">Peer #${peer.id}</div>`;
            html += `<div class="peer-popup-addr">${actions.pnEsc(peer.addr || '')}</div>`;
            html += `<div class="peer-popup-meta">${netLabel} \u00b7 ${peer.direction === 'IN' ? 'Inbound' : 'Outbound'}</div>`;
            html += '</div>';
            html += '</div>';

            html += '<div class="peer-popup-scroll">';

            // Identity
            html += '<div class="peer-popup-section">';
            html += '<div class="peer-popup-section-title">Identity</div>';
            html += pnDetailRow('Peer ID', '#' + peer.id);
            html += pnDetailRow('Address', peer.addr || '\u2014');
            html += pnDetailRow('Network', netLabel);
            html += pnDetailRow('Direction', peer.direction === 'IN' ? 'Inbound' : 'Outbound');
            html += pnDetailRow('Conn Type', (Object.hasOwn(sourceData.PN_CONN_TYPE_FULL, peer.connection_type) ? sourceData.PN_CONN_TYPE_FULL[peer.connection_type] : null) || peer.connection_type || '\u2014');
            if (peer.addrlocal) html += pnDetailRow('Your Addr', peer.addrlocal);
            html += '</div>';

            // Performance
            html += '<div class="peer-popup-section">';
            html += '<div class="peer-popup-section-title">Performance</div>';
            html += pnDetailRow('Ping', peer.ping_ms ? peer.ping_ms + ' ms' : '\u2014');
            html += pnDetailRow('Min Ping', peer.minping ? (peer.minping * 1000).toFixed(1) + ' ms' : '\u2014');
            html += pnDetailRow('Connected', peer.conntime_fmt || actions.pnFmtDuration(peer.conntime ? (nowSec - peer.conntime) : 0));
            html += pnDetailRow('Last Send', peer.lastsend ? actions.pnFmtDuration(nowSec - peer.lastsend) + ' ago' : '\u2014');
            html += pnDetailRow('Last Recv', peer.lastrecv ? actions.pnFmtDuration(nowSec - peer.lastrecv) + ' ago' : '\u2014');
            html += pnDetailRow('Last Block', peer.last_block ? actions.pnFmtDuration(nowSec - peer.last_block) + ' ago' : '\u2014');
            html += pnDetailRow('Last Tx', peer.last_transaction ? actions.pnFmtDuration(nowSec - peer.last_transaction) + ' ago' : '\u2014');
            html += pnDetailRow('Bytes Sent', peer.bytessent_fmt || actions.pnFmtBytes(peer.bytessent));
            html += pnDetailRow('Bytes Recv', peer.bytesrecv_fmt || actions.pnFmtBytes(peer.bytesrecv));
            html += pnDetailRow('Time Offset', peer.timeoffset != null ? (peer.timeoffset === 0 ? '0s (synced)' : peer.timeoffset + 's') : '\u2014');
            html += '</div>';

            // Software
            html += '<div class="peer-popup-section">';
            html += '<div class="peer-popup-section-title">Software</div>';
            html += pnDetailRow('Version', peer.subver || '\u2014');
            html += pnDetailRow('Protocol', peer.version || '\u2014');
            html += pnDetailHtmlRow('Services', actions.renderServiceFlagList(peer.services_abbrev || ''));
            html += pnDetailRow('Start Height', peer.startingheight || '\u2014');
            html += pnDetailRow('Synced Hdrs', peer.synced_headers || '\u2014');
            html += pnDetailRow('Synced Blks', peer.synced_blocks || '\u2014');
            if (peer.transport_protocol_type) html += pnDetailRow('Transport', peer.transport_protocol_type === 'v2' ? 'v2 (BIP324 encrypted)' : peer.transport_protocol_type);
            if (peer.session_id) html += pnDetailHtmlRow('Session ID', '<span style="font-size:9px;word-break:break-all">' + actions.pnEsc(peer.session_id) + '</span>');
            if (peer.minfeefilter != null) html += pnDetailRow('Min Fee Filter', peer.minfeefilter > 0 ? (peer.minfeefilter * 100000000).toFixed(0) + ' sat/kvB' : 'None');
            html += '</div>';

            // Privacy / Status
            html += '<div class="peer-popup-section">';
            html += '<div class="peer-popup-section-title">Privacy & Status</div>';
            html += pnDetailHtmlRow('Location', '<span style="color:var(--text-muted)">Private Network</span>');
            html += pnDetailRow('Relay Txs', peer.relaytxes != null ? (peer.relaytxes ? 'Yes' : 'No') : '\u2014');
            html += pnDetailRow('Addrman', peer.in_addrman ? 'Yes' : 'No');
            html += pnDetailRow('Addr Relay', peer.addr_relay_enabled != null ? (peer.addr_relay_enabled ? 'Yes' : 'No') : '\u2014');
            if (peer.addr_processed || peer.addr_rate_limited) html += pnDetailRow('Addr Stats', (peer.addr_processed || 0) + ' processed, ' + (peer.addr_rate_limited || 0) + ' limited');
            const hbParts = [];
            if (peer.bip152_hb_from) hbParts.push('From: Yes');
            if (peer.bip152_hb_to) hbParts.push('To: Yes');
            html += pnDetailRow('BIP152 HB', hbParts.length > 0 ? hbParts.join(', ') : 'No');
            if (peer.permissions && peer.permissions.length > 0) html += pnDetailRow('Permissions', peer.permissions.join(', '));
            html += '</div>';

            html += '</div>'; // end peer-popup-scroll

            // Footer buttons
            html += '<div class="peer-popup-footer">';
            html += `<button class="peer-popup-disconnect" data-peer-id="${peer.id}">\u2716 Disconnect</button>`;
            html += '<button class="peer-popup-close">Close</button>';
            html += '</div>';
            html += '<div class="peer-popup-resize-handle"></div>';

            // Create DOM element
            const popup = document.createElement('div');
            popup.className = 'peer-detail-popup pn-big-popup';
            popup.style.borderColor = netColor;
            popup.innerHTML = html;
            document.body.appendChild(popup);
            privateState.pnBigPopupEl = popup;

            // Animate in
            requestAnimationFrame(() => popup.classList.add('visible'));

            // Prevent map clicks
            popup.addEventListener('click', e => e.stopPropagation());

            // Draggable header
            const header = popup.querySelector('.peer-popup-header');
            if (header) {
                header.style.cursor = 'grab';
                let isDragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
                header.addEventListener('mousedown', e => {
                    if (e.target.closest('button, a')) return;
                    isDragging = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    const rect = popup.getBoundingClientRect();
                    startLeft = rect.left;
                    startTop = rect.top;
                    popup.classList.add('dragging');
                    header.style.cursor = 'grabbing';
                    e.preventDefault();
                });
                document.addEventListener('mousemove', e => {
                    if (!isDragging) return;
                    popup.style.left = (startLeft + e.clientX - startX) + 'px';
                    popup.style.top = (startTop + e.clientY - startY) + 'px';
                    popup.style.transform = 'none';
                });
                document.addEventListener('mouseup', () => {
                    if (!isDragging) return;
                    isDragging = false;
                    popup.classList.remove('dragging');
                    header.style.cursor = 'grab';
                });
            }

            // Resizable
            const handle = popup.querySelector('.peer-popup-resize-handle');
            if (handle) {
                let isResizing = false, rStartX, rStartY, rStartW, rStartH;
                handle.addEventListener('mousedown', e => {
                    isResizing = true;
                    rStartX = e.clientX;
                    rStartY = e.clientY;
                    const r = popup.getBoundingClientRect();
                    rStartW = r.width;
                    rStartH = r.height;
                    popup.classList.add('resizing');
                    e.preventDefault();
                    e.stopPropagation();
                });
                document.addEventListener('mousemove', e => {
                    if (!isResizing) return;
                    popup.style.width = Math.max(260, rStartW + (e.clientX - rStartX)) + 'px';
                    popup.style.maxHeight = 'none';
                    popup.style.height = Math.max(200, rStartH + (e.clientY - rStartY)) + 'px';
                });
                document.addEventListener('mouseup', () => {
                    if (!isResizing) return;
                    isResizing = false;
                    popup.classList.remove('resizing');
                });
            }

            // Close button
            const closeBtn = popup.querySelector('.peer-popup-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    closePnBigPopup();
                    privateState.privateNetSelectedPeer = null;
                    privateState.privateNetLinePeer = null;
                    sourceData.highlightedPeerId = null;
                    sourceData.pinnedNode = null;
                    // In private mode, donut stays centered; otherwise return to corner
                    if (!privateState.privateNetMode && !privateState.pnSelectedNet) {
                        actions.cachePnElements();
                        if (privateState.pnContainerEl) privateState.pnContainerEl.classList.remove('pn-focused');
                    }
                    actions.updatePrivateNetUI();
                });
            }

            // Disconnect button
            const disconnBtn = popup.querySelector('.peer-popup-disconnect');
            if (disconnBtn) {
                disconnBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    const peerId = parseInt(disconnBtn.dataset.peerId);
                    if (isNaN(peerId)) return;
                    actions.showDisconnectDialog(peerId, netKey);
                });
            }
        }

        return Object.freeze({
            closePnBigPopup,
            closePnBigPopupSync,
            showPnBigPopup,
        });
    }

    global.BPMPrivatePeerDetail = Object.freeze({ create });
})(window);
