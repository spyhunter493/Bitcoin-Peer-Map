import { comparePing } from '../core/ping.js';
import { query, queryAll } from '../core/dom.js';
import * as BPMDomState from '../core/dom-state.js';
import { distributionCoverage } from './data.js';
/** @param {import('../types').DistributionTooltipsOptions} options */
export function create(options) {
    /** @type {HTMLElement | null} */
    let pinnedSubTooltipSrc = null;
    /** @type {HTMLElement | null} */
    let secondarySource = null;
    /** @type {string | null} */
    let primarySourceKey = null;
    /** @type {string | null} */
    let secondarySourceKey = null;

    /** @param {HTMLElement | null} source @param {string | null} key */
    function currentSource(source, key) {
        if (source?.isConnected) return source;
        return key ? queryAll('*', document).find(element => BPMDomState.key(element) === key) || null : null;
    }

    /** @param {MouseEvent} event */
    function eventSource(event) {
        if (event.currentTarget instanceof HTMLElement) return event.currentTarget;
        return event.target instanceof HTMLElement ? event.target.closest('button, [role="button"]') : null;
    }

    /** @param {MouseEvent} event */
    function anchorY(event) {
        const source = eventSource(event);
        if (event.type === 'click' && event.detail === 0 && source) {
            const bounds = source.getBoundingClientRect();
            return bounds.top + bounds.height / 2;
        }
        return event.clientY;
    }

    /** @param {HTMLElement} tip @param {'primary' | 'secondary'} level */
    function addCloseControl(tip, level) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'as-popover-close';
        button.textContent = 'Close';
        button.setAttribute('aria-label', level === 'primary' ? 'Close peer group details' : 'Close provider peer list');
        button.addEventListener('click', event => {
            event.stopPropagation();
            options.actions.dismissTooltip?.(level);
        });
        tip.prepend(button);
    }

    /** @param {HTMLElement} tip @param {HTMLElement | null} source */
    function activateDialog(tip, source) {
        tip.setAttribute('role', 'dialog');
        tip.setAttribute('aria-modal', 'false');
        tip.setAttribute('aria-label', source?.textContent?.trim() || 'Peer group details');
        source?.setAttribute('aria-expanded', 'true');
        source?.setAttribute('aria-controls', tip.id);
        const first = queryAll('button', tip).find(button => !button.classList.contains('as-popover-close')) || query('button', tip);
        first?.focus({ preventScroll: true });
    }
    function captureSource() {
        return pinnedSubTooltipSrc ? BPMDomState.key(pinnedSubTooltipSrc) : null;
    }
    /** @param {string | null} key */
    function restoreSource(key) {
        const panel = options.getPanel();
        pinnedSubTooltipSrc =
            key && panel ? queryAll('*', panel).find((el) => BPMDomState.key(el) === key) || null : null;
        primarySourceKey = key;
        if (pinnedSubTooltipSrc && options.state.subTooltipPinned) {
            pinnedSubTooltipSrc.setAttribute('aria-expanded', 'true');
            pinnedSubTooltipSrc.setAttribute('aria-controls', 'as-sub-tooltip');
        }
    }
    function clearPeerHighlight() {
        queryAll('.as-sub-tt-peer-selected', document).forEach((el) => el.classList.remove('as-sub-tt-peer-selected'));
    }

    /** @param {HTMLElement} element */
    function tooltipIsPinnedTo(element) {
        return options.state.subTooltipPinned && pinnedSubTooltipSrc === element;
    }

    /** @param {string} html
     * @param {MouseEvent} event */
    function tooltipShowSubTooltip(html, event) {
        // Always close sub-sub tooltip when opening a new sub-tooltip
        tooltipHideSubSubTooltip();
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'as-sub-tooltip';
            tip.className = 'as-sub-tooltip';
            document.body.appendChild(tip);
        }
        tip.innerHTML = html;
        tip.removeAttribute('role');
        tip.removeAttribute('aria-modal');
        tip.classList.remove('hidden');
        tip.style.display = '';
        tooltipPositionSubTooltip(event);
        options.actions.tooltipAttachSubTooltipHandlers();
    }

    /** @param {MouseEvent} event */
    function tooltipPositionSubTooltip(event) {
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) return;
        var rect = tip.getBoundingClientRect();
        var pad = 12;
        // Position to the left of the detail panel
        var panelRect = options.getPanel()?.getBoundingClientRect() || { left: window.innerWidth };
        var x = panelRect.left - rect.width - pad;
        if (x < pad) x = pad;
        var y = anchorY(event) - rect.height / 2;
        if (y < pad) y = pad;
        if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    }

    function tooltipHideSubTooltip() {
        var tip = document.getElementById('as-sub-tooltip');
        const secondary = document.getElementById('as-sub-sub-tooltip');
        const restoreFocus = !!tip?.contains(document.activeElement) || !!secondary?.contains(document.activeElement);
        const source = currentSource(pinnedSubTooltipSrc, primarySourceKey);
        tooltipHideSubSubTooltip();
        if (tip) {
            tip.classList.add('hidden');
            tip.style.display = 'none';
            tip.style.pointerEvents = 'none';
        }
        options.state.subTooltipPinned = false;
        source?.setAttribute('aria-expanded', 'false');
        if (restoreFocus) source?.focus({ preventScroll: true });
        pinnedSubTooltipSrc = null;
        primarySourceKey = null;
    }

    /** @param {HTMLElement} srcEl */
    function tooltipPinSubTooltip(srcEl) {
        options.state.subTooltipPinned = true;
        pinnedSubTooltipSrc = srcEl || null;
        primarySourceKey = srcEl ? BPMDomState.key(srcEl) : null;
        var tip = document.getElementById('as-sub-tooltip');
        if (tip) {
            tip.style.pointerEvents = 'auto';
            addCloseControl(tip, 'primary');
            activateDialog(tip, srcEl);
        }
    }

    /** @param {string} html
     * @param {MouseEvent} event */
    function tooltipShowSubSubTooltip(html, event) {
        const source = eventSource(event);
        secondarySource = source instanceof HTMLElement ? source : null;
        secondarySourceKey = secondarySource ? BPMDomState.key(secondarySource) : null;
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'as-sub-sub-tooltip';
            tip.className = 'as-sub-tooltip as-sub-sub-tooltip';
            document.body.appendChild(tip);
        }
        tip.innerHTML = html;
        tip.classList.remove('hidden');
        tip.style.display = '';
        tip.style.pointerEvents = 'auto';
        tooltipPositionSubSubTooltip(event);
        options.actions.tooltipAttachSubSubTooltipHandlers();
    }

    /** @param {MouseEvent} event */
    function tooltipPositionSubSubTooltip(event) {
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (!tip) return;
        var subTip = document.getElementById('as-sub-tooltip');
        var rect = tip.getBoundingClientRect();
        var pad = 12;
        // Position to the left of the sub-tooltip
        var anchor = subTip
            ? subTip.getBoundingClientRect()
            : options.getPanel()?.getBoundingClientRect() || { left: window.innerWidth, top: 0 };
        var x = anchor.left - rect.width - pad;
        if (x < pad) x = pad;
        var y = event ? anchorY(event) - rect.height / 2 : anchor.top;
        if (y < pad) y = pad;
        if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    }

    function tooltipHideSubSubTooltip() {
        var tip = document.getElementById('as-sub-sub-tooltip');
        const restoreFocus = !!tip?.contains(document.activeElement);
        const source = currentSource(secondarySource, secondarySourceKey);
        if (tip) {
            tip.classList.add('hidden');
            tip.style.display = 'none';
            tip.style.pointerEvents = 'none';
        }
        options.state.subSubTooltipPinned = false;
        source?.setAttribute('aria-expanded', 'false');
        if (restoreFocus) source?.focus({ preventScroll: true });
        secondarySource = null;
        secondarySourceKey = null;
        options.actions.clearSecondaryFilter();
        // Clear provider row selection highlight in the sub-tooltip
        var subTip = document.getElementById('as-sub-tooltip');
        if (subTip) {
            var prevSel = queryAll('.as-provider-row-selected', subTip);
            for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
        }
    }

    /** @param {number} peerId */
    function tooltipHighlightSelectedPeerRow(peerId) {
        // Remove previous selected highlights
        var allSelected = queryAll('.as-sub-tt-peer-selected', document);
        for (var i = 0; i < allSelected.length; i++) allSelected[i].classList.remove('as-sub-tt-peer-selected');
        // Add highlight to matching row(s)
        var tips = [document.getElementById('as-sub-tooltip'), document.getElementById('as-sub-sub-tooltip')];
        for (var ti = 0; ti < tips.length; ti++) {
            if (!tips[ti]) continue;
            var rows = queryAll('.as-sub-tt-peer[data-peer-id]', tips[ti]);
            for (var ri = 0; ri < rows.length; ri++) {
                if (parseInt(rows[ri].dataset.peerId || '') === peerId) {
                    rows[ri].classList.add('as-sub-tt-peer-selected');
                }
            }
        }
    }
    /** @param {import('../types').DistributionTooltipRefresh} context */
    function refreshPinned({ category, label, filtered, secondary, secondaryPeers }) {
        // Refresh pinned lists from descriptors, keeping their shells and geometry.
        const tip = document.getElementById('as-sub-tooltip');
        if (tip && options.state.subTooltipPinned && category) {
            const restoreTip = BPMDomState.capture(tip);
            let html;
            if (category === 'summary' || category === 'conn-others') {
                const providers = options.actions.aggregateProvidersForPeers(filtered);
                html = options.getSummaryView().buildProviderListHtml(providers, label, undefined, distributionCoverage(filtered));
            } else if (category === 'insight-fastest') html = options.actions.buildFastestProvHtml() || '';
            else if (category.startsWith('insight-data-'))
                html = options.actions.buildDataProviderHtml(category.slice('insight-data-'.length))?.html || '';
            else if (category === 'insight-stable')
                html = options.getSummaryView().buildPeerSummaryHtml(filtered, category, label);
            else html = options.getSummaryView().buildPeerSummaryHtml(filtered, category, label);
            tip.innerHTML = html;
            addCloseControl(tip, 'primary');
            options.actions.tooltipAttachSubTooltipHandlers();
            if (category === 'summary' || category === 'conn-others')
                options.actions.summaryAttachProviderClickHandlers(tip);
            if (category === 'insight-fastest') options.actions.insightAttachFastestProvRowHandlers(tip);
            else if (category.startsWith('insight-data-'))
                options.actions.insightAttachDataProviderRowHandlers(tip, category.slice(13));
            options.actions.summaryAttachProviderNavHandlers(tip);
            if (secondary)
                queryAll('.as-provider-row', tip).forEach((row) => {
                    row.classList.toggle('as-provider-row-selected', row.dataset.as === secondary);
                });
            restoreTip();
        }
        const field = category === 'insight-data-bytesrecv' ? 'bytesrecv' : 'bytessent';
        const subTip = document.getElementById('as-sub-sub-tooltip');
        if (subTip && options.state.subSubTooltipPinned && secondaryPeers) {
            const restore = BPMDomState.capture(subTip);
            subTip.innerHTML =
                category === 'insight-fastest'
                    ? options
                          .getSummaryView()
                          .buildPingPeerListHtml(
                              secondaryPeers.slice().sort((a, b) => comparePing(a.ping_ms, b.ping_ms))
                          )
                    : category && category.startsWith('insight-data-')
                      ? options.getSummaryView().buildDataPeerListHtml(
                            secondaryPeers.slice().sort((a, b) => (b[field] || 0) - (a[field] || 0)),
                            field
                        )
                      : options.getSummaryView().buildPeerListHtmlForSubSub(secondaryPeers);
            options.actions.tooltipAttachSubSubTooltipHandlers();
            addCloseControl(subTip, 'secondary');
            restore();
        }
    }
    function getRankedProvider() {
        const tip = document.getElementById('as-sub-tooltip');
        const row = tip ? query('.as-fastest-prov-row, .as-data-prov-row', tip) : null;
        return row
            ? {
                  asNumber: row.dataset.as || '',
                  peerIds: /** @type {number[]} */ (JSON.parse(row.dataset.peerIds || '[]')),
              }
            : null;
    }
    function tooltipPinSecondary() {
        options.state.subSubTooltipPinned = true;
        const tip = document.getElementById('as-sub-sub-tooltip');
        if (tip) {
            addCloseControl(tip, 'secondary');
            activateDialog(tip, secondarySource);
        }
    }
    return Object.freeze({
        tooltipPinSecondary,
        refreshPinned,
        getRankedProvider,
        tooltipIsPinnedTo,
        tooltipShowSubTooltip,
        tooltipPositionSubTooltip,
        tooltipHideSubTooltip,
        tooltipPinSubTooltip,
        tooltipShowSubSubTooltip,
        tooltipPositionSubSubTooltip,
        tooltipHideSubSubTooltip,
        tooltipHighlightSelectedPeerRow,
        captureSource,
        restoreSource,
        clearPeerHighlight,
    });
}
