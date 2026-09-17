'use strict';
const assert = require('node:assert/strict');

module.exports = async function assertPriceDelivery(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    const infoRequests = [];
    page.on('request', request => { if (request.url().includes('/api/info')) infoRequests.push(request.url()); });
    await page.route('**/api/price?currency=*', async route => {
        const currency = new URL(route.request().url()).searchParams.get('currency');
        if (currency === 'USD') await delayed;
        await route.fulfill({ json: {
            btc_price: currency === 'USD' ? 100 : 90, btc_currency: currency,
            last_known_price: currency === 'USD' ? '100' : '90', last_price_currency: currency,
            last_price_error: null,
        } });
    });
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#mo-status')?.textContent === 'Synced');
        assert.ok(await page.locator('#peer-tbody tr').count() > 0);
        assert.ok(infoRequests.every(url => new URL(url).searchParams.get('include_price') === 'false'));
        await page.click('#btc-price-bar');
        await page.click('.curr-btn[data-curr="EUR"]');
        await page.waitForFunction(() => document.querySelector('#mo-btc-price').textContent.includes('90'));
        assert.equal(await page.locator('#mo-btc-currency').textContent(), 'EUR');
        release();
        await page.waitForResponse(response => response.url().includes('/api/price?currency=USD'));
        await page.waitForTimeout(50);
        assert.equal(await page.locator('#mo-btc-currency').textContent(), 'EUR');
        assert.ok((await page.locator('#mo-btc-price').textContent()).includes('90'));
        assert.deepEqual(errors, []);
    } finally {
        release();
        await context.close();
    }
};
