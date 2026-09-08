'use strict';

const assert = require('assert');
const http = require('http');
const net = require('net');
const path = require('path');
const { once } = require('events');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => resolve(address.port));
        });
    });
}

function requestStatus(url) {
    return new Promise(resolve => {
        const req = http.get(url, response => {
            response.resume();
            resolve(response.statusCode);
        });
        req.on('error', () => resolve(0));
        req.setTimeout(500, () => {
            req.destroy();
            resolve(0);
        });
    });
}

function startServer(port) {
    const env = Object.assign({}, process.env, {
        BPM_LAYOUT_TEST_PORT: String(port),
        PYTHONPATH: path.join(repoRoot, 'src'),
    });
    const child = spawn(process.env.PYTHON || 'python3', ['tests/layout_server.py'], {
        cwd: repoRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.output = '';
    child.stdout.on('data', chunk => { child.output += chunk.toString(); });
    child.stderr.on('data', chunk => { child.output += chunk.toString(); });
    return child;
}

async function waitForServer(baseUrl, child) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (child && child.exitCode !== null) {
            throw new Error(`layout server exited early:\n${child.output}`);
        }
        if (await requestStatus(`${baseUrl}/healthz`) === 200) return;
        await delay(100);
    }
    const output = child ? child.output : 'external layout server was not reachable';
    throw new Error(`layout server did not become ready:\n${output}`);
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    const exited = once(child, 'exit');
    const timedOut = delay(3000).then(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
    });
    await Promise.race([exited, timedOut]);
}

async function waitForDashboardReady(page) {
    await page.waitForFunction(() => {
        const asSegments = document.querySelectorAll('#as-donut .as-donut-segment');
        const privateDonut = document.getElementById('pn-mini-donut');
        const rows = document.querySelectorAll('#peer-tbody tr');
        return (
            asSegments.length > 0 &&
            privateDonut &&
            privateDonut.classList.contains('visible') &&
            privateDonut.offsetHeight > 0 &&
            rows.length >= 10
        );
    }, null, { timeout: 15000 });
    await page.waitForTimeout(700);
}

async function donutLayout(page) {
    return page.evaluate(() => {
        const container = document.getElementById('as-distribution-container');
        const panel = document.getElementById('peer-panel');
        const privateDonut = document.getElementById('pn-mini-donut');
        const containerRect = container.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const style = getComputedStyle(container);
        return {
            gap: panelRect.top - containerRect.bottom,
            scale: parseFloat(style.getPropertyValue('--as-donut-fit-scale')) || 1,
            containerBottom: containerRect.bottom,
            containerRight: containerRect.right,
            panelTop: panelRect.top,
            privateVisible: privateDonut.classList.contains('visible'),
            viewportWidth: window.innerWidth,
        };
    });
}

async function assertDonutFits(page, label) {
    await page.waitForFunction(() => {
        const container = document.getElementById('as-distribution-container');
        const panel = document.getElementById('peer-panel');
        if (!container || !panel) return false;
        const containerRect = container.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        return panelRect.top - containerRect.bottom >= 8;
    }, null, { timeout: 2500 });

    const layout = await donutLayout(page);
    assert.ok(layout.privateVisible, `${label}: private donut should be visible`);
    assert.ok(layout.scale <= 1, `${label}: scale should not exceed 1, got ${layout.scale}`);
    assert.ok(layout.gap >= 8, `${label}: donut/table gap too small: ${layout.gap}`);
    assert.ok(
        layout.containerRight <= layout.viewportWidth,
        `${label}: donut stack spills off the right edge: ${layout.containerRight}`
    );
}

async function applyTablePreferences(page) {
    await page.evaluate(() => document.getElementById('btn-table-settings').click());
    await page.waitForSelector('#table-settings-popup');
    await page.evaluate(() => {
        const rows = document.getElementById('tsp-rows');
        rows.value = '13';
        rows.dispatchEvent(new Event('input', { bubbles: true }));

        const opacity = document.getElementById('tsp-opacity');
        opacity.value = '35';
        opacity.dispatchEvent(new Event('input', { bubbles: true }));

        const latColumn = document.querySelector('input[data-col="lat"]');
        latColumn.checked = true;
        latColumn.dispatchEvent(new Event('change', { bubbles: true }));

        const antToggle = document.getElementById('tsp-antarctica');
        antToggle.checked = false;
        antToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function assertTablePreferencesRestored(page) {
    await page.evaluate(() => document.getElementById('btn-table-settings').click());
    await page.waitForSelector('#table-settings-popup');
    const restored = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('bpm.peerTable.display'));
        return {
            rows: document.getElementById('tsp-rows').value,
            opacity: document.getElementById('tsp-opacity').value,
            latChecked: document.querySelector('input[data-col="lat"]').checked,
            antChecked: document.getElementById('tsp-antarctica').checked,
            savedRows: saved.maxPeerRows,
            savedOpacity: saved.panelOpacity,
            savedLat: saved.visibleColumns.includes('lat'),
            savedAntarctica: saved.showAntarcticaPeers,
        };
    });
    assert.deepStrictEqual(restored, {
        rows: '13',
        opacity: '35',
        latChecked: true,
        antChecked: false,
        savedRows: 13,
        savedOpacity: 35,
        savedLat: true,
        savedAntarctica: false,
    });
}

(async () => {
    const externalBaseUrl = process.env.BPM_LAYOUT_TEST_BASE_URL;
    const port = externalBaseUrl ? null : await freePort();
    const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
    const server = externalBaseUrl ? null : startServer(port);
    let browser;

    try {
        await waitForServer(baseUrl, server);

        browser = await chromium.launch();
        const context = await browser.newContext({
            viewport: { width: 1638, height: 728 },
            deviceScaleFactor: 1.25,
        });
        await context.addInitScript(() => {
            localStorage.setItem('bpm.antarcticaDisclaimerSeen', 'true');
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.stack || error.message));

        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await waitForDashboardReady(page);
        await assertDonutFits(page, 'initial render');

        await applyTablePreferences(page);
        await assertDonutFits(page, 'after row-count change');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForDashboardReady(page);
        await assertTablePreferencesRestored(page);
        assert.deepStrictEqual(pageErrors, []);

        await context.close();
        console.log('Browser layout regression tests passed');
    } finally {
        if (browser) await browser.close();
        await stopServer(server);
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
