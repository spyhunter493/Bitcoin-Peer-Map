import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './http.ts';
import { anonymousClientIdentity, type TrustedProxy } from './trusted-proxies.ts';

const WINDOW_MS = 60_000;
const MAX_FAILURES = 10;
const MAX_CLIENTS = 1024;
const digest = (value: string) => createHash('sha256').update(value).digest();

export function privateViewingResponse(res: ServerResponse) {
    res.setHeader('Cache-Control', 'private, no-store');
    const vary = String(res.getHeader('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
    for (const name of ['Authorization', 'Cookie']) if (!vary.some(value => value.toLowerCase() === name.toLowerCase() || value === '*')) vary.push(name);
    res.setHeader('Vary', vary.join(', '));
}

/** Viewing credentials never authorize mutations. Valid credentials bypass
 * anonymous throttling without consulting or resetting its identity windows. */
export function createViewingAuthentication(viewToken: string | null, adminToken: string | null, trustedProxies: readonly TrustedProxy[] = [], authenticateSession: (req: IncomingMessage) => boolean = () => false) {
    const expected = [viewToken, adminToken].filter((value): value is string => Boolean(value)).map(digest);
    const failures = new Map<string, { count: number; expires: number }>();
    return function requireViewer(req: IncomingMessage, res: ServerResponse, allowSession = true) {
        privateViewingResponse(res);
        if (!expected.length) throw new HttpError(403, 'Viewing authentication is not configured.', 'viewing_disabled');
        const authorization = req.headers.authorization;
        const header = authorization || '';
        const supplied = header.length <= 263 ? /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/i.exec(header)?.[1] || '' : '';
        const candidate = digest(supplied);
        let valid = false;
        for (const token of expected) valid = timingSafeEqual(candidate, token) || valid;
        if (valid) return;
        if (allowSession && authorization === undefined && authenticateSession(req)) return;

        const client = anonymousClientIdentity(req, trustedProxies);
        const now = Date.now();
        for (const [address, entry] of failures) if (entry.expires <= now) failures.delete(address);
        let entry = failures.get(client);
        const blockedUntil = entry && entry.count >= MAX_FAILURES ? entry.expires
            : !entry && failures.size >= MAX_CLIENTS ? Math.min(...Array.from(failures.values(), value => value.expires)) : null;
        if (blockedUntil !== null) {
            res.setHeader('Retry-After', String(Math.max(1, Math.ceil((blockedUntil - now) / 1000))));
            throw new HttpError(429, 'Authentication cooldown active.', 'view_rate_limited');
        }
        if (!entry) { entry = { count: 0, expires: now + WINDOW_MS }; failures.set(client, entry); }
        entry.count++;
        res.setHeader('WWW-Authenticate', 'Bearer realm="Bitcoin Peer Map viewing"');
        throw new HttpError(401, 'Enter a viewing or administrator token to view this dashboard.', 'view_required');
    };
}
