import { createServer, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { AppRuntime } from './runtime.ts';
import type { Settings } from './settings.ts';
import { type Data, errorMessage, object } from './types.ts';
import { HttpError, readJsonBody, parseAddress, parseEnabled, parsePeerId, parseQueryBoolean, requireDashboardOrigin, requireBrowserOrigin, sendResponse } from './http.ts';
import { GITHUB_REPOSITORY, REPOSITORY_URL } from './build.ts';
import { NODE_METRICS_INTERVAL_MS } from './services/node-metrics.ts';
import { createAdminAuthentication } from './admin-auth.ts';
import { createViewingAuthentication, privateViewingResponse } from './viewer-auth.ts';
import { viewingAggregate } from './viewer-summary.ts';
import type { OutboundPreference } from './preferences.ts';
import { createLogger } from './logging.ts';
import { RpcBusyError } from './rpc.ts';
import type { ApiRoutes, RouteHandler } from './api-routes.ts';
import { setSecurityHeaders } from './security.ts';
import { createBrowserSessions } from './browser-sessions.ts';

const log = createLogger('http');

export interface ApplicationRuntime {
    settings: Settings;
    start(): void | Promise<void>;
    stop(): void | Promise<void>;
    setGeoipDbOnly(enabled: boolean): boolean;
    setGeoipAutoUpdate(enabled: boolean): boolean;
    setOutboundPreference: AppRuntime['setOutboundPreference'];
    outbound: Pick<AppRuntime['outbound'], 'snapshot'>;
    peers: Pick<AppRuntime['peers'], 'snapshot' | 'listPeers'>;
    node: Pick<AppRuntime['node'], 'dashboardInfo' | 'mempool' | 'blockchain' | 'recentBlocks' | 'chainTips' | 'connect' | 'disconnect' | 'ban' | 'unban' | 'bans' | 'clearBans'>;
    metrics: Pick<AppRuntime['metrics'], 'latest' | 'summary'>;
    updates: Pick<AppRuntime['updates'], 'snapshot'>;
    connectivity: Pick<AppRuntime['connectivity'], 'snapshot' | 'acknowledgePrompt'>;
    geoDatabase: Pick<AppRuntime['geoDatabase'], 'update'>;
    rpc: Pick<AppRuntime['rpc'], 'connectionInfo'>;
}
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.html': 'text/html' };
export function assetRevision(staticDir: string, revision: string) {
    if (revision !== 'unknown') return revision;
    const digest = createHash('sha256');
    const paths = readdirSync(staticDir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
    for (const path of paths.sort()) { digest.update(path.slice(staticDir.length + 1).split(sep).join('/')); digest.update(readFileSync(path)); }
    return digest.digest('hex').slice(0, 12);
}
export function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
export function createApplication(settings: Settings, runtime: ApplicationRuntime = new AppRuntime(settings)) {
    const staticDir = join(packageDir, 'static');
    const revision = settings.build_revision;
    const version = settings.build_version;
    const assets = assetRevision(staticDir, revision);
    const repositoryUrl = REPOSITORY_URL;
    const revisionUrl = revision === 'unknown' ? repositoryUrl : `${repositoryUrl}/commit/${revision}`;
    const template = readFileSync(join(packageDir, 'templates/index.html'), 'utf8');
    const values: Record<string, string> = { version, asset_revision: assets, repository_url: repositoryUrl, repository_discussions_url: `${repositoryUrl}/discussions` };
    const html = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => escapeHtml(values[key] ?? ''));
    const docs = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Bitcoin Peer Map API</title><link rel="stylesheet" href="/static/v/${assets}/vendor/swagger-ui/swagger-ui.css"></head><body><div id="swagger-ui"></div><script defer src="/static/v/${assets}/vendor/swagger-ui/swagger-ui-bundle.js"></script><script defer src="/static/v/${assets}/js/docs.js"></script></body></html>`;
    const schema: Data = JSON.parse(readFileSync(new URL('./openapi.json', import.meta.url), 'utf8'));
    if (!object(schema.info)) throw new Error('OpenAPI schema is missing its info object');
    schema.info.version = version;
    const streams = new Set<ServerResponse>();
    let closeTask: Promise<void> | null = null;
    const sessions = createBrowserSessions();
    const requireAdmin = createAdminAuthentication(settings.admin_token, settings.trusted_proxies, req => sessions.has(req, 'admin'));
    const requireViewer = createViewingAuthentication(settings.view_token, settings.admin_token, settings.trusted_proxies, sessions.hasViewer);

    const routes: Record<string, RouteHandler> = {
        'GET /healthz': () => ({ status: 'ok' }),
        'GET /api/access': (_query, req, res) => {
            privateViewingResponse(res);
            return { mode: settings.view_mode, authentication_available: Boolean(settings.view_token || settings.admin_token),
                viewing_authenticated: sessions.hasViewer(req), management_authenticated: sessions.has(req, 'admin') };
        },
        'GET /api/view/aggregate': (_query, _req, res) => { if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store'); return viewingAggregate(runtime.peers.snapshot()); },
        'POST /api/view/verify': (_query, req, res) => {
            if (req.headers['x-bpm-remember'] !== '1') return { success: true };
            sessions.issue(req, res, 'view');
            return { success: true, remembered: true };
        },
        'POST /api/admin/verify': (_query, req, res) => {
            if (req.headers['x-bpm-remember'] !== '1') return { success: true };
            sessions.issue(req, res, 'admin');
            return { success: true, remembered: true };
        },
        'POST /api/view/logout': (_query, req, res) => { privateViewingResponse(res); sessions.logout(req, res, 'view'); return { success: true }; },
        'POST /api/admin/logout': (_query, req, res) => { privateViewingResponse(res); sessions.logout(req, res, 'admin'); return { success: true }; },
        'GET /api/peers': (query, _req, res) => { if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store'); return parseQueryBoolean(query, 'include_status', false) ? runtime.peers.snapshot() : runtime.peers.listPeers(); },
        'GET /api/info': async (_query, _req, _res, signal) => ({ ...await runtime.node.dashboardInfo(signal), updates: runtime.updates.snapshot() }),
        'GET /api/mempool': (_query, _req, _res, signal) => runtime.node.mempool(signal),
        'GET /api/blockchain': (_query, _req, _res, signal) => runtime.node.blockchain(signal),
        'GET /api/blocks/recent': (query, _req, _res, signal) => {
            const limit = query.get('limit') ?? '25';
            if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) throw new HttpError(422, 'limit must be between 1 and 100');
            return runtime.node.recentBlocks(Number(limit), signal);
        },
        'GET /api/chain-tips': (_query, _req, _res, signal) => runtime.node.chainTips(signal),
        'GET /api/bans': (_query, _req, _res, signal) => runtime.node.bans(signal),
        'POST /api/peer/connect': async (_query, req) => runtime.node.connect(parseAddress(await readJsonBody(req))),
        'POST /api/peer/disconnect': async (_query, req) => runtime.node.disconnect(parsePeerId(await readJsonBody(req))),
        'POST /api/peer/ban': async (_query, req) => runtime.node.ban(parsePeerId(await readJsonBody(req))),
        'POST /api/peer/unban': async (_query, req) => runtime.node.unban(parseAddress(await readJsonBody(req))),
        'POST /api/bans/clear': () => runtime.node.clearBans(),
        'GET /api/connectivity': () => runtime.connectivity.snapshot(),
        'POST /api/connectivity/api-prompt-ack': () => { runtime.connectivity.acknowledgePrompt(); return { success: true }; },
        'POST /api/geodb/db-only': async (_query, req) => { const disabled = runtime.setGeoipDbOnly(parseEnabled(await readJsonBody(req))); return { success: true, geo_db_only_mode: disabled, message: disabled ? 'API lookup disabled. To re-enable, return to this menu.' : 'API lookup re-enabled.' }; },
        'POST /api/geodb/auto-update': async (_query, req) => { const enabled = runtime.setGeoipAutoUpdate(parseEnabled(await readJsonBody(req))); return { success: true, auto_update: enabled, message: enabled ? 'Auto-update enabled' : 'Auto-update disabled' }; },
        'POST /api/geodb/toggle-db-only': () => { throw new HttpError(410, 'This toggle endpoint has been retired. Reload the dashboard or use POST /api/geodb/db-only with {"enabled": boolean}.', 'endpoint_retired'); },
        'POST /api/geodb/toggle-auto-update': () => { throw new HttpError(410, 'This toggle endpoint has been retired. Reload the dashboard or use POST /api/geodb/auto-update with {"enabled": boolean}.', 'endpoint_retired'); },
        'POST /api/geodb/update': () => runtime.geoDatabase.update(),
        'GET /api/stats': async () => ({ system_stats: await runtime.metrics.summary() }),
        'GET /api/rpc-info': () => ({ ...runtime.rpc.connectionInfo, endpoint: settings.rpc_url }),
        'GET /api/config': () => ({
            bitcoin_rpc: { scheme: settings.rpc_scheme, host: settings.rpc_host, port: settings.rpc_port, network: settings.bitcoin_network, verify_tls: settings.rpc_verify_tls, timeout: settings.rpc_timeout, startup_timeout: settings.rpc_startup_timeout, username_configured: Boolean(settings.rpc_user), password_configured: Boolean(settings.rpc_password), password_file_configured: settings.rpc_password_file_configured, endpoint: settings.rpc_url },
            server: { listen_address: settings.listen_address, listen_port: settings.listen_port, log_level: settings.log_level },
            management: { enabled: Boolean(settings.admin_token) },
            outbound: runtime.outbound.snapshot(),
            geoip: { enabled: settings.geoip_enabled, auto_update_override: settings.geoip_auto_update_override },
            build: { version, revision, revision_known: revision !== 'unknown', asset_revision: assets, revision_url: revisionUrl, updates: runtime.updates.snapshot() },
            repository: { github: GITHUB_REPOSITORY, url: repositoryUrl }, data: { data_dir: settings.data_dir },
        }),
        'GET /api/config/outbound': () => runtime.outbound.snapshot(),
        'POST /api/config/outbound': async (_query, req) => {
            const payload = await readJsonBody(req);
            if (Object.keys(payload).some(key => !['preference', 'enabled'].includes(key))) {
                throw new HttpError(422, 'body may contain only preference and enabled');
            }
            if (typeof payload.preference !== 'string' || !['optional_outbound', 'geoip_dataset_downloads', 'release_checks', 'reachability_checks'].includes(payload.preference)) {
                throw new HttpError(422, 'preference must name a supported outbound control');
            }
            return runtime.setOutboundPreference(payload.preference as OutboundPreference, parseEnabled(payload));
        },
        'GET /openapi.json': () => schema,
    } satisfies ApiRoutes;
    const server = createServer(async (req, res) => {
        // Set before routing so HEAD, errors, conditional assets, and streams agree.
        setSecurityHeaders(res);
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableFinished) controller.abort(new DOMException('Client disconnected', 'AbortError')); };
        res.once('close', disconnected);
        try {
            const url = new URL(req.url || '/', 'http://localhost');
            const method = req.method === 'HEAD' ? 'GET' : req.method;
            const credentialBearing = req.headers.authorization !== undefined || sessions.hasCredentials(req);
            const logout = ['/api/view/logout', '/api/admin/logout'].includes(url.pathname);
            const rememberedLogin = ['/api/view/verify', '/api/admin/verify'].includes(url.pathname) && req.headers['x-bpm-remember'] === '1';
            const anonymousAggregate = url.pathname === '/api/view/aggregate' && settings.view_mode !== 'authenticated';
            const protectedRead = method === 'GET' && url.pathname.startsWith('/api/') && url.pathname !== '/api/access' && !anonymousAggregate;
            // Apply before direct streams, query parsing, RPC work, HEAD and errors.
            if (credentialBearing || (protectedRead && settings.view_mode !== 'public')) privateViewingResponse(res);
            if (protectedRead && settings.view_mode !== 'public') requireViewer(req, res);
            if (method === 'POST' && url.pathname.startsWith('/api/')) {
                if (logout || rememberedLogin || (req.headers.authorization === undefined && sessions.hasCredentials(req))) requireBrowserOrigin(req);
                else requireDashboardOrigin(req);
            }
            if (method === 'GET' && url.pathname === '/') { if (!credentialBearing) res.setHeader('Cache-Control', 'no-cache'); await sendResponse(req, res, html, 200, 'text/html'); return; }
            if (method === 'GET' && ['/docs', '/redoc'].includes(url.pathname)) {
                await sendResponse(req, res, docs, 200, 'text/html'); return;
            }
            if (method === 'GET' && url.pathname.startsWith('/static/')) {
                let raw: string;
                try { raw = decodeURIComponent((req.url || '').split('?')[0]); } catch { throw new HttpError(404, 'Not found'); }
                const parts = raw.split('/');
                if (raw.includes('\\') || raw.includes('\0') || parts.some(part => part.startsWith('.'))) throw new HttpError(404, 'Not found');
                let asset = raw.slice('/static/'.length), versioned = false;
                if (asset.startsWith('v/')) {
                    const [, requested, ...rest] = asset.split('/');
                    if (requested !== assets || !rest.join('/')) throw new HttpError(404, 'Not found');
                    asset = rest.join('/'); versioned = true;
                }
                let path: string;
                try { path = await realpath(resolve(staticDir, asset)); } catch { throw new HttpError(404, 'Not found'); }
                if (!path.startsWith(staticDir + sep) || !(await stat(path)).isFile()) throw new HttpError(404, 'Not found');
                const bytes = await readFile(path);
                const etag = `W/"${createHash('sha256').update(bytes).digest('hex')}"`;
                const versions = url.searchParams.getAll('v');
                if (!credentialBearing) res.setHeader('Cache-Control', versioned || (versions.length === 1 && versions[0] === assets) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
                res.setHeader('ETag', etag);
                if (!credentialBearing && req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
                await sendResponse(req, res, bytes, 200, mime[extname(path)] || 'application/octet-stream'); return;
            }
            if (method === 'GET' && url.pathname === '/api/stream/system') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': credentialBearing || settings.view_mode !== 'public' ? 'private, no-store' : 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
                if (req.method === 'HEAD') { res.end(); return; }
                res.write('event: message\ndata: {"type":"connected"}\n\n');
                streams.add(res);
                let pending = false;
                const cookieProtected = settings.view_mode !== 'public' && req.headers.authorization === undefined;
                const sample = async () => {
                    if (pending || res.destroyed || res.writableEnded) return;
                    if (cookieProtected && !sessions.hasViewer(req)) { res.end(); return; }
                    pending = true;
                    try {
                        const snapshot = await runtime.metrics.summary();
                        if (cookieProtected && !sessions.hasViewer(req)) { res.end(); return; }
                        if (!res.destroyed && !res.writableEnded && !res.write(`event: system\ndata: ${JSON.stringify(snapshot)}\n\n`)) res.end();
                    } catch { res.end(); }
                    finally { pending = false; }
                };
                const timer = setInterval(() => { void sample(); }, NODE_METRICS_INTERVAL_MS); void sample();
                let stopWatching = () => {};
                res.once('close', () => { clearInterval(timer); stopWatching(); streams.delete(res); });
                if (cookieProtected) stopWatching = sessions.watchViewer(req, () => res.end());
                return;
            }
            const route = routes[`${method} ${url.pathname}`];
            if (!route) {
                const allowed = Object.keys(routes).filter(key => key.endsWith(` ${url.pathname}`)).map(key => key.split(' ')[0]);
                if (allowed.length) { res.setHeader('Allow', allowed.join(', ')); throw new HttpError(405, 'Method not allowed'); }
                throw new HttpError(404, 'Not found');
            }
            if (method === 'POST' && url.pathname.startsWith('/api/') && !logout) {
                if (url.pathname === '/api/view/verify') requireViewer(req, res, !rememberedLogin);
                else requireAdmin(req, res, !rememberedLogin);
            }
            const result = await route(url.searchParams, req, res, controller.signal);
            if (credentialBearing || (protectedRead && settings.view_mode !== 'public')) privateViewingResponse(res);
            await sendResponse(req, res, result);
        } catch (error) {
            if (res.destroyed || controller.signal.aborted) return;
            if (res.headersSent) { res.destroy(); return; }
            if (req.headers.authorization !== undefined || sessions.hasCredentials(req)) privateViewingResponse(res);
            if (error instanceof RpcBusyError) {
                res.setHeader('Retry-After', '1');
                await sendResponse(req, res, { detail: 'Bitcoin RPC is busy; try again shortly', code: 'rpc_busy' }, 503);
                return;
            }
            if (!(error instanceof HttpError)) log.error(`Request failed (${req.method} ${(req.url || '/').split('?')[0]}): ${errorMessage(error)}`);
            await sendResponse(req, res, { detail: error instanceof HttpError ? error.message : 'Internal server error', ...(error instanceof HttpError && error.code ? { code: error.code } : {}) }, error instanceof HttpError ? error.status : 500);
        } finally { res.removeListener('close', disconnected); }
    });
    return {
        server, runtime, assetRevision: assets,
        async listen(port = settings.listen_port, host = settings.listen_address) {
            if (closeTask) throw new Error('Application is stopping');
            await runtime.start();
            if (closeTask) throw new Error('Application is stopping');
            server.listen(port, host);
            await once(server, 'listening');
            return server.address();
        },
        close() {
            closeTask ||= (async () => {
                sessions.clear();
                for (const res of streams) res.end();
                const stopping = Promise.resolve(runtime.stop());
                const closed = new Promise<void>(resolve => server.close(() => resolve()));
                const deadline = setTimeout(() => server.closeAllConnections(), 5000).unref();
                try { await Promise.all([stopping, closed]); } finally { clearTimeout(deadline); }
            })();
            return closeTask;
        },
    };
}
