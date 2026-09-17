/* Independent price refreshes with currency-local requests and stale-response protection. */
(function (global) {
    'use strict';
    function create({ api = global.BPMApi, onPrice }) {
        let currency = 'USD';
        let selection = 0;
        const pending = new Map();
        const cached = new Map();

        async function refresh() {
            const requestedCurrency = currency;
            const requestedSelection = selection;
            if (!pending.has(requestedCurrency)) {
                const request = api.getJson('/api/price?currency=' + encodeURIComponent(requestedCurrency), {
                    cache: 'no-store', signal: AbortSignal.timeout(15000),
                }).then(data => {
                    cached.set(requestedCurrency, data);
                    return data;
                }).catch(error => ({
                    btc_price: null,
                    btc_currency: requestedCurrency,
                    last_known_price: cached.get(requestedCurrency)?.last_known_price || null,
                    last_price_currency: requestedCurrency,
                    last_price_error: error instanceof Error ? error.message : 'Price unavailable',
                })).finally(() => pending.delete(requestedCurrency));
                pending.set(requestedCurrency, request);
            }
            const data = await pending.get(requestedCurrency);
            if (currency === requestedCurrency && selection === requestedSelection) onPrice(data);
        }

        function setCurrency(value) {
            currency = value.trim().toUpperCase();
            selection++;
            onPrice(cached.get(currency) || { btc_price: null, btc_currency: currency });
            return refresh();
        }
        return Object.freeze({ refresh, setCurrency, get currency() { return currency; } });
    }
    global.BPMPrice = Object.freeze({ create });
})(window);
