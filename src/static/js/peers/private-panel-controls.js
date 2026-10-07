import { queryAll, query, required } from '../core/dom.js';
import * as BPMPeerFilters from './filters.js';
import * as BPMDomState from '../core/dom-state.js';
import * as privateData from './private-data.js';

/** Owns event bindings and nonmodal popovers for one private panel.
 * @param {import('./private-components').PanelControlsOptions} options */
export function create(options) {
    const { dashboard, document, lifecycle, view } = options;
    const privateState = options.state;
    const window = document.defaultView || globalThis.window;
    const HTMLElement = window?.HTMLElement || globalThis.HTMLElement;
    const Element = window?.Element || globalThis.Element;
    const privateNetworks = new Set(privateData.networks);
    const networkLabels = privateData.labels;
    const { previewPnCenterText, restorePnCenterText,
        showPnInsightRect, hidePnInsightRect, buildPnInsightData, buildPnPeerListHtml } = view;
    const preview = { peerIds: /** @type {number[] | null} */ (null),
        label: /** @type {string | null} */ (null), centerPeerIds: /** @type {number[] | null} */ (null) };
    /** @type {string | null} */
    let pinnedSourceKey = null;
    let popoverScope = lifecycle.replace('popover');
    const popoverListeners = () => popoverScope;

    function currentPinnedSource() {
        if (privateState.pnPinnedSubSrc?.isConnected) return privateState.pnPinnedSubSrc;
        const body = privateState.pnDetailBodyEl;
        return pinnedSourceKey && body ? queryAll('*', body).find(element => BPMDomState.key(element) === pinnedSourceKey) || null : null;
    }

    /** @param {HTMLElement} tip */
    function addPopoverClose(tip) {
        if (query('.as-popover-close', tip)) return;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'as-popover-close';
        close.textContent = 'Close';
        close.setAttribute('aria-label', 'Close private peer group');
        popoverListeners().listen(close, 'click', event => {
            event.stopPropagation();
            const source = currentPinnedSource();
            hidePnSubTooltip();
            source?.classList.remove('pn-sub-filter-active');
            restorePnCenterText();
        });
        tip.prepend(close);
    }

    function privateScope() {
        return privateData.scope(dashboard.peers, privateState.pnSelectedNet);
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
     * @param {ReturnType<typeof import('../core/lifecycle.js').create>} listeners
     */
    function attachPnInteractiveRowHandlers(bodyEl, allNetPeers, listeners) {
        queryAll('.pn-interactive-row', bodyEl).forEach((rowEl) => {
            listeners.listen(rowEl, 'mouseenter', (e) => {
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
            listeners.listen(rowEl, 'mousemove', (e) => {
                if (!privateState.pnSubTooltipPinned) positionPnSubTooltip(e);
            });
            listeners.listen(rowEl, 'mouseleave', () => {
                if (privateState.pnSubTooltipPinned) return;
                if (privateState.pnInsightActiveType) return; // Was suppressed on enter
                hidePnSubTooltip();
                privateState.pnPreviewPeerIds = null;
                // Restore PN donut center to its previous state
                restorePnCenterText();
            });
            listeners.listen(rowEl, 'click', (e) => {
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
                pinPnSubTooltip(rowEl);
                // Lock preview lines to this row's peers
                privateState.pnPreviewPeerIds = peerIds;
                // Show category info in PN donut center (stays while pinned)
                previewPnCenterText(peerIds, label, allNetPeers.length);
            });
        });
    }

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
        if (row) {
            pinnedSourceKey = BPMDomState.key(row);
            row.setAttribute('aria-expanded', 'true');
            row.setAttribute('aria-controls', 'pn-sub-tooltip');
        }
        row?.classList.add('pn-sub-filter-active');
        privateState.pnPreviewPeerIds = peerIds;
        previewPnCenterText(peerIds, pinned.label, allNetPeers.length);
        restore();
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
        popoverScope = lifecycle.replace('popover');
        tip.innerHTML = html;
        if (privateState.pnSubTooltipPinned) addPopoverClose(tip);
        else {
            tip.removeAttribute('role');
            tip.removeAttribute('aria-modal');
        }
        tip.classList.remove('hidden');
        tip.style.display = '';
        positionPnSubTooltip(event);
        attachPnSubTooltipHandlers(tip);
    }

    /** @param {{clientY: number} & Partial<Pick<MouseEvent, 'type' | 'detail' | 'currentTarget'>>} event */
    function positionPnSubTooltip(event) {
        const tip = document.getElementById('pn-sub-tooltip');
        if (!tip) return;
        const rect = tip.getBoundingClientRect();
        const pad = 12;
        const panelRect = privateState.pnDetailPanelEl ? privateState.pnDetailPanelEl.getBoundingClientRect() : { left: window.innerWidth };
        let x = panelRect.left - rect.width - pad;
        if (x < pad) x = pad;
        const source = event.currentTarget;
        const anchor = event.type === 'click' && event.detail === 0 && source instanceof HTMLElement
            ? source.getBoundingClientRect().top + source.getBoundingClientRect().height / 2 : event.clientY;
        let y = anchor - rect.height / 2;
        if (y < pad) y = pad;
        if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    }

    function hidePnSubTooltip() {
        const tip = document.getElementById('pn-sub-tooltip');
        const source = currentPinnedSource();
        const restoreFocus = !!tip?.contains(document.activeElement);
        if (tip) {
            // Clear saved preview state BEFORE hiding, so deferred mouseleave
            // events (triggered by display:none) can't restore stale peer IDs
            // or stale donut center text (category label/peerIds)
            preview.peerIds = null;
            preview.label = null;
            preview.centerPeerIds = null;
            popoverScope.dispose();
            tip.classList.add('hidden');
            tip.style.display = 'none';
            tip.style.pointerEvents = 'none';
        }
        privateState.pnSubTooltipPinned = false;
        source?.setAttribute('aria-expanded', 'false');
        if (restoreFocus) source?.focus({ preventScroll: true });
        pinnedSourceKey = null;
        privateState.pnFilter = null;
        privateState.pnPinnedSubSrc = null;
        privateState.pnPreviewPeerIds = null;
        // Clear PN center preview state so stale category text doesn't persist
        // across refreshes when the tooltip is dismissed without restorePnCenterText()
        privateState.pnCenterPreviewLabel = null;
        privateState.pnCenterPreviewPeerIds = null;
        options.onAction({ type: 'table' });
    }

    /** @param {HTMLElement} srcEl */
    function pinPnSubTooltip(srcEl) {
        privateState.pnSubTooltipPinned = true;
        privateState.pnPinnedSubSrc = srcEl || null;
        pinnedSourceKey = srcEl ? BPMDomState.key(srcEl) : null;
        if (srcEl)
            privateState.pnFilter = {
                filter: JSON.parse(srcEl.dataset.filter || 'null'),
                label: required('.as-detail-sub-label', srcEl).textContent,
            };
        const tip = document.getElementById('pn-sub-tooltip');
        if (tip) {
            tip.style.pointerEvents = 'auto';
            tip.setAttribute('role', 'dialog');
            tip.setAttribute('aria-modal', 'false');
            tip.setAttribute('aria-label', privateState.pnFilter?.label || 'Private peer group');
            srcEl?.setAttribute('aria-expanded', 'true');
            srcEl?.setAttribute('aria-controls', tip.id);
            addPopoverClose(tip);
            (query('.pn-sub-tt-id-link', tip) || query('button', tip))?.focus({ preventScroll: true });
        }
        options.onAction({ type: 'table' });
    }

    /** @param {HTMLElement} tip */
    function attachPnSubTooltipHandlers(tip) {
        const listeners = popoverListeners();
        // Peer ID click → select that peer on the map
        queryAll('.pn-sub-tt-id-link', tip).forEach((link) => {
            listeners.listen(link, 'click', (e) => {
                e.stopPropagation();
                const peerId = parseInt(link.dataset.peerId || '');
                if (isNaN(peerId)) return;
                options.onAction({ type: 'select', peerId });
            });
        });

        // Peer row hover → preview individual peer line + donut center
        queryAll('.as-sub-tt-peer[data-peer-id]', tip).forEach((row) => {
            listeners.listen(row, 'mouseenter', () => {
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
            listeners.listen(row, 'mouseleave', () => {
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
            listeners.listen(showMore, 'click', (e) => {
                e.stopPropagation();
                queryAll('.as-sub-tt-peer-extra', tip).forEach((el) => (el.style.display = ''));
                showMore.style.display = 'none';
                showLess.style.display = '';
                showLess.focus({ preventScroll: true });
                const scroll = query('.as-sub-tt-scroll', tip);
                if (scroll) scroll.classList.add('as-sub-tt-expanded');
            });
            listeners.listen(showLess, 'click', (e) => {
                e.stopPropagation();
                queryAll('.as-sub-tt-peer-extra', tip).forEach((el) => (el.style.display = 'none'));
                showLess.style.display = 'none';
                showMore.style.display = '';
                showMore.focus({ preventScroll: true });
                const scroll = query('.as-sub-tt-scroll', tip);
                if (scroll) scroll.classList.remove('as-sub-tt-expanded');
            });
        }
    }
    /** @param {ReturnType<typeof import('../core/lifecycle.js').create>} listeners */
    function bindBlank(listeners) {
        // Attach blank-space click handler once on pnDetailBodyEl (dismiss sub-tooltips)
        if (privateState.pnDetailBodyEl) {
            privateState.pnDetailBodyHandlerAttached = true;
            listeners.listen(privateState.pnDetailBodyEl, 'click', (e) => {
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
    /** @param {HTMLElement} bodyEl @param {import('../types').Peer[]} peers */
    function bindDetail(bodyEl, peers) {
        const listeners = lifecycle.replace('panel');
        bindBlank(listeners);
        attachPnInteractiveRowHandlers(bodyEl, peers, listeners);
    }
    /** @param {HTMLElement} root */
    function bindInsight(root) {
        const listeners = lifecycle.replace('insight');
        listeners.listen(query('.pn-insight-rect-close', root), 'click', event => {
            event.stopPropagation();
            hidePnInsightRect();
            clearPnInsightState();
        });
    }

    /** @param {HTMLElement} bodyEl @param {import('../types').Peer[]} allPrivate */
    function bindOverview(bodyEl, allPrivate) {
        const listeners = lifecycle.replace('panel');
        bindBlank(listeners);
        // Attach interactive row handlers
        attachPnInteractiveRowHandlers(bodyEl, allPrivate, listeners);

        // Network link rows — click to navigate to per-network panel
        // Network link rows: handled by generic pn-interactive-row handler
        // (shows submenu with peers in that network on hover/click)

        // Insight rows — hover to preview in rectangle, click to select/pin
        queryAll('.pn-insight-row', privateState.pnDetailBodyEl).forEach((row) => {
            listeners.listen(row, 'mouseenter', () => {
                if (privateState.pnInsightActiveType) return; // Don't override a pinned selection
                if (privateState.pnSubTooltipPinned) return; // Don't preview when sub-tooltip is open
                const peerId = parseInt(row.dataset.peerId || '');
                const insightType = row.dataset.insightType;
                if (!peerId || !insightType) return;

                // Find the peer in current data
                const rawPeers = dashboard.peers.filter((peer) => privateNetworks.has(peer.network));
                const peer = rawPeers.find((p) => p.id === peerId);
                if (!peer) return;

                row.classList.add('pn-insight-hover');

                // Preview: show rectangle, draw line to this peer
                var data = buildPnInsightData(peer, insightType);
                showPnInsightRect(insightType, data);
                privateState.pnPreviewPeerIds = [peerId];
                privateState.privateNetLinePeer = peerId;
            });

            listeners.listen(row, 'mouseleave', () => {
                if (privateState.pnInsightActiveType) return; // Don't dismiss if pinned
                if (privateState.pnSubTooltipPinned) return; // Was suppressed on enter
                row.classList.remove('pn-insight-hover');
                hidePnInsightRect();
                privateState.pnPreviewPeerIds = null;
                privateState.privateNetLinePeer = null;
            });

            listeners.listen(row, 'click', (e) => {
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
                const rawPeers = dashboard.peers.filter((peer) => privateNetworks.has(peer.network));
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
        const searchInput = query('#pn-overview-search', document);
        if (searchInput) {
            listeners.listen(searchInput, 'input', () => {
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
    function dispose() {
        lifecycle.dispose();
        privateState.pnPinnedSubSrc?.setAttribute('aria-expanded', 'false');
        document.getElementById('pn-sub-tooltip')?.remove();
        privateState.pnSubTooltipPinned = false;
        privateState.pnPinnedSubSrc = null;
        privateState.pnFilter = null;
        privateState.pnPreviewPeerIds = null;
        privateState.pnCenterPreviewLabel = null;
        privateState.pnCenterPreviewPeerIds = null;
        pinnedSourceKey = null;
        preview.peerIds = preview.label = preview.centerPeerIds = null;
    }
    return Object.freeze({ bindDetail, bindOverview, bindInsight, refreshPinnedPreview,
        hidePnSubTooltip, clearPnInsightState, dispose });
}
