/* Tooltip placement, pinning, peer previews, and peer selection. */
(function (global) {
    'use strict';

    function create(options) {
        const distributionState = options.state;
        const sourceData = options.data;
        const elements = options.elements;
        const hooks = options.hooks;
        const actions = options.actions;
        const distributionData = global.BPMDistributionData;

        let pinnedSubTooltipSrc = null;

        function isPinnedTo(element) {
            return distributionState.subTooltipPinned && pinnedSubTooltipSrc === element;
        }

        function attachPeerRowHoverHandlers(tip) {
            var peerRows = tip.querySelectorAll('.as-sub-tt-peer[data-peer-id]');
            for (var pri = 0; pri < peerRows.length; pri++) {
                (function (row) {
                    row.addEventListener('mouseenter', function () {
                        var peerId = parseInt(row.dataset.peerId);
                        if (isNaN(peerId)) return;
                        distributionState.hoveredPeerId = peerId; // Track for update preservation
                        if (distributionState.summarySelected) {
                            actions.previewSummaryLines([peerId]);
                        } else if (distributionState.selectedProvider) {
                            actions.previewProviderLines([peerId]);
                        }
                        // Preview this peer in the popup if a different peer is selected
                        if (distributionState.peerDetailActive && peerId !== distributionState.selectedPeerId) {
                            var peer = sourceData.peers.find(function (p) { return p.id === peerId; });
                            if (peer) actions.previewPeerInPopup(peer);
                        }
                        // In focused mode, show peer info in donut center or update insight rect
                        if (distributionState.donutFocused) {
                            var peer = sourceData.peers.find(function (p) { return p.id === peerId; });
                            if (peer) {
                                var asNum = row.dataset.as || distributionData.parseAsNumber(peer.as);
                                var color = asNum ? actions.getColorForAsNum(asNum) : '#6e7681';
                                if (options.donut.isInsightVisible()) {
                                    actions.updateInsightRectForPeer(peer, color);
                                } else {
                                    actions.showPeerInDonutCenter(peer, color);
                                    // Keep donut expanded for the provider context
                                    if (distributionState.filterCategory && distributionState.filterCategory.indexOf('conn-') === 0 && distributionState.filterLabel) {
                                        actions.animateDonutExpand(distributionState.filterLabel);
                                    }
                                }
                            }
                        }
                    });
                    row.addEventListener('mouseleave', function () {
                        distributionState.hoveredPeerId = null;

                        // If a peer is selected (popup open), restore to that peer's state
                        if (distributionState.peerDetailActive && distributionState.selectedPeerId) {
                            actions.restorePeerPopupToSelected();
                            var selPeer = sourceData.peers.find(function (p) { return p.id === distributionState.selectedPeerId; });
                            if (selPeer) {
                                var selAsNum = distributionData.parseAsNumber(selPeer.as);
                                var selColor = selAsNum ? actions.getColorForAsNum(selAsNum) : '#6e7681';
                                // Restore line/filter to selected peer
                                if (hooks.drawLinesForAs && selAsNum) hooks.drawLinesForAs(selAsNum, [distributionState.selectedPeerId], selColor);
                                if (hooks.filterPeerTable) hooks.filterPeerTable([distributionState.selectedPeerId]);
                                if (hooks.dimMapPeers) hooks.dimMapPeers([distributionState.selectedPeerId]);
                                // Restore donut center / insight rect to selected peer
                                if (distributionState.donutFocused) {
                                    if (options.donut.isInsightVisible()) {
                                        actions.updateInsightRectForPeer(selPeer, selColor);
                                    } else {
                                        actions.showPeerInDonutCenter(selPeer, selColor);
                                    }
                                }
                            }
                            return;
                        }

                        // Restore lines/filter to parent state (selected provider or summary sub-filter)
                        if (distributionState.summarySelected) {
                            actions.restoreSummaryFromPreview();
                        } else if (distributionState.selectedProvider) {
                            actions.restoreProviderFromPreview();
                        }
                        // Restore donut center display
                        if (distributionState.donutFocused) {
                            if (options.donut.isInsightVisible()) {
                                actions.restoreInsightRectProvider();
                            } else if (distributionState.filterCategory && distributionState.filterCategory.indexOf('conn-') === 0 && distributionState.filterLabel) {
                                // Restore donut to show the provider (keep expanded)
                                actions.showFocusedCenterText(distributionState.filterLabel);
                                actions.animateDonutExpand(distributionState.filterLabel);
                            } else if (distributionState.selectedProvider) {
                                actions.renderCenter();
                            } else {
                                actions.renderCenter();
                            }
                        }
                    });
                })(peerRows[pri]);
            }
        }

        function attachSubTooltipHandlers() {
            var tip = document.getElementById('as-sub-tooltip');
            if (!tip) return;

            // Peer ID click → zoom to peer on map and open the large peer detail popup
            var idLinks = tip.querySelectorAll('.as-sub-tt-id-link');
            for (var li = 0; li < idLinks.length; li++) {
                (function (link) {
                    link.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var peerId = parseInt(link.dataset.peerId);
                        if (isNaN(peerId)) return;
                        // Zoom to peer on map — panel stays open for navigation
                        if (hooks.zoomToPeerOnly) hooks.zoomToPeerOnly(peerId);
                        // Find the peer data and open the large popup
                        var peer = sourceData.peers.find(function (p) { return p.id === peerId; });
                        if (peer) {
                            actions.openPeerDetailPanel(peer, 'panel');
                            highlightSelectedPeerRow(peerId);
                        }
                    });
                })(idLinks[li]);
            }

            // Peer row hover → preview line to individual peer
            attachPeerRowHoverHandlers(tip);

            var showMore = tip.querySelector('.as-sub-tt-show-more');
            var showLess = tip.querySelector('.as-sub-tt-show-less');
            if (!showMore || !showLess) return;

            showMore.addEventListener('click', function (e) {
                e.stopPropagation();
                // Show all extra peers
                var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
                for (var i = 0; i < extras.length; i++) {
                    extras[i].style.display = '';
                }
                showMore.style.display = 'none';
                showLess.style.display = '';

                // Add scroll container class if many peers
                var peerList = tip.querySelector('.as-sub-tt-scroll');
                if (peerList) peerList.classList.add('as-sub-tt-expanded');
            });

            showLess.addEventListener('click', function (e) {
                e.stopPropagation();
                // Hide extra peers
                var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
                for (var i = 0; i < extras.length; i++) {
                    extras[i].style.display = 'none';
                }
                showLess.style.display = 'none';
                showMore.style.display = '';

                var peerList = tip.querySelector('.as-sub-tt-scroll');
                if (peerList) peerList.classList.remove('as-sub-tt-expanded');
            });
        }

        function showSubTooltip(html, event) {
            // Always close sub-sub tooltip when opening a new sub-tooltip
            hideSubSubTooltip();
            var tip = document.getElementById('as-sub-tooltip');
            if (!tip) {
                tip = document.createElement('div');
                tip.id = 'as-sub-tooltip';
                tip.className = 'as-sub-tooltip';
                document.body.appendChild(tip);
            }
            tip.innerHTML = html;
            tip.classList.remove('hidden');
            tip.style.display = '';
            positionSubTooltip(event);
            attachSubTooltipHandlers();
        }

        function positionSubTooltip(event) {
            var tip = document.getElementById('as-sub-tooltip');
            if (!tip) return;
            var rect = tip.getBoundingClientRect();
            var pad = 12;
            // Position to the left of the detail panel
            var panelRect = elements.panel ? elements.panel.getBoundingClientRect() : { left: window.innerWidth };
            var x = panelRect.left - rect.width - pad;
            if (x < pad) x = pad;
            var y = event.clientY - rect.height / 2;
            if (y < pad) y = pad;
            if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
        }

        function hideSubTooltip() {
            var tip = document.getElementById('as-sub-tooltip');
            if (tip) {
                tip.classList.add('hidden');
                tip.style.display = 'none';
                tip.style.pointerEvents = 'none';
            }
            distributionState.subTooltipPinned = false;
            pinnedSubTooltipSrc = null;
            hideSubSubTooltip();
        }

        function pinSubTooltip(srcEl) {
            distributionState.subTooltipPinned = true;
            pinnedSubTooltipSrc = srcEl || null;
            var tip = document.getElementById('as-sub-tooltip');
            if (tip) tip.style.pointerEvents = 'auto';
        }

        function showSubSubTooltip(html, event) {
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
            positionSubSubTooltip(event);
            attachSubSubTooltipHandlers();
        }

        function positionSubSubTooltip(event) {
            var tip = document.getElementById('as-sub-sub-tooltip');
            if (!tip) return;
            var subTip = document.getElementById('as-sub-tooltip');
            var rect = tip.getBoundingClientRect();
            var pad = 12;
            // Position to the left of the sub-tooltip
            var anchor = subTip ? subTip.getBoundingClientRect() : (elements.panel ? elements.panel.getBoundingClientRect() : { left: window.innerWidth });
            var x = anchor.left - rect.width - pad;
            if (x < pad) x = pad;
            var y = event ? event.clientY - rect.height / 2 : anchor.top;
            if (y < pad) y = pad;
            if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
        }

        function hideSubSubTooltip() {
            var tip = document.getElementById('as-sub-sub-tooltip');
            if (tip) {
                tip.classList.add('hidden');
                tip.style.display = 'none';
                tip.style.pointerEvents = 'none';
            }
            distributionState.subSubTooltipPinned = false;
            distributionState.subSubFilterPeerIds = null;
            distributionState.subSubFilterProvider = null;
            distributionState.subSubFilterColor = null;
            // Clear provider row selection highlight in the sub-tooltip
            var subTip = document.getElementById('as-sub-tooltip');
            if (subTip) {
                var prevSel = subTip.querySelectorAll('.as-provider-row-selected');
                for (var si = 0; si < prevSel.length; si++) prevSel[si].classList.remove('as-provider-row-selected');
            }
            // Clear legend focus when sub-sub dismisses
            if (distributionState.legendFocusProvider) {
                distributionState.legendFocusProvider = null;
                actions.renderLegend();
            }
        }

        function attachSubSubTooltipHandlers() {
            var tip = document.getElementById('as-sub-sub-tooltip');
            if (!tip) return;

            // Peer ID click → zoom to peer on map and open the large peer detail popup
            var idLinks = tip.querySelectorAll('.as-sub-tt-id-link');
            for (var li = 0; li < idLinks.length; li++) {
                (function (link) {
                    link.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var peerId = parseInt(link.dataset.peerId);
                        if (isNaN(peerId)) return;
                        // Zoom to peer on map — panel stays open for navigation
                        if (hooks.zoomToPeerOnly) hooks.zoomToPeerOnly(peerId);
                        // Find the peer data and open the large popup
                        var peer = sourceData.peers.find(function (p) { return p.id === peerId; });
                        if (peer) {
                            actions.openPeerDetailPanel(peer, 'panel');
                            highlightSelectedPeerRow(peerId);
                        }
                    });
                })(idLinks[li]);
            }

            // Peer row hover → preview line to individual peer
            attachPeerRowHoverHandlers(tip);

            var showMore = tip.querySelector('.as-sub-tt-show-more');
            var showLess = tip.querySelector('.as-sub-tt-show-less');
            if (!showMore || !showLess) return;

            showMore.addEventListener('click', function (e) {
                e.stopPropagation();
                var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
                for (var i = 0; i < extras.length; i++) extras[i].style.display = '';
                showMore.style.display = 'none';
                showLess.style.display = '';
                var peerList = tip.querySelector('.as-sub-tt-scroll');
                if (peerList) peerList.classList.add('as-sub-tt-expanded');
            });

            showLess.addEventListener('click', function (e) {
                e.stopPropagation();
                var extras = tip.querySelectorAll('.as-sub-tt-peer-extra');
                for (var i = 0; i < extras.length; i++) extras[i].style.display = 'none';
                showLess.style.display = 'none';
                showMore.style.display = '';
                var peerList = tip.querySelector('.as-sub-tt-scroll');
                if (peerList) peerList.classList.remove('as-sub-tt-expanded');
            });
        }

        function highlightSelectedPeerRow(peerId) {
            distributionState.selectedPeerId = peerId;
            // Remove previous selected highlights
            var allSelected = document.querySelectorAll('.as-sub-tt-peer-selected');
            for (var i = 0; i < allSelected.length; i++) allSelected[i].classList.remove('as-sub-tt-peer-selected');
            // Add highlight to matching row(s)
            var tips = [document.getElementById('as-sub-tooltip'), document.getElementById('as-sub-sub-tooltip')];
            for (var ti = 0; ti < tips.length; ti++) {
                if (!tips[ti]) continue;
                var rows = tips[ti].querySelectorAll('.as-sub-tt-peer[data-peer-id]');
                for (var ri = 0; ri < rows.length; ri++) {
                    if (parseInt(rows[ri].dataset.peerId) === peerId) {
                        rows[ri].classList.add('as-sub-tt-peer-selected');
                    }
                }
            }
        }

        return Object.freeze({
            attachSubTooltipHandlers,
            showSubTooltip,
            positionSubTooltip,
            hideSubTooltip,
            pinSubTooltip,
            showSubSubTooltip,
            hideSubSubTooltip,
            isPinnedTo,
        });
    }

    global.BPMDistributionTooltips = Object.freeze({ create });
})(window);
