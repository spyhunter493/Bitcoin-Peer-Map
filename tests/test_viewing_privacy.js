import assert from 'node:assert/strict';
import { createApplication } from '../src/server/app.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from './layout_server.ts';

const VIEW_TOKEN = 'browser-viewing-token-'.padEnd(64, 'v');
const PRIVATE_MARKER = '203.0.113.210:9911';
const DETAIL_PATHS = new Set(['/api/peers', '/api/info', '/api/bans', '/api/config', '/api/rpc-info', '/api/stats', '/api/connectivity', '/api/mempool', '/api/blockchain', '/api/blocks/recent', '/api/chain-tips', '/api/stream/system']);

export default async function assertViewingPrivacy(browser) {
    for (const mode of ['authenticated', 'redacted']) {
        const settings = { ...fixtureSettings(), view_mode: mode, view_token: VIEW_TOKEN };
        const runtime = new FixtureRuntime(settings);
        const originalPeers = runtime.peers.listPeers;
        runtime.peers.listPeers = () => originalPeers().map((peer, index) => index ? peer : { ...peer, addr: PRIVATE_MARKER });
        let actions = 0;
        runtime.node.connect = async address => { actions++; return { success: true, address }; };
        const app = createApplication(settings, runtime);
        const address = await app.listen(0, '127.0.0.1');
        const base = `http://127.0.0.1:${address.port}`;
        const context = await browser.newContext({ viewport: { width: 320, height: 560 }, reducedMotion: 'reduce' });
        await context.addInitScript(() => {
            localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
            const original = window.setInterval.bind(window);
            window.setInterval = (handler, interval, ...args) => {
                if (interval === 10000) { window.privacyPeerPoll = handler; return original(handler, 3600000, ...args); }
                return original(handler, interval, ...args);
            };
        });
        const page = await context.newPage(), requests = [], errors = [], publicPayloads = [];
        let collectPublicPayloads = true;
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
            const url = new URL(request.url());
            if (url.origin === base) requests.push({ path: url.pathname, method: request.method(), headers: request.headers(), url: request.url() });
        });
        page.on('response', response => {
            if (collectPublicPayloads && ['/api/access', '/api/view/aggregate'].includes(new URL(response.url()).pathname)) publicPayloads.push(response.json());
        });
        const input = () => page.locator('#view-token-input');
        let resetNumber = 0;
        async function login(token = VIEW_TOKEN) {
            await input().waitFor({ state: 'visible' });
            await input().fill(token);
            await page.locator('#view-token-submit').click();
            await page.waitForSelector('#peer-tbody tr[data-id="1"]');
            assert.ok((await page.locator('#peer-tbody').textContent()).includes(PRIVATE_MARKER));
            assert.equal(await page.locator('#view-lock').isVisible(), true);
        }
        async function storageSafe() {
            const stored = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), cookie: document.cookie, href: location.href }));
            for (const secret of [VIEW_TOKEN, FIXTURE_ADMIN_TOKEN]) assert.equal(stored.includes(secret), false, 'raw tokens must stay out of browser storage and URLs');
            for (const cookie of await context.cookies()) {
                assert.ok(['bpm_view_session', 'bpm_admin_session'].includes(cookie.name));
                assert.equal(cookie.httpOnly, true);
                assert.equal(cookie.sameSite, 'Strict');
                assert.equal(cookie.path, '/api');
                for (const secret of [VIEW_TOKEN, FIXTURE_ADMIN_TOKEN]) assert.equal(cookie.value.includes(secret), false);
            }
        }
        async function stalledReset(action, showEvent = false, expectReadAbort = false, afterWipe) {
            let receiveWipe;
            const wiped = new Promise(resolve => { receiveWipe = resolve; });
            const binding = `privacyWiped${++resetNumber}`;
            await page.exposeBinding(binding, (_source, state) => receiveWipe(state));
            let receiveCompletion;
            const completed = new Promise(resolve => { receiveCompletion = resolve; });
            const completion = afterWipe ? `privacyActionSettled${resetNumber}` : null;
            if (completion) await page.exposeBinding(completion, (_source, state) => receiveCompletion(state));
            let releaseNavigation;
            const navigating = new Promise(resolve => { releaseNavigation = resolve; });
            const block = async route => { releaseNavigation(route); };
            await page.route(base + '/', block);
            await page.evaluate(async ({ binding, marker, completion }) => {
                const { dashboard } = await import(`/static/v/${document.body.dataset.assetRevision}/js/core/dashboard-state.js`);
                window.privacyDashboard = dashboard;
                const observer = new MutationObserver(() => {
                    if (!document.getElementById('view-reset-notice')) return;
                    observer.disconnect();
                    window[binding]({ privateDom: document.body.textContent.includes(marker), peers: dashboard.peers.length,
                        ids: dashboard.byId.size, group: dashboard.interaction.groupedNodes, selected: dashboard.distribution.selectedPeerId,
                        readAborted: window.privacyPendingReadSignal?.aborted ?? null,
                        actionAborted: window.privacyPendingActionSignal?.aborted ?? null });
                    // Preinstall the completion check: Playwright evaluation waits for a
                    // pending navigation, whose response this test deliberately holds.
                    if (completion) {
                        window.privacyReleaseAction();
                        setTimeout(() => window[completion]({ text: document.body.textContent, calls: window.privacyActionCalls,
                            dialogs: document.querySelectorAll('[role="dialog"]').length,
                            notifications: document.querySelectorAll('#action-notification').length }), 0);
                    }
                });
                observer.observe(document.body, { childList: true });
            }, { binding, marker: PRIVATE_MARKER, completion });
            await action();
            const state = await wiped;
            assert.equal(state.privateDom, false,
                'locking wipes private DOM before a replacement document arrives');
            assert.deepEqual(state, { privateDom: false, peers: 0, ids: 0, group: null, selected: null,
                readAborted: expectReadAbort ? true : null, actionAborted: afterWipe ? true : null });
            if (showEvent) await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
            const route = await navigating;
            if (afterWipe) await afterWipe(await completed);
            await route.continue();
            await page.unroute(base + '/', block);
            if (showEvent) {
                await page.waitForSelector('#peer-tbody tr[data-id="1"]');
                assert.ok((await page.locator('#peer-tbody').textContent()).includes(PRIVATE_MARKER),
                    'BFCache restoration reloads private data using the remembered session');
            } else {
                await input().waitFor({ state: 'visible' });
                assert.equal(await input().inputValue(), '');
                assert.equal((await page.locator('body').textContent()).includes(PRIVATE_MARKER), false);
            }
        }
        async function holdActionBody(path, response, method = 'POST') {
            const binding = `privacyActionReady${++resetNumber}`;
            let received;
            const ready = new Promise(resolve => { received = resolve; });
            await page.exposeBinding(binding, (_source, state) => received(state));
            const route = intercepted => intercepted.fulfill({ status: response.status, json: response.body });
            await page.route(base + path, route);
            await page.evaluate(({ path, method, binding }) => {
                const fetch = window.fetch.bind(window);
                window.privacyActionCalls = 0;
                window.fetch = async (input, options) => {
                    const url = new URL(input instanceof Request ? input.url : input, location.href);
                    if (url.pathname !== path || (options?.method || 'GET') !== method) return fetch(input, options);
                    window.privacyActionCalls++;
                    window.privacyPendingActionSignal = options?.signal;
                    const response = await fetch(input, options);
                    const body = await response.json();
                    // The server response has arrived. Hold parsing and deliberately ignore
                    // abort so a late completion exercises both API and UI lifecycle guards.
                    return { ok: response.ok, status: response.status, headers: response.headers,
                        json: () => new Promise(resolve => {
                            window.privacyReleaseAction = () => resolve(body);
                            window[binding]({ aborted: options?.signal?.aborted, calls: window.privacyActionCalls });
                        }) };
                };
            }, { path, method, binding });
            return { ready, route };
        }
        try {
            await page.goto(base, { waitUntil: 'domcontentloaded' });
            await input().waitFor({ state: 'visible' });
            if (mode === 'redacted') {
                await page.waitForFunction(() => document.getElementById('view-aggregate').textContent.includes('IPv4'));
                assert.match(await page.locator('#view-aggregate').textContent(), /0–4|5–9|10–14/);
            } else assert.equal(await page.locator('#view-aggregate').isVisible(), false);
            assert.deepEqual(requests.filter(request => DETAIL_PATHS.has(request.path)), [], 'private polling must not start before authentication');
            assert.equal((await page.locator('body').textContent()).includes(PRIVATE_MARKER), false);
            for (const payload of await Promise.all(publicPayloads)) assert.equal(JSON.stringify(payload).includes(PRIVATE_MARKER), false);
            collectPublicPayloads = false;

            await input().fill('incorrect-token');
            await page.locator('#view-token-submit').click();
            await page.waitForFunction(() => document.getElementById('view-token-error').textContent.includes('token'));
            assert.equal(await input().inputValue(), '');
            assert.equal(requests.filter(request => DETAIL_PATHS.has(request.path)).length, 0);
            await login();
            assert.ok(requests.some(request => request.path === '/api/peers'));
            await storageSafe();

            // Reading with a viewer never gives it management privileges.
            await page.locator('#btn-connect-peer').click();
            await page.locator('#connect-addr-input').fill('8.8.8.8:8333');
            await page.locator('#connect-go-btn').click();
            await page.locator('#admin-token-input').fill(VIEW_TOKEN);
            await page.locator('#admin-token-submit').click();
            await page.waitForFunction(() => document.getElementById('admin-token-error').textContent.length > 0);
            assert.equal(actions, 0);
            await page.locator('#admin-token-input').fill(FIXTURE_ADMIN_TOKEN);
            await page.locator('#admin-token-submit').click();
            await page.waitForFunction(() => document.getElementById('connect-result').classList.contains('ok'));
            assert.equal(actions, 1);
            await page.locator('#connect-close').click();
            await storageSafe();

            // A pending detailed read is aborted before any replacement document.
            let receiveRead;
            const pendingRead = new Promise(resolve => { receiveRead = resolve; });
            const holdPeerRead = async route => { receiveRead(route); };
            await page.route('**/api/peers?include_status=true', holdPeerRead);
            await page.evaluate(() => {
                const fetch = window.fetch.bind(window);
                window.fetch = (input, options) => {
                    const url = new URL(input instanceof Request ? input.url : input, location.href);
                    if (url.pathname === '/api/peers') window.privacyPendingReadSignal = options?.signal;
                    return fetch(input, options);
                };
            });
            await page.evaluate(() => window.privacyPeerPoll());
            const heldRead = await pendingRead;
            assert.equal(await page.evaluate(() => window.privacyPendingReadSignal?.aborted), false,
                'the held detailed read is active before locking');
            // Interception can defer Chromium's requestfailed event until this
            // route is released. The wipe observer checks the actual fetch signal
            // while replacement navigation is blocked, before the old context exits.
            await stalledReset(() => page.locator('#view-lock').click({ noWaitAfter: true }), false, true);
            await heldRead.abort().catch(() => {});
            await page.unroute('**/api/peers?include_status=true', holdPeerRead);

            await login();
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#peer-tbody tr[data-id="1"]');
            assert.equal(await input().count(), 0, 'reload restores the remembered viewing session');
            assert.ok((await page.locator('#peer-tbody').textContent()).includes(PRIVATE_MARKER));
            await storageSafe();

            await stalledReset(() => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))), true);

            // A server-side rejection locks the complete view, rather than
            // retaining the last private snapshot as a normal polling error.
            await stalledReset(() => page.locator('#view-lock').click({ noWaitAfter: true }));
            await login(FIXTURE_ADMIN_TOKEN);
            const rejectPeerRead = route => route.fulfill({ status: 401, json: { detail: 'Enter a token', code: 'view_required' } });
            await page.route('**/api/peers?include_status=true', rejectPeerRead);
            await stalledReset(() => page.evaluate(() => window.privacyPeerPoll()));
            await page.unroute('**/api/peers?include_status=true', rejectPeerRead);
            assert.ok(requests.some(request => request.path === '/api/view/verify' && request.headers.authorization === `Bearer ${FIXTURE_ADMIN_TOKEN}`), 'an administrator can also authenticate for viewing');

            const lateActions = [
                { path: '/api/peer/ban', choice: 'ban', status: 200, body: { success: true, banned_ip: PRIVATE_MARKER } },
                { path: '/api/peer/disconnect', choice: 'disconnect', status: 200, body: { success: false, error: PRIVATE_MARKER } },
                { path: '/api/peer/ban', choice: 'ban', status: 500, body: { detail: PRIVATE_MARKER } },
                { path: '/api/peer/disconnect', choice: 'disconnect', status: 401, body: { detail: PRIVATE_MARKER, code: 'admin_required' } },
                { path: '/api/peer/ban', choice: 'ban', status: 429, body: { detail: PRIVATE_MARKER, code: 'admin_rate_limited' } },
                { path: '/api/peer/unban', status: 200, body: { success: true } },
                { path: '/api/bans/clear', status: 200, body: { success: true } },
                { path: '/api/bans', method: 'GET', status: 200, body: { success: true, bans: [{ address: PRIVATE_MARKER }] } },
            ];
            for (const scenario of lateActions) {
                await login();
                const bans = route => route.fulfill({ json: { success: true, bans: [{ address: PRIVATE_MARKER }] } });
                if (!scenario.choice && scenario.path !== '/api/bans') await page.route(base + '/api/bans', bans);
                const held = await holdActionBody(scenario.path, scenario, scenario.method || 'POST');
                if (scenario.choice) {
                    await page.locator('tr[data-id="1"] button[data-action="disconnect"]').click();
                    await page.locator(`[data-choice="${scenario.choice}"]`).click();
                } else {
                    await page.locator('#btn-bans').click();
                    if (scenario.path === '/api/peer/unban') await page.locator('.ban-unban').click();
                    if (scenario.path === '/api/bans/clear') {
                        page.once('dialog', dialog => dialog.accept());
                        await page.locator('#ban-clear-all').click();
                    }
                }
                assert.deepEqual(await held.ready, { aborted: false, calls: 1 },
                    'closing the confirmation must not cancel a confirmed action');
                await stalledReset(() => page.evaluate(() => { setTimeout(() => document.getElementById('view-lock').click(), 0); }), false, false, async state => {
                    assert.deepEqual(state, { text: 'Viewing locked. Reopening the access page…', calls: 1, dialogs: 0, notifications: 0 },
                        `${mode}: ${scenario.path} ${scenario.status} cannot restore private data, prompt, or retry after lock`);
                });
                await page.unroute(base + scenario.path, held.route);
                if (!scenario.choice && scenario.path !== '/api/bans') await page.unroute(base + '/api/bans', bans);
            }
            await storageSafe();
            assert.deepEqual(errors, []);
            for (const request of requests) assert.equal(request.url.includes(VIEW_TOKEN) || request.url.includes(FIXTURE_ADMIN_TOKEN), false);
        } finally { await context.close(); await app.close(); }
    }

    // Public BFCache suspension retains the dashboard and its action ownership.
    const settings = fixtureSettings(), app = createApplication(settings, new FixtureRuntime(settings));
    const address = await app.listen(0, '127.0.0.1'), base = `http://127.0.0.1:${address.port}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    const page = await context.newPage();
    try {
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('tr[data-id="1"]');
        await page.locator('#peer-search').fill('1');
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        assert.equal(await page.locator('#peer-search').inputValue(), '1');
        let actions = 0;
        await page.route(base + '/api/peer/disconnect', route => { actions++; return route.fulfill({ json: { success: true } }); });
        await page.locator('tr[data-id="1"] button[data-action="disconnect"]').click();
        await page.locator('[data-choice="disconnect"]').click();
        await page.waitForSelector('#action-notification[role="status"]');
        assert.equal(await page.locator('#action-notification').textContent(), 'Disconnected peer 1');
        assert.equal(actions, 1);
    } finally { await context.close(); await app.close(); }
}
