import assert from 'node:assert/strict';
import { project } from '../src/static/js/map/geometry.js';

export default async function assertPeerAccuracy(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        const schedule = window.setInterval.bind(window);
        window.setInterval = (handler, interval, ...args) => {
            if (interval === 10000) {
                window.accuracyPoll = handler;
                return schedule(handler, 3600000, ...args);
            }
            return schedule(handler, interval, ...args);
        };
        const arc = CanvasRenderingContext2D.prototype.arc;
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        window.accuracyMapArcs = [];
        CanvasRenderingContext2D.prototype.arc = function(x, y, ...args) {
            if (this.canvas.id === 'worldmap') window.accuracyMapArcs.push({ x, y });
            return arc.call(this, x, y, ...args);
        };
        CanvasRenderingContext2D.prototype.clearRect = function(...args) {
            if (this.canvas.id === 'worldmap') window.accuracyMapArcs = [];
            return clear.apply(this, args);
        };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const seed = await (await page.request.get(`${baseUrl}/api/peers?include_status=true`)).json();
    const publicPeer = seed.peers.find(peer => peer.network === 'ipv4' && peer.is_public);
    assert.ok(publicPeer);
    const order = [4, 1, 12, 7, 2, 6, 3, 5, 8, 9, 10, 11, 13];
    const values = { 1: 10, 2: 2, 3: 30, 4: -2.5, 5: 0, 6: 2.004, 7: 2.003, 12: 2.003 };
    let peers = order.map(id => ({ ...publicPeer, id, lat: values[id] ?? 0, lon: -(values[id] ?? 0),
        location_status: id === 8 ? 'pending' : id === 9 ? 'private' : id === 10 ? 'unavailable' : 'ok',
        in_addrman: true, addrman_status: id === 1 ? 'present' : id === 2 ? 'not_returned' : 'unavailable',
    }));
    peers.find(peer => peer.id === 11).lat = null;
    peers.find(peer => peer.id === 11).lon = null;
    delete peers.find(peer => peer.id === 12).location_status;
    delete peers.find(peer => peer.id === 13).lat;
    delete peers.find(peer => peer.id === 13).lon;
    delete peers.find(peer => peer.id === 4).addrman_status;
    peers.find(peer => peer.id === 5).addrman_status = 'unexpected';
    await page.route('**/api/peers?include_status=true', route => route.fulfill({ json: {
        ...seed, peers, status: { ...seed.status, last_success_at: Date.now() / 1000, age_seconds: 0 },
    } }));
    const ids = () => page.locator('#peer-tbody tr[data-id]').evaluateAll(rows => rows.map(row => Number(row.dataset.id)));
    async function cell(id, key) {
        const index = await page.locator(`th[data-sort="${key}"]`).evaluate(header => header.cellIndex);
        return page.locator(`#peer-tbody tr[data-id="${id}"] td`).nth(index);
    }
    async function poll() {
        const received = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
        await page.evaluate(() => window.accuracyPoll());
        await received;
    }
    const ascending = [4, 5, 2, 12, 7, 6, 1, 3, 8, 9, 10, 11, 13];
    const descending = [3, 1, 6, 12, 7, 2, 5, 4, 8, 9, 10, 11, 13];
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#peer-tbody tr[data-id="13"]');
        await page.locator('#btn-table-settings').click();
        for (const key of ['lat', 'lon']) await page.locator(`#table-settings-popup input[data-col="${key}"]`).check();
        await page.keyboard.press('Escape');
        for (const [id, label] of [[1, 'Yes'], [2, 'Not returned'], [3, 'Unavailable'], [4, 'Unavailable'], [5, 'Unavailable']]) {
            const status = await cell(id, 'in_addrman');
            assert.equal(await status.textContent(), label);
            assert.equal(await status.getAttribute('title'), label, 'hover text retains the full Addrman status');
        }
        assert.equal(await (await cell(4, 'lat')).textContent(), '-2.50');
        assert.equal(await (await cell(5, 'lat')).textContent(), '0.00');
        assert.equal(await (await cell(12, 'lat')).textContent(), '2.00', 'older responses without location_status retain valid coordinates');
        for (const id of [8, 9, 10, 11, 13]) {
            for (const key of ['lat', 'lon']) assert.equal(await (await cell(id, key)).textContent(), '—');
        }
        for (const [key, up, down] of [['lat', ascending, descending], ['lon', descending, ascending]]) {
            const header = page.locator(`th[data-sort="${key}"]`), button = header.locator('button');
            await button.click();
            assert.equal(await header.getAttribute('aria-sort'), 'ascending');
            assert.deepEqual(await ids(), up, `${key} sorts raw numbers, preserves equal ties, and keeps missing coordinates last`);
            await button.click();
            assert.equal(await header.getAttribute('aria-sort'), 'descending');
            assert.deepEqual(await ids(), down);
            await button.click();
            assert.equal(await header.getAttribute('aria-sort'), null);
            assert.deepEqual(await ids(), order, 'unsorted restores snapshot order');
        }
        await page.locator('th[data-sort="lat"] button').click();
        peers = peers.map(peer => peer.id === 8 ? { ...peer, location_status: 'ok', lat: 0, lon: 0, addrman_status: 'present' } : peer);
        await poll();
        await page.waitForFunction(() => {
            const column = document.querySelector('th[data-sort="lat"]').cellIndex;
            return document.querySelector('tr[data-id="8"]').cells[column].textContent === '0.00';
        });
        assert.deepEqual(await ids(), [4, 5, 8, 2, 12, 7, 6, 1, 3, 9, 10, 11, 13]);
        assert.equal(await (await cell(8, 'in_addrman')).textContent(), 'Yes');
        await page.locator('th[data-sort="lat"] button').click();
        assert.deepEqual(await ids(), [3, 1, 6, 12, 7, 2, 5, 8, 4, 9, 10, 11, 13]);
        await page.locator('th[data-sort="lat"] button').click();
        assert.deepEqual(await ids(), order);

        // The same uncertainty label reaches the real details and canvas tooltip.
        const details = page.locator('tr[data-id="2"] button[data-action="details"]');
        await details.click();
        await page.locator('.peer-detail-popup.visible').waitFor();
        assert.match(await page.locator('.peer-detail-popup').textContent(), /AddrmanNot returned/);
        await page.keyboard.press('Escape');
        await page.locator('.peer-detail-popup').waitFor({ state: 'detached' });
        if (await page.locator('#as-focused-close').isVisible()) await page.locator('#as-focused-close').click();
        peers = [{ ...publicPeer, id: 200, lat: 20, lon: 0, addrman_status: 'not_returned' }];
        await poll();
        await page.waitForSelector('#peer-tbody tr[data-id="200"]');
        await page.locator('#zoom-reset').click();
        const projected = project(0, 20), viewport = page.viewportSize();
        const point = { x: projected.x * viewport.width, y: projected.y * viewport.height };
        await page.waitForFunction(point => window.accuracyMapArcs.some(arc => Math.abs(arc.x - point.x) < 1 && Math.abs(arc.y - point.y) < 1), point);
        const bounds = await page.locator('#worldmap').boundingBox();
        await page.locator('#worldmap').dispatchEvent('mousemove', { clientX: bounds.x + point.x, clientY: bounds.y + point.y });
        await page.locator('#node-tooltip:not(.hidden)').waitFor();
        assert.match(await page.locator('#node-tooltip').textContent(), /AddrmanNot returned/);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
