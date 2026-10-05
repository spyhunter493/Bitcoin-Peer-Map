import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './http.ts';

const WINDOW_MS = 60_000;
const MAX_FAILURES = 10;
const MAX_CLIENTS = 1024;
const digest = (value: string) => createHash('sha256').update(value).digest();

export function createAdminAuthentication(token: string | null) {
    const expected = token ? digest(token) : null;
    const failures = new Map<string, { count: number; expires: number }>();

    return function requireAdmin(req: IncomingMessage, res: ServerResponse) {
        res.setHeader('Cache-Control', 'no-store');
        if (!expected) throw new HttpError(403, 'Management is read-only because BPM_ADMIN_TOKEN is not configured.', 'management_disabled');

        const header = req.headers.authorization || '';
        const supplied = /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/i.exec(header)?.[1] || '';
        // Hashes have a fixed length, including for missing or malformed tokens.
        const valid = timingSafeEqual(digest(supplied), expected);
        const client = req.socket.remoteAddress || 'unknown';
        if (valid) { failures.delete(client); return; }

        const now = Date.now();
        for (const [address, entry] of failures) if (entry.expires <= now) failures.delete(address);
        let entry = failures.get(client);
        if (!entry) {
            if (failures.size >= MAX_CLIENTS) failures.delete(failures.keys().next().value!);
            entry = { count: 0, expires: now + WINDOW_MS };
            failures.set(client, entry);
        }
        // Use the socket address; untrusted forwarding headers cannot evade limits.
        if (++entry.count > MAX_FAILURES) {
            res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.expires - now) / 1000))));
            throw new HttpError(429, 'Too many incorrect tokens. Try again shortly.', 'admin_rate_limited');
        }
        res.setHeader('WWW-Authenticate', 'Bearer realm="Bitcoin Peer Map management"');
        throw new HttpError(401, 'Enter the admin token to manage this dashboard.', 'admin_required');
    };
}
