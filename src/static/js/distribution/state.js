/** @type {Readonly<import('../types').DistributionValues>} */
const DEFAULTS = Object.freeze({
    selectedProvider: null,
    summarySelected: false,
    activeNetwork: null,
    lens: 'provider',
    hoveredProvider: null,
    hoveringAll: false,
    focusedHoverProvider: null,
    legendFocusProvider: null,
    hoveredPeerId: null,
    summaryPreviewPeerIds: null,
    summaryPreviewLabel: null,
    filterPeerIds: null,
    filterDescriptor: null,
    filterLabel: null,
    filterCategory: null,
    subTooltipPinned: false,
    subSubTooltipPinned: false,
    subSubFilterPeerIds: null,
    subSubFilterProvider: null,
    subSubFilterColor: null,
    panelHistory: [],
    // Shared by summary, tooltip, donut, and peer-detail controllers.
    donutFocused: false,
    peerDetailActive: false,
    selectedPeerId: null,
    insightActiveAsNum: null,
    insightActiveType: null,
    insightActiveData: null,
});

/** @param {Partial<import('../types').DistributionValues>} [initialValues] */
function create(initialValues) {
    const values = Object.assign({}, DEFAULTS, initialValues || {});
    values.panelHistory = Array.isArray(values.panelHistory) ? values.panelHistory.slice() : [];

    function resetFilters() {
        values.filterPeerIds = null;
        values.filterDescriptor = null;
        values.filterLabel = null;
        values.filterCategory = null;
        values.subTooltipPinned = false;
        values.subSubTooltipPinned = false;
        values.subSubFilterPeerIds = null;
        values.subSubFilterProvider = null;
        values.subSubFilterColor = null;
    }

    function clearHover() {
        values.hoveredProvider = null;
        values.hoveringAll = false;
        values.focusedHoverProvider = null;
        values.legendFocusProvider = null;
        values.hoveredPeerId = null;
        values.summaryPreviewPeerIds = null;
        values.summaryPreviewLabel = null;
    }

    function resetNavigation() {
        values.selectedProvider = null;
        values.summarySelected = false;
        values.activeNetwork = null;
        values.panelHistory = [];
        clearHover();
        resetFilters();
    }

    /** @param {string} lens */
    function setLens(lens) {
        if (lens !== 'provider' && lens !== 'country') return false;
        values.lens = lens;
        return true;
    }

    function snapshot() {
        const result = Object.assign({}, values);
        result.panelHistory = values.panelHistory.slice();
        if (values.filterPeerIds) result.filterPeerIds = values.filterPeerIds.slice();
        if (values.subSubFilterPeerIds) {
            result.subSubFilterPeerIds = values.subSubFilterPeerIds.slice();
        }
        if (values.summaryPreviewPeerIds) {
            result.summaryPreviewPeerIds = values.summaryPreviewPeerIds.slice();
        }
        return result;
    }

    const controller = { resetFilters, clearHover, resetNavigation, setLens, snapshot };
    for (const key of /** @type {(keyof import('../types').DistributionValues)[]} */ (Object.keys(DEFAULTS))) {
        /** @template {keyof import('../types').DistributionValues} K @param {K} key */
        function define(key) {
            Object.defineProperty(controller, key, {
                enumerable: true,
                get: () => values[key],
                /** @param {import('../types').DistributionValues[K]} value */
                set: (value) => {
                    if (key === 'filterCategory' && value !== values[key] && value !== 'summary') values.filterDescriptor = null;
                    values[key] = value;
                    if (key === 'filterCategory' && value === null) values.filterDescriptor = null;
                },
            });
        }
        define(key);
    }
    return /** @type {typeof controller & import('../types').DistributionValues} */ (Object.freeze(controller));
}

export { create };
