import assert from 'node:assert/strict';

export default async function assertDistributionCoverage(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        const interval = window.setInterval.bind(window);
        window.setInterval = (handler, ms, ...args) => {
            if (ms === 10000) {
                window.testCoveragePoll = handler;
                return interval(handler, 3600000, ...args);
            }
            return interval(handler, ms, ...args);
        };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const seed = await (await page.request.get(`${baseUrl}/api/peers?include_status=true`)).json();
    const sample = seed.peers.find(peer => peer.is_public);
    let peers = [
        { ...sample, id: 1, direction: 'IN', network: 'ipv4', as: 'AS64500 Sample', countryCode: 'NZ', country: 'New Zealand' },
        { ...sample, id: 2, direction: 'IN', network: 'ipv6', as: '', countryCode: 'NZ', country: 'New Zealand' },
        { ...sample, id: 3, direction: 'OUT', network: 'ipv4', as: '', countryCode: '', country: '' },
        { ...sample, id: 4, direction: 'OUT', network: 'ipv4', is_public: false, as: 'AS64501 Private', countryCode: 'GB', country: 'United Kingdom' },
    ];
    await page.route('**/api/peers?include_status=true', route => route.fulfill({ json: { ...seed, peers } }));
    const coverage = page.locator('#as-detail-panel .modal-row')
        .filter({ has: page.locator('.modal-label').filter({ hasText: /^Coverage$/ }) })
        .locator('.modal-val');
    const openExplore = async () => {
        await page.locator('#as-overview-trigger').focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('#as-detail-panel.visible');
    };
    const assertTitleFitsExplore = async () => {
        const titleBounds = await page.locator('#as-donut-title').boundingBox();
        const triggerBounds = await page.locator('#as-overview-trigger').boundingBox();
        assert.ok(titleBounds.y + titleBounds.height <= triggerBounds.y + 1, 'the distribution title does not overlap Explore distribution');
    };
    const waitCoverage = async expected => {
        await page.waitForFunction(expected => Array.from(document.querySelectorAll('#as-detail-panel .modal-row'))
            .find(row => row.querySelector('.modal-label')?.textContent.trim() === 'Coverage')
            ?.querySelector('.modal-val')?.textContent.includes(expected), expected);
        assert.equal(await coverage.isVisible(), true, 'Explore distribution shows its Coverage row');
    };
    const poll = async () => {
        const response = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
        await page.evaluate(() => window.testCoveragePoll());
        await response;
    };
    try {
        await page.goto(baseUrl);
        await page.waitForFunction(() => document.getElementById('as-score-value')?.title.includes('Provider known for 1/3'));
        assert.equal(await page.locator('#as-coverage').count(), 0, 'the overview has no separate coverage line');
        await page.evaluate(() => document.fonts.ready);
        await assertTitleFitsExplore();
        assert.equal(await page.locator('#as-donut .as-donut-segment').count(), 1);
        const identified = page.locator('#as-legend .as-legend-item').first();
        assert.match(await identified.textContent(), /100%/);
        await openExplore();
        await waitCoverage('Provider known for 1/3');
        await assertTitleFitsExplore();
        assert.match(await coverage.textContent(), /Inbound 1\/2.*Outbound 0\/1.*Inbound \+ outbound/);
        const fullCoverage = await coverage.textContent();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.body.classList.contains('donut-focused'));
        // A table filter does not change the population described by the score tooltip.
        const scoreTooltip = await page.locator('#as-score-value').getAttribute('title');
        assert.ok(scoreTooltip.includes(fullCoverage));
        await page.locator('.net-badge[data-net="ipv6"]').click();
        assert.equal(await page.locator('#as-score-value').getAttribute('title'), scoreTooltip);
        await page.locator('.net-badge[data-net="all"]').click();
        await page.locator('#as-donut .as-donut-segment').first().focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('#as-detail-panel.visible');
        assert.match(await page.locator('.as-detail-pct').textContent(), /100\.0% of public peers with known provider/);
        assert.equal(await coverage.textContent(), fullCoverage, 'provider and map filtering preserve full public coverage');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.body.classList.contains('donut-focused'));
        await openExplore();
        await waitCoverage('Provider known for 1/3');
        peers = peers.map(peer => ({ ...peer, as: '' }));
        await poll();
        await waitCoverage('Provider known for 0/3');
        assert.match(await coverage.textContent(), /Inbound 0\/2.*Outbound 0\/1/);
        assert.match(await page.locator('#as-donut-center .as-score-quality').textContent(), /Unavailable/);
        assert.equal(await page.locator('#as-donut .as-donut-segment').count(), 0);
        assert.ok(await coverage.isVisible(), 'Explore coverage stays visible without distribution data');
        await page.locator('.as-lens-btn[data-lens="country"]').click();
        await waitCoverage('Country known for 2/3');
        assert.match(await coverage.textContent(), /Inbound 2\/2.*Outbound 0\/1/);
        assert.equal(await page.locator('#as-donut .as-donut-segment').count(), 1, 'country data remains useful without AS data');
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
