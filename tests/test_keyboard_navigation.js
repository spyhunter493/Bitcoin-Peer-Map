import assert from 'node:assert/strict';

export default async function assertKeyboardNavigation(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        const interval = window.setInterval.bind(window);
        window.setInterval = (handler, ms, ...args) => {
            if (ms === 10000) {
                window.keyboardTestPoll = handler;
                return interval(handler, 3600000, ...args);
            }
            return interval(handler, ms, ...args);
        };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const seed = await (await page.request.get(`${baseUrl}/api/peers?include_status=true`)).json();
    const publicPeer = seed.peers.find(peer => peer.network === 'ipv4' && peer.as);
    const privatePeer = seed.peers.find(peer => peer.network === 'onion');
    assert.ok(publicPeer && privatePeer);
    let peers = [
        ...Array.from({ length: 9 }, (_, index) => ({ ...publicPeer, id: index + 1, is_public: true })),
        ...Array.from({ length: 8 }, (_, index) => ({ ...privatePeer, id: index + 101, is_public: false })),
    ];
    await page.route('**/api/peers?include_status=true', route => route.fulfill({ json: { ...seed, peers } }));
    const activate = async (selector, key = 'Enter') => {
        await page.locator(selector).focus();
        await page.keyboard.press(key);
    };
    const poll = async () => {
        const response = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
        await page.evaluate(() => window.keyboardTestPoll());
        await response;
    };
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#peer-tbody tr[data-id="1"]');
        await activate('.net-badge[data-net="ipv4"]', 'Space');
        assert.equal(await page.locator('.net-badge[data-net="ipv4"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.net-badge[data-net="onion"]').getAttribute('aria-pressed'), 'false');
        assert.equal(await page.locator('#peer-tbody').getAttribute('data-peer-count'), '9');
        await activate('.net-badge[data-net="all"]');

        await activate('#as-overview-trigger');
        await page.waitForSelector('#as-detail-panel.visible');
        assert.equal(await page.locator('#as-overview-trigger').getAttribute('aria-expanded'), 'true');
        const categorySelector = '#as-detail-panel .as-summary-row[data-cat-label="IPv4"]';
        await activate(categorySelector);
        await page.waitForSelector('#as-sub-tooltip[role="dialog"]');
        assert.equal(await page.locator(categorySelector).getAttribute('aria-expanded'), 'true');
        const providerSelector = '#as-sub-tooltip .as-provider-peer-list';
        await activate(providerSelector, 'Space');
        await page.waitForSelector('#as-sub-sub-tooltip[role="dialog"]');
        assert.equal(await page.locator('#as-sub-sub-tooltip .as-sub-tt-id-link').first().evaluate(button => button === document.activeElement), true);
        await activate('#as-sub-sub-tooltip .as-sub-tt-show-more');
        assert.equal(await page.locator('#as-sub-sub-tooltip .as-sub-tt-show-less').evaluate(button => button === document.activeElement), true);
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#as-sub-sub-tooltip .as-sub-tt-show-more').evaluate(button => button === document.activeElement), true);

        peers = peers.map(peer => ({ ...peer, ping_ms: 17 }));
        await poll();
        await page.waitForFunction(() => document.activeElement?.classList.contains('as-sub-tt-show-more'));
        await page.keyboard.press('Escape');
        await page.waitForSelector('#as-sub-sub-tooltip', { state: 'hidden' });
        assert.equal(await page.locator(providerSelector).evaluate(button => button === document.activeElement), true,
            'nested Escape restores the refreshed provider control');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#as-sub-tooltip', { state: 'hidden' });
        assert.equal(await page.locator(categorySelector).evaluate(button => button === document.activeElement), true,
            'parent Escape restores the refreshed category control');
        await activate(categorySelector);
        await activate(providerSelector);
        await activate('#as-sub-tooltip .as-popover-close');
        await page.waitForSelector('#as-sub-tooltip', { state: 'hidden' });
        await page.waitForSelector('#as-sub-sub-tooltip', { state: 'hidden' });
        assert.equal(await page.locator(categorySelector).evaluate(button => button === document.activeElement), true,
            'the parent Close control dismisses both pinned lists');
        await activate('#as-focused-close');
        assert.equal(await page.locator('#as-overview-trigger').evaluate(button => button === document.activeElement), true);

        await page.locator('.as-lens-btn[data-lens="provider"]').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('.as-lens-btn[data-lens="country"]').getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('.as-lens-btn[data-lens="country"]').evaluate(button => button === document.activeElement), true);
        await page.keyboard.press('Home');
        assert.equal(await page.locator('.as-lens-btn[data-lens="provider"]').getAttribute('aria-selected'), 'true');

        await activate('#pn-mini-trigger');
        await page.waitForSelector('#pn-detail-panel.visible');
        const privateCategory = '#pn-detail-body .pn-interactive-row[data-net="onion"]';
        await activate(privateCategory);
        await page.waitForSelector('#pn-sub-tooltip[role="dialog"]');
        await activate('#pn-sub-tooltip .pn-sub-tt-show-more');
        assert.equal(await page.locator('#pn-sub-tooltip .pn-sub-tt-show-less').evaluate(button => button === document.activeElement), true);
        await page.keyboard.press('Escape');
        await page.waitForSelector('#pn-sub-tooltip', { state: 'hidden' });
        assert.equal(await page.locator(privateCategory).evaluate(button => button === document.activeElement), true);
        await activate('#peer-tbody tr[data-id="101"] button[data-action="details"]');
        await page.waitForSelector('.pn-big-popup.visible');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.pn-big-popup', { state: 'detached' });
        assert.equal(await page.locator('#disconnect-dialog').count(), 0);
        await activate('#pn-detail-close');
        await page.waitForFunction(() => !document.body.classList.contains('private-net-mode'));
        assert.equal(await page.locator('#pn-mini-trigger').evaluate(button => button === document.activeElement), true);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
