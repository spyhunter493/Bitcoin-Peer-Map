import assert from 'node:assert/strict';
import { project } from '../src/static/js/map/geometry.js';

async function assertPopupFits(page) {
    await page.waitForFunction(() => {
        const popup = document.getElementById('table-settings-popup');
        if (!popup) return false;
        const rect = popup.getBoundingClientRect();
        return rect.left >= 11 && rect.top >= 11 && rect.right <= innerWidth - 11 && rect.bottom <= innerHeight - 11;
    });
    const layout = await page.locator('#table-settings-popup').evaluate(popup => {
        const header = popup.querySelector('.tsp-header').getBoundingClientRect();
        const rect = popup.getBoundingClientRect();
        return {
            width: rect.width, overflowing: popup.scrollWidth > popup.clientWidth,
            headerVisible: header.top >= rect.top && header.bottom <= rect.bottom,
            columns: getComputedStyle(popup.querySelector('.tsp-col-grid')).gridTemplateColumns.split(' ').length,
        };
    });
    assert.equal(layout.overflowing, false, 'settings must not require horizontal scrolling');
    assert.equal(layout.headerVisible, true, 'title and Defaults must be visible when opening');
    return layout;
}

export default async function assertTableSettings(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 2557, height: 1025 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        const arc = CanvasRenderingContext2D.prototype.arc;
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        window.testMapArcs = [];
        CanvasRenderingContext2D.prototype.arc = function(x, y, ...args) {
            if (this.canvas.id === 'worldmap') window.testMapArcs.push({ x, y });
            return arc.call(this, x, y, ...args);
        };
        CanvasRenderingContext2D.prototype.clearRect = function(...args) {
            if (this.canvas.id === 'worldmap') window.testMapArcs = [];
            return clear.apply(this, args);
        };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelectorAll('#peer-tbody tr').length >= 10);
        await page.waitForFunction(() => window.testMapArcs.length > 0);
        const rowCount = await page.locator('#peer-tbody tr').count();
        await page.locator('#btn-table-settings').click();
        const wide = await assertPopupFits(page);
        assert.equal(wide.width, 460);
        assert.equal(wide.columns, 3);

        // Check real canvas output rather than just the saved checkbox value.
        const cutoff = project(0, -60).y * 1025;
        const privatePoint = await page.evaluate(cutoff => window.testMapArcs.find(point => point.y > cutoff), cutoff);
        assert.ok(privatePoint, 'the initial map must draw Antarctic placeholders');
        await page.locator('#worldmap').dispatchEvent('mousemove', { clientX: privatePoint.x, clientY: privatePoint.y });
        await page.waitForSelector('#node-tooltip:not(.hidden)');
        await page.locator('#tsp-antarctica').uncheck();
        await page.waitForFunction(cutoff => window.testMapArcs.length > 0 && window.testMapArcs.every(point => point.y <= cutoff), cutoff);
        assert.equal(await page.locator('#peer-tbody tr').count(), rowCount, 'hidden map placeholders remain in the table');
        assert.equal(await page.locator('#node-tooltip').evaluate(el => el.classList.contains('hidden')), true);
        await page.locator('#worldmap').dispatchEvent('mousemove', { clientX: privatePoint.x, clientY: privatePoint.y });
        assert.equal(await page.locator('#node-tooltip').evaluate(el => el.classList.contains('hidden')), true, 'hidden placeholders must not respond to hover');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#table-settings-popup', { state: 'detached' });
        assert.equal(await page.locator('#btn-table-settings').evaluate(el => document.activeElement === el), true);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelectorAll('#peer-tbody tr').length >= 10 && window.testMapArcs.length > 0);
        assert.equal(await page.evaluate(cutoff => window.testMapArcs.some(point => point.y > cutoff), cutoff), false, 'the hidden state survives reload');
        await page.locator('#btn-table-settings').click();
        assert.equal(await page.locator('#tsp-antarctica').isChecked(), false);
        await page.locator('#tsp-defaults').click();
        assert.equal(await page.locator('#tsp-antarctica').isChecked(), true);
        await page.waitForFunction(cutoff => window.testMapArcs.some(point => point.y > cutoff), cutoff);

        // Reposition while open, including a short viewport and a taller peer table.
        for (const viewport of [{ width: 1080, height: 728 }, { width: 720, height: 728 }, { width: 390, height: 480 }]) {
            await page.setViewportSize(viewport);
            const layout = await assertPopupFits(page);
            assert.equal(layout.columns, viewport.width <= 520 ? 2 : 3);
        }
        await page.keyboard.press('Escape');
        await page.locator('.peer-panel-body').dispatchEvent('click');
        assert.equal(await page.locator('body').evaluate(body => body.classList.contains('panel-focus-peers')), true);
        await page.locator('#btn-table-settings').click();
        await assertPopupFits(page);
        await page.locator('#tsp-rows').evaluate(input => {
            input.value = '20'; input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await assertPopupFits(page);
        await page.setViewportSize({ width: 720, height: 360 });
        await assertPopupFits(page);
        await page.locator('#tsp-antarctica').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#tsp-antarctica').isVisible(), true, 'settings remain reachable by scrolling');
        await page.locator('#tsp-antarctica').uncheck();
        await page.keyboard.press('Escape');
        await page.waitForSelector('#table-settings-popup', { state: 'detached' });
        await page.setViewportSize({ width: 1080, height: 728 });
        const immediateDismissal = await page.evaluate(() => {
            document.getElementById('btn-table-settings').click();
            const opened = Boolean(document.getElementById('table-settings-popup'));
            document.getElementById('worldmap').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
            return { opened, closed: !document.getElementById('table-settings-popup') };
        });
        assert.deepEqual(immediateDismissal, { opened: true, closed: true }, 'outside clicks must dismiss immediately after opening');
        await page.locator('#btn-table-settings').click();
        await assertPopupFits(page);
        await page.locator('#worldmap').dispatchEvent('click', { clientX: 50, clientY: 50 });
        await page.waitForSelector('#table-settings-popup', { state: 'detached' });
        await page.locator('#btn-table-settings').click();
        await assertPopupFits(page);
        await page.locator('#btn-autofit').click();
        await page.waitForSelector('#table-settings-popup', { state: 'detached' });
        assert.equal(await page.locator('#btn-table-settings').getAttribute('aria-expanded'), 'false', 'outside controls that stop propagation still dismiss settings');
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
}
