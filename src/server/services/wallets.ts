import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Settings } from '../settings.ts';
import type { WalletRpc } from '../types.ts';
import { nowSeconds, object } from '../types.ts';
import { RpcAuthenticationError, RpcError } from '../rpc.ts';
import { HttpError } from '../http.ts';
import { SharedRead, readDeadline } from '../shared-read.ts';
import { WalletPreferenceStore, MAX_WALLETS, parseWalletTickerPreferences, validWalletName } from '../wallet-preferences.ts';
export type { WalletTickerPreferences, WalletPreferencesResponse } from '../wallet-preferences.ts';

export interface WalletRow {
    name: string;
    state: 'ready' | 'scanning' | 'unloaded' | 'ineligible' | 'unavailable';
    balance_sats: number | null;
    pending_incoming_sats: number | null;
    immature_sats: number | null;
    scanning_progress: number | null;
    updated_at: number | null;
}
export interface WalletSnapshot {
    state: 'ready' | 'empty' | 'partial' | 'unsupported' | 'unavailable';
    network: string;
    wallets: WalletRow[];
    generated_at: number;
    reason: string | null;
}
interface Options { refreshTimeoutMs?: number; rpcTimeoutSeconds?: number; successTtlMs?: number; failureTtlMs?: number; nowSeconds?: () => number }
class SnapshotFailure extends Error {
    readonly state: 'unsupported' | 'unavailable';
    readonly wallets: WalletRow[];
    constructor(state: 'unsupported' | 'unavailable', reason: string, wallets: WalletRow[] = []) { super(reason); this.state = state; this.wallets = wallets; }
}
function row(name: string, state: WalletRow['state'] = 'unavailable'): WalletRow {
    return { name, state, balance_sats: null, pending_incoming_sats: null, immature_sats: null, scanning_progress: null, updated_at: null };
}
function failure(error: unknown): SnapshotFailure {
    if (error instanceof SnapshotFailure) return error;
    if (error instanceof RpcError && error.code === -32601) return new SnapshotFailure('unsupported', 'Wallet RPC is unavailable or disabled on the Bitcoin node.');
    return new SnapshotFailure('unavailable', error instanceof RpcAuthenticationError
        ? 'Wallet RPC access is unavailable. Check the Bitcoin node RPC permissions.' : 'Wallet information is unavailable. Try again after the node recovers.');
}
/** Convert the RPC's BTC number once, rejecting invalid or sub-satoshi amounts. */
export function walletSatoshis(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 21_000_000) throw new Error('Invalid wallet amount');
    const sats = Math.round(value * 100_000_000);
    if (!Number.isSafeInteger(sats) || (sats === 0 && value !== 0) || Math.abs(sats / 100_000_000 - value) > Number.EPSILON * Math.max(1, value)) throw new Error('Invalid wallet amount');
    return sats;
}
function amounts(value: unknown) {
    if (!object(value)) throw new Error('Invalid wallet balances');
    return { balance_sats: walletSatoshis(value.trusted), pending_incoming_sats: walletSatoshis(value.untrusted_pending), immature_sats: walletSatoshis(value.immature) };
}
function waitForRead<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        pending.then(value => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value); },
            error => { signal.removeEventListener('abort', abort); reject(error); });
    });
}

/** Lazy, bounded wallet reads share the node's existing RPC transport and gate. */
export class WalletService {
    readonly store: WalletPreferenceStore;
    private readonly rpc: WalletRpc;
    private readonly settings: Settings;
    private readonly controller = new AbortController();
    private readonly parent?: AbortSignal;
    private readonly cache: SharedRead<WalletSnapshot>;
    private readonly options: Required<Options>;
    private cursor = 0;
    private preferenceWrites: Promise<void> = Promise.resolve();
    constructor(settings: Settings, rpc: WalletRpc, parent?: AbortSignal, options: Options = {}) {
        this.settings = settings; this.rpc = rpc; this.parent = parent;
        this.options = { refreshTimeoutMs: 15_000, rpcTimeoutSeconds: 5, successTtlMs: 30_000, failureTtlMs: 5000, nowSeconds, ...options };
        this.cache = new SharedRead(this.options.successTtlMs, this.options.failureTtlMs, { fromCompletion: true });
        const scope = createHash('sha256').update(JSON.stringify([settings.rpc_url, settings.bitcoin_network])).digest('hex');
        this.store = new WalletPreferenceStore(join(settings.data_dir, 'wallet-ticker.json'), scope);
    }
    preferences() { return this.store.response(); }
    async setPreferences(payload: unknown, signal?: AbortSignal) {
        const preferences = parseWalletTickerPreferences(payload);
        const active = this.signal(signal);
        active.throwIfAborted();
        // Async eligibility checks must not let an earlier settings request
        // overwrite a later request that happened to validate more quickly.
        const write = this.preferenceWrites.then(async () => {
            active.throwIfAborted();
            const previous = new Set(this.preferences().preferences.selected_wallets);
            const additions = preferences.selected_wallets.filter(name => !previous.has(name));
            if (additions.length) {
                const snapshot = await this.snapshot(active);
                const eligible = new Set(snapshot.wallets.filter(wallet => wallet.state === 'ready' || wallet.state === 'scanning').map(wallet => wallet.name));
                if (additions.some(name => !eligible.has(name))) throw new HttpError(422, 'A selected wallet is unavailable or is not a watch-only wallet. Refresh wallet options.', 'wallet_selection_unavailable');
            }
            active.throwIfAborted();
            return this.store.save(preferences);
        });
        this.preferenceWrites = write.then(() => {}, () => {});
        return waitForRead(write, active);
    }
    private signal(signal?: AbortSignal) {
        return AbortSignal.any([this.controller.signal, ...(this.parent ? [this.parent] : []), ...(signal ? [signal] : [])]);
    }
    async snapshot(signal?: AbortSignal): Promise<WalletSnapshot> {
        this.preferences(); // Invalid saved choices never silently become defaults.
        const combined = this.signal(signal);
        let result: WalletSnapshot;
        try { result = await this.cache.get(current => this.refresh(this.signal(current)), combined); }
        catch (error) {
            combined.throwIfAborted();
            const unavailable = failure(error);
            result = { state: unavailable.state, network: this.settings.bitcoin_network, wallets: structuredClone(unavailable.wallets), generated_at: this.options.nowSeconds(), reason: unavailable.message };
        }
        combined.throwIfAborted();
        const selected = new Set(this.preferences().preferences.selected_wallets);
        const names = new Set(result.wallets.map(wallet => wallet.name));
        for (const name of selected) {
            if (!names.has(name)) result.wallets.push(row(name, ['unsupported', 'unavailable'].includes(result.state) ? 'unavailable' : 'unloaded'));
        }
        // Keep full discovery metadata in the shared cache. Each caller sees
        // current selections, including saved wallets it may need to remove.
        result.wallets = result.wallets.filter(wallet => !['ineligible', 'unloaded'].includes(wallet.state) || selected.has(wallet.name));
        result.wallets.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        if (result.wallets.some(wallet => wallet.state === 'unloaded' || wallet.state === 'ineligible') && !['unsupported', 'unavailable'].includes(result.state)) {
            result.state = 'partial';
            result.reason ||= 'Some selected wallets are unloaded or are no longer eligible for watch-only balances.';
        }
        return result;
    }
    private async refresh(signal: AbortSignal): Promise<WalletSnapshot> {
        const budget = readDeadline(this.options.refreshTimeoutMs, signal);
        try {
            let discovered: unknown;
            try { discovered = await this.rpc.call('listwallets', [], this.options.rpcTimeoutSeconds, budget.signal); }
            catch (error) { signal.throwIfAborted(); throw failure(error); }
            if (!Array.isArray(discovered)) throw failure(null);
            if (discovered.length > MAX_WALLETS) throw new SnapshotFailure('unavailable', `The Bitcoin node has more than ${MAX_WALLETS} loaded wallets. Wallet discovery cannot display a partial catalog.`);
            if (discovered.some(name => !validWalletName(name)) || new Set(discovered).size !== discovered.length) throw failure(null);
            const names = [...discovered as string[]].sort();
            const rows = new Map(names.map(name => [name, row(name)]));
            const start = names.length ? this.cursor % names.length : 0;
            const order = [...names.slice(start), ...names.slice(0, start)];
            let next = 0, unsupported = false;
            const worker = async () => {
                while (next < order.length && !budget.signal.aborted) {
                    const index = next++, name = order[index]!;
                    // The next refresh starts after the last attempted name, so slow
                    // early wallets cannot starve the rest of a large catalog.
                    this.cursor = names.length ? (start + index + 1) % names.length : 0;
                    try { rows.set(name, await this.readWallet(name, budget.signal)); }
                    catch (error) {
                        if (error instanceof RpcError && error.code === -32601) unsupported = true;
                        if (error instanceof RpcError && error.code === -18) rows.set(name, row(name, 'unloaded'));
                    }
                }
            };
            await Promise.all([worker(), worker()]);
            signal.throwIfAborted();
            const wallets = [...rows.values()];
            const available = wallets.some(wallet => wallet.state === 'ready' || wallet.state === 'scanning');
            const incomplete = wallets.some(wallet => wallet.state === 'unavailable' || wallet.state === 'scanning');
            const state = unsupported && !available ? 'unsupported' : incomplete ? available ? 'partial' : 'unavailable' : available ? 'ready' : 'empty';
            const reason = unsupported && !available ? 'Wallet RPC is unavailable or disabled on the Bitcoin node.'
                : incomplete ? 'Some wallet information is unavailable or still scanning. Another refresh will retry it.' : null;
            if (state === 'unsupported' || state === 'unavailable') throw new SnapshotFailure(state, reason!, wallets);
            return { state, network: this.settings.bitcoin_network, wallets, generated_at: this.options.nowSeconds(), reason };
        } finally { budget.dispose(); }
    }
    private async readWallet(name: string, signal: AbortSignal): Promise<WalletRow> {
        const info = await this.rpc.callWallet(name, 'getwalletinfo', [], this.options.rpcTimeoutSeconds, signal);
        signal.throwIfAborted();
        if (!object(info) || info.walletname !== name || typeof info.private_keys_enabled !== 'boolean' ||
            (info.external_signer !== undefined && typeof info.external_signer !== 'boolean')) throw new Error('Invalid wallet information');
        if (info.private_keys_enabled || info.external_signer === true) return row(name, 'ineligible');
        if (typeof info.descriptors !== 'boolean') throw new Error('Invalid wallet information');
        if (object(info.scanning)) {
            const progress = info.scanning.progress;
            if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('Invalid scan progress');
            return { ...row(name, 'scanning'), scanning_progress: progress };
        }
        if (info.scanning !== false) throw new Error('Invalid scan state');
        const balances = await this.rpc.callWallet(name, 'getbalances', [], this.options.rpcTimeoutSeconds, signal);
        signal.throwIfAborted();
        if (!object(balances)) throw new Error('Invalid wallet balances');
        const mine = amounts(balances.mine);
        const balance = info.descriptors ? mine : balances.watchonly === undefined
            ? { balance_sats: 0, pending_incoming_sats: 0, immature_sats: 0 } : amounts(balances.watchonly);
        return { ...row(name, 'ready'), ...balance, updated_at: this.options.nowSeconds() };
    }
    stop() { this.controller.abort(new DOMException('Wallet service stopped', 'AbortError')); this.cache.invalidate(); }
}
