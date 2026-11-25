import assert from 'node:assert/strict';
import { FIXTURE_ADMIN_TOKEN } from './layout_server.ts';

const isPrivateMonitoring = pathname => pathname.startsWith('/api/history/') || pathname.startsWith('/api/alerts') || pathname === '/api/diagnostics';

async function nextFrames(page) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export default async function assertMonitoring(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    const page = await context.newPage();
    const errors = [], requests = [], responses = [];
    let holdHistory = false, releaseHistory = null, historyReady = null, historyFinished = null;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        const url = new URL(request.url());
        if (isPrivateMonitoring(url.pathname)) requests.push({ path: url.pathname, method: request.method(), query: url.search,
            body: request.method() === 'POST' ? request.postDataJSON() : null });
    });
    page.on('response', response => {
        if (isPrivateMonitoring(new URL(response.url()).pathname)) responses.push({ status: response.status(), headers: response.headers() });
    });
    await page.route('**/api/history/events?*', async route => {
        if (!holdHistory) { await route.continue(); return; }
        const response = await route.fetch();
        const data = await response.json();
        data.events = [{ id: 'late-private-history', time: Date.now() / 1000, source: 'peer', kind: 'arrival',
            address: '198.51.100.254', peer_id: 254, reason: 'LATE_PRIVATE_HISTORY' }];
        historyReady?.();
        try {
            await new Promise(resolve => { releaseHistory = resolve; });
            await route.fulfill({ response, json: data });
        } catch { /* Locking cancels the browser request before the held body arrives. */ }
        finally { historyFinished?.(); }
    });
    const tab = async name => {
        await page.locator(`#monitoring-tab-${name}`).click();
        await page.waitForFunction(name => document.getElementById(`monitoring-tab-${name}`)?.getAttribute('aria-selected') === 'true', name);
    };
    const waitPage = async (number, count) => {
        await page.waitForFunction(({ number, count }) => document.getElementById('monitoring-page-label')?.textContent === `Page ${number} · ${count} event(s)` &&
            !document.getElementById('monitoring-history-results')?.hasAttribute('aria-busy'), { number, count });
        assert.equal(await page.locator('#monitoring-history-results .monitoring-event').count(), count);
    };
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.locator('#peer-tbody tr[data-id]').first().waitFor();
        assert.equal(await page.locator('#btn-monitoring').isVisible(), false, 'private Monitoring entry stays hidden before management unlock');
        assert.equal(requests.length, 0, 'ordinary monitoring does not fetch private history, diagnostics, or alerts');
        for (const path of ['/api/history/events', '/api/alerts', '/api/diagnostics']) {
            const denied = await context.request.head(baseUrl + path);
            assert.equal(denied.status(), 401, `${path} requires management even on the public fixture`);
            assert.equal(denied.headers()['cache-control'], 'private, no-store');
            await denied.dispose();
        }

        // The existing policy unlock exercises the same management generation
        // as the Monitoring entry; the new panel never introduces a second token.
        await page.locator('#btn-inbound-policy').click();
        await page.locator('#admin-token-input').fill(FIXTURE_ADMIN_TOKEN);
        await page.locator('#admin-token-submit').click();
        await page.locator('#peer-policy-modal').waitFor();
        await page.keyboard.press('Escape');
        await page.locator('#peer-policy-modal').waitFor({ state: 'detached' });
        await page.locator('#btn-monitoring').waitFor({ state: 'visible' });
        await page.locator('#btn-monitoring').click();
        await page.getByRole('dialog', { name: 'Monitoring', exact: true }).waitFor();
        await waitPage(1, 50);
        assert.equal(await page.locator('#monitoring-previous').isDisabled(), true);
        assert.equal(await page.locator('#monitoring-next').isEnabled(), true);
        assert.match(await page.locator('#monitoring-history').textContent(), /History recording: Off/);
        assert.match(await page.locator('.monitoring-coverage').textContent(), /1 monitoring gap\(s\); 2 dropped record\(s\)/);
        assert.match(await page.locator('.monitoring-coverage').textContent(), /Coverage is incomplete/);
        assert.equal(await page.locator('#monitoring-history-results img').count(), 0, 'stored peer/event text cannot create DOM markup');
        assert.match(await page.locator('#monitoring-history-results').textContent(), /<img src=x onerror=/);
        assert.equal(await page.evaluate(() => Boolean(window.monitoringInjection)), false);
        const firstAddress = await page.locator('.monitoring-event code').first().textContent();
        await page.locator('#monitoring-next').click(); await waitPage(2, 50);
        assert.notEqual(await page.locator('.monitoring-event code').first().textContent(), firstAddress);
        await page.locator('#monitoring-next').click(); await waitPage(3, 50);
        await page.locator('#monitoring-next').click(); await waitPage(4, 1);
        assert.equal(await page.locator('#monitoring-next').isDisabled(), true);
        await page.locator('#monitoring-previous').click(); await waitPage(3, 50);

        // Filtering resets the cursor and renders only the server's matching page.
        await page.locator('#monitoring-source').selectOption('manual');
        await page.locator('#monitoring-kind').fill('arrival');
        await page.locator('#monitoring-search').fill('198.51.100.2');
        await page.locator('#monitoring-window').selectOption('30d');
        await page.locator('#monitoring-history-filters button[type="submit"]').click();
        await waitPage(1, 5);
        assert.ok((await page.locator('.monitoring-event').allTextContents()).every(text => text.includes('manual · arrival') && text.includes('198.51.100.2')));
        const filteredRequest = requests.filter(request => request.path === '/api/history/events').at(-1);
        const parameters = new URLSearchParams(filteredRequest.query);
        assert.equal(parameters.get('window'), '30d');
        assert.equal(parameters.get('limit'), '50');
        assert.equal(parameters.has('cursor'), false);
        const hundred = await context.request.get(baseUrl + '/api/history/events?limit=100');
        assert.equal(hundred.status(), 200);
        assert.equal((await hundred.json()).events.length, 100, 'the API supports a bounded 100-record page');
        await hundred.dispose();
        const bounded = await context.request.get(baseUrl + '/api/history/events?limit=1000');
        assert.ok(bounded.status() === 422 || (bounded.status() === 200 && (await bounded.json()).events.length <= 100),
            'larger page requests are rejected or capped, never returned unbounded');
        await bounded.dispose();

        await page.locator('#monitoring-recording-toggle').click();
        await page.waitForFunction(() => document.getElementById('monitoring-recording-toggle')?.textContent === 'Disable recording');
        assert.match(await page.locator('.monitoring-coverage').textContent(), /Recording enabled/);
        await page.locator('#monitoring-recording-toggle').click();
        await page.waitForFunction(() => document.getElementById('monitoring-recording-toggle')?.textContent === 'Enable recording');
        const recordingWrites = requests.filter(request => request.path === '/api/history/settings' && request.method === 'POST');
        assert.deepEqual(recordingWrites.map(request => request.body.enabled), [true, false], 'recording changes only after explicit administrator actions');

        await page.locator('#monitoring-tab-history').focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.getElementById('monitoring-tab-trends')?.getAttribute('aria-selected') === 'true');
        await page.locator('#monitoring-trend-results svg').first().waitFor();
        assert.ok(await page.locator('#monitoring-trend-results svg').count() >= 2);
        assert.equal(await page.getByRole('img', { name: /^Observed peer counts;/ }).count(), 1);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'monitoring-tab-trends');
        assert.equal(await page.locator('#monitoring-history').evaluate(panel => panel.childElementCount), 0, 'inactive tabs release their large DOM');
        assert.match(await page.locator('#monitoring-trend-results').textContent(), /RPC accepted: 12/);
        assert.match(await page.locator('#monitoring-trend-results').textContent(), /Observed departures: 10/);
        const trafficPath = await page.getByRole('img', { name: /^Bitcoin P2P traffic;/ }).locator('.monitoring-line-first').getAttribute('d');
        assert.equal((trafficPath.match(/M/g) || []).length, 2, 'a null traffic sample breaks the plot rather than drawing across a gap');

        await tab('health');
        await page.locator('#monitoring-copy-diagnostics').waitFor();
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async () => { throw new DOMException('Unavailable in test', 'NotAllowedError'); },
        } }));
        await page.locator('#monitoring-copy-diagnostics').click();
        await page.locator('#monitoring-report').waitFor({ state: 'visible' });
        const report = await page.locator('#monitoring-report').inputValue();
        assert.equal(JSON.parse(report).build.version, 'fixture');
        assert.equal(JSON.parse(report).geoip.state, 'disabled');
        assert.ok(!/authorization|password|endpoint|data_dir|wallet|198\.51\.100\.|http:\/\/|\/tmp\//i.test(report), 'the report omits credentials, endpoints, paths, wallets, and peer addresses');
        assert.equal(await page.locator('#monitoring-report').evaluate(area => area === document.activeElement && area.selectionEnd === area.value.length), true,
            'the clipboard fallback selects a usable redacted report');

        await tab('alerts');
        await page.locator('[data-alert-ack="fixture-alert"]').waitFor();
        assert.equal(await page.locator('#monitoring-incidents img').count(), 0);
        await page.locator('[data-alert-ack="fixture-alert"]').click();
        await page.waitForFunction(() => !document.querySelector('[data-alert-ack="fixture-alert"]'));
        assert.equal(await page.locator('.monitoring-alert[data-state="active"]').count(), 1, 'acknowledging does not resolve an ongoing incident');
        assert.match(await page.locator('#monitoring-incidents').textContent(), /Acknowledged/);
        assert.equal(await page.locator('#monitoring-alert-count').isVisible(), false);

        // A second administrator changes the real fixture revision. The stale
        // browser save must reload, rather than replaying over the newer rules.
        const original = await (await context.request.get(baseUrl + '/api/alerts/settings')).json();
        const concurrent = await context.request.post(baseUrl + '/api/alerts/settings', {
            headers: { Authorization: `Bearer ${FIXTURE_ADMIN_TOKEN}`, Origin: baseUrl },
            data: { expected_revision: original.revision, rules: { ...original.rules, low_outbound: false } },
        });
        assert.equal(concurrent.status(), 200); await concurrent.dispose();
        const writesBefore = requests.filter(request => request.path === '/api/alerts/settings' && request.method === 'POST').length;
        await page.locator('[data-alert-rule="peer_data"]').uncheck();
        await page.locator('#monitoring-alert-rules button[type="submit"]').click();
        await page.waitForFunction(() => document.getElementById('monitoring-message')?.textContent.includes('Settings changed elsewhere'));
        assert.equal(await page.locator('[data-alert-rule="peer_data"]').isChecked(), true);
        assert.equal(await page.locator('[data-alert-rule="low_outbound"]').isChecked(), false);
        assert.equal(requests.filter(request => request.path === '/api/alerts/settings' && request.method === 'POST').length, writesBefore + 1,
            'the stale mutation is not automatically replayed');
        await page.locator('[data-alert-rule="low_outbound"]').check();
        await page.locator('#monitoring-alert-rules button[type="submit"]').click();
        await page.waitForFunction(() => document.getElementById('monitoring-message')?.textContent === 'Settings saved.');

        await page.setViewportSize({ width: 360, height: 740 });
        const geometry = await page.locator('#monitoring-modal [role="dialog"]').evaluate(dialog => {
            const box = dialog.getBoundingClientRect();
            const panel = dialog.querySelector('.monitoring-panel:not([hidden])');
            return { left: box.left, right: box.right, width: innerWidth, overflow: panel.scrollWidth > panel.clientWidth + 1 };
        });
        assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && !geometry.overflow, `Monitoring fits a narrow viewport: ${JSON.stringify(geometry)}`);
        await page.locator('#monitoring-tab-alerts').focus();
        await page.keyboard.press('Home');
        await page.waitForFunction(() => document.activeElement.id === 'monitoring-tab-history');
        await waitPage(1, 5);

        // A clipboard operation belonging to a closed dialog cannot populate a
        // newly opened Health panel, even though both dialogs use the same IDs.
        await tab('health');
        await page.locator('#monitoring-copy-diagnostics').waitFor();
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: () => new Promise((_resolve, reject) => { window.rejectMonitoringClipboard = reject; }),
        } }));
        await page.locator('#monitoring-copy-diagnostics').click();
        await page.waitForFunction(() => typeof window.rejectMonitoringClipboard === 'function');
        await page.keyboard.press('Escape');
        await page.locator('#monitoring-modal').waitFor({ state: 'detached' });
        await page.locator('#btn-monitoring').click();
        await waitPage(1, 50);
        await tab('health');
        await page.locator('#monitoring-copy-diagnostics').waitFor();
        await page.evaluate(() => window.rejectMonitoringClipboard(new DOMException('Late clipboard failure', 'NotAllowedError')));
        await nextFrames(page);
        assert.equal(await page.locator('#monitoring-report').isVisible(), false, 'a stale clipboard failure does not reveal an old report in a replacement dialog');
        assert.equal(await page.locator('#monitoring-message').textContent(), '');
        await tab('history');
        await waitPage(1, 50);

        holdHistory = true;
        let readyTimeout;
        const ready = new Promise((resolve, reject) => {
            historyReady = () => { clearTimeout(readyTimeout); resolve(); };
            readyTimeout = setTimeout(() => reject(new Error('Held history request did not start')), 15000);
        });
        const finished = new Promise(resolve => { historyFinished = resolve; });
        await page.locator('#monitoring-history-refresh').click();
        await ready;
        // Simulate a lock from another management surface while the modal owns focus.
        await page.locator('#admin-lock').evaluate(button => button.click());
        await page.locator('#monitoring-modal').waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.getElementById('btn-monitoring').hidden);
        releaseHistory?.(); releaseHistory = null;
        await finished;
        await nextFrames(page);
        assert.equal(await page.locator('#monitoring-modal').count(), 0);
        assert.equal(await page.evaluate(() => document.body.textContent.includes('LATE_PRIVATE_HISTORY')), false,
            'an authorized response released after lock cannot restore private history');
        assert.equal(await page.locator('#admin-token-modal').count(), 0, 'background reads do not prompt to unlock again');
        assert.equal(await page.evaluate(() => Boolean(window.monitoringInjection)), false);
        assert.ok(responses.filter(response => response.status === 200).every(response => response.headers['cache-control'] === 'private, no-store'));
        assert.deepEqual(errors, []);
    } finally {
        releaseHistory?.();
        await context.close();
    }
}
