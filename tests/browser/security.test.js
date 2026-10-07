import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium, firefox, webkit } from 'playwright';
import { createApplication } from '../../src/server/app.ts';
import { FixtureRuntime, fixtureSettings, FIXTURE_ADMIN_TOKEN } from '../layout_server.ts';
import assertSharedDialogs from '../test_shared_dialogs.js';

for (const engine of [chromium, firefox, webkit]) {
    test(`${engine.name()}: local assets, strict CSP, documentation, management dialogs, and framing`, { timeout: 120_000 }, async t => {
        const settings = fixtureSettings(), app = createApplication(settings, new FixtureRuntime(settings));
        const address = await app.listen(0, '127.0.0.1');
        assert.ok(address && typeof address !== 'string');
        const base = `http://127.0.0.1:${address.port}`;
        t.after(() => app.close());
        const browser = await engine.launch({ headless: true });
        t.after(() => browser.close());
        await assertSharedDialogs(browser, base);
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        t.after(() => context.close());
        const external = [], requests = [], errors = [];
        const allowedOrigins = new Set([base]);
        await context.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url());
            requests.push(url.href);
            if (!allowedOrigins.has(url.origin)) { external.push(url.href); await route.abort(); }
            else await route.continue();
        });
        await context.addInitScript(() => {
            localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
            globalThis.securityViolations = [];
            document.addEventListener('securitypolicyviolation', event => {
                globalThis.securityViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
            });
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const specification = await (await page.request.get(base + '/openapi.json')).json();
        const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
        const operationCount = Object.values(specification.paths).reduce((count, path) => count + Object.keys(path).filter(method => methods.has(method)).length, 0);
        assert.ok(operationCount > 0, 'the canonical specification exposes operations');
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelectorAll('#peer-tbody tr').length >= 10 && document.querySelectorAll('#as-donut .as-donut-segment').length > 0 && document.getElementById('mo-status')?.textContent === 'Synced');
        const fonts = await page.evaluate(async () => Promise.all([600, 700, 900].map(async weight => {
            const faces = await document.fonts.load(`${weight} 16px "Cinzel Variable"`, 'Bitcoin Ćž');
            // Firefox preserves the quotes in the CSSOM family descriptor.
            return faces.length > 0 && faces.every(face => face.status === 'loaded' && face.family.replace(/^['"]|['"]$/g, '') === 'Cinzel Variable');
        })));
        assert.deepEqual(fonts, [true, true, true], 'Latin and Latin-ext faces load at every existing display weight');
        assert.ok(requests.some(url => url.includes('cinzel-latin-wght-normal.woff2')));
        assert.ok(requests.some(url => url.includes('cinzel-latin-ext-wght-normal.woff2')));
        assert.ok(await page.locator('#worldmap').evaluate(canvas => canvas.width > 0 && canvas.height > 0));

        // Exercise generated styles and the authenticated form beneath the policy.
        await page.locator('#btn-connect-peer').click();
        await page.locator('#connect-addr-input').fill('8.8.8.8:8333');
        await page.locator('#connect-go-btn').click();
        await page.locator('#admin-token-input').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.locator('#admin-token-modal').waitFor({ state: 'detached' });
        assert.equal(await page.locator('#connect-peer-modal').isVisible(), true, 'Escape closes only the nested token prompt');
        await page.waitForFunction(() => !document.getElementById('connect-go-btn').disabled && document.activeElement.id === 'connect-go-btn');
        assert.equal(await page.locator('#connect-go-btn').isEnabled(), true);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'connect-go-btn', 'cancellation restores focus to the enabled parent action');
        await page.locator('#connect-go-btn').click();
        await page.locator('#admin-token-input').waitFor({ state: 'visible' });
        await page.locator('#admin-token-input').fill(FIXTURE_ADMIN_TOKEN);
        await page.locator('#admin-token-submit').click();
        await page.locator('#admin-token-modal').waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.getElementById('connect-result')?.classList.contains('ok'));
        await page.locator('#connect-close').click();
        await page.locator('#admin-lock').click();
        await page.locator('#btn-geoip-db-peer').click();
        await page.locator('#geodb-modal [role="dialog"]').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.locator('#geodb-modal').waitFor({ state: 'detached' });
        assert.deepEqual(await page.evaluate(() => globalThis.securityViolations), []);
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);

        // Injected scripts and style elements are rejected without weakening
        // the inline style attributes used by the application's own views.
        await page.evaluate(() => {
            globalThis.injectedScriptExecuted = false;
            const script = document.createElement('script');
            script.textContent = 'globalThis.injectedScriptExecuted = true';
            document.body.append(script);
            const style = document.createElement('style');
            style.textContent = 'body { --injected-style: applied; }';
            document.head.append(style);
        });
        await page.waitForFunction(() => globalThis.securityViolations.some(event => event.directive.startsWith('script-src')) && globalThis.securityViolations.some(event => event.directive.startsWith('style-src')));
        assert.equal(await page.evaluate(() => globalThis.injectedScriptExecuted), false);
        assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--injected-style')), '');

        await page.evaluate(() => {
            globalThis.inlineEventExecuted = false;
            const button = document.createElement('button');
            button.id = 'csp-event-probe';
            button.type = 'button';
            button.textContent = 'CSP event probe';
            Object.assign(button.style, { position: 'fixed', top: '8px', left: '8px', zIndex: '10000' });
            button.setAttribute('onclick', 'globalThis.inlineEventExecuted = true');
            document.body.append(button);
        });
        await page.locator('#csp-event-probe').click();
        await page.waitForFunction(() => globalThis.securityViolations.some(event => event.directive === 'script-src-attr'));
        assert.equal(await page.evaluate(() => globalThis.inlineEventExecuted), false);

        // Execute the probe as an allowed same-origin script: automation's own
        // evaluation context can bypass CSP and cannot test unsafe-eval denial.
        await page.route('**/static/browser-tests/execution-probe.js', route => route.fulfill({
            contentType: 'application/javascript',
            body: `
                globalThis.executionProbe = { loaded: true, evalExecuted: false, functionExecuted: false, errors: [] };
                try { eval('globalThis.executionProbe.evalExecuted = true'); }
                catch (error) { globalThis.executionProbe.errors.push(error.name); }
                try { new Function('globalThis.executionProbe.functionExecuted = true')(); }
                catch (error) { globalThis.executionProbe.errors.push(error.name); }
            `,
        }));
        await page.addScriptTag({ url: `${base}/static/browser-tests/execution-probe.js` });
        assert.deepEqual(await page.evaluate(() => globalThis.executionProbe), {
            loaded: true, evalExecuted: false, functionExecuted: false, errors: ['EvalError', 'EvalError'],
        });
        await page.waitForFunction(() => globalThis.securityViolations.some(event => event.blocked === 'eval'));

        for (const path of ['/docs?url=https://example.invalid/spec&configUrl=https://example.invalid/config', '/redoc']) {
            await page.goto(base + path, { waitUntil: 'domcontentloaded' });
            await page.locator('.swagger-ui .opblock').first().waitFor();
            assert.equal(await page.locator('.swagger-ui .opblock').count(), operationCount);
            assert.deepEqual(await page.evaluate(() => globalThis.securityViolations), [], 'documentation does not contact a validator or accept a query configuration');
        }
        await page.locator('.auth-wrapper .authorize').click();
        const authorization = page.locator('.dialog-ux');
        await authorization.locator('.auth-container input').fill(FIXTURE_ADMIN_TOKEN);
        await authorization.locator('.auth-btn-wrapper .authorize').click();
        await authorization.getByRole('button', { name: 'Close', exact: true }).click();
        const operation = page.locator('.opblock').filter({ hasText: '/api/admin/verify' });
        await operation.locator('.opblock-summary').click();
        await operation.getByRole('button', { name: 'Try it out', exact: true }).click();
        const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/verify' && response.request().method() === 'POST');
        await operation.getByRole('button', { name: 'Execute', exact: true }).click();
        const response = await accepted;
        assert.equal(response.status(), 200);
        assert.equal(await response.request().headerValue('authorization'), `Bearer ${FIXTURE_ADMIN_TOKEN}`);
        assert.deepEqual(await response.json(), { success: true });
        assert.equal(await page.evaluate(token => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(token)), FIXTURE_ADMIN_TOKEN), false);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await operation.locator('.opblock-summary').click();
        await operation.getByRole('button', { name: 'Try it out', exact: true }).click();
        const cleared = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/verify' && response.request().method() === 'POST');
        await operation.getByRole('button', { name: 'Execute', exact: true }).click();
        const unauthorized = await cleared;
        assert.equal(unauthorized.status(), 401, 'reload clears documentation authorization');
        assert.equal(await unauthorized.request().headerValue('authorization'), null);
        assert.deepEqual(await page.evaluate(() => globalThis.securityViolations), []);
        assert.deepEqual(external, []);
        assert.deepEqual(errors, []);

        const embedding = `<!doctype html><html><body><iframe name="protected" src="${base}/docs"></iframe></body></html>`;
        const assertFrameDenied = async (hostUrl, label) => {
            const protectedResponse = page.waitForResponse(response => response.url() === base + '/docs' && response.request().isNavigationRequest());
            const parent = await page.goto(hostUrl, { waitUntil: 'load' });
            assert.equal(parent.headers()['content-security-policy'], undefined, 'the embedding fixture must allow frames');
            assert.equal(await page.locator('iframe[name="protected"]').count(), 1);
            const response = await protectedResponse;
            assert.equal(response.status(), 200, 'the unmodified application handles the frame request');
            assert.equal(response.headers()['x-frame-options'], 'DENY');
            const child = page.frame({ name: 'protected' });
            if (child) assert.equal(await child.locator('#swagger-ui').count(), 0, label);
        };

        // An unprotected same-origin fixture tests the child's policy rather
        // than the application's separate frame-src restriction on parents.
        const sameOriginHost = `${base}/browser-tests/frame-host`;
        await page.route(sameOriginHost, route => route.fulfill({ contentType: 'text/html', body: embedding }));
        await assertFrameDenied(sameOriginHost, 'same-origin framing must not render the document');

        // A separate origin also attempts to embed the normally working page.
        const host = createServer((_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(embedding);
        });
        host.listen(0, '127.0.0.1'); await once(host, 'listening');
        t.after(() => new Promise(resolve => host.close(resolve)));
        const hostAddress = host.address();
        assert.ok(hostAddress && typeof hostAddress !== 'string');
        const hostBase = `http://127.0.0.1:${hostAddress.port}`;
        allowedOrigins.add(hostBase);
        await assertFrameDenied(hostBase, 'cross-origin framing must not render the document');
        assert.deepEqual(external, []);
    });
}
