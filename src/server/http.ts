import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { type Data, object } from './types.ts';

const MAX_REQUEST_BYTES = 64 * 1024;
const MIN_GZIP_BYTES = 500;
const compress = promisify(gzip);

export class HttpError extends Error {
    readonly status: number;
    readonly code?: string;

    constructor(status: number, message: string, code?: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export function requireDashboardOrigin(req: IncomingMessage) {
    // Browser POSTs must target their own dashboard host. Compare hosts so TLS
    // termination works when a reverse proxy preserves the external Host header.
    // CLI clients do not send Origin and keep their existing API behavior.
    if (!req.headers.origin) return;
    try {
        const origin = new URL(req.headers.origin);
        const target = new URL(`${origin.protocol}//${req.headers.host || ''}`);
        if (['http:', 'https:'].includes(origin.protocol) && origin.host === target.host) return;
    } catch { /* Invalid and opaque origins are rejected with the same error. */ }
    throw new HttpError(403, 'Cross-origin requests are not allowed');
}

export async function readJsonBody(req: IncomingMessage): Promise<Data> {
    if (Number(req.headers['content-length']) > MAX_REQUEST_BYTES) {
        throw new HttpError(413, 'Request body is too large');
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) throw new HttpError(413, 'Request body is too large');
        chunks.push(chunk);
    }

    let value: unknown;
    try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new HttpError(422, 'Invalid JSON body');
    }
    if (!object(value)) throw new HttpError(422, 'Expected a JSON object');
    return value;
}

export function parseAddress(payload: Data) {
    const value = payload.address ?? '';
    if (typeof value !== 'string') throw new HttpError(422, 'address must be a string');
    return value;
}

export function parseEnabled(payload: Data): boolean {
    if (typeof payload.enabled !== 'boolean') throw new HttpError(422, 'enabled must be a boolean');
    return payload.enabled;
}

export function parsePeerId(payload: Data): number | null {
    if (payload.peer_id == null) return null;
    const value = payload.peer_id;
    const validType = typeof value === 'number' || typeof value === 'string';
    if (!validType || String(value).trim() === '' || !Number.isSafeInteger(Number(value))) {
        throw new HttpError(422, 'peer_id must be an integer');
    }
    return Number(value);
}

export function parseQueryBoolean(query: URLSearchParams, name: string, fallback: boolean) {
    if (!query.has(name)) return fallback;
    const value = query.get(name)!.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(value)) return true;
    if (['false', '0', 'no', 'off'].includes(value)) return false;
    throw new HttpError(422, `${name} must be a boolean`);
}

function acceptsGzip(header: string) {
    return header.split(',').some(entry => {
        const [encoding, ...parameters] = entry.trim().toLowerCase().split(';');
        if (encoding.trim() !== 'gzip') return false;
        const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
        return quality === undefined || Number(quality.trim().slice(2)) > 0;
    });
}

export async function sendResponse(
    req: IncomingMessage,
    res: ServerResponse,
    value: unknown,
    status = 200,
    type = 'application/json',
) {
    if (res.destroyed) return;

    let bytes: Buffer;
    if (Buffer.isBuffer(value)) bytes = value;
    else if (type === 'application/json') bytes = Buffer.from(JSON.stringify(value));
    else bytes = Buffer.from(String(value));

    const textContent = type.startsWith('text/') || type === 'application/json';
    res.statusCode = status;
    res.setHeader('Content-Type', textContent ? `${type}; charset=utf-8` : type);
    const vary = String(res.getHeader('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
    if (!vary.some(value => value.toLowerCase() === 'accept-encoding' || value === '*')) vary.push('Accept-Encoding');
    res.setHeader('Vary', vary.join(', '));
    if (bytes.length >= MIN_GZIP_BYTES && acceptsGzip(req.headers['accept-encoding'] || '')) {
        bytes = await compress(bytes, { level: 6 });
        res.setHeader('Content-Encoding', 'gzip');
    }
    res.setHeader('Content-Length', bytes.length);
    res.end(req.method === 'HEAD' ? undefined : bytes);
}
