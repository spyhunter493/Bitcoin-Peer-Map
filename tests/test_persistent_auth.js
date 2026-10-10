import assert from 'node:assert/strict';
import { createApplication } from '../src/server/app.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from './layout_server.ts';

const VIEW_TOKEN = 'persistent-browser-view-token-'.padEnd(64, 'v');
const SESSION_SECONDS = 30 * 24 * 60 * 60;

async function newContext(browser, storageState) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', storageState });
    await context.addInitScript(() => {
        if (location.protocol === 'http:' || location.protocol === 'https:') localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
    });
    return context;
}

async function dashboard(page, base) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#peer-tbody tr[data-id="1"]');
    assert.equal(await page.locator('#view-token-input').count(), 0, 'a remembered session opens the dashboard without another token prompt');
}

async function access(context, base) {
    const response = await context.request.get(base + '/api/access');
    assert.equal(response.status(), 200);
    return response.json();
}

async function unlockManagement(page) {
    await page.locator('#btn-connect-peer').click();
    await page.locator('#connect-addr-input').fill('8.8.8.8:8333');
    await page.locator('#connect-go-btn').click();
    await page.locator('#admin-token-input').fill(FIXTURE_ADMIN_TOKEN);
    await page.locator('#admin-token-submit').click();
    await page.waitForFunction(() => document.getElementById('connect-result')?.classList.contains('ok'));
    await page.locator('#connect-close').click();
    assert.equal(await page.locator('#admin-lock').isVisible(), true);
}

async function connectWithoutPrompt(page) {
    await page.locator('#btn-connect-peer').click();
    await page.locator('#connect-addr-input').fill('8.8.8.8:8333');
    await page.locator('#connect-go-btn').click();
    await page.waitForFunction(() => document.getElementById('connect-result')?.classList.contains('ok'));
    assert.equal(await page.locator('#admin-token-modal').count(), 0, 'a remembered administrator can manage peers without re-entering the token');
    await page.locator('#connect-close').click();
}

async function lockManagement(page) {
    const loggedOut = page.waitForResponse(response => response.url().endsWith('/api/admin/logout') && response.request().method() === 'POST');
    await page.locator('#admin-lock').click();
    assert.equal((await loggedOut).status(), 200);
    await page.waitForFunction(() => document.getElementById('admin-lock').hidden);
}

async function assertSessionStorage(context, page, expectedNames) {
    const state = await context.storageState();
    const serialized = JSON.stringify(state);
    for (const token of [VIEW_TOKEN, FIXTURE_ADMIN_TOKEN]) assert.equal(serialized.includes(token), false, 'browser persistence stores an opaque session, never a configured token');
    const exposed = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), cookie: document.cookie, url: location.href }));
    for (const token of [VIEW_TOKEN, FIXTURE_ADMIN_TOKEN]) assert.equal(exposed.includes(token), false, 'tokens stay out of Web Storage, document cookies, and URLs');
    for (const cookie of state.cookies) {
        assert.equal(cookie.domain, '127.0.0.1', 'cookies are scoped to the dashboard host');
        assert.equal(cookie.path, '/api');
        assert.equal(cookie.httpOnly, true);
        assert.equal(cookie.sameSite, 'Strict');
        assert.ok(cookie.expires > Date.now() / 1000 + SESSION_SECONDS - 120 && cookie.expires <= Date.now() / 1000 + SESSION_SECONDS + 10,
            'sessions survive browser shutdown with a 30-day expiry');
        assert.equal(exposed.includes(cookie.value), false, 'session credentials are unavailable to dashboard JavaScript');
    }
    assert.deepEqual(state.cookies.map(cookie => cookie.name).sort(), expectedNames.sort());
    // Serializing and restoring storage also exercises persistence independently
    // of the first context's cookies and in-memory JavaScript state.
    return JSON.parse(serialized);
}

export default async function assertPersistentAuthentication(browser) {
    for (const mode of ['authenticated', 'redacted']) {
        const settings = { ...fixtureSettings(), view_mode: mode, view_token: VIEW_TOKEN };
        let actions = 0;
        const createApp = () => {
            const runtime = new FixtureRuntime(settings);
            runtime.node.connect = async address => { actions++; return { success: true, address }; };
            return createApplication(settings, runtime);
        };
        let app = createApp();
        const address = await app.listen(0, '127.0.0.1');
        const base = `http://127.0.0.1:${address.port}`;
        const contexts = [];
        const openContext = async storageState => { const context = await newContext(browser, storageState); contexts.push(context); return context; };
        const context = await openContext();
        const verificationRequests = [], errors = [];
        context.on('request', request => { if (/\/api\/(view|admin)\/verify$/.test(request.url())) verificationRequests.push(request); });
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        let page = await context.newPage();
        try {
            await page.goto(base, { waitUntil: 'domcontentloaded' });
            await page.locator('#view-token-input').fill(VIEW_TOKEN);
            await page.locator('#view-token-submit').click();
            await page.waitForSelector('#peer-tbody tr[data-id="1"]');
            const savedViewer = await assertSessionStorage(context, page, ['bpm_view_session']);
            assert.equal((await access(context, base)).viewing_authenticated, true);
            assert.equal((await access(context, base)).management_authenticated, false);
            const denied = await context.request.post(base + '/api/peer/connect', {
                headers: { Origin: base }, data: { address: '8.8.8.8:8333' },
            });
            assert.equal(denied.status(), 401, 'a remembered viewer has no management privileges');
            assert.equal(actions, 0);

            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#peer-tbody tr[data-id="1"]');
            assert.equal(await page.locator('#view-token-input').count(), 0);
            const secondTab = await context.newPage();
            await dashboard(secondTab, base);
            await page.close();
            page = await context.newPage();
            await dashboard(page, base);
            assert.equal(verificationRequests.length, 1, 'reload, a second tab, and reopening a closed tab reuse the original login');

            const restored = await openContext(savedViewer);
            const restoredPage = await restored.newPage();
            await dashboard(restoredPage, base);
            assert.equal((await access(restored, base)).viewing_authenticated, true, 'a new browser context restores the saved persistent login');

            await unlockManagement(page);
            assert.equal(actions, 1);
            const savedBoth = await assertSessionStorage(context, page, ['bpm_view_session', 'bpm_admin_session']);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#peer-tbody tr[data-id="1"]');
            await connectWithoutPrompt(page);
            await dashboard(secondTab, base);
            await connectWithoutPrompt(secondTab);
            assert.equal(actions, 3);
            assert.equal(verificationRequests.length, 2, 'administrator login is also reused across reloads and tabs');

            await lockManagement(page);
            assert.equal((await access(context, base)).viewing_authenticated, true, 'locking management preserves the separate viewer session');
            assert.equal((await access(context, base)).management_authenticated, false);
            const replay = await openContext(savedBoth);
            assert.equal((await access(replay, base)).management_authenticated, false, 'management Lock revokes saved copies of that session');
            const rejectedAdmin = await replay.request.post(base + '/api/peer/connect', {
                headers: { Origin: base }, data: { address: '8.8.8.8:8333' },
            });
            assert.equal(rejectedAdmin.status(), 401);
            assert.equal(actions, 3);

            await unlockManagement(page);
            const savedBeforeLock = await assertSessionStorage(context, page, ['bpm_view_session', 'bpm_admin_session']);
            await page.locator('#view-lock').click();
            await page.locator('#view-token-input').waitFor({ state: 'visible' });
            assert.equal((await access(context, base)).viewing_authenticated, false);
            assert.equal((await access(context, base)).management_authenticated, false);
            await secondTab.reload({ waitUntil: 'domcontentloaded' });
            await secondTab.locator('#view-token-input').waitFor({ state: 'visible' });
            await restoredPage.reload({ waitUntil: 'domcontentloaded' });
            await restoredPage.locator('#view-token-input').waitFor({ state: 'visible' });
            const lockedReplay = await openContext(savedBeforeLock);
            assert.equal((await access(lockedReplay, base)).viewing_authenticated, false, 'viewing Lock revokes saved copies of both session types');
            assert.equal((await access(lockedReplay, base)).management_authenticated, false);

            if (mode === 'authenticated') {
                await page.locator('#view-token-input').fill(VIEW_TOKEN);
                await page.locator('#view-token-submit').click();
                await page.waitForSelector('#peer-tbody tr[data-id="1"]');
                await app.close();
                app = createApp();
                await app.listen(address.port, '127.0.0.1');
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.locator('#view-token-input').waitFor({ state: 'visible' });
                assert.equal((await access(context, base)).viewing_authenticated, false, 'server restart invalidates in-memory persistent sessions');
            }
            assert.deepEqual(errors, []);
        } finally {
            for (const current of contexts) await current.close();
            await app.close();
        }
    }

    // Public dashboards still remember management login without requiring a viewer.
    const settings = fixtureSettings(), app = createApplication(settings, new FixtureRuntime(settings));
    const address = await app.listen(0, '127.0.0.1'), base = `http://127.0.0.1:${address.port}`;
    const context = await newContext(browser);
    try {
        let page = await context.newPage();
        await dashboard(page, base);
        await unlockManagement(page);
        await assertSessionStorage(context, page, ['bpm_admin_session']);
        await page.close();
        page = await context.newPage();
        await dashboard(page, base);
        await connectWithoutPrompt(page);
        await lockManagement(page);
        assert.equal((await access(context, base)).management_authenticated, false);
    } finally { await context.close(); await app.close(); }
}
