import assert from 'node:assert/strict';

export default async function assertManagementFeedback(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    const page = await context.newPage();
    const errors = [], mutations = [];
    let banSuccess = true;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    await page.route('**/api/peer/**', async route => {
        mutations.push(new URL(route.request().url()).pathname);
        await route.fulfill({ json: banSuccess ? { success: true, banned_ip: '8.8.8.8' } : { success: false, error: 'RPC ban rejected' } });
    });
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#peer-tbody tr[data-net="ipv4"]');
        const button = page.locator('#peer-tbody tr[data-net="ipv4"] .peer-action-btn[data-action="disconnect"]').first();
        await button.click();
        await page.locator('#disconnect-dialog [data-choice="ban"]').click();
        await page.waitForSelector('#action-notification[role="status"]');
        assert.equal(await page.locator('#action-notification').textContent(), 'Banned 8.8.8.8 for 24 hours; disconnection requested');
        assert.deepEqual(mutations, ['/api/peer/ban']);

        banSuccess = false;
        await button.click();
        await page.locator('#disconnect-dialog [data-choice="ban"]').click();
        await page.waitForSelector('#action-notification[role="alert"]');
        assert.equal(await page.locator('#action-notification').textContent(), 'Ban failed: RPC ban rejected');
        assert.deepEqual(mutations, ['/api/peer/ban', '/api/peer/ban']);
        banSuccess = true;
        await button.click();
        await page.locator('#disconnect-dialog [data-choice="disconnect"]').click();
        await page.waitForSelector('#action-notification[role="status"]');
        assert.match(await page.locator('#action-notification').textContent(), /^Disconnected peer /);
        assert.equal(mutations[2], '/api/peer/disconnect');

        const hostile = '<img src=x onerror="window.banErrorInjected=true">';
        for (const [status, data, message] of [
            [200, { success: false, bans: [], error: hostile }, hostile],
            [200, { success: true, bans: {} }, 'Invalid ban list response'],
            [200, { success: true }, 'Invalid ban list response'],
            [200, { bans: [] }, 'Invalid ban list response'],
            [200, null, 'Invalid ban list response'],
            [502, { detail: hostile }, hostile],
        ]) {
            await page.route('**/api/bans', route => route.fulfill({ status, json: data }));
            await page.locator('#btn-bans').click();
            await page.waitForFunction(text => document.getElementById('ban-modal-body').textContent.includes(text), message);
            assert.equal(await page.locator('.ban-list-empty').count(), 0);
            assert.equal(await page.locator('#ban-modal-body img').count(), 0);
            assert.equal(await page.evaluate(() => window.banErrorInjected), undefined);
            await page.locator('#ban-modal-close').click();
            await page.unroute('**/api/bans');
        }
        for (const bans of [[], [{ address: hostile, ban_created: 1000, banned_until: 2000 }]]) {
            await page.route('**/api/bans', route => route.fulfill({ json: { success: true, bans } }));
            await page.locator('#btn-bans').click();
            await page.waitForSelector('.ban-list-header');
            if (!bans.length) assert.equal(await page.locator('.ban-list-empty').textContent(), 'No banned IPs');
            else {
                assert.equal(await page.locator('.ban-table tbody td').first().textContent(), hostile);
                assert.equal(await page.locator('#ban-modal-body img').count(), 0);
            }
            await page.locator('#ban-modal-close').click();
            await page.unroute('**/api/bans');
        }
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
}
