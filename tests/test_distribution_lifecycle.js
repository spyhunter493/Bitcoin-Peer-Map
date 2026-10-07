import assert from 'node:assert/strict';

export default async function assertDistributionLifecycle(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let applicationRequests = 0;
    await page.route('**/static/v/*/js/app.js', route => {
        applicationRequests++;
        return route.fulfill({ contentType: 'application/javascript', body: '' });
    });

    try {
        const response = await page.request.get(`${baseUrl}/api/peers?include_status=true`);
        assert.ok(response.ok(), 'the lifecycle test uses the real fixture peer snapshot');
        const { peers } = await response.json();
        assert.ok(peers.some(peer => peer.is_public && peer.as), 'the fixture has an identified public peer');
        await page.goto(baseUrl);
        const initialized = await page.evaluate(async peers => {
            const revision = document.body.dataset.assetRevision;
            const [{ create }, stateModule] = await Promise.all([
                import(`/static/v/${revision}/js/distribution/controller.js`),
                import(`/static/v/${revision}/js/core/dashboard-state.js`),
            ]);
            const dashboard = stateModule.create();
            const calls = [];
            const hookNames = [
                'drawLinesForAs', 'drawLinesForAllAs', 'clearAsLines', 'filterPeerTable',
                'dimMapPeers', 'zoomToPeerOnly', 'resetMapZoom', 'clearPeerSelection',
                'hideMapTooltip', 'enterPrivateNetMode', 'showDisconnectDialog',
            ];
            const hooks = Object.fromEntries(hookNames.map(name => [name, (...args) => {
                calls.push({ name, args: structuredClone(args) });
            }]));
            const controller = create({ dashboard, hooks });
            const visible = selector => {
                const element = document.querySelector(selector);
                return !!element && element.getClientRects().length > 0 &&
                    getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';
            };
            const snapshot = () => ({
                state: dashboard.distribution.snapshot(),
                peerIds: dashboard.peers.map(peer => peer.id),
                calls: structuredClone(calls),
                ui: {
                    focused: document.body.classList.contains('donut-focused'),
                    panelOpen: document.body.classList.contains('as-panel-open'),
                    panelFocus: document.body.classList.contains('panel-focus-as'),
                    allHovered: document.getElementById('as-distribution-container').classList.contains('as-all-hovered'),
                    legendVisible: document.getElementById('as-distribution-container').classList.contains('as-legend-visible'),
                    panelVisible: visible('#as-detail-panel'),
                    panelHidden: document.getElementById('as-detail-panel').classList.contains('hidden'),
                    overviewExpanded: document.getElementById('as-overview-trigger').getAttribute('aria-expanded'),
                    segments: document.querySelectorAll('#as-donut .as-donut-segment').length,
                    legendButtons: document.querySelectorAll('#as-legend .as-legend-item').length,
                    centerChildren: document.getElementById('as-donut-center').childElementCount,
                    insightChildren: document.getElementById('as-insight-rect').childElementCount,
                    peerPopups: document.querySelectorAll('.peer-detail-popup').length,
                    primaryVisible: visible('#as-sub-tooltip'),
                    secondaryVisible: visible('#as-sub-sub-tooltip'),
                    othersPopups: document.querySelectorAll('#as-others-popup').length,
                },
            });
            window.testDistributionLifecycle = { controller, dashboard, calls, peers, snapshot,
                retainedSegment: null, retainedProviderRow: null };
            controller.init();
            controller.init();
            controller.update(peers);
            calls.length = 0;
            return {
                singletonPeers: stateModule.dashboard.peers.length,
                tableRows: document.querySelectorAll('#peer-tbody tr').length,
                segments: document.querySelectorAll('#as-donut .as-donut-segment').length,
            };
        }, peers);
        assert.equal(applicationRequests, 1, 'the main application is suppressed before modules are imported');
        assert.equal(initialized.singletonPeers, 0, 'the factory updates only its supplied dashboard');
        assert.equal(initialized.tableRows, 0, 'there is no competing application instance');
        assert.ok(initialized.segments > 1, 'the independent controller renders real donut controls');

        await page.locator('#as-overview-trigger').focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('#as-detail-panel.visible');
        const overview = await page.evaluate(() => window.testDistributionLifecycle.snapshot());
        assert.equal(overview.state.donutFocused, true);
        assert.equal(overview.state.summarySelected, true);
        assert.equal(overview.ui.overviewExpanded, 'true');
        assert.equal(overview.calls.filter(call => call.name === 'hideMapTooltip').length, 0,
            'one overview activation enters summary without a duplicate back transition');
        assert.equal(overview.calls.filter(call => call.name === 'resetMapZoom').length, 0);

        const segment = page.locator('#as-donut .as-donut-segment').first();
        const provider = await segment.getAttribute('data-as');
        await page.evaluate(() => { window.testDistributionLifecycle.calls.length = 0; });
        await segment.focus();
        await page.keyboard.press('Enter');
        const selected = await page.evaluate(() => window.testDistributionLifecycle.snapshot());
        assert.equal(selected.state.selectedProvider, provider, 'one segment activation selects its provider once');
        assert.equal(selected.state.summarySelected, false);
        assert.equal(selected.calls.filter(call => call.name === 'drawLinesForAs').length, 1);
        assert.equal(selected.calls.filter(call => call.name === 'filterPeerTable' && call.args[0] !== null).length, 1);

        // Dispose with real nested popovers and a peer detail view still open.
        await page.locator('#as-overview-trigger').focus();
        await page.keyboard.press('Enter');
        await page.locator('#as-detail-panel .as-summary-row[data-cat-label="IPv4"]').click();
        await page.waitForSelector('#as-sub-tooltip', { state: 'visible' });
        await page.locator('#as-sub-tooltip .as-provider-peer-list').first().click();
        await page.waitForSelector('#as-sub-sub-tooltip', { state: 'visible' });
        await page.evaluate(() => {
            const lifecycle = window.testDistributionLifecycle;
            lifecycle.controller.openPeerDetailPanel(lifecycle.peers.find(peer => peer.is_public && peer.as), 'table');
            lifecycle.retainedSegment = document.querySelector('#as-donut .as-donut-segment');
            lifecycle.retainedProviderRow = document.querySelector('#as-sub-tooltip .as-provider-row');
        });
        await page.waitForSelector('.peer-detail-popup.visible');
        const active = await page.evaluate(() => window.testDistributionLifecycle.snapshot());
        assert.equal(active.state.subTooltipPinned, true);
        assert.equal(active.state.subSubTooltipPinned, true);
        assert.equal(active.state.peerDetailActive, true);
        assert.equal(active.ui.primaryVisible, true);
        assert.equal(active.ui.secondaryVisible, true);

        const disposed = await page.evaluate(() => {
            const lifecycle = window.testDistributionLifecycle;
            lifecycle.controller.dispose();
            const first = lifecycle.snapshot();
            lifecycle.controller.dispose();
            return { first, second: lifecycle.snapshot(), retainedConnected: lifecycle.retainedSegment.isConnected };
        });
        assert.deepEqual(disposed.second, disposed.first, 'repeated disposal has no additional state or hook effects');
        assert.equal(disposed.retainedConnected, false, 'disposal removes the rendered segment from the real DOM');
        assert.deepEqual(disposed.first.ui, {
            focused: false, panelOpen: false, panelFocus: false, allHovered: false, legendVisible: false,
            panelVisible: false, panelHidden: true,
            overviewExpanded: 'false', segments: 0, legendButtons: 0, centerChildren: 0, insightChildren: 0,
            peerPopups: 0, primaryVisible: false, secondaryVisible: false, othersPopups: 0,
        });
        for (const key of ['donutFocused', 'summarySelected', 'peerDetailActive', 'subTooltipPinned', 'subSubTooltipPinned']) {
            assert.equal(disposed.first.state[key], false, `${key} is cleared on disposal`);
        }
        for (const key of ['selectedProvider', 'selectedPeerId', 'activeNetwork', 'filterPeerIds', 'insightActiveType']) {
            assert.equal(disposed.first.state[key], null, `${key} is cleared on disposal`);
        }

        await page.evaluate(() => {
            const lifecycle = window.testDistributionLifecycle;
            const { controller, retainedSegment } = lifecycle;
            // A detached node can still dispatch its old listeners, so exercise it explicitly.
            retainedSegment.dispatchEvent(new MouseEvent('mouseenter'));
            retainedSegment.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            retainedSegment.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            lifecycle.retainedProviderRow.dispatchEvent(new MouseEvent('mouseleave'));
            for (const selector of ['#as-overview-trigger', '#as-donut-title', '#as-donut-center', '.as-lens-btn[data-lens="country"]', '.as-detail-close']) {
                const element = document.querySelector(selector);
                element.dispatchEvent(new MouseEvent('mouseenter'));
                element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            document.dispatchEvent(new MouseEvent('mouseleave'));
            controller.init();
            controller.update([]);
            controller.setHooks({ drawLinesForAllAs: () => lifecycle.calls.push({ name: 'replacementHook', args: [] }) });
            controller.setLegendsHidden(true);
            controller.enterFocusedMode();
            controller.openNetworkPanel('ipv4');
            controller.openPeerDetailPanel(lifecycle.peers.find(peer => peer.is_public && peer.as), 'table');
            controller.closePeerPopup();
            controller.onMapClick();
            controller.deselect();
            controller.exitFocusedMode();
        });
        await page.waitForTimeout(450);
        const afterInteractions = await page.evaluate(() => window.testDistributionLifecycle.snapshot());
        assert.deepEqual(afterInteractions, disposed.first,
            'retained listeners, persistent controls, and public methods cannot revive a disposed controller');
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
