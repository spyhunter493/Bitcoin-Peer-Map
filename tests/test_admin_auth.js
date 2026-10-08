import assert from 'node:assert/strict';
import { FIXTURE_ADMIN_TOKEN } from './layout_server.ts';

export default async function assertAdminAuthentication(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    const page = await context.newPage();
    const errors = [], completed = [];
    let rotated = false, actionCooldown = false, anonymousCooldown = true, unrelatedCooldown = false, verificationCooldown = false, verificationRequests = 0;
    let anonymousCooldownSeconds = 60;
    let verificationCooldownSeconds = 60;
    let verificationGate = Promise.resolve();
    const replacement = 'replacement-browser-token-'.padEnd(64, 'y');
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    await page.route('**/api/peer/**', async route => {
        const request = route.request();
        const authorization = request.headers().authorization;
        const valid = authorization === `Bearer ${rotated ? replacement : FIXTURE_ADMIN_TOKEN}`;
        if (unrelatedCooldown) {
            await route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { detail: 'Upstream cooldown active.', code: 'upstream_rate_limited' } });
            return;
        }
        if (actionCooldown || (anonymousCooldown && !valid)) {
            await route.fulfill({ status: 429, headers: { 'Retry-After': String(anonymousCooldownSeconds) }, json: { detail: 'Authentication cooldown active.', code: 'admin_rate_limited' } });
            return;
        }
        if (rotated) {
            if (valid) completed.push({ path: new URL(request.url()).pathname, body: request.postDataJSON(), authorization });
            await route.fulfill({ status: valid ? 200 : 401, json: valid ? { success: true, address: request.postDataJSON()?.address } : { detail: 'Enter the admin token', code: 'admin_required' } });
        } else {
            const response = await route.fetch();
            if (response.status() === 200) completed.push({ path: new URL(request.url()).pathname, body: request.postDataJSON(), authorization });
            await route.fulfill({ response });
        }
    });
    await page.route('**/api/admin/verify', async route => {
        verificationRequests++;
        await verificationGate;
        const valid = route.request().headers().authorization === `Bearer ${replacement}`;
        if (verificationCooldown && !valid) {
            await route.fulfill({ status: 429, headers: { 'Retry-After': String(verificationCooldownSeconds) }, json: { detail: 'Authentication cooldown active.', code: 'admin_rate_limited' } });
            return;
        }
        if (!rotated) { await route.continue(); return; }
        await route.fulfill({ status: valid ? 200 : 401, json: valid ? { success: true } : { detail: 'Enter the admin token', code: 'admin_required' } });
    });

    async function submitToken(value) {
        await page.locator('#admin-token-input').fill(value);
        await page.locator('#admin-token-submit').click();
    }
    async function requestConnection() {
        if (!(await page.locator('#connect-peer-modal').count())) await page.locator('#btn-connect-peer').click();
        await page.locator('#connect-addr-input').fill('8.8.8.8:8333');
        await page.locator('#connect-go-btn').click();
    }
    async function waitForPrompt() {
        await page.locator('#admin-token-input').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-token-input');
    }
    async function trackCooldownIntervals() {
        await page.evaluate(() => {
            window.cooldownIntervals = new Set();
            const schedule = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
            window.setInterval = (handler, ...args) => {
                const id = schedule(handler, ...args);
                if (handler.name === 'updateCooldown') window.cooldownIntervals.add(id);
                return id;
            };
            window.clearInterval = id => { window.cooldownIntervals.delete(id); clear(id); };
        });
    }

    try {
        await page.clock.install();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('mo-status')?.textContent === 'Synced');
        await trackCooldownIntervals();
        assert.equal(await page.locator('#admin-lock').isVisible(), false);
        await requestConnection();
        await waitForPrompt();
        assert.equal(await page.locator('#admin-token-modal [role="dialog"]').getAttribute('aria-modal'), 'true');
        const initialCooldown = await page.locator('#admin-token-error').textContent();
        const initialRemaining = Number(initialCooldown.match(/(\d+) seconds remaining/)?.[1]);
        assert.ok(initialRemaining > 0 && initialRemaining <= 60, 'the initial anonymous 429 immediately displays Retry-After without a verification request');
        assert.equal(verificationRequests, 0);
        assert.equal(await page.evaluate(() => window.cooldownIntervals.size), 1);
        await page.clock.fastForward(1000);
        const laterRemaining = Number((await page.locator('#admin-token-error').textContent()).match(/(\d+) seconds remaining/)?.[1]);
        assert.ok(laterRemaining < initialRemaining, 'the initial cooldown counts down');
        assert.equal(verificationRequests, 0, 'countdown updates never verify credentials automatically');

        // Another challenged action shares the prompt and can leave independently.
        anonymousCooldownSeconds = 90;
        await page.evaluate(async () => {
            const { postJson } = await import(new URL('./core/api.js', document.querySelector('script[type="module"]').src));
            window.initialCooldownWaiterController = new AbortController();
            window.initialCooldownWaiter = postJson('/api/peer/disconnect', { peer_id: 1 }, { signal: window.initialCooldownWaiterController.signal })
                .then(() => 'unexpected success', error => error.name);
        });
        await page.waitForFunction(() => Number(document.getElementById('admin-token-error')?.textContent.match(/(\d+) seconds remaining/)?.[1]) > 60);
        assert.equal(await page.locator('#admin-token-modal').count(), 1, 'concurrent waiters reuse one prompt');
        assert.equal(await page.evaluate(() => window.cooldownIntervals.size), 1, 'concurrent challenges reuse one countdown');
        await page.evaluate(() => window.initialCooldownWaiterController.abort());
        assert.equal(await page.evaluate(() => window.initialCooldownWaiter), 'AbortError');
        assert.equal(await page.locator('#admin-token-input').isVisible(), true, 'one cancelled waiter does not close another action\'s prompt');
        anonymousCooldownSeconds = 60;
        await page.locator('#admin-token-input').fill('candidate-before-cancel');
        assert.equal(await page.locator('#admin-token-submit').isEnabled(), true, 'an initial cooldown has no known rejected token and permits manual verification');
        await page.locator('#admin-token-input').evaluate(input => { window.cancelledAdminInput = input; });
        await page.keyboard.press('Escape');
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        assert.equal(await page.evaluate(() => window.cooldownIntervals.size), 0, 'cancelling the initial prompt releases its countdown');
        assert.equal(await page.evaluate(() => window.cancelledAdminInput.value), '', 'cancelling the initial prompt clears the detached token input');
        await page.waitForFunction(() => !document.getElementById('connect-go-btn').disabled);
        assert.equal(completed.length, 0, 'cancelling authentication must not execute the requested operation');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'connect-go-btn');

        await requestConnection();
        await waitForPrompt();
        verificationCooldown = true;
        verificationCooldownSeconds = 3;
        await submitToken('short-cooldown-rejected');
        await page.waitForFunction(() => /retry this token in [1-3] seconds/.test(document.getElementById('admin-token-error')?.textContent));
        await page.locator('#admin-token-input').fill('short-cooldown-rejected');
        assert.equal(await page.locator('#admin-token-submit').isDisabled(), true);
        const shorterCooldownAttempts = verificationRequests;
        await page.clock.fastForward(3000);
        assert.equal(await page.locator('#admin-token-submit').isEnabled(), true, 'a shorter verification Retry-After replaces the initial cooldown');
        assert.equal(await page.evaluate(() => window.cooldownIntervals.size), 0);
        assert.equal(verificationRequests, shorterCooldownAttempts, 'shorter cooldown expiry never submits automatically');
        verificationCooldown = false;
        verificationCooldownSeconds = 60;
        await submitToken('wrong-token');
        await page.waitForFunction(() => document.getElementById('admin-token-error')?.textContent.includes('admin token'));
        assert.equal(completed.length, 0, 'incorrect tokens cannot connect a peer');
        assert.equal(await page.locator('#admin-token-input').inputValue(), '');
        await submitToken(FIXTURE_ADMIN_TOKEN);
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        await page.waitForFunction(() => document.getElementById('connect-result')?.classList.contains('ok'));
        assert.equal(completed.length, 1, 'a fresh tab unlocks during an anonymous cooldown and executes the pending action once');
        anonymousCooldown = false;
        assert.equal(completed[0].authorization, `Bearer ${FIXTURE_ADMIN_TOKEN}`);
        assert.deepEqual(completed[0].body, { address: '8.8.8.8:8333' });
        assert.equal(await page.locator('#admin-lock').isVisible(), true);
        await page.setViewportSize({ width: 640, height: 800 });
        assert.equal(await page.locator('#admin-lock').isVisible(), true, 'Lock remains accessible on narrow screens');
        await page.setViewportSize({ width: 1638, height: 900 });
        assert.equal(await page.evaluate(token => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(token)), FIXTURE_ADMIN_TOKEN), false);
        actionCooldown = true;
        const completedBeforeCooldown = completed.length;
        await requestConnection();
        await page.waitForFunction(() => document.getElementById('connect-result')?.textContent.includes('60 seconds'));
        assert.equal(await page.locator('#admin-token-modal').count(), 0);
        assert.equal(await page.locator('#admin-lock').isVisible(), true, 'cooldown preserves the stored token');
        assert.equal(completed.length, completedBeforeCooldown);
        actionCooldown = false;
        await page.locator('#connect-close').click();

        // Other entry points reuse the token rather than opening another prompt.
        await page.locator('#peer-tbody .peer-action-btn[data-action="disconnect"]').first().click();
        await page.locator('#disconnect-dialog [data-choice="disconnect"]').click();
        await page.waitForSelector('#action-notification[role="status"]');
        assert.equal(completed.length, 2);
        assert.equal(completed[1].path, '/api/peer/disconnect');
        assert.equal(completed[1].authorization, `Bearer ${FIXTURE_ADMIN_TOKEN}`);

        // A revoked token triggers a new prompt before retrying the action.
        rotated = true;
        await requestConnection();
        await waitForPrompt();
        assert.equal(await page.locator('#admin-lock').isVisible(), false);
        await submitToken(replacement);
        await page.waitForFunction(() => document.getElementById('connect-result')?.classList.contains('ok'));
        assert.equal(completed.length, 3);
        assert.equal(completed[2].authorization, `Bearer ${replacement}`);
        await page.locator('#connect-close').click();

        await page.locator('#admin-lock').click();
        await requestConnection();
        await waitForPrompt();
        await page.locator('#connect-close').evaluate(button => button.click());
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        assert.equal(completed.length, 3, 'closing the source dialog cancels the pending authentication');

        await requestConnection();
        await waitForPrompt();
        await submitToken(replacement);
        await page.waitForFunction(() => document.getElementById('connect-result')?.classList.contains('ok'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('mo-status')?.textContent === 'Synced');
        await trackCooldownIntervals();
        assert.equal(await page.locator('#admin-lock').isVisible(), false, 'reload clears the token');
        await requestConnection();
        await waitForPrompt();
        await page.locator('#admin-token-cancel').click();
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        await page.waitForFunction(() => !document.getElementById('connect-go-btn').disabled);
        assert.equal(completed.length, 4);

        // A verification response arriving after cancellation cannot unlock or run an action.
        let releaseVerification;
        verificationGate = new Promise(resolve => { releaseVerification = resolve; });
        await requestConnection();
        await waitForPrompt();
        const verificationStarted = page.waitForRequest(request => request.url().endsWith('/api/admin/verify'));
        await submitToken(replacement);
        await verificationStarted;
        await page.locator('#admin-token-input').fill('changed-while-verifying');
        assert.equal(await page.locator('#admin-token-submit').isDisabled(), true, 'editing a token cannot start parallel verification');
        const inFlightAttempts = verificationRequests;
        await page.locator('#admin-token-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(verificationRequests, inFlightAttempts);
        await page.locator('#admin-token-input').evaluate(input => { window.cancelledAdminInput = input; });
        await page.locator('#admin-token-cancel').click();
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        assert.equal(await page.evaluate(() => window.cancelledAdminInput.value), '', 'cancellation clears credentials from detached input elements');
        releaseVerification();
        verificationGate = Promise.resolve();
        await page.waitForFunction(() => !document.getElementById('connect-go-btn').disabled);
        assert.equal(completed.length, 4);
        assert.equal(await page.locator('#admin-lock').isVisible(), false);

        // Only the rejected token is blocked by a cooldown; a changed token can recover immediately.
        verificationCooldown = true;
        await requestConnection();
        await waitForPrompt();
        await submitToken('cooldown-rejected');
        await page.waitForFunction(() => document.getElementById('admin-token-error')?.textContent.includes('Authentication cooldown'));
        assert.equal(await page.locator('#admin-token-submit').isDisabled(), true);
        assert.equal(await page.evaluate(() => window.cooldownIntervals.size), 1);
        const attempts = verificationRequests;
        await page.locator('#admin-token-input').fill('cooldown-rejected');
        assert.equal(await page.locator('#admin-token-submit').isDisabled(), true, 'the same rejected token cannot be resubmitted during cooldown');
        await page.locator('#admin-token-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(verificationRequests, attempts);
        await page.locator('#admin-token-input').fill(replacement);
        assert.equal(await page.locator('#admin-token-submit').isEnabled(), true, 'a changed token can be verified before expiry');
        verificationGate = new Promise(resolve => { releaseVerification = resolve; });
        const changedVerificationStarted = page.waitForRequest(request => request.url().endsWith('/api/admin/verify'));
        await page.locator('#admin-token-submit').click();
        await changedVerificationStarted;
        await page.clock.fastForward(1000);
        assert.equal(await page.locator('#admin-token-submit').isDisabled(), true, 'the countdown cannot enable an in-flight verification');
        assert.equal(verificationRequests, attempts + 1, 'verification requires a manual submit');
        releaseVerification();
        verificationGate = Promise.resolve();
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        await page.waitForFunction(() => document.getElementById('connect-result')?.classList.contains('ok'));
        assert.equal(completed.length, 5, 'the changed valid token replays the pending action exactly once during cooldown');
        assert.equal(await page.evaluate(() => window.cooldownIntervals.size), 0, 'success releases the countdown');
        assert.equal(await page.evaluate(token => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(token)), replacement), false);
        await page.locator('#connect-close').click();
        await page.locator('#admin-lock').click();
        await requestConnection();
        await waitForPrompt();
        await submitToken('cooldown-rejected');
        await page.waitForFunction(() => window.cooldownIntervals.size === 1);
        await page.locator('#admin-token-input').fill('cooldown-rejected');
        const expiryAttempts = verificationRequests;
        await page.clock.fastForward(60_000);
        assert.equal(await page.locator('#admin-token-submit').isDisabled(), false);
        assert.equal(verificationRequests, expiryAttempts, 'expiry never automatically retries verification');
        assert.equal(await page.evaluate(() => window.cooldownIntervals.size), 0, 'expiry releases the countdown');
        await submitToken('cooldown-rejected');
        await page.waitForFunction(() => window.cooldownIntervals.size === 1 && document.getElementById('admin-token-submit')?.disabled);
        assert.equal(await page.evaluate(() => window.cooldownIntervals.size), 1);
        await page.locator('#admin-token-cancel').click();
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        assert.equal(await page.evaluate(() => window.cooldownIntervals.size), 0, 'cancellation clears the countdown immediately');
        await page.clock.fastForward(61_000);
        verificationCooldown = false;
        await requestConnection();
        await waitForPrompt();
        assert.equal(await page.locator('#admin-token-submit').isDisabled(), true, 'an empty token cannot be submitted');
        await page.locator('#admin-token-input').fill('cooldown-rejected');
        assert.equal(await page.locator('#admin-token-submit').isDisabled(), false, 'a rejected token is forgotten when its dialog closes');
        assert.equal(await page.locator('#admin-token-error').textContent(), '');
        await page.locator('#admin-token-cancel').click();
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });

        anonymousCooldown = true;
        anonymousCooldownSeconds = 0;
        await requestConnection();
        await waitForPrompt();
        assert.equal(await page.locator('#admin-token-error').textContent(), '', 'zero Retry-After does not announce an active initial cooldown');
        assert.equal(await page.evaluate(() => window.cooldownIntervals.size), 0);
        await page.locator('#admin-token-input').fill(replacement);
        assert.equal(await page.locator('#admin-token-submit').isEnabled(), true);
        await page.locator('#admin-token-cancel').click();
        await page.waitForSelector('#admin-token-modal', { state: 'detached' });
        anonymousCooldown = false;
        anonymousCooldownSeconds = 60;

        unrelatedCooldown = true;
        await requestConnection();
        await page.waitForFunction(() => document.getElementById('connect-result')?.textContent.includes('Upstream cooldown'));
        assert.equal(await page.locator('#admin-token-modal').count(), 0, 'an unrelated anonymous HTTP 429 cannot open the token prompt');
        unrelatedCooldown = false;

        // Read-only responses explain the missing configuration without prompting.
        await page.route('**/api/peer/connect', route => route.fulfill({ status: 403, json: { detail: 'Management is read-only because BPM_ADMIN_TOKEN is not configured.', code: 'management_disabled' } }));
        await requestConnection();
        await page.waitForFunction(() => document.getElementById('connect-result')?.textContent.includes('read-only'));
        assert.equal(await page.locator('#admin-token-modal').count(), 0);
        assert.equal(completed.length, 5);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
