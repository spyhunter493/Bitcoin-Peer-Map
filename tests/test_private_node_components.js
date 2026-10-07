import assert from 'node:assert/strict';

export default async function assertPrivateNodeComponents(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/static/v/*/js/app.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    try {
        const peers = (await (await page.request.get(`${baseUrl}/api/peers?include_status=true`)).json()).peers;
        await page.goto(baseUrl);
        const initial = await page.evaluate(async peers => {
            const revision = document.body.dataset.assetRevision;
            const [state, privateModule, nodeModule, modal] = await Promise.all([
                import(`/static/v/${revision}/js/core/dashboard-state.js`),
                import(`/static/v/${revision}/js/peers/private-network.js`),
                import(`/static/v/${revision}/js/node/dashboard.js`),
                import(`/static/v/${revision}/js/core/modal.js`),
            ]);
            const dashboard = state.create();
            dashboard.replace(peers);
            const actions = [];
            const privateNetwork = privateModule.create({ dashboard, document,
                distribution: { closePeerPopup() {}, deselect() {}, isFocusedMode: () => false },
                mapView: { nodes: peers.map(peer => ({ peer, peerId: peer.id, alive: true, lon: 40, lat: -75 })),
                    target: { x: 0, y: 0, zoom: 1 }, width: 1440, height: 1000 },
                settings: { showDonutLegends: true }, nowSeconds: () => 2000000000,
                onAction: action => actions.push(action) });
            const node = nodeModule.create({ dashboard, document, config: { infoPollInterval: 10000 },
                onAction: action => actions.push(action) });
            privateNetwork.init();
            privateNetwork.init();
            node.init();
            node.init();
            privateNetwork.renderPnMiniDonut();
            await node.fetchInfo();
            window.componentLifecycle = { dashboard, actions, privateNetwork, node, modal };
            return { singletonPeers: state.dashboard.peers.length, peers: dashboard.peers.length };
        }, peers);
        assert.equal(initial.singletonPeers, 0);
        assert.equal(initial.peers, peers.length);
        await page.locator('.fd-net-chip[data-net="onion"]').click();
        assert.equal(await page.evaluate(() => window.componentLifecycle.actions.filter(action => action.type === 'network').length), 1);
        await page.locator('#mo-row-peers').click();
        await page.getByRole('dialog', { name: 'Node Metrics' }).waitFor();
        await page.locator('.si-dash-toggle').first().focus();
        await page.evaluate(() => window.componentLifecycle.node.fetchInfo());
        assert.equal(await page.locator('.si-dash-toggle').first().evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Escape');

        await page.evaluate(() => window.componentLifecycle.privateNetwork.enterPrivateNetMode());
        await page.waitForSelector('#pn-detail-panel.visible');
        const category = '#pn-detail-body .pn-interactive-row[data-net="onion"]';
        await page.locator(category).click();
        await page.waitForSelector('#pn-sub-tooltip[role="dialog"]');
        await page.locator('#pn-overview-search').fill('Tor');
        const before = await page.evaluate(() => {
            window.componentLifecycle.retainedChip = document.querySelector('.fd-net-chip[data-net="onion"]');
            window.componentLifecycle.retainedCategory = document.querySelector('#pn-detail-body .pn-interactive-row[data-net="onion"]');
            window.componentLifecycle.privateNetwork.updatePrivateNetUI();
            return {
                selected: window.componentLifecycle.dashboard.privateNetwork.pnSubTooltipPinned,
                search: document.getElementById('pn-overview-search').value,
            };
        });
        assert.equal(before.selected, true);
        assert.equal(before.search, 'Tor');
        const disposed = await page.evaluate(() => {
            const { privateNetwork, node, actions, retainedChip, retainedCategory } = window.componentLifecycle;
            privateNetwork.dispose(); node.dispose();
            privateNetwork.dispose(); node.dispose();
            const before = actions.length;
            retainedChip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            retainedCategory.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return { before, after: actions.length, privateMode: window.componentLifecycle.dashboard.privateNetwork.privateNetMode };
        });
        assert.equal(disposed.after, disposed.before, 'disposed controls cannot invoke actions');
        assert.equal(disposed.privateMode, false);
        assert.equal(await page.locator('#pn-sub-tooltip').count(), 0);
        await page.evaluate(() => {
            const { privateNetwork, node, actions } = window.componentLifecycle;
            privateNetwork.init(); privateNetwork.init(); node.init(); node.init();
            actions.length = 0;
            privateNetwork.renderPnMiniDonut();
        });
        await page.locator('.fd-net-chip[data-net="onion"]').click();
        assert.equal(await page.evaluate(() => window.componentLifecycle.actions.filter(action => action.type === 'network').length), 1);
        await page.locator('#mo-row-peers').click();
        await page.getByRole('dialog', { name: 'Node Metrics' }).waitFor();
        await page.evaluate(() => window.componentLifecycle.node.dispose());
        assert.equal(await page.locator('#system-info-modal').count(), 0, 'dispose closes owned dialogs');

        // Two documents have independent modal stacks and use their own focus realm.
        const frames = await page.evaluate(() => {
            const { modal } = window.componentLifecycle;
            const first = modal.open({ id: 'realm-dialog', title: 'Main document', document });
            const iframe = document.createElement('iframe');
            first.body.appendChild(iframe);
            const other = iframe.contentDocument;
            other.body.innerHTML = '<button id="other-trigger">Other</button>';
            other.getElementById('other-trigger').focus();
            const second = modal.open({ id: 'realm-dialog', title: 'Other document', document: other });
            const result = { mainInert: first.overlay.inert, otherInert: second.overlay.inert,
                otherFocus: other.activeElement.id, mainFocus: document.activeElement.id };
            second.close();
            result.returnedFocus = other.activeElement.id;
            result.mainStillOpen = first.isOpen();
            first.close(false);
            iframe.remove();
            return result;
        });
        assert.equal(frames.mainInert, false);
        assert.equal(frames.otherInert, false);
        assert.equal(frames.otherFocus, 'realm-dialog-close');
        assert.equal(frames.returnedFocus, 'other-trigger');
        assert.equal(frames.mainStillOpen, true);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
