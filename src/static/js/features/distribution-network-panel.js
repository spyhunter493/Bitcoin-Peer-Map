/* IPv4/IPv6 distribution-panel data preparation and rendering. */
(function (global) {
    'use strict';

    const distributionData = global.BPMDistributionData;
    const escapeHtml = global.BPMModal.escapeHtml;
    const NETWORKS = Object.freeze({
        ipv4: Object.freeze({
            key: 'ipv4',
            label: 'IPv4',
            color: 'var(--net-ipv4, #e3b341)',
        }),
        ipv6: Object.freeze({
            key: 'ipv6',
            label: 'IPv6',
            color: 'var(--net-ipv6, #f07178)',
        }),
    });

    function networkDefinition(networkKey) {
        return NETWORKS[networkKey] || NETWORKS.ipv6;
    }

    function peersForNetwork(peers, networkKey) {
        return peers.filter(peer => (peer.network || 'ipv4') === networkKey);
    }

    function computeNetworkPanelData(peers, networkKey, segments) {
        const network = networkDefinition(networkKey);
        const networkPeers = peersForNetwork(peers, networkKey);
        const inboundCount = networkPeers.filter(peer => peer.direction === 'IN').length;
        const pings = networkPeers.filter(peer => peer.ping_ms > 0).map(peer => peer.ping_ms);
        const totalBytesSent = networkPeers.reduce(
            (total, peer) => total + (peer.bytessent || 0),
            0
        );
        const totalBytesReceived = networkPeers.reduce(
            (total, peer) => total + (peer.bytesrecv || 0),
            0
        );
        const providers = distributionData.aggregateProvidersForPeers(networkPeers, segments);

        return {
            network,
            peers: networkPeers,
            peerIds: networkPeers.map(peer => peer.id),
            peerCount: networkPeers.length,
            inboundCount,
            outboundCount: networkPeers.length - inboundCount,
            averagePing: pings.length
                ? Math.round(pings.reduce((total, ping) => total + ping, 0) / pings.length)
                : null,
            totalBytesSent,
            totalBytesReceived,
            providers,
            providerCategory: {
                label: network.label + ' Connections by Provider',
                peerCount: networkPeers.length,
                providerCount: providers.length,
                peerIds: networkPeers.map(peer => peer.id),
                providers,
            },
            hosting: distributionData.aggregateSummaryHosting(networkPeers, segments),
            countries: distributionData.aggregateSummaryCountries(networkPeers, segments),
            software: distributionData.aggregateSummarySoftware(networkPeers, segments),
            services: distributionData.aggregateSummaryServices(networkPeers, segments),
        };
    }

    function renderStatRow(label, value) {
        return '<div class="modal-row"><span class="modal-label">' + escapeHtml(label) +
            '</span><span class="modal-val">' + escapeHtml(value) + '</span></div>';
    }

    function renderInteractiveRow(label, value, category) {
        const providers = (category.providers || []).map(provider => ({
            a: provider.asNumber,
            n: provider.name,
            c: provider.color,
            pc: provider.peerCount,
            pi: provider.peerIds,
        }));
        const providerData = escapeHtml(JSON.stringify(providers));
        const peerData = escapeHtml(JSON.stringify(category.peerIds || []));
        const safeLabel = escapeHtml(label);
        const safeValue = escapeHtml(value);
        return '<div class="as-detail-sub-row as-interactive-row as-summary-row" ' +
            'role="button" tabindex="0" aria-label="' + safeLabel + ': ' + safeValue + '" ' +
            'data-peer-ids="' + peerData + '" data-providers="' + providerData +
            '" data-cat-label="' + safeLabel + '">' +
            '<span class="as-detail-sub-label">' + safeLabel + '</span>' +
            '<span class="as-detail-sub-val">' + safeValue + '</span></div>';
    }

    function renderCategoryRows(categories) {
        return categories.map(category => renderInteractiveRow(
            category.label,
            category.peerCount + 'p / ' + category.providerCount + 'prov',
            category
        )).join('');
    }

    function renderNetworkPanelBody(data) {
        const label = data.network.label;
        if (!data.peerCount) {
            return '<div class="pn-panel-empty">No ' + label + ' peers connected</div>';
        }

        let html = '<div class="modal-section-title">Stats</div>';
        html += renderStatRow('Total Peers', data.peerCount);
        html += renderStatRow('Inbound', data.inboundCount);
        html += renderStatRow('Outbound', data.outboundCount);
        if (data.averagePing !== null) {
            html += renderStatRow('Avg Ping', data.averagePing + ' ms');
        }
        html += renderStatRow('Bytes Sent', distributionData.fmtBytes(data.totalBytesSent));
        html += renderStatRow('Bytes Recv', distributionData.fmtBytes(data.totalBytesReceived));

        html += '<div class="modal-section-title" title="' + label +
            ' peer connections grouped by AS provider">' + label +
            ' Connections by Provider</div>';
        html += renderInteractiveRow(
            'See providers (' + data.providers.length + ')',
            data.peerCount + 'p / ' + data.providers.length + 'prov',
            data.providerCategory
        );

        html += '<div class="modal-section-title" ' +
            'title="Peer connections grouped by hosting type">Hosting</div>';
        html += renderCategoryRows(data.hosting);

        html += '<div class="modal-section-title" title="Geographic distribution of ' + label +
            ' peers by country">Countries</div>';
        html += renderCategoryRows(data.countries);

        html += '<div class="modal-section-title" title="Bitcoin Core client versions on ' + label +
            ' peers">Software</div>';
        html += renderCategoryRows(data.software);

        html += '<div class="modal-section-title" title="Service flags on ' + label +
            ' peers">Services</div>';
        html += renderCategoryRows(data.services);
        return html;
    }

    function setPeerCount(panel, peerCount) {
        const organization = panel && panel.querySelector('.as-detail-org');
        if (organization) {
            organization.textContent = peerCount + ' peer' + (peerCount !== 1 ? 's' : '') +
                ' connected';
        }
    }

    function updateHeader(panel, data) {
        const asn = panel.querySelector('.as-detail-asn');
        const metadata = panel.querySelector('.as-detail-meta');
        const barFill = panel.querySelector('.as-detail-bar-fill');
        const percentage = panel.querySelector('.as-detail-pct');
        const risk = panel.querySelector('.as-detail-risk');

        if (asn) {
            asn.innerHTML = '<span style="color:' + data.network.color + '">' +
                data.network.label + '</span> ' +
                '<span style="color:var(--logo-primary, #4a90d9)">Network</span>';
            asn.classList.remove('as-summary-title');
        }
        setPeerCount(panel, data.peerCount);
        if (metadata) metadata.innerHTML = '';
        if (barFill) barFill.style.width = '0%';
        if (percentage) percentage.textContent = '';
        if (risk) {
            risk.className = 'as-detail-risk';
            risk.textContent = '';
        }
    }

    function showPanel(panel) {
        panel.classList.remove('hidden');
        void panel.offsetWidth;
        panel.classList.add('visible');
        document.body.classList.add('as-panel-open');
        document.body.classList.add('panel-focus-as');
        document.body.classList.remove('panel-focus-peers');
    }

    function render(options) {
        const data = computeNetworkPanelData(
            options.peers,
            options.networkKey,
            options.segments
        );
        const panel = options.panelElement;
        if (!panel) return { data, bodyElement: null };

        updateHeader(panel, data);
        const body = panel.querySelector('.as-detail-body');
        if (!body) return { data, bodyElement: null };
        body.innerHTML = renderNetworkPanelBody(data);
        if (!options.isRefresh || !data.peerCount) body.scrollTop = 0;
        showPanel(panel);
        return { data, bodyElement: body };
    }

    function refreshHeader(panel, peers, networkKey) {
        const networkPeers = peersForNetwork(peers, networkKey);
        setPeerCount(panel, networkPeers.length);
        return {
            peers: networkPeers,
            peerIds: networkPeers.map(peer => peer.id),
        };
    }

    global.BPMDistributionNetworkPanel = Object.freeze({
        networkDefinition,
        peersForNetwork,
        computeNetworkPanelData,
        renderStatRow,
        renderInteractiveRow,
        renderNetworkPanelBody,
        render,
        refreshHeader,
    });
})(window);
