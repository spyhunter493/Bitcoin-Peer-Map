import assert from 'node:assert/strict';

export default async function assertGeoIPSettings(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    let autoUpdate = true;
    let dbOnly = false;
    let rejectPrivacySave = true;
    let manualUpdates = 0;
    let manualGate = Promise.resolve();
    let showApiDown = false;
    let rateLimited = false;
    const requestedSettings = [];
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
    await page.route('**/api/info', async route => {
        const response = await route.fetch();
        const info = await response.json();
        info.geo_db_stats.auto_update = autoUpdate;
        info.geo_db_stats.db_only_mode = dbOnly;
        info.geo_db_stats.db_path = '/var/lib/bitcoin-peer-map/geo.db';
        info.geo_db_only_mode = dbOnly;
        info.api_available = !showApiDown;
        info.internet_state = 'red';
        info.providers = { geoip: { state: showApiDown ? 'unavailable' : rateLimited ? 'rate_limited' : 'healthy', consecutive_failures: showApiDown ? 5 : 0,
            last_error: rateLimited ? 'Quota <exhausted>' : null, last_success_at: Date.now() / 1000 - 60, last_failure_at: null,
            retry_at: rateLimited ? Date.now() / 1000 + 60 : null } };
        await route.fulfill({ json: info });
    });
    await page.route('**/api/connectivity', route => route.fulfill({ json: {
        api_down_prompt: showApiDown, geo_db_only_mode: dbOnly,
    } }));
    await page.route('**/api/geodb/db-only', async route => {
        const body = route.request().postDataJSON();
        assert.equal(typeof body.enabled, 'boolean');
        requestedSettings.push(['db-only', body.enabled]);
        if (rejectPrivacySave) {
            await route.fulfill({ status: 500, body: 'Internal Server Error' });
            return;
        }
        dbOnly = body.enabled;
        await route.fulfill({ json: { success: true, geo_db_only_mode: dbOnly } });
    });
    await page.route('**/api/geodb/auto-update', async route => {
        const body = route.request().postDataJSON();
        assert.equal(typeof body.enabled, 'boolean');
        requestedSettings.push(['auto-update', body.enabled]);
        autoUpdate = body.enabled;
        await route.fulfill({ json: { success: true, auto_update: autoUpdate } });
    });
    await page.route('**/api/geodb/update', async route => {
        manualUpdates++;
        await manualGate;
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
        assert.match(await page.locator('#geodb-provider-health').textContent(), /healthy/);
        assert.match(await page.locator('#geodb-provider-health').textContent(), /Last success/);
        assert.notEqual(await page.locator('#mo-status-msg').textContent(), 'Offline', 'Google probe failure does not hide healthy GeoIP');
        assert.equal(await page.locator('#geodb-modal [role="dialog"]').getAttribute('aria-modal'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'geodb-modal-close');
        assert.match(await page.locator('#geodb-modal-body').textContent(), /\/var\/lib\/bitcoin-peer-map\/geo.db/);
        await page.keyboard.press('Escape');
        await page.waitForSelector('#geodb-modal', { state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-geoip-db-peer');
        await openSettings();
        assert.match(await page.locator('#geodb-modal-body').textContent(), /unencrypted HTTP/);
        assert.match(await page.locator('#geodb-modal-body').textContent(), /survives restarts/);
        assert.match(await page.locator('#geodb-modal-body').textContent(), /stale after 30 days/);
        assert.equal(await page.locator('#geodb-autoupdate-toggle').isChecked(), true);
        assert.equal(await page.locator('#geodb-dbonly-toggle').isChecked(), true);

        // A rejected persistence write must not leave a misleading privacy switch.
        await page.locator('#geodb-dbonly-toggle + .geodb-toggle-slider').click();
        await page.waitForFunction(() => document.getElementById('geodb-result')?.textContent?.includes('not saved'));
        assert.equal(await page.locator('#geodb-dbonly-toggle').isChecked(), true);
        rejectPrivacySave = false;
        dbOnly = true; // Another tab already selected the desired privacy setting.
        await page.locator('#geodb-dbonly-toggle + .geodb-toggle-slider').click();
        await page.waitForFunction(() => {
            const input = document.getElementById('geodb-dbonly-toggle');
            return input && !input.checked && !input.disabled;
        });
        assert.equal(dbOnly, true);
        rejectPrivacySave = true;
        await page.locator('#geodb-dbonly-toggle + .geodb-toggle-slider').click();
        await page.waitForFunction(() => document.getElementById('geodb-result')?.textContent?.includes('not saved'));
        assert.equal(await page.locator('#geodb-dbonly-toggle').isChecked(), false, 'later failures restore the most recently saved setting');
        rejectPrivacySave = false;

        autoUpdate = false; // This switch also has an older view than the server.
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

        let releaseUpdate;
        manualGate = new Promise(resolve => { releaseUpdate = resolve; });
        const updateResponse = page.waitForResponse(response => response.url().endsWith('/api/geodb/update'));
        await page.locator('#geodb-update-btn').click();
        await page.waitForFunction(() => document.getElementById('geodb-update-btn')?.disabled);
        await page.locator('#geodb-update-btn').evaluate(button => button.click());
        assert.equal(manualUpdates, 1, 'pending manual imports cannot be submitted twice');
        releaseUpdate();
        await updateResponse;
        await page.waitForFunction(() => document.getElementById('geodb-result')?.textContent?.includes('2 updated entries'));
        assert.equal(manualUpdates, 1);
        await page.waitForFunction(() => !document.getElementById('geodb-update-btn')?.disabled);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await openSettings();
        assert.equal(await page.locator('#geodb-dbonly-toggle').isChecked(), false);
        assert.equal(await page.locator('#geodb-autoupdate-toggle').isChecked(), true);
        assert.equal(await page.evaluate(() => window.testIntervals.includes(3600000)), false);
        assert.deepEqual(requestedSettings, [['db-only', true], ['db-only', true], ['db-only', false], ['auto-update', false], ['auto-update', true]]);

        // The recovery action sets database-only mode even if another tab changed it.
        await page.locator('#geodb-modal-close').click();
        dbOnly = false;
        showApiDown = true;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#api-down-dbonly');
        dbOnly = true;
        await page.locator('#api-down-dbonly').click();
        await page.waitForSelector('#api-down-modal', { state: 'detached' });
        assert.equal(dbOnly, true);
        assert.deepEqual(requestedSettings.at(-1), ['db-only', true]);
        showApiDown = false;
        dbOnly = false;
        rateLimited = true;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openSettings();
        assert.match(await page.locator('#geodb-provider-health').textContent(), /rate_limited/);
        assert.match(await page.locator('#geodb-provider-health').textContent(), /Retry in/);
        assert.match(await page.locator('#geodb-provider-health').textContent(), /Quota <exhausted>/);
        assert.equal(await page.locator('#geodb-provider-health exhausted').count(), 0);
        assert.match(await page.locator('#mo-status-msg').textContent(), /GeoIP rate limited/);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
