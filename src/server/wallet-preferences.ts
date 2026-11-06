import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './http.ts';
import { object } from './types.ts';

export interface WalletTickerPreferences {
    selected_wallets: string[];
    unit: 'BTC' | 'sats';
    rotation_seconds: 5 | 8 | 15 | 30;
    paused: boolean;
}
export interface WalletPreferencesResponse { preferences: WalletTickerPreferences; revision: number }
export const MAX_WALLETS = 128;
const MAX_FILE_BYTES = 64 * 1024;
export const DEFAULT_WALLET_PREFERENCES: Readonly<WalletTickerPreferences> = Object.freeze({
    selected_wallets: [], unit: 'BTC', rotation_seconds: 8, paused: false,
});

export function validWalletName(value: unknown): value is string {
    if (typeof value !== 'string' || Buffer.byteLength(value) > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return false;
    try { encodeURIComponent(value); return true; } catch { return false; }
}
export function parseWalletTickerPreferences(payload: unknown): WalletTickerPreferences {
    const invalid = () => new HttpError(422, 'Invalid wallet ticker preferences.', 'wallet_preferences_invalid');
    const fields = ['selected_wallets', 'unit', 'rotation_seconds', 'paused'];
    if (!object(payload) || Object.keys(payload).length !== fields.length || fields.some(key => !Object.hasOwn(payload, key))) throw invalid();
    if (!Array.isArray(payload.selected_wallets) || payload.selected_wallets.length > MAX_WALLETS || !payload.selected_wallets.every(validWalletName)) throw invalid();
    if (new Set(payload.selected_wallets).size !== payload.selected_wallets.length || typeof payload.unit !== 'string' || !['BTC', 'sats'].includes(payload.unit) ||
        ![5, 8, 15, 30].includes(payload.rotation_seconds as number) || typeof payload.paused !== 'boolean') throw invalid();
    const preferences: WalletTickerPreferences = {
        selected_wallets: [...payload.selected_wallets].sort(), unit: payload.unit as 'BTC' | 'sats',
        rotation_seconds: payload.rotation_seconds as WalletTickerPreferences['rotation_seconds'], paused: payload.paused,
    };
    if (Buffer.byteLength(JSON.stringify(preferences)) > 48 * 1024) throw invalid();
    return preferences;
}

/** Wallet settings have their own schema and never enter general configuration. */
export class WalletPreferenceStore {
    readonly path: string;
    readonly scope: string;
    private value = structuredClone(DEFAULT_WALLET_PREFERENCES) as WalletTickerPreferences;
    private revision = 0;
    private failed = false;
    constructor(path: string, scope: string) {
        this.path = path; this.scope = scope;
        try {
            if (fs.statSync(path).size > MAX_FILE_BYTES) throw new Error('Invalid store');
            const data: unknown = JSON.parse(fs.readFileSync(path, 'utf8'));
            if (!object(data) || Object.keys(data).length !== 4 || data.version !== 1 || typeof data.scope !== 'string' ||
                !Number.isSafeInteger(data.revision) || (data.revision as number) < 0) throw new Error('Invalid store');
            const preferences = parseWalletTickerPreferences(data.preferences);
            // Switching node/network never applies names from a different wallet set.
            // An explicit save can replace that other scope; reads leave it untouched.
            if (data.scope === scope) { this.value = preferences; this.revision = data.revision as number; }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.failed = true;
        }
    }
    private unavailable() { return new HttpError(503, 'Wallet ticker preferences are unavailable. Check the saved wallet settings and file permissions.', 'wallet_preferences_unavailable'); }
    response(): WalletPreferencesResponse {
        if (this.failed) throw this.unavailable();
        return { preferences: structuredClone(this.value), revision: this.revision };
    }
    save(preferences: WalletTickerPreferences): WalletPreferencesResponse {
        if (this.failed || this.revision >= Number.MAX_SAFE_INTEGER) throw this.unavailable();
        const validated = parseWalletTickerPreferences(preferences);
        const revision = this.revision + 1;
        const temporary = join(dirname(this.path), `.wallet-ticker-${randomUUID()}.json`);
        try {
            fs.mkdirSync(dirname(this.path), { recursive: true });
            const fd = fs.openSync(temporary, 'wx', 0o600);
            try {
                fs.writeFileSync(fd, JSON.stringify({ version: 1, scope: this.scope, revision, preferences: validated }, null, 2) + '\n');
                fs.fsyncSync(fd);
            } finally { fs.closeSync(fd); }
            fs.renameSync(temporary, this.path);
        } catch { throw this.unavailable(); }
        finally { try { fs.rmSync(temporary, { force: true }); } catch { /* Keep the original write failure. */ } }
        this.value = validated; this.revision = revision;
        return this.response();
    }
}
