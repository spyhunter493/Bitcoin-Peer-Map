import assert from 'node:assert/strict';
import { createServer } from '../scripts/benchmark-dashboard.js';

export default async function assertDashboardPerformance(browser) {
    const fixture = createServer();
    fixture.setPeerCount(500);
    await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const now = Date.now();
    await context.addInitScript(now => {
        window.performanceTestNow = now;
        Date.now = () => window.performanceTestNow;
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        const interval = window.setInterval.bind(window);
        window.setInterval = (handler, ms, ...args) => {
            if (ms === 10000) {
                window.performanceTestPoll = handler;
                return interval(handler, 3600000, ...args);
            }
            return interval(handler, ms, ...args);
        };
        window.canvasRedraws = {};
        window.peerGradients = 0;
        window.peerSprites = 0;
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            const id = this.canvas.id;
            if (id) window.canvasRedraws[id] = (window.canvasRedraws[id] || 0) + 1;
            return clear.apply(this, args);
        };
        const gradient = CanvasRenderingContext2D.prototype.createRadialGradient;
        CanvasRenderingContext2D.prototype.createRadialGradient = function (...args) {
            if (this.canvas.id === 'worldmap') window.peerGradients++;
            return gradient.apply(this, args);
        };
        const draw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...args) {
            if (this.canvas.id === 'worldmap') window.peerSprites++;
            return draw.apply(this, args);
        };
    }, now);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    const seed = await (await page.request.get(`${baseUrl}/api/peers`)).json();
    let peers = seed.peers.map(peer => ({ ...peer, network: peer.id % 2 ? 'ipv4' : 'ipv6', conntime: Math.floor(now / 1000) - 7200 }));
    await page.route('**/api/peers?include_status=true', route => route.fulfill({ json: { ...seed, peers } }));
    const ids = () => page.locator('#peer-tbody tr[data-id]').evaluateAll(rows => rows.map(row => Number(row.dataset.id)));
    const scroll = async fraction => {
        await page.locator('.peer-table-wrap').evaluate((el, fraction) => {
            el.scrollTop = (el.scrollHeight - el.clientHeight) * fraction;
        }, fraction);
        await page.waitForTimeout(100);
    };
    const poll = async () => {
        const response = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
        await page.evaluate(() => window.performanceTestPoll());
        await response;
        await page.waitForTimeout(100);
    };
    try {
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.getElementById('peer-tbody').dataset.peerCount === '500');
        await page.mouse.move(10, 10);
        await page.waitForTimeout(200);
        assert.ok((await ids()).length < 40, '500 peers mount only the visible rows and a buffer');
        assert.equal((await ids())[0], 1);
        assert.equal(await page.locator('#peer-table').getAttribute('aria-rowcount'), '501');
        assert.ok(await page.locator('#peer-tbody .peer-table-spacer').count() === 2);
        assert.equal(await page.locator('#map-connections').isVisible(), false,
            'an empty connection surface does not add compositing work');

        const staticBefore = await page.evaluate(() => ({ ...window.canvasRedraws }));
        await page.waitForTimeout(250);
        assert.deepEqual(await page.evaluate(() => window.canvasRedraws), staticBefore,
            'unchanged reduced-motion scenes do not redraw peers or connections');

        await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
        await page.waitForFunction(count => window.canvasRedraws['map-connections'] > count,
            staticBefore['map-connections']);
        const provider = page.locator('#as-donut .as-donut-segment').first();
        await provider.dispatchEvent('click');
        await page.waitForFunction(() => !document.getElementById('map-connections').hidden);
        await page.locator('#as-focused-close').click();
        await page.waitForFunction(() => document.getElementById('map-connections').hidden);
        await page.waitForFunction(() => document.getElementById('peer-tbody').dataset.peerCount === '500');
        const animatedBefore = await page.evaluate(() => ({ ...window.canvasRedraws }));

        await page.evaluate(() => { window.performanceTestNow += 6000; window.peerGradients = 0; });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction(count => window.canvasRedraws.worldmap >= count + 3, animatedBefore.worldmap);
        assert.equal(await page.evaluate(() => window.canvasRedraws['map-connections']), animatedBefore['map-connections'],
            'peer animations reuse unchanged connection drawings');
        assert.ok(await page.evaluate(() => window.peerSprites > 0 && window.peerGradients === 0),
            'large settled peer sets reuse glow sprites while animation continues');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForTimeout(100);

        await scroll(1);
        assert.equal((await ids()).at(-1), 500, 'the last peer is reachable');
        assert.equal(await page.locator('#peer-tbody tr[data-id="500"]').getAttribute('aria-rowindex'), '501');
        await scroll(0.5);
        const middleIds = await ids();
        assert.ok(middleIds[0] > 200 && middleIds.at(-1) < 300, 'scrolling mounts the middle of the full result');
        const middleId = middleIds[Math.floor(middleIds.length / 2)];
        await page.evaluate(id => {
            window.retainedRow = document.querySelector(`#peer-tbody tr[data-id="${id}"]`);
            window.retainedCell = window.retainedRow.cells[12];
            window.retainedScroll = document.querySelector('.peer-table-wrap').scrollTop;
            window.tableMutations = 0;
            window.columnMutations = 0;
            new MutationObserver(records => { window.tableMutations += records.length; })
                .observe(document.getElementById('peer-tbody'), { subtree: true, childList: true, characterData: true, attributes: true });
            new MutationObserver(records => { window.columnMutations += records.length; })
                .observe(document.querySelector('#peer-table colgroup'), { subtree: true, childList: true, attributes: true });
        }, middleId);
        await poll();
        assert.equal(await page.evaluate(() => window.tableMutations), 0, 'unchanged polls retain zero table mutations');
        assert.equal(await page.evaluate(() => window.columnMutations), 0, 'unchanged polls retain zero column mutations');
        peers = peers.map(peer => peer.id === middleId ? { ...peer, ping_ms: 999 } : peer);
        await poll();
        assert.equal(await page.evaluate(id => {
            const row = document.querySelector(`#peer-tbody tr[data-id="${id}"]`);
            return row === window.retainedRow && row.cells[12] === window.retainedCell &&
                row.cells[12].textContent === '999ms' && document.querySelector('.peer-table-wrap').scrollTop === window.retainedScroll;
        }, middleId), true, 'changed polls preserve mounted rows, cells, and scroll position');

        await scroll(0);
        await page.locator('th[data-sort="id"]').click();
        assert.equal((await ids())[0], 500, 'sorting uses all peers, including unmounted rows');
        await scroll(1);
        assert.equal((await ids()).at(-1), 1);
        await page.locator('.net-badge[data-net="ipv4"]').click();
        await page.waitForFunction(() => document.getElementById('peer-tbody').dataset.peerCount === '250');
        assert.ok((await ids()).every(id => id % 2 === 1), 'network filtering applies to the entire data set');
        await scroll(0);
        assert.equal((await ids())[0], 499);
        await page.locator('#peer-tbody tr[data-id="499"] .peer-action-btn').click();
        await page.waitForSelector('#disconnect-dialog');
        assert.match(await page.locator('#disconnect-dialog').textContent(), /499/,
            'virtual rows retain the correct disconnect target');
        await page.keyboard.press('Escape');

        const highlighted = await page.evaluate(() => window.canvasRedraws.worldmap);
        await page.locator('#peer-tbody tr[data-id="499"]').hover();
        await page.waitForFunction(count => window.canvasRedraws.worldmap > count, highlighted);
        await page.locator('#peer-tbody tr[data-id="499"]').click();
        await page.waitForSelector('.peer-detail-popup');
        assert.equal(await page.locator('#peer-tbody').getAttribute('data-peer-count'), '1', 'selecting a row still focuses that peer');

        // Exercise revealing an unmounted peer through the same viewport module
        // used by map/table cross-highlighting, without adding production test hooks.
        const reveal = await page.evaluate(async peers => {
            const revision = document.body.dataset.assetRevision;
            const { create } = await import(`/static/v/${revision}/js/peers/table-window.js`);
            const viewport = document.createElement('div');
            viewport.className = 'peer-table-wrap';
            viewport.style.cssText = 'position:fixed;top:50px;left:0;width:300px;height:200px;overflow:auto';
            const table = document.createElement('table');
            table.className = 'peer-table';
            const thead = table.createTHead();
            thead.insertRow().insertCell().textContent = 'Peer';
            const tbody = table.createTBody();
            viewport.append(table); document.body.append(viewport);
            let selected = 500;
            const windowed = create({ tbody, thead, viewport, updateRow(row, peer) {
                if (!row.cells.length) row.insertCell();
                row.cells[0].textContent = String(peer.id);
                row.classList.toggle('row-highlight', peer.id === selected);
            } });
            windowed.update(peers, 'id', 1);
            windowed.reveal(500, false);
            const last = tbody.querySelector('tr[data-id="500"]');
            const rect = last?.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
            const visible = !!rect && rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1;
            const marked = last?.classList.contains('row-highlight');
            const diagnostic = { scroll: viewport.scrollTop, height: viewport.scrollHeight,
                bounds: bounds.toJSON(), rect: rect?.toJSON(),
                rows: Array.from(tbody.rows).map(row => row.dataset.id) };
            selected = 1;
            windowed.reveal(1, false);
            const first = !!tbody.querySelector('tr[data-id="1"].row-highlight');
            const mounted = tbody.querySelectorAll('tr[data-id]').length;
            viewport.style.height = '350px';
            await new Promise(resolve => {
                const deadline = performance.now() + 2500;
                const resized = () => {
                    if (tbody.querySelectorAll('tr[data-id]').length > mounted || performance.now() > deadline) resolve();
                    else requestAnimationFrame(resized);
                };
                requestAnimationFrame(resized);
            });
            const expanded = tbody.querySelectorAll('tr[data-id]').length > mounted;
            windowed.update(peers.slice(0, 3), 'id', 1);
            const small = tbody.rows.length === 3 && !tbody.querySelector('.peer-table-spacer');
            windowed.update([], 'id', 1);
            const empty = tbody.rows.length === 0 && table.getAttribute('aria-rowcount') === '1';
            viewport.remove();
            return { visible, marked, first, expanded, small, empty, diagnostic };
        }, seed.peers);
        assert.deepEqual({ visible: reveal.visible, marked: reveal.marked, first: reveal.first,
            expanded: reveal.expanded, small: reveal.small, empty: reveal.empty },
            { visible: true, marked: true, first: true, expanded: true, small: true, empty: true }, JSON.stringify(reveal.diagnostic));
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
        fixture.server.closeAllConnections();
        await new Promise(resolve => fixture.server.close(resolve));
    }
}
