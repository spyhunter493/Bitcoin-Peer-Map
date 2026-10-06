import assert from 'node:assert/strict';

export default async function assertMapInput(browser, baseUrl) {
    const context = await browser.newContext({
        viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce',
    });
    await context.addInitScript(now => {
        Date.now = () => now;
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
    }, Date.now());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.querySelectorAll('#peer-tbody tr').length > 0);
        await page.mouse.move(10, 10);
        const canvas = page.locator('#worldmap');
        const hashes = async () => {
            try {
                await page.waitForFunction(() => {
                    const transform = getComputedStyle(document.getElementById('basemap')).transform;
                    return !document.body.classList.contains('map-camera-moving') &&
                        !document.body.classList.contains('map-interacting') &&
                        (transform === 'none' || new DOMMatrixReadOnly(transform).isIdentity);
                });
            } catch (error) {
                const state = await page.evaluate(() => ({
                    classes: document.body.className,
                    transform: document.getElementById('basemap').style.transform,
                }));
                error.message += `\nCanvas state: ${JSON.stringify(state)}\nBrowser errors: ${JSON.stringify(errors)}`;
                throw error;
            }
            // Wait for an actual frame after a pending redraw;
            // a wall-clock pause can end before a throttled browser redraws.
            await page.evaluate(() => new Promise(resolve => {
                const started = performance.now();
                const afterFrame = timestamp => {
                    if (timestamp - started >= 150) resolve();
                    else requestAnimationFrame(afterFrame);
                };
                requestAnimationFrame(afterFrame);
            }));
            return page.evaluate(async () => Promise.all(['basemap', 'worldmap', 'map-connections'].map(async id => {
                const el = document.getElementById(id);
                const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
                const digest = await crypto.subtle.digest('SHA-256', pixels);
                return Array.from(new Uint8Array(digest));
            })));
        };
        const initial = await hashes();
        const dimensions = () => canvas.evaluate(el => ({ width: el.width, height: el.height }));
        assert.deepEqual(await dimensions(), { width: 1800, height: 1350 });

        for (let i = 0; i < 15; i++) await page.locator('#zoom-in').click();
        await page.waitForLoadState('networkidle');
        const zoomed = await hashes();
        assert.notDeepEqual(zoomed[0], initial[0], 'zoom loads and draws detailed geography');
        await page.locator('#zoom-out').click();
        const zoomedOut = await hashes();
        assert.notDeepEqual(zoomedOut[0], zoomed[0], 'zoom-out changes the camera');

        await page.mouse.move(100, 200);
        await page.mouse.down();
        await page.mouse.move(250, 250, { steps: 4 });
        await page.waitForFunction(() => document.getElementById('basemap').style.transform !== 'none');
        assert.deepEqual(await dimensions(), { width: 1200, height: 900 },
            'dragging uses the interaction DPI cap');
        await page.mouse.up();
        const panned = await hashes();
        assert.notDeepEqual(panned[0], zoomedOut[0], 'dragging pans the cached map and redraws on release');
        assert.deepEqual(await dimensions(), { width: 1800, height: 1350 });
        assert.equal(await page.locator('.peer-detail-popup').count(), 0, 'a drag does not select a peer');

        await canvas.dispatchEvent('wheel', { clientX: 250, clientY: 250, deltaY: -100 });
        assert.deepEqual(await dimensions(), { width: 1200, height: 900 });
        const wheeled = await hashes();
        assert.notDeepEqual(wheeled[0], panned[0], 'wheel input zooms toward the cursor');
        assert.deepEqual(await dimensions(), { width: 1800, height: 1350 });

        const touch = (clientX, clientY) => [{ identifier: 1, clientX, clientY }];
        await canvas.dispatchEvent('touchstart', { touches: touch(250, 250) });
        await canvas.dispatchEvent('touchmove', { touches: touch(300, 290) });
        assert.deepEqual(await dimensions(), { width: 1200, height: 900 });
        await canvas.dispatchEvent('touchend', { touches: [] });
        const touched = await hashes();
        assert.notDeepEqual(touched[0], wheeled[0], 'single-finger touch input pans the map');
        await canvas.dispatchEvent('touchstart', { touches: touch(250, 250) });
        await page.evaluate(() => new Promise(requestAnimationFrame));
        await canvas.dispatchEvent('touchcancel', { touches: [] });
        assert.deepEqual(await hashes(), touched, 'cancelled touch preserves the camera and rendered pixels');
        assert.deepEqual(await dimensions(), { width: 1800, height: 1350 },
            'cancelled touch restores idle DPI');

        await page.locator('#zoom-reset').click();
        await page.mouse.move(10, 10);
        assert.deepEqual(await hashes(), initial, 'reset restores both original canvas layers');
        await page.setViewportSize({ width: 1100, height: 800 });
        await hashes();
        assert.deepEqual(await dimensions(), { width: 1650, height: 1200 });
        assert.deepEqual(await page.locator('#basemap').evaluate(el => ({ width: el.width, height: el.height })),
            { width: 1650, height: 1200 }, 'resize updates both canvas surfaces');
        assert.deepEqual(await page.locator('#map-connections').evaluate(el => ({ width: el.width, height: el.height })),
            { width: 1650, height: 1200 }, 'resize updates the cached connection layer');
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
