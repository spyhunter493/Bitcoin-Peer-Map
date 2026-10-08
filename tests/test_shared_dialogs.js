import assert from 'node:assert/strict';

async function assertFits(page, selector) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width, 'dialog fits the viewport');
}

export default async function assertSharedDialogs(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.getByRole('dialog', { name: 'Private peer location disclaimer' }).waitFor();
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ant-close');
        await assertFits(page, '#antarctica-note');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ant-close');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#antarctica-modal-overlay', { state: 'detached' });
        assert.equal(await page.evaluate(() => localStorage.getItem('bpm.antarcticaDisclaimerSeen')), 'true');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('mo-status')?.textContent === 'Synced');
        assert.equal(await page.locator('#antarctica-modal-overlay').count(), 0);

        // Every HUD entry point supports native button activation and the same
        // named dialog, complete focus cycle, and return to its own trigger.
        const displayRows = [
            ['mo-row-netin', 'P2P ↓ (Download rate)'],
            ['mo-row-netout', 'P2P ↑ (Upload rate)'],
            ['mo-row-p2p-in', 'P2P ↓ (Downloaded total)'],
            ['mo-row-p2p-out', 'P2P ↑ (Uploaded total)'],
        ];
        for (const id of ['mo-row-peers', ...displayRows.map(([id]) => id)]) {
            const entry = page.getByRole('button').and(page.locator(`#${id}`));
            assert.equal(await entry.count(), 1, `${id} is exposed as a button`);
            assert.equal(await entry.evaluate(element => element.tagName), 'BUTTON');
            assert.equal(await entry.getAttribute('type'), 'button');
            assert.equal(await entry.getAttribute('aria-haspopup'), 'dialog');
            assert.equal(await entry.getAttribute('aria-controls'), 'system-info-modal');
            for (const key of ['Enter', 'Space']) {
                await entry.focus();
                await page.keyboard.press(key);
                const dialog = page.getByRole('dialog', { name: 'Node Metrics', exact: true });
                await dialog.waitFor();
                assert.equal(await dialog.count(), 1);
                assert.equal(await dialog.getAttribute('aria-modal'), 'true');
                await assertFits(page, '#system-info-modal [role="dialog"]');
                const close = dialog.getByRole('button', { name: 'Close Node Metrics', exact: true });
                assert.equal(await close.evaluate(element => element === document.activeElement), true);

                for (const [target, label] of displayRows) {
                    await page.keyboard.press('Tab');
                    const checkbox = dialog.getByRole('checkbox', { name: label, exact: true });
                    assert.equal(await checkbox.evaluate(element => element === document.activeElement), true);
                    if (target === 'mo-row-netin') {
                        await page.keyboard.press('Space');
                        assert.equal(await checkbox.isChecked(), false);
                        assert.equal(await page.locator(`#${target}`).isVisible(), false);
                        await page.keyboard.press('Space');
                        assert.equal(await checkbox.isChecked(), true);
                        assert.equal(await page.locator(`#${target}`).isVisible(), true);
                    }
                }
                await page.keyboard.press('Tab');
                assert.equal(await close.evaluate(element => element === document.activeElement), true, 'Tab wraps to Close');
                for (const [, label] of displayRows.toReversed()) {
                    await page.keyboard.press('Shift+Tab');
                    assert.equal(await dialog.getByRole('checkbox', { name: label, exact: true }).evaluate(element => element === document.activeElement), true);
                }
                await page.keyboard.press('Shift+Tab');
                assert.equal(await close.evaluate(element => element === document.activeElement), true, 'Shift+Tab wraps to Close');
                await entry.evaluate(element => element.focus());
                assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'focus cannot leave Node Metrics');
                await page.keyboard.press('Escape');
                await dialog.waitFor({ state: 'detached' });
                assert.equal(await entry.evaluate(element => element === document.activeElement), true, `${id} regains focus after ${key}`);
            }
        }
        const trigger = page.locator('#mo-row-peers');
        await trigger.focus();
        await page.keyboard.press('Space');
        const retainedToggle = await page.locator('.si-dash-toggle').first().elementHandle();
        assert.ok(retainedToggle);
        const preference = await page.evaluate(() => localStorage.getItem('bpm.system.display'));
        await page.locator('#system-info-close').click();
        assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
        await retainedToggle.evaluate(element => {
            element.checked = false;
            element.dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert.equal(await page.locator('#mo-row-netin').isVisible(), true, 'closed dialog controls no longer change the HUD');
        assert.equal(await page.evaluate(() => localStorage.getItem('bpm.system.display')), preference, 'closing disposes preference listeners');
        await retainedToggle.dispose();
        await trigger.click();
        await page.locator('#system-info-modal').click({ position: { x: 2, y: 2 } });
        await page.waitForSelector('#system-info-modal', { state: 'detached' });

        // Exercise the shared controller independently, including hidden controls,
        // nested overlays, out-of-dialog focus and late request responses.
        await page.evaluate(async () => {
            const script = document.querySelector('script[type="module"]');
            window.testModal = await import(new URL('./core/modal.js', script.src).href);
            window.parentDialog = window.testModal.open({ id: 'test-parent', title: 'Parent', initialHtml: '<button hidden id="hidden-control">Hidden</button><button id="parent-action">Action</button>', initialFocusSelector: '#parent-action' });
            document.getElementById('parent-action').focus();
            window.childDialog = window.testModal.open({ id: 'test-child', title: 'Child', initialHtml: '<button id="child-action">Action</button>', initialFocusSelector: '#child-action' });
        });
        assert.equal(await page.locator('#test-parent').evaluate(element => element.inert), true);
        assert.equal(await page.locator('#test-parent').getAttribute('aria-hidden'), 'true');
        await page.locator('#test-parent').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await page.locator('#test-parent').count(), 1, 'lower backdrop cannot close a dialog');
        await trigger.evaluate(element => element.focus());
        assert.equal(await page.locator('#test-child [role="dialog"]').evaluate(element => element.contains(document.activeElement)), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#test-child').count(), 0);
        assert.equal(await page.locator('#test-parent').count(), 1, 'Escape closes only the top dialog');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'parent-action');
        assert.equal(await page.locator('#test-parent').evaluate(element => element.inert), false);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'test-parent-close');
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
            window.lateDialog = window.testModal.openFetched({ id: 'late-dialog', title: 'Pending', url: '/fixture', render: () => { window.lateRenderCalled = true; return 'Late'; }, api: { getJson: (_url, options) => { window.lateSignal = options.signal; return new Promise(resolve => { window.resolveLateDialog = resolve; }); } } });
            window.lateDialog.close();
            window.lateDialog.close();
            window.resolveLateDialog({});
        });
        assert.equal(await page.evaluate(() => window.lateSignal.aborted), true);
        assert.equal(await page.evaluate(() => !!window.lateRenderCalled), false);
        assert.equal(await page.locator('#late-dialog').count(), 0);

        await page.route('**/api/info', async route => {
            const response = await route.fetch();
            const info = await response.json();
            await route.fulfill({ json: { ...info, api_available: false } });
        });
        await page.route('**/api/connectivity', route => route.fulfill({ json: { api_down_prompt: true, geo_db_only_mode: false } }));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByRole('dialog', { name: 'Geolocation API Not Responding' }).waitFor();
        assert.equal(await page.evaluate(() => document.activeElement.id), 'api-down-keep');
        await assertFits(page, '#api-down-modal [role="dialog"]');
        await page.locator('#api-down-keep').click();
        await page.waitForSelector('#api-down-modal', { state: 'detached' });
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
