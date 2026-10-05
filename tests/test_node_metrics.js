import assert from 'node:assert/strict';

export default async function assertNodeMetrics(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 }, deviceScaleFactor: 1.25 });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    let metrics = { rx_bps: 512, tx_bps: 256, uptime: '2d 3h 4m' };
    let unavailable = false, ibd = false, blockchainUnavailable = false, invalidJson = false, stalled = false, infoRequests = 0;
    let releaseStall;
    const stallGate = new Promise(resolve => { releaseStall = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.route('**/api/info', async route => {
        infoRequests++;
        if (stalled) { await stallGate; await route.abort().catch(() => {}); return; }
        if (invalidJson) { await route.fulfill({ body: 'invalid JSON' }); return; }
        if (unavailable) { await route.fulfill({ status: 502, body: '{}' }); return; }
        const response = await route.fetch();
        const info = await response.json();
        info.blockchain = blockchainUnavailable ? null : { ...info.blockchain, ibd };
        info.node_metrics = { ...info.node_metrics, ...metrics };
        await route.fulfill({ response, json: info });
    });
    await page.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        if (!localStorage.getItem('bpm.system.display')) localStorage.setItem('bpm.system.display', JSON.stringify({ 'mo-row-cpu': false, 'mo-row-ram': false, 'mo-row-netout': false }));
    });

    async function ready() {
        await page.waitForFunction(() => document.getElementById('mo-p2p-in')?.textContent === '8.00GB');
    }
    async function controlsFit() {
        const header = await page.locator('#topbar').boundingBox();
        const stats = await page.locator('#map-overlay').boundingBox();
        const controls = await page.locator('#map-controls').boundingBox();
        const gap = stats.y - (header.y + header.height);
        assert.ok(gap >= 10 && gap <= 24, 'stats must sit just below the header without reserving space for the removed price bar');
        assert.ok(controls.y >= stats.y + stats.height + 10, 'controls must sit below all visible stats');
        for (const id of ['zoom-in', 'zoom-out', 'zoom-reset']) {
            const button = page.locator(`#${id}`);
            const box = await button.boundingBox();
            assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= page.viewportSize().width && box.y + box.height <= page.viewportSize().height);
            await button.click({ trial: true });
        }
        return controls.y;
    }
    async function toggle(id) {
        await page.locator(`.si-dash-toggle[data-target="${id}"] + .dsp-toggle-slider`).click();
    }

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await ready();
        assert.equal(await page.locator('#peer-data-status, .peer-data-row').count(), 0);
        assert.equal(await page.locator('#peer-data-age').count(), 0);
        assert.equal(await page.locator('#mo-row-cpu, #mo-row-ram, #ro-cpu, #ro-ram').count(), 0);
        assert.equal(await page.locator('#btc-price-bar, #mo-btc-price, #currency-dropdown').count(), 0);
        assert.equal(await page.locator('#mo-row-netout').isVisible(), false, 'existing traffic-row preferences still apply');
        assert.equal(await page.locator('#mo-row-netin .mo-label').textContent(), 'P2P ↓');
        await page.locator('#topbar-countdown').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#ro-rate-in').textContent(), '512 B/s');

        for (const viewport of [{ width: 1638, height: 900 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            await controlsFit();
        }
        await page.setViewportSize({ width: 1638, height: 900 });
        await page.evaluate(() => document.body.classList.add('hud-solid', 'donut-focused'));
        await controlsFit();
        await page.evaluate(() => document.body.classList.remove('hud-solid', 'donut-focused'));

        const rows = await page.locator('.mo-traffic-value').evaluateAll(values => values.map(value => ({
            right: value.getBoundingClientRect().right,
            fontSize: getComputedStyle(value).fontSize,
            fontWeight: getComputedStyle(value).fontWeight,
        })));
        assert.equal(rows.length, 4);
        assert.ok(rows.filter(row => row.right > 0).every(row => row.right === rows[0].right && row.fontSize === rows[0].fontSize && row.fontWeight === rows[0].fontWeight), 'P2P rates and totals share aligned text styling');

        // Small rate changes and a return to zero must not leave stale HUD values.
        for (const rate of [768, 0]) {
            metrics = { ...metrics, rx_bps: rate, tx_bps: 0 };
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            await page.waitForFunction(text => document.getElementById('ro-rate-in').textContent === text, `${rate} B/s`);
        }

        const expandedY = await controlsFit();
        await page.locator('#mo-row-p2p-in').click();
        const body = page.locator('#system-info-body');
        assert.equal(await page.locator('#system-info-modal .modal-title').textContent(), 'Node Metrics');
        assert.deepEqual(await body.locator('.modal-section-title').allTextContents(), ['Node', 'P2P Traffic', 'Dashboard Display']);
        assert.equal(await body.locator('.si-dash-toggle').count(), 4);
        assert.match(await body.textContent(), /Node uptime2d 3h 4m/);
        assert.doesNotMatch(await body.textContent(), /CPU|RAM|Load Avg|Disk|NET IN/);
        assert.match(await body.textContent(), /P2P IN ↓ \(rate\)0 B\/s/);
        assert.match(await body.textContent(), /P2P IN ↓ \(total\)8.00GB/);
        assert.match(await body.textContent(), /P2P OUT ↑ \(total\)320.00GB/);
        assert.equal(await page.locator('.ro-bar-bg, .net-traffic-bar, [name="si-netbar-mode"]').count(), 0);

        // Refresh metrics while the modal is open without replacing its focused controls.
        const control = body.locator('.si-dash-toggle').first();
        await control.focus();
        metrics = { ...metrics, rx_bps: null, tx_bps: null, uptime: null };
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(() => document.getElementById('node-metrics-values').textContent.includes('Node uptime—'));
        assert.match(await body.textContent(), /P2P IN ↓ \(rate\)—/);
        assert.equal(await control.evaluate(element => element === document.activeElement), true);
        assert.match(await body.textContent(), /P2P IN ↓ \(total\)8.00GB/);

        unavailable = true;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(() => document.getElementById('mo-p2p-in').textContent === '—');
        assert.match(await body.textContent(), /P2P IN ↓ \(total\)—/);
        assert.equal(await page.locator('#mo-status').textContent(), 'Stale');
        unavailable = false;
        metrics = { rx_bps: 512, tx_bps: 256, uptime: '0m' };
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await ready();
        assert.match(await body.textContent(), /Node uptime0m/);
        await toggle('mo-row-p2p-in');
        await toggle('mo-row-p2p-out');
        await page.locator('#system-info-close').click();
        assert.equal(await page.locator('#mo-row-p2p-in').isVisible(), false);
        assert.equal(await page.locator('#mo-row-p2p-out').isVisible(), false);
        assert.ok(await controlsFit() < expandedY, 'controls follow the reduced stats height');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready();
        assert.equal(await page.locator('#mo-row-p2p-in').isVisible(), false);
        assert.equal(await page.locator('#mo-row-p2p-out').isVisible(), false);
        await page.locator('#mo-row-peers').click();
        assert.equal(await page.getByRole('checkbox', { name: 'P2P ↓ (Downloaded total)', exact: true }).isChecked(), false);
        await toggle('mo-row-p2p-in');
        await page.locator('#system-info-close').click();
        assert.equal(await page.locator('#mo-row-p2p-in').isVisible(), true);
        assert.equal(await page.locator('#mo-row-p2p-out').isVisible(), false);
        await controlsFit();
        assert.ok(!requests.includes('/api/stats') && !requests.includes('/api/stream/system'), 'node metrics use the existing info poll');
        assert.ok(!requests.includes('/api/price'), 'the dashboard does not request market prices');
        // The same status rules apply to an open Node Info dialog and the header.
        await page.locator('#btn-node-info-peer').click();
        const nodeSection = page.locator('#ni-node-section');
        for (const [value, label] of [[true, 'Syncing (IBD)'], [null, 'Unknown'], [false, 'Synced']]) {
            ibd = value;
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            await page.waitForFunction(expected => document.getElementById('mo-status').textContent === expected, label);
            assert.ok((await nodeSection.textContent()).includes(label));
        }
        unavailable = true;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(() => document.getElementById('mo-status').textContent === 'Stale');
        assert.match(await nodeSection.textContent(), /Cached node information.*Last successful refresh/);
        assert.match(await nodeSection.textContent(), /Satoshi:29.1.0/);
        assert.equal(await page.locator('#mo-p2p-in').textContent(), '—');
        unavailable = false;
        blockchainUnavailable = true;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(() => document.getElementById('mo-status').textContent === 'Unknown');
        assert.doesNotMatch(await nodeSection.textContent(), /Cached node information/);
        assert.match(await nodeSection.textContent(), /Unknown/);
        blockchainUnavailable = false;

        invalidJson = true;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(() => document.getElementById('mo-status').textContent === 'Stale');
        invalidJson = false;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(() => document.getElementById('mo-status').textContent === 'Synced');

        await page.clock.install();
        stalled = true;
        const stallStarted = page.waitForRequest(request => request.url().endsWith('/api/info'));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await stallStarted;
        const countAtStall = infoRequests;
        await page.clock.fastForward(34_000);
        assert.equal(await page.locator('#mo-status').textContent(), 'Synced');
        assert.equal(infoRequests, countAtStall, 'pending info requests are not duplicated');
        await page.clock.fastForward(1000);
        await page.waitForFunction(() => document.getElementById('mo-status').textContent === 'Stale');
        stalled = false;
        releaseStall();
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(() => document.getElementById('mo-status').textContent === 'Synced');
        assert.equal(infoRequests, countAtStall + 1, 'polling resumes after timeout');
        assert.doesNotMatch(await nodeSection.textContent(), /Cached node information/);
        await page.locator('#node-info-close').click();
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
