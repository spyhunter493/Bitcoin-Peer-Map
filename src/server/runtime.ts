import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Settings } from './settings.ts';
import { PreferenceStore, type Preferences } from './preferences.ts';
import { BitcoinRpcClient } from './rpc.ts';
import { GeoDatabase } from './services/geoip.ts';
import { ConnectivityService } from './services/connectivity.ts';
import { PeerService } from './services/peers.ts';
import { NodeService } from './services/node.ts';
import { SystemMetrics } from './services/system-metrics.ts';
import { UpdateService } from './services/updates.ts';

export const GEOIP_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export class AppRuntime {
    readonly settings: Settings;
    readonly controller = new AbortController();
    readonly preferencesStore: PreferenceStore;
    preferences: Preferences;
    readonly rpc: BitcoinRpcClient;
    readonly geoDatabase: GeoDatabase;
    readonly connectivity: ConnectivityService;
    readonly peers: PeerService;
    readonly node: NodeService;
    readonly metrics = new SystemMetrics();
    readonly updates: UpdateService;
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private updateTask: Promise<void> | null = null;
    private started = false;
    constructor(settings: Settings) {
        this.settings = settings;
        this.preferencesStore = new PreferenceStore(join(settings.data_dir, 'settings.json'));
        this.preferences = this.preferencesStore.load();
        if (settings.geoip_auto_update_override !== null) this.preferences.geoip_auto_update = settings.geoip_auto_update_override;
        this.rpc = new BitcoinRpcClient(settings, this.controller.signal);
        this.geoDatabase = new GeoDatabase(settings.data_dir, settings.geoip_enabled, this.controller.signal);
        this.connectivity = new ConnectivityService(this.preferences.geoip_db_only, this.controller.signal);
        this.peers = new PeerService(this.rpc, this.geoDatabase, this.connectivity, this.controller.signal);
        this.node = new NodeService(this.rpc, this.connectivity, this.geoDatabase, () => this.preferences.geoip_auto_update);
        this.updates = new UpdateService(settings, this.controller.signal);
    }
    async start() {
        this.controller.signal.throwIfAborted();
        if (this.started) return;
        mkdirSync(this.settings.data_dir, { recursive: true });
        this.preferencesStore.save(this.preferences);
        this.geoDatabase.initialize();
        this.started = true;
        this.metrics.start();
        await this.peers.start();
        this.controller.signal.throwIfAborted();
        this.scheduleUpdate(0);
        this.updates.start();
    }
    async stop() {
        this.started = false;
        this.controller.abort();
        if (this.updateTimer) clearTimeout(this.updateTimer);
        this.updateTimer = null;
        await Promise.allSettled([this.peers.stop(), this.metrics.stop(), this.connectivity.stop(), this.updates.stop(), this.updateTask]);
        this.geoDatabase.close();
    }
    toggleGeoipAutoUpdate() {
        // Synchronous atomic writes make each read-modify-write indivisible on this event loop.
        const preferences = { ...this.preferences, geoip_auto_update: !this.preferences.geoip_auto_update };
        this.preferencesStore.save(preferences);
        this.preferences = preferences;
        this.scheduleUpdate(0);
        return preferences.geoip_auto_update;
    }
    toggleGeoipApi() {
        const preferences = { ...this.preferences, geoip_db_only: !this.preferences.geoip_db_only };
        this.preferencesStore.save(preferences);
        this.preferences = preferences;
        this.connectivity.setGeoipApiDisabled(preferences.geoip_db_only);
        return preferences.geoip_db_only;
    }
    private scheduleUpdate(delay: number) {
        if (this.updateTimer) clearTimeout(this.updateTimer);
        this.updateTimer = null;
        if (!this.started || this.controller.signal.aborted || !this.geoDatabase.enabled || !this.preferences.geoip_auto_update || this.updateTask) return;
        this.updateTimer = setTimeout(() => {
            this.updateTimer = null;
            this.updateTask = this.geoDatabase.update().then(result => {
                if (!result.success && !this.controller.signal.aborted) console.warn(`Automatic GeoIP update failed: ${result.message}`);
            }).catch(error => { if (!this.controller.signal.aborted) console.error(error); }).finally(() => {
                this.updateTask = null;
                this.scheduleUpdate(GEOIP_UPDATE_INTERVAL_MS);
            });
        }, delay);
    }
}
