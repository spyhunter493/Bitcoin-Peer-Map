import assert from 'node:assert/strict';
import { project } from '../src/static/js/map/geometry.js';

export default async function assertMapGroups(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        const interval = window.setInterval;
        window.setInterval = (handler, ms, ...args) => {
            if (ms === 10000) {
                window.testPeerPoll = handler;
                return interval(handler, 3600000, ...args);
            }
            return interval(handler, ms, ...args);
        };
        window.testPointerListeners = new Set();
        const add = document.addEventListener.bind(document);
        const remove = document.removeEventListener.bind(document);
        document.addEventListener = (type, listener, ...args) => {
            if (type === 'mousemove' || type === 'mouseup') window.testPointerListeners.add(listener);
            return add(type, listener, ...args);
        };
        document.removeEventListener = (type, listener, ...args) => {
            window.testPointerListeners.delete(listener);
            return remove(type, listener, ...args);
        };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        const seed = await (await page.request.get(baseUrl + '/api/peers?include_status=true')).json();
        const initial = seed.peers.slice(0, 2).map(peer => ({ ...peer, lat: 20, lon: 0 }));
        let peers = initial;
        await page.route('**/api/peers?include_status=true', route => route.fulfill({ json: { ...seed, peers } }));
        const poll = async () => {
            const received = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
            await page.evaluate(() => window.testPeerPoll());
            await received;
            await page.waitForTimeout(100);
        };
        const rows = () => page.locator('#node-tooltip .tt-group-clickable').evaluateAll(elements => elements.map(el => Number(el.dataset.peerId)).sort((a,b) => a-b));
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelectorAll('#peer-tbody tr').length === 2);
        const point = project(0, 20);
        await page.locator('#worldmap').click({ position: { x: point.x * 1638, y: point.y * 900 } });
        assert.deepEqual(await rows(), [1, 2]);
        const geometry = await page.locator('#node-tooltip').evaluate(el => [el.style.left, el.style.top]);
        peers = peers.concat({ ...initial[0], id: 90 });
        await poll();
        assert.deepEqual(await rows(), [1, 2, 90]);
        assert.deepEqual(await page.locator('#node-tooltip').evaluate(el => [el.style.left, el.style.top]), geometry);
        peers = peers.filter(peer => peer.id !== 1);
        await poll();
        assert.deepEqual(await rows(), [2, 90]);
        await page.locator('#node-tooltip [data-peer-id="2"]').click();
        await page.waitForSelector('.peer-detail-popup.visible');
        assert.equal(await page.locator('.peer-popup-back').count(), 1);
        const listeners = () => page.evaluate(() => window.testPointerListeners.size);
        const before = await listeners();
        await page.locator('.peer-popup-header').dispatchEvent('mousedown', { clientX: 100, clientY: 100 });
        assert.equal(await listeners(), before + 2);
        await page.locator('.peer-popup-back').dispatchEvent('click');
        await page.waitForSelector('.multi-peer-row');
        assert.equal(await listeners(), before, 'replacing a dragged popup releases its listeners');
        peers = peers.filter(peer => peer.id !== 2).concat({ ...initial[0], id: 91 });
        await poll();
        assert.deepEqual(await page.locator('.multi-peer-row').evaluateAll(elements => elements.map(el => Number(el.dataset.peerId))), [90, 91]);
        await page.locator('.multi-peer-row[data-peer-id="90"]').click();
        await page.waitForSelector('.peer-popup-resize-handle');
        await page.locator('.peer-popup-resize-handle').dispatchEvent('mousedown', { clientX: 100, clientY: 100 });
        assert.equal(await listeners(), before + 2);
        await page.locator('.peer-popup-back').dispatchEvent('click');
        assert.equal(await listeners(), before, 'replacing a resized popup releases its listeners');
        await page.locator('.peer-popup-close').click();
        await page.waitForSelector('.peer-detail-popup', { state: 'detached' });
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
}
