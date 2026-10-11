import assert from 'node:assert/strict';

const BITCOIN_ADDRESS = 'bc1qnngus06lk0e60e05yq902e9edx7kt4kcuuuy72';
const WIDTHS = [320, 390, 720, 721, 800, 801, 1120, 1121, 1280, 1281, 1350, 1351, 1600, 1601, 1638, 1700, 1701, 1920];

async function resize(page, width) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function assertHeaderFits(page, width, state) {
    const geometry = await page.evaluate(() => {
        function box(selector) {
            const element = document.querySelector(selector);
            if (!element) return null;
            const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
            if (!bounds.width || !bounds.height || style.display === 'none' || style.visibility === 'hidden') return null;
            return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
        }
        return {
            header: box('#topbar'), left: box('.topbar-left'), center: box('.topbar-center'), right: box('.topbar-right'),
            controls: ['#support-button', '#topbar-gear', '#admin-lock', '#view-lock', '#revision-update'].map(box).filter(Boolean),
            pageFits: document.body.scrollWidth <= innerWidth,
        };
    });
    const label = `${state} header at ${width}px: ${JSON.stringify(geometry)}`;
    assert.ok(geometry.pageFits, label);
    for (const box of [geometry.left, geometry.center, geometry.right, ...geometry.controls].filter(Boolean)) {
        assert.ok(box.left >= -1 && box.right <= width + 1 && box.top >= geometry.header.top - 1 && box.bottom <= geometry.header.bottom + 1, label);
    }
    if (geometry.center) {
        assert.ok(geometry.left.right <= geometry.center.left + 1, label);
        assert.ok(geometry.center.right <= geometry.right.left + 1, label);
    } else assert.ok(geometry.left.right <= geometry.right.left + 1, label);
}

async function assertPanelAtBottom(page, width, collapsed) {
    const state = await page.locator('#peer-panel').evaluate(panel => {
        const bounds = panel.getBoundingClientRect();
        return { bottom: getComputedStyle(panel).bottom, edge: bounds.bottom, viewport: innerHeight, collapsed: panel.classList.contains('collapsed') };
    });
    assert.equal(state.bottom, '0px', `peer panel has no footer offset at ${width}px`);
    assert.ok(Math.abs(state.edge - state.viewport) <= 1, `peer panel reaches the viewport bottom at ${width}px`);
    assert.equal(state.collapsed, collapsed);
}

async function assertDialog(page) {
    const dialog = page.getByRole('dialog', { name: 'Support Bitcoin Peer Map', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getAttribute('aria-modal'), 'true');
    assert.match(await dialog.textContent(), /Bitcoin/);
    assert.doesNotMatch(await dialog.textContent(), /\b(?:BTC|xbt)\b/i);
    const address = page.getByRole('textbox', { name: 'Bitcoin address', exact: true });
    assert.equal(await address.inputValue(), BITCOIN_ADDRESS);
    assert.equal(await address.evaluate(element => element.readOnly), true);
    assert.equal(await page.locator('#support-wallet').getAttribute('href'), `bitcoin:${BITCOIN_ADDRESS}`);
    const qr = page.locator('#support-qr');
    await page.waitForFunction(() => {
        const image = document.getElementById('support-qr');
        return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    });
    const qrUrl = new URL(await qr.getAttribute('src'), page.url());
    assert.equal(qrUrl.origin, new URL(page.url()).origin, 'the QR image loads from the dashboard itself');
    assert.ok(qrUrl.pathname.startsWith('/static/'));
    assert.equal((await page.request.get(qrUrl.href)).status(), 200);
    assert.equal(await page.locator('#support-status').getAttribute('role'), 'status');
    assert.equal(await page.locator('#support-status').getAttribute('aria-live'), 'polite');
    const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
        `Support dialog fits ${viewport.width}x${viewport.height}`);
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'opening Support moves focus into the dialog');
    return dialog;
}

export default async function assertSupport(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        if (location.protocol === 'http:' || location.protocol === 'https:') localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        window.supportClipboardValues = [];
        window.supportClipboardDenied = false;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async value => {
                if (window.supportClipboardPending) await new Promise((_resolve, reject) => { window.rejectSupportClipboard = reject; });
                if (window.supportClipboardDenied) throw new DOMException('Clipboard access denied', 'NotAllowedError');
                window.supportClipboardValues.push(value);
            },
        } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('mo-status')?.textContent === 'Synced');
        assert.equal(await page.locator('#footer, .footer').count(), 0, 'the address footer is removed');

        const entry = page.getByRole('button', { name: 'Support Bitcoin Peer Map', exact: true }).and(page.locator('#support-button'));
        assert.equal(await entry.evaluate(element => element.tagName), 'BUTTON');
        assert.equal(await entry.getAttribute('type'), 'button');
        assert.equal(await entry.getAttribute('aria-haspopup'), 'dialog');
        assert.equal(await entry.getAttribute('aria-controls'), 'support-modal');
        for (const key of ['Enter', 'Space']) {
            await entry.focus();
            await page.keyboard.press(key);
            const dialog = await assertDialog(page);
            await dialog.getByRole('link', { name: 'Open wallet', exact: true }).focus();
            await page.keyboard.press('Tab');
            assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Tab remains inside Support');
            await page.keyboard.press('Shift+Tab');
            assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Shift+Tab remains inside Support');
            await page.keyboard.press('Escape');
            await page.locator('#support-modal').waitFor({ state: 'detached' });
            assert.equal(await entry.evaluate(element => element === document.activeElement), true, `${key} activation returns focus to header Support after Escape`);
        }

        await entry.click();
        await assertDialog(page);
        await page.locator('#support-copy').click();
        await page.waitForFunction(() => document.getElementById('support-status').textContent === 'Bitcoin address copied.');
        assert.deepEqual(await page.evaluate(() => window.supportClipboardValues), [BITCOIN_ADDRESS]);
        await page.evaluate(() => { window.supportClipboardDenied = true; });
        await page.locator('#support-copy').click();
        await page.waitForFunction(() => document.getElementById('support-status').textContent.includes('copy it manually'));
        assert.equal(await page.locator('#support-address').evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd)), BITCOIN_ADDRESS,
            'when copying fails the entire Bitcoin address is selected for manual copying');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'support-address');
        assert.equal(await page.locator('#support-copy').isEnabled(), true);
        await page.keyboard.press('Escape');
        await page.locator('#support-modal').waitFor({ state: 'detached' });

        await entry.click();
        await assertDialog(page);
        await page.evaluate(() => { window.supportClipboardPending = true; });
        await page.locator('#support-copy').click();
        await page.waitForFunction(() => typeof window.rejectSupportClipboard === 'function');
        await page.keyboard.press('Escape');
        await page.locator('#support-modal').waitFor({ state: 'detached' });
        await page.evaluate(async () => {
            window.rejectSupportClipboard(new DOMException('Late clipboard rejection', 'NotAllowedError'));
            window.supportClipboardPending = false;
            await new Promise(resolve => requestAnimationFrame(resolve));
        });
        assert.equal(await page.locator('#support-modal').count(), 0, 'a late clipboard rejection cannot restore a closed dialog');
        assert.equal(await entry.evaluate(element => element === document.activeElement), true, 'a late clipboard failure does not steal restored focus');

        for (const width of WIDTHS) {
            await resize(page, width);
            await assertHeaderFits(page, width, 'normal');
            assert.equal(await page.locator('#support-button').isVisible(), width > 1600);
            await assertPanelAtBottom(page, width, false);
            await page.locator('#btn-minimize').click();
            await page.waitForFunction(() => document.getElementById('peer-panel').classList.contains('collapsed'));
            await assertPanelAtBottom(page, width, true);
            await page.locator('#btn-minimize').click();
            await page.waitForFunction(() => !document.getElementById('peer-panel').classList.contains('collapsed'));
            await page.locator('#topbar-gear').click();
            await page.locator('#display-settings-popup').waitFor();
            assert.equal(await page.locator('#dsp-support-btn').isVisible(), width <= 1600, 'settings supplies Support when the header entry is hidden');
            if (width <= 1600) {
                await page.locator('#dsp-support-btn').click();
                await page.locator('#display-settings-popup').waitFor({ state: 'detached' });
                await assertDialog(page);
                await page.keyboard.press('Escape');
                await page.locator('#support-modal').waitFor({ state: 'detached' });
                assert.equal(await page.evaluate(() => document.activeElement.id), 'topbar-gear', 'closing settings Support restores focus to Map Settings');
            } else {
                await page.locator('#topbar').click({ position: { x: 1, y: 1 } });
                await page.locator('#display-settings-popup').waitFor({ state: 'detached' });
            }
        }

        // Authenticated dashboards and release notifications share this header.
        await page.evaluate(() => {
            document.body.classList.add('view-unlocked');
            document.getElementById('admin-lock').hidden = false;
            const viewLock = document.createElement('button');
            viewLock.id = 'view-lock'; viewLock.className = 'admin-lock'; viewLock.type = 'button'; viewLock.textContent = 'Lock view';
            document.querySelector('.topbar-right').append(viewLock);
            document.getElementById('revision-update').hidden = false;
            document.querySelector('.build-version').textContent = 'v2.0.1';
        });
        for (const width of WIDTHS) {
            await resize(page, width);
            await assertHeaderFits(page, width, 'authenticated with update');
        }
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
}
