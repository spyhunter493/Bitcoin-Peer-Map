import assert from 'node:assert/strict';

export default async function assertMapInput(browser, baseUrl) {
    const context = await browser.newContext({
        viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce',
    });
    await context.addInitScript(now => {
        Date.now = () => now;
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        window.wrappedMapPoints = [];
        const arc = CanvasRenderingContext2D.prototype.arc;
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.arc = function(x, y, ...args) {
            if (this.canvas.id === 'worldmap') window.wrappedMapPoints.push({ x, y });
            return arc.call(this, x, y, ...args);
        };
        CanvasRenderingContext2D.prototype.clearRect = function(...args) {
            if (this.canvas.id === 'worldmap') window.wrappedMapPoints = [];
            return clear.apply(this, args);
        };
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

        const dragStart = await canvas.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            for (const yFraction of [0.3, 0.4, 0.5]) {
                for (const xFraction of [0.4, 0.5, 0.3]) {
                    const x = bounds.x + bounds.width * xFraction;
                    const y = bounds.y + bounds.height * yFraction;
                    if (document.elementFromPoint(x, y) === element &&
                        document.elementFromPoint(x + 150, y + 50) === element) return { x, y };
                }
            }
            return null;
        });
        assert.ok(dragStart, 'a canvas location is available outside the dashboard controls');
        await page.mouse.move(dragStart.x, dragStart.y);
        await page.mouse.down();
        await page.mouse.move(dragStart.x + 150, dragStart.y + 50, { steps: 4 });
        await page.waitForFunction(() => document.getElementById('basemap').style.transform !== 'none');
        assert.deepEqual(await dimensions(), { width: 1200, height: 900 },
            'dragging uses the interaction DPI cap');
        await page.mouse.up();
        const panned = await hashes();
        assert.notDeepEqual(panned[0], zoomedOut[0], 'dragging pans the cached map and redraws on release');
        assert.deepEqual(await dimensions(), { width: 1800, height: 1350 });
        assert.equal(await page.locator('.peer-detail-popup').count(), 0, 'a drag does not select a peer');

        const wheelDimensions = await canvas.evaluate(element => {
            element.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true, cancelable: true, clientX: 250, clientY: 250, deltaY: -100,
            }));
            // Observe the transient DPI cap before its 140ms reset timer can run.
            return { width: element.width, height: element.height };
        });
        assert.deepEqual(wheelDimensions, { width: 1200, height: 900 });
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
        async function panWorlds(direction) {
            await page.locator('#peer-tbody').dispatchEvent('mouseleave');
            for (let index = 0; index < 8; index++) {
                await canvas.dispatchEvent('mousedown', { clientX: 100, clientY: 350 });
                await page.evaluate(direction => {
                    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + direction * innerWidth, clientY: 350 }));
                }, direction);
                await page.evaluate(() => new Promise(requestAnimationFrame));
                await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 350 })));
            }
            const wrapped = await hashes();
            assert.deepEqual(wrapped[0], initial[0], 'geography repeats after panning across eight complete worlds');
            const point = await page.evaluate(() => window.wrappedMapPoints.find(point => point.x > 100 && point.x < 800 && point.y > 70 && point.y < 550));
            assert.ok(point, 'wrapped copies still render peer dots');
            await canvas.dispatchEvent('mousemove', { clientX: point.x, clientY: point.y });
            await page.waitForSelector('#node-tooltip:not(.hidden)');
            await page.locator('#peer-tbody tr.row-highlight').first().dispatchEvent('mouseover');
            assert.notDeepEqual((await hashes())[1], wrapped[1], 'wrapped peer hover still draws highlight rings');
            await page.mouse.move(10, 10);
            await page.locator('#zoom-reset').click();
            await hashes();
        }
        await panWorlds(1);
        await panWorlds(-1);
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
