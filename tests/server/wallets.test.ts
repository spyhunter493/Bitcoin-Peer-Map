import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { WalletRpc, Data } from '../../src/server/types.ts';
import { WalletService, walletSatoshis } from '../../src/server/services/wallets.ts';
import { RpcError, RpcAuthenticationError } from '../../src/server/rpc.ts';
import { HttpError } from '../../src/server/http.ts';
import { settings, temporaryDirectory, deferred } from './helpers.ts';

const balance = (trusted = 0, untrusted_pending = 0, immature = 0) => ({ trusted, untrusted_pending, immature });
const defaults = { selected_wallets: [] as string[], unit: 'BTC', rotation_seconds: 8, paused: false };
type Call = { wallet?: string; method: string; timeout?: number };
class WalletFake implements WalletRpc {
    names: string[] = [];
    infos = new Map<string, unknown>();
    balances = new Map<string, unknown>();
    calls: Call[] = [];
    listError: Error | null = null;
    handler?: (call: Call, signal?: AbortSignal) => Promise<unknown>;
    wallet(name: string, info: Data = {}, balances: unknown = { mine: balance() }) {
        this.names.push(name);
        this.infos.set(name, { walletname: name, private_keys_enabled: false, external_signer: false, descriptors: true, scanning: false, ...info });
        this.balances.set(name, balances);
        return this;
    }
    async call(method: string, _params?: unknown[], timeout?: number, signal?: AbortSignal): Promise<unknown> {
        const call = { method, timeout }; this.calls.push(call);
        if (this.handler) return this.handler(call, signal);
        if (this.listError) throw this.listError;
        assert.equal(method, 'listwallets'); return structuredClone(this.names);
    }
    async callWallet(wallet: string, method: string, _params?: unknown[], timeout?: number, signal?: AbortSignal): Promise<unknown> {
        const call = { wallet, method, timeout }; this.calls.push(call);
        if (this.handler) return this.handler(call, signal);
        const value = method === 'getwalletinfo' ? this.infos.get(wallet) : this.balances.get(wallet);
        if (value instanceof Error) throw value;
        return structuredClone(value);
    }
}
function service(t: TestContext, rpc: WalletFake, options: ConstructorParameters<typeof WalletService>[3] = {}) {
    const dataDir = temporaryDirectory(t);
    const value = new WalletService(settings({ BPM_DATA_DIR: dataDir }), rpc, undefined, { successTtlMs: 0, failureTtlMs: 0, ...options });
    t.after(() => value.stop());
    return { value, dataDir };
}
function untilAbort(signal?: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}

test('wallet discovery is lazy and uses the correct descriptor/legacy categories without combining wallets', async t => {
    const rpc = new WalletFake().wallet('descriptor', {}, { mine: balance(1.25, 0.00000003, 0.5), watchonly: balance(9) })
        .wallet('legacy', { descriptors: false }, { mine: balance(9), watchonly: balance(0.25, 0.1, 0.2) })
        .wallet('', { descriptors: false, blank: true }, { mine: balance() });
    const { value, dataDir } = service(t, rpc, { nowSeconds: () => 1234 });
    assert.equal(rpc.calls.length, 0); assert.equal(existsSync(join(dataDir, 'wallet-ticker.json')), false);
    const result = await value.snapshot();
    assert.equal(result.state, 'ready'); assert.equal(result.generated_at, 1234);
    assert.deepEqual(result.wallets.map(wallet => [wallet.name, wallet.balance_sats, wallet.pending_incoming_sats, wallet.immature_sats]), [
        ['', 0, 0, 0], ['descriptor', 125000000, 3, 50000000], ['legacy', 25000000, 10000000, 20000000],
    ]);
    assert.ok(rpc.calls.every(call => call.timeout === 5));
    assert.equal(existsSync(join(dataDir, 'wallet-ticker.json')), false);
});

test('signing/external-signer wallets are excluded from balance reads and scanning amounts stay unknown', async t => {
    const rpc = new WalletFake().wallet('hot', { private_keys_enabled: true }).wallet('signer', { external_signer: true })
        .wallet('scan', { scanning: { duration: 100, progress: 0.42 } });
    const { value } = service(t, rpc);
    const result = await value.snapshot();
    assert.deepEqual(result.wallets.map(wallet => [wallet.name, wallet.state, wallet.balance_sats]), [
        ['scan', 'scanning', null],
    ]);
    assert.equal(result.wallets[0]!.scanning_progress, 0.42);
    assert.equal(rpc.calls.filter(call => call.method === 'getbalances').length, 0);
});

test('amount conversion preserves satoshis and rejects invalid, nonnumeric and sub-satoshi amounts', () => {
    for (const [btc, sats] of [[0, 0], [0.00000001, 1], [0.00000003, 3], [1.23456789, 123456789], [21_000_000, 2100000000000000]]) assert.equal(walletSatoshis(btc), sats);
    for (const invalid of [null, '0', NaN, Infinity, -1, 21_000_001, 0.000000015, 1e-17]) assert.throws(() => walletSatoshis(invalid));
});

test('malformed metadata and missing balance objects never become fabricated zero balances', async t => {
    const rpc = new WalletFake().wallet('badinfo', { private_keys_enabled: 'false' }).wallet('badbalances', {}, {})
        .wallet('badprogress', { scanning: { progress: 2 } }).wallet('wrongname', { walletname: 'another' })
        .wallet('good', {}, { mine: balance(0) });
    const { value } = service(t, rpc);
    const result = await value.snapshot();
    assert.equal(result.state, 'partial');
    assert.equal(result.wallets.find(wallet => wallet.name === 'good')!.balance_sats, 0);
    for (const wallet of result.wallets.filter(wallet => wallet.name !== 'good')) {
        assert.equal(wallet.state, 'unavailable'); assert.equal(wallet.balance_sats, null);
    }
});

test('shared preferences validate additions, persist globally, and preserve unloaded/ineligible choices', async t => {
    const rpc = new WalletFake().wallet('watch', {}, { mine: balance(1) }).wallet('hot', { private_keys_enabled: true });
    const { value, dataDir } = service(t, rpc);
    await assert.rejects(value.setPreferences({ ...defaults, selected_wallets: ['hot'] }), error => error instanceof HttpError && error.status === 422);
    assert.equal(existsSync(join(dataDir, 'wallet-ticker.json')), false);
    const saved = await value.setPreferences({ ...defaults, selected_wallets: ['watch'] });
    assert.equal(saved.revision, 1);
    const restored = new WalletService(settings({ BPM_DATA_DIR: dataDir }), rpc);
    t.after(() => restored.stop());
    assert.deepEqual(restored.preferences(), saved);
    rpc.names = [];
    const unloaded = await value.snapshot();
    assert.deepEqual(unloaded.wallets.map(wallet => [wallet.name, wallet.state, wallet.balance_sats]), [['watch', 'unloaded', null]]);
    const before = rpc.calls.length;
    await value.setPreferences({ ...saved.preferences, paused: true });
    assert.equal(rpc.calls.length, before, 'editing existing selections works while the node is unavailable');
    rpc.names = ['watch']; rpc.infos.set('watch', { walletname: 'watch', private_keys_enabled: true });
    const ineligible = await value.snapshot();
    assert.equal(ineligible.wallets[0]!.state, 'ineligible'); assert.equal(ineligible.state, 'partial'); assert.ok(ineligible.reason);
    await value.setPreferences(defaults);
    assert.deepEqual(value.preferences().preferences.selected_wallets, []);
});

test('concurrent preference updates serialize validation and canceled queued saves never commit', async t => {
    const rpc = new WalletFake().wallet('watch'), gate = deferred<void>(), started = deferred<void>();
    rpc.handler = async call => {
        if (call.method === 'listwallets') { started.resolve(); await gate.promise; return rpc.names; }
        return call.method === 'getwalletinfo' ? rpc.infos.get(call.wallet!) : rpc.balances.get(call.wallet!);
    };
    const { value } = service(t, rpc, { successTtlMs: 1000 });
    const first = value.setPreferences({ ...defaults, selected_wallets: ['watch'] });
    await started.promise;
    const canceled = new AbortController();
    const canceledWrite = value.setPreferences({ ...defaults, paused: true }, canceled.signal);
    const last = value.setPreferences({ ...defaults, unit: 'sats' });
    canceled.abort(); await assert.rejects(canceledWrite);
    gate.resolve(); assert.equal((await first).revision, 1);
    assert.equal((await last).revision, 2);
    assert.deepEqual(value.preferences(), { preferences: { ...defaults, unit: 'sats' }, revision: 2 });
});

test('wallet workers never fan out more than two scoped RPC requests', async t => {
    const rpc = new WalletFake(); for (let i = 0; i < 8; i++) rpc.wallet(String(i));
    let active = 0, peak = 0;
    rpc.handler = async call => {
        if (call.method === 'listwallets') return rpc.names;
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 1)); active--;
        return call.method === 'getwalletinfo' ? rpc.infos.get(call.wallet!) : rpc.balances.get(call.wallet!);
    };
    const { value } = service(t, rpc);
    assert.equal((await value.snapshot()).wallets.length, 8); assert.equal(peak, 2);
});

test('unknown additions and invalid payloads never commit preferences', async t => {
    const { value } = service(t, new WalletFake());
    await assert.rejects(value.setPreferences({ ...defaults, selected_wallets: ['unknown'] }), HttpError);
    await assert.rejects(value.setPreferences({ ...defaults, selected_wallets: ['dup', 'dup'] }), HttpError);
    assert.equal(value.preferences().revision, 0);
    const canceled = new AbortController(); canceled.abort();
    await assert.rejects(value.setPreferences(defaults, canceled.signal));
    assert.equal(value.preferences().revision, 0);
});

test('wallet failures are sanitized, capability-specific, and never dashboard authentication errors', async t => {
    for (const error of [new RpcError('private-wallet-secret', -32601), new RpcAuthenticationError('private-wallet-secret'), new RpcError('private-wallet-secret', -28)]) {
        const rpc = new WalletFake(); rpc.listError = error;
        const { value } = service(t, rpc);
        const result = await value.snapshot();
        assert.equal(result.state, error.code === -32601 ? 'unsupported' : 'unavailable');
        assert.equal(JSON.stringify(result).includes('private-wallet-secret'), false);
    }
    const rpc = new WalletFake().wallet('gone').wallet('other', {}, { mine: balance(2) });
    rpc.balances.set('gone', new RpcError('private-wallet-secret', -18));
    const { value } = service(t, rpc);
    const result = await value.snapshot();
    assert.equal(result.state, 'ready');
    assert.equal(result.wallets.some(wallet => wallet.name === 'gone'), false, 'an unselected wallet that unloaded during discovery is removed');
    assert.equal(result.wallets.find(wallet => wallet.name === 'other')!.balance_sats, 200000000);
    assert.equal(JSON.stringify(result).includes('private-wallet-secret'), false);
});

test('catalog capacity is explicit and never silently truncates loaded wallets', async t => {
    const rpc = new WalletFake(); rpc.names = Array.from({ length: 129 }, (_, i) => `wallet-${i}`);
    const { value } = service(t, rpc);
    const result = await value.snapshot();
    assert.equal(result.state, 'unavailable'); assert.match(result.reason!, /128/);
    assert.deepEqual(result.wallets, []);
    assert.equal(rpc.calls.filter(call => call.wallet !== undefined).length, 0);
});

test('successful snapshots and failures use separate bounded caches without sharing mutable results', async t => {
    const rpc = new WalletFake().wallet('watch');
    const { value } = service(t, rpc, { successTtlMs: 1000 });
    const first = await value.snapshot(); first.wallets[0]!.name = 'changed';
    assert.equal((await value.snapshot()).wallets[0]!.name, 'watch');
    assert.equal(rpc.calls.filter(call => call.method === 'listwallets').length, 1);
    const failing = new WalletFake(); failing.listError = new Error('failure');
    const failed = service(t, failing, { failureTtlMs: 15 }).value;
    await failed.snapshot(); await failed.snapshot();
    assert.equal(failing.calls.length, 1);
    await new Promise(resolve => setTimeout(resolve, 25)); await failed.snapshot();
    assert.equal(failing.calls.length, 2);
});

test('two readers share work; canceling one does not cancel another and stop cancels the last reader', async t => {
    const rpc = new WalletFake().wallet('watch'), gate = deferred<void>(), started = deferred<void>();
    rpc.handler = async (call, signal) => {
        if (call.method === 'listwallets') return ['watch'];
        if (call.method === 'getwalletinfo') return rpc.infos.get('watch');
        started.resolve(); await Promise.race([gate.promise, untilAbort(signal)]); return { mine: balance(1) };
    };
    const { value } = service(t, rpc, { successTtlMs: 1000 });
    const canceled = new AbortController();
    const first = value.snapshot(canceled.signal), second = value.snapshot();
    await started.promise; canceled.abort(); await assert.rejects(first);
    gate.resolve(); assert.equal((await second).wallets[0]!.balance_sats, 100000000);
    assert.equal(rpc.calls.filter(call => call.method === 'listwallets').length, 1);
    const stoppingRpc = new WalletFake(); stoppingRpc.handler = (_call, signal) => untilAbort(signal);
    const stopping = service(t, stoppingRpc).value, pending = stopping.snapshot();
    stopping.stop(); await assert.rejects(pending);
});

test('refresh budgets bound work, preserve every catalog row and rotate attempts fairly', async t => {
    const rpc = new WalletFake().wallet('a').wallet('b').wallet('c').wallet('d');
    rpc.handler = async (call, signal) => {
        if (call.method === 'listwallets') return rpc.names;
        if (call.wallet === 'a' || call.wallet === 'b') return untilAbort(signal);
        return call.method === 'getwalletinfo' ? rpc.infos.get(call.wallet!) : { mine: balance(1) };
    };
    const { value } = service(t, rpc, { refreshTimeoutMs: 20 });
    assert.equal((await value.snapshot()).wallets.length, 4);
    const again = await value.snapshot();
    assert.equal(again.state, 'partial');
    assert.equal(again.wallets.find(wallet => wallet.name === 'c')!.balance_sats, 100000000);
    assert.deepEqual(rpc.calls.filter(call => call.method === 'getwalletinfo').slice(0, 4).map(call => call.wallet), ['a', 'b', 'c', 'd']);
});

test('invalid saved wallet preferences disable only wallet methods before any RPC', async t => {
    const dataDir = temporaryDirectory(t);
    writeFileSync(join(dataDir, 'wallet-ticker.json'), 'private-invalid-wallet-sentinel');
    const rpc = new WalletFake(), value = new WalletService(settings({ BPM_DATA_DIR: dataDir }), rpc);
    t.after(() => value.stop());
    assert.throws(() => value.preferences(), HttpError);
    await assert.rejects(value.snapshot(), HttpError);
    assert.equal(rpc.calls.length, 0);
});
