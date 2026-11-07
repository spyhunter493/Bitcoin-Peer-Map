/** @typedef {import('../../../shared/api.generated').WalletTickerPreferences} Preferences */

/** Exact satoshi formatting avoids rounding a wallet amount a second time.
 * @param {number | null} satoshis @param {'BTC' | 'sats'} unit */
export function formatAmount(satoshis, unit) {
    if (satoshis === null || !Number.isSafeInteger(satoshis) || satoshis < 0) return '—';
    if (unit === 'sats') return `${satoshis} sats`;
    return `${Math.floor(satoshis / 100000000)}.${String(satoshis % 100000000).padStart(8, '0')} BTC`;
}

/** @param {Preferences} preferences @returns {Preferences} */
export function copyPreferences(preferences) {
    return { selected_wallets: [...preferences.selected_wallets], unit: preferences.unit,
        rotation_seconds: preferences.rotation_seconds, paused: preferences.paused };
}

/** @param {string} left @param {string} right */
export function compareNames(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

/** @param {import('../../../shared/api.generated').WalletRow[]} wallets @param {Preferences | null} preferences */
export function readyWallets(wallets, preferences) {
    const selected = new Set(preferences?.selected_wallets || []);
    return wallets.filter(wallet => selected.has(wallet.name) && wallet.state === 'ready'
        && wallet.balance_sats !== null && wallet.balance_sats >= 0 && Number.isSafeInteger(wallet.balance_sats))
        .sort((left, right) => compareNames(left.name, right.name));
}

/** Preserve the current entry while refreshing or changing other selections.
 * @param {string[]} names @param {string | null} current @param {number} [direction] */
export function nextWallet(names, current, direction = 0) {
    if (!names.length) return null;
    const index = current === null ? -1 : names.indexOf(current);
    if (index < 0) return names[0];
    return names[((index + direction) % names.length + names.length) % names.length];
}
