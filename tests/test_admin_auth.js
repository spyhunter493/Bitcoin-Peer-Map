import assert from 'node:assert/strict';
import { FIXTURE_ADMIN_TOKEN } from './layout_server.ts';

export default async function assertAdminAuthentication(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    const page = await context.newPage();
    const errors = [], completed = [];
    let rotated = false;
    let verificationGate = Promise.resolve();
    const replacement = 'replacement-browser-token-'.padEnd(64, 'y');
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    await page.route('**/api/peer/**', async route => {
        const request = route.request();
        const authorization = request.headers().authorization;
        if (rotated) {
            const valid = authorization === `Bearer ${replacement}`;
            if (valid) completed.push({ path: new URL(request.url()).pathname, body: request.postDataJSON(), authorization });
            await route.fulfill({ status: valid ? 200 : 401, json: valid ? { success: true, address: request.postDataJSON()?.address } : { detail: 'Enter the admin token', code: 'admin_required' } });
        } else {
            const response = await route.fetch();
            if (response.status() === 200) completed.push({ path: new URL(request.url()).pathname, body: request.postDataJSON(), authorization });
            await route.fulfill({ response });
        }
    });
    await page.route('**/api/admin/verify', async route => {
        await verificationGate;
        if (!rotated) { await route.continue(); return; }
        const valid = route.request().headers().authorization === `Bearer ${replacement}`;
        await route.fulfill({ status: valid ? 200 : 401, json: valid ? { success: true } : { detail: 'Enter the admin token', code: 'admin_required' } });
    });

    async function submitToken(value) {
        await page.locator('#admin-token-input').fill(value);
        await page.locator('#admin-token-submit').click();
    }
    async function requestConnection() {
        if (!(await page.locator('#connect-peer-modal').count())) await page.locator('#btn-connect-peer').click();
        await page.locator('#connect-addr-input').fill('8.8.8.8:8333');
        await page.locator('#connect-go-btn').click();
    }
    async function waitForPrompt() {
        await page.locator('#admin-token-input').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-token-input');
    }

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('mo-status')?.textContent === 'Synced');
        assert.equal(await page.locator('#admin-lock').isVisible(), false);
        const limited = await page.evaluate(async token => {
            await fetch('/api/admin/verify', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
            let status;
            for (let i = 0; i < 11; i++) status = (await fetch('/api/admin/verify', { method: 'POST' })).status;
            return status;
        }, FIXTURE_ADMIN_TOKEN);
        assert.equal(limited, 429);
        await requestConnection();
        await waitForPrompt();
        assert.equal(await page.locator('#admin-token-modal [role="dialog"]').getAttribute('aria-modal'), 'true');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        await page.waitForFunction(() => !document.getElementById('connect-go-btn').disabled);
        assert.equal(completed.length, 0, 'cancelling authentication must not execute the requested operation');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'connect-go-btn');
        await page.evaluate(token => fetch('/api/admin/verify', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), FIXTURE_ADMIN_TOKEN);

        await requestConnection();
        await waitForPrompt();
        await submitToken('wrong-token');
        await page.waitForFunction(() => document.getElementById('admin-token-error')?.textContent.includes('admin token'));
        assert.equal(completed.length, 0, 'incorrect tokens cannot connect a peer');
        assert.equal(await page.locator('#admin-token-input').inputValue(), '');
        await submitToken(FIXTURE_ADMIN_TOKEN);
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        await page.waitForFunction(() => document.getElementById('connect-result')?.classList.contains('ok'));
        assert.equal(completed.length, 1, 'unlocking executes the pending action once');
        assert.equal(completed[0].authorization, `Bearer ${FIXTURE_ADMIN_TOKEN}`);
        assert.deepEqual(completed[0].body, { address: '8.8.8.8:8333' });
        assert.equal(await page.locator('#admin-lock').isVisible(), true);
        await page.setViewportSize({ width: 640, height: 800 });
        assert.equal(await page.locator('#admin-lock').isVisible(), true, 'Lock remains accessible on narrow screens');
        await page.setViewportSize({ width: 1638, height: 900 });
        assert.equal(await page.evaluate(token => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(token)), FIXTURE_ADMIN_TOKEN), false);
        await page.locator('#connect-close').click();

        // Other entry points reuse the token rather than opening another prompt.
        await page.locator('#peer-tbody .peer-action-btn[data-action="disconnect"]').first().click();
        await page.locator('#disconnect-dialog [data-choice="disconnect"]').click();
        await page.waitForSelector('#action-notification[role="status"]');
        assert.equal(completed.length, 2);
        assert.equal(completed[1].path, '/api/peer/disconnect');
        assert.equal(completed[1].authorization, `Bearer ${FIXTURE_ADMIN_TOKEN}`);

        // A revoked token triggers a new prompt before retrying the action.
        rotated = true;
        await requestConnection();
        await waitForPrompt();
        assert.equal(await page.locator('#admin-lock').isVisible(), false);
        await submitToken(replacement);
        await page.waitForFunction(() => document.getElementById('connect-result')?.classList.contains('ok'));
        assert.equal(completed.length, 3);
        assert.equal(completed[2].authorization, `Bearer ${replacement}`);
        await page.locator('#connect-close').click();

        await page.locator('#admin-lock').click();
        await requestConnection();
        await waitForPrompt();
        await page.locator('#connect-close').evaluate(button => button.click());
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        assert.equal(completed.length, 3, 'closing the source dialog cancels the pending authentication');

        await requestConnection();
        await waitForPrompt();
        await submitToken(replacement);
        await page.waitForFunction(() => document.getElementById('connect-result')?.classList.contains('ok'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('mo-status')?.textContent === 'Synced');
        assert.equal(await page.locator('#admin-lock').isVisible(), false, 'reload clears the token');
        await requestConnection();
        await waitForPrompt();
        await page.locator('#admin-token-cancel').click();
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        await page.waitForFunction(() => !document.getElementById('connect-go-btn').disabled);
        assert.equal(completed.length, 4);

        // A verification response arriving after cancellation cannot unlock or run an action.
        let releaseVerification;
        verificationGate = new Promise(resolve => { releaseVerification = resolve; });
        await requestConnection();
        await waitForPrompt();
        const verificationStarted = page.waitForRequest(request => request.url().endsWith('/api/admin/verify'));
        await submitToken(replacement);
        await verificationStarted;
        await page.locator('#admin-token-cancel').click();
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        releaseVerification();
        verificationGate = Promise.resolve();
        await page.waitForFunction(() => !document.getElementById('connect-go-btn').disabled);
        assert.equal(completed.length, 4);
        assert.equal(await page.locator('#admin-lock').isVisible(), false);

        // Read-only responses explain the missing configuration without prompting.
        await page.route('**/api/peer/connect', route => route.fulfill({ status: 403, json: { detail: 'Management is read-only because BPM_ADMIN_TOKEN is not configured.', code: 'management_disabled' } }));
        await requestConnection();
        await page.waitForFunction(() => document.getElementById('connect-result')?.textContent.includes('read-only'));
        assert.equal(await page.locator('#admin-token-modal').count(), 0);
        assert.equal(completed.length, 4);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
