import assert from 'node:assert/strict';

export default async function assertPeerActionGeometry(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await context.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    const page = await context.newPage();
    const snapshot = await (await page.request.get(`${baseUrl}/api/peers?include_status=true`)).json();
    const publicPeer = snapshot.peers.find(peer => peer.network === 'ipv4' && peer.is_public);
    const peers = Array.from({ length: 500 }, (_, index) => ({ ...publicPeer, id: index + 1 }));
    await page.route('**/api/peers?include_status=true', route => route.fulfill({ json: { ...snapshot, peers } }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#peer-tbody tr[data-net="ipv4"]');
        // Exercise fallback fonts and enlarged action text, as with a browser's
        // minimum font size. The Actions column must use the rendered controls.
        await page.addStyleTag({ content: '.peer-table .peer-action-btn { font-family: "Unavailable BPM font", monospace; font-size: 13px; }' });
        for (const width of [900, 520, 1638, 320]) {
            if (width === 320) await page.addStyleTag({ content: '.peer-table .peer-action-btn { font-size: 36px; }' });
            await page.setViewportSize({ width, height: 900 });
            assert.equal(await page.locator('#peer-tbody .peer-table-spacer').count(), 2,
                'width measurement skips the leading virtual spacer');
            const details = page.locator('#peer-tbody tr[data-net="ipv4"] button[data-action="details"]').first();
            const disconnect = page.locator('#peer-tbody tr[data-net="ipv4"] button[data-action="disconnect"]').first();
            await disconnect.scrollIntoViewIfNeeded();
            await page.waitForFunction(() => {
                const button = document.querySelector('#peer-tbody tr[data-net="ipv4"] button[data-action="disconnect"]');
                const cell = button?.closest('td');
                if (!button || !cell) return false;
                return button.getBoundingClientRect().right <= cell.getBoundingClientRect().right - 4;
            });
            for (const button of [details, disconnect]) {
                await button.scrollIntoViewIfNeeded();
                const geometry = await button.evaluate(element => {
                    const rect = element.getBoundingClientRect();
                    const cell = element.closest('td').getBoundingClientRect();
                    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    return { inside: rect.left >= cell.left && rect.right <= cell.right,
                        target: hit === element || element.contains(hit), rect: rect.toJSON(), cell: cell.toJSON(), hit: hit?.outerHTML.slice(0, 200) };
                });
                assert.equal(geometry.inside && geometry.target, true,
                    `the complete action and its pointer target remain inside the cell at ${width}px: ${JSON.stringify(geometry)}`);
            }
            await disconnect.click();
            await page.waitForSelector('#disconnect-dialog');
            await page.keyboard.press('Escape');
            await page.waitForSelector('#disconnect-dialog', { state: 'detached' });
            if (width === 320) {
                await details.focus();
                await page.keyboard.press('Tab');
                assert.equal(await disconnect.evaluate(button => button === document.activeElement), true);
                const focusGeometry = await disconnect.evaluate(button => {
                    const rect = button.getBoundingClientRect();
                    const viewport = button.closest('.peer-table-wrap').getBoundingClientRect();
                    // Scroll offsets are integral while collapsed table borders
                    // and glyph widths can end on fractional CSS pixels.
                    return { visible: rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1,
                        rect: rect.toJSON(), viewport: viewport.toJSON(), scroll: button.closest('.peer-table-wrap').scrollLeft };
                });
                assert.equal(focusGeometry.visible, true,
                    'logical Tab reveals the complete focused action across horizontal overflow: ' + JSON.stringify(focusGeometry));
            }
        }
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
