import * as panelView from './private-panel-view.js';
import * as panelControls from './private-panel-controls.js';
import { create as createLifecycle } from '../core/lifecycle.js';
import { fmtBytesShort } from '../core/format.js';

/** Compose one explicitly supplied dashboard's private panel.
 * @param {import('../types').PrivatePanelOptions & {
 * dashboard: ReturnType<typeof import('../core/dashboard-state.js').create>;
 * document?: Document; clock?: Parameters<typeof createLifecycle>[0]; nowSeconds?: () => number;
 * }} options */
export function create(options) {
    const document = options.document || globalThis.document;
    const nowSeconds = options.nowSeconds || (() => Math.floor(Date.now() / 1000));
    let lifecycle = createLifecycle(options.clock || document.defaultView || undefined);
    /** @type {ReturnType<typeof panelView.create>} */
    let view;
    /** @type {ReturnType<typeof panelControls.create>} */
    let controls;
    let initialized = false;
    function init() {
        if (initialized) return;
        initialized = true;
        if (!lifecycle.isActive()) lifecycle = createLifecycle(options.clock || document.defaultView || undefined);
        const environment = { ...options, document, nowSeconds };
        view = panelView.create({ ...environment, lifecycle: lifecycle.replace('view'), bindings: {
            detail: (body, peers) => controls.bindDetail(body, peers),
            overview: (body, peers) => controls.bindOverview(body, peers),
            insight: root => controls.bindInsight(root),
            hidePopover: () => controls.hidePnSubTooltip(),
        } });
        controls = panelControls.create({ ...environment, lifecycle: lifecycle.replace('controls'), view });
    }
    function dispose() {
        if (!initialized) return;
        initialized = false;
        controls.dispose();
        view.dispose();
        lifecycle.dispose();
    }
    init();
    return Object.freeze({ init, dispose, fmtBytesShort,
        cachePnElements: () => { if (initialized) view.cachePnElements(); },
        refreshPinnedPreview: () => { if (initialized) controls.refreshPinnedPreview(); },
        /** @param {string} net */
        openPnDetailPanel: net => { if (initialized) view.openPnDetailPanel(net); },
        closePnDetailPanel: () => { if (initialized) view.closePnDetailPanel(); },
        /** @param {string} net */
        updatePnDetailPanel: net => { if (initialized) view.updatePnDetailPanel(net); },
        openPnOverviewPanel: () => { if (initialized) view.openPnOverviewPanel(); },
        updatePnOverviewPanel: () => { if (initialized) view.updatePnOverviewPanel(); },
        /** @param {string} type @param {import('../types').PrivateInsight} data */
        showPnInsightRect: (type, data) => { if (initialized) view.showPnInsightRect(type, data); },
        hidePnInsightRect: () => { if (initialized) view.hidePnInsightRect(); },
        clearPnInsightState: () => { if (initialized) controls.clearPnInsightState(); },
        getPnInsightRectOrigin: () => initialized ? view.getPnInsightRectOrigin() : null,
        /** @param {import('../types').Peer} peer @param {string} type */
        buildPnInsightData: (peer, type) => view.buildPnInsightData(peer, type),
        hidePnSubTooltip: () => { if (initialized) controls.hidePnSubTooltip(); },
    });
}
