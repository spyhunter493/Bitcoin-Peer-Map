import assert from 'node:assert/strict';

/** Shared views and Keep metadata never dispatch node or policy mutations. */
export default async function assertSavedViews(browser, baseUrl) {
    const admin = 'bpm-test-admin-token-'.padEnd(64, 'x');
    const host = '198.51.100.8';
    const errors = [], viewWrites = [], annotationWrites = [], policyWrites = [];
    let revision = 0, views = [], annotationRevision = 0, annotations = [], conflict = false;
    let events = Array.from({ length: 65 }, (_, index) => ({ id: `event-${index}`, time: 1700000000 - index,
        peer_id: index + 1, address: `203.0.113.${index + 1}`, kind: index % 2 ? 'failed' : 'would_disconnect', reason: `Decision ${index}` }));
    const snapshot = () => ({ available: true, config: { mode: 'preview', listener_allowance: 0, keep_addresses: [host] }, revision: 5,
        effective_state: 'preview', reason: 'Preview only; no node changes.', preview_remaining_seconds: 900, next_action_at: null,
        counts: { inbound: 1, candidates: 0, exempt: 1 }, limits: { grace_seconds: 3600, observation_seconds: 1800, attempt_interval_seconds: 300, max_attempts_per_hour: 6,
            address_cooldown_seconds: 1800, min_total_peers: 12, min_outbound_peers: 4 }, peers: [], as_diversity_available: false,
        proposal: { conditional: true, planned: 0, retained: 0, blocked: 0, entries: [] }, events,
        results: { window_seconds: 604800, accepted_requests: 0, observed_departures: 0, same_host_returns: 0 } });
    async function context() {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
        await context.route('**/api/saved-views', async route => {
            if (route.request().method() === 'POST') {
                const body = route.request().postDataJSON(); viewWrites.push(body);
                if (conflict) { conflict = false; revision++; await route.fulfill({ status: 409, json: { detail: 'Changed elsewhere.' } }); return; }
                assert.equal(body.expected_revision, revision);
                if (body.operation === 'create') views.push({ id: `view-${viewWrites.length}`, name: body.name, kind: body.kind, state: structuredClone(body.state) });
                else if (body.operation === 'delete') views = views.filter(view => view.id !== body.id);
                else views = views.map(view => view.id === body.id ? { ...view, ...(body.operation === 'rename' ? { name: body.name } : { state: structuredClone(body.state) }) } : view);
                revision++;
            }
            await route.fulfill({ json: { revision, views } });
        });
        await context.route('**/api/peer-policy/annotations', async route => {
            if (route.request().method() === 'POST') {
                const body = route.request().postDataJSON(); annotationWrites.push(body); assert.equal(body.expected_revision, annotationRevision);
                annotations = [{ address: body.address, label: body.label, note: body.note }]; annotationRevision++;
            }
            await route.fulfill({ json: { revision: annotationRevision, annotations } });
        });
        await context.route('**/api/peer-policy/status', route => route.fulfill({ json: { available: true, revision: 5, mode: 'preview', effective_state: 'preview', reason: 'Preview only.' } }));
        await context.route('**/api/peer-policy', route => {
            if (route.request().method() === 'POST') policyWrites.push(route.request().postDataJSON());
            return route.fulfill({ json: snapshot() });
        });
        return context;
    }
    async function unlock(page) {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.locator('#peer-tbody tr[data-id]').first().waitFor();
        await page.locator('#btn-inbound-policy').click();
        await page.locator('#admin-token-input').fill(admin); await page.locator('#admin-token-submit').click();
        await page.waitForFunction(() => document.getElementById('peer-policy-status')?.textContent.includes('Preview only'));
    }
    const first = await context();
    let second;
    try {
        const page = await first.newPage(); page.on('pageerror', error => errors.push(error.message));
        await unlock(page);
        assert.equal(await page.locator('.peer-policy-event').count(), 0, 'inactive Activity is not rendered');
        await page.locator('#peer-policy-tab-activity').click();
        assert.equal(await page.locator('.peer-policy-event').count(), 20, 'activity mounts only one page');
        await page.locator('#peer-policy-activity-next').click();
        const firstOlder = await page.locator('.peer-policy-event').first().textContent();
        events = [{ ...events[0], id: 'new-event', reason: 'New decision' }, ...events];
        await page.locator('#peer-policy-refresh').click();
        await page.waitForFunction(() => !document.getElementById('peer-policy-refresh').disabled);
        assert.equal(await page.locator('.peer-policy-event').first().textContent(), firstOlder, 'new decisions do not shift an older page');
        await page.locator('#peer-policy-activity-new').click();
        assert.match(await page.locator('.peer-policy-event').first().textContent(), /New decision/);
        await page.locator('#peer-policy-activity-kind').selectOption('failed');
        assert.ok((await page.locator('.peer-policy-event strong').allTextContents()).every(text => text === 'Request failed'));
        await page.locator('#peer-policy-tab-settings').click();
        await page.locator('[data-policy-action="annotation"]').waitFor();
        await page.waitForFunction(() => !document.querySelector('[data-policy-action="annotation"]').disabled);
        await page.locator('[data-policy-action="annotation"]').click();
        await page.locator('#peer-policy-annotation-label').fill('My wallet <img src=x>');
        await page.locator('#peer-policy-annotation-note').fill('Kept for my remote wallet.');
        await page.locator('#peer-policy-annotation-form button[type="submit"]').click();
        await page.waitForFunction(() => document.getElementById('peer-policy-annotation-result')?.textContent.includes('Name and note saved'));
        assert.equal(annotationWrites.length, 1);
        assert.equal(policyWrites.length, 0, 'note changes never post policy configuration');
        assert.equal(await page.locator('#peer-policy-kept img').count(), 0);
        assert.match(await page.locator('#peer-policy-kept').textContent(), /My wallet <img src=x>/);
        await page.locator('#peer-policy-tab-overview').click();
        assert.match(await page.locator('#peer-policy-readiness').textContent(), /15m/);
        await page.keyboard.press('Escape');

        await page.locator('#peer-search').fill('OUT');
        await page.locator('#btn-saved-views').click();
        await page.locator('#saved-view-name').fill('Outbound peers');
        await page.locator('#saved-view-create').click();
        await page.waitForFunction(() => document.querySelectorAll('.saved-view-row').length === 1);
        assert.equal(views[0].state.query, 'OUT');
        assert.ok(!JSON.stringify(views[0]).includes('peer_ids'), 'views contain semantic state rather than peer IDs');
        await page.keyboard.press('Escape');
        await page.locator('#peer-search').fill('');
        await page.locator('#btn-saved-views').click();
        await page.locator('[data-view-action="apply"]').click();
        await page.locator('#saved-views-modal').waitFor({ state: 'detached' });
        assert.equal(await page.locator('#peer-search').inputValue(), 'OUT');

        views[0].state.columns.push('obsolete_column');
        await page.locator('#btn-saved-views').click();
        await page.locator('[data-view-action="apply"]').click();
        await page.waitForFunction(() => document.getElementById('saved-view-result')?.textContent.includes('obsolete_column'));
        assert.equal(await page.locator('#peer-search').inputValue(), 'OUT', 'supported view state still applies with a removed-column notice');
        await page.keyboard.press('Escape');
        views[0].state.columns = views[0].state.columns.filter(key => key !== 'obsolete_column');

        second = await context();
        const other = await second.newPage(); other.on('pageerror', error => errors.push(error.message));
        await unlock(other); await other.keyboard.press('Escape');
        await other.locator('#btn-saved-views').click();
        await other.locator('.saved-view-row').waitFor();
        assert.match(await other.locator('.saved-view-row').textContent(), /Outbound peers/, 'a different browser context reads the shared view');
        await other.locator('[data-view-action="rename"]').click();
        await other.locator('#saved-view-rename-input').fill('Shared outbound view');
        await other.locator('#saved-view-rename-form button').click();
        await other.locator('#saved-view-rename').waitFor({ state: 'detached' });
        assert.equal(views[0].name, 'Shared outbound view');
        conflict = true;
        const beforeConflict = viewWrites.length;
        await other.locator('[data-view-action="update"]').click();
        await other.waitForFunction(() => document.getElementById('saved-view-result')?.textContent.includes('changed in another browser'));
        assert.equal(viewWrites.length, beforeConflict + 1, 'conflicts reload without replaying an edit');
        await other.setViewportSize({ width: 320, height: 740 });
        assert.equal(await other.locator('#saved-views-modal [role="dialog"]').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
        await other.keyboard.press('Escape');
        await second.close(); second = null;

        await page.locator('#btn-inbound-policy').click();
        await page.locator('#peer-policy-tab-connections').click();
        await page.locator('#peer-policy-search').fill('Wallet');
        await page.locator('#peer-policy-filter-status').selectOption('observing');
        // A saved filter retains a network even when no peers currently use it.
        await page.evaluate(() => {
            const select = document.getElementById('peer-policy-filter-network');
            select.add(new Option('onion', 'onion')); select.value = 'onion'; select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.locator('#peer-policy-saved-views').click();
        await page.locator('#saved-view-name').fill('Wallet listeners');
        await page.locator('#saved-view-create').click();
        await page.waitForFunction(() => document.querySelectorAll('.saved-view-row').length === 1);
        const policyView = views.find(view => view.kind === 'policy');
        assert.deepEqual(policyView.state, { query: 'Wallet', status: 'observing', network: 'onion', page_size: 10 });
        assert.equal(policyWrites.length, 0);
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        await page.locator('#btn-saved-views').click();
        await page.locator('#saved-view-kind').selectOption('policy');
        await page.locator('[data-view-action="apply"]').click();
        await page.locator('#saved-views-modal').waitFor({ state: 'detached' });
        assert.equal(await page.locator('#peer-policy-tab-connections').getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('#peer-policy-search').inputValue(), 'Wallet');
        assert.equal(await page.locator('#peer-policy-filter-network').inputValue(), 'onion');
        assert.equal(policyWrites.length, 0, 'applying a policy view never posts policy configuration');
        await page.keyboard.press('Escape');
        await page.locator('#btn-saved-views').click();
        await page.locator('#saved-view-list').waitFor();
        await page.locator('#admin-lock').evaluate(button => button.click());
        await page.locator('#saved-views-modal').waitFor({ state: 'detached' });
        assert.equal(await page.locator('#btn-saved-views').isVisible(), false);
        assert.equal(await page.locator('body').evaluate(element => element.textContent.includes('Shared outbound view')), false);
        assert.deepEqual(errors, []);
    } finally { if (second) await second.close(); await first.close(); }
}
