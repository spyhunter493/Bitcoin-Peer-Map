import { create as createAdminAuthentication } from './core/admin-auth.js';
import { create as createViewingAuthentication } from './core/viewer-auth.js';
import * as support from './core/support.js';
import { create as createWalletTicker } from './wallets/ticker.js';

support.init();
const management = createAdminAuthentication();
management.init();
const walletTicker = createWalletTicker({ management });
walletTicker.init();
/** @type {ReturnType<typeof import('./map/controller.js').create> | null} */
let dashboard = null;
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
        walletTicker.dispose();
        dashboard?.dispose();
        dashboard = null;
    },
});
void viewing.start();
