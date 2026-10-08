import assert from 'node:assert/strict';

export default async function assertOutboundSettings(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    const page = await context.newPage(), errors = [], accepted = [];
    const admin = 'bpm-test-admin-token-'.padEnd(64, 'x');
    const preferences = { optional_outbound: false, geoip_dataset_downloads: true, release_checks: true, reachability_checks: true };
    let dbOnly = true, rejectSave = true, forcedDisabled = false;
    function snapshot() {
        const enabled = preferences.optional_outbound && !forcedDisabled;
        return { preferences: { ...preferences }, effective: { geoip_lookups: enabled && !dbOnly, dataset_downloads: enabled && preferences.geoip_dataset_downloads,
            release_checks: enabled && preferences.release_checks, reachability_probes: enabled && preferences.reachability_checks }, forced_disabled: forcedDisabled, provider: { name: 'ip-api', transport: 'http' } };
    }
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    await page.route('**/api/info', async route => {
        const response = await route.fetch(), info = await response.json(), effective = snapshot().effective;
        info.geo_db_stats.db_only_mode = dbOnly; info.geo_db_only_mode = dbOnly;
        info.internet_state = effective.reachability_probes ? 'green' : 'disabled';
        info.api_available = effective.geoip_lookups;
        info.providers = { geoip: { state: effective.geoip_lookups ? 'healthy' : 'disabled', consecutive_failures: 0, last_error: null, last_success_at: null, last_failure_at: null, retry_at: null } };
        await route.fulfill({ json: info });
    });
    await page.route('**/api/config/outbound', async route => {
        if (route.request().method() === 'GET') { await route.fulfill({ json: snapshot() }); return; }
        const body = route.request().postDataJSON();
        assert.deepEqual(Object.keys(body).sort(), ['enabled', 'preference']);
        assert.equal(typeof body.enabled, 'boolean');
        assert.ok(Object.hasOwn(preferences, body.preference));
        if (route.request().headers().authorization !== `Bearer ${admin}`) {
            await route.fulfill({ status: 401, json: { detail: 'Enter the admin token', code: 'admin_required' } }); return;
        }
        if (rejectSave) { await route.fulfill({ status: 500, json: { detail: 'Preference write failed' } }); return; }
        preferences[body.preference] = body.enabled; accepted.push(body.preference);
        await route.fulfill({ json: snapshot() });
    });
    await page.route('**/api/geodb/db-only', async route => {
        assert.equal(route.request().headers().authorization, `Bearer ${admin}`);
        dbOnly = route.request().postDataJSON().enabled;
        await route.fulfill({ json: { success: true, geo_db_only_mode: dbOnly } });
    });
    async function open() {
        await page.locator('#btn-geoip-db-peer').click();
        await page.locator('#geodb-outbound-toggle').waitFor({ state: 'attached' });
    }
    async function toggle(id, checked) {
        await page.locator(`#${id} + .geodb-toggle-slider`).click();
        await page.waitForFunction(({ id, checked }) => {
            const input = document.getElementById(id);
            return input?.checked === checked && !input.disabled;
        }, { id, checked });
    }
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('mo-status')?.textContent === 'Synced');
        await open();
        assert.equal(await page.locator('#geodb-outbound-toggle').isChecked(), false);
        assert.equal(await page.locator('#geodb-dbonly-toggle').isChecked(), false);
        assert.equal(await page.locator('#geodb-update-btn').isDisabled(), true);
        assert.match(await page.locator('#geodb-modal-body').textContent(), /unencrypted HTTP/);
        assert.match(await page.locator('#geodb-outbound-status').textContent(), /Configured Bitcoin RPC and local database reads\/writes remain available/);
        assert.match(await page.locator('#internet-dot').getAttribute('title'), /disabled/);
        await page.locator('#geodb-outbound-toggle + .geodb-toggle-slider').click();
        await page.locator('#admin-token-input').waitFor({ state: 'visible' });
        await page.locator('#admin-token-input').fill(admin);
        await page.locator('#admin-token-submit').click();
        await page.waitForFunction(() => document.getElementById('geodb-result')?.textContent.includes('not saved'));
        assert.equal(await page.locator('#geodb-outbound-toggle').isChecked(), false, 'failed persistence restores the saved privacy choice');
        rejectSave = false;
        await toggle('geodb-outbound-toggle', true);
        assert.equal(await page.locator('#geodb-update-btn').isDisabled(), false);
        assert.match(await page.locator('#geodb-outbound-status').textContent(), /external peer lookups off/, 'global opt-in retains the separate lookup-off choice');
        await toggle('geodb-dbonly-toggle', true);
        assert.match(await page.locator('#geodb-outbound-status').textContent(), /on \(unencrypted HTTP\)/);
        await toggle('geodb-dataset-toggle', false);
        assert.equal(await page.locator('#geodb-update-btn').isDisabled(), true);
        await toggle('geodb-release-toggle', false);
        await toggle('geodb-probe-toggle', false);
        assert.match(await page.locator('#geodb-outbound-status').textContent(), /release checks off; reachability probes off/);
        await toggle('geodb-outbound-toggle', false);
        await page.keyboard.press('Escape');
        await page.locator('#geodb-modal').waitFor({ state: 'detached' });
        await open();
        assert.equal(await page.locator('#geodb-outbound-toggle').isChecked(), false);
        assert.equal(await page.locator('#geodb-dbonly-toggle').isChecked(), true, 'feature opt-in remains saved but is blocked by global denial');
        assert.match(await page.locator('#geodb-outbound-status').textContent(), /external peer lookups off/);
        await page.keyboard.press('Escape');
        await page.locator('#geodb-modal').waitFor({ state: 'detached' });
        forcedDisabled = true;
        await open();
        assert.equal(await page.locator('#geodb-outbound-toggle').isDisabled(), true);
        assert.equal(await page.locator('#geodb-update-btn').isDisabled(), true);
        assert.match(await page.locator('#geodb-outbound-status').textContent(), /Deployment configuration blocks/);
        assert.deepEqual(accepted, ['optional_outbound', 'geoip_dataset_downloads', 'release_checks', 'reachability_checks', 'optional_outbound']);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
}
