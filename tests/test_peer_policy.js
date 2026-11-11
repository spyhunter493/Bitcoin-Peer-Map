import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Exercise the administrator panel against synthetic policy state. No node
 * mutation endpoints are used by this suite. */
export default async function assertPeerPolicy(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const admin = 'bpm-test-admin-token-'.padEnd(64, 'x');
    const errors = [], writes = [];
    let reads = 0, statusReads = 0, revision = 0, remaining = 1800, conflict = false, rejectAutomatic = false;
    let extraPeers = [], extraProposal = [], statusError = false, holdStatus = false, releaseStatus = null;
    let forcedState = null;
    let hold = false, releaseRead = null;
    let config = { mode: 'off', listener_allowance: 0, keep_addresses: [] };
    const host = '198.51.100.8';
    const malicious = '<img src=x onerror="window.policyInjection=true">';
    function snapshot() {
        const kept = config.keep_addresses.includes(host);
        return { available: true, config: structuredClone(config), revision,
            effective_state: forcedState || (config.mode === 'off' ? 'disabled' : config.mode === 'automatic' ? 'running' : 'preview'),
            reason: config.mode === 'off' ? 'Policy is off.' : config.mode === 'automatic' ? 'Automatic cleanup is active.' : 'Preview only; no peers are disconnected.',
            preview_remaining_seconds: remaining, next_action_at: null,
            counts: { inbound: config.mode === 'off' ? 0 : 3, candidates: config.mode === 'off' || kept ? 0 : 1, exempt: kept ? 2 : 1 },
            limits: { grace_seconds: 3600, observation_seconds: 1800, attempt_interval_seconds: 300, max_attempts_per_hour: 6,
                address_cooldown_seconds: 1800, min_total_peers: 12, min_outbound_peers: 4 },
            as_diversity_available: false,
            peers: config.mode === 'off' ? [] : [
                { peer_id: 101, address: `${host}:45001`, host, network: 'ipv4', subver: `/Satoshi:29.3.0/Knots:20260508/${malicious}`, connection_age_seconds: 7200, observed_seconds: 1800, remaining_seconds: 0,
                    status: kept ? 'protected' : 'candidate', reason: kept ? 'Operator Keep exception.' : `Only keepalive and address traffic. ${malicious}` },
                { peer_id: 102, address: '203.0.113.10:45002', host: '203.0.113.10', network: 'ipv4', subver: null, connection_age_seconds: 7200, observed_seconds: 60, remaining_seconds: 1740,
                    status: 'protected', reason: 'Serving historical blocks.' },
                { peer_id: 103, address: '203.0.113.11:45003', host: '203.0.113.11', network: 'ipv4', subver: `/VeryLongSoftware:${'v'.repeat(480)}/`, connection_age_seconds: 60, observed_seconds: 60, remaining_seconds: 3540,
                    status: 'observing', reason: 'Connection grace has not elapsed.' },
                ...extraPeers,
            ],
            proposal: { conditional: true, planned: config.mode === 'off' ? 0 : (kept ? 0 : 1) + extraProposal.length, retained: 1, blocked: 1, entries: [
                { peer_id: 101, address: `${host}:45001`, action: kept ? 'retained' : 'planned', order: kept ? null : extraProposal.length ? 2 : 1, proposed_at: kept ? null : 1700000300, reason: kept ? 'Operator Keep exception.' : 'Conditional on fresh evidence and safety checks.' },
                ...extraProposal,
            ] },
            results: { window_seconds: 604800, accepted_requests: 4, observed_departures: 3, same_host_returns: 2 },
            events: config.mode === 'off' ? [] : [{ id: 'synthetic-event', time: 1700000000, peer_id: 104, address: '203.0.113.12:45004', kind: 'uncertain', reason: 'RPC timed out; no retry was sent.' }],
        };
    }
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    async function assertAdministrator(route) {
        const headers = await route.request().allHeaders();
        let valid = Boolean(headers.authorization === `Bearer ${admin}` || (!headers.authorization && headers.cookie));
        // WebKit can omit HttpOnly cookies from intercepted metadata even though
        // the server receives them. Verify remembered authority against the real
        // protected endpoint; never accept a wrong explicit bearer or anonymous jar.
        if (!valid && !headers.authorization && browser.browserType().name() === 'webkit' &&
            (await context.cookies(route.request().url())).some(cookie => cookie.name === 'bpm_admin_session')) {
            const probe = await context.request.get(baseUrl + '/api/peer-policy/status');
            valid = probe.status() === 200 && probe.headers()['cache-control'] === 'private, no-store';
            await probe.dispose();
        }
        const diagnostic = valid ? '' : JSON.stringify({ path: new URL(route.request().url()).pathname,
            method: route.request().method(), failure: route.request().failure()?.errorText || null,
            hasAuthorizationHeader: Boolean(headers.authorization), hasCookieHeader: Boolean(headers.cookie),
            contextCookieNames: (await context.cookies(route.request().url())).map(cookie => cookie.name) });
        assert.ok(valid, `policy reads/writes use the management bearer or remembered cookie: ${diagnostic}`);
    }
    await page.route('**/api/peer-policy/status', async route => {
        await assertAdministrator(route);
        statusReads++;
        const current = snapshot();
        if (holdStatus) await new Promise(resolve => { releaseStatus = resolve; });
        try {
            await route.fulfill(statusError ? { status: 503, json: { detail: 'Status unavailable.' } } : { json: {
                available: current.available, revision: current.revision, mode: current.config.mode, effective_state: current.effective_state, reason: current.reason,
            } });
        } catch { /* A locked management generation aborts status reads. */ }
    });
    await page.route('**/api/peer-policy', async route => {
        await assertAdministrator(route);
        if (route.request().method() === 'GET') {
            reads++;
            const response = snapshot();
            if (hold) await new Promise(resolve => { releaseRead = resolve; });
            try { await route.fulfill({ json: response }); } catch { /* Expected when the dialog aborts an old generation. */ }
            return;
        }
        const body = route.request().postDataJSON();
        writes.push(body);
        assert.deepEqual(Object.keys(body).sort(), ['config', 'expected_revision']);
        assert.deepEqual(Object.keys(body.config).sort(), ['keep_addresses', 'listener_allowance', 'mode']);
        assert.equal(body.expected_revision, revision);
        if (conflict) {
            conflict = false; revision++; config.listener_allowance = 5;
            await route.fulfill({ status: 409, json: { detail: 'Policy settings changed in another browser.', code: 'peer_policy_conflict' } });
            return;
        }
        if (rejectAutomatic && body.config.mode === 'automatic') {
            rejectAutomatic = false; remaining = 1800;
            await route.fulfill({ status: 409, json: { detail: 'Complete a fresh Preview trial before enabling Automatic.', code: 'peer_policy_preview_required' } });
            return;
        }
        config = structuredClone(body.config); revision++;
        await route.fulfill({ json: snapshot() });
    });

    async function waitSaved() {
        await page.waitForFunction(() => document.getElementById('peer-policy-result')?.textContent === 'Policy settings saved.');
    }

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#peer-tbody tr[data-id]');
        assert.equal(reads, 0, 'ordinary monitoring makes no policy reads');
        assert.equal(await page.locator('#peer-policy-toolbar').isVisible(), false);
        assert.equal(statusReads, 0, 'locked viewers do not poll private policy status');
        await page.locator('#btn-inbound-policy').click();
        await page.locator('#admin-token-input').waitFor({ state: 'visible' });
        assert.equal(reads, 0, 'private policy data is not fetched before explicit unlock');
        await page.locator('#admin-token-input').fill(admin);
        await page.locator('#admin-token-submit').click();
        await page.locator('#peer-policy-mode-off').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.peer-policy-intro').count(), 0, 'the redundant introductory line is removed');
        await page.waitForFunction(() => !document.getElementById('peer-policy-mode-preview')?.disabled);
        await page.waitForFunction(() => document.getElementById('peer-policy-badge')?.textContent === 'Off · disabled');
        assert.equal(await page.locator('#peer-policy-toolbar').isVisible(), true);
        assert.equal(await page.locator('#peer-policy-mode-off').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('#peer-policy-mode-automatic').isDisabled(), true);
        await page.locator('#peer-policy-mode-preview').click();
        await waitSaved();
        assert.equal(config.mode, 'preview');
        assert.equal(await page.locator('#peer-policy-mode-preview').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('#peer-policy-mode-off').getAttribute('aria-pressed'), 'false');
        assert.equal(await page.locator('#peer-policy-mode-automatic').isDisabled(), true);
        assert.match(await page.locator('#peer-policy-readiness').textContent(), /no changes to your node/);
        assert.equal(await page.locator('#peer-policy-peers img').count(), 0, 'peer-supplied text is escaped');
        assert.match(await page.locator('#peer-policy-peers').textContent(), /<img src=x/);
        assert.match(await page.locator('#peer-policy-peers').textContent(), /Serving historical blocks/);
        assert.equal(await page.locator('.peer-policy-card[data-status="candidate"] .peer-policy-software').textContent(),
            `Software: /Satoshi:29.3.0/Knots:20260508/${malicious}`, 'the card shows the escaped software version reported by this peer');
        assert.equal(await page.locator('.peer-policy-card[data-status="protected"] .peer-policy-software').textContent(), 'Software: Unknown');
        assert.match(await page.locator('#peer-policy-events').textContent(), /Outcome uncertain/);
        assert.match(await page.locator('#peer-policy-proposal').textContent(), /1 planned, 1 retained, 1 blocked/);
        assert.match(await page.locator('#peer-policy-peers').textContent(), /Planned #1/);
        assert.match(await page.locator('#peer-policy-results').textContent(), /4 accepted requests; 3 observed departures; 2 same-address returns/);
        await page.locator('#peer-policy-modal').click({ position: { x: 3, y: 3 } });
        assert.equal(await page.locator('#peer-policy-modal').isVisible(), true, 'outside clicks keep the policy panel open');
        await page.locator('#peer-policy-allowance').fill('7');
        const card = await page.locator('.peer-policy-card').first().elementHandle();
        await page.locator('#peer-policy-refresh').click();
        await page.waitForFunction(() => !document.getElementById('peer-policy-refresh')?.disabled);
        assert.equal(await card.evaluate(element => element.isConnected), true, 'unchanged refreshes preserve existing card DOM');
        assert.equal(await page.locator('#peer-policy-allowance').inputValue(), '7');
        const details = page.locator('.peer-policy-card').first().locator('details');
        await details.locator('summary').click();
        assert.match(await details.textContent(), /Quiet observation \/ required/);
        await page.locator('#peer-policy-refresh').click();
        await page.waitForFunction(() => !document.getElementById('peer-policy-refresh')?.disabled);
        assert.equal(await details.getAttribute('open'), '', 'expanded decision evidence survives polling');
        await page.locator(`[data-policy-action="keep"][data-address="${host}"]`).click();
        await waitSaved();
        assert.equal(await page.locator('#peer-policy-allowance').inputValue(), '7', 'saving Keep preserves the unsaved allowance draft');
        assert.equal(config.listener_allowance, 0, 'Keep does not implicitly save the allowance');
        assert.equal(await page.locator(`[data-policy-action="remove"][data-address="${host}"]`).evaluate(element => element === document.activeElement), true, 'focus moves to the matching exception control');
        await page.locator(`[data-policy-action="remove"][data-address="${host}"]`).click();
        await waitSaved();
        if (process.env.BPM_PEER_POLICY_ARTIFACT_DIR) {
            await mkdir(process.env.BPM_PEER_POLICY_ARTIFACT_DIR, { recursive: true });
            const candidateReason = page.locator('.peer-policy-card[data-status="candidate"] > p:not(.peer-policy-software)').first();
            const originalReason = await candidateReason.textContent();
            await candidateReason.evaluate(element => { element.textContent = 'Only keepalive and address traffic observed during the quiet window.'; });
            await page.screenshot({ path: join(process.env.BPM_PEER_POLICY_ARTIFACT_DIR, 'inbound-policy-preview.png') });
            await candidateReason.evaluate((element, text) => { element.textContent = text; }, originalReason);
        }

        await page.locator('#peer-policy-allowance').fill('1');
        await page.locator('#peer-policy-allowance-save').click();
        await waitSaved();
        assert.equal(config.listener_allowance, 1);

        // A poll captured before a successful save must not restore its old
        // settings when that delayed response finally arrives.
        hold = true;
        await page.locator('#peer-policy-refresh').click();
        for (let i = 0; i < 30 && releaseRead === null; i++) await page.waitForTimeout(10);
        assert.ok(releaseRead);
        await page.locator('#peer-policy-allowance').fill('4');
        await page.locator('#peer-policy-allowance-save').click();
        await waitSaved();
        hold = false;
        releaseRead(); releaseRead = null;
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#peer-policy-allowance').inputValue(), '4', 'an old poll cannot overwrite the saved allowance');

        await page.locator(`[data-policy-action="keep"][data-address="${host}"]`).click();
        await waitSaved();
        assert.deepEqual(config.keep_addresses, [host]);
        assert.match(await page.locator('#peer-policy-kept').textContent(), /198\.51\.100\.8/);
        await page.locator(`[data-policy-action="remove"][data-address="${host}"]`).click();
        await waitSaved();
        assert.deepEqual(config.keep_addresses, []);
        await page.locator('#peer-policy-keep-address').fill('2001:db8::5');
        await page.locator('#peer-policy-keep-add').click();
        await waitSaved();
        assert.deepEqual(config.keep_addresses, ['2001:db8::5']);

        conflict = true;
        const beforeConflict = writes.length;
        await page.locator('#peer-policy-allowance').fill('2');
        await page.locator('#peer-policy-allowance-save').click();
        await page.waitForFunction(() => document.getElementById('peer-policy-result')?.textContent.includes('Settings changed in another browser'));
        assert.equal(await page.locator('#peer-policy-allowance').inputValue(), '2', 'conflict refresh preserves the operator draft for review');
        assert.equal(config.listener_allowance, 5);
        assert.equal(writes.length, beforeConflict + 1, 'revision conflict refreshes without replaying the change');

        remaining = 0;
        await page.locator('#peer-policy-refresh').click();
        await page.waitForFunction(() => !document.getElementById('peer-policy-mode-automatic')?.disabled);
        const beforeAutomatic = writes.length;
        await page.locator('#peer-policy-mode-automatic').click();
        await page.locator('#peer-policy-confirm').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#peer-policy-confirm-enable').isDisabled(), true);
        assert.match(await page.locator('#peer-policy-confirm').textContent(), /quiet wallets/);
        assert.match(await page.locator('#peer-policy-confirm').textContent(), /browser is closed/);
        await page.locator('#peer-policy-confirm-cancel').click();
        assert.equal(writes.length, beforeAutomatic, 'cancelled activation never saves Automatic');
        await page.locator('#peer-policy-mode-automatic').click();
        await page.locator('#peer-policy-confirm-ack').check();
        rejectAutomatic = true;
        await page.locator('#peer-policy-confirm-enable').click();
        await page.waitForFunction(() => document.getElementById('peer-policy-result')?.textContent.includes('Complete a fresh Preview trial'));
        assert.equal(config.mode, 'preview');
        assert.equal(writes.length, beforeAutomatic + 1, 'lost Preview readiness rejects activation without replay');
        assert.equal(await page.locator('#peer-policy-mode-automatic').isDisabled(), true);
        remaining = 0;
        await page.locator('#peer-policy-refresh').click();
        await page.waitForFunction(() => !document.getElementById('peer-policy-mode-automatic')?.disabled);
        await page.locator('#peer-policy-mode-automatic').click();
        await page.locator('#peer-policy-confirm-ack').check();
        await page.locator('#peer-policy-confirm-enable').click();
        await waitSaved();
        assert.equal(config.mode, 'automatic');
        await page.locator('#peer-policy-mode-off').click();
        await waitSaved();
        assert.equal(config.mode, 'off');

        await page.setViewportSize({ width: 390, height: 780 });
        const geometry = await page.locator('#peer-policy-modal .modal-box').evaluate(box => ({
            left: box.getBoundingClientRect().left, right: box.getBoundingClientRect().right,
            width: window.innerWidth, overflow: box.scrollWidth > box.clientWidth + 1,
        }));
        assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && !geometry.overflow, 'policy dialog fits narrow screens');
        await page.locator('#peer-policy-mode-preview').click();
        await waitSaved();
        const softwareGeometry = await page.locator('.peer-policy-card[data-status="observing"] .peer-policy-software').evaluate(label => ({
            clientWidth: label.clientWidth, scrollWidth: label.scrollWidth,
        }));
        assert.ok(softwareGeometry.scrollWidth <= softwareGeometry.clientWidth, 'long reported software versions wrap within narrow cards');
        if (process.env.BPM_PEER_POLICY_ARTIFACT_DIR) await page.screenshot({ path: join(process.env.BPM_PEER_POLICY_ARTIFACT_DIR, 'inbound-policy-narrow.png') });
        await page.keyboard.press('Escape');
        await page.locator('#peer-policy-modal').waitFor({ state: 'detached' });
        assert.equal(await page.locator('#btn-inbound-policy').evaluate(element => document.activeElement === element), true);

        // Ordinary shared modals retain their default backdrop behavior.
        await page.locator('#btn-bans').click();
        await page.locator('#ban-modal').waitFor({ state: 'visible' });
        await page.locator('#ban-modal').click({ position: { x: 3, y: 3 } });
        await page.locator('#ban-modal').waitFor({ state: 'detached' });

        // The unlocked status row fits beside the existing dashboard at common widths.
        for (const width of [1280, 1366, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            const geometry = await page.locator('#peer-policy-toolbar').evaluate(row => {
                const box = row.getBoundingClientRect();
                return { left: box.left, right: box.right, viewport: innerWidth, overflow: row.scrollWidth > row.clientWidth + 1,
                    buttons: [...row.querySelectorAll('button')].map(button => ({ left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right })) };
            });
            assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport && !geometry.overflow, `unlocked policy toolbar fits ${width}px`);
            assert.ok(geometry.buttons.every(button => button.left >= geometry.left && button.right <= geometry.right), 'Quick Off remains fully visible');
        }

        // Every observed connection remains reachable, including beyond the old cap.
        extraPeers = Array.from({ length: 122 }, (_, index) => ({
            peer_id: 200 + index, address: `198.51.100.${index + 20}:45000`, host: `198.51.100.${index + 20}`,
            network: index % 2 ? 'onion' : 'ipv4', subver: `/PagingSoftware:${index}/`, connection_age_seconds: 7200,
            observed_seconds: 1800, remaining_seconds: 0, status: 'candidate', reason: 'Synthetic listener evidence.',
        }));
        extraProposal = [{ peer_id: extraPeers.at(-1).peer_id, address: extraPeers.at(-1).address,
            action: 'planned', order: 1, proposed_at: 1700000000, reason: 'First proposed removal despite its position in the RPC response.' }];
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.locator('#btn-inbound-policy').click();
        await page.waitForFunction(() => document.querySelectorAll('.peer-policy-card').length === 10);
        assert.equal(await page.locator('#peer-policy-page-size').inputValue(), '10');
        assert.match(await page.locator('.peer-policy-card').first().textContent(), /PagingSoftware:121/,
            'the first proposed removal is visible first even when it arrived last in the peer response');
        assert.match(await page.locator('#peer-policy-page-count').textContent(), /1–10 of 125/);
        await page.locator('#peer-policy-page-next').click();
        assert.match(await page.locator('#peer-policy-page-count').textContent(), /11–20 of 125/);
        await page.locator('#peer-policy-page-size').selectOption('20');
        assert.equal(await page.locator('.peer-policy-card').count(), 20);
        assert.match(await page.locator('#peer-policy-page-count').textContent(), /1–20 of 125/);
        await page.locator('#peer-policy-page-size').selectOption('all');
        assert.equal(await page.locator('.peer-policy-card').count(), 125);
        await page.locator('#peer-policy-search').fill('PagingSoftware:121');
        assert.equal(await page.locator('.peer-policy-card').count(), 1, 'software search reaches peers beyond the old 100-card cap');
        await page.locator('#peer-policy-search').fill('');
        await page.locator('#peer-policy-filter-network').selectOption('onion');
        assert.equal(await page.locator('.peer-policy-card').count(), 61);
        await page.locator('#peer-policy-filter-status').selectOption('protected');
        assert.equal(await page.locator('.peer-policy-card').count(), 0);
        assert.match(await page.locator('#peer-policy-page-count').textContent(), /0 matching connections/);
        await page.locator('#peer-policy-filter-network').selectOption('');
        assert.equal(await page.locator('.peer-policy-card').count(), 1);
        await page.locator('#peer-policy-filter-status').selectOption('');
        await page.locator('#peer-policy-page-size').selectOption('10');
        for (let index = 0; index < 12; index++) await page.locator('#peer-policy-page-next').click();
        assert.equal(await page.locator('.peer-policy-card').count(), 5);
        assert.equal(await page.locator('#peer-policy-page-next').isDisabled(), true);
        extraPeers = [];
        await page.locator('#peer-policy-refresh').click();
        await page.waitForFunction(() => document.querySelectorAll('.peer-policy-card').length === 3);
        assert.match(await page.locator('#peer-policy-page-count').textContent(), /1–3 of 3/, 'a smaller refreshed list clamps the current page');

        // Blur suspends private reads, preserves the shell/draft, and revalidates on return.
        await page.locator('#peer-policy-allowance').fill('9');
        hold = true;
        await page.locator('#peer-policy-refresh').click();
        for (let i = 0; i < 30 && releaseRead === null; i++) await page.waitForTimeout(10);
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        assert.equal(await page.locator('#peer-policy-modal').isVisible(), true, 'blur keeps the panel shell open');
        assert.equal(await page.locator('#peer-policy-allowance').inputValue(), '9');
        assert.equal(await page.locator('#peer-policy-allowance').isDisabled(), true);
        assert.equal(await page.locator('.peer-policy-card').count(), 0, 'suspension clears private evidence');
        assert.equal(await page.locator('#peer-policy-toolbar').isVisible(), false);
        releaseRead?.(); releaseRead = null; hold = false;
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.waitForFunction(() => !document.getElementById('peer-policy-allowance')?.disabled);
        assert.equal(await page.locator('#peer-policy-allowance').inputValue(), '9', 'revalidation preserves the unsaved draft');
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        assert.equal(await page.locator('#peer-policy-modal').isVisible(), true, 'hiding the tab preserves the panel shell');
        assert.equal(await page.locator('#peer-policy-allowance').inputValue(), '9');
        assert.equal(await page.locator('.peer-policy-card').count(), 0);
        await page.evaluate(() => {
            delete document.hidden;
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForFunction(() => !document.getElementById('peer-policy-allowance')?.disabled);
        assert.equal(await page.locator('#peer-policy-allowance').inputValue(), '9');
        await page.locator('#peer-policy-modal-close').click();

        // A late compact read cannot replace newer full evidence at the same revision.
        holdStatus = true;
        await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
        for (let i = 0; i < 50 && releaseStatus === null; i++) await page.waitForTimeout(10);
        assert.ok(releaseStatus);
        forcedState = 'paused';
        await page.locator('#btn-inbound-policy').click();
        await page.waitForFunction(() => document.getElementById('peer-policy-badge')?.textContent === 'Preview · paused');
        releaseStatus(); releaseStatus = null; holdStatus = false;
        const compactReadsWhileOpen = statusReads, fullReadsWhileOpen = reads;
        await page.waitForTimeout(10_100);
        assert.equal(statusReads, compactReadsWhileOpen, 'open-panel polling never requests redundant compact status');
        assert.ok(reads > fullReadsWhileOpen, 'the full snapshot poll owns status while the panel is open');
        assert.equal(await page.locator('#peer-policy-badge').textContent(), 'Preview · paused');
        forcedState = null;
        await page.locator('#peer-policy-modal-close').click();

        // The compact badge remains live with the panel closed and Quick Off reads a fresh revision.
        await page.waitForFunction(() => document.getElementById('peer-policy-badge')?.textContent.startsWith('Preview'));
        const fullReadsBeforeStatus = reads, statusBefore = statusReads;
        statusError = true;
        await page.waitForFunction(() => document.getElementById('peer-policy-badge')?.textContent === 'Policy status unknown', null, { timeout: 15000 });
        assert.ok(statusReads > statusBefore);
        assert.equal(reads, fullReadsBeforeStatus, 'closed-panel polling uses only compact status');
        statusError = false;
        const beforeQuickOff = writes.length;
        conflict = true;
        await page.locator('#peer-policy-quick-off').click();
        await page.waitForFunction(() => !document.getElementById('peer-policy-quick-off')?.disabled);
        assert.equal(writes.length, beforeQuickOff + 1, 'Quick Off does not replay a conflicting mutation');
        assert.equal(config.mode, 'preview');
        await page.locator('#peer-policy-quick-off').click();
        await page.waitForFunction(() => document.getElementById('peer-policy-badge')?.textContent === 'Off · disabled');
        assert.equal(reads, fullReadsBeforeStatus + 2, 'each explicit Quick Off reads current settings before its revision-checked save');
        assert.equal(writes.length, beforeQuickOff + 2);
        assert.equal(config.mode, 'off');

        // Explicit locking removes the shell and rejects late private reads.
        hold = true; holdStatus = true;
        await page.locator('#btn-inbound-policy').click();
        for (let i = 0; i < 30 && releaseRead === null; i++) await page.waitForTimeout(10);
        await page.locator('#admin-lock').evaluate(element => element.click());
        await page.locator('#peer-policy-modal').waitFor({ state: 'detached' });
        releaseRead?.(); releaseRead = null; releaseStatus?.(); releaseStatus = null;
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#peer-policy-toolbar').isVisible(), false);
        assert.equal(await page.locator('#peer-policy-badge').textContent(), 'Policy status unknown');
        assert.equal(await page.locator('#peer-policy-modal').count(), 0);
        assert.equal(await page.locator('body').evaluate(element => element.textContent.includes('Only keepalive and address traffic.')), false);
        assert.deepEqual(errors, []);
    } finally {
        releaseRead?.(); releaseStatus?.();
        await context.close();
    }
}
