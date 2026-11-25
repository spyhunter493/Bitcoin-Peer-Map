import assert from 'node:assert/strict';
import { createServer } from '../scripts/benchmark-dashboard.js';

async function displayFrames(page, count = 8) {
    await page.evaluate(count => new Promise(resolve => {
        const step = () => { if (--count) requestAnimationFrame(step); else resolve(); };
        requestAnimationFrame(step);
    }), count);
}

export default async function assertPerformancePresets(browser) {
    const fixture = createServer();
    fixture.setPeerCount(70);
    await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${fixture.server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        localStorage.setItem('bpm.peerTable.display', JSON.stringify({ pulseDepthIn: 0.19, landHue: 180 }));
        window.presetNow = Date.now();
        Date.now = () => window.presetNow;
        window.presetDraws = 0; window.presetGradients = 0;
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            if (this.canvas.id === 'worldmap') window.presetDraws++;
            return clear.apply(this, args);
        };
        const gradient = CanvasRenderingContext2D.prototype.createRadialGradient;
        CanvasRenderingContext2D.prototype.createRadialGradient = function (...args) {
            if (this.canvas.id === 'worldmap') window.presetGradients++;
            return gradient.apply(this, args);
        };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const choose = async preset => {
        if (!await page.locator('#dsp-performance-preset').isVisible()) await page.locator('#topbar-gear').click();
        await page.locator('#dsp-performance-preset').selectOption(preset);
        await page.mouse.move(10, 10);
    };
    try {
        await page.goto(base, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.getElementById('peer-tbody').dataset.peerCount === '70' && window.presetDraws >= 3);
        const appearance = await page.evaluate(() => localStorage.getItem('bpm.peerTable.display'));
        assert.equal(await page.locator('html').getAttribute('data-performance-preset'), 'full');
        await choose('reduced');
        const reducedAt = await page.evaluate(() => { window.presetGradients = 0; return window.presetDraws; });
        await page.waitForFunction(before => window.presetDraws >= before + 2, reducedAt);
        assert.equal(await page.evaluate(() => window.presetGradients), 0, 'Reduced effects removes expensive peer radial gradients');
        assert.equal(await page.locator('#status-dot').evaluate(el => getComputedStyle(el).animationName), 'none');
        await choose('static');
        await displayFrames(page);
        const stoppedAt = await page.evaluate(() => window.presetDraws);
        await page.evaluate(() => { window.presetNow += 5000; });
        await displayFrames(page);
        assert.equal(await page.evaluate(() => window.presetDraws), stoppedAt,
            'Static map does not repaint for pulses or the once-per-second young-peer brightness ramp');

        fixture.setPeerCount(71);
        const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/peers');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await response;
        await page.waitForFunction(() => document.getElementById('peer-tbody').dataset.peerCount === '71');
        await page.waitForFunction(before => window.presetDraws > before, stoppedAt);
        const beforeZoom = await page.evaluate(() => window.presetDraws);
        await page.locator('#zoom-in').click();
        await page.waitForFunction(before => window.presetDraws > before, beforeZoom);
        await choose('full');
        const fullAt = await page.evaluate(() => window.presetDraws);
        await page.waitForFunction(before => window.presetDraws >= before + 3, fullAt);
        assert.equal(await page.evaluate(() => localStorage.getItem('bpm.peerTable.display')), appearance,
            'returning to Full preserves the saved Advanced appearance values');

        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await page.locator('html').getAttribute('data-performance-preset'), 'full');
        await page.waitForFunction(() => document.documentElement.dataset.performanceMotion === 'static');
        assert.equal(await page.locator('#status-dot').evaluate(el => getComputedStyle(el).animationName), 'none',
            'Full visuals cannot override operating-system reduced motion');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await choose('static');
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.locator('html').getAttribute('data-performance-preset'), 'static', 'the selected preset survives reload');
        await page.locator('#mo-row-peers').click();
        await page.locator('#system-info-modal').waitFor();
        const beforeModal = await page.evaluate(() => window.presetDraws);
        await displayFrames(page);
        assert.equal(await page.evaluate(() => window.presetDraws), beforeModal, 'shared dialogs retain their map rendering pause');
        await page.keyboard.press('Escape');
        await choose('full');
        await page.waitForFunction(before => window.presetDraws > before, beforeModal);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
        fixture.server.closeAllConnections();
        await new Promise(resolve => fixture.server.close(resolve));
    }
}
