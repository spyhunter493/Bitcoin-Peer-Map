/* Country/jurisdiction distribution detail panel. */
(function (global) {
    'use strict';

    const fmtBytes = global.BPMDistributionData.fmtBytes;

    function render(options) {
        const panelEl = options.panelEl;
        const seg = options.segment;
        const fullGroup = options.group;
        const allPeers = options.peers;
        const providers = options.providers;
        const view = options.summaryView;
        const CONN_TYPE_LABELS = options.connectionTypeLabels;

        var asnEl = panelEl.querySelector('.as-detail-asn');
        var orgEl = panelEl.querySelector('.as-detail-org');
        var metaEl = panelEl.querySelector('.as-detail-meta');
        var barFill = panelEl.querySelector('.as-detail-bar-fill');
        var pctEl = panelEl.querySelector('.as-detail-pct');
        var riskEl = panelEl.querySelector('.as-detail-risk');

        var titleCode = seg.isOthers ? 'Others' : (fullGroup.countryCode || fullGroup.asShort || 'Country');
        var titleName = seg.isOthers ? seg.asName : (fullGroup.countryName || fullGroup.asName || titleCode);

        if (asnEl) {
            asnEl.textContent = titleCode;
            asnEl.classList.remove('as-summary-title');
        }
        if (orgEl) orgEl.textContent = titleName;
        if (metaEl) {
            metaEl.innerHTML = '<span class="as-detail-type-badge">Jurisdiction</span>';
        }

        if (barFill) {
            barFill.style.width = seg.percentage.toFixed(1) + '%';
            barFill.style.background = seg.color;
        }
        if (pctEl) pctEl.textContent = seg.percentage.toFixed(1) + '% of geolocated peers';

        if (riskEl) {
            riskEl.className = 'as-detail-risk';
            if (seg.riskLevel !== 'low' && seg.riskLabel) {
                riskEl.classList.add('as-detail-risk-' + seg.riskLevel);
                riskEl.textContent = seg.riskLabel;
            } else {
                riskEl.textContent = '';
            }
        }

        var bodyEl = panelEl.querySelector('.as-detail-body');
        if (!bodyEl) return;

        var html = '';
        html += '<div class="modal-section-title">Summary</div>';
        html += view.row('Total Peers', seg.peerCount);
        html += view.row('Providers', providers.length);
        html += view.row('Share', seg.percentage.toFixed(1) + '%');

        if (seg.isOthers && seg._othersGroups && seg._othersGroups.length > 0) {
            html += '<div class="modal-section-title">Countries &amp; Territories</div>';
            for (var oi = 0; oi < seg._othersGroups.length; oi++) {
                var og = seg._othersGroups[oi];
                var oLabel = (og.countryCode || og.asShort || '') + '  ' + (og.countryName || og.asName || og.asNumber);
                html += view.interactiveRow(oLabel, og.peerCount + ' peer' + (og.peerCount !== 1 ? 's' : ''), og.peerIds, 'country-group');
            }
        }

        if (fullGroup.connTypesList && fullGroup.connTypesList.length > 0) {
            html += '<div class="modal-section-title">Connections</div>';
            html += view.row('Inbound', seg.isOthers ? allPeers.filter(function (p) { return p.direction === 'IN'; }).length : fullGroup.inboundCount);
            html += view.row('Outbound', seg.isOthers ? allPeers.filter(function (p) { return p.direction !== 'IN'; }).length : fullGroup.outboundCount);
            for (var cti = 0; cti < fullGroup.connTypesList.length; cti++) {
                var ctItem = fullGroup.connTypesList[cti];
                var ctLabel = (Object.hasOwn(CONN_TYPE_LABELS, ctItem.type) ? CONN_TYPE_LABELS[ctItem.type] : null) || ctItem.type;
                html += view.interactiveRow(ctLabel, ctItem.count, ctItem.peers.map(function (p) { return p.id; }), 'conntype');
            }
        }

        html += '<div class="modal-section-title">Performance</div>';
        html += view.row('Avg Duration', fullGroup.avgDurationFmt || '\u2014');
        html += view.row('Avg Ping', fullGroup.avgPingMs > 0 ? Math.round(fullGroup.avgPingMs) + 'ms' : '\u2014');
        html += view.row('Data Sent', fullGroup.totalBytesSentFmt || fmtBytes(0));
        html += view.row('Data Recv', fullGroup.totalBytesRecvFmt || fmtBytes(0));

        if (providers.length > 0) {
            html += '<div class="modal-section-title">Providers</div>';
            for (var pi = 0; pi < providers.length; pi++) {
                var prov = providers[pi];
                var pName = prov.name;
                if (pName.length > 24) pName = pName.substring(0, 23) + '\u2026';
                html += view.interactiveRow(prov.asNumber + ' \u00b7 ' + pName, prov.peerCount + ' peer' + (prov.peerCount !== 1 ? 's' : ''), prov.peerIds, 'country-provider');
            }
        }

        if (fullGroup.versions && fullGroup.versions.length > 0) {
            html += '<div class="modal-section-title">Software</div>';
            for (var vi = 0; vi < fullGroup.versions.length; vi++) {
                html += view.interactiveRow(fullGroup.versions[vi].subver, fullGroup.versions[vi].count + ' peer' + (fullGroup.versions[vi].count !== 1 ? 's' : ''), fullGroup.versions[vi].peers.map(function (p) { return p.id; }), 'software');
            }
        }

        if (fullGroup.servicesCombos && fullGroup.servicesCombos.length > 0) {
            html += '<div class="modal-section-title">Services</div>';
            for (var si = 0; si < fullGroup.servicesCombos.length; si++) {
                html += view.interactiveRow(fullGroup.servicesCombos[si].abbrev, fullGroup.servicesCombos[si].count + ' peer' + (fullGroup.servicesCombos[si].count !== 1 ? 's' : ''), fullGroup.servicesCombos[si].peers.map(function (p) { return p.id; }), 'services');
            }
        }

        bodyEl.innerHTML = html;
        bodyEl.scrollTop = 0;
        options.attachInteractiveRowHandlers(bodyEl, seg);
        options.attachPanelBlankClickHandler(bodyEl);
        return true;
    }

    global.BPMDistributionCountryPanel = Object.freeze({ render });
})(window);
