import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export default async function assertPeerBandwidth(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        const schedule = window.setInterval.bind(window);
        window.setInterval = (handler, interval, ...args) => {
            if (interval === 10000) {
                window.bandwidthPoll = handler;
                return schedule(handler, 3600000, ...args);
            }
            return schedule(handler, interval, ...args);
        };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const seed = await (await page.request.get(`${baseUrl}/api/peers?include_status=true`)).json();
    const template = seed.peers.find(peer => peer.network === 'ipv4');
    let peers = [
        { ...template, id: 1001, tx_bps: 1024, rx_bps: 0 },
        { ...template, id: 1002, tx_bps: 102400, rx_bps: 512 },
        { ...template, id: 1003, network: 'onion', addr: 'bandwidth.onion:8333', is_public: false, location_status: 'private', tx_bps: null, rx_bps: 2048 },
        { ...template, id: 1004, tx_bps: 0, rx_bps: null },
    ].map(peer => ({ ...peer, bytessent: 2048, bytesrecv: 4096, bytessent_fmt: '2.0 KB', bytesrecv_fmt: '4.0 KB' }));
    let connected = true;
    await page.route('**/api/peers?include_status=true', route => route.fulfill({ json: {
        ...seed, peers, status: { ...seed.status, connected, age_seconds: connected ? 0 : 5 },
    } }));
    const ids = () => page.locator('#peer-tbody tr[data-id]').evaluateAll(rows => rows.map(row => Number(row.dataset.id)));
    async function cell(id, key) {
        const index = await page.locator(`th[data-sort="${key}"]`).evaluate(th => th.cellIndex);
        return page.locator(`tr[data-id="${id}"] td`).nth(index).textContent();
    }
    async function waitCell(id, key, value) {
        await page.waitForFunction(({ id, key, value }) => {
            const index = document.querySelector(`th[data-sort="${key}"]`)?.cellIndex;
            return document.querySelector(`tr[data-id="${id}"]`)?.cells[index]?.textContent === value;
        }, { id, key, value });
    }
    async function poll() {
        const received = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
        await page.evaluate(() => window.bandwidthPoll());
        await received;
    }
    async function download(kind) {
        await page.locator('#btn-export-peers').click();
        const received = page.waitForEvent('download');
        await page.locator(`#peer-export-${kind}`).click();
        const file = await received;
        assert.equal(await file.failure(), null);
        const text = await readFile(await file.path(), 'utf8');
        return kind === 'json' ? JSON.parse(text) : text.trimEnd().split('\r\n').map(row => row.split(','));
    }
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await waitCell(1001, 'tx_bps', '1.0 KB/s');
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForFunction(() => {
            const table = document.querySelector('#peer-table');
            return table.scrollWidth <= table.closest('.peer-table-wrap').clientWidth + 1;
        });
        await page.setViewportSize({ width: 1638, height: 900 });
        const keys = await page.locator('th[data-sort]').evaluateAll(columns => columns.map(column => column.dataset.sort));
        assert.equal(keys[keys.indexOf('bytessent_fmt') + 1], 'tx_bps');
        assert.equal(keys[keys.indexOf('bytesrecv_fmt') + 1], 'rx_bps');
        assert.equal(await cell(1001, 'rx_bps'), '0 B/s');
        assert.equal(await cell(1002, 'rx_bps'), '512 B/s');
        assert.equal(await cell(1003, 'tx_bps'), '—');
        assert.equal(await cell(1003, 'rx_bps'), '2.0 KB/s', 'private peers expose rates too');
        assert.equal(await cell(1001, 'bytessent_fmt'), '2.0 KB');
        assert.equal(await cell(1001, 'bytesrecv_fmt'), '4.0 KB');

        await page.locator('th[data-sort="tx_bps"] button').click();
        assert.deepEqual(await ids(), [1004, 1001, 1002, 1003]);
        await page.locator('th[data-sort="tx_bps"] button').click();
        assert.deepEqual(await ids(), [1002, 1001, 1004, 1003]);
        await page.locator('th[data-sort="rx_bps"] button').click();
        assert.deepEqual(await ids(), [1001, 1002, 1003, 1004]);
        await page.locator('th[data-sort="rx_bps"] button').click();
        assert.deepEqual(await ids(), [1003, 1002, 1001, 1004]);

        await page.locator('tr[data-id="1001"] button[data-action="details"]').click();
        await page.locator('.peer-detail-popup.visible').waitFor();
        assert.match(await page.locator('.peer-detail-popup').textContent(), /Send rate1\.0 KB\/s/);
        assert.match(await page.locator('.peer-detail-popup').textContent(), /Recv rate0 B\/s/);
        await page.locator('.peer-detail-popup').evaluate(popup => { popup.dataset.bandwidthPopup = 'retained'; });

        // RPC outages keep their snapshot timestamp. Clear rates while retaining
        // the cached peer rows and cumulative counters.
        connected = false;
        await poll();
        await waitCell(1001, 'tx_bps', '—');
        assert.equal(await cell(1001, 'rx_bps'), '—');
        assert.equal(await cell(1001, 'bytessent_fmt'), '2.0 KB');
        assert.match(await page.locator('.peer-detail-popup').textContent(), /Send rate—/);
        assert.match(await page.locator('.peer-detail-popup').textContent(), /Recv rate—/);
        assert.equal(await page.locator('.peer-detail-popup').getAttribute('data-bandwidth-popup'), 'retained');
        const cached = await download('json');
        assert.ok(cached.peers.every(peer => peer.tx_bps === null && peer.rx_bps === null));
        connected = true;
        peers = peers.map(peer => ({ ...peer, tx_bps: null, rx_bps: null }));
        await poll();
        await waitCell(1001, 'tx_bps', '—');
        peers = peers.map(peer => ({ ...peer, tx_bps: 2048, rx_bps: 512 }));
        await poll();
        await waitCell(1001, 'tx_bps', '2.0 KB/s');
        assert.equal(await cell(1001, 'rx_bps'), '512 B/s');
        assert.match(await page.locator('.peer-detail-popup').textContent(), /Send rate2\.0 KB\/s/);
        assert.match(await page.locator('.peer-detail-popup').textContent(), /Recv rate512 B\/s/);
        peers = peers.map(peer => peer.id === 1001 ? { ...peer, tx_bps: 1048576, rx_bps: 1536 } : peer);
        await poll();
        await waitCell(1001, 'tx_bps', '1.0 MB/s');
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            const bounds = await page.locator('.peer-detail-popup.visible').boundingBox();
            assert.ok(bounds.x >= 8 && bounds.x + bounds.width <= width - 8,
                `peer details and rate values must fit the ${width}px viewport`);
            for (const key of ['tx_bps', 'rx_bps']) {
                const index = await page.locator(`th[data-sort="${key}"]`).evaluate(th => th.cellIndex);
                const dimensions = await page.locator('tr[data-id="1001"] td').nth(index).evaluate(cell => ({
                    width: cell.clientWidth, content: cell.scrollWidth,
                }));
                assert.ok(dimensions.width >= 96 && dimensions.content <= dimensions.width,
                    `${key} must retain its readable value and units at ${width}px`);
            }
            assert.equal(await page.evaluate(() => document.body.scrollWidth <= innerWidth), true,
                'wide columns must scroll inside the table rather than widen the page');
        }
        await page.setViewportSize({ width: 1638, height: 900 });
        await page.keyboard.press('Escape');
        if (await page.locator('#peer-clear-filters').isVisible()) await page.locator('#peer-clear-filters').click();

        await page.locator('tr[data-id="1003"] button[data-action="details"]').click();
        await page.locator('.peer-detail-popup.visible').waitFor();
        assert.match(await page.locator('.peer-detail-popup').textContent(), /Send rate2\.0 KB\/s/);
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            const bounds = await page.locator('.peer-detail-popup.visible').boundingBox();
            assert.ok(bounds.x >= 8 && bounds.x + bounds.width <= width - 8,
                `private peer details must fit the ${width}px viewport`);
        }
        await page.setViewportSize({ width: 1638, height: 900 });
        await page.keyboard.press('Escape');
        if (await page.locator('#peer-clear-filters').isVisible()) await page.locator('#peer-clear-filters').click();

        peers = Array.from({ length: 500 }, (_, index) => ({
            ...template, id: 2001 + index, subver: 'Bandwidth Bulk', tx_bps: 1024 * (index + 1), rx_bps: 0,
            bytessent_fmt: '2.0 KB', bytesrecv_fmt: '4.0 KB',
        }));
        await poll();
        await page.locator('#peer-search').fill('Bandwidth Bulk');
        await page.waitForFunction(() => document.querySelector('#peer-match-count').textContent.trim() === '500 of 500 peers');
        assert.ok((await ids()).length < 40, 'downloads must include unmounted peers');
        await page.locator('th[data-sort="tx_bps"] button').click();
        await page.locator('th[data-sort="tx_bps"] button').click();
        const json = await download('json');
        assert.equal(json.count, 500);
        assert.equal(json.peers[0].tx_bps, 512000);
        assert.equal(json.peers.at(-1).tx_bps, 1024);
        assert.equal(json.peers[0].rx_bps, 0);
        assert.equal(json.filters.search, 'Bandwidth Bulk');
        const csv = await download('csv');
        assert.equal(csv.length, 501);
        assert.equal(csv[1][csv[0].indexOf('Send rate')], '500.0 KB/s');
        assert.equal(csv.at(-1)[csv[0].indexOf('Send rate')], '1.0 KB/s');
        assert.equal(csv[1][csv[0].indexOf('Recv rate')], '0 B/s');

        // Existing custom tables keep their columns. Defaults adds the rate columns.
        await page.evaluate(() => localStorage.setItem('bpm.peerTable.display', JSON.stringify({ visibleColumns: ['id', 'bytessent_fmt'] })));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('th[data-sort="bytessent_fmt"]');
        assert.equal(await page.locator('th[data-sort="tx_bps"]').count(), 0);
        await page.locator('#btn-table-settings').click();
        await page.locator('#tsp-defaults').click();
        assert.equal(await page.locator('th[data-sort="tx_bps"]').count(), 1);
        assert.equal(await page.locator('th[data-sort="rx_bps"]').count(), 1);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
