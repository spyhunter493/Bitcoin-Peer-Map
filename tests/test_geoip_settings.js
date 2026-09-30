import assert from 'node:assert/strict';

export default async function assertGeoIPSettings(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    let autoUpdate = true;
    let dbOnly = false;
    let rejectPrivacySave = true;
    let manualUpdates = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        window.testIntervals = [];
        const original = window.setInterval.bind(window);
        window.setInterval = (handler, interval, ...args) => {
            window.testIntervals.push(interval);
            return original(handler, interval, ...args);
        };
    });
    await page.route('**/api/info?*', async route => {
        const response = await route.fetch();
        const info = await response.json();
        info.geo_db_stats.auto_update = autoUpdate;
        info.geo_db_stats.db_only_mode = dbOnly;
        info.geo_db_only_mode = dbOnly;
        await route.fulfill({ json: info });
    });
    await page.route('**/api/geodb/toggle-db-only', async route => {
        if (rejectPrivacySave) {
            await route.fulfill({ status: 500, body: 'Internal Server Error' });
            return;
        }
        dbOnly = !dbOnly;
        await route.fulfill({ json: { success: true, geo_db_only_mode: dbOnly } });
    });
    await page.route('**/api/geodb/toggle-auto-update', async route => {
        autoUpdate = !autoUpdate;
        await route.fulfill({ json: { success: true, auto_update: autoUpdate } });
    });
    await page.route('**/api/geodb/update', async route => {
        manualUpdates++;
        await route.fulfill({ json: { success: true, message: '2 updated entries (128 total)' } });
    });

    async function openSettings() {
        await page.waitForFunction(() => document.getElementById('mo-status')?.textContent === 'Synced');
        await page.locator('#btn-geoip-db-peer').click();
        await page.locator('#geodb-dbonly-toggle').waitFor({ state: 'attached' });
    }

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await openSettings();
        assert.match(await page.locator('#geodb-modal-body').textContent(), /unencrypted HTTP/);
        assert.match(await page.locator('#geodb-modal-body').textContent(), /survives restarts/);
        assert.equal(await page.locator('#geodb-autoupdate-toggle').isChecked(), true);
        assert.equal(await page.locator('#geodb-dbonly-toggle').isChecked(), true);

        // A rejected persistence write must not leave a misleading privacy switch.
        await page.locator('#geodb-dbonly-toggle + .geodb-toggle-slider').click();
        await page.waitForFunction(() => document.getElementById('geodb-result')?.textContent?.includes('not saved'));
        assert.equal(await page.locator('#geodb-dbonly-toggle').isChecked(), true);
        rejectPrivacySave = false;
        await page.locator('#geodb-dbonly-toggle + .geodb-toggle-slider').click();
        await page.waitForFunction(() => {
            const input = document.getElementById('geodb-dbonly-toggle');
            return input && !input.checked && !input.disabled;
        });
        assert.equal(dbOnly, true);

        await page.locator('#geodb-autoupdate-toggle + .geodb-toggle-slider').click();
        await page.waitForFunction(() => {
            const input = document.getElementById('geodb-autoupdate-toggle');
            return input && !input.checked && !input.disabled;
        });
        assert.equal(autoUpdate, false);
        await page.locator('#geodb-autoupdate-toggle + .geodb-toggle-slider').click();
        await page.waitForFunction(() => {
            const input = document.getElementById('geodb-autoupdate-toggle');
            return input && input.checked && !input.disabled;
        });
        assert.equal(autoUpdate, true);
        assert.equal(await page.evaluate(() => window.testIntervals.includes(3600000)), false);
        assert.equal(manualUpdates, 0, 'browser must not initiate scheduled updates');

        await page.locator('#geodb-update-btn').click();
        await page.waitForFunction(() => document.getElementById('geodb-result')?.textContent?.includes('2 updated entries'));
        assert.equal(manualUpdates, 1);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await openSettings();
        assert.equal(await page.locator('#geodb-dbonly-toggle').isChecked(), false);
        assert.equal(await page.locator('#geodb-autoupdate-toggle').isChecked(), true);
        assert.equal(await page.evaluate(() => window.testIntervals.includes(3600000)), false);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
