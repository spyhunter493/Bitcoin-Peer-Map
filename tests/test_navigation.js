import assert from 'node:assert/strict';

export default async function assertNavigation(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        const interval = window.setInterval;
        window.setInterval = (handler, ms, ...args) => {
            if (ms === 10000) {
                window.testNavigationPoll = handler;
                return interval(handler, 3600000, ...args);
            }
            return interval(handler, ms, ...args);
        };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
        const seed = await (await page.request.get(baseUrl + '/api/peers?include_status=true')).json();
        let peers = seed.peers;
        await page.route('**/api/peers?include_status=true', (route) => route.fulfill({ json: { ...seed, peers } }));
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelectorAll('#peer-tbody tr').length >= 10);
        await page.locator('#as-donut-center').click();
        const category = page.locator('#as-detail-panel .as-summary-row[data-cat-label="IPv4"]');
        await category.click();
        const provider = page.locator('#as-sub-tooltip .as-provider-peer-list').first();
        const providerKey = await provider.getAttribute('data-as');
        await provider.click();
        await page.waitForSelector('#as-sub-sub-tooltip .as-sub-tt-id-link');
        await page.evaluate(() => {
            window.testNavigationPinned = {
                source: document.querySelector('#as-detail-panel .as-summary-row[data-cat-label="IPv4"]'),
                primary: document.getElementById('as-sub-tooltip'),
                secondary: document.getElementById('as-sub-sub-tooltip'),
                geometry: ['as-sub-tooltip', 'as-sub-sub-tooltip'].map((id) => {
                    const el = document.getElementById(id);
                    return [el.style.left, el.style.top];
                }),
            };
        });
        const member = peers.find((peer) => peer.network === 'ipv4' && peer.as.split(' ')[0] === providerKey);
        assert.ok(member);
        peers = peers.concat({ ...member, id: 777 });
        const response = page.waitForResponse((response) => response.url().includes('/api/peers?include_status=true'));
        await page.evaluate(() => window.testNavigationPoll());
        await response;
        await page.waitForSelector('#as-sub-sub-tooltip [data-peer-id="777"]');
        const refreshed = await page.evaluate(() => {
            const old = window.testNavigationPinned;
            const primary = document.getElementById('as-sub-tooltip'),
                secondary = document.getElementById('as-sub-sub-tooltip');
            return {
                sourceReplaced:
                    old.source !== document.querySelector('#as-detail-panel .as-summary-row[data-cat-label="IPv4"]'),
                shellsPreserved: primary === old.primary && secondary === old.secondary,
                geometryPreserved:
                    JSON.stringify(old.geometry) ===
                    JSON.stringify([primary, secondary].map((el) => [el.style.left, el.style.top])),
            };
        });
        assert.deepEqual(refreshed, { sourceReplaced: true, shellsPreserved: true, geometryPreserved: true });
        // The rebuilt source row must still toggle the existing pinned tooltip off.
        await category.click();
        await page.waitForSelector('#as-sub-tooltip', { state: 'hidden' });
        await page.waitForSelector('#as-sub-sub-tooltip', { state: 'hidden' });
        assert.deepEqual(
            await page
                .locator('#peer-tbody tr')
                .evaluateAll((rows) => rows.map((row) => Number(row.dataset.id)).sort((a, b) => a - b)),
            peers.map((peer) => peer.id).sort((a, b) => a - b)
        );

        // Escape dismisses the deepest tooltip; map clicks close nested views together before exiting focus.
        await category.click();
        await page.locator('#as-sub-tooltip .as-provider-peer-list').first().click();
        await page.waitForSelector('#as-sub-sub-tooltip', { state: 'visible' });
        await page.keyboard.press('Escape');
        await page.waitForSelector('#as-sub-sub-tooltip', { state: 'hidden' });
        assert.equal(await page.locator('#as-sub-tooltip').isVisible(), true);
        const canvas = page.locator('#worldmap');
        await canvas.click({ position: { x: 10, y: 200 } });
        await page.waitForSelector('#as-sub-tooltip', { state: 'hidden' });
        assert.equal(await page.locator('#as-detail-panel').isVisible(), true);
        assert.equal(await page.evaluate(() => document.body.classList.contains('donut-focused')), true);
        await canvas.click({ position: { x: 10, y: 200 } });
        await page.waitForFunction(() => !document.body.classList.contains('donut-focused'));
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
