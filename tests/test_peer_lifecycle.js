'use strict';
const assert = require('node:assert/strict');

module.exports = async function assertPeerLifecycle(browser, baseUrl) {
    for (const privateMode of [false, true]) {
        const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
        await context.addInitScript(() => {
            localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
            const interval = window.setInterval;
            window.setInterval = (handler, ms, ...args) => {
                if (ms === 10000) {
                    window.testPeerPoll = handler;
                    return interval(handler, 3600000, ...args);
                }
                return interval(handler, ms, ...args);
            };
            window.testDocumentListeners = { mousemove: new Set(), mouseup: new Set() };
            const add = document.addEventListener.bind(document);
            const remove = document.removeEventListener.bind(document);
            document.addEventListener = (type, listener, ...args) => {
                window.testDocumentListeners[type]?.add(listener);
                return add(type, listener, ...args);
            };
            document.removeEventListener = (type, listener, ...args) => {
                window.testDocumentListeners[type]?.delete(listener);
                return remove(type, listener, ...args);
            };
        });
        const page = await context.newPage();
        try {
            const seed = await (await page.request.get(baseUrl + '/api/peers?include_status=true')).json();
            let peers = seed.peers;
            await page.route('**/api/peers?include_status=true', route => route.fulfill({
                json: { peers, status: { ...seed.status, last_success_at: Date.now() / 1000, age_seconds: 0 } },
            }));
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.querySelectorAll('#peer-tbody tr').length >= 10);
            if (privateMode) {
                await page.click('#pn-mini-donut');
                await page.waitForSelector('#pn-detail-panel.visible');
            }
            const row = page.locator('#peer-tbody tr').first();
            const peerId = Number(await row.getAttribute('data-id'));
            const listenerCounts = () => page.evaluate(() => Object.fromEntries(
                Object.entries(window.testDocumentListeners).map(([key, value]) => [key, value.size])
            ));
            const before = await listenerCounts();
            for (let i = 0; i < (privateMode ? 50 : 2); i++) {
                await row.click();
                await page.waitForSelector('.peer-detail-popup.visible');
                await page.locator('.peer-popup-close').click();
                await page.waitForSelector('.peer-detail-popup', { state: 'detached' });
            }
            assert.deepEqual(await listenerCounts(), before, 'closing popups must release document listeners');
            await row.click();
            await page.waitForSelector('.peer-detail-popup.visible');
            const popup = page.locator('.peer-detail-popup');
            await popup.evaluate(el => { el.style.width = '420px'; el.querySelector('.peer-popup-scroll').scrollTop = 100; });
            const scroll = await popup.locator('.peer-popup-scroll').evaluate(el => el.scrollTop);
            peers = peers.map(peer => peer.id === peerId ? { ...peer, subver: 'Updated Software' } : peer);
            async function poll() {
                const received = page.waitForResponse(response => response.url().includes('/api/peers?include_status=true'));
                await page.evaluate(() => window.testPeerPoll());
                await received;
                await page.waitForTimeout(50);
            }
            await poll();
            assert.ok((await popup.textContent()).includes('Updated Software'));
            assert.equal(await popup.evaluate(el => el.style.width), '420px');
            assert.equal(await popup.locator('.peer-popup-scroll').evaluate(el => el.scrollTop), scroll);
            await popup.locator('.peer-popup-header').dispatchEvent('mousedown', { clientX: 100, clientY: 100 });
            peers = peers.filter(peer => peer.id !== peerId);
            await poll();
            await page.waitForSelector('.peer-detail-popup', { state: 'detached' });
            assert.equal(await page.locator(`#peer-tbody tr[data-id="${peerId}"]`).count(), 0);
            assert.deepEqual(await listenerCounts(), before);
        } finally {
            await context.close();
        }
    }
};
