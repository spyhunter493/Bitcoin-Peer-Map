/* Shared private-network selection, preview, and cached element state. */
(function (global) {
    'use strict';
    /** @returns {import('../types').PrivateNetworkState} */
    function create() {
        return {
            privateNetMode: false,
            privateNetSelectedPeer: null,
            privateNetLinePeer: null,
            pnBigPopupEl: null,
            pnMiniHover: false,
            pnPreviewPeerIds: null,
            pnMiniHoverNet: null,
            pnInsightRectEl: null,
            pnInsightRectVisible: false,
            pnInsightActiveType: null,
            pnInsightActivePeerId: null,
            pnInsightActiveData: null,
            pnContainerEl: null,
            pnDonutSvg: null,
            pnCenterCount: null,
            pnCenterLabel: null,
            pnCenterSub: null,
            pnDetailPanelEl: null,
            pnDetailBodyEl: null,
            pnDetailBodyHandlerAttached: false,
            pnDetailNetNameEl: null,
            pnDetailMetaEl: null,
            pnSegments: [],
            pnSelectedNet: null,
            pnHoveredNet: null,
            pnPopupTimer: null,
            pnSubTooltipPinned: false,
            pnPinnedSubSrc: null,
            pnCenterPreviewLabel: null,
            pnCenterPreviewPeerIds: null,
        };
    }
    global.BPMPrivateNetworkState = Object.freeze({ create });
})(window);
