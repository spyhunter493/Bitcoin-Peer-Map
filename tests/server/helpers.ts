import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { loadSettings } from '../../src/server/settings.ts';
import type { Data, Rpc } from '../../src/server/types.ts';

export function temporaryDirectory(t: TestContext) {
    const path = mkdtempSync(join(tmpdir(), 'bpm-test-'));
    t.after(() => rmSync(path, { recursive: true, force: true }));
    return path;
}
export function settings(overrides: Record<string, string> = {}) {
    return loadSettings({ BITCOIN_RPC_HOST: '127.0.0.1', BITCOIN_RPC_USER: 'bpm-test', BITCOIN_RPC_PASSWORD: 'secret', ...overrides });
}
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
export const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
export class FakeRpc implements Rpc {
    calls: { method: string; params: unknown[] }[] = [];
    failed = new Set<string>();
    values: Data = {
        getblockchaininfo: { chain: 'main', blocks: 100, bestblockhash: 'block-100', size_on_disk: 1e9 },
        getindexinfo: { txindex: {} }, getbestblockhash: 'block-100',
        getblockheader: { height: 100, time: 1000 },
        getnetworkinfo: { connections: 100, subversion: '/Satoshi:30/', networks: [], localaddresses: [] },
        getnettotals: { totalbytesrecv: 2048, totalbytessent: 4096 },
        getmempoolinfo: { size: 5 }, getpeerinfo: [], getnodeaddresses: [], getchaintips: [],
    };
    async call(method: string, params: unknown[] = []): Promise<any> {
        this.calls.push({ method, params });
        if (this.failed.has(method)) throw new Error(`${method} failed`);
        const value = this.values[method];
        return typeof value === 'function' ? value(params) : structuredClone(value ?? null);
    }
    count(method: string) { return this.calls.filter(call => call.method === method).length; }
}
