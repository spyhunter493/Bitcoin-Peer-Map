import { sleep } from '../tasks.ts';
import { errorMessage, nowSeconds } from '../types.ts';
import { createFailureReporter, createLogger } from '../logging.ts';
import type { OutboundPolicy } from '../outbound-policy.ts';

const log = createLogger('connectivity');

export type Provider = 'geoip';
export type { ProviderHealth, ConnectivityStatus } from '../../shared/api.generated.d.ts';
import type { ProviderHealth, ConnectivityStatus } from '../../shared/api.generated.d.ts';
const health = (): ProviderHealth => ({ state: 'unknown', consecutive_failures: 0, last_error: null, last_success_at: null, last_failure_at: null, retry_at: null });

function retryDelay(response: Response): number | null {
    const value = response.headers.get('Retry-After');
    let delay: number | null = null;
    if (value !== null) {
        const parsed = /^\d+$/.test(value.trim()) ? Number(value)
            : /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) ? (Date.parse(value) - Date.now()) / 1000 : NaN;
        if (Number.isFinite(parsed)) delay = Math.max(0, parsed);
    }
    if (response.status === 429 || response.headers.get('X-Rl') === '0') {
        const ttl = response.headers.get('X-Ttl');
        if (ttl !== null && /^\d+$/.test(ttl) && Number.isFinite(Number(ttl))) delay = Math.max(delay ?? 0, Number(ttl));
        else delay ??= 60;
    }
    return delay ?? (response.status === 429 ? 60 : null);
}
export class ConnectivityService {
    internetState: ConnectivityStatus['internet_state'] = 'green';
    consecutiveSuccesses = 0;
    failureStartedAt: number | null = null;
    private providers: Record<Provider, ProviderHealth> = { geoip: health() };
    private retryWindows: Record<Provider, { quotaAt: number | null; outageAt: number | null }> = { geoip: { quotaAt: null, outageAt: null } };
    private providerFailures = createFailureReporter(createLogger('geoip'));
    get apiConsecutiveFailures() { return this.providers.geoip.consecutive_failures; }
    apiPromptCount = 0;
    apiPromptAt = 0;
    geoipApiDisabled: boolean;
    private checker: Promise<void> | null = null;
    private checkingRequested = false;
    private controller = new AbortController();
    readonly signal: AbortSignal;
    readonly fetcher: typeof fetch;
    private readonly outbound?: OutboundPolicy;
    private readonly unsubscribe: () => void;
    constructor(disabled = false, signal?: AbortSignal, fetcher = fetch, outbound?: OutboundPolicy) {
        this.geoipApiDisabled = disabled; this.fetcher = fetcher;
        this.outbound = outbound;
        this.signal = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
        this.unsubscribe = outbound?.subscribe((feature, allowed) => { if (feature === 'probe' && allowed && this.checkingRequested) this.ensureChecker(); }) ?? (() => {});
    }
    private setState(state: ConnectivityStatus['internet_state']) {
        if (state === this.internetState) return;
        const previous = this.internetState;
        this.internetState = state;
        const message = `Internet state changed from ${previous} to ${state}`;
        // Brief probe failures stay visible in the dashboard without filling normal logs.
        if (state === 'red') log.warn(message);
        else if (state === 'green' && previous === 'red') log.info(message);
        else log.debug(message);
    }
    private updateProvider(provider: Provider) {
        const current = this.providers[provider], windows = this.retryWindows[provider], now = nowSeconds();
        if (windows.quotaAt !== null && now >= windows.quotaAt) windows.quotaAt = null;
        if (windows.outageAt !== null && now >= windows.outageAt) windows.outageAt = null;
        current.retry_at = windows.quotaAt === null ? windows.outageAt : windows.outageAt === null ? windows.quotaAt : Math.max(windows.quotaAt, windows.outageAt);
        current.state = this.geoipApiDisabled || (this.outbound && !this.outbound.allowed('geoip')) ? 'disabled'
            : windows.quotaAt !== null ? 'rate_limited' : current.consecutive_failures ? 'unavailable' : current.last_success_at !== null ? 'healthy' : 'unknown';
        return current;
    }
    providerReady(provider: Provider) {
        const retryAt = this.updateProvider(provider).retry_at;
        return !this.signal.aborted && !this.geoipApiDisabled && (!this.outbound || this.outbound.allowed('geoip')) && (retryAt === null || nowSeconds() >= retryAt);
    }
    providerFailure(provider: Provider, error: unknown, response?: Response) {
        if (this.signal.aborted || this.geoipApiDisabled || (this.outbound && !this.outbound.allowed('geoip'))) return;
        const current = this.providers[provider];
        current.consecutive_failures++;
        current.last_error = errorMessage(error); current.last_failure_at = nowSeconds();
        const windows = this.retryWindows[provider];
        const delay = response ? retryDelay(response) : null;
        if (response?.status === 429 || response?.headers.get('X-Rl') === '0') {
            windows.quotaAt = Math.max(windows.quotaAt ?? 0, nowSeconds() + (delay ?? 60));
        } else {
            const outageDelay = current.consecutive_failures >= 5 ? Math.min(300, 30 * 2 ** Math.min(4, current.consecutive_failures - 5)) : 0;
            const wait = Math.max(outageDelay, delay ?? 0);
            if (wait > 0) windows.outageAt = Math.max(windows.outageAt ?? 0, nowSeconds() + wait);
        }
        this.updateProvider(provider);
        this.providerFailures.failure(`GeoIP provider ${current.state}: ${current.last_error}`);
    }
    providerSuccess(provider: Provider, response?: Response) {
        if (this.signal.aborted || this.geoipApiDisabled || (this.outbound && !this.outbound.allowed('geoip'))) return;
        const current = this.providers[provider];
        current.consecutive_failures = 0;
        current.last_error = null; current.last_success_at = nowSeconds();
        const windows = this.retryWindows[provider];
        windows.outageAt = null;
        const delay = response ? retryDelay(response) : null;
        if (delay !== null && delay > 0) windows.quotaAt = Math.max(windows.quotaAt ?? 0, nowSeconds() + delay);
        this.updateProvider(provider);
        if (current.state === 'healthy') this.providerFailures.recovered('GeoIP provider recovered');
        else this.providerFailures.failure('GeoIP provider rate limited; waiting until retry deadline');
        this.apiPromptCount = 0; this.apiPromptAt = 0;
    }
    // Only the independent reachability probe changes internet status.
    private networkFailure() {
        if (this.signal.aborted) return;
        this.consecutiveSuccesses = 0;
        this.failureStartedAt ??= nowSeconds();
        this.setState(nowSeconds() - this.failureStartedAt >= 10 ? 'red' : 'yellow');
    }
    private networkSuccess() {
        if (this.internetState === 'green' || ++this.consecutiveSuccesses < 4) return;
        this.consecutiveSuccesses = 0; this.failureStartedAt = null;
        this.setState('green');
    }
    ensureChecker() {
        this.checkingRequested = true;
        if (!this.checker && !this.signal.aborted && (!this.outbound || this.outbound.allowed('probe'))) {
            const signal = this.outbound ? AbortSignal.any([this.signal, this.outbound.signal('probe')]) : this.signal;
            this.checker = this.checkLoop(signal).finally(() => {
                this.checker = null;
                if (!this.signal.aborted && (!this.outbound || this.outbound.allowed('probe'))) this.ensureChecker();
            });
        }
    }
    private async checkLoop(signal: AbortSignal) {
        while (!signal.aborted && (!this.outbound || this.outbound.allowed('probe'))) {
            let available = false;
            try {
                const response = await this.fetcher('https://www.google.com', { method: 'HEAD', signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]), redirect: 'manual' });
                // Any HTTP response proves reachability, including a probe-host outage.
                available = true;
                await response.body?.cancel();
            } catch { /* Retry while the connection is unavailable. */ }
            if (signal.aborted) return;
            if (available) this.networkSuccess(); else this.networkFailure();
            await sleep(this.internetState === 'green' ? 30_000 : 2000, signal);
        }
    }
    async stop() { this.checkingRequested = false; this.unsubscribe(); this.controller.abort(); await this.checker; }
    setGeoipApiDisabled(disabled: boolean) {
        this.geoipApiDisabled = disabled;
        if (disabled) { this.apiPromptCount = 0; this.apiPromptAt = 0; }
    }
    acknowledgePrompt() { this.apiPromptAt = nowSeconds(); this.apiPromptCount++; }
    snapshot(): ConnectivityStatus {
        let shouldPrompt = false;
        if (this.apiConsecutiveFailures >= 5 && !this.geoipApiDisabled && (!this.outbound || this.outbound.allowed('geoip'))) {
            const elapsed = this.apiPromptAt ? nowSeconds() - this.apiPromptAt : Infinity;
            shouldPrompt = this.apiPromptCount === 0 || (this.apiPromptCount <= 3 && elapsed >= this.apiPromptCount * 60) || (this.apiPromptCount > 3 && elapsed >= 300);
        }
        return { internet_state: this.outbound && !this.outbound.allowed('probe') ? 'disabled' : this.internetState, api_available: this.apiConsecutiveFailures < 5 && this.providerReady('geoip'),
            api_consecutive_failures: this.apiConsecutiveFailures,
            geo_db_only_mode: this.geoipApiDisabled, api_down_prompt: shouldPrompt,
            providers: { geoip: { ...this.updateProvider('geoip') } } };
    }
}
