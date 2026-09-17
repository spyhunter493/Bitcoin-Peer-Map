/* Floating peer-detail view used by the distribution controller. */
(function (global) {
    'use strict';

    const escapeHtml = global.BPMModal.escapeHtml;
    const distributionData = global.BPMDistributionData;
    const NETWORK_COLORS = Object.freeze({
        ipv4: 'var(--net-ipv4, #58a6ff)',
        ipv6: 'var(--net-ipv6, #3fb950)',
        onion: 'var(--net-tor, #1565c0)',
        tor: 'var(--net-tor, #1565c0)',
        i2p: 'var(--net-i2p, #d29922)',
        cjdns: 'var(--net-cjdns, #bc8cff)',
    });
    const NETWORK_LABELS = Object.freeze({
        ipv4: 'IPv4',
        ipv6: 'IPv6',
        onion: 'Tor',
        tor: 'Tor',
        i2p: 'I2P',
        cjdns: 'CJDNS',
    });

    function peerDetailRow(label, value, allowHtml) {
        const renderedValue = allowHtml ? value : escapeHtml(value);
        return '<div class="as-detail-sub-row"><span class="as-detail-sub-label">' +
            escapeHtml(label) + '</span><span class="as-detail-sub-val">' +
            renderedValue + '</span></div>';
    }

    const serviceFlagDescription = global.BPMFormat.serviceFlagDescription;

    function renderServiceFlagList(abbreviations, serviceFlags) {
        if (!abbreviations || abbreviations === '\u2014') return '\u2014';
        const definitions = Object.values(serviceFlags || {});
        let html = '<div class="service-flag-list">';
        for (const abbreviation of abbreviations.split(/\s+/)) {
            const flag = abbreviation.trim();
            if (!flag) continue;
            const details = definitions.find(definition => definition.abbr === flag);
            const label = details ? details.label : 'Unknown service flag';
            const rpc = details ? details.rpc : flag;
            const title = details ? serviceFlagDescription(details) : flag;
            html += '<div class="service-flag-row" title="' + escapeHtml(title) + '">' +
                '<span class="service-flag-abbr">' + escapeHtml(flag) + '</span>' +
                '<span class="service-flag-label">' + escapeHtml(label) + '</span>' +
                '<span class="service-flag-rpc">' + escapeHtml(rpc) + '</span></div>';
        }
        return html + '</div>';
    }

    function peerPresentation(peer, providerColor) {
        const network = (peer.network || 'ipv4').toLowerCase();
        return {
            asNumber: distributionData.parseAsNumber(peer.as),
            asOrg: distributionData.parseAsOrg(peer.as),
            providerColor: providerColor || '#6e7681',
            network,
            networkColor: NETWORK_COLORS[network] || 'var(--accent, #58a6ff)',
            networkLabel: NETWORK_LABELS[network] || network.toUpperCase(),
            directionLabel: peer.direction === 'IN' ? 'Inbound' : 'Outbound',
        };
    }

    function renderPeerDetails(peer, options) {
        const config = options || {};
        const presentation = peerPresentation(peer, config.providerColor);
        if (config.privateNetwork) presentation.providerColor = presentation.networkColor;
        const nowSeconds = config.nowSeconds == null
            ? Math.floor(Date.now() / 1000)
            : config.nowSeconds;
        const connectionTypes = config.connectionTypeLabels || {};
        const asName = presentation.asOrg || peer.asname || '';
        let html = '';
        html += '<div class="peer-popup-badge" style="border-color:' +
            presentation.networkColor + ';color:' + presentation.networkColor + '">' +
            escapeHtml(presentation.networkLabel) + '</div>';
        html += '<div class="peer-popup-header">';
        if (config.showBack) {
            html += '<button type="button" class="peer-popup-back" ' +
                'aria-label="Back to peers at this location">\u2190 List</button>';
        }
        html += '<div class="peer-popup-circle" style="background:' +
            presentation.networkColor + '"></div>';
        html += '<div class="peer-popup-title"><div class="peer-popup-name" id="peer-popup-title" style="color:' +
            presentation.providerColor + '">Peer #' + escapeHtml(peer.id) + '</div>';
        html += '<div class="peer-popup-addr">' + escapeHtml(peer.addr || '') + '</div>';
        html += '<div class="peer-popup-meta">' + escapeHtml(presentation.networkLabel) +
            ' \u00b7 ' + presentation.directionLabel + '</div></div></div>';
        html += '<div class="peer-popup-scroll">';

        html += '<div class="peer-popup-section"><div class="peer-popup-section-title">Identity</div>';
        html += peerDetailRow('Peer ID', '#' + peer.id);
        html += peerDetailRow('Address', peer.addr || '\u2014');
        html += peerDetailRow('Network', presentation.networkLabel);
        html += peerDetailRow('Direction', presentation.directionLabel);
        html += peerDetailRow(
            'Conn Type',
            (Object.hasOwn(connectionTypes, peer.connection_type) ? connectionTypes[peer.connection_type] : null) || peer.connection_type || '\u2014'
        );
        if (peer.addrlocal) html += peerDetailRow('Your Addr', peer.addrlocal);
        html += '</div>';

        html += '<div class="peer-popup-section"><div class="peer-popup-section-title">Performance</div>';
        html += peerDetailRow('Ping', peer.ping_ms ? peer.ping_ms + ' ms' : '\u2014');
        html += peerDetailRow(
            'Min Ping',
            peer.minping ? (peer.minping * 1000).toFixed(1) + ' ms' : '\u2014'
        );
        html += peerDetailRow(
            'Connected',
            peer.conntime_fmt || distributionData.fmtDuration(
                peer.conntime ? nowSeconds - peer.conntime : 0
            )
        );
        html += peerDetailRow(
            'Last Send',
            peer.lastsend ? distributionData.fmtDuration(nowSeconds - peer.lastsend) + ' ago' : '\u2014'
        );
        html += peerDetailRow(
            'Last Recv',
            peer.lastrecv ? distributionData.fmtDuration(nowSeconds - peer.lastrecv) + ' ago' : '\u2014'
        );
        html += peerDetailRow(
            'Last Block',
            peer.last_block
                ? distributionData.fmtDuration(nowSeconds - peer.last_block) + ' ago'
                : '\u2014'
        );
        html += peerDetailRow(
            'Last Tx',
            peer.last_transaction
                ? distributionData.fmtDuration(nowSeconds - peer.last_transaction) + ' ago'
                : '\u2014'
        );
        html += peerDetailRow(
            'Bytes Sent',
            peer.bytessent_fmt || distributionData.fmtBytes(peer.bytessent)
        );
        html += peerDetailRow(
            'Bytes Recv',
            peer.bytesrecv_fmt || distributionData.fmtBytes(peer.bytesrecv)
        );
        html += peerDetailRow(
            'Time Offset',
            peer.timeoffset != null
                ? (peer.timeoffset === 0 ? '0s (synced)' : peer.timeoffset + 's')
                : '\u2014'
        );
        html += '</div>';

        html += '<div class="peer-popup-section"><div class="peer-popup-section-title">Software</div>';
        html += peerDetailRow('Version', peer.subver || '\u2014');
        html += peerDetailRow('Protocol', peer.version || '\u2014');
        html += peerDetailRow(
            'Services',
            renderServiceFlagList(peer.services_abbrev || '', config.serviceFlags),
            true
        );
        html += peerDetailRow('Start Height', peer.startingheight || '\u2014');
        html += peerDetailRow('Synced Hdrs', peer.synced_headers || '\u2014');
        html += peerDetailRow('Synced Blks', peer.synced_blocks || '\u2014');
        if (peer.transport_protocol_type) {
            html += peerDetailRow(
                'Transport',
                peer.transport_protocol_type === 'v2'
                    ? 'v2 (BIP324 encrypted)'
                    : peer.transport_protocol_type
            );
        }
        if (peer.session_id) {
            html += peerDetailRow(
                'Session ID',
                '<span style="font-size:9px;word-break:break-all">' +
                    escapeHtml(peer.session_id) + '</span>',
                true
            );
        }
        if (peer.minfeefilter != null) {
            html += peerDetailRow(
                'Min Fee Filter',
                peer.minfeefilter > 0
                    ? (peer.minfeefilter * 100000000).toFixed(0) + ' sat/kvB'
                    : 'None'
            );
        }
        html += '</div>';

        if (config.privateNetwork) {
            html += '<div class="peer-popup-section"><div class="peer-popup-section-title">Privacy &amp; Status</div>';
            html += peerDetailRow('Location', '<span style="color:var(--text-muted)">Private Network</span>', true);
        } else {
        html += '<div class="peer-popup-section"><div class="peer-popup-section-title">Location</div>';
        html += peerDetailRow('Country', peer.country || '\u2014');
        html += peerDetailRow('Region', peer.regionName || '\u2014');
        html += peerDetailRow('City', peer.city || '\u2014');
        html += peerDetailRow('ISP', peer.isp || '\u2014');
        html += peerDetailRow(
            'AS',
            presentation.asNumber
                ? presentation.asNumber + ' ' + asName
                : '\u2014'
        );
        if (peer.mapped_as) html += peerDetailRow('Mapped AS', 'AS' + peer.mapped_as);
        html += '</div>';

        html += '<div class="peer-popup-section"><div class="peer-popup-section-title">Status</div>';
        }
        html += peerDetailRow(
            'Relay Txs',
            peer.relaytxes != null ? (peer.relaytxes ? 'Yes' : 'No') : '\u2014'
        );
        html += peerDetailRow('Addrman', peer.in_addrman ? 'Yes' : 'No');
        html += peerDetailRow(
            'Addr Relay',
            peer.addr_relay_enabled != null ? (peer.addr_relay_enabled ? 'Yes' : 'No') : '\u2014'
        );
        if (peer.addr_processed || peer.addr_rate_limited) {
            html += peerDetailRow(
                'Addr Stats',
                (peer.addr_processed || 0) + ' processed, ' +
                    (peer.addr_rate_limited || 0) + ' limited'
            );
        }
        const highBandwidth = [];
        if (peer.bip152_hb_from) highBandwidth.push('From: Yes');
        if (peer.bip152_hb_to) highBandwidth.push('To: Yes');
        html += peerDetailRow('BIP152 HB', highBandwidth.length ? highBandwidth.join(', ') : 'No');
        if (peer.permissions && peer.permissions.length) {
            html += peerDetailRow('Permissions', peer.permissions.join(', '));
        }
        if (peer.hosting) html += peerDetailRow('Hosting', 'Cloud/Hosting');
        if (peer.proxy) html += peerDetailRow('Proxy', 'VPN/Proxy');
        if (peer.mobile) html += peerDetailRow('Mobile', 'Mobile network');
        html += '</div></div>';

        html += '<div class="peer-popup-footer">' +
            '<button type="button" class="peer-popup-disconnect" data-peer-id="' +
            escapeHtml(peer.id) + '">\u2716 Disconnect</button>' +
            '<button type="button" class="peer-popup-close" aria-label="Close peer details">Close</button>' +
            '</div><div class="peer-popup-resize-handle"></div>';

        return { html, presentation };
    }

    function renderPeerGroup(peers) {
        let html = '<div class="peer-popup-header" style="justify-content:center">' +
            '<div class="peer-popup-title" style="text-align:center">' +
            '<div class="peer-popup-name" id="peer-popup-title">' + peers.length +
            ' Peers at This Location</div>';
        if (peers[0]) {
            const location = [peers[0].city, peers[0].regionName, peers[0].country]
                .filter(Boolean)
                .join(', ');
            if (location) html += '<div class="peer-popup-addr">' + escapeHtml(location) + '</div>';
        }
        html += '</div></div><div class="peer-popup-scroll"><div class="peer-popup-section">' +
            '<div class="peer-popup-section-title">Select a Peer</div>';
        for (const peer of peers) {
            const presentation = peerPresentation(peer, null);
            html += '<button type="button" class="as-detail-sub-row multi-peer-row" data-peer-id="' +
                escapeHtml(peer.id) + '" style="width:100%;cursor:pointer;padding:4px 0;' +
                'background:transparent;border:0;border-bottom:1px solid rgba(88,166,255,0.06);' +
                'font:inherit;text-align:left">' +
                '<span class="as-detail-sub-label" style="min-width:40px;color:' +
                presentation.networkColor + '">#' + escapeHtml(peer.id) + '</span>' +
                '<span class="as-detail-sub-val" style="flex:1">' +
                escapeHtml(peer.addr || '') + '</span>' +
                '<span class="as-detail-sub-label" style="font-size:9px;color:var(--text-muted)">' +
                escapeHtml(presentation.networkLabel) + '</span></button>';
        }
        return html + '</div></div><div class="peer-popup-footer">' +
            '<button type="button" class="peer-popup-close" style="flex:1" ' +
            'aria-label="Close peer list">Close</button></div>';
    }

    function create(options) {
        let popup = null;
        let selectedPeerId = null;
        let groupPeerIds = null;
        let source = null;
        let returnFocus = null;
        let cleanupInteraction = null;
        let openTimer = null;
        let animationFrame = null;
        const closingPopups = new Map();
        const peerFor = id => options.getPeers().find(peer => peer.id === id);

        function removeClosingPopups() {
            for (const [element, timer] of closingPopups) {
                global.clearTimeout(timer);
                element.remove();
            }
            closingPopups.clear();
        }

        function cancelPending() {
            if (openTimer !== null) global.clearTimeout(openTimer);
            if (animationFrame !== null) global.cancelAnimationFrame(animationFrame);
            openTimer = animationFrame = null;
        }

        function removeCurrent() {
            cancelPending();
            if (cleanupInteraction) cleanupInteraction();
            cleanupInteraction = null;
            if (popup) popup.remove();
            popup = null;
        }

        function mount(html, ariaLabel, borderColor) {
            if (!popup) returnFocus = document.activeElement;
            removeCurrent();
            removeClosingPopups();
            popup = document.createElement('div');
            popup.className = 'peer-detail-popup' + (options.privateNetwork ? ' pn-big-popup' : '');
            popup.setAttribute('role', 'dialog');
            popup.setAttribute('aria-modal', 'false');
            popup.setAttribute('aria-labelledby', 'peer-popup-title');
            popup.setAttribute('aria-label', ariaLabel);
            if (borderColor) popup.style.borderColor = borderColor;
            popup.innerHTML = html;
            document.body.appendChild(popup);
            const mounted = popup;
            animationFrame = global.requestAnimationFrame(() => {
                animationFrame = null;
                if (mounted.isConnected) mounted.classList.add('visible');
            });
            popup.addEventListener('click', event => {
                event.stopPropagation();
                const target = event.target.closest('button');
                if (!target) return;
                if (target.classList.contains('peer-popup-close')) options.onRequestClose();
                else if (target.classList.contains('peer-popup-back') && groupPeerIds) {
                    options.onRequestGroup(groupPeerIds.slice());
                } else if (target.classList.contains('peer-popup-disconnect')) {
                    const peer = peerFor(selectedPeerId);
                    if (peer) options.onDisconnect(peer.id, peer.network);
                } else if (target.classList.contains('multi-peer-row')) {
                    const peer = peerFor(Number(target.dataset.peerId));
                    if (peer) options.onRequestPeer(peer, 'map-group');
                }
            });
            cleanupInteraction = bindPointerInteractions(popup);
            popup.querySelector('.peer-popup-close')?.focus({ preventScroll: true });
            return popup;
        }

        function renderPeer(peer) {
            const asNumber = distributionData.parseAsNumber(peer.as);
            return renderPeerDetails(peer, {
                providerColor: options.privateNetwork ? null : options.getProviderColor(asNumber),
                privateNetwork: options.privateNetwork,
                showBack: source === 'map-group' && !!groupPeerIds,
                connectionTypeLabels: options.connectionTypeLabels,
                serviceFlags: options.serviceFlags,
            });
        }

        function openGroup(peerIds) {
            groupPeerIds = peerIds.slice();
            selectedPeerId = null;
            source = 'map-group';
            const peers = groupPeerIds.map(peerFor).filter(Boolean);
            return mount(renderPeerGroup(peers), 'Peers at this location');
        }

        function openPeer(peerId, from, delayMs = 0) {
            cancelPending();
            if (from !== 'map-group') groupPeerIds = null;
            selectedPeerId = peerId;
            source = from;
            const show = () => {
                openTimer = null;
                const peer = peerFor(selectedPeerId);
                if (!peer) { options.onRequestClose(); return null; }
                const rendered = renderPeer(peer);
                return mount(rendered.html, 'Details for peer ' + peer.id, rendered.presentation.networkColor);
            };
            if (delayMs) {
                if (popup) removeCurrent();
                openTimer = global.setTimeout(show, delayMs);
                return null;
            }
            return show();
        }

        function previewPeer(peer) {
            if (!popup || selectedPeerId === null) return;
            const presentation = peerPresentation(peer, options.privateNetwork
                ? null : options.getProviderColor(distributionData.parseAsNumber(peer.as)));
            const name = popup.querySelector('.peer-popup-name');
            if (!name) return;
            name.textContent = 'Peer #' + peer.id;
            name.style.color = options.privateNetwork ? presentation.networkColor : presentation.providerColor;
            popup.querySelector('.peer-popup-addr').textContent = peer.addr || '';
            popup.querySelector('.peer-popup-meta').textContent = presentation.networkLabel + ' \u00b7 ' + presentation.directionLabel;
            popup.querySelector('.peer-popup-circle').style.background = presentation.networkColor;
            popup.classList.add('peer-popup-previewing');
        }

        function restorePreview() {
            const peer = peerFor(selectedPeerId);
            if (peer) previewPeer(peer);
            if (popup) popup.classList.remove('peer-popup-previewing');
        }

        function update() {
            if (selectedPeerId !== null && !peerFor(selectedPeerId)) {
                options.onRequestClose();
                return false;
            }
            if (!popup) return openTimer !== null;
            let html;
            if (selectedPeerId !== null) {
                const peer = peerFor(selectedPeerId);
                html = renderPeer(peer).html;
                if (!popup.classList.contains('peer-popup-previewing')) restorePreview();
            } else {
                groupPeerIds = (groupPeerIds || []).filter(id => peerFor(id));
                if (!groupPeerIds.length) { options.onRequestClose(); return false; }
                html = renderPeerGroup(groupPeerIds.map(peerFor));
                popup.querySelector('.peer-popup-name').textContent = groupPeerIds.length + ' Peers at This Location';
            }
            // Keep the popup shell, header, focus, drag handlers, geometry and scroll.
            const template = document.createElement('template');
            template.innerHTML = html;
            const content = template.content.querySelector('.peer-popup-scroll');
            const scroll = popup.querySelector('.peer-popup-scroll');
            if (scroll.innerHTML !== content.innerHTML) {
                const top = scroll.scrollTop;
                const focusedId = document.activeElement?.dataset?.peerId;
                scroll.innerHTML = content.innerHTML;
                scroll.scrollTop = top;
                if (focusedId) scroll.querySelector(`[data-peer-id="${Number(focusedId)}"]`)?.focus({ preventScroll: true });
            }
            return true;
        }

        function close(closeOptions) {
            cancelPending();
            const closing = popup;
            if (cleanupInteraction) cleanupInteraction();
            cleanupInteraction = null;
            popup = null;
            selectedPeerId = null;
            groupPeerIds = null;
            if (closing) {
                closing.classList.remove('visible');
                const timer = global.setTimeout(() => { closing.remove(); closingPopups.delete(closing); }, 200);
                closingPopups.set(closing, timer);
            }
            if (closeOptions?.restoreFocus !== false && returnFocus?.isConnected) {
                returnFocus.focus({ preventScroll: true });
            }
            returnFocus = null;
        }

        function dispose() {
            close({ restoreFocus: false });
            removeCurrent();
            removeClosingPopups();
        }

        return Object.freeze({ openGroup, openPeer, update, close, dispose, previewPeer, restorePreview,
            isOpen: () => !!popup || openTimer !== null, getSelectedPeerId: () => selectedPeerId });
    }

    function bindPointerInteractions(popup) {
        const header = popup.querySelector('.peer-popup-header');
        const handle = popup.querySelector('.peer-popup-resize-handle');
        let stopDrag = null;
        let stopResize = null;

        if (header) {
            header.style.cursor = 'grab';
            header.addEventListener('mousedown', event => {
                if (event.target.closest('button, a, .peer-popup-back')) return;
                const startX = event.clientX;
                const startY = event.clientY;
                const rectangle = popup.getBoundingClientRect();
                const move = moveEvent => {
                    popup.style.left = rectangle.left + moveEvent.clientX - startX + 'px';
                    popup.style.top = rectangle.top + moveEvent.clientY - startY + 'px';
                    popup.style.transform = 'none';
                };
                const stop = () => {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', stop);
                    popup.classList.remove('dragging');
                    header.style.cursor = 'grab';
                    stopDrag = null;
                };
                stopDrag = stop;
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', stop);
                popup.classList.add('dragging');
                header.style.cursor = 'grabbing';
                event.preventDefault();
            });
        }

        if (handle) {
            handle.addEventListener('mousedown', event => {
                const startX = event.clientX;
                const startY = event.clientY;
                const rectangle = popup.getBoundingClientRect();
                const move = moveEvent => {
                    popup.style.width = Math.max(
                        260,
                        rectangle.width + moveEvent.clientX - startX
                    ) + 'px';
                    popup.style.maxHeight = 'none';
                    popup.style.height = Math.max(
                        200,
                        rectangle.height + moveEvent.clientY - startY
                    ) + 'px';
                };
                const stop = () => {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', stop);
                    popup.classList.remove('resizing');
                    stopResize = null;
                };
                stopResize = stop;
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', stop);
                popup.classList.add('resizing');
                event.preventDefault();
                event.stopPropagation();
            });
        }

        return () => {
            if (stopDrag) stopDrag();
            if (stopResize) stopResize();
        };
    }

    global.BPMPeerDetail = Object.freeze({
        create,
        peerDetailRow,
        renderServiceFlagList,
        renderPeerDetails,
        renderPeerGroup,
    });
})(window);
