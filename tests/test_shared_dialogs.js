import assert from 'node:assert/strict';

async function assertFits(page, selector) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width, 'dialog fits the viewport');
}

async function assertBackgroundPaused(page, reason) {
    const before = await page.evaluate(() => ({ ...window.dialogMapDraws }));
    // Sample several display frames, rather than imposing a machine-specific FPS.
    await page.evaluate(() => new Promise(resolve => {
        let remaining = 6;
        const frame = () => { if (--remaining) requestAnimationFrame(frame); else resolve(); };
        requestAnimationFrame(frame);
    }));
    assert.deepEqual(await page.evaluate(() => window.dialogMapDraws), before, reason);
    assert.equal(await page.locator('#status-dot').evaluate(element => getComputedStyle(element).animationPlayState), 'paused',
        'decorative background CSS animations pause with the canvas');
}

async function assertNoBackdropBlur(page, selector) {
    const filters = await page.locator(selector).evaluate(overlay => [overlay, overlay.firstElementChild].map(element => {
        const style = getComputedStyle(element);
        return style.getPropertyValue('backdrop-filter') || style.getPropertyValue('-webkit-backdrop-filter') || 'none';
    }));
    assert.deepEqual(filters, ['none', 'none'], 'neither the overlay nor its dialog blurs the scrolling background');
}

export default async function assertSharedDialogs(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 }, reducedMotion: 'no-preference' });
    await context.addInitScript(() => {
        window.dialogMapDraws = { basemap: 0, 'map-connections': 0, worldmap: 0 };
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            if (Object.hasOwn(window.dialogMapDraws, this.canvas.id)) window.dialogMapDraws[this.canvas.id]++;
            return clear.apply(this, args);
        };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.getByRole('dialog', { name: 'Private peer location disclaimer' }).waitFor();
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ant-close');
        await assertFits(page, '#antarctica-note');
        await assertNoBackdropBlur(page, '#antarctica-modal-overlay');
        await assertBackgroundPaused(page, 'the startup disclaimer pauses rendering even though it opens before the renderer starts');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ant-close');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#antarctica-modal-overlay', { state: 'detached' });
        assert.equal(await page.evaluate(() => localStorage.getItem('bpm.antarcticaDisclaimerSeen')), 'true');
        await page.waitForFunction(() => window.dialogMapDraws.worldmap > 0);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('mo-status')?.textContent === 'Synced');
        assert.equal(await page.locator('#antarctica-modal-overlay').count(), 0);
        await page.waitForFunction(() => window.dialogMapDraws.worldmap >= 3);

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
                if (id === 'mo-row-peers' && key === 'Enter') {
                    await assertNoBackdropBlur(page, '#system-info-modal');
                    await assertBackgroundPaused(page, 'opening Node Metrics stops all background canvas redraws');
                }
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
            window.parentDialog = window.testModal.open({ id: 'test-parent', title: 'Parent', initialHtml: '<button hidden id="hidden-control">Hidden</button><button id="parent-action">Action</button><span id="dialog-animation" style="animation:status-pulse 2s infinite">Pending</span>', initialFocusSelector: '#parent-action' });
            document.getElementById('parent-action').focus();
            window.childDialog = window.testModal.open({ id: 'test-child', title: 'Child', initialHtml: '<button id="child-action">Action</button>', initialFocusSelector: '#child-action' });
        });
        assert.equal(await page.locator('#test-parent').evaluate(element => element.inert), true);
        assert.equal(await page.locator('#test-parent').getAttribute('aria-hidden'), 'true');
        await assertBackgroundPaused(page, 'nested dialogs keep the background paused');
        assert.equal(await page.locator('#dialog-animation').evaluate(element => getComputedStyle(element).animationPlayState), 'running',
            'animations belonging to dialog content remain available');
        await page.locator('#test-parent').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await page.locator('#test-parent').count(), 1, 'lower backdrop cannot close a dialog');
        await trigger.evaluate(element => element.focus());
        assert.equal(await page.locator('#test-child [role="dialog"]').evaluate(element => element.contains(document.activeElement)), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#test-child').count(), 0);
        assert.equal(await page.locator('#test-parent').count(), 1, 'Escape closes only the top dialog');
        await assertBackgroundPaused(page, 'closing a nested dialog must not resume the background behind its parent');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'parent-action');
        assert.equal(await page.locator('#test-parent').evaluate(element => element.inert), false);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'test-parent-close');
        const pausedDraws = await page.evaluate(() => window.dialogMapDraws.worldmap);
        await page.keyboard.press('Escape');
        await page.waitForFunction(count => window.dialogMapDraws.worldmap > count, pausedDraws);
        assert.equal(await page.locator('#status-dot').evaluate(element => getComputedStyle(element).animationPlayState), 'running',
            'closing the final dialog resumes background CSS animation');

        for (const [overlayClass, boxClass] of [['ban-modal-overlay', 'ban-modal-box'], ['dialog-overlay', 'dialog-box']]) {
            await page.evaluate(({ overlayClass, boxClass }) => {
                window.specialDialog = window.testModal.open({ id: 'special-dialog', title: 'Special dialog', overlayClass, boxClass });
            }, { overlayClass, boxClass });
            await assertNoBackdropBlur(page, '#special-dialog');
            await page.evaluate(() => window.specialDialog.close());
        }
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
