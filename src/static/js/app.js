import { create as createAdminAuthentication } from './core/admin-auth.js';
import { create as createViewingAuthentication } from './core/viewer-auth.js';
import * as support from './core/support.js';

support.init();
const management = createAdminAuthentication();
management.init();
/** @type {ReturnType<typeof import('./map/controller.js').create> | null} */
let dashboard = null;
let generation = 0;
const viewing = createViewingAuthentication({
    onAccess(access) { management.restore(Boolean(access.management_authenticated)); },
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
        dashboard?.dispose();
        dashboard = null;
    },
});
void viewing.start();
