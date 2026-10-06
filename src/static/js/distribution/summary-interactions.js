import { query, queryAll, required } from '../core/dom.js';
import * as BPMModal from '../core/modal.js';
/** @param {import('../types').DistributionSummaryInteractionsOptions} options */
export function create(options) {
    const escapeHtml = BPMModal.escapeHtml;
    /** @param {HTMLElement} bodyEl */
    function summaryAttachCountrySummaryRowHandlers(bodyEl) {
        var rows = queryAll('.as-country-summary-row', bodyEl);
        for (var ri = 0; ri < rows.length; ri++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', () => options.actions.previewCountry(rowEl));
                rowEl.addEventListener('mouseleave', () => options.actions.restoreCountryPreview());
                rowEl.addEventListener('click', (e) => options.actions.selectCountryFromSummary(rowEl, bodyEl, e));
            })(rows[ri]);
        }
    }

    /** @param {HTMLElement} bodyEl */
    function summaryAttachPanelBlankClickHandler(bodyEl) {
        bodyEl.addEventListener('click', (e) => options.actions.dismissPanelTooltips(bodyEl, e));
    }

    /** @param {HTMLElement} bodyEl */
    function summaryAttachInteractiveRowHandlers(bodyEl) {
        var rows = queryAll('.as-interactive-row', bodyEl);
        for (var ri = 0; ri < rows.length; ri++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', function (e) {
                    // When something is selected (pinned) or peer detail is open, suppress hover previews
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    /** @type {number[]} */
                    var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                    var category = rowEl.dataset.category || '';
                    var label = required('.as-detail-sub-label', rowEl).textContent;
                    var html = options.actions.summaryBuildPeerSummaryHtml(peerIds, category, label);
                    options.actions.tooltipShowSubTooltip(html, e);
                    // Preview lines/filter for hovered sub-row
                    options.actions.summaryPreviewProviderLines(peerIds);
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (!options.state.subTooltipPinned) options.actions.tooltipPositionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    options.actions.tooltipHideSubTooltip();
                    options.actions.summaryRestoreProviderFromPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    /** @type {number[]} */
                    var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                    var category = rowEl.dataset.category || '';
                    var label = required('.as-detail-sub-label', rowEl).textContent;
                    // Toggle: clicking same row unpins
                    if (options.actions.tooltipIsPinnedTo(rowEl)) {
                        options.actions.tooltipHideSubTooltip();
                        options.actions.summaryClearSubFilter();
                        return;
                    }
                    options.actions.summaryApplySubFilter(peerIds, category, label);
                    var html = options.actions.summaryBuildPeerSummaryHtml(peerIds, category, label);
                    options.actions.tooltipShowSubTooltip(html, e);
                    options.actions.tooltipPinSubTooltip(rowEl);
                });
            })(rows[ri]);
        }
    }

    /** @param {HTMLElement} bodyEl */
    function summaryAttachSummaryRowHandlers(bodyEl) {
        var rows = queryAll('.as-summary-row', bodyEl);
        for (var ri = 0; ri < rows.length; ri++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', function (e) {
                    // When something is selected (pinned) or peer detail is open, suppress hover previews
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    /** @type {number[]} */
                    var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                    /** @type {Parameters<ReturnType<typeof import('./summary-panel.js').create>['buildProviderListHtml']>[0]} */
                    var providers = JSON.parse(rowEl.dataset.providers || '');
                    var catLabel = rowEl.dataset.catLabel || '';
                    var html = options.getSummaryView().buildProviderListHtml(providers, catLabel, undefined, JSON.parse(rowEl.dataset.coverage || 'null'));
                    options.actions.tooltipShowSubTooltip(html, e);
                    // Preview lines/filter for hovered category
                    options.actions.summaryPreviewSummaryLines(peerIds);
                    // Preview category info in donut center
                    options.actions.summaryPreviewSummaryCenterText(peerIds, catLabel);
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (!options.state.subTooltipPinned) options.actions.tooltipPositionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    options.actions.tooltipHideSubTooltip();
                    options.actions.summaryRestoreSummaryFromPreview();
                    options.actions.summaryRestoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (options.state.peerDetailActive && !options.isReconciling()) options.actions.closePeerPopup();
                    /** @type {number[]} */
                    var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                    /** @type {Parameters<ReturnType<typeof import('./summary-panel.js').create>['buildProviderListHtml']>[0]} */
                    var providers = JSON.parse(rowEl.dataset.providers || '');
                    var catLabel = rowEl.dataset.catLabel || '';

                    // Toggle: clicking same row unpins
                    if (options.actions.tooltipIsPinnedTo(rowEl)) {
                        options.actions.tooltipHideSubTooltip();
                        options.actions.summaryClearSummarySubFilter();
                        options.actions.summaryRestoreDonutAfterPreview();
                        return;
                    }

                    // Apply sub-filter for all peers in this category
                    options.actions.summaryApplySummarySubFilter(peerIds, catLabel);

                    // Immediately update the donut to reflect the new category
                    options.actions.summaryRestoreDonutAfterPreview();

                    // Pin the sub-tooltip with provider list
                    var html = options.getSummaryView().buildProviderListHtml(providers, catLabel, undefined, JSON.parse(rowEl.dataset.coverage || 'null'));
                    options.actions.tooltipShowSubTooltip(html, e);
                    options.actions.tooltipPinSubTooltip(rowEl);
                    summaryAttachProviderClickHandlers(required('#as-sub-tooltip'));
                });
                rowEl.addEventListener('keydown', function (e) {
                    if (rowEl instanceof HTMLButtonElement) return;
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    rowEl.click();
                });
            })(rows[ri]);
        }
    }

    /** @param {HTMLElement} tip */
    function summaryAttachProviderClickHandlers(tip) {
        var provRows = queryAll('.as-provider-row', tip);
        for (var pi = 0; pi < provRows.length; pi++) {
            (function (provRow) {
                provRow.style.cursor = 'pointer';
                // Hover preview: show lines + filter for this provider's peers
                provRow.addEventListener('mouseenter', () => options.actions.previewNestedProvider(provRow));
                provRow.addEventListener('mouseleave', function () {
                    if (options.state.peerDetailActive || options.state.subSubTooltipPinned) return;
                    options.actions.clearLegendFocus();
                    options.actions.summaryRestoreSummaryFromPreview();
                    options.actions.summaryRestoreDonutAfterPreview();
                });
                const peerListButton = query('.as-provider-peer-list', provRow) || provRow;
                peerListButton.addEventListener('click', (e) => options.actions.selectNestedProvider(provRow, e));
            })(provRows[pi]);
        }

        // Private network panel links (Tor/I2P/CJDNS titles)
        var pnLinks = queryAll('.as-private-net-link', tip);
        for (var pnli = 0; pnli < pnLinks.length; pnli++) {
            (function (linkEl) {
                linkEl.addEventListener('click', (e) => options.actions.enterPrivateFromTooltip(linkEl, e));
            })(pnLinks[pnli]);
        }
    }

    /** @param {HTMLElement} bodyEl */
    function summaryAttachGridHandlers(bodyEl) {
        // Provider total rows — hover/click shows all peers for this provider
        var connProvRows = queryAll('.as-conn-prov-row', bodyEl);
        for (var cpi = 0; cpi < connProvRows.length; cpi++) {
            (function (rowEl) {
                function buildProvPeerHtml() {
                    /** @type {number[]} */
                    var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                    if (peerIds.length === 0) return null;
                    var asNum = rowEl.dataset.as || '';
                    var matchedPeers = options.actions.peersByIds(peerIds);
                    // Find the provider name for the header
                    var provName = asNum;
                    var grp = options.getGroups().find(function (g) {
                        return g.asNumber === asNum;
                    });
                    if (grp) provName = grp.asShort || grp.asName || asNum;
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html +=
                        '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' +
                        escapeHtml(provName) +
                        ' Peers</div>';
                    html +=
                        '<button type="button" class="as-sub-tt-nav as-grid-provider-click" data-as="' +
                        asNum +
                        '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open provider panel</button>';
                    html += '</div>';
                    html += options.getSummaryView().buildPeerListHtmlForSubSub(matchedPeers);
                    return html;
                }
                rowEl.addEventListener('mouseenter', (e) =>
                    options.actions.previewConnectionProvider(rowEl, buildProvPeerHtml, e)
                );
                rowEl.addEventListener('mouseleave', function () {
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    options.actions.clearLegendFocus();
                    options.actions.tooltipHideSubTooltip();
                    options.actions.summaryRestoreSummaryFromPreview();
                    options.actions.summaryRestoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', (e) =>
                    options.actions.selectConnectionProvider(rowEl, buildProvPeerHtml, e)
                );
            })(connProvRows[cpi]);
        }

        // Out rows — hover/click shows outbound subtypes breakdown
        var connOutRows = queryAll('.as-conn-out-row', bodyEl);
        for (var coi = 0; coi < connOutRows.length; coi++) {
            (function (rowEl) {
                function buildOutSubHtml() {
                    /** @type {number[]} */
                    var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                    if (peerIds.length === 0) return null;
                    /** @type {{label: string; count: number}[]} */
                    var subtypes = JSON.parse(rowEl.dataset.outSubtypes || '');
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html +=
                        '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Outbound Peers</div>';
                    html += '</div>';
                    html += '<div class="as-sub-tt-scroll">';
                    for (var si = 0; si < subtypes.length; si++) {
                        var st = subtypes[si];
                        html += '<div class="as-sub-tt-peer">';
                        html +=
                            '<span class="as-sub-tt-id" style="font-weight:600; min-width:60px">' +
                            escapeHtml(st.label) +
                            '</span>';
                        html +=
                            '<span class="as-sub-tt-type">' +
                            st.count +
                            ' peer' +
                            (st.count !== 1 ? 's' : '') +
                            '</span>';
                        html += '</div>';
                    }
                    html += '</div>';
                    // Also include full peer list below subtypes
                    var matchedPeers = options.actions.peersByIds(peerIds);
                    html += '<div style="border-top:1px solid rgba(88,166,255,0.1); margin-top:4px; padding-top:4px">';
                    html += options.getSummaryView().buildPeerListHtmlForSubSub(matchedPeers);
                    html += '</div>';
                    return html;
                }
                rowEl.addEventListener('mouseenter', (e) =>
                    options.actions.previewOutboundTypeGroup(rowEl, buildOutSubHtml, e)
                );
                rowEl.addEventListener('mouseleave', function () {
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    options.actions.clearLegendFocus();
                    options.actions.tooltipHideSubTooltip();
                    options.actions.summaryRestoreSummaryFromPreview();
                    options.actions.summaryRestoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', (e) =>
                    options.actions.selectOutboundTypeGroup(rowEl, buildOutSubHtml, e)
                );
            })(connOutRows[coi]);
        }

        // In rows already have .as-interactive-row class — handled by attachInteractiveRowHandlers if in provider panel,
        // but here in summary we need explicit handling. The .as-conn-dir-row In rows:
        var connDirRows = queryAll('.as-conn-dir-row', bodyEl);
        for (var cdi = 0; cdi < connDirRows.length; cdi++) {
            (function (rowEl) {
                function buildDirPeerHtml() {
                    /** @type {number[]} */
                    var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                    if (peerIds.length === 0) return null;
                    var matchedPeers = options.actions.peersByIds(peerIds);
                    var html = '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
                    html +=
                        '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Inbound Peers</div>';
                    html += '</div>';
                    html += options.getSummaryView().buildPeerListHtmlForSubSub(matchedPeers);
                    return html;
                }
                rowEl.addEventListener('mouseenter', (e) =>
                    options.actions.previewConnectionDirection(rowEl, buildDirPeerHtml, e)
                );
                rowEl.addEventListener('mouseleave', function () {
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    options.actions.clearLegendFocus();
                    options.actions.tooltipHideSubTooltip();
                    options.actions.summaryRestoreSummaryFromPreview();
                    options.actions.summaryRestoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', (e) =>
                    options.actions.selectConnectionDirection(rowEl, buildDirPeerHtml, e)
                );
            })(connDirRows[cdi]);
        }

        // Others row — 3-level: hover/click shows provider list, then provider → peer list
        var connOthersRows = queryAll('.as-conn-others-row', bodyEl);
        for (var coi2 = 0; coi2 < connOthersRows.length; coi2++) {
            (function (rowEl) {
                rowEl.addEventListener('mouseenter', function (e) {
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    /** @type {number[]} */
                    var peerIds = JSON.parse(rowEl.dataset.peerIds || '');
                    /** @type {Parameters<ReturnType<typeof import('./summary-panel.js').create>['buildProviderListHtml']>[0]} */
                    var providers = JSON.parse(rowEl.dataset.providers || '');
                    var html = options.getSummaryView().buildProviderListHtml(providers, 'Others', 'Others');
                    options.actions.tooltipShowSubTooltip(html, e);
                    options.actions.summaryPreviewSummaryLines(peerIds);
                    options.actions.summaryPreviewSummaryCenterText(peerIds, 'Others');
                });
                rowEl.addEventListener('mousemove', function (e) {
                    if (!options.state.subTooltipPinned) options.actions.tooltipPositionSubTooltip(e);
                });
                rowEl.addEventListener('mouseleave', function () {
                    if (options.state.subTooltipPinned || options.state.peerDetailActive) return;
                    options.actions.tooltipHideSubTooltip();
                    options.actions.summaryRestoreSummaryFromPreview();
                    options.actions.summaryRestoreDonutAfterPreview();
                });
                rowEl.addEventListener('click', (e) => options.actions.selectOtherProviders(rowEl, e));
            })(connOthersRows[coi2]);
        }
    }

    /** @param {HTMLElement} tip */
    function summaryAttachProviderNavHandlers(tip) {
        var provRows = queryAll('.as-provider-row', tip);
        for (var i = 0; i < provRows.length; i++) {
            (function (provRow) {
                var nameEl = query('.as-provider-click', provRow);
                if (nameEl) {
                    nameEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var asNum = provRow.dataset.as || '';
                        if (asNum) {
                            options.actions.tooltipHideSubTooltip();
                            options.actions.navigateToProvider(asNum);
                        }
                    });
                }
            })(provRows[i]);
        }
        // Also handle standalone provider-click links (e.g. "Open provider panel" in sub-tooltips)
        var provClicks = queryAll('.as-grid-provider-click', tip);
        for (var i = 0; i < provClicks.length; i++) {
            (function (el) {
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var asNum = el.dataset.as || '';
                    if (asNum) {
                        options.actions.tooltipHideSubTooltip();
                        options.actions.navigateToProvider(asNum);
                    }
                });
            })(provClicks[i]);
        }
    }

    /** @param {HTMLElement} bodyEl */
    function summaryAttachSummaryHandlers(bodyEl) {
        summaryAttachSummaryRowHandlers(bodyEl);
        summaryAttachGridHandlers(bodyEl);
        options.actions.insightAttachSummaryLinkHandlers(bodyEl);
        summaryAttachPanelBlankClickHandler(bodyEl);
    }

    /** @param {HTMLElement} tip */
    function tooltipAttachPeerRowHoverHandlers(tip) {
        var peerRows = queryAll('.as-sub-tt-peer[data-peer-id]', tip);
        for (var pri = 0; pri < peerRows.length; pri++) {
            (function (row) {
                row.addEventListener('mouseenter', () => options.actions.previewTooltipPeer(row));
                row.addEventListener('mouseleave', () => options.actions.restoreTooltipPeerPreview());
            })(peerRows[pri]);
        }
    }

    function tooltipAttachSubTooltipHandlers() {
        var tip = document.getElementById('as-sub-tooltip');
        if (!tip) return;

        // Peer ID click → zoom to peer on map and open the large peer detail popup
        var idLinks = queryAll('.as-sub-tt-id-link', tip);
        for (var li = 0; li < idLinks.length; li++) {
            (function (link) {
                link.addEventListener('click', (e) => options.actions.selectPrimaryTooltipPeer(link, e));
            })(idLinks[li]);
        }

        // Peer row hover → preview line to individual peer
        tooltipAttachPeerRowHoverHandlers(tip);

        const showMore = query('.as-sub-tt-show-more', tip);
        const showLess = query('.as-sub-tt-show-less', tip);
        if (!showMore || !showLess) return;

        showMore.addEventListener('click', function (e) {
            e.stopPropagation();
            // Show all extra peers
            var extras = queryAll('.as-sub-tt-peer-extra', tip);
            for (var i = 0; i < extras.length; i++) {
                extras[i].style.display = '';
            }
            showMore.style.display = 'none';
            showLess.style.display = '';
            showLess.focus({ preventScroll: true });

            // Add scroll container class if many peers
            var peerList = query('.as-sub-tt-scroll', tip);
            if (peerList) peerList.classList.add('as-sub-tt-expanded');
        });

        showLess.addEventListener('click', function (e) {
            e.stopPropagation();
            // Hide extra peers
            var extras = queryAll('.as-sub-tt-peer-extra', tip);
            for (var i = 0; i < extras.length; i++) {
                extras[i].style.display = 'none';
            }
            showLess.style.display = 'none';
            showMore.style.display = '';
            showMore.focus({ preventScroll: true });

            var peerList = query('.as-sub-tt-scroll', tip);
            if (peerList) peerList.classList.remove('as-sub-tt-expanded');
        });
    }

    function tooltipAttachSubSubTooltipHandlers() {
        var tip = document.getElementById('as-sub-sub-tooltip');
        if (!tip) return;

        // Peer ID click → zoom to peer on map and open the large peer detail popup
        var idLinks = queryAll('.as-sub-tt-id-link', tip);
        for (var li = 0; li < idLinks.length; li++) {
            (function (link) {
                link.addEventListener('click', (e) => options.actions.selectSecondaryTooltipPeer(link, e));
            })(idLinks[li]);
        }

        // Peer row hover → preview line to individual peer
        tooltipAttachPeerRowHoverHandlers(tip);

        const showMore = query('.as-sub-tt-show-more', tip);
        const showLess = query('.as-sub-tt-show-less', tip);
        if (!showMore || !showLess) return;

        showMore.addEventListener('click', function (e) {
            e.stopPropagation();
            var extras = queryAll('.as-sub-tt-peer-extra', tip);
            for (var i = 0; i < extras.length; i++) extras[i].style.display = '';
            showMore.style.display = 'none';
            showLess.style.display = '';
            showLess.focus({ preventScroll: true });
            var peerList = query('.as-sub-tt-scroll', tip);
            if (peerList) peerList.classList.add('as-sub-tt-expanded');
        });

        showLess.addEventListener('click', function (e) {
            e.stopPropagation();
            var extras = queryAll('.as-sub-tt-peer-extra', tip);
            for (var i = 0; i < extras.length; i++) extras[i].style.display = 'none';
            showLess.style.display = 'none';
            showMore.style.display = '';
            showMore.focus({ preventScroll: true });
            var peerList = query('.as-sub-tt-scroll', tip);
            if (peerList) peerList.classList.remove('as-sub-tt-expanded');
        });
    }
    return Object.freeze({
        summaryAttachCountrySummaryRowHandlers,
        summaryAttachPanelBlankClickHandler,
        summaryAttachInteractiveRowHandlers,
        summaryAttachSummaryRowHandlers,
        summaryAttachProviderClickHandlers,
        summaryAttachGridHandlers,
        summaryAttachProviderNavHandlers,
        summaryAttachSummaryHandlers,
        tooltipAttachPeerRowHoverHandlers,
        tooltipAttachSubTooltipHandlers,
        tooltipAttachSubSubTooltipHandlers,
    });
}
