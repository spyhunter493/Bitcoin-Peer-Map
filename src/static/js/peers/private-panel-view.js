import { fmtPing } from '../core/ping.js';
import { query } from '../core/dom.js';
import * as BPMModal from '../core/modal.js';
import * as BPMFormat from '../core/format.js';
import BPMServiceFlags from './service-flags.js';
import * as privateData from './private-data.js';

/** Owns presentation only; bindings and snapshot data are supplied by the facade.
 * @param {import('./private-components').PanelViewOptions} options */
export function create(options) {
    const { dashboard, document, lifecycle, nowSeconds, bindings } = options;
    const privateState = options.state;
    const networkLabels = privateData.labels;
    const escapeHtml = BPMModal.escapeHtml;
    const { fmtDuration, fmtBytesShort, serviceFlagDescription } = BPMFormat;
    /** @param {string} abbreviation */
    const serviceFlagFromAbbr = abbreviation => Object.values(BPMServiceFlags).find(flag => flag.abbr === abbreviation);
    function cachePnElements() {
        if (!privateState.pnContainerEl) {
            privateState.pnContainerEl = document.getElementById('pn-container');
            privateState.pnDonutSvg = query('#pn-donut-svg', document);
            privateState.pnCenterCount = document.getElementById('pn-center-count');
            privateState.pnCenterLabel = document.getElementById('pn-center-label');
            privateState.pnCenterSub = document.getElementById('pn-center-sub');
            privateState.pnDetailPanelEl = document.getElementById('pn-detail-panel');
            privateState.pnDetailBodyEl = document.getElementById('pn-detail-body');
            privateState.pnDetailNetNameEl = document.getElementById('pn-detail-net-name');
            privateState.pnDetailMetaEl = document.getElementById('pn-detail-meta');
            privateState.pnInsightRectEl = document.getElementById('pn-insight-rect');
        }
    }

    /** @param {string} net */
    function openPnDetailPanel(net) {
        const transition = lifecycle.replace('panel-transition');
        cachePnElements();
        if (!privateState.pnDetailPanelEl || !privateState.pnDetailBodyEl) return;

        document.body.classList.add('pn-panel-open');
        privateState.pnDetailPanelEl.classList.remove('hidden');
        transition.frame(() => privateState.pnDetailPanelEl?.classList.add('visible'));

        updatePnDetailPanel(net);
    }

    function closePnDetailPanel() {
        bindings.hidePopover();
        const transition = lifecycle.replace('panel-transition');
        cachePnElements();
        if (privateState.pnDetailPanelEl) {
            privateState.pnDetailPanelEl.classList.remove('visible');
            transition.timeout(() => {
                privateState.pnDetailPanelEl?.classList.add('hidden');
                document.body.classList.remove('pn-panel-open');
            }, 350);
        }
    }

    /** @param {string} net */
    function updatePnDetailPanel(net) {
        cachePnElements();
        if (!privateState.pnDetailBodyEl) return;

        // Show back button when viewing a specific network
        const backBtn = document.getElementById('pn-detail-back');
        if (backBtn) backBtn.classList.remove('hidden');

        const rawPeers = dashboard.peers;
        const netPeers = rawPeers.filter((p) => p.network === net);
        const netLabel = networkLabels[net] || net.toUpperCase();
        const netColor = options.getColor(net);

        // Update header
        if (privateState.pnDetailNetNameEl) {
            privateState.pnDetailNetNameEl.innerHTML = '<span style="color:' + netColor + '">' + escapeHtml(netLabel) + '</span> Network';
        }
        if (privateState.pnDetailMetaEl) {
            privateState.pnDetailMetaEl.textContent = netPeers.length + ' peer' + (netPeers.length !== 1 ? 's' : '') + ' connected';
        }

        if (netPeers.length === 0) {
            privateState.pnDetailBodyEl.innerHTML = '<div class="pn-panel-empty">No ' + escapeHtml(netLabel) + ' peers connected</div>';
            return;
        }

        const { inbound, outbound, avgPing, totalBytesSent, totalBytesRecv,
            softwareMap, servicesMap, connTypeMap } = privateData.summarize(netPeers);

        let html = '';

        // ── Peers section (Overview) ──
        html += '<div class="modal-section-title">Peers</div>';
        html += pnStaticRow('Total', netPeers.length);
        html += pnStaticRow('Inbound', inbound);
        html += pnStaticRow('Outbound', outbound);

        // ── Performance ──
        html += '<div class="modal-section-title">Performance</div>';
        html += pnStaticRow('Avg Ping', fmtPing(avgPing));
        html += pnStaticRow('Bytes Sent', fmtBytesShort(totalBytesSent));
        html += pnStaticRow('Bytes Recv', fmtBytesShort(totalBytesRecv));

        // ── Connection Types (interactive) ──
        const ctEntries = Object.entries(connTypeMap).sort((a, b) => b[1].length - a[1].length);
        if (ctEntries.length > 0) {
            html += '<div class="modal-section-title">Connection Types</div>';
            for (const [ct, peers] of ctEntries) {
                /** @type {Record<string, string>} */
                const PN_CT_LABELS = {
                    'outbound-full-relay': 'Full Relay',
                    'block-relay-only': 'Block Relay',
                    manual: 'Manual',
                    'addr-fetch': 'Addr Fetch',
                    feeler: 'Feeler',
                    inbound: 'Inbound',
                };
                const ctLabel = (Object.hasOwn(PN_CT_LABELS, ct) ? PN_CT_LABELS[ct] : null) || ct;
                html += pnInteractiveRow(ctLabel, peers.length, 'conntype', ct);
            }
        }

        // ── Software (interactive) ──
        const swEntries = Object.entries(softwareMap).sort((a, b) => b[1].length - a[1].length);
        if (swEntries.length > 0) {
            html += '<div class="modal-section-title">Software</div>';
            for (const [sw, peers] of swEntries) {
                html += pnInteractiveRow(sw, peers.length, 'software');
            }
        }

        // ── Services (interactive) ──
        const svcEntries = Object.entries(servicesMap).sort((a, b) => b[1].length - a[1].length);
        if (svcEntries.length > 0) {
            html += '<div class="modal-section-title">Services</div>';
            for (const [svc, peers] of svcEntries) {
                html += pnInteractiveRow(svc, peers.length, 'services');
            }
        }

        privateState.pnDetailBodyEl.innerHTML = html;

        // Attach interactive row handlers
        bindings.detail(privateState.pnDetailBodyEl, netPeers);
    }

    /** @param {string} label
     * @param {string | number} value */
    function pnStaticRow(label, value) {
        return (
            '<div class="modal-row"><span class="modal-label">' +
            escapeHtml(label) +
            '</span><span class="modal-val">' +
            escapeHtml(value) +
            '</span></div>'
        );
    }

    /** @param {string} label
     * @param {string} category
     *
     * @param {number} count
     */
    function pnInteractiveRow(label, count, category, key = label) {
        return (
            '<button type="button" class="as-detail-sub-row pn-interactive-row" data-filter=\'' +
            escapeHtml(JSON.stringify({ kind: category, key })) +
            '\' data-category="' +
            escapeHtml(category) +
            '">' +
            '<span class="as-detail-sub-label">' +
            escapeHtml(label) +
            '</span>' +
            '<span class="as-detail-sub-val">' +
            escapeHtml(count) +
            '</span>' +
            '</button>'
        );
    }

    function openPnOverviewPanel() {
        const transition = lifecycle.replace('panel-transition');
        cachePnElements();
        if (!privateState.pnDetailPanelEl || !privateState.pnDetailBodyEl) return;

        privateState.pnSelectedNet = null; // overview = no specific net
        document.body.classList.add('pn-panel-open');
        privateState.pnDetailPanelEl.classList.remove('hidden');
        transition.frame(() => privateState.pnDetailPanelEl?.classList.add('visible'));

        updatePnOverviewPanel();
    }

    function updatePnOverviewPanel() {
        cachePnElements();
        if (!privateState.pnDetailBodyEl) return;

        const previousSearch = /** @type {HTMLInputElement | null} */ (query('#pn-overview-search', privateState.pnDetailBodyEl))?.value || '';

        // Hide back button in overview
        const backBtn = document.getElementById('pn-detail-back');
        if (backBtn) backBtn.classList.add('hidden');

        const rawPeers = dashboard.peers;
        const allPrivate = privateData.scope(rawPeers);

        // Header
        if (privateState.pnDetailNetNameEl) {
            privateState.pnDetailNetNameEl.innerHTML = '<span style="color:var(--logo-primary, #f0883e)">Private</span> Networks';
        }
        if (privateState.pnDetailMetaEl) {
            privateState.pnDetailMetaEl.textContent =
                allPrivate.length +
                ' peer' +
                (allPrivate.length !== 1 ? 's' : '') +
                ' across ' +
                privateState.pnSegments.length +
                ' network' +
                (privateState.pnSegments.length !== 1 ? 's' : '');
        }

        if (allPrivate.length === 0) {
            privateState.pnDetailBodyEl.innerHTML = '<div class="pn-panel-empty">No private peers connected</div>';
            return;
        }

        let html = '';

        // ── Search bar ──
        html +=
            '<div class="pn-search-wrap"><input type="text" class="pn-search-input" id="pn-overview-search" aria-label="Search private peers" placeholder="Search peers..." autocomplete="off" spellcheck="false"></div>';

        // ── Insights section ──
        html += '<div class="modal-section-title">Scores and Insights</div>';
        const { bestStablePeer, bestStableDur, bestPingPeer, bestPing, bestSentPeer, bestSent, bestRecvPeer, bestRecv } = privateData.insights(allPrivate, nowSeconds());

        if (bestStablePeer) {
            html +=
                '<button type="button" class="pn-insight-row" data-peer-id="' +
                bestStablePeer.id +
                '" data-insight-type="stable" data-peer-net="' +
                (bestStablePeer.network || 'onion') +
                '">';
            html += '<span class="pn-insight-icon">\u23f3</span>';
            html += '<span class="pn-insight-label">Most Stable</span>';
            html += '<span class="pn-insight-val">#' + bestStablePeer.id + ' \u2014 ' + fmtDuration(bestStableDur) + '</span>';
            html += '</button>';
        }

        // Fastest — lowest ping
        if (bestPingPeer) {
            html +=
                '<button type="button" class="pn-insight-row" data-peer-id="' +
                bestPingPeer.id +
                '" data-insight-type="fastest" data-peer-net="' +
                (bestPingPeer.network || 'onion') +
                '">';
            html += '<span class="pn-insight-icon">\u26a1</span>';
            html += '<span class="pn-insight-label">Fastest</span>';
            html += '<span class="pn-insight-val">#' + bestPingPeer.id + ' \u2014 ' + escapeHtml(fmtPing(bestPing)) + '</span>';
            html += '</button>';
        }

        // Most Bytes Sent
        if (bestSentPeer) {
            html +=
                '<button type="button" class="pn-insight-row" data-peer-id="' +
                bestSentPeer.id +
                '" data-insight-type="data-bytessent" data-peer-net="' +
                (bestSentPeer.network || 'onion') +
                '">';
            html += '<span class="pn-insight-icon">\u2b06</span>';
            html += '<span class="pn-insight-label">Most Bytes Sent</span>';
            html += '<span class="pn-insight-val">#' + bestSentPeer.id + ' \u2014 ' + fmtBytesShort(bestSent) + '</span>';
            html += '</button>';
        }

        // Most Bytes Received
        if (bestRecvPeer) {
            html +=
                '<button type="button" class="pn-insight-row" data-peer-id="' +
                bestRecvPeer.id +
                '" data-insight-type="data-bytesrecv" data-peer-net="' +
                (bestRecvPeer.network || 'onion') +
                '">';
            html += '<span class="pn-insight-icon">\u2b07</span>';
            html += '<span class="pn-insight-label">Most Bytes Recv</span>';
            html += '<span class="pn-insight-val">#' + bestRecvPeer.id + ' \u2014 ' + fmtBytesShort(bestRecv) + '</span>';
            html += '</button>';
        }

        // ── Networks breakdown (clickable to go to per-network panel) ──
        html += '<div class="modal-section-title">Networks</div>';
        for (const seg of privateState.pnSegments) {
            const filter = JSON.stringify({ kind: 'network', key: seg.net });
            html +=
                '<button type="button" class="pn-interactive-row pn-net-link-row" data-net="' +
                seg.net +
                '" data-filter=\'' +
                escapeHtml(filter) +
                '\' data-category="network">';
            html += '<span class="as-detail-sub-label">' + escapeHtml(seg.label) + '</span>';
            html += '<span class="as-detail-sub-val">' + seg.count + '</span>';
            html += '</button>';
        }

        // ── Software (combined across all private peers) ──
        const { softwareMap, servicesMap } = privateData.summarize(allPrivate);
        const swEntries = Object.entries(softwareMap).sort((a, b) => b[1].length - a[1].length);
        if (swEntries.length > 0) {
            html += '<div class="modal-section-title">Software</div>';
            for (const [sw, peers] of swEntries) {
                html += pnInteractiveRow(sw, peers.length, 'software');
            }
        }

        // ── Services ──
        const svcEntries = Object.entries(servicesMap).sort((a, b) => b[1].length - a[1].length);
        if (svcEntries.length > 0) {
            html += '<div class="modal-section-title">Services</div>';
            for (const [svc, peers] of svcEntries) {
                html += pnInteractiveRow(svc, peers.length, 'services');
            }
        }

        privateState.pnDetailBodyEl.innerHTML = html;

        bindings.overview(privateState.pnDetailBodyEl, allPrivate);
        const search = /** @type {HTMLInputElement | null} */ (query('#pn-overview-search', privateState.pnDetailBodyEl));
        if (search && previousSearch) {
            search.value = previousSearch;
            const Event = document.defaultView?.Event || globalThis.Event;
            search.dispatchEvent(new Event('input'));
        }
    }

    /** @param {number[]} peerIds
     * @param {string} label
     *
     * @param {number} totalNetPeers
     */
    function previewPnCenterText(peerIds, label, totalNetPeers) {
        cachePnElements();
        if (!privateState.pnCenterLabel || !privateState.pnCenterCount || !privateState.pnCenterSub) return;
        privateState.pnCenterPreviewLabel = label;
        privateState.pnCenterPreviewPeerIds = peerIds;
        var cnt = peerIds.length;
        privateState.pnCenterLabel.textContent = cnt + ' PEER' + (cnt !== 1 ? 'S' : '');
        privateState.pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
        privateState.pnCenterCount.textContent = label.toUpperCase();
        privateState.pnCenterCount.style.fontSize = '17px';
        privateState.pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
        privateState.pnCenterCount.style.color = '';
        var pct = totalNetPeers > 0 ? Math.round((cnt / totalNetPeers) * 100) : 0;
        privateState.pnCenterSub.innerHTML = pct + '% of anonymous<br>peers';
    }

    function restorePnCenterText() {
        cachePnElements();
        privateState.pnCenterPreviewLabel = null;
        privateState.pnCenterPreviewPeerIds = null;
        if (!privateState.pnCenterLabel || !privateState.pnCenterCount || !privateState.pnCenterSub) return;
        if (privateState.privateNetSelectedPeerId !== null) {
            privateState.pnCenterLabel.textContent =
                networkLabels[dashboard.byId.get(privateState.privateNetSelectedPeerId)?.network || ''] || 'PEER';
            privateState.pnCenterLabel.style.color = '';
            privateState.pnCenterCount.textContent = '#' + privateState.privateNetSelectedPeerId;
            privateState.pnCenterCount.style.fontSize = '22px';
            privateState.pnCenterCount.style.fontFamily = '';
            privateState.pnCenterCount.style.color = '';
            privateState.pnCenterSub.textContent =
                dashboard.byId.get(privateState.privateNetSelectedPeerId)?.direction === 'IN' ? 'inbound' : 'outbound';
        } else if (privateState.pnSelectedNet) {
            var seg = privateState.pnSegments.find(function (s) {
                return s.net === privateState.pnSelectedNet;
            });
            var netCount = seg ? seg.count : 0;
            var totalAll = privateState.pnSegments.reduce(function (s, sg) {
                return s + sg.count;
            }, 0);
            var netPct = totalAll > 0 ? Math.round((netCount / totalAll) * 100) : 0;
            privateState.pnCenterLabel.textContent = netCount + ' PEER' + (netCount !== 1 ? 'S' : '');
            privateState.pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
            privateState.pnCenterCount.textContent = (
                networkLabels[privateState.pnSelectedNet] || privateState.pnSelectedNet
            ).toUpperCase();
            privateState.pnCenterCount.style.fontSize = '22px';
            privateState.pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
            privateState.pnCenterCount.style.color = seg ? seg.color : '';
            privateState.pnCenterSub.innerHTML = netPct + '% of anonymous<br>peers';
        } else {
            var total = privateState.pnSegments.reduce(function (s, seg) {
                return s + seg.count;
            }, 0);
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

    /** @param {string} type
     *
     * @param {import('../types').PrivateInsight} data
     */
    function showPnInsightRect(type, data) {
        cachePnElements();
        if (!privateState.pnInsightRectEl) return;

        var netColor = options.getColor(data.peerNet || 'onion');

        var icon = '',
            title = '';
        if (type === 'stable') {
            icon = '\u23f3';
            title = 'Most Stable Connection';
        } else if (type === 'fastest') {
            icon = '\u26a1';
            title = 'Fastest Connection';
        } else if (type === 'data-bytessent') {
            icon = '\u2b06\ufe0f';
            title = 'Most Data Sent To';
        } else if (type === 'data-bytesrecv') {
            icon = '\u2b07\ufe0f';
            title = 'Most Data Recv By';
        }

        var networkLabel = networkLabels[data.peerNet] || data.peerNet || 'Unknown';

        var html = '';
        html += '<div class="pn-insight-rect-inner">';
        html += '<div class="pn-insight-rect-badge">Scores &amp; Insights</div>';
        html += '<button class="pn-insight-rect-close" title="Back">\u2190</button>';
        html += '<div class="pn-insight-rect-content">';
        html += '<div class="pn-insight-rect-icon">' + icon + '</div>';
        html += '<div class="pn-insight-rect-title">' + escapeHtml(title) + '</div>';
        html += '<div class="pn-insight-rect-rank" style="color:' + netColor + '">Rank #1</div>';
        html += '<div class="pn-insight-rect-network" style="color:' + netColor + '">' + escapeHtml(networkLabel) + '</div>';
        html += '<div class="pn-insight-rect-meta">Peer #' + data.peerId + '</div>';
        if (data.statText) {
            html += '<div class="pn-insight-rect-stat" style="color:' + netColor + '">' + escapeHtml(data.statText) + '</div>';
        }
        html += '</div>';
        html +=
            '<div class="pn-insight-rect-origin" style="background:' +
            netColor +
            '; border-color:' +
            netColor +
            '; box-shadow: 0 0 8px ' +
            netColor +
            '80, 0 0 16px ' +
            netColor +
            '33"></div>';
        html += '</div>';

        privateState.pnInsightRectEl.innerHTML = html;

        // Hide donut SVG and center, show rectangle
        if (privateState.pnDonutSvg) privateState.pnDonutSvg.style.opacity = '0';
        var pnDonutCenter = document.getElementById('pn-donut-center');
        if (pnDonutCenter) pnDonutCenter.style.opacity = '0';
        privateState.pnInsightRectEl.classList.add('visible');
        privateState.pnInsightRectVisible = true;
        document.body.classList.add('pn-insight-rect-active');

        bindings.insight(privateState.pnInsightRectEl);
    }

    function hidePnInsightRect() {
        cachePnElements();
        if (!privateState.pnInsightRectEl) return;
        privateState.pnInsightRectEl.classList.remove('visible');
        privateState.pnInsightRectVisible = false;
        document.body.classList.remove('pn-insight-rect-active');
        // Show donut SVG and center
        if (privateState.pnDonutSvg) privateState.pnDonutSvg.style.opacity = '';
        var pnDonutCenter = document.getElementById('pn-donut-center');
        if (pnDonutCenter) pnDonutCenter.style.opacity = '';
    }

    function getPnInsightRectOrigin() {
        if (!privateState.pnInsightRectEl || !privateState.pnInsightRectVisible) return null;
        var originDot = query('.pn-insight-rect-origin', privateState.pnInsightRectEl);
        if (originDot) {
            var rect = originDot.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
        }
        return null;
    }

    /** @param {import('../types').Peer} peer
     * @param {string} type */
    function buildPnInsightData(peer, type) {
        var nowSec = nowSeconds();
        var data = {
            peerId: peer.id,
            peerNet: peer.network || 'onion',
            statText: '',
        };
        if (type === 'stable') {
            var dur = peer.conntime > 0 ? nowSec - peer.conntime : 0;
            data.statText = fmtDuration(dur);
        } else if (type === 'fastest') {
            data.statText = fmtPing(peer.ping_ms);
        } else if (type === 'data-bytessent') {
            data.statText = fmtBytesShort(peer.bytessent || 0) + ' sent';
        } else if (type === 'data-bytesrecv') {
            data.statText = fmtBytesShort(peer.bytesrecv || 0) + ' recv';
        }
        return data;
    }

    /** @param {number[]} peerIds
     * @param {string} category
     * @param {string} label
     *
     * @param {import('../types').Peer[]} allNetPeers
     */
    function buildPnPeerListHtml(peerIds, allNetPeers, category, label) {
        const idSet = new Set(peerIds);
        const matched = allNetPeers.filter((p) => idSet.has(p.id));

        let html = '';
        // Title
        html += '<div class="pn-sub-tt-title">' + escapeHtml(label) + '</div>';

        // Service flag expansion for services category
        if (category === 'services' && label && label !== '\u2014') {
            html += '<div class="as-sub-tt-section">';
            const parts = label.split(/[\s\/]+/);
            for (const p of parts) {
                const flag = serviceFlagFromAbbr(p.trim());
                if (flag)
                    html +=
                        '<div class="as-sub-tt-flag">' + escapeHtml(p.trim()) + ' = ' + escapeHtml(serviceFlagDescription(flag)) + '</div>';
            }
            html += '</div>';
        }

        const initialShow = 6;
        html += '<div class="as-sub-tt-scroll">';
        for (let i = 0; i < matched.length; i++) {
            const p = matched[i];
            const dir = p.direction === 'IN' ? 'Inbound' : 'Outbound';
            let addr = p.addr || '';
            if (addr.length > 20) addr = addr.substring(0, 17) + '\u2026';
            const extraCls = i >= initialShow ? ' as-sub-tt-peer-extra' : '';
            const extraStyle = i >= initialShow ? ' style="display:none"' : '';
            html += '<div class="as-sub-tt-peer' + extraCls + '" data-peer-id="' + p.id + '"' + extraStyle + '>';
            html += '<button type="button" class="as-sub-tt-id pn-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</button>';
            html += '<span class="as-sub-tt-type">' + dir + '</span>';
            if (addr) html += '<span class="as-sub-tt-loc">' + escapeHtml(addr) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (matched.length > initialShow) {
            const remaining = matched.length - initialShow;
            html +=
                '<button type="button" class="as-sub-tt-more pn-sub-tt-show-more">+' +
                remaining +
                ' more <span class="as-sub-tt-toggle">(show)</span></button>';
            html +=
                '<button type="button" class="as-sub-tt-more pn-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></button>';
        }
        return html;
    }
    function dispose() {
        lifecycle.dispose();
        privateState.pnDetailPanelEl?.classList.remove('visible');
        privateState.pnDetailPanelEl?.classList.add('hidden');
        privateState.pnInsightRectEl?.classList.remove('visible');
        if (privateState.pnDonutSvg) privateState.pnDonutSvg.style.opacity = '';
        const center = document.getElementById('pn-donut-center');
        if (center) center.style.opacity = '';
        document.body.classList.remove('pn-panel-open', 'pn-insight-rect-active');
        privateState.pnDetailBodyHandlerAttached = false;
    }
    return Object.freeze({ cachePnElements, openPnDetailPanel, closePnDetailPanel, updatePnDetailPanel, pnStaticRow, pnInteractiveRow, openPnOverviewPanel, updatePnOverviewPanel, previewPnCenterText, restorePnCenterText, showPnInsightRect, hidePnInsightRect, getPnInsightRectOrigin, buildPnInsightData, buildPnPeerListHtml, dispose });
}
