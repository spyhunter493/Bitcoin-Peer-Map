import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Parse the downloaded file as CSV rather than splitting lines: peer text can
// contain commas, quotes and newlines, and each must survive a real download.
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === '"') {
            if (quoted && text[index + 1] === '"') { field += '"'; index++; }
            else quoted = !quoted;
        } else if (!quoted && char === ',') {
            row.push(field); field = '';
        } else if (!quoted && (char === '\r' || char === '\n')) {
            if (char === '\r' && text[index + 1] === '\n') index++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += char;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    assert.equal(quoted, false, 'the downloaded CSV must have complete quoted fields');
    return rows;
}

export default async function assertPeerSearchExport(browser, baseUrl) {
    const context = await browser.newContext({
        viewport: { width: 1638, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true,
    });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        localStorage.setItem('bpm.peerTable.display', JSON.stringify({
            visibleColumns: ['subver', 'id', 'addr'], maxPeerRows: 10,
        }));
        const interval = window.setInterval.bind(window);
        window.setInterval = (handler, ms, ...args) => {
            if (ms === 10000) {
                window.testSearchPeerPoll = handler;
                return interval(handler, 3600000, ...args);
            }
            return interval(handler, ms, ...args);
        };
        const nativeObserver = window.ResizeObserver;
        const observed = new Map();
        window.ResizeObserver = class extends nativeObserver {
            observe(target, options) {
                if (target.id === 'peer-panel-handle' || target.classList.contains('peer-table-wrap')) observed.set(this, target);
                return super.observe(target, options);
            }
            disconnect() { observed.delete(this); super.disconnect(); }
        };
        window.searchObservedElements = () => [...observed.values()].map(element => element.id || element.className).sort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const seed = await (await page.request.get(`${baseUrl}/api/peers?include_status=true`)).json();
    const template = seed.peers.find(peer => peer.network === 'ipv4');
    let peers = Array.from({ length: 500 }, (_, index) => ({
        ...template, id: index + 1, network: index % 2 ? 'ipv6' : 'ipv4', is_public: true,
        addr: `198.51.100.${index % 250 + 1}:${8333 + Math.floor(index / 250)}`,
        ip: `198.51.100.${index % 250 + 1}`, port: String(8333 + Math.floor(index / 250)),
        as: index % 2 ? 'AS64501' : 'AS64500', asname: 'Example Networks', isp: 'Example ISP',
        subver: index < 3 ? 'Needle Client' : '/Satoshi:29.1.0/',
        city: index === 0 ? 'Needle Harbor' : 'Example Town',
        country: index === 0 ? 'Searchland' : 'Example Country', countryCode: 'NZ',
        lat: 20 + index % 10, lon: index % 20, location_status: 'ok',
    }));
    peers[0].subver = 'Needle Client, "Alpha"\nSecond line';
    peers[4].subver = ' \t=HYPERLINK("https://example.invalid")';
    peers[6].asname = 'Hidden Search Network';
    peers[499].id = 98765;
    peers.push(...['onion', 'i2p'].map((network, index) => ({
        ...template, id: 501 + index, network, addr: `example-private-${index}.${network}:8333`,
        ip: `example-private-${index}.${network}`, subver: index ? 'Other Private Client' : 'Needle Client',
        as: '', asname: '', isp: '', is_public: false, lat: null, lon: null, location_status: 'private',
    })));
    await page.route('**/api/peers?include_status=true', route => route.fulfill({
        json: { ...seed, peers, status: { ...seed.status, age_seconds: 0, last_success_at: Date.now() / 1000 } },
    }));

    const search = page.locator('#peer-search');
    const chip = key => page.locator(`.peer-filter-chip[data-filter-key="${key}"]`);
    const ids = () => page.locator('#peer-tbody tr[data-id]').evaluateAll(rows => rows.map(row => Number(row.dataset.id)));
    async function matches(expected) {
        try {
            await page.waitForFunction(({ count, total }) => {
                const tbody = document.getElementById('peer-tbody');
                return tbody.dataset.peerCount === String(count) &&
                    document.getElementById('peer-match-count').textContent.trim() === `${count} of ${total} peers`;
            }, { count: expected.length, total: peers.length }, { timeout: 10000 });
        } catch (error) {
            const actual = await page.evaluate(() => ({
                query: document.getElementById('peer-search').value,
                count: document.getElementById('peer-match-count').textContent,
                chips: document.getElementById('peer-filter-chips').textContent,
                ids: [...document.querySelectorAll('#peer-tbody tr[data-id]')].map(row => Number(row.dataset.id)),
            }));
            throw new Error(`Expected ${expected.length} of ${peers.length} peers; actual ${JSON.stringify(actual)}; page errors ${JSON.stringify(errors)}`, { cause: error });
        }
        if (expected.length < 20) assert.deepEqual(await ids(), expected);
    }
    async function query(text, expected) {
        await search.fill(text);
        await matches(expected);
        assert.equal(await page.locator('#peer-panel').evaluate(panel => panel.classList.contains('collapsed')), false,
            'typing in search must leave the peer table open');
    }
    async function poll() {
        const received = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
        await page.evaluate(() => window.testSearchPeerPoll());
        await received;
        await page.evaluate(async () => {
            const revision = document.body.dataset.assetRevision;
            const { dashboard } = await import(`/static/v/${revision}/js/core/dashboard-state.js`);
            window.testSearchDashboard = dashboard;
        });
        await page.waitForFunction(expected => {
            const current = window.testSearchDashboard.peers;
            return current.length === expected.length && current.every((peer, index) => peer.id === expected[index]);
        }, peers.map(peer => peer.id));
    }
    async function download(kind) {
        await page.locator('#btn-export-peers').click();
        const received = page.waitForEvent('download');
        await page.locator(`#peer-export-${kind}`).click();
        const file = await received;
        assert.match(file.suggestedFilename(), new RegExp(`^bpm-peers-.+\\.${kind}$`));
        assert.equal(await file.failure(), null);
        const text = await readFile(await file.path(), 'utf8');
        assert.equal(await page.locator('#peer-panel').evaluate(panel => panel.classList.contains('collapsed')), false,
            'export controls must leave the peer table open');
        return kind === 'json' ? JSON.parse(text) : parseCsv(text);
    }

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await matches(peers.map(peer => peer.id));
        assert.ok((await ids()).length < 40, 'the fixture must exercise virtualized rows');
        assert.equal(await page.getByRole('searchbox', { name: 'Search peers' }).count(), 1);
        assert.equal(await page.locator('#peer-match-count').getAttribute('aria-live'), 'polite');
        assert.equal(await page.locator('th[data-sort="as"]').count(), 0, 'ASN is hidden in this table');
        assert.deepEqual(await page.evaluate(() => window.searchObservedElements()), ['peer-panel-handle', 'peer-table-wrap', 'peer-table-wrap']);

        await search.click();
        assert.equal(await page.locator('#peer-panel').evaluate(panel => panel.classList.contains('collapsed')), false);
        await query('98765', [98765]);
        await query('198.51.100.1:8333', [1]);
        await query('nEeDlE cLiEnT', [1, 2, 3, 501]);
        await query('needle harbor', [1]);
        await query('searchland', [1]);
        await query('hidden search', [7]);
        await query('as64500', peers.filter(peer => peer.as === 'AS64500').map(peer => peer.id));
        await query('no-such-peer-search-token', []);
        assert.equal(await chip('search').count(), 1, 'a zero-result search remains visible and removable');

        await query('Needle Client', [1, 2, 3, 501]);
        await search.focus();
        await search.evaluate(input => input.setSelectionRange(3, 6));
        peers = peers.map(peer => peer.id === 3 ? { ...peer, subver: 'Changed Client' } : peer)
            .concat({ ...peers[0], id: 503, addr: '198.51.100.251:8333' });
        await poll();
        await matches([1, 2, 501, 503]);
        assert.equal(await search.inputValue(), 'Needle Client', 'refreshes retain the search query');
        assert.equal(await search.evaluate(input => input === document.activeElement), true,
            'refreshes retain focus while searching');
        assert.deepEqual(await search.evaluate(input => [input.selectionStart, input.selectionEnd]), [3, 6],
            'refreshes retain the selection while editing the query');

        await page.locator('.net-badge[data-net="ipv4"]').click();
        await matches([1, 503]);
        assert.equal(await chip('network').count(), 1);
        const networkExport = await download('json');
        assert.deepEqual(networkExport.peers.map(peer => peer.id), [1, 503]);
        assert.equal(networkExport.filters.search, 'Needle Client');
        assert.ok(networkExport.filters.scopes.some(scope => scope.key === 'network'));
        await chip('search').click();
        await matches(peers.filter(peer => peer.network === 'ipv4').map(peer => peer.id));
        assert.equal(await chip('network').count(), 1, 'removing the search chip preserves other scopes');
        await query('Needle Client', [1, 503]);
        await page.locator('#peer-search-clear').focus();
        await page.keyboard.press('Enter');
        await matches(peers.filter(peer => peer.network === 'ipv4').map(peer => peer.id));
        assert.equal(await search.inputValue(), '');
        assert.equal(await chip('search').count(), 0);
        assert.equal(await chip('network').count(), 1, 'clearing search preserves the network filter');
        assert.equal(await page.locator('.net-badge[data-net="ipv4"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.net-badge[data-net="ipv6"]').getAttribute('aria-pressed'), 'false');
        assert.equal(await chip('network').evaluate(button => button.tagName), 'BUTTON');
        await chip('network').focus();
        await page.keyboard.press('Space');
        await matches(peers.map(peer => peer.id));

        await query('Needle Client', [1, 2, 501, 503]);
        await page.locator('#as-donut .as-donut-segment[data-as="AS64500"]').dispatchEvent('click');
        await matches([1, 503]);
        assert.equal(await chip('provider').count(), 1);
        assert.match(await chip('provider').textContent(), /AS64500/);
        await chip('provider').click();
        await matches([1, 2, 501, 503]);
        assert.equal(await search.inputValue(), 'Needle Client');
        if (await page.locator('#as-focused-close').isVisible()) await page.locator('#as-focused-close').click();

        await page.locator('#peer-tbody tr[data-id="1"]').click();
        await page.waitForSelector('.peer-detail-popup.visible');
        await matches([1]);
        assert.equal(await chip('map').count(), 1);
        await chip('map').click();
        await matches([1, 2, 501, 503]);
        assert.equal(await chip('provider').count(), 0, 'a peer popup alone is represented by the map chip');
        assert.equal(await search.inputValue(), 'Needle Client');
        await page.waitForSelector('.peer-detail-popup.visible', { state: 'hidden' });

        // Each public scope clears independently when the others coexist.
        for (const first of ['provider', 'map']) {
            await page.locator('#as-donut .as-donut-segment[data-as="AS64500"]').dispatchEvent('click');
            await page.locator('.net-badge[data-net="ipv4"]').click();
            await matches([1, 503]);
            await page.locator('#peer-tbody tr[data-id="1"]').click();
            await matches([1]);
            for (const key of ['search', 'provider', 'network', 'map']) assert.equal(await chip(key).count(), 1);
            await chip(first).click();
            await matches(first === 'provider' ? [1] : [1, 503]);
            assert.equal(await chip(first === 'provider' ? 'map' : 'provider').count(), 1);
            await chip('network').click();
            await matches(first === 'provider' ? [1] : [1, 503]);
            assert.equal(await search.inputValue(), 'Needle Client');
            await chip(first === 'provider' ? 'map' : 'provider').click();
            await matches([1, 2, 501, 503]);
        }

        // Closing a map peer must restore a provider subgroup, not broaden it
        // to the entire provider while leaving its chip behind.
        await page.locator('#peer-search-clear').click();
        await page.locator('#as-donut .as-donut-segment[data-as="AS64500"]').dispatchEvent('click');
        await page.locator('#as-detail-panel .as-detail-body [data-category="software"]').filter({ hasText: 'Needle Client' }).first().click();
        await matches([1, 503]);
        await page.locator('#peer-tbody tr[data-id="1"]').click();
        await matches([1]);
        await chip('map').click();
        await matches([1, 503]);
        assert.match(await chip('provider').textContent(), /Needle Client/);
        await chip('provider').click();
        await matches(peers.map(peer => peer.id));

        await page.locator('.fd-net-chip[data-net="ipv4"]').click();
        const ipv4Ids = peers.filter(peer => peer.network === 'ipv4').map(peer => peer.id);
        await matches(ipv4Ids);
        await page.locator('#peer-tbody tr[data-id="1"]').click();
        await matches([1]);
        await chip('map').click();
        await matches(ipv4Ids);
        assert.match(await chip('provider').textContent(), /IPv4/, 'removing Map retains a flight-deck network selection');
        await chip('provider').click();
        await matches(peers.map(peer => peer.id));
        if (await page.locator('#as-focused-close').isVisible()) await page.locator('#as-focused-close').click();

        await page.locator('#as-overview-trigger').focus();
        await page.keyboard.press('Enter');
        await page.locator('#as-detail-panel .as-summary-row[data-cat-label]').filter({ hasText: '/Satoshi:29.1.0/' }).first().click();
        await page.locator('#as-sub-tooltip .as-provider-row[data-as="AS64500"] .as-provider-peer-list').click();
        const secondaryIds = peers.filter(peer => peer.subver === '/Satoshi:29.1.0/' && peer.as === 'AS64500').map(peer => peer.id);
        await matches(secondaryIds);
        await page.locator(`#peer-tbody tr[data-id="${secondaryIds[0]}"]`).click();
        await matches([secondaryIds[0]]);
        await chip('map').click();
        await matches(secondaryIds);
        assert.match(await chip('provider').textContent(), /AS64500/);
        await chip('provider').click();
        await matches(peers.map(peer => peer.id));
        if (await page.locator('#as-focused-close').isVisible()) await page.locator('#as-focused-close').click();

        await query('Needle Client', [1, 2, 501, 503]);
        await page.locator('#pn-mini-trigger').focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('#pn-detail-panel.visible');
        await matches([501]);
        await query('other private', [502]);
        await page.locator('#peer-search-clear').click();
        await matches([501, 502]);
        await page.locator('#pn-detail-body .pn-net-link-row[data-net="onion"]').click();
        await matches([501]);
        assert.equal(await chip('private-filter').count(), 1);
        await chip('private-filter').click();
        await matches([501, 502]);
        await page.locator('#pn-donut-svg .pn-donut-segment[data-net="onion"]').first().dispatchEvent('click');
        await matches([501]);
        assert.equal(await chip('private-network').count(), 1);
        await chip('private-network').click();
        await matches([501, 502]);
        await page.locator('#pn-donut-svg .pn-donut-segment[data-net="onion"]').first().dispatchEvent('click');
        await page.locator('#pn-detail-body [data-category="conntype"]').first().click();
        await matches([501]);
        await chip('private-filter').click();
        await matches([501]);
        assert.equal(await chip('private-network').count(), 1, 'removing a private group preserves its network scope');
        await page.locator('#pn-detail-body [data-category="conntype"]').first().click();
        await chip('private-network').click();
        await matches([501, 502]);
        assert.equal(await chip('private-filter').count(), 1, 'removing a private network preserves the group descriptor');
        await query('Needle Client', [501]);
        await chip('private-mode').click();
        await matches([1, 2, 501, 503]);
        assert.equal(await search.inputValue(), 'Needle Client', 'removing Private view preserves search');
        assert.equal(await page.locator('.net-badge[data-net="all"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await chip('private-filter').count(), 0);

        // Clear all also clears scopes which are ignored by the private table.
        await page.locator('#pn-mini-trigger').focus();
        await page.keyboard.press('Enter');
        await matches([501]);
        await page.evaluate(() => {
            window.testSearchDashboard.interaction.asFilterPeerIds = new Set([1]);
            window.testSearchDashboard.interaction.mapFilterPeerIds = new Set([1]);
        });
        await page.locator('#peer-clear-filters').click();
        await matches(peers.map(peer => peer.id));
        assert.deepEqual(await page.evaluate(() => [
            window.testSearchDashboard.interaction.asFilterPeerIds,
            window.testSearchDashboard.interaction.mapFilterPeerIds,
            window.testSearchDashboard.privateNetwork.pnFilter,
            window.testSearchDashboard.privateNetwork.pnSelectedNet,
            window.testSearchDashboard.privateNetwork.privateNetMode,
        ]), [null, null, null, null, false]);

        await query('Needle Client', [1, 2, 501, 503]);
        await page.locator('.net-badge[data-net="ipv4"]').click();
        await matches([1, 503]);
        await page.locator('#peer-clear-filters').click();
        await matches(peers.map(peer => peer.id));
        assert.equal(await search.inputValue(), '');
        assert.equal(await page.locator('#peer-filter-chips .peer-filter-chip').count(), 0);
        assert.equal(await page.locator('.net-badge[data-net="all"]').getAttribute('aria-pressed'), 'true');

        const exportIds = peers.filter(peer => peer.as === 'AS64500').map(peer => peer.id).sort((a, b) => b - a);
        await query('AS64500', exportIds.toReversed());
        await page.locator('th[data-sort="id"] button').click();
        await matches(exportIds);
        assert.equal((await ids())[0], 503);
        assert.ok((await ids()).length < exportIds.length, 'export must include peers beyond mounted rows');

        const exportButton = page.locator('#btn-export-peers');
        await exportButton.focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#peer-export-options').isVisible(), true);
        assert.equal(await page.locator('#peer-export-options').getAttribute('role'), 'group');
        assert.equal(await page.locator('#peer-export-csv').evaluate(button => button === document.activeElement && button.tagName === 'BUTTON'), true);
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#peer-export-json').evaluate(button => button === document.activeElement), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#peer-export-options').isVisible(), false);
        assert.equal(await exportButton.evaluate(button => button === document.activeElement), true);

        const exported = await download('json');
        assert.equal(exported.count, exportIds.length);
        assert.equal(exported.total, peers.length);
        assert.deepEqual(exported.peers.map(peer => peer.id), exportIds);
        assert.deepEqual(exported.sort, { key: 'id', direction: 'descending' });
        assert.deepEqual(exported.columns, [
            { key: 'subver', label: 'Software' }, { key: 'id', label: 'ID' }, { key: 'addr', label: 'IP:Port' },
        ]);
        assert.equal(exported.filters.search, 'AS64500');
        assert.ok(Array.isArray(exported.filters.scopes));
        assert.ok(Number.isFinite(Date.parse(exported.exported_at)));
        assert.equal(exported.peers.at(-1).subver, peers[0].subver, 'JSON retains raw peer text');
        const csv = await download('csv');
        assert.deepEqual(csv[0], ['Software', 'ID', 'IP:Port']);
        assert.equal(csv.length, exportIds.length + 1);
        assert.deepEqual(csv.slice(1).map(row => Number(row[1])), exportIds);
        assert.deepEqual(csv.at(-1), [peers[0].subver, '1', peers[0].addr]);
        assert.equal(csv.find(row => row[1] === '5')[0], "'" + peers[4].subver,
            'real CSV downloads neutralize formula-like peer text');

        await query('no-such-peer-search-token', []);
        const empty = await download('json');
        assert.equal(empty.count, 0);
        assert.deepEqual(empty.peers, []);
        assert.deepEqual(await download('csv'), [['Software', 'ID', 'IP:Port']]);
        await search.focus();
        await page.keyboard.press('Escape');
        await matches(peers.map(peer => peer.id).sort((a, b) => b - a));
        assert.equal(await search.inputValue(), '', 'Escape clears the query from the search field');

        for (const width of [1638, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            const layout = await search.evaluate(input => {
                const rect = input.getBoundingClientRect();
                const panel = document.getElementById('peer-panel').getBoundingClientRect();
                const connect = document.getElementById('btn-connect-peer').getBoundingClientRect();
                return { width: rect.width, left: rect.left, right: rect.right,
                    panelLeft: panel.left, panelRight: panel.right,
                    connectLeft: connect.left, connectRight: connect.right, viewport: innerWidth };
            });
            assert.ok(layout.width >= 140, `search needs usable typing space at ${width}px: ${JSON.stringify(layout)}`);
            assert.ok(layout.left >= 0 && layout.right <= width, `search must fit at ${width}px`);
            assert.ok(layout.panelLeft >= 0 && layout.panelRight <= width, `peer banner must fit at ${width}px`);
            assert.ok(layout.connectLeft >= 0 && layout.connectRight <= width, `Connect Peer stays reachable at ${width}px`);
            assert.equal(await search.isVisible(), true);
            if (width === 1638) {
                const placement = await search.evaluate(input => {
                    const search = input.getBoundingClientRect(), connect = document.getElementById('btn-connect-peer').getBoundingClientRect();
                    return { searchRight: search.right, connectLeft: connect.left, searchMiddle: search.y + search.height / 2, connectMiddle: connect.y + connect.height / 2 };
                });
                assert.ok(placement.searchRight <= placement.connectLeft && Math.abs(placement.searchMiddle - placement.connectMiddle) < 2,
                    'wide layouts place search directly left of Connect Peer on the same row');
            }
        }
        await page.setViewportSize({ width: 320, height: 320 });
        await page.locator('#btn-export-peers').click();
        await page.waitForFunction(() => {
            const box = document.getElementById('peer-export-options').getBoundingClientRect();
            return box.left >= 8 && box.right <= innerWidth - 8 && box.top >= 8 && box.bottom <= innerHeight - 8;
        });
        await page.keyboard.press('End');
        assert.equal(await page.locator('#peer-export-json').evaluate(button => button === document.activeElement), true);
        await page.keyboard.press('Home');
        assert.equal(await page.locator('#peer-export-csv').evaluate(button => button === document.activeElement), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#btn-export-peers').evaluate(button => button === document.activeElement), true);
        assert.equal((await download('json')).count, peers.length, 'short narrow viewports retain complete export');

        // Disposal removes feature handlers even if old controls are retained.
        await page.locator('#btn-export-peers').click();
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
        assert.equal(await page.locator('#peer-export-options').isVisible(), false);
        assert.deepEqual(await page.evaluate(() => window.searchObservedElements()), [], 'disposal disconnects both table and toolbar observers');
        const settled = await page.locator('#peer-match-count').textContent();
        await search.fill('after-disposal');
        await page.locator('#btn-export-peers').click();
        assert.equal(await page.locator('#peer-match-count').textContent(), settled);
        assert.equal(await page.locator('#peer-export-options').isVisible(), false);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
