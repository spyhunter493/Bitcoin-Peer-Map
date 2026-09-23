import assert from 'assert';

export default async function assertPeerViews(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        const original = window.setInterval;
        window.setInterval = (handler, interval, ...args) => {
            if (interval === 10000) {
                window.__testPeerPoll = handler;
                return original(handler, 3600000, ...args);
            }
            return original(handler, interval, ...args);
        };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.request.get(`${baseUrl}/api/peers?include_status=true`);
    const seed = await response.json();
    const hostile = `<b class="bpm-probe">text & " '</b><img src="bpm-probe" onerror="window.__unsafePeerText=true">`;
    let peers = seed.peers.map(peer => ({ ...peer, subver: hostile, asname: hostile,
        as: `${peer.as.split(' ')[0]} ${hostile}`, isp: hostile, city: '<b>Town</b>',
        country: '<b>Country</b>', connection_type: hostile, transport_protocol_type: hostile,
        permissions: [hostile], session_id: hostile,
    }));
    peers[0].services = [...peers[0].services, 'BLAKE2B?'];
    peers[0].services_abbrev += ' BL';
    const privatePeers = peers.filter(peer => ['onion', 'i2p', 'cjdns'].includes(peer.network));
    privatePeers[0].subver = 'constructor';
    await page.route('**/api/peers?include_status=true', route => route.fulfill({
        json: { peers, status: { ...seed.status, last_success_at: Date.now() / 1000, age_seconds: 0 } },
    }));
    async function safe(scope = 'body') {
        assert.strictEqual(await page.locator(`${scope} .bpm-probe, ${scope} img[src="bpm-probe"]`).count(), 0);
        assert.strictEqual(await page.evaluate(() => window.__unsafePeerText), undefined);
        assert.deepStrictEqual(errors, []);
    }
    async function poll() {
        const received = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
        await page.evaluate(() => window.__testPeerPoll());
        await received;
        await page.waitForTimeout(100);
    }
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelectorAll('#peer-tbody tr').length >= 10);
        assert.strictEqual(await page.locator('#peer-tbody tr').first().locator('td').nth(5).textContent(), hostile);
        assert.strictEqual(await page.locator('#peer-tbody tr').first().locator('td').nth(5).getAttribute('title'), hostile);
        const servicesCell = page.locator('#peer-tbody tr[data-id="1"] td').nth(6);
        assert.match(await servicesCell.textContent(), /\bBL\b/);
        assert.match(await servicesCell.getAttribute('title'), /BL = BLAKE2b fork support \(NODE_BLAKE2B\)/);
        await safe();

        await page.click('#as-donut-center');
        await page.waitForSelector('#as-detail-panel .as-summary-row');
        const software = page.locator('#as-detail-panel .as-summary-row').filter({ hasText: hostile }).first();
        await software.click();
        await page.waitForSelector('#as-sub-tooltip .as-provider-row');
        assert.ok((await page.locator('#as-sub-tooltip').textContent()).includes(hostile));
        await safe();
        await page.locator('#as-sub-tooltip .as-provider-row').first().click();
        await page.waitForSelector('#as-sub-sub-tooltip .as-sub-tt-peer');
        await safe();
        assert.strictEqual(await page.locator('#as-sub-sub-tooltip b').count(), 0);
        // Pinned nested membership is recomputed from the software/provider keys.
        const nestedProvider = await page.locator('#as-sub-tooltip .as-provider-row-selected').getAttribute('data-as');
        const member = peers.find(peer => peer.as.split(' ')[0] === nestedProvider && peer.subver === hostile);
        const arrival = { ...member, id: 903 };
        peers = peers.concat(arrival);
        await poll();
        assert.equal(await page.locator('#as-sub-sub-tooltip [data-peer-id="903"]').count() > 0, true);
        assert.equal(await page.locator('#peer-tbody tr[data-id="903"]').count(), 1);
        peers = peers.filter(peer => peer.id !== 903);
        await poll();
        assert.equal(await page.locator('#as-sub-sub-tooltip [data-peer-id="903"]').count(), 0);
        assert.equal(await page.locator('#peer-tbody tr[data-id="903"]').count(), 0);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        // Provider panels escape software/type labels; each insight escapes provider names.
        await page.locator('#as-detail-panel .as-conn-prov-row').first().click();
        await page.waitForSelector('#as-sub-tooltip');
        await safe();
        await page.keyboard.press('Escape');
        for (const selector of ['.as-stable-link', '.as-fastest-link', '.as-data-providers-link[data-field="bytessent"]']) {
            await page.locator('#as-detail-panel ' + selector).click();
            await page.waitForSelector('#as-sub-tooltip');
            await safe();
            await page.keyboard.press('Escape');
        }
        await page.click('#as-focused-close');
        await page.click('#as-donut-center');
        // Assert table contents, not just counts, through both connection-direction filters.
        for (const [selector, direction] of [['.as-conn-dir-row', 'IN'], ['.as-conn-out-row', 'OUT']]) {
            const row = page.locator('#as-detail-panel ' + selector).first();
            const provider = await row.getAttribute('data-as');
            const matches = peer => peer.as.split(' ')[0] === provider && peer.direction === direction;
            const expected = () => peers.filter(matches).map(peer => peer.id).sort((a, b) => a - b);
            await row.click();
            const tableIds = () => page.locator('#peer-tbody tr').evaluateAll(rows => rows.map(row => Number(row.dataset.id)));
            assert.deepStrictEqual(await tableIds(), expected());
            const replaced = peers.find(matches);
            const replacementId = direction === 'IN' ? 901 : 902;
            peers = peers.filter(peer => peer.id !== replaced.id).concat({ ...replaced, id: replacementId });
            await poll();
            assert.deepStrictEqual(await tableIds(), expected());
            peers = peers.filter(peer => !matches(peer));
            await poll();
            assert.deepStrictEqual(await tableIds(), []);
            await page.keyboard.press('Escape');
        }

        await page.click('#as-focused-close');
        const publicPeer = peers.find(peer => peer.network === 'ipv4');
        await page.locator(`#peer-tbody tr[data-id="${publicPeer.id}"]`).click();
        await page.waitForSelector('.peer-detail-popup.visible');
        await safe();
        assert.ok((await page.locator('.peer-detail-popup').textContent()).includes(hostile));
        await page.keyboard.press('Escape');

        await page.click('#as-focused-close');

        // Private overview, software drill-down, network panel, and full peer details.
        await page.click('#pn-mini-donut');
        await page.waitForSelector('#pn-detail-panel.visible');
        await safe();
        assert.ok((await page.locator('#pn-detail-body').textContent()).includes('constructor'));
        // Network drill-downs use the same live descriptor as software filters.
        const networkRow = page.locator('#pn-detail-body .pn-net-link-row[data-net="onion"]');
        await networkRow.click();
        await page.waitForSelector('#pn-sub-tooltip .as-sub-tt-peer');
        const savedPeers = peers;
        const tor = peers.filter(peer => peer.network === 'onion');
        peers = peers.concat({ ...tor[0], id: 990 });
        await poll();
        assert.equal(await page.locator('#pn-sub-tooltip .as-sub-tt-peer').count(), tor.length + 1);
        peers = peers.filter(peer => peer.network !== 'onion');
        await poll();
        assert.equal(await page.locator('#pn-sub-tooltip .as-sub-tt-peer').count(), 0);
        assert.equal(await page.locator('#peer-tbody tr').count(), 0);
        peers = savedPeers;
        await poll();
        assert.equal(await page.locator('#pn-sub-tooltip .as-sub-tt-peer').count(), tor.length);
        await networkRow.click();
        const privateSoftware = page.locator('#pn-detail-body .pn-interactive-row[data-category="software"]')
            .filter({ hasText: hostile });
        await privateSoftware.click();
        await page.waitForSelector('#pn-sub-tooltip .as-sub-tt-peer');
        await safe();
        const selectedIds = await page.locator('#pn-sub-tooltip .pn-sub-tt-id-link').evaluateAll(rows => rows.map(r => Number(r.dataset.peerId)));
        assert.ok(selectedIds.length > 0);
        const replacement = { ...peers.find(p => p.id === selectedIds[0]), id: 900 };
        peers = peers.filter(peer => !selectedIds.includes(peer.id)).concat(replacement);
        await poll();
        await page.waitForFunction(() => {
            const rows = document.querySelectorAll('#pn-sub-tooltip .pn-sub-tt-id-link');
            return rows.length === 1 && rows[0].dataset.peerId === '900';
        });
        await safe();
        peers = peers.filter(peer => peer.id !== 900);
        await poll();
        assert.equal(await page.locator('#pn-sub-tooltip').isVisible(), true);
        assert.equal(await page.locator('#pn-sub-tooltip .pn-sub-tt-id-link').count(), 0);
        assert.equal(await page.locator('#pn-center-label').textContent(), '0 PEERS');
        await page.keyboard.press('Escape');

        // A departed insight peer must release its pinned rectangle and lines.
        await page.locator('#pn-detail-body .pn-insight-row').first().click();
        await page.waitForSelector('#pn-insight-rect.visible');
        const remainingPrivate = peers.filter(peer => ['onion', 'i2p', 'cjdns'].includes(peer.network));
        peers = peers.filter(peer => !remainingPrivate.includes(peer));
        await poll();
        await page.waitForFunction(() => !document.getElementById('pn-insight-rect').classList.contains('visible'));
        peers = peers.concat(remainingPrivate);
        await poll();
        await page.locator('#pn-donut-svg .pn-donut-segment').first().dispatchEvent('click');
        await page.waitForSelector('#pn-detail-back:not(.hidden)');
        await safe();
        await page.locator('#peer-tbody tr').first().click();
        await page.waitForSelector('.peer-detail-popup.visible');
        await safe();
        assert.ok((await page.locator('.peer-detail-popup').textContent()).includes(hostile));
        peers = peers.filter(peer => !['onion', 'i2p', 'cjdns'].includes(peer.network));
        await poll();
        await page.waitForSelector('.peer-detail-popup', { state: 'detached' });
        assert.strictEqual(await page.locator('#peer-tbody tr').count(), 0);
        await safe();
    } finally {
        await context.close();
    }
};
