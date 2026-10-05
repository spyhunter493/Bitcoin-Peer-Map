import { CachedRequest, Lru, sleep } from '../tasks.ts';
import { type Data, errorMessage, nowSeconds, object } from '../types.ts';

interface PriceEntry { cache: CachedRequest<number | null>; lastKnown: string | null; error: string | null }
export type Provider = 'coinbase' | 'geoip';
export interface ProviderHealth {
    state: 'unknown' | 'healthy' | 'unavailable' | 'rate_limited';
    consecutive_failures: number;
    last_error: string | null;
    last_success_at: number | null;
    last_failure_at: number | null;
    retry_at: number | null;
}
export interface PriceInfo extends Data {
    btc_price: number | null; btc_currency: string;
    last_known_price: string | null; last_price_currency: string; last_price_error: string | null;
}
export interface ConnectivityStatus extends Data {
    internet_state: 'green' | 'yellow' | 'red';
    api_available: boolean; api_consecutive_failures: number;
    last_price_error: string | null; last_known_price: string | null; last_price_currency: string;
    geo_db_only_mode: boolean; api_down_prompt: boolean;
    providers: Record<Provider, ProviderHealth>;
}
const health = (): ProviderHealth => ({ state: 'unknown', consecutive_failures: 0, last_error: null, last_success_at: null, last_failure_at: null, retry_at: null });

function retryDelay(response: Response, provider: Provider): number | null {
    const value = response.headers.get('Retry-After');
    let delay: number | null = null;
    if (value !== null) {
        const parsed = /^\d+$/.test(value.trim()) ? Number(value)
            : /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) ? (Date.parse(value) - Date.now()) / 1000 : NaN;
        if (Number.isFinite(parsed)) delay = Math.max(0, parsed);
    }
    if (provider === 'geoip' && (response.status === 429 || response.headers.get('X-Rl') === '0')) {
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
    private providers: Record<Provider, ProviderHealth> = { coinbase: health(), geoip: health() };
    get apiConsecutiveFailures() { return this.providers.geoip.consecutive_failures; }
    apiPromptCount = 0;
    apiPromptAt = 0;
    geoipApiDisabled: boolean;
    private prices = new Lru<PriceEntry>(64);
    private priceCurrency = 'USD';
    private checker: Promise<void> | null = null;
    private controller = new AbortController();
    readonly signal: AbortSignal;
    readonly fetcher: typeof fetch;
    constructor(disabled = false, signal?: AbortSignal, fetcher = fetch) {
        this.geoipApiDisabled = disabled; this.fetcher = fetcher;
        this.signal = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    }
    private setState(state: ConnectivityStatus['internet_state']) {
        if (state !== this.internetState) console.info(`Internet state changed from ${this.internetState} to ${state}`);
        this.internetState = state;
    }
    providerReady(provider: Provider) {
        const retryAt = this.providers[provider].retry_at;
        return !this.signal.aborted && (retryAt === null || nowSeconds() >= retryAt);
    }
    providerFailure(provider: Provider, error: unknown, response?: Response) {
        if (this.signal.aborted) return;
        const current = this.providers[provider];
        current.consecutive_failures++;
        current.state = response?.status === 429 ? 'rate_limited' : 'unavailable';
        current.last_error = errorMessage(error); current.last_failure_at = nowSeconds();
        const delay = response ? retryDelay(response, provider) : null;
        if (delay !== null) current.retry_at = Math.max(current.retry_at ?? 0, nowSeconds() + delay);
    }
    providerSuccess(provider: Provider, response?: Response) {
        if (this.signal.aborted) return;
        const current = this.providers[provider];
        current.consecutive_failures = 0;
        current.last_error = null; current.last_success_at = nowSeconds();
        if (current.retry_at !== null && nowSeconds() >= current.retry_at) current.retry_at = null;
        current.state = current.retry_at === null ? 'healthy' : 'rate_limited';
        const delay = response ? retryDelay(response, provider) : null;
        if (delay !== null && delay > 0) { current.retry_at = Math.max(current.retry_at ?? 0, nowSeconds() + delay); current.state = 'rate_limited'; }
        if (provider === 'geoip') { this.apiPromptCount = 0; this.apiPromptAt = 0; }
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
        if (!this.checker && !this.signal.aborted) this.checker = this.checkLoop().finally(() => { this.checker = null; });
    }
    private async checkLoop() {
        while (!this.signal.aborted) {
            let available = false;
            try {
                const response = await this.fetcher('https://www.google.com', { method: 'HEAD', signal: AbortSignal.any([this.signal, AbortSignal.timeout(2000)]) });
                // Any HTTP response proves reachability, including a probe-host outage.
                available = true;
                await response.body?.cancel();
            } catch { /* Retry while the connection is unavailable. */ }
            if (this.signal.aborted) return;
            if (available) this.networkSuccess(); else this.networkFailure();
            await sleep(this.internetState === 'green' ? 30_000 : 2000, this.signal);
        }
    }
    async stop() { this.controller.abort(); await this.checker; }
    private priceEntry(currency: string): PriceEntry {
        const cached = this.prices.get(currency);
        if (cached) return cached;
        return this.prices.set(currency, { cache: new CachedRequest<number | null>(5000), lastKnown: null, error: null });
    }
    async fetchPrice(currency: string): Promise<number | null> {
        currency = currency.trim().toUpperCase();
        this.priceCurrency = currency;
        const current = this.priceEntry(currency);
        return current.cache.get(async () => {
            if (this.internetState !== 'red' && this.providerReady('coinbase')) {
                let response: Response | undefined;
                try {
                    response = await this.fetcher(`https://api.coinbase.com/v2/prices/BTC-${encodeURIComponent(currency)}/spot`, { signal: AbortSignal.any([this.signal, AbortSignal.timeout(5000)]) });
                    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
                    const data: unknown = await response.json();
                    const amount = object(data) && object(data.data) ? data.data.amount : null;
                    if (typeof amount !== 'string' && typeof amount !== 'number') throw new Error('Coinbase response did not include a valid price');
                    const value = Number(amount);
                    if (!Number.isFinite(value) || value <= 0) throw new Error('Coinbase response did not include a valid price');
                    current.lastKnown = String(amount); current.error = null; this.providerSuccess('coinbase', response);
                } catch (error) {
                    if (!this.signal.aborted) { current.error = `Coinbase API error: ${errorMessage(error)}`; this.providerFailure('coinbase', error, response); }
                }
            }
            return current.lastKnown ? Number(current.lastKnown) : null;
        });
    }
    async priceInfo(currency = 'USD'): Promise<PriceInfo> {
        currency = currency.trim().toUpperCase();
        // Retain the entry while awaiting it: other currencies can evict it from
        // the bounded cache without invalidating this client's response.
        const entry = this.priceEntry(currency);
        const price = await this.fetchPrice(currency);
        return { btc_price: price, btc_currency: currency, last_known_price: entry.lastKnown, last_price_currency: currency, last_price_error: entry.error };
    }
    setGeoipApiDisabled(disabled: boolean) {
        this.geoipApiDisabled = disabled;
        if (disabled) { this.apiPromptCount = 0; this.apiPromptAt = 0; }
    }
    acknowledgePrompt() { this.apiPromptAt = nowSeconds(); this.apiPromptCount++; }
    snapshot(): ConnectivityStatus {
        let shouldPrompt = false;
        if (this.apiConsecutiveFailures >= 5 && this.internetState === 'green' && !this.geoipApiDisabled) {
            const elapsed = this.apiPromptAt ? nowSeconds() - this.apiPromptAt : Infinity;
            shouldPrompt = this.apiPromptCount === 0 || (this.apiPromptCount <= 3 && elapsed >= this.apiPromptCount * 60) || (this.apiPromptCount > 3 && elapsed >= 300);
        }
        const entry = this.prices.get(this.priceCurrency);
        return { internet_state: this.internetState, api_available: this.apiConsecutiveFailures < 5 && this.providerReady('geoip'),
            api_consecutive_failures: this.apiConsecutiveFailures, last_price_error: entry?.error ?? null,
            last_known_price: entry?.lastKnown ?? null, last_price_currency: this.priceCurrency,
            geo_db_only_mode: this.geoipApiDisabled, api_down_prompt: shouldPrompt,
            providers: { coinbase: { ...this.providers.coinbase }, geoip: { ...this.providers.geoip } } };
    }
}
