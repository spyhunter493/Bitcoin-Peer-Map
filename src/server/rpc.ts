import http from 'node:http';
import https from 'node:https';
import type { Settings } from './settings.ts';
import { object, errorMessage } from './types.ts';
import { parseNetworkInfo } from './rpc-types.ts';
import { createLogger } from './logging.ts';

const log = createLogger('rpc');

export class RpcError extends Error {}
export class RpcTransportError extends RpcError {}
export class RpcAuthenticationError extends RpcError {}
export class RpcBusyError extends RpcError {
    constructor() { super('Bitcoin RPC is busy; try again shortly'); }
}

export const RPC_CONCURRENCY = 8;
export const RPC_QUEUE_LIMIT = 32;
interface WaitingCall { signal: AbortSignal; abort: () => void; resolve: () => void }

export class BitcoinRpcClient {
    readonly settings: Settings;
    readonly signal?: AbortSignal;
    private id = 0;
    private active = 0;
    private waiting: WaitingCall[] = [];
    constructor(settings: Settings, signal?: AbortSignal) { this.settings = settings; this.signal = signal; }
    get connectionInfo() {
        return { scheme: this.settings.rpc_scheme, host: this.settings.rpc_host, port: this.settings.rpc_port, network: this.settings.bitcoin_network };
    }
    private acquire(signal: AbortSignal): Promise<void> {
        signal.throwIfAborted();
        if (this.active < RPC_CONCURRENCY) { this.active++; return Promise.resolve(); }
        if (this.waiting.length >= RPC_QUEUE_LIMIT) throw new RpcBusyError();
        return new Promise<void>((resolve, reject) => {
            const entry: WaitingCall = { signal, resolve, abort: () => {
                const index = this.waiting.indexOf(entry);
                if (index >= 0) this.waiting.splice(index, 1);
                reject(signal.reason);
            } };
            signal.addEventListener('abort', entry.abort, { once: true });
            this.waiting.push(entry);
        });
    }
    private release() {
        this.active--;
        const next = this.waiting.shift();
        if (next) {
            next.signal.removeEventListener('abort', next.abort);
            this.active++;
            next.resolve();
        }
    }
    async call(method: string, params: unknown[] = [], timeoutSeconds = this.settings.rpc_timeout, callerSignal?: AbortSignal): Promise<unknown> {
        const started = performance.now();
        log.debug(`Calling ${method} (timeout ${timeoutSeconds}s)`);
        const payload = JSON.stringify({ jsonrpc: '1.0', id: ++this.id, method, params });
        const transport = this.settings.rpc_scheme === 'https' ? https : http;
        const signal = AbortSignal.any([AbortSignal.timeout(Math.ceil(timeoutSeconds * 1000)), ...(this.signal ? [this.signal] : []), ...(callerSignal ? [callerSignal] : [])]);
        const response = await (async () => {
            await this.acquire(signal);
            try {
                signal.throwIfAborted();
                return await new Promise<{ status: number; text: string }>((resolve, reject) => {
                    const req = transport.request(this.settings.rpc_url, {
                        method: 'POST', signal, rejectUnauthorized: this.settings.rpc_verify_tls,
                        auth: `${this.settings.rpc_user}:${this.settings.rpc_password}`,
                        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
                    }, res => {
                        const chunks: Buffer[] = [];
                        let length = 0;
                        res.on('data', (chunk: Buffer) => {
                            length += chunk.length;
                            if (length > 32 * 1024 * 1024) { res.destroy(new Error('RPC response exceeds 32 MiB')); return; }
                            chunks.push(chunk);
                        });
                        res.on('error', reject);
                        res.on('end', () => resolve({ status: res.statusCode || 502, text: Buffer.concat(chunks).toString('utf8') }));
                    });
                    req.on('error', reject);
                    req.end(payload);
                });
            } finally { this.release(); }
        })().catch(error => {
            if (error instanceof RpcBusyError) throw error;
            log.debug(`${method} transport failed after ${Math.round(performance.now() - started)}ms: ${errorMessage(error)}`);
            throw new RpcTransportError(`Bitcoin RPC request failed: ${errorMessage(error)}`);
        });
        log.debug(`${method} returned HTTP ${response.status} in ${Math.round(performance.now() - started)}ms`);
        if ([401, 403].includes(response.status)) throw new RpcAuthenticationError('Bitcoin RPC authentication failed');
        let body: unknown;
        try { body = JSON.parse(response.text); } catch { throw new RpcTransportError(`Bitcoin RPC returned HTTP ${response.status} without JSON`); }
        if (!object(body)) throw new RpcTransportError('Bitcoin RPC returned an unexpected response');
        if (body.error) throw new RpcError(object(body.error) ? String(body.error.message || JSON.stringify(body.error)) : String(body.error));
        if (response.status >= 400) throw new RpcTransportError(`Bitcoin RPC returned HTTP ${response.status}`);
        return body.result ?? null;
    }
    async checkConnection(timeoutSeconds = this.settings.rpc_timeout) {
        const result = await this.call('getnetworkinfo', [], timeoutSeconds);
        return parseNetworkInfo(result);
    }
}
