import { create } from './map/controller.js';
import { create as createAdminAuthentication } from './core/admin-auth.js';

createAdminAuthentication().init();
create().start();
