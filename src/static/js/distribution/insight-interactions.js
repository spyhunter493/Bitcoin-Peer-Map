import { query, queryAll } from '../core/dom.js';
/** @param {import('../types').DistributionInsightInteractionsOptions} options */
export function create(options) {
    /** @param {HTMLElement} bodyEl */
    function insightAttachSummaryLinkHandlers(bodyEl) {
        // "Navigate to provider" links — hover previews lines to that provider's peers, click navigates
        var navLinks = queryAll('.as-navigate-provider', bodyEl);
        for (var i = 0; i < navLinks.length; i++) {
            (function (el) {
                el.addEventListener('mouseenter', () => options.actions.previewNavigationProvider(el));
                el.addEventListener('mouseleave', function () {
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    options.actions.clearLegendFocus();
                    options.actions.summaryRestoreSummaryFromPreview();
                    options.actions.summaryRestoreDonutAfterPreview();
                });
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var asNum = el.dataset.as || '';
                    if (asNum) options.actions.navigateToProvider(asNum);
                });
            })(navLinks[i]);
        }

        // "All providers" links — opens sub-tooltip with all providers
        var allProvLinks = queryAll('.as-all-providers-link', bodyEl);
        for (var i = 0; i < allProvLinks.length; i++) {
            (function (el) {
                el.addEventListener('click', (e) => options.actions.selectAllProviders(el, e));
            })(allProvLinks[i]);
        }

        // Header provider links
        if (options.getPanel()) {
            var headerProvLinks = queryAll('.as-detail-header-info .as-all-providers-link', options.getPanel());
            for (var i = 0; i < headerProvLinks.length; i++) {
                (function (el) {
                    el.addEventListener('click', (e) => options.actions.selectHeaderProviders(el, e));
                })(headerProvLinks[i]);
            }
        }

        // "Fastest connection" link — hover shows providers ranked by avg ping, click pins
        const fastestLink = query('.as-fastest-link', bodyEl);
        if (fastestLink) {
            fastestLink.addEventListener('mouseenter', (e) => options.actions.previewFastestProviders(e));
            fastestLink.addEventListener('mouseleave', function () {
                if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                options.actions.clearLegendFocus();
                options.actions.tooltipHideSubTooltip();
                options.actions.hideInsightRect();
                options.actions.summaryRestoreSummaryFromPreview();
                options.actions.summaryRestoreDonutAfterPreview();
            });
            fastestLink.addEventListener('click', (e) => options.actions.selectFastestProviders(fastestLink, e));
        }

        // "Most stable" link — hover shows peer list for that provider, click pins sub-panel
        const stableLink = query('.as-stable-link', bodyEl);
        if (stableLink) {
            stableLink.addEventListener('mouseenter', (e) => options.actions.previewStablePeers(stableLink, e));
            stableLink.addEventListener('mouseleave', function () {
                if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                options.actions.clearLegendFocus();
                options.actions.tooltipHideSubTooltip();
                options.actions.hideInsightRect();
                options.actions.summaryRestoreSummaryFromPreview();
                options.actions.summaryRestoreDonutAfterPreview();
            });
            stableLink.addEventListener('click', (e) => options.actions.selectStablePeers(stableLink, e));
        }

        // Data insight provider sub-panels (Most sent/recv — hover shows providers ranked by bytes)
        var dataProvLinks = queryAll('.as-data-providers-link', bodyEl);
        for (var i = 0; i < dataProvLinks.length; i++) {
            (function (el) {
                const field = el.dataset.field === 'bytesrecv' ? 'bytesrecv' : 'bytessent';

                el.addEventListener('mouseenter', (e) => options.actions.previewDataProviders(field, e));
                el.addEventListener('mouseleave', function () {
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    options.actions.clearLegendFocus();
                    options.actions.tooltipHideSubTooltip();
                    options.actions.hideInsightRect();
                    options.actions.summaryRestoreSummaryFromPreview();
                    options.actions.summaryRestoreDonutAfterPreview();
                });
                el.addEventListener('click', (e) => options.actions.selectDataProviders(el, field, e));
            })(dataProvLinks[i]);
        }

        // "Show Private Networks" link — enter private network mode
        var pnLink = query('.as-show-private-nets', bodyEl);
        if (pnLink) {
            pnLink.addEventListener('click', (e) => options.actions.enterPrivateFromSummary(e));
        }
    }

    /** @param {HTMLElement} tip */
    function insightAttachFastestProvRowHandlers(tip) {
        var provRows = queryAll('.as-fastest-prov-row', tip);
        for (var pi = 0; pi < provRows.length; pi++) {
            (function (provRow) {
                provRow.style.cursor = 'pointer';
                provRow.addEventListener('mouseenter', () => options.actions.previewFastestProvider(provRow));
                provRow.addEventListener('mouseleave', function () {
                    if (options.state.peerDetailActive || options.state.subSubTooltipPinned) return;
                    // On leave, restore to the pinned insight provider
                    if (options.getDonut().isInsightVisible()) {
                        options.actions.restoreInsightRectProvider();
                    } else {
                        options.actions.summaryRestoreSummaryFromPreview();
                    }
                });
                provRow.addEventListener('click', (e) => options.actions.selectFastestProvider(provRow, e));
            })(provRows[pi]);
        }
    }

    /** @param {HTMLElement} tip
     * @param {string} field */
    function insightAttachDataProviderRowHandlers(tip, field) {
        var provRows = queryAll('.as-data-prov-row', tip);
        for (var pi = 0; pi < provRows.length; pi++) {
            (function (provRow) {
                provRow.style.cursor = 'pointer';
                // Hover preview: show lines + filter for this provider's peers
                provRow.addEventListener('mouseenter', () => options.actions.previewDataProvider(provRow, field));
                provRow.addEventListener('mouseleave', function () {
                    if (options.state.peerDetailActive || options.state.subSubTooltipPinned) return;
                    // On leave, restore to the pinned insight provider
                    if (options.getDonut().isInsightVisible()) {
                        options.actions.restoreInsightRectProvider();
                    } else {
                        options.actions.summaryRestoreSummaryFromPreview();
                    }
                });
                provRow.addEventListener('click', (e) => options.actions.selectDataProvider(provRow, e));
            })(provRows[pi]);
        }
    }
    return Object.freeze({
        insightAttachSummaryLinkHandlers,
        insightAttachFastestProvRowHandlers,
        insightAttachDataProviderRowHandlers,
    });
}
