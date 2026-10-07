import * as panel from './private-panel.js';
import * as networkView from './private-network-view.js';
import * as networkControls from './private-network-controls.js';
import * as peerDetail from './detail.js';
import serviceFlags from './service-flags.js';
import { connectionTypes } from '../core/format.js';
import { create as createLifecycle } from '../core/lifecycle.js';

/** Compose calculations, presentation and interactions for one dashboard.
 * @param {{
 * dashboard: ReturnType<typeof import('../core/dashboard-state.js').create>;
 * distribution: ReturnType<typeof import('../distribution/controller.js').create>;
 * mapView: import('../types').MapView; settings: import('../types').AdvancedSettings;
 * onAction: (action: import('../types').PrivateNetworkAction) => void;
 * document?: Document; clock?: Parameters<typeof createLifecycle>[0]; nowSeconds?: () => number;
 * }} options */
export function create(options) {
    const document = options.document || globalThis.document;
    let lifecycle = createLifecycle(options.clock || document.defaultView || undefined);
    /** @type {ReturnType<typeof networkView.create>} */
    let view;
    /** @type {ReturnType<typeof networkControls.create>} */
    let controls;
    let initialized = false;
    const privatePanel = panel.create({
        state: options.dashboard.privateNetwork, dashboard: options.dashboard,
        document, clock: options.clock, nowSeconds: options.nowSeconds,
        getColor: net => view.getPnNetColor(net),
        onAction(action) {
            if (action.type === 'select') controls.selectPrivatePeer(action.peerId);
            else if (action.type === 'highlight') options.onAction(action);
            else if (action.type === 'redraw') view.renderPnDonut();
            else if (action.type === 'table') options.onAction({ type: 'table' });
        },
    });
    const privatePopup = peerDetail.create({
        getPeers: () => options.dashboard.peers, privateNetwork: true,
        document, clock: options.clock, getNowSeconds: options.nowSeconds,
        connectionTypeLabels: connectionTypes, serviceFlags,
        onRequestClose: () => controls.closePopup(),
        onDisconnect: (peerId, network) => options.onAction({ type: 'disconnect', peerId, network }),
    });
    function init() {
        if (initialized) return;
        initialized = true;
        if (!lifecycle.isActive()) lifecycle = createLifecycle(options.clock || document.defaultView || undefined);
        privatePanel.init();
        const environment = { ...options, document, panel: privatePanel };
        view = networkView.create({ ...environment, lifecycle: lifecycle.replace('view'), bindings: {
            big: svg => controls.bindBig(svg),
            mini: (svg, legend, segments, total) => controls.bindMini(svg, legend, segments, total),
        } });
        controls = networkControls.create({ ...environment, lifecycle: lifecycle.replace('controls'), view, privatePopup });
    }
    function dispose() {
        if (!initialized) return;
        initialized = false;
        controls.dispose();
        view.dispose();
        privatePanel.dispose();
        lifecycle.dispose();
    }
    init();
    return Object.freeze({ init, dispose, privatePanel, privatePopup, cachePnElements: privatePanel.cachePnElements,
        clearPeerFromMap: () => { if (initialized) controls.clearPeerFromMap(); },
        /** @param {number | null} [peerId] @param {string | null} [network] */
        enterPrivateNetMode: (peerId, network) => { if (initialized) controls.enterPrivateNetMode(peerId, network); },
        exitPrivateNetMode: () => { if (initialized) controls.exitPrivateNetMode(); },
        /** @param {number} peerId */
        selectPrivatePeer: peerId => { if (initialized) controls.selectPrivatePeer(peerId); },
        renderPnDonut: () => { if (initialized) view.renderPnDonut(); },
        updatePrivateNetUI: () => { if (initialized) controls.updatePrivateNetUI(); },
        renderPnMiniDonut: () => { if (initialized) view.renderPnMiniDonut(); },
        /** @param {string} network */
        getPnMiniLegendDotPos: network => initialized ? view.getPnMiniLegendDotPos(network) : null,
    });
}
