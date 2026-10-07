import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '../settings.ts';
import { object, errorMessage, nowSeconds } from '../types.ts';
import { GITHUB_REPOSITORY, REPOSITORY_URL, isNewerRelease, parseReleaseVersion } from '../build.ts';
import { createFailureReporter, createLogger } from '../logging.ts';

const log = createLogger('updates');

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export type { UpdateStatus } from '../../shared/api.generated.d.ts';
import type { UpdateStatus } from '../../shared/api.generated.d.ts';

export class UpdateService {
    private status: UpdateStatus = { update_available: false, latest_version: null, changes_url: null, checked_at: null, check_failed: false };
    private timer: ReturnType<typeof setTimeout> | null = null;
    private pending: Promise<void> | null = null;
    private controller = new AbortController();
    private started = false;
    private readonly signal: AbortSignal;
    private readonly cachePath: string;
    private readonly version: string;
    private readonly fetcher: typeof fetch;
    private checkFailures = createFailureReporter(log);
    private saveFailures = createFailureReporter(log);

    constructor(settings: Settings, signal?: AbortSignal, fetcher = fetch) {
        this.version = settings.build_version;
        this.cachePath = join(settings.data_dir, 'update-check.json');
        this.signal = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
        this.fetcher = fetcher;
        this.loadCache();
    }

    snapshot(): UpdateStatus { return { ...this.status }; }
    start() {
        if (this.started || this.signal.aborted || !parseReleaseVersion(this.version)) return;
        this.started = true;
        this.schedule();
    }
    async stop() {
        this.started = false;
        this.controller.abort();
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        await this.pending;
    }
    private releaseStatus(latest: string | null) {
        const available = latest !== null && isNewerRelease(this.version, latest);
        return { latest_version: latest, update_available: available,
            changes_url: available ? `${REPOSITORY_URL}/releases/tag/${latest}` : null };
    }
    private loadCache() {
        if (!parseReleaseVersion(this.version)) return;
        try {
            const cache: unknown = JSON.parse(readFileSync(this.cachePath, 'utf8'));
            // Commit-comparison caches have no version and must never supply release notices.
            if (!object(cache) || cache.repository !== GITHUB_REPOSITORY || cache.version !== this.version) return;
            if (typeof cache.checked_at !== 'number' || !Number.isFinite(cache.checked_at) || cache.checked_at <= 0 || cache.checked_at > nowSeconds()) return;
            const latest = cache.latest_version;
            if (typeof cache.check_failed !== 'boolean' || !(latest === null || (typeof latest === 'string' && parseReleaseVersion(latest)))) return;
            this.status = { checked_at: cache.checked_at, check_failed: cache.check_failed, ...this.releaseStatus(latest) };
        } catch { /* A missing or invalid cache gets one fresh check. */ }
    }
    private saveCache() {
        const temporary = `${this.cachePath}.tmp`;
        try {
            writeFileSync(temporary, JSON.stringify({ repository: GITHUB_REPOSITORY, version: this.version, ...this.status }) + '\n', { mode: 0o600 });
            renameSync(temporary, this.cachePath);
            this.saveFailures.recovered('Update check cache writes recovered');
        } catch (error) {
            this.saveFailures.failure(`Could not save update check: ${errorMessage(error)}`);
        } finally {
            try { rmSync(temporary, { force: true }); } catch { /* The cache is optional on unwritable volumes. */ }
        }
    }
    private schedule() {
        if (!this.started || this.signal.aborted) return;
        const delay = this.status.checked_at === null ? 0 : Math.min(UPDATE_CHECK_INTERVAL_MS, Math.max(0, this.status.checked_at * 1000 + UPDATE_CHECK_INTERVAL_MS - Date.now()));
        this.timer = setTimeout(() => {
            this.timer = null;
            this.pending = this.check().finally(() => { this.pending = null; this.schedule(); });
        }, delay).unref();
    }
    private async check() {
        try {
            const response = await this.fetcher(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`, {
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Bitcoin-Peer-Map' },
                signal: AbortSignal.any([this.signal, AbortSignal.timeout(10000)]),
            });
            let latest: string | null = null;
            if (response.status === 404) {
                // The public canonical repository may not have a published release yet.
                await response.body?.cancel();
            } else {
                if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
                const release: unknown = await response.json();
                if (!object(release) || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !parseReleaseVersion(release.tag_name)) {
                    throw new Error('GitHub returned an invalid stable release');
                }
                latest = release.tag_name;
            }
            this.status = { ...this.releaseStatus(latest), checked_at: nowSeconds(), check_failed: false };
            this.checkFailures.recovered('Application update check recovered');
        } catch (error) {
            if (this.signal.aborted) return;
            this.status = { ...this.status, checked_at: nowSeconds(), check_failed: true };
            this.checkFailures.failure(`Application update check failed: ${errorMessage(error)}`);
        }
        if (!this.signal.aborted) this.saveCache();
    }
}
