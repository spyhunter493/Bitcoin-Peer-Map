import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Settings } from './settings.ts';
import { PreferenceStore, type Preferences } from './preferences.ts';
import { BitcoinRpcClient } from './rpc.ts';
import { GeoDatabase } from './services/geoip.ts';
import { ConnectivityService } from './services/connectivity.ts';
import { PeerService } from './services/peers.ts';
import { NodeService } from './services/node.ts';
import type { NodeMetrics } from './services/node-metrics.ts';
import { UpdateService } from './services/updates.ts';
import { createFailureReporter, createLogger } from './logging.ts';
import { errorMessage } from './types.ts';

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
    readonly metrics: NodeMetrics;
    readonly updates: UpdateService;
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private updateTask: Promise<void> | null = null;
    private started = false;
    private updateFailures = createFailureReporter(createLogger('geoip'));
    constructor(settings: Settings) {
        this.settings = settings;
        this.preferencesStore = new PreferenceStore(join(settings.data_dir, 'settings.json'));
        this.preferences = this.preferencesStore.load();
        if (settings.geoip_auto_update_override !== null) this.preferences.geoip_auto_update = settings.geoip_auto_update_override;
        this.rpc = new BitcoinRpcClient(settings, this.controller.signal);
        this.geoDatabase = new GeoDatabase(settings.data_dir, settings.geoip_enabled, this.controller.signal);
        this.connectivity = new ConnectivityService(this.preferences.geoip_db_only, this.controller.signal);
        this.peers = new PeerService(this.rpc, this.geoDatabase, this.connectivity, this.controller.signal);
        this.node = new NodeService(this.rpc, this.connectivity, this.geoDatabase, () => this.preferences.geoip_auto_update, settings.bitcoin_network);
        this.metrics = this.node.metrics;
        this.updates = new UpdateService(settings, this.controller.signal);
    }
    async start() {
        this.controller.signal.throwIfAborted();
        if (this.started) return;
        mkdirSync(this.settings.data_dir, { recursive: true });
        this.preferencesStore.save(this.preferences);
        this.geoDatabase.initialize();
        this.started = true;
        this.connectivity.ensureChecker();
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
        await Promise.allSettled([this.peers.stop(), this.connectivity.stop(), this.updates.stop(), this.updateTask]);
        this.geoDatabase.close();
    }
    setGeoipAutoUpdate(enabled: boolean) {
        if (this.preferences.geoip_auto_update === enabled) return enabled;
        // Synchronous atomic writes make each read-modify-write indivisible on this event loop.
        const preferences = { ...this.preferences, geoip_auto_update: enabled };
        this.preferencesStore.save(preferences);
        this.preferences = preferences;
        this.scheduleUpdate(0);
        return preferences.geoip_auto_update;
    }
    setGeoipDbOnly(enabled: boolean) {
        if (this.preferences.geoip_db_only === enabled) return enabled;
        const preferences = { ...this.preferences, geoip_db_only: enabled };
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
                if (this.controller.signal.aborted) return;
                if (result.success) this.updateFailures.recovered('Automatic GeoIP update recovered');
                else this.updateFailures.failure(`Automatic GeoIP update failed: ${result.message}`);
            }).catch(error => { if (!this.controller.signal.aborted) this.updateFailures.failure(`Automatic GeoIP update failed: ${errorMessage(error)}`, 'error'); }).finally(() => {
                this.updateTask = null;
                this.scheduleUpdate(GEOIP_UPDATE_INTERVAL_MS);
            });
        }, delay);
    }
}
