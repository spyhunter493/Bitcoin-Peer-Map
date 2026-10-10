import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, requireBrowserOrigin } from './http.ts';

export const BROWSER_SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_SESSIONS = 1024;
const MAX_TIMER_MS = 2 ** 31 - 1;
const MAX_COOKIE_BYTES = 8192;
const COOKIE_NAMES = { view: 'bpm_view_session', admin: 'bpm_admin_session' } as const;
type Role = keyof typeof COOKIE_NAMES;
type Session = { role: Role; expires: number };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Only opaque random identifiers reach the browser; configured tokens stay out
 * of cookies. Restarting the application discards every remembered session. */
export function createBrowserSessions() {
    const sessions = new Map<string, Session>();
    const watchers = new Set<() => void>();

    function cookie(req: IncomingMessage, role: Role) {
        const header = req.headers.cookie || '';
        if (header.length > MAX_COOKIE_BYTES) return '';
        const values = header.split(';').map(value => value.trim())
            .filter(value => value.startsWith(`${COOKIE_NAMES[role]}=`))
            .map(value => value.slice(COOKIE_NAMES[role].length + 1));
        // Duplicate cookies are ambiguous, including cookies planted at another path.
        return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : '';
    }
    function entry(req: IncomingMessage, role: Role) {
        const value = cookie(req, role), key = value ? digest(value) : '';
        const session = sessions.get(key);
        if (!session || session.role !== role) return null;
        if (session.expires <= Date.now()) { sessions.delete(key); return null; }
        return session;
    }
    function has(req: IncomingMessage, role: Role) { return Boolean(entry(req, role)); }
    function hasViewer(req: IncomingMessage) { return has(req, 'view') || has(req, 'admin'); }
    function hasCredentials(req: IncomingMessage) {
        const header = req.headers.cookie || '';
        return header.length > MAX_COOKIE_BYTES || header.split(';').some(value => Object.values(COOKIE_NAMES).some(name => value.trim().startsWith(`${name}=`)));
    }
    function notify() { for (const watcher of [...watchers]) watcher(); }
    function setCookie(req: IncomingMessage, res: ServerResponse, role: Role, value: string, seconds: number) {
        // Browser login/logout requires a validated Origin, which also preserves
        // the external HTTPS scheme behind TLS termination without trusting XFP.
        const secure = new URL(req.headers.origin!).protocol === 'https:';
        const header = `${COOKIE_NAMES[role]}=${value}; Path=/api; Max-Age=${seconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
        const existing = res.getHeader('Set-Cookie');
        res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing.map(String) : existing ? [String(existing)] : []), header]);
    }
    function revoke(req: IncomingMessage, roles: readonly Role[]) {
        for (const role of roles) {
            const value = cookie(req, role);
            if (value) sessions.delete(digest(value));
        }
    }
    function issue(req: IncomingMessage, res: ServerResponse, role: Role) {
        requireBrowserOrigin(req);
        const now = Date.now();
        for (const [key, session] of sessions) if (session.expires <= now) sessions.delete(key);
        revoke(req, [role]);
        if (sessions.size >= MAX_SESSIONS) throw new HttpError(503, 'Remembered session capacity is full. Try again after locking another browser session.', 'session_capacity');
        const value = randomBytes(32).toString('base64url');
        sessions.set(digest(value), { role, expires: now + BROWSER_SESSION_SECONDS * 1000 });
        setCookie(req, res, role, value, BROWSER_SESSION_SECONDS);
        notify();
    }
    function logout(req: IncomingMessage, res: ServerResponse, role: Role) {
        requireBrowserOrigin(req);
        const roles: readonly Role[] = role === 'view' ? ['view', 'admin'] : ['admin'];
        revoke(req, roles);
        for (const item of roles) setCookie(req, res, item, '', 0);
        notify();
    }
    function watchViewer(req: IncomingMessage, onInvalid: () => void) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let stopped = false;
        function stop() {
            stopped = true;
            if (timer !== null) clearTimeout(timer);
            timer = null;
            watchers.delete(check);
        }
        function check() {
            if (stopped) return;
            if (timer !== null) clearTimeout(timer);
            timer = null;
            const active = [entry(req, 'view'), entry(req, 'admin')].filter((session): session is Session => Boolean(session));
            if (!active.length) { stop(); onInvalid(); return; }
            const nextExpiry = Math.min(...active.map(session => session.expires));
            timer = setTimeout(check, Math.min(MAX_TIMER_MS, Math.max(1, nextExpiry - Date.now()))).unref();
        }
        watchers.add(check);
        check();
        return stop;
    }
    function clear() { sessions.clear(); notify(); }

    return { has, hasViewer, hasCredentials, issue, logout, watchViewer, clear };
}
