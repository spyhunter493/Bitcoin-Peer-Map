import assert from 'node:assert/strict';

async function assertGutters(page, dialog) {
    const viewport = page.viewportSize();
    const { box, sizing } = await dialog.evaluate(element => {
        const style = getComputedStyle(element);
        const sizing = { innerHeight, height: style.height, maxHeight: style.maxHeight };
        const rect = element.getBoundingClientRect();
        return { box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, sizing };
    });
    assert.ok(box && box.x >= 15.5 && box.x + box.width <= viewport.width - 15.5, 'dialog retains 16px side gutters at 320px');
    assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 0.5, `dialog fits a short viewport: ${JSON.stringify({ box, viewport, sizing })}`);
}

async function reachable(page, control) {
    await control.scrollIntoViewIfNeeded();
    await control.focus();
    const box = await control.boundingBox(), viewport = page.viewportSize();
    assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height,
        'controls are reachable through internal scrolling');
    assert.equal(await control.evaluate(element => element === document.activeElement), true);
}

async function resize(page, height, dialog) {
    await page.setViewportSize({ width: 320, height });
    // Resize completion can precede viewport-unit style and compositor updates.
    const element = dialog ? await dialog.elementHandle() : null;
    try {
        await page.waitForFunction(({ height, element }) => {
            if (innerWidth !== 320 || innerHeight !== height) return false;
            if (!element) return true;
            getComputedStyle(element).maxHeight;
            const box = element.getBoundingClientRect();
            return box.x >= 15.5 && box.right <= 304.5 && box.y >= 0 && box.bottom <= height + 0.5;
        }, { height, element });
    } finally {
        await element?.dispose();
    }
}

export default async function assertNarrowManagementDialogs(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const bans = Array.from({ length: 40 }, (_, index) => ({
        address: `2001:db8:abcd:1234:5678:90ab:cdef:${index.toString(16)}/128`,
        ban_created: 1700000000, banned_until: 1900000000,
    }));
    await page.route('**/api/bans', route => route.fulfill({ json: { success: true, bans } }));
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#peer-tbody tr[data-net="ipv4"]');
        const connect = page.locator('#btn-connect-peer');
        await connect.click();
        const parent = page.locator('#connect-peer-modal [role="dialog"]');
        await parent.waitFor();
        await assertGutters(page, parent);
        assert.equal(await page.locator('#connect-addr-input').evaluate(element => element === document.activeElement), true);
        await page.locator('#connect-addr-input').fill('8.8.8.8:8333');
        await page.locator('#connect-go-btn').click();
        const unlock = page.locator('#admin-token-modal [role="dialog"]');
        await unlock.waitFor();
        await assertGutters(page, unlock);
        assert.equal(await page.locator('#connect-peer-modal').evaluate(element => element.inert), true);
        await resize(page, 180, unlock);
        await assertGutters(page, unlock);
        await reachable(page, page.locator('#admin-token-input'));
        await reachable(page, page.locator('#admin-token-cancel'));
        await page.keyboard.press('Escape');
        await unlock.waitFor({ state: 'detached' });
        await page.waitForFunction(() => !document.getElementById('connect-go-btn').disabled && document.activeElement.id === 'connect-go-btn');
        await assertGutters(page, parent);
        await reachable(page, page.locator('#connect-go-btn'));
        assert.equal(await page.locator('#connect-peer-modal .modal-body').evaluate(element => element.scrollHeight > element.clientHeight && element.scrollTop > 0), true);
        await page.keyboard.press('Escape');
        await parent.waitFor({ state: 'detached' });
        assert.equal(await connect.evaluate(element => element === document.activeElement), true);

        await resize(page, 740);
        const trigger = page.locator('#peer-tbody tr[data-net="ipv4"] button[data-action="disconnect"]').first();
        await trigger.click();
        const choices = page.locator('#disconnect-dialog [role="dialog"]');
        await choices.waitFor();
        await assertGutters(page, choices);
        await resize(page, 180, choices);
        await assertGutters(page, choices);
        for (const choice of ['disconnect', 'ban', 'cancel']) await reachable(page, choices.locator(`[data-choice="${choice}"]`));
        assert.equal(await choices.evaluate(element => element.scrollHeight > element.clientHeight && element.scrollTop > 0), true);
        await page.keyboard.press('Tab');
        assert.equal(await choices.locator('[data-choice="disconnect"]').evaluate(element => element === document.activeElement), true, 'Tab wraps inside the choice dialog');
        await page.keyboard.press('Escape');
        await choices.waitFor({ state: 'detached' });
        assert.equal(await trigger.evaluate(element => element === document.activeElement), true);

        await resize(page, 740);
        const banned = page.locator('#btn-bans');
        await banned.click();
        const dialog = page.locator('#ban-modal [role="dialog"]');
        await page.locator('#ban-modal .ban-unban').last().waitFor();
        assert.equal(await page.locator('#ban-modal .ban-unban').count(), 40);
        await assertGutters(page, dialog);
        await resize(page, 180, dialog);
        await assertGutters(page, dialog);
        await reachable(page, page.locator('#ban-modal .ban-unban').last());
        assert.equal(await page.locator('#ban-modal-body').evaluate(element => element.scrollHeight > element.clientHeight && element.scrollTop > 0), true);
        assert.equal(await page.locator('.ban-modal-table-wrap').evaluate(element => element.scrollWidth > element.clientWidth && element.scrollLeft > 0), true);
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#ban-modal-close').evaluate(element => element === document.activeElement), true, 'Tab wraps from the final ban action to Close');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await banned.evaluate(element => element === document.activeElement), true);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
