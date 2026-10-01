import assert from 'node:assert/strict';

export default async function assertSystemHud(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1638, height: 900 }, deviceScaleFactor: 1.25 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        window.EventSource = class extends EventTarget {
            constructor() {
                super();
                window.testSystemStream = this;
                queueMicrotask(() => this.dispatchEvent(new MessageEvent('system', {
                    data: JSON.stringify({ rx_bps: 512, tx_bps: 256, cpu_pct: 9, mem_pct: 20 }),
                })));
            }
            close() {}
        };
    });

    async function ready() {
        await page.waitForFunction(() => document.getElementById('mo-p2p-in')?.textContent === '8.00GB');
    }
    async function controlsFit() {
        const stats = await page.locator('#map-overlay').boundingBox();
        const controls = await page.locator('#map-controls').boundingBox();
        assert.ok(controls.y >= stats.y + stats.height + 10, 'controls must sit below all visible stats');
        for (const id of ['zoom-in', 'zoom-out', 'zoom-reset']) {
            const button = page.locator(`#${id}`);
            const box = await button.boundingBox();
            assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= page.viewportSize().width && box.y + box.height <= page.viewportSize().height);
            await button.click({ trial: true });
        }
        return controls.y;
    }
    async function toggle(id) {
        await page.locator(`.si-dash-toggle[data-target="${id}"] + .dsp-toggle-slider`).click();
    }

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await ready();
        assert.equal(await page.locator('#peer-data-age').count(), 0);
        await page.locator('#topbar-countdown').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#ro-rate-in').textContent(), '512 B/s');

        for (const viewport of [{ width: 1638, height: 900 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            await controlsFit();
        }
        await page.setViewportSize({ width: 1638, height: 900 });
        await page.evaluate(() => document.body.classList.add('hud-solid', 'donut-focused'));
        await controlsFit();
        await page.evaluate(() => document.body.classList.remove('hud-solid', 'donut-focused'));

        const rows = await page.locator('.mo-traffic-value').evaluateAll(values => values.map(value => ({
            right: value.getBoundingClientRect().right,
            fontSize: getComputedStyle(value).fontSize,
            fontWeight: getComputedStyle(value).fontWeight,
        })));
        assert.equal(rows.length, 4);
        assert.ok(rows.every(row => row.right === rows[0].right && row.fontSize === rows[0].fontSize && row.fontWeight === rows[0].fontWeight), 'NET and P2P share aligned text styling');

        // Small rate changes and a return to zero must not leave stale HUD values.
        for (const rate of [768, 0]) {
            await page.evaluate(rx_bps => window.testSystemStream.dispatchEvent(new MessageEvent('system', {
                data: JSON.stringify({ rx_bps, tx_bps: 0 }),
            })), rate);
            assert.equal(await page.locator('#ro-rate-in').textContent(), `${rate} B/s`);
        }

        const expandedY = await controlsFit();
        await page.locator('#mo-row-p2p-in').click();
        const body = page.locator('#system-info-body');
        assert.deepEqual(await body.locator('.modal-section-title').allTextContents(), ['System', 'Network Traffic', 'Dashboard Display']);
        assert.equal(await body.locator('.si-dash-toggle').count(), 6);
        assert.match(await body.textContent(), /NET IN ↓ \(rate\)0 B\/s/);
        assert.match(await body.textContent(), /P2P IN ↓ \(total\)8.00GB/);
        assert.match(await body.textContent(), /P2P OUT ↑ \(total\)320.00GB/);
        assert.equal(await page.locator('.ro-bar-bg, .net-traffic-bar, [name="si-netbar-mode"]').count(), 0);
        await toggle('mo-row-p2p-in');
        await toggle('mo-row-p2p-out');
        await page.locator('#system-info-close').click();
        assert.equal(await page.locator('#mo-row-p2p-in').isVisible(), false);
        assert.equal(await page.locator('#mo-row-p2p-out').isVisible(), false);
        assert.ok(await controlsFit() < expandedY, 'controls follow the reduced stats height');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready();
        assert.equal(await page.locator('#mo-row-p2p-in').isVisible(), false);
        assert.equal(await page.locator('#mo-row-p2p-out').isVisible(), false);
        await page.locator('#mo-row-peers').click();
        assert.equal(await page.getByRole('checkbox', { name: 'P2P ↓ (Downloaded total)', exact: true }).isChecked(), false);
        await toggle('mo-row-p2p-in');
        await page.locator('#system-info-close').click();
        assert.equal(await page.locator('#mo-row-p2p-in').isVisible(), true);
        assert.equal(await page.locator('#mo-row-p2p-out').isVisible(), false);
        await controlsFit();
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
}
