import assert from 'node:assert/strict';

export default async function assertNodeServices(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await openNodeInfo();
        const section = page.locator('#ni-services-section');
        assert.deepEqual(await section.locator('.modal-val').allTextContents(), ['NETWORK', 'WITNESS', 'NETWORK_LIMITED', 'P2P_V2']);
        assert.deepEqual(await section.locator('.modal-label').allTextContents(), ['Full chain history', 'Segregated Witness', 'Limited chain history', 'BIP324 v2 transport']);

        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await section.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'services must fit a narrow popup');
        await page.setViewportSize({ width: 1638, height: 900 });

        const unknown = '<img src=x onerror="throw Error(\'unescaped service\')">';
        let services = ['BLOOM', 'COMPACT_FILTERS', 'BLAKE2B?', unknown, 'constructor'];
        await page.route('**/api/info?*', async route => {
            const response = await route.fetch();
            const info = await response.json();
            info.services = services;
            await route.fulfill({ json: info });
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openNodeInfo();
        assert.deepEqual(await section.locator('.modal-val').allTextContents(), services);
        assert.deepEqual(await section.locator('.modal-label').allTextContents(), ['Bloom filters', 'Compact block filters', 'BLAKE2b', 'Advertised service', 'Advertised service']);
        assert.equal(await section.locator('img').count(), 0, 'unknown service names must render as text');

        for (const [value, message] of [
            [[], 'No services advertised'],
            [null, 'Service information unavailable'],
            [undefined, 'Service information unavailable'],
        ]) {
            services = value;
            await page.reload({ waitUntil: 'domcontentloaded' });
            await openNodeInfo();
            assert.equal(await section.textContent(), message);
            assert.equal(await section.locator('.modal-row').count(), 0);
        }
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }

    async function openNodeInfo() {
        await page.waitForFunction(() => document.getElementById('mo-status')?.textContent === 'Synced');
        await page.locator('#btn-node-info-peer').click();
        await page.locator('#ni-services-section').waitFor();
    }
}
