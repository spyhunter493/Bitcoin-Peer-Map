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

    function serviceFlagDescription(flag) {
        return flag.rpc ? flag.label + ' (' + flag.rpc + ')' : flag.label;
    }

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
            connectionTypes[peer.connection_type] || peer.connection_type || '\u2014'
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
        let selectedPeer = null;
        let groupPeerIds = null;
        let returnFocus = null;
        let cleanupInteraction = null;
        const closingPopups = new Set();

        function removeClosingPopups() {
            for (const closingPopup of closingPopups) {
                if (closingPopup.parentNode) closingPopup.remove();
            }
            closingPopups.clear();
        }

        function removeCurrent() {
            if (cleanupInteraction) cleanupInteraction();
            cleanupInteraction = null;
            if (popup && popup.parentNode) popup.remove();
            popup = null;
        }

        function mount(html, ariaLabel, borderColor) {
            const replacing = !!popup;
            if (!replacing) returnFocus = document.activeElement;
            removeCurrent();
            removeClosingPopups();
            popup = document.createElement('div');
            popup.className = 'peer-detail-popup';
            popup.setAttribute('role', 'dialog');
            popup.setAttribute('aria-modal', 'false');
            popup.setAttribute('aria-labelledby', 'peer-popup-title');
            popup.setAttribute('aria-label', ariaLabel);
            if (borderColor) popup.style.borderColor = borderColor;
            popup.innerHTML = html;
            document.body.appendChild(popup);
            const mountedPopup = popup;
            const animate = global.requestAnimationFrame || (callback => global.setTimeout(callback, 0));
            animate(() => {
                if (mountedPopup.isConnected) mountedPopup.classList.add('visible');
            });
            popup.addEventListener('click', event => event.stopPropagation());
            cleanupInteraction = bindPointerInteractions(popup);
            const closeButton = popup.querySelector('.peer-popup-close');
            if (closeButton) {
                closeButton.addEventListener('click', () => options.onRequestClose());
                closeButton.focus({ preventScroll: true });
            }
            return popup;
        }

        function openGroup(peerIds) {
            groupPeerIds = peerIds.slice();
            selectedPeer = null;
            const wanted = new Set(groupPeerIds);
            const peers = options.getPeers().filter(peer => wanted.has(peer.id));
            const mounted = mount(renderPeerGroup(peers), 'Peers at this location');
            mounted.querySelectorAll('.multi-peer-row').forEach(row => {
                row.addEventListener('click', () => {
                    const peerId = parseInt(row.dataset.peerId);
                    const peer = options.getPeers().find(item => item.id === peerId);
                    if (peer) options.onRequestPeer(peer, 'map-group');
                });
            });
            return mounted;
        }

        function openPeer(peer, source) {
            if (source !== 'map-group') groupPeerIds = null;
            selectedPeer = peer;
            const asNumber = distributionData.parseAsNumber(peer.as);
            const providerColor = asNumber ? options.getProviderColor(asNumber) : '#6e7681';
            const rendered = renderPeerDetails(peer, {
                providerColor,
                showBack: source === 'map-group' && !!groupPeerIds,
                connectionTypeLabels: options.connectionTypeLabels,
                serviceFlags: options.serviceFlags,
            });
            const mounted = mount(
                rendered.html,
                'Details for peer ' + peer.id,
                rendered.presentation.networkColor
            );
            const backButton = mounted.querySelector('.peer-popup-back');
            if (backButton) {
                backButton.addEventListener('click', () => {
                    options.onRequestGroup(groupPeerIds.slice());
                });
            }
            const disconnectButton = mounted.querySelector('.peer-popup-disconnect');
            if (disconnectButton) {
                disconnectButton.addEventListener('click', event => {
                    event.stopPropagation();
                    options.onDisconnect(peer.id, rendered.presentation.network);
                });
            }
            return mounted;
        }

        function previewPeer(peer) {
            if (!popup || !selectedPeer) return;
            const presentation = peerPresentation(
                peer,
                options.getProviderColor(distributionData.parseAsNumber(peer.as))
            );
            const name = popup.querySelector('.peer-popup-name');
            const address = popup.querySelector('.peer-popup-addr');
            const meta = popup.querySelector('.peer-popup-meta');
            const circle = popup.querySelector('.peer-popup-circle');
            if (!name) return;
            name.textContent = 'Peer #' + peer.id;
            name.style.color = presentation.providerColor;
            if (address) address.textContent = peer.addr || '';
            if (meta) meta.textContent = presentation.networkLabel + ' \u00b7 ' + presentation.directionLabel;
            if (circle) circle.style.background = presentation.networkColor;
            popup.classList.add('peer-popup-previewing');
        }

        function restorePreview() {
            if (!selectedPeer) return;
            previewPeer(selectedPeer);
            if (popup) popup.classList.remove('peer-popup-previewing');
        }

        function close(optionsForClose) {
            const closingPopup = popup;
            if (cleanupInteraction) cleanupInteraction();
            cleanupInteraction = null;
            popup = null;
            selectedPeer = null;
            groupPeerIds = null;
            if (closingPopup) {
                closingPopups.add(closingPopup);
                closingPopup.classList.remove('visible');
                global.setTimeout(() => {
                    if (closingPopup.parentNode) closingPopup.remove();
                    closingPopups.delete(closingPopup);
                }, 200);
            }
            if (
                (!optionsForClose || optionsForClose.restoreFocus !== false) &&
                returnFocus && returnFocus.isConnected && returnFocus.focus
            ) {
                returnFocus.focus({ preventScroll: true });
            }
            returnFocus = null;
        }

        return Object.freeze({
            openGroup,
            openPeer,
            previewPeer,
            restorePreview,
            close,
            isOpen: () => !!popup,
            getSelectedPeerId: () => selectedPeer ? selectedPeer.id : null,
        });
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

    global.BPMDistributionPeerDetail = Object.freeze({
        create,
        peerDetailRow,
        renderServiceFlagList,
        renderPeerDetails,
        renderPeerGroup,
    });
})(window);
