import { queryAll, query, required } from '../core/dom.js';
import { dashboard as BPMDashboard } from '../core/dashboard-state.js';
import * as BPMModal from '../core/modal.js';
import * as BPMFormat from '../core/format.js';
import BPMServiceFlags from './service-flags.js';
import * as BPMPeerFilters from './filters.js';
import * as BPMDomState from '../core/dom-state.js';
/** @param {import('../types').PrivatePanelOptions} options
 *  @returns {import('../types').PrivatePanelController} */
function create(options) {
    const privateState = options.state;
    const dashboard = BPMDashboard;
    const preview = {
        peerIds: /** @type {number[] | null} */ (null),
        label: /** @type {string | null} */ (null),
        centerPeerIds: /** @type {number[] | null} */ (null),
    };
    const privateNetworks = new Set(['onion', 'i2p', 'cjdns']);
    /** @type {Record<string, string>} */
    const networkLabels = { onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' };
    const escapeHtml = BPMModal.escapeHtml;
    const { fmtDuration, serviceFlagDescription } = BPMFormat;
    /** @param {string} abbreviation */
    const serviceFlagFromAbbr = (abbreviation) => Object.values(BPMServiceFlags).find((flag) => flag.abbr === abbreviation);
    function cachePnElements() {
        if (!privateState.pnContainerEl) {
            privateState.pnContainerEl = document.getElementById('pn-container');
            privateState.pnDonutSvg = query('#pn-donut-svg');
            privateState.pnCenterCount = document.getElementById('pn-center-count');
            privateState.pnCenterLabel = document.getElementById('pn-center-label');
            privateState.pnCenterSub = document.getElementById('pn-center-sub');
            privateState.pnDetailPanelEl = document.getElementById('pn-detail-panel');
            privateState.pnDetailBodyEl = document.getElementById('pn-detail-body');
            privateState.pnDetailNetNameEl = document.getElementById('pn-detail-net-name');
            privateState.pnDetailMetaEl = document.getElementById('pn-detail-meta');
            privateState.pnInsightRectEl = document.getElementById('pn-insight-rect');
        }
        // Attach blank-space click handler once on pnDetailBodyEl (dismiss sub-tooltips)
        if (privateState.pnDetailBodyEl && !privateState.pnDetailBodyHandlerAttached) {
            privateState.pnDetailBodyHandlerAttached = true;
            privateState.pnDetailBodyEl.addEventListener('click', (e) => {
                if (!(e.target instanceof Element)) return;
                if (
                    e.target === privateState.pnDetailBodyEl ||
                    e.target.classList.contains('modal-section-title') ||
                    e.target.classList.contains('modal-row') ||
                    e.target.classList.contains('modal-label') ||
                    e.target.classList.contains('modal-val')
                ) {
                    if (privateState.pnSubTooltipPinned) {
                        hidePnSubTooltip();
                        queryAll('.pn-sub-filter-active', privateState.pnDetailBodyEl).forEach((r) =>
                            r.classList.remove('pn-sub-filter-active')
                        );
                    }
                }
            });
        }
    }

    /** @param {string} net */
    function openPnDetailPanel(net) {
        cachePnElements();
        if (!privateState.pnDetailPanelEl || !privateState.pnDetailBodyEl) return;

        document.body.classList.add('pn-panel-open');
        privateState.pnDetailPanelEl.classList.remove('hidden');
        requestAnimationFrame(() => privateState.pnDetailPanelEl?.classList.add('visible'));

        updatePnDetailPanel(net);
    }

    function closePnDetailPanel() {
        hidePnSubTooltip();
        cachePnElements();
        if (privateState.pnDetailPanelEl) {
            privateState.pnDetailPanelEl.classList.remove('visible');
            setTimeout(() => {
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

        const rawPeers = BPMDashboard.peers;
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

        // Calculate stats
        let inbound = 0,
            outbound = 0,
            totalPing = 0,
            pingCount = 0;
        let totalBytesSent = 0,
            totalBytesRecv = 0;
        /** @type {Record<string, import('../types').Peer[]>} */
        const softwareMap = Object.create(null);
        /** @type {Record<string, import('../types').Peer[]>} */
        const servicesMap = Object.create(null);
        /** @type {Record<string, import('../types').Peer[]>} */
        const connTypeMap = Object.create(null);

        for (const p of netPeers) {
            if (p.direction === 'IN') inbound++;
            else outbound++;
            if (p.ping_ms > 0) {
                totalPing += p.ping_ms;
                pingCount++;
            }
            totalBytesSent += p.bytessent || 0;
            totalBytesRecv += p.bytesrecv || 0;
            const sw = p.subver || 'Unknown';
            softwareMap[sw] = softwareMap[sw] || [];
            softwareMap[sw].push(p);
            const svc = p.services_abbrev || '\u2014';
            servicesMap[svc] = servicesMap[svc] || [];
            servicesMap[svc].push(p);
            const ct = p.connection_type || 'unknown';
            connTypeMap[ct] = connTypeMap[ct] || [];
            connTypeMap[ct].push(p);
        }

        const avgPing = pingCount > 0 ? Math.round(totalPing / pingCount) : null;

        let html = '';

        // ── Peers section (Overview) ──
        html += '<div class="modal-section-title">Peers</div>';
        html += pnStaticRow('Total', netPeers.length);
        html += pnStaticRow('Inbound', inbound);
        html += pnStaticRow('Outbound', outbound);

        // ── Performance ──
        html += '<div class="modal-section-title">Performance</div>';
        if (avgPing !== null) html += pnStaticRow('Avg Ping', avgPing + ' ms');
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
        attachPnInteractiveRowHandlers(privateState.pnDetailBodyEl, netPeers);
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
            '<div class="as-detail-sub-row pn-interactive-row" data-filter=\'' +
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
            '</div>'
        );
    }

    function openPnOverviewPanel() {
        cachePnElements();
        if (!privateState.pnDetailPanelEl || !privateState.pnDetailBodyEl) return;

        privateState.pnSelectedNet = null; // overview = no specific net
        document.body.classList.add('pn-panel-open');
        privateState.pnDetailPanelEl.classList.remove('hidden');
        requestAnimationFrame(() => privateState.pnDetailPanelEl?.classList.add('visible'));

        updatePnOverviewPanel();
    }

    function updatePnOverviewPanel() {
        cachePnElements();
        if (!privateState.pnDetailBodyEl) return;

        // Hide back button in overview
        const backBtn = document.getElementById('pn-detail-back');
        if (backBtn) backBtn.classList.add('hidden');

        const rawPeers = BPMDashboard.peers;
        const allPrivate = rawPeers.filter((p) => privateNetworks.has(p.network));

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
            '<div class="pn-search-wrap"><input type="text" class="pn-search-input" id="pn-overview-search" placeholder="Search peers..." autocomplete="off" spellcheck="false"></div>';

        // ── Insights section ──
        html += '<div class="modal-section-title">Scores and Insights</div>';
        const nowSec = Math.floor(Date.now() / 1000);

        // Most Stable — longest average connection
        let bestStablePeer = null,
            bestStableDur = 0;
        for (const p of allPrivate) {
            if (p.conntime > 0) {
                const dur = nowSec - p.conntime;
                if (dur > bestStableDur) {
                    bestStableDur = dur;
                    bestStablePeer = p;
                }
            }
        }
        if (bestStablePeer) {
            html +=
                '<div class="pn-insight-row" data-peer-id="' +
                bestStablePeer.id +
                '" data-insight-type="stable" data-peer-net="' +
                (bestStablePeer.network || 'onion') +
                '">';
            html += '<span class="pn-insight-icon">\u23f3</span>';
            html += '<span class="pn-insight-label">Most Stable</span>';
            html += '<span class="pn-insight-val">#' + bestStablePeer.id + ' \u2014 ' + fmtDuration(bestStableDur) + '</span>';
            html += '</div>';
        }

        // Fastest — lowest ping
        let bestPingPeer = null,
            bestPing = Infinity;
        for (const p of allPrivate) {
            if (p.ping_ms > 0 && p.ping_ms < bestPing) {
                bestPing = p.ping_ms;
                bestPingPeer = p;
            }
        }
        if (bestPingPeer) {
            html +=
                '<div class="pn-insight-row" data-peer-id="' +
                bestPingPeer.id +
                '" data-insight-type="fastest" data-peer-net="' +
                (bestPingPeer.network || 'onion') +
                '">';
            html += '<span class="pn-insight-icon">\u26a1</span>';
            html += '<span class="pn-insight-label">Fastest</span>';
            html += '<span class="pn-insight-val">#' + bestPingPeer.id + ' \u2014 ' + bestPing.toFixed(1) + ' ms</span>';
            html += '</div>';
        }

        // Most Bytes Sent
        let bestSentPeer = null,
            bestSent = 0;
        for (const p of allPrivate) {
            if ((p.bytessent || 0) > bestSent) {
                bestSent = p.bytessent;
                bestSentPeer = p;
            }
        }
        if (bestSentPeer) {
            html +=
                '<div class="pn-insight-row" data-peer-id="' +
                bestSentPeer.id +
                '" data-insight-type="data-bytessent" data-peer-net="' +
                (bestSentPeer.network || 'onion') +
                '">';
            html += '<span class="pn-insight-icon">\u2b06</span>';
            html += '<span class="pn-insight-label">Most Bytes Sent</span>';
            html += '<span class="pn-insight-val">#' + bestSentPeer.id + ' \u2014 ' + fmtBytesShort(bestSent) + '</span>';
            html += '</div>';
        }

        // Most Bytes Received
        let bestRecvPeer = null,
            bestRecv = 0;
        for (const p of allPrivate) {
            if ((p.bytesrecv || 0) > bestRecv) {
                bestRecv = p.bytesrecv;
                bestRecvPeer = p;
            }
        }
        if (bestRecvPeer) {
            html +=
                '<div class="pn-insight-row" data-peer-id="' +
                bestRecvPeer.id +
                '" data-insight-type="data-bytesrecv" data-peer-net="' +
                (bestRecvPeer.network || 'onion') +
                '">';
            html += '<span class="pn-insight-icon">\u2b07</span>';
            html += '<span class="pn-insight-label">Most Bytes Recv</span>';
            html += '<span class="pn-insight-val">#' + bestRecvPeer.id + ' \u2014 ' + fmtBytesShort(bestRecv) + '</span>';
            html += '</div>';
        }

        // ── Networks breakdown (clickable to go to per-network panel) ──
        html += '<div class="modal-section-title">Networks</div>';
        for (const seg of privateState.pnSegments) {
            const filter = JSON.stringify({ kind: 'network', key: seg.net });
            html +=
                '<div class="pn-interactive-row pn-net-link-row" data-net="' +
                seg.net +
                '" data-filter=\'' +
                escapeHtml(filter) +
                '\' data-category="network">';
            html += '<span class="as-detail-sub-label">' + escapeHtml(seg.label) + '</span>';
            html += '<span class="as-detail-sub-val">' + seg.count + '</span>';
            html += '</div>';
        }

        // ── Software (combined across all private peers) ──
        /** @type {Record<string, import('../types').Peer[]>} */
        const softwareMap = Object.create(null);
        for (const p of allPrivate) {
            const sw = p.subver || 'Unknown';
            softwareMap[sw] = softwareMap[sw] || [];
            softwareMap[sw].push(p);
        }
        const swEntries = Object.entries(softwareMap).sort((a, b) => b[1].length - a[1].length);
        if (swEntries.length > 0) {
            html += '<div class="modal-section-title">Software</div>';
            for (const [sw, peers] of swEntries) {
                html += pnInteractiveRow(sw, peers.length, 'software');
            }
        }

        // ── Services ──
        /** @type {Record<string, import('../types').Peer[]>} */
        const servicesMap = Object.create(null);
        for (const p of allPrivate) {
            const svc = p.services_abbrev || '\u2014';
            servicesMap[svc] = servicesMap[svc] || [];
            servicesMap[svc].push(p);
        }
        const svcEntries = Object.entries(servicesMap).sort((a, b) => b[1].length - a[1].length);
        if (svcEntries.length > 0) {
            html += '<div class="modal-section-title">Services</div>';
            for (const [svc, peers] of svcEntries) {
                html += pnInteractiveRow(svc, peers.length, 'services');
            }
        }

        privateState.pnDetailBodyEl.innerHTML = html;

        // Attach interactive row handlers
        attachPnInteractiveRowHandlers(privateState.pnDetailBodyEl, allPrivate);

        // Network link rows — click to navigate to per-network panel
        // Network link rows: handled by generic pn-interactive-row handler
        // (shows submenu with peers in that network on hover/click)

        // Insight rows — hover to preview in rectangle, click to select/pin
        queryAll('.pn-insight-row', privateState.pnDetailBodyEl).forEach((row) => {
            row.addEventListener('mouseenter', () => {
                if (privateState.pnInsightActiveType) return; // Don't override a pinned selection
                if (privateState.pnSubTooltipPinned) return; // Don't preview when sub-tooltip is open
                const peerId = parseInt(row.dataset.peerId || '');
                const insightType = row.dataset.insightType;
                if (!peerId || !insightType) return;

                // Find the peer in current data
                const rawPeers = BPMDashboard.peers.filter((peer) => privateNetworks.has(peer.network));
                const peer = rawPeers.find((p) => p.id === peerId);
                if (!peer) return;

                row.classList.add('pn-insight-hover');

                // Preview: show rectangle, draw line to this peer
                var data = buildPnInsightData(peer, insightType);
                showPnInsightRect(insightType, data);
                privateState.pnPreviewPeerIds = [peerId];
                privateState.privateNetLinePeer = peerId;
            });

            row.addEventListener('mouseleave', () => {
                if (privateState.pnInsightActiveType) return; // Don't dismiss if pinned
                if (privateState.pnSubTooltipPinned) return; // Was suppressed on enter
                row.classList.remove('pn-insight-hover');
                hidePnInsightRect();
                privateState.pnPreviewPeerIds = null;
                privateState.privateNetLinePeer = null;
            });

            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const peerId = parseInt(row.dataset.peerId || '');
                const insightType = row.dataset.insightType;
                if (!peerId || !insightType) return;

                // If clicking the already-active insight, deselect
                if (privateState.pnInsightActiveType === insightType && privateState.pnInsightActivePeerId === peerId) {
                    hidePnInsightRect();
                    clearPnInsightState();
                    return;
                }

                // Find the peer in current data
                const rawPeers = BPMDashboard.peers.filter((peer) => privateNetworks.has(peer.network));
                const peer = rawPeers.find((p) => p.id === peerId);
                if (!peer) return;

                // Clear any previous active
                queryAll('.pn-insight-row', privateState.pnDetailBodyEl).forEach((r) => {
                    r.classList.remove('pn-insight-active', 'pn-insight-hover');
                });

                // Pin this insight
                privateState.pnInsightActiveType = insightType;
                privateState.pnInsightActivePeerId = peerId;
                privateState.pnInsightActiveData = buildPnInsightData(peer, insightType);
                row.classList.add('pn-insight-active');

                // Show rectangle and set line
                showPnInsightRect(insightType, privateState.pnInsightActiveData);
                privateState.privateNetLinePeer = peerId;
                privateState.pnPreviewPeerIds = [peerId];

                // Select the peer (zoom to it, etc.)
                options.onAction({ type: 'select', peerId });
            });
        });

        // Search — filter all rows as user types
        /** @type {HTMLInputElement | null} */
        const searchInput = query('#pn-overview-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const q = searchInput.value.toLowerCase().trim();
                queryAll('.pn-interactive-row, .pn-insight-row, .pn-net-link-row', privateState.pnDetailBodyEl).forEach((row) => {
                    if (!q) {
                        row.style.display = '';
                    } else {
                        const text = row.textContent.toLowerCase();
                        row.style.display = text.includes(q) ? '' : 'none';
                    }
                });
            });
        }
    }

    function privateScope() {
        return BPMDashboard.peers.filter(
            (peer) => privateNetworks.has(peer.network) && (!privateState.pnSelectedNet || peer.network === privateState.pnSelectedNet)
        );
    }

    /**
     * @param {HTMLElement} rowEl
     */
    function parsePnPeerIds(rowEl) {
        const filter = JSON.parse(rowEl.dataset.filter || 'null');
        return BPMPeerFilters.resolve(privateScope(), filter).map((peer) => peer.id);
    }

    /** @param {HTMLElement} bodyEl
     *
     * @param {import('../types').Peer[]} allNetPeers
     */
    function attachPnInteractiveRowHandlers(bodyEl, allNetPeers) {
        queryAll('.pn-interactive-row', bodyEl).forEach((rowEl) => {
            rowEl.addEventListener('mouseenter', (e) => {
                if (privateState.pnSubTooltipPinned) return;
                if (privateState.pnInsightActiveType) return; // Don't preview when insight is selected
                const peerIds = parsePnPeerIds(rowEl);
                const category = rowEl.dataset.category || '';
                const label = required('.as-detail-sub-label', rowEl).textContent;
                const html = buildPnPeerListHtml(peerIds, allNetPeers, category, label);
                showPnSubTooltip(html, e);
                // Preview lines to these peers
                privateState.pnPreviewPeerIds = peerIds;
                // Preview category info in PN donut center
                previewPnCenterText(peerIds, label, allNetPeers.length);
            });
            rowEl.addEventListener('mousemove', (e) => {
                if (!privateState.pnSubTooltipPinned) positionPnSubTooltip(e);
            });
            rowEl.addEventListener('mouseleave', () => {
                if (privateState.pnSubTooltipPinned) return;
                if (privateState.pnInsightActiveType) return; // Was suppressed on enter
                hidePnSubTooltip();
                privateState.pnPreviewPeerIds = null;
                // Restore PN donut center to its previous state
                restorePnCenterText();
            });
            rowEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const peerIds = parsePnPeerIds(rowEl);
                const category = rowEl.dataset.category || '';
                const label = required('.as-detail-sub-label', rowEl).textContent;

                // Dismiss insight rect if switching to a non-insight selection
                if (privateState.pnInsightRectVisible) {
                    hidePnInsightRect();
                    clearPnInsightState();
                }

                // Toggle: clicking same row unpins
                if (privateState.pnSubTooltipPinned && privateState.pnPinnedSubSrc === rowEl) {
                    hidePnSubTooltip();
                    rowEl.classList.remove('pn-sub-filter-active');
                    privateState.pnPreviewPeerIds = null; // Unlock lines
                    // Restore PN donut center
                    restorePnCenterText();
                    return;
                }

                // Remove active from previous
                queryAll('.pn-sub-filter-active', bodyEl).forEach((r) => r.classList.remove('pn-sub-filter-active'));
                rowEl.classList.add('pn-sub-filter-active');

                const html = buildPnPeerListHtml(peerIds, allNetPeers, category, label);
                showPnSubTooltip(html, e);
                pinPnSubTooltip(html, rowEl);
                // Lock preview lines to this row's peers
                privateState.pnPreviewPeerIds = peerIds;
                // Show category info in PN donut center (stays while pinned)
                previewPnCenterText(peerIds, label, allNetPeers.length);
            });
        });
    }

    // The pinned descriptor remains selected even when its membership becomes empty.
    function refreshPinnedPreview() {
        const pinned = privateState.pnFilter;
        if (!privateState.pnSubTooltipPinned || !pinned || !privateState.pnDetailBodyEl) return;
        const allNetPeers = privateScope();
        const peerIds = BPMPeerFilters.resolve(allNetPeers, pinned.filter).map((peer) => peer.id);
        const row = Array.from(queryAll('.pn-interactive-row', privateState.pnDetailBodyEl)).find(
            (candidate) => candidate.dataset.filter === JSON.stringify(pinned.filter)
        );
        const tip = document.getElementById('pn-sub-tooltip');
        const restore = BPMDomState.capture(tip);
        if (!tip) return;
        const rect = tip.getBoundingClientRect();
        preview.peerIds = null;
        preview.label = null;
        preview.centerPeerIds = null;
        showPnSubTooltip(buildPnPeerListHtml(peerIds, allNetPeers, pinned.filter.kind, pinned.label), {
            clientY: rect.top + rect.height / 2,
        });
        privateState.pnPinnedSubSrc = row || null;
        row?.classList.add('pn-sub-filter-active');
        privateState.pnPreviewPeerIds = peerIds;
        previewPnCenterText(peerIds, pinned.label, allNetPeers.length);
        restore();
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
                networkLabels[BPMDashboard.byId.get(privateState.privateNetSelectedPeerId)?.network || ''] || 'PEER';
            privateState.pnCenterLabel.style.color = '';
            privateState.pnCenterCount.textContent = '#' + privateState.privateNetSelectedPeerId;
            privateState.pnCenterCount.style.fontSize = '22px';
            privateState.pnCenterCount.style.fontFamily = '';
            privateState.pnCenterCount.style.color = '';
            privateState.pnCenterSub.textContent =
                BPMDashboard.byId.get(privateState.privateNetSelectedPeerId)?.direction === 'IN' ? 'inbound' : 'outbound';
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

        // Bind close button
        var closeBtn = query('.pn-insight-rect-close', privateState.pnInsightRectEl);
        if (closeBtn) {
            closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                hidePnInsightRect();
                clearPnInsightState();
            });
        }
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

    function clearPnInsightState() {
        privateState.pnInsightActiveType = null;
        privateState.pnInsightActivePeerId = null;
        privateState.pnInsightActiveData = null;
        privateState.privateNetLinePeer = null;
        privateState.privateNetSelectedPeerId = null;
        privateState.pnPreviewPeerIds = null;
        // Remove active class from insight rows
        if (privateState.pnDetailBodyEl) {
            queryAll('.pn-insight-row', privateState.pnDetailBodyEl).forEach(function (r) {
                r.classList.remove('pn-insight-active', 'pn-insight-hover');
            });
        }
        options.onAction({ type: 'redraw' });
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
        var nowSec = Math.floor(Date.now() / 1000);
        var data = {
            peerId: peer.id,
            peerNet: peer.network || 'onion',
            statText: '',
        };
        if (type === 'stable') {
            var dur = peer.conntime > 0 ? nowSec - peer.conntime : 0;
            data.statText = fmtDuration(dur);
        } else if (type === 'fastest') {
            data.statText = peer.ping_ms > 0 ? peer.ping_ms.toFixed(1) + ' ms' : '\u2014';
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
            html += '<span class="as-sub-tt-id pn-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + dir + '</span>';
            if (addr) html += '<span class="as-sub-tt-loc">' + escapeHtml(addr) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (matched.length > initialShow) {
            const remaining = matched.length - initialShow;
            html +=
                '<div class="as-sub-tt-more pn-sub-tt-show-more">+' +
                remaining +
                ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html +=
                '<div class="as-sub-tt-more pn-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    /** @param {string} html
     * @param {{clientY: number}} event */
    function showPnSubTooltip(html, event) {
        let tip = document.getElementById('pn-sub-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'pn-sub-tooltip';
            tip.className = 'as-sub-tooltip pn-sub-tooltip';
            document.body.appendChild(tip);
        }
        tip.innerHTML = html;
        tip.classList.remove('hidden');
        tip.style.display = '';
        positionPnSubTooltip(event);
        attachPnSubTooltipHandlers(tip);
    }

    /** @param {{clientY: number}} event */
    function positionPnSubTooltip(event) {
        const tip = document.getElementById('pn-sub-tooltip');
        if (!tip) return;
        const rect = tip.getBoundingClientRect();
        const pad = 12;
        const panelRect = privateState.pnDetailPanelEl ? privateState.pnDetailPanelEl.getBoundingClientRect() : { left: window.innerWidth };
        let x = panelRect.left - rect.width - pad;
        if (x < pad) x = pad;
        let y = event.clientY - rect.height / 2;
        if (y < pad) y = pad;
        if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    }

    function hidePnSubTooltip() {
        const tip = document.getElementById('pn-sub-tooltip');
        if (tip) {
            // Clear saved preview state BEFORE hiding, so deferred mouseleave
            // events (triggered by display:none) can't restore stale peer IDs
            // or stale donut center text (category label/peerIds)
            preview.peerIds = null;
            preview.label = null;
            preview.centerPeerIds = null;
            tip.classList.add('hidden');
            tip.style.display = 'none';
            tip.style.pointerEvents = 'none';
        }
        privateState.pnSubTooltipPinned = false;
        privateState.pnFilter = null;
        privateState.pnPinnedSubSrc = null;
        privateState.pnPreviewPeerIds = null;
        // Clear PN center preview state so stale category text doesn't persist
        // across refreshes when the tooltip is dismissed without restorePnCenterText()
        privateState.pnCenterPreviewLabel = null;
        privateState.pnCenterPreviewPeerIds = null;
        options.onAction({ type: 'table' });
    }

    /** @param {string} html
     * @param {HTMLElement} srcEl */
    function pinPnSubTooltip(html, srcEl) {
        privateState.pnSubTooltipPinned = true;
        privateState.pnPinnedSubSrc = srcEl || null;
        if (srcEl)
            privateState.pnFilter = {
                filter: JSON.parse(srcEl.dataset.filter || 'null'),
                label: required('.as-detail-sub-label', srcEl).textContent,
            };
        const tip = document.getElementById('pn-sub-tooltip');
        if (tip) tip.style.pointerEvents = 'auto';
        options.onAction({ type: 'table' });
    }

    /** @param {HTMLElement} tip */
    function attachPnSubTooltipHandlers(tip) {
        // Peer ID click → select that peer on the map
        queryAll('.pn-sub-tt-id-link', tip).forEach((link) => {
            link.addEventListener('click', (e) => {
                e.stopPropagation();
                const peerId = parseInt(link.dataset.peerId || '');
                if (isNaN(peerId)) return;
                options.onAction({ type: 'select', peerId });
            });
        });

        // Peer row hover → preview individual peer line + donut center
        queryAll('.as-sub-tt-peer[data-peer-id]', tip).forEach((row) => {
            row.addEventListener('mouseenter', () => {
                const peerId = parseInt(row.dataset.peerId || '');
                if (!isNaN(peerId)) {
                    options.onAction({ type: 'highlight', peerId });
                    // Save current preview (from parent row hover) and show single peer
                    if (!preview.peerIds) preview.peerIds = privateState.pnPreviewPeerIds;
                    if (!preview.label) preview.label = privateState.pnCenterPreviewLabel;
                    if (!preview.centerPeerIds) preview.centerPeerIds = privateState.pnCenterPreviewPeerIds;
                    privateState.pnPreviewPeerIds = [peerId];
                    // Preview this peer's info in the PN donut center
                    const peer = dashboard.peers.find((p) => p.id === peerId);
                    if (peer && privateState.pnCenterLabel && privateState.pnCenterCount && privateState.pnCenterSub) {
                        const netLabel = networkLabels[peer.network] || peer.network || 'PEER';
                        const netColor = options.getColor(peer.network);
                        privateState.pnCenterLabel.textContent = netLabel.toUpperCase();
                        privateState.pnCenterLabel.style.color = netColor;
                        privateState.pnCenterCount.textContent = '#' + peerId;
                        privateState.pnCenterCount.style.fontSize = '22px';
                        privateState.pnCenterCount.style.fontFamily = '';
                        privateState.pnCenterCount.style.color = netColor;
                        privateState.pnCenterSub.textContent = peer.direction === 'IN' ? 'inbound' : 'outbound';
                    }
                }
            });
            row.addEventListener('mouseleave', () => {
                // Preserve highlight if a peer is actively selected
                options.onAction({ type: 'highlight', peerId: privateState.privateNetSelectedPeerId });
                // Restore parent row preview (unless already cleared by hidePnSubTooltip)
                privateState.pnPreviewPeerIds = preview.peerIds || null;
                preview.peerIds = null;
                // Restore parent donut center text
                if (preview.label && preview.centerPeerIds) {
                    const allPN = dashboard.peers.filter((peer) => privateNetworks.has(peer.network));
                    previewPnCenterText(preview.centerPeerIds, preview.label, allPN.length);
                } else {
                    restorePnCenterText();
                }
                preview.label = null;
                preview.centerPeerIds = null;
            });
        });

        // Expand/collapse
        const showMore = query('.pn-sub-tt-show-more', tip);
        const showLess = query('.pn-sub-tt-show-less', tip);
        if (showMore && showLess) {
            showMore.addEventListener('click', (e) => {
                e.stopPropagation();
                queryAll('.as-sub-tt-peer-extra', tip).forEach((el) => (el.style.display = ''));
                showMore.style.display = 'none';
                showLess.style.display = '';
                const scroll = query('.as-sub-tt-scroll', tip);
                if (scroll) scroll.classList.add('as-sub-tt-expanded');
            });
            showLess.addEventListener('click', (e) => {
                e.stopPropagation();
                queryAll('.as-sub-tt-peer-extra', tip).forEach((el) => (el.style.display = 'none'));
                showLess.style.display = 'none';
                showMore.style.display = '';
                const scroll = query('.as-sub-tt-scroll', tip);
                if (scroll) scroll.classList.remove('as-sub-tt-expanded');
            });
        }
    }

    const fmtBytesShort = BPMFormat.fmtBytesShort;

    return Object.freeze({
        cachePnElements,
        refreshPinnedPreview,
        openPnDetailPanel,
        closePnDetailPanel,
        updatePnDetailPanel,
        openPnOverviewPanel,
        updatePnOverviewPanel,
        showPnInsightRect,
        hidePnInsightRect,
        clearPnInsightState,
        getPnInsightRectOrigin,
        buildPnInsightData,
        hidePnSubTooltip,
        fmtBytesShort,
    });
}

export { create };
