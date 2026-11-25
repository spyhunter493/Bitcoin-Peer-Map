import { create as createAdminAuthentication } from './core/admin-auth.js';
import { create as createViewingAuthentication } from './core/viewer-auth.js';
import * as support from './core/support.js';
import { create as createWalletTicker } from './wallets/ticker.js';
import { create as createInboundPolicy } from './peers/policy.js';
import { create as createMonitoring } from './monitoring/controller.js';
import { init as initPerformance } from './core/performance.js';
import { create as createSavedViews } from './peers/saved-views.js';

initPerformance();
support.init();
const management = createAdminAuthentication();
management.init();
const walletTicker = createWalletTicker({ management });
walletTicker.init();
const inboundPolicy = createInboundPolicy({ management });
inboundPolicy.init();
const monitoring = createMonitoring({ management });
monitoring.init();
/** @type {ReturnType<typeof import('./map/controller.js').create> | null} */
let dashboard = null;
const savedViews = createSavedViews({ management,
    capturePeers: () => dashboard?.captureView() ?? null,
    applyPeers: state => {
        if (!dashboard) throw new Error('The peer dashboard is unavailable.');
        return dashboard.applyView(state);
    },
    capturePolicy: () => inboundPolicy.captureView(),
    applyPolicy: state => inboundPolicy.applyView(state),
});
savedViews.init();
let generation = 0;
const viewing = createViewingAuthentication({
    onAccess(access, elapsedMs) { management.restore(access, elapsedMs); },
    onSignOut(phase) { management.signOutViewing(phase); },
    async onAuthorized() {
        const current = ++generation;
        const { create } = await import('./map/controller.js');
        if (current !== generation) return;
        dashboard = create();
        dashboard.start();
    },
    onLock() {
        generation++;
        support.close();
        management.reset();
        inboundPolicy.close(false);
        monitoring.close(false);
        savedViews.close(false);
        walletTicker.dispose();
        dashboard?.dispose();
        dashboard = null;
    },
});
void viewing.start();
