import assert from 'node:assert/strict';
import { createApplication } from '../src/server/app.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from './layout_server.ts';

/** Exercise the actual header, management cookies, and shared wallet API together. */
export default async function assertWalletTicker(browser) {
    const settings = fixtureSettings();
    const runtime = new FixtureRuntime(settings);
    let balanceReads = 0;
    const snapshot = runtime.wallets.snapshot;
    runtime.wallets.snapshot = async () => { balanceReads++; return snapshot(); };
    const app = createApplication(settings, runtime);
    const address = await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${address.port}`;
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        if (location.protocol === 'http:' || location.protocol === 'https:') localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
    });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const page = await context.newPage();
    await page.clock.install();
    const row = (target, name) => target.locator('.wallet-options-row').filter({ has: target.locator('.wallet-options-name', { hasText: name }) });
    const saved = async () => {
        const response = await context.request.get(base + '/api/wallets/preferences');
        assert.equal(response.status(), 200);
        return response.json();
    };
    try {
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#peer-tbody tr');
        await page.locator('#wallet-ticker').waitFor({ state: 'visible' });
        assert.equal(balanceReads, 0, 'a locked dashboard never reads wallet balances');
        await page.locator('#wallet-ticker').click();
        await page.locator('#admin-token-input').fill(FIXTURE_ADMIN_TOKEN);
        await page.locator('#admin-token-submit').click();
        await page.locator('#wallet-options').waitFor({ state: 'visible' });
        await page.waitForSelector('.wallet-options-row');
        assert.equal(await row(page, 'watch-descriptor').locator('input').isChecked(), false, 'new wallets are unchecked');
        assert.match(await row(page, 'watch-scanning').textContent(), /Scanning 50%/);
        assert.match(await row(page, 'watch-scanning').textContent(), /Balance: —/);

        await row(page, 'watch-descriptor').locator('input').check();
        await row(page, 'watch-legacy').locator('input').check();
        await page.waitForFunction(() => document.querySelector('.wallet-ticker-amount').textContent === '0.12345678 BTC');
        assert.equal((await saved()).preferences.selected_wallets.length, 2);
        assert.equal((await page.locator('#wallet-ticker').textContent()).includes('watch-'), false, 'ticker contains no wallet label');
        await page.locator('[data-wallet-step="1"]').click();
        await page.waitForFunction(() => document.querySelector('.wallet-ticker-amount').textContent === '0.00000000 BTC');
        assert.equal(await row(page, 'watch-legacy').evaluate(element => element.classList.contains('current')), true);
        await page.locator('[data-wallet-step="-1"]').click();
        await page.locator('#wallet-unit').selectOption('sats');
        await page.locator('#wallet-rotation').selectOption('5');
        await page.locator('#wallet-paused').check();
        await page.waitForFunction(() => document.querySelector('.wallet-options-result').textContent === '');
        assert.equal((await saved()).preferences.unit, 'sats');
        assert.equal((await saved()).preferences.paused, true);
        await page.keyboard.press('Escape');
        await page.locator('#wallet-options').waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement.id), 'wallet-ticker');
        assert.equal(await page.locator('.wallet-ticker-amount').textContent(), '12345678 sats');

        // Failed optimistic saves restore the committed shared configuration.
        let failSave = true;
        await page.route('**/api/wallets/preferences', async route => {
            if (route.request().method() === 'POST' && failSave) {
                failSave = false;
                await route.fulfill({ status: 503, json: { detail: 'Saved settings are unavailable.', code: 'wallet_preferences_unavailable' } });
            } else await route.continue();
        });
        await page.locator('#wallet-ticker').click();
        await page.locator('#wallet-unit').selectOption('BTC');
        await page.waitForFunction(() => document.querySelector('.wallet-options-result').textContent.includes('Could not save'));
        assert.equal(await page.locator('#wallet-unit').inputValue(), 'sats');
        await page.unroute('**/api/wallets/preferences');
        await page.locator('#wallet-paused').uncheck();
        await page.waitForFunction(() => document.querySelector('.wallet-options-result').textContent === '');
        await page.keyboard.press('Escape');
        await page.mouse.move(20, 200);
        await page.locator('#topbar-gear').focus();
        await page.waitForTimeout(5500);
        assert.equal(await page.locator('.wallet-ticker-amount').textContent(), '12345678 sats', 'reduced motion prevents automatic rotation');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction(() => document.querySelector('.wallet-ticker-amount').textContent === '0 sats', null, { timeout: 8000 });

        // An unchanged preferences poll must not postpone a 30-second rotation.
        await page.locator('#wallet-ticker').click();
        await page.locator('#wallet-rotation').selectOption('30');
        await page.waitForFunction(() => document.querySelector('.wallet-options-result').textContent === '');
        await page.keyboard.press('Escape');
        await page.mouse.move(20, 200);
        await page.locator('#topbar-gear').focus();
        const beforeRotation = await page.locator('.wallet-ticker-amount').textContent();
        const polled = page.waitForResponse(response => response.url().endsWith('/api/wallets/preferences') && response.request().method() === 'GET');
        await page.clock.fastForward(29000);
        await polled;
        await page.waitForTimeout(100);
        await page.clock.fastForward(2000);
        await page.waitForFunction(previous => document.querySelector('.wallet-ticker-amount').textContent !== previous, beforeRotation);

        // Losing the preferences read must not leave apparently current amounts.
        let failPreferences = true;
        await page.route('**/api/wallets/preferences', async route => {
            if (route.request().method() === 'GET' && failPreferences) {
                failPreferences = false;
                await route.fulfill({ status: 503, json: { detail: 'Wallet settings unavailable.', code: 'wallet_preferences_unavailable' } });
            } else await route.continue();
        });
        await page.clock.fastForward(30000);
        await page.waitForFunction(() => document.querySelector('.wallet-ticker-amount').textContent === '—');
        await page.clock.fastForward(30000);
        await page.waitForFunction(() => document.querySelector('.wallet-ticker-amount').textContent === '12345678 sats');
        await page.unroute('**/api/wallets/preferences');

        // Units and checkboxes are shared by another authenticated browser tab.
        const second = await context.newPage();
        await second.goto(base, { waitUntil: 'domcontentloaded' });
        await second.waitForSelector('#peer-tbody tr');
        await second.waitForFunction(() => document.querySelector('.wallet-ticker-amount').textContent === '12345678 sats');
        await second.locator('#wallet-ticker').click();
        await second.waitForSelector('.wallet-options-row');
        assert.equal(await row(second, 'watch-descriptor').locator('input').isChecked(), true);
        assert.equal(await row(second, 'watch-legacy').locator('input').isChecked(), true);
        assert.equal(await second.locator('#wallet-unit').inputValue(), 'sats');
        await second.keyboard.press('Escape');

        // The compact mobile button remains reachable and the options stay onscreen.
        for (const width of [1366, 1280, 800, 375, 320]) {
            await second.setViewportSize({ width, height: 900 });
            await second.locator('#wallet-ticker').click();
            await second.locator('#wallet-options').waitFor({ state: 'visible' });
            const bounds = await second.locator('#wallet-options').boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `wallet options fit ${width}px`);
            await second.keyboard.press('Escape');
        }
        await second.setViewportSize({ width: 1920, height: 1080 });

        // Nothing sensitive is persisted in browser storage.
        const exposed = await second.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), url: location.href, cookie: document.cookie }));
        for (const value of ['watch-descriptor', 'watch-legacy', '12345678', FIXTURE_ADMIN_TOKEN]) assert.equal(exposed.includes(value), false);

        await second.locator('#admin-lock').click();
        await second.waitForFunction(() => document.querySelector('.wallet-ticker-amount').textContent === '—');
        await page.bringToFront();
        await page.waitForFunction(() => document.querySelector('.wallet-ticker-amount').textContent === '—');
        assert.equal(await page.locator('#wallet-options').count(), 0);
        assert.equal(await page.locator('#admin-token-modal').count(), 0, 'background polling never reopens unlock');
        assert.equal((await page.locator('body').textContent()).includes('watch-descriptor'), false, 'locking removes wallet names');
        assert.ok(await page.locator('#peer-tbody tr').count(), 'management lock preserves monitoring');
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
        await app.close();
    }
}
