'use strict';

// Repeatable, synthetic browser profile for the dashboard's large-peer path.
// Run with: npm run benchmark:dashboard
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const staticRoot = path.join(root, 'src/static');
const html = fs.readFileSync(path.join(root, 'src/templates/index.html'), 'utf8')
    .replaceAll('{{ asset_revision }}', 'benchmark')
    .replaceAll('{{ repository_url }}', '#')
    .replaceAll('{{ revision_url }}', '#')
    .replaceAll('{{ revision }}', 'benchmark')
    .replaceAll('{{ repository_discussions_url }}', '#');
const contentTypes = {
    '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};

function peersForCount(count) {
    const connectedAt = Math.floor(Date.now() / 1000);
    return Array.from({ length: count }, (_, index) => {
        const id = index + 1;
        const address = `198.51.${Math.floor(index / 250) % 250}.${index % 250 + 1}`;
        const provider = `Provider ${index % 20}`;
        return {
            id, network: 'ipv4', addr: `${address}:8333`, ip: address, port: 8333,
            direction: index % 2 ? 'IN' : 'OUT',
            connection_type: index % 2 ? 'inbound' : 'manual',
            conntime: connectedAt - id * 137, conntime_fmt: `${id + 2}m`,
            subver: '/Satoshi:29.1.0/', services: ['NETWORK', 'WITNESS'],
            city: 'City', region: 'Region', regionName: 'Region',
            country: 'Country', countryCode: 'CO', continent: 'Europe', continentCode: 'EU',
            isp: provider, org: provider, as: `AS${index % 20 + 1}`, asname: provider,
            lat: -70 + (index * 41 % 140), lon: -180 + (index * 67 % 360),
            location_status: 'ok', ping_ms: 40 + index % 100,
            bytessent: id * 100000, bytesrecv: id * 120000,
            bytessent_fmt: `${id * 100}KB`, bytesrecv_fmt: `${id * 120}KB`,
            in_addrman: index % 3 === 0, hosting: true, mobile: false, proxy: false,
        };
    });
}

function createServer() {
    let peers = [];
    let peerRequests = 0;
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname === '/') {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end(html);
            return;
        }
        if (pathname.startsWith('/static/')) {
            const filename = path.resolve(staticRoot, pathname.slice('/static/'.length));
            if (!filename.startsWith(staticRoot + path.sep)) {
                response.writeHead(403); response.end(); return;
            }
            fs.readFile(filename, (error, body) => {
                if (error) { response.writeHead(404); response.end(); return; }
                response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filename)] || 'application/octet-stream' });
                response.end(body);
            });
            return;
        }
        if (pathname === '/api/stream/system') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            response.write('event: system\ndata: {"rx_bps":0,"tx_bps":0,"cpu_pct":0,"mem_pct":0}\n\n');
            return;
        }
        let body = {};
        if (pathname === '/api/peers') {
            peerRequests++;
            body = { peers, status: {
                connected: true, last_success_at: Date.now() / 1000,
                age_seconds: 0, stale_after_seconds: 30,
            } };
        } else if (pathname === '/api/info') {
            body = {
                blockchain: { ibd: false }, internet_state: 'green', api_available: true,
                node_traffic: {}, network_scores: {}, network_details: {},
            };
        } else if (pathname === '/api/stats') {
            body = { system_stats: {} };
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
    });
    return {
        server,
        setPeerCount(count) { peers = peersForCount(count); peerRequests = 0; },
        get peerRequests() { return peerRequests; },
    };
}

async function main() {
    const fixture = createServer();
    await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`;
    let browser;
    try {
        browser = await chromium.launch();
        console.log('Peers | Main-thread task time / 3 s | DOM nodes | JS heap | Unchanged-poll table mutations');
        for (const count of [14, 125, 500]) {
            fixture.setPeerCount(count);
            const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
            try {
                const page = await context.newPage();
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await page.route('https://fonts.googleapis.com/**', route => route.abort());
                await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(expected => document.querySelectorAll('#peer-tbody tr').length === expected,
                    count, { timeout: 30000 });
                await page.waitForTimeout(6000); // Let arrival effects settle.
                const session = await context.newCDPSession(page);
                await session.send('Performance.enable');
                const metrics = async () => Object.fromEntries(
                    (await session.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value])
                );
                const before = await metrics();
                await page.waitForTimeout(3000);
                const after = await metrics();
                await page.evaluate(() => {
                    window.benchmarkTableMutations = 0;
                    new MutationObserver(records => { window.benchmarkTableMutations += records.length; })
                        .observe(document.getElementById('peer-tbody'), {
                            subtree: true, childList: true, characterData: true, attributes: true,
                        });
                });
                const deadline = Date.now() + 5000;
                while (fixture.peerRequests < 2 && Date.now() < deadline) {
                    await page.waitForTimeout(100);
                }
                if (fixture.peerRequests < 2) throw new Error('Peer poll did not run');
                await page.waitForTimeout(250);
                const dom = await page.evaluate(() => ({
                    nodes: document.getElementsByTagName('*').length,
                    mutations: window.benchmarkTableMutations,
                }));
                if (errors.length) throw new Error(`Page errors at ${count} peers: ${errors.join('; ')}`);
                console.log(`${count} | ${(after.TaskDuration - before.TaskDuration).toFixed(3)} s | ` +
                    `${dom.nodes} | ${(after.JSHeapUsedSize / 1048576).toFixed(1)} MB | ${dom.mutations}`);
            } finally {
                await context.close();
            }
        }
    } finally {
        if (browser) await browser.close();
        fixture.server.closeAllConnections();
        await new Promise(resolve => fixture.server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
