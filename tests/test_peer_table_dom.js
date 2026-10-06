import assert from 'node:assert/strict';

export default async function assertTableDom(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        const original = window.setInterval.bind(window);
        window.setInterval = (handler, interval, ...args) => {
            if (interval === 10000) {
                window.testPeerPoll = handler;
                return original(handler, 3600000, ...args);
            }
            return original(handler, interval, ...args);
        };
    });
    const page = await context.newPage();
    const seed = await (await page.request.get(`${baseUrl}/api/peers?include_status=true`)).json();
    let peers = seed.peers.filter(peer => peer.network === 'ipv4').slice(0, 3)
        .map((peer, index) => ({ ...peer, id: index + 1, ping_ms: 20 + index * 10 }));
    peers[0].addr = '<img src=x onerror=alert(1)>';
    let releaseInitial;
    const firstSnapshot = new Promise(resolve => { releaseInitial = resolve; });
    let initialRequest = true;
    await page.route('**/api/peers?include_status=true', async route => {
        if (initialRequest) { initialRequest = false; await firstSnapshot; }
        await route.fulfill({ json: { ...seed, peers } });
    });
    async function poll() {
        const response = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
        await page.evaluate(() => window.testPeerPoll());
        await response;
        await page.waitForTimeout(100);
    }
    try {
        await page.goto(baseUrl);
        const emptyColumns = await page.locator('#peer-table col').evaluateAll(columns => columns.map(column => column.style.width));
        releaseInitial();
        await page.waitForSelector('#peer-tbody tr[data-id="1"]');
        assert.notDeepEqual(await page.locator('#peer-table col').evaluateAll(columns => columns.map(column => column.style.width)), emptyColumns,
            'the first peer snapshot replaces the initial empty-table width estimates');
        await page.evaluate(() => {
            const row = document.querySelector('#peer-tbody tr[data-id="1"]');
            window.testTableElements = { row, duration: row.cells[2], ping: row.cells[12] };
        });
        assert.equal(await page.locator('#peer-tbody img').count(), 0);
        assert.match(await page.locator('#peer-tbody tr[data-id="1"]').textContent(), /<img src=x/);
        peers = peers.map(peer => peer.id === 1 ? { ...peer, ping_ms: 21 } : peer);
        await poll();
        assert.equal(await page.evaluate(() => {
            const { row, duration, ping } = window.testTableElements;
            return row === document.querySelector('#peer-tbody tr[data-id="1"]') &&
                row.cells[2] === duration && row.cells[12] === ping && ping.textContent.includes('21');
        }), true, 'changed polls update cells in place');
        const columnWidths = () => page.locator('#peer-table col').evaluateAll(columns => columns.map(column => column.style.width));
        const wideColumns = await columnWidths();
        const originalScroll = await page.locator('.peer-table-wrap').evaluate(viewport => viewport.scrollTop);
        await page.setViewportSize({ width: 900, height: 900 });
        await page.waitForFunction(previous => JSON.stringify([...document.querySelectorAll('#peer-table col')].map(column => column.style.width)) !== JSON.stringify(previous), wideColumns);
        const fittedColumns = await columnWidths();
        assert.equal(await page.locator('#btn-autofit').evaluate(button => button.classList.contains('active')), true);
        assert.equal(await page.evaluate(() => window.testTableElements.row === document.querySelector('#peer-tbody tr[data-id="1"]')), true);
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('#peer-table col')].map(column => column.style.width)) === JSON.stringify(expected), wideColumns);
        assert.deepEqual(await columnWidths(), wideColumns, 'auto-fit restores the original widths after a viewport round trip');
        assert.equal(await page.locator('#btn-autofit').evaluate(button => button.classList.contains('active')), true);
        assert.equal(await page.evaluate(() => window.testTableElements.row === document.querySelector('#peer-tbody tr[data-id="1"]')), true,
            'viewport round trips retain peer row identity');
        assert.equal(await page.locator('.peer-table-wrap').evaluate(viewport => viewport.scrollTop), originalScroll,
            'viewport round trips retain the table scroll position');
        await page.setViewportSize({ width: 900, height: 900 });
        await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('#peer-table col')].map(column => column.style.width)) === JSON.stringify(expected), fittedColumns);
        await page.click('#btn-autofit');
        const manualColumns = await columnWidths();
        await page.setViewportSize({ width: 1400, height: 900 });
        peers = peers.map(peer => ({ ...peer, isp: 'A much longer provider label to change the measured column widths' }));
        await poll();
        assert.deepEqual(await columnWidths(), manualColumns, 'manual columns survive resize and changed peer data');
        await page.click('#btn-autofit');
        const longColumns = await columnWidths();
        assert.notDeepEqual(longColumns, fittedColumns, 're-enabling auto-fit uses current size and current data');
        peers = peers.map(peer => ({ ...peer, isp: 'Short' }));
        await poll();
        assert.notDeepEqual(await columnWidths(), longColumns, 'data width changes re-fit without a header interaction');
        await page.click('th[data-sort="ping_ms"]');
        await page.click('th[data-sort="ping_ms"]');
        assert.deepEqual(await page.locator('#peer-tbody tr').evaluateAll(rows => rows.map(row => Number(row.dataset.id))), [3, 2, 1]);
        peers = [peers[0], peers[1], { ...peers[2], id: 4 }];
        await poll();
        assert.deepEqual(await page.locator('#peer-tbody tr').evaluateAll(rows => rows.map(row => Number(row.dataset.id)).sort()), [1, 2, 4]);
        assert.equal(await page.evaluate(() => window.testTableElements.row === document.querySelector('#peer-tbody tr[data-id="1"]')), true);
    } finally {
        releaseInitial();
        await context.close();
    }
}
