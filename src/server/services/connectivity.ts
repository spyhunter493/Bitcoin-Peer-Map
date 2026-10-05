import { CachedRequest, Lru, sleep } from '../tasks.ts';
import { type Data, errorMessage, nowSeconds } from '../types.ts';

interface PriceEntry { cache: CachedRequest<number | null>; lastKnown: string | null; error: string | null }
export class ConnectivityService {
    internetState = 'green';
    consecutiveSuccesses = 0;
    failureStartedAt: number | null = null;
    apiConsecutiveFailures = 0;
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
    private setState(state: string) {
        if (state !== this.internetState) console.info(`Internet state changed from ${this.internetState} to ${state}`);
        this.internetState = state;
    }
    networkFailure(geoipApi = false) {
        if (this.signal.aborted) return;
        this.consecutiveSuccesses = 0;
        if (this.internetState === 'green') this.failureStartedAt = nowSeconds();
        if (geoipApi) this.apiConsecutiveFailures++;
        this.setState('yellow'); this.ensureChecker();
    }
    networkSuccess(geoipApi = false) {
        if (geoipApi) this.apiConsecutiveFailures = 0;
        if (this.internetState === 'green' || ++this.consecutiveSuccesses < 4) return;
        this.consecutiveSuccesses = 0; this.failureStartedAt = null; this.apiPromptCount = 0; this.apiPromptAt = 0;
        this.setState('green');
    }
    ensureChecker() {
        if (!this.checker && !this.signal.aborted) this.checker = this.checkLoop().finally(() => { this.checker = null; });
    }
    private async checkLoop() {
        while (!this.signal.aborted && this.internetState !== 'green') {
            let available = false;
            try {
                const response = await this.fetcher('https://www.google.com', { method: 'HEAD', signal: AbortSignal.any([this.signal, AbortSignal.timeout(2000)]) });
                available = response.status < 500;
                await response.body?.cancel();
            } catch { /* Retry while the connection is unavailable. */ }
            if (available) this.networkSuccess();
            else {
                this.consecutiveSuccesses = 0;
                if (this.failureStartedAt !== null && nowSeconds() - this.failureStartedAt >= 10) this.setState('red');
            }
            await sleep(2000, this.signal);
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
            if (this.internetState !== 'red') {
                try {
                    const response = await this.fetcher(`https://api.coinbase.com/v2/prices/BTC-${encodeURIComponent(currency)}/spot`, { signal: AbortSignal.any([this.signal, AbortSignal.timeout(5000)]) });
                    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
                    const amount = (await response.json()).data?.amount;
                    const value = Number(amount);
                    if (!Number.isFinite(value) || value <= 0) throw new Error('Coinbase response did not include a valid price');
                    current.lastKnown = String(amount); current.error = null; this.networkSuccess();
                } catch (error) { current.error = `Coinbase API error: ${errorMessage(error)}`; this.networkFailure(); }
            }
            return current.lastKnown ? Number(current.lastKnown) : null;
        });
    }
    async priceInfo(currency = 'USD'): Promise<Data> {
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
    snapshot(): Data {
        let shouldPrompt = false;
        if (this.apiConsecutiveFailures >= 5 && this.internetState === 'green' && !this.geoipApiDisabled) {
            const elapsed = this.apiPromptAt ? nowSeconds() - this.apiPromptAt : Infinity;
            shouldPrompt = this.apiPromptCount === 0 || (this.apiPromptCount <= 3 && elapsed >= this.apiPromptCount * 60) || (this.apiPromptCount > 3 && elapsed >= 300);
        }
        const entry = this.prices.get(this.priceCurrency);
        return { internet_state: this.internetState, api_available: this.apiConsecutiveFailures < 5,
            api_consecutive_failures: this.apiConsecutiveFailures, last_price_error: entry?.error ?? null,
            last_known_price: entry?.lastKnown ?? null, last_price_currency: this.priceCurrency,
            geo_db_only_mode: this.geoipApiDisabled, api_down_prompt: shouldPrompt };
    }
}
