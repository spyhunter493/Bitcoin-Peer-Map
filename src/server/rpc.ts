import http from 'node:http';
import https from 'node:https';
import type { Settings } from './settings.ts';
import { object, errorMessage } from './types.ts';

export class RpcError extends Error {}
export class RpcTransportError extends RpcError {}
export class RpcAuthenticationError extends RpcError {}

export class BitcoinRpcClient {
    readonly settings: Settings;
    readonly signal?: AbortSignal;
    private id = 0;
    constructor(settings: Settings, signal?: AbortSignal) { this.settings = settings; this.signal = signal; }
    get connectionInfo() {
        return { scheme: this.settings.rpc_scheme, host: this.settings.rpc_host, port: this.settings.rpc_port, network: this.settings.bitcoin_network };
    }
    async call(method: string, params: unknown[] = [], timeoutSeconds = this.settings.rpc_timeout): Promise<any> {
        const payload = JSON.stringify({ jsonrpc: '1.0', id: ++this.id, method, params });
        const transport = this.settings.rpc_scheme === 'https' ? https : http;
        const signal = AbortSignal.any([AbortSignal.timeout(Math.ceil(timeoutSeconds * 1000)), ...(this.signal ? [this.signal] : [])]);
        const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
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
        }).catch(error => { throw new RpcTransportError(`Bitcoin RPC request failed: ${errorMessage(error)}`); });
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
        if (!object(result)) throw new RpcError('getnetworkinfo returned an unexpected response');
        return result;
    }
}
