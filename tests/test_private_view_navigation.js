import assert from 'node:assert/strict';

export default async function assertPrivateViewNavigation(browser, baseUrl) {
    const seedContext = await browser.newContext();
    const seed = await (await seedContext.request.get(`${baseUrl}/api/peers?include_status=true`)).json();
    await seedContext.close();
    const privatePeers = seed.peers.filter(peer => ['onion', 'i2p', 'cjdns'].includes(peer.network));
    assert.deepEqual([...new Set(privatePeers.map(peer => peer.network))].sort(), ['cjdns', 'i2p', 'onion']);
    const publicPeer = seed.peers.find(peer => peer.network === 'ipv4');
    assert.ok(publicPeer);

    async function returnToWorld(page) {
        // Opening the private panel moves the donut after the snapshot applies.
        // Wait for that transition so the real pointer click reaches Return.
        await page.waitForSelector('#pn-detail-panel.visible');
        await page.waitForFunction(() => document.getElementById('pn-container').getAnimations()
            .every(animation => !animation.pending && animation.playState !== 'running'));
        await page.getByRole('button', { name: 'Return to public network view' }).click();
        await page.waitForFunction(() => window.privateViewDashboard.privateNetwork.privateNetMode === false);
    }

    async function scenario(initialPeers, run, { failed = false, delayed = false } = {}) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        await context.addInitScript(() => {
            localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
            const interval = window.setInterval.bind(window);
            window.setInterval = (handler, ms, ...args) => {
                if (ms === 10000) {
                    window.privateViewPoll = handler;
                    return interval(handler, 3600000, ...args);
                }
                return interval(handler, ms, ...args);
            };
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let peers = initialPeers, firstRequest = true, releaseFirst, nextMarkerId = 9000;
        const firstResponse = delayed ? new Promise(resolve => { releaseFirst = resolve; }) : null;
        let requested;
        const initialRequest = new Promise(resolve => { requested = resolve; });
        await page.route('**/api/peers?include_status=true', async route => {
            if (firstRequest) {
                firstRequest = false;
                requested();
                if (firstResponse) await firstResponse;
                if (failed) return route.fulfill({ status: 503, json: { detail: 'temporarily unavailable' } });
            }
            return route.fulfill({ json: {
                ...seed, peers,
                status: { ...seed.status, last_success_at: Date.now() / 1000, age_seconds: 0 },
            } });
        });
        try {
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            await initialRequest;
            await page.evaluate(async () => {
                const revision = document.body.dataset.assetRevision;
                window.privateViewDashboard = (await import(`/static/v/${revision}/js/core/dashboard-state.js`)).dashboard;
            });
            if (!delayed) {
                await page.waitForFunction(expected => document.getElementById('status-dot')?.dataset.state === expected,
                    failed ? 'dashboard-unavailable' : 'live');
            }
            const mode = () => page.evaluate(() => window.privateViewDashboard.privateNetwork.privateNetMode);
            const poll = async nextPeers => {
                // A new peer ID proves that the response was applied before checking navigation.
                const marker = { ...nextPeers[0], id: nextMarkerId++ };
                peers = [...nextPeers, marker];
                const response = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
                await page.evaluate(() => window.privateViewPoll());
                await response;
                await page.waitForFunction(id => window.privateViewDashboard.byId.has(id), marker.id);
            };
            const release = async () => {
                releaseFirst();
                await page.waitForFunction(() => document.getElementById('status-dot')?.dataset.state === 'live');
            };
            await run({ page, mode, poll, release });
            assert.deepEqual(errors, []);
        } finally {
            releaseFirst?.();
            await context.close();
        }
    }

    await scenario(privatePeers, async ({ page, mode, poll }) => {
        assert.equal(await mode(), true, 'a private-only startup defaults to private mode');
        await returnToWorld(page);
        assert.equal(await mode(), false);
        await poll(privatePeers);
        assert.equal(await mode(), false, 'a successful poll preserves Return to the world view');
        assert.deepEqual(await page.evaluate(() => [...window.privateViewDashboard.interaction.enabledNets].sort()),
            ['cjdns', 'i2p', 'ipv4', 'ipv6', 'onion'], 'polling preserves the filters restored by Return');

        await page.locator('.fd-net-chip[data-net="i2p"]').click();
        await page.waitForSelector('#pn-detail-panel.visible');
        await poll(privatePeers);
        assert.equal(await mode(), true, 'private mode remains available through deliberate navigation');
        assert.equal(await page.evaluate(() => window.privateViewDashboard.privateNetwork.pnSelectedNet), 'i2p');
    });

    for (const initialPeers of [[publicPeer, ...privatePeers], []]) {
        await scenario(initialPeers, async ({ mode, poll }) => {
            assert.equal(await mode(), false);
            await poll(privatePeers);
            assert.equal(await mode(), false, 'mixed and empty startups keep their world view when only private peers remain');
        });
    }

    await scenario(privatePeers, async ({ page, mode, poll }) => {
        assert.equal(await mode(), false, 'a failed initial request has no snapshot to select a view');
        await poll(privatePeers);
        assert.equal(await mode(), true, 'the first applied snapshot still selects the startup view after a failure');
        await returnToWorld(page);
        await poll(privatePeers);
        assert.equal(await mode(), false);
    }, { failed: true });

    for (const navigate of [
        async page => {
            await page.locator('#zoom-in').click();
            await page.locator('#zoom-reset').click();
        },
        async page => {
            await page.locator('.fd-net-chip[data-net="ipv4"]').click();
            await page.waitForSelector('#as-detail-panel.visible');
        },
        async page => {
            await page.locator('#as-overview-trigger').focus();
            await page.keyboard.press('Enter');
            await page.waitForSelector('#as-detail-panel.visible');
        },
        async page => {
            await page.locator('#worldmap').click({ position: { x: 10, y: 200 } });
        },
        async page => {
            await page.locator('#topbar-gear').click();
            await page.locator('.dsp-toggle').filter({ has: page.locator('input[data-vis-target="pn-mini-donut"]') }).click();
        },
    ]) {
        await scenario(privatePeers, async ({ page, mode, poll, release }) => {
            await navigate(page);
            await release();
            assert.equal(await mode(), false, 'a delayed initial snapshot preserves prior navigation or private-view visibility');
            await poll(privatePeers);
            assert.equal(await mode(), false);
        }, { delayed: true });
    }
}
