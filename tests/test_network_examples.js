import assert from 'node:assert/strict';

export default async function assertNetworkExamples(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    let network = { chain: 'main', default_peer_port: 8333 };
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true'));
    await page.route('**/api/info', async route => {
        const response = await route.fetch(), info = await response.json();
        info.bitcoin_network = network;
        info.blockchain = null;
        await route.fulfill({ response, json: info });
    });
    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('mo-status').textContent === 'Unknown');
        for (const [chain, port] of [['main', 8333], ['test', 18333], ['testnet4', 48333], ['signet', 38333], ['regtest', 18444], ['missing', null], ['invalid', -1]]) {
            network = chain === 'missing' ? undefined : { chain, default_peer_port: port };
            const refreshed = page.waitForResponse(response => response.url().endsWith('/api/info'));
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            await refreshed;
            await page.locator('#btn-connect-peer').click();
            const suffix = port !== null && port > 0 ? `:${port}` : '';
            assert.deepEqual(await page.locator('.connect-example').allTextContents(), [
                `IPv4: 1.2.3.4${suffix}`, `IPv6: [2001:db8::1]${suffix}`,
                `Tor: abc...xyz.onion${suffix}`, 'I2P: abc...xyz.b32.i2p:0', `CJDNS: [fc00::1]${suffix}`,
            ]);
            if (!suffix) assert.match(await page.locator('#connect-peer-modal').textContent(), /server selects its configured network default/);
            await page.locator('#connect-close').click();
        }
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
}
