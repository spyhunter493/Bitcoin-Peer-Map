/** @typedef {object} Options
 * @property {HTMLCanvasElement} canvas
 * @property {import('../types').MapInteraction} interaction
 * @property {import('../types').PrivateNetworkState} privateState
 * @property {Pick<ReturnType<typeof import('../peers/private-network.js').create>,
 * 'privatePanel' | 'privatePopup' | 'cachePnElements' | 'enterPrivateNetMode' |
 * 'exitPrivateNetMode' | 'updatePrivateNetUI'>} privateNetwork
 * @property {Pick<ReturnType<typeof import('../node/dashboard.js').create>,
 * 'openNodeInfoModal' | 'openRecentBlocksModal' | 'openGeoDBDropdown' | 'openChainTipsModal'>} nodeDashboard
 * @property {ReturnType<typeof import('../settings/preferences.js').create>['openDisplaySettingsPopup']} openDisplaySettingsPopup
 * @property {() => void} onPanelResize
 */

/** Binds dashboard buttons and private-network controls.
 * @param {Options} options
 */
export function create(options) {
    const { canvas, interaction, privateState, openDisplaySettingsPopup } = options;
    const { privatePanel, privatePopup, cachePnElements, enterPrivateNetMode,
        exitPrivateNetMode, updatePrivateNetUI } = options.privateNetwork;
    const { openNodeInfoModal, openRecentBlocksModal, openGeoDBDropdown,
        openChainTipsModal } = options.nodeDashboard;

    const minimizeBtn = document.getElementById('btn-minimize');

    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = document.getElementById('peer-panel');
            if (panel) {
                panel.classList.toggle('collapsed');
                const isCollapsed = panel.classList.contains('collapsed');
                minimizeBtn.innerHTML = isCollapsed ? '&#9650;' : '&#9660;';
                minimizeBtn.title = isCollapsed ? 'Show peer list table' : 'Hide peer list table';
                minimizeBtn.setAttribute('aria-expanded', String(!isCollapsed));
                minimizeBtn.setAttribute('aria-label', minimizeBtn.title);
                options.onPanelResize();
            }
        });
    }

    function init() {
        // NODE-INFO button in peer panel handle
        const nodeInfoPeerBtn = document.getElementById('btn-node-info-peer');
        if (nodeInfoPeerBtn) {
            nodeInfoPeerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openNodeInfoModal();
            });
        }

        // BLOCKS button in peer panel handle
        const recentBlocksBtn = document.getElementById('btn-recent-blocks');
        if (recentBlocksBtn) {
            recentBlocksBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openRecentBlocksModal();
            });
        }

        // GEOIP-DB button in peer panel handle
        const geoipDbPeerButton = document.getElementById('btn-geoip-db-peer');
        if (geoipDbPeerButton) {
            geoipDbPeerButton.addEventListener('click', (e) => {
                e.stopPropagation();
                openGeoDBDropdown();
            });
        }

        // CHAIN-TIPS button in peer panel handle
        const chainTipsButton = document.getElementById('btn-chain-tips');
        if (chainTipsButton) {
            chainTipsButton.addEventListener('click', (e) => {
                e.stopPropagation();
                openChainTipsModal();
            });
        }

        // Topbar gear icon → open primary Map Settings popup
        const topbarGear = document.getElementById('topbar-gear');
        if (topbarGear) {
            topbarGear.addEventListener('click', (e) => {
                e.stopPropagation();
                openDisplaySettingsPopup(topbarGear);
            });
        }

        // Topbar countdown → open display settings
        const topbarCountdown = document.getElementById('topbar-countdown');
        if (topbarCountdown) {
            topbarCountdown.addEventListener('click', (e) => {
                e.stopPropagation();
                openDisplaySettingsPopup(topbarCountdown);
            });
        }

        // Topbar status message → open display settings
        const topbarStatusMsg = document.getElementById('mo-status-msg');
        if (topbarStatusMsg) {
            topbarStatusMsg.style.cursor = 'pointer';
            topbarStatusMsg.addEventListener('click', (e) => {
                e.stopPropagation();
                openDisplaySettingsPopup(topbarStatusMsg);
            });
        }

        // [PRIVATE-NET] Mini donut: hover → draw lines to private peers, click → enter private mode
        const pnMiniDonut = document.getElementById('pn-mini-donut');
        if (pnMiniDonut) {
            pnMiniDonut.addEventListener('click', (e) => {
                e.stopPropagation();
                enterPrivateNetMode();
                if (e.target instanceof Element && e.target.closest('button')) document.getElementById('pn-detail-close')?.focus({ preventScroll: true });
            });
            pnMiniDonut.addEventListener('mouseenter', () => {
                if (!privateState.privateNetMode) privateState.pnMiniHover = true;
            });
            pnMiniDonut.addEventListener('mouseleave', () => {
                privateState.pnMiniHover = false;
                privateState.pnMiniHoverNet = null;
            });
        }

        // [PRIVATE-NET] Exit button on donut
        const pnExitBtn = document.getElementById('pn-exit-btn');
        if (pnExitBtn) {
            pnExitBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                exitPrivateNetMode();
                document.getElementById('pn-mini-trigger')?.focus({ preventScroll: true });
            });
        }

        // [PRIVATE-NET] Donut center click → open overview panel
        const pnDonutCenterEl = document.getElementById('pn-donut-center');
        if (pnDonutCenterEl) {
            pnDonutCenterEl.style.pointerEvents = 'auto';
            pnDonutCenterEl.style.cursor = 'pointer';
            const showPrivateOverview = (/** @type {MouseEvent} */ e) => {
                e.stopPropagation();
                // If a peer is selected, deselect it first
                if (privateState.privateNetSelectedPeerId !== null) {
                    privateState.privateNetSelectedPeerId = null;
                    privateState.privateNetLinePeer = null;
                    interaction.pinnedNode = null;
                    interaction.highlightedPeerId = null;
                    privatePopup.close();
                }
                // Move donut to center and open overview panel
                cachePnElements();
                if (privateState.pnContainerEl) privateState.pnContainerEl.classList.add('pn-focused');
                privatePanel.openPnOverviewPanel();
                updatePrivateNetUI();
                if (e.currentTarget instanceof HTMLButtonElement) document.getElementById('pn-detail-close')?.focus({ preventScroll: true });
            };
            pnDonutCenterEl.addEventListener('click', showPrivateOverview);
            document.getElementById('pn-overview-trigger')?.addEventListener('click', showPrivateOverview);
        }

        // [PRIVATE-NET] Detail panel close button → exit private mode entirely
        const pnDetailClose = document.getElementById('pn-detail-close');
        if (pnDetailClose) {
            pnDetailClose.addEventListener('click', (e) => {
                e.stopPropagation();
                exitPrivateNetMode();
                document.getElementById('pn-mini-trigger')?.focus({ preventScroll: true });
            });
        }

        // [PRIVATE-NET] Detail panel back button → go back to overview
        const pnDetailBack = document.getElementById('pn-detail-back');
        if (pnDetailBack) {
            pnDetailBack.addEventListener('click', (e) => {
                e.stopPropagation();
                privateState.pnSelectedNet = null;
                privatePanel.hidePnSubTooltip();
                privatePanel.updatePnOverviewPanel();
                updatePrivateNetUI();
                // Show/hide back button
                pnDetailBack.classList.add('hidden');
            });
        }

        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || event.defaultPrevented || !privateState.privateNetMode ||
                document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            event.preventDefault();
            const popupClose = document.querySelector('.pn-big-popup.visible .peer-popup-close');
            if (popupClose instanceof HTMLButtonElement) popupClose.click();
            else if (privateState.pnSubTooltipPinned) {
                privatePanel.hidePnSubTooltip();
                updatePrivateNetUI();
            } else if (privateState.pnSelectedNet) document.getElementById('pn-detail-back')?.click();
            else document.getElementById('pn-exit-btn')?.click();
        });

        // [PRIVATE-NET] Double-click on canvas to exit private net mode
        canvas.addEventListener('dblclick', (e) => {
            if (privateState.privateNetMode) {
                e.preventDefault();
                e.stopPropagation();
                exitPrivateNetMode();
            }
        });
    }

    return Object.freeze({ init });
}
