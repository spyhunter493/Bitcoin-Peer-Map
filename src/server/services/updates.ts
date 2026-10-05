import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '../settings.ts';
import { object, errorMessage, nowSeconds } from '../types.ts';

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export interface UpdateStatus {
    update_available: boolean;
    commits_behind: number | null;
    changes_url: string | null;
    checked_at: number | null;
    check_failed: boolean;
}

export class UpdateService {
    private status: UpdateStatus = { update_available: false, commits_behind: null, changes_url: null, checked_at: null, check_failed: false };
    private timer: ReturnType<typeof setTimeout> | null = null;
    private pending: Promise<void> | null = null;
    private controller = new AbortController();
    private started = false;
    private readonly signal: AbortSignal;
    private readonly cachePath: string;
    private readonly repository: string;
    private readonly revision: string;
    private readonly fetcher: typeof fetch;

    constructor(settings: Settings, signal?: AbortSignal, fetcher = fetch) {
        this.repository = settings.github_repository;
        this.revision = settings.build_revision;
        this.cachePath = join(settings.data_dir, 'update-check.json');
        this.signal = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
        this.fetcher = fetcher;
        this.loadCache();
    }

    snapshot(): UpdateStatus { return { ...this.status }; }
    start() {
        if (this.started || this.signal.aborted || this.revision === 'unknown') return;
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
    private changesUrl() { return `https://github.com/${this.repository}/compare/${this.revision}...main`; }
    private loadCache() {
        try {
            const cache: unknown = JSON.parse(readFileSync(this.cachePath, 'utf8'));
            if (!object(cache) || cache.repository !== this.repository || cache.revision !== this.revision) return;
            if (typeof cache.checked_at !== 'number' || !Number.isFinite(cache.checked_at) || cache.checked_at <= 0 || cache.checked_at > nowSeconds()) return;
            if (typeof cache.check_failed !== 'boolean' || !(cache.commits_behind === null || (typeof cache.commits_behind === 'number' && Number.isSafeInteger(cache.commits_behind) && cache.commits_behind >= 0))) return;
            const behind = cache.commits_behind;
            this.status = { checked_at: cache.checked_at, check_failed: cache.check_failed, commits_behind: behind,
                update_available: behind !== null && behind > 0, changes_url: behind !== null && behind > 0 ? this.changesUrl() : null };
        } catch { /* A missing or invalid cache gets one fresh check. */ }
    }
    private saveCache() {
        const temporary = `${this.cachePath}.tmp`;
        try {
            writeFileSync(temporary, JSON.stringify({ repository: this.repository, revision: this.revision, ...this.status }) + '\n', { mode: 0o600 });
            renameSync(temporary, this.cachePath);
        } catch (error) {
            console.warn(`Could not save update check: ${errorMessage(error)}`);
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
            const repository = this.repository.split('/').map(encodeURIComponent).join('/');
            const response = await this.fetcher(`https://api.github.com/repos/${repository}/compare/${this.revision}...main`, {
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Bitcoin-Peer-Map' },
                signal: AbortSignal.any([this.signal, AbortSignal.timeout(10000)]),
            });
            if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
            const comparison: unknown = await response.json();
            if (!object(comparison) || typeof comparison.status !== 'string' || !['ahead', 'behind', 'identical', 'diverged'].includes(comparison.status) || typeof comparison.ahead_by !== 'number' || !Number.isSafeInteger(comparison.ahead_by) || comparison.ahead_by < 0) {
                throw new Error('GitHub returned an invalid commit comparison');
            }
            // Only an upstream descendant is an update; local or diverged builds are not outdated.
            const behind = comparison.status === 'ahead' ? comparison.ahead_by : 0;
            this.status = { update_available: behind > 0, commits_behind: behind, changes_url: behind > 0 ? this.changesUrl() : null, checked_at: nowSeconds(), check_failed: false };
        } catch (error) {
            if (this.signal.aborted) return;
            this.status = { ...this.status, checked_at: nowSeconds(), check_failed: true };
            console.warn(`Application update check failed: ${errorMessage(error)}`);
        }
        if (!this.signal.aborted) this.saveCache();
    }
}
