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
    let reads = 0, revision = 0, remaining = 1800, conflict = false, rejectAutomatic = false;
    let hold = false, releaseRead = null;
    let config = { mode: 'off', listener_allowance: 0, keep_addresses: [] };
    const host = '198.51.100.8';
    const malicious = '<img src=x onerror="window.policyInjection=true">';
    function snapshot() {
        const kept = config.keep_addresses.includes(host);
        return { available: true, config: structuredClone(config), revision,
            effective_state: config.mode === 'off' ? 'disabled' : config.mode === 'automatic' ? 'running' : 'preview',
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
            ],
            events: config.mode === 'off' ? [] : [{ id: 'synthetic-event', time: 1700000000, peer_id: 104, address: '203.0.113.12:45004', kind: 'uncertain', reason: 'RPC timed out; no retry was sent.' }],
        };
    }
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    await page.route('**/api/admin/verify', async route => {
        const headers = { ...route.request().headers() };
        delete headers['x-bpm-remember'];
        await route.continue({ headers });
    });
    await page.route('**/api/peer-policy', async route => {
        assert.equal(route.request().headers().authorization, `Bearer ${admin}`, 'every policy read/write requires management access');
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
        await page.locator('#btn-inbound-policy').click();
        await page.locator('#admin-token-input').waitFor({ state: 'visible' });
        assert.equal(reads, 0, 'private policy data is not fetched before explicit unlock');
        await page.locator('#admin-token-input').fill(admin);
        await page.locator('#admin-token-submit').click();
        await page.locator('#peer-policy-mode-off').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.peer-policy-intro').count(), 0, 'the redundant introductory line is removed');
        await page.waitForFunction(() => !document.getElementById('peer-policy-mode-preview')?.disabled);
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
        await page.waitForFunction(() => document.getElementById('peer-policy-allowance')?.value === '5');
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

        // A late response cannot recreate private content after management ends.
        await page.setViewportSize({ width: 1440, height: 1000 });
        hold = true;
        const beforeHold = reads;
        await page.locator('#btn-inbound-policy').click();
        await page.waitForFunction(() => document.getElementById('peer-policy-status')?.textContent.includes('Loading'));
        for (let i = 0; i < 30 && reads === beforeHold; i++) await page.waitForTimeout(10);
        assert.ok(reads > beforeHold);
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.locator('#peer-policy-modal').waitFor({ state: 'detached' });
        releaseRead?.();
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#peer-policy-modal').count(), 0);
        assert.equal(await page.locator('body').evaluate(element => element.textContent.includes('Only keepalive and address traffic.')), false);
        assert.deepEqual(errors, []);
    } finally {
        releaseRead?.();
        await context.close();
    }
}
