'use strict';

const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await page.setContent(`
            <div id="peer-panel" class="peer-panel">
                <div id="peer-panel-handle" class="peer-panel-handle"></div>
                <div class="peer-panel-body"><div class="peer-table-wrap">
                    <table id="peer-table"><thead id="peer-thead"></thead><tbody id="peer-tbody"></tbody></table>
                </div></div>
            </div>
            <button id="btn-autofit"></button><button id="btn-table-settings"></button>
        `);
        const repoRoot = path.resolve(__dirname, '..');
        await page.addScriptTag({ path: path.join(repoRoot, 'src/static/js/core/format.js') });
        await page.addScriptTag({ path: path.join(repoRoot, 'src/static/js/features/service-flags.js') });
        await page.addScriptTag({ path: path.join(repoRoot, 'src/static/js/features/peer-table-model.js') });
        await page.addScriptTag({ path: path.join(repoRoot, 'src/static/js/features/peer-table.js') });
        const result = await page.evaluate(() => {
            let peers = [
                { id: 1, network: 'ipv4', direction: 'IN', addr: '<img src=x onerror=alert(1)>',
                    conntime_fmt: '1m', ping_ms: 20, services: [] },
                { id: 2, network: 'ipv6', direction: 'OUT', addr: '2001:db8::2',
                    conntime_fmt: '2m', ping_ms: 30, services: [] },
                { id: 3, network: 'ipv4', direction: 'IN', addr: '192.0.2.3',
                    conntime_fmt: '3m', ping_ms: 40, services: [] },
            ];
            let saved = {};
            let filter = null;
            const dashboard = {
                peers,
                privateNetwork: { privateNetMode: false, pnSelectedNet: null },
                interaction: { enabledNets: new Set(['ipv4', 'ipv6']), asFilterPeerIds: null,
                    mapFilterPeerIds: null, highlightedPeerId: null },
            };
            const table = window.BPMPeerTable.create({
                dashboard, mapView: { width: 1000 },
                preferences: {
                    readSavedDisplaySettings: () => saved,
                    writeSavedDisplaySettings: value => { saved = value; },
                },
                onAction() {},
            });
            table.renderPeerTable();
            const body = document.getElementById('peer-tbody');
            const row = body.querySelector('tr[data-id="1"]');
            const durationCell = row.cells[2];
            const pingCell = row.cells[12];
            const originalPing = pingCell.textContent;
            const safe = !row.querySelector('img') && row.textContent.includes('<img src=x');
            row.dataset.preserved = 'yes';
            peers[0] = { ...peers[0], ping_ms: 21 };
            table.renderPeerTable();
            const updatedInPlace = body.querySelector('tr[data-id="1"]') === row &&
                row.cells[2] === durationCell && row.cells[12] === pingCell &&
                row.cells[12].textContent !== originalPing && row.dataset.preserved === 'yes';
            document.querySelector('th[data-sort="ping_ms"]').click();
            document.querySelector('th[data-sort="ping_ms"]').click();
            const reordered = Array.from(body.rows, item => Number(item.dataset.id)).join(',') === '3,2,1' &&
                body.querySelector('tr[data-id="1"]') === row;
            dashboard.interaction.enabledNets = new Set(['ipv6']);
            table.renderPeerTable();
            const filtered = body.rows.length === 1 && body.rows[0].dataset.id === '2';
            dashboard.interaction.enabledNets = new Set(['ipv4', 'ipv6']);
            dashboard.peers = peers = [peers[0], peers[1], { ...peers[2], id: 4 }];
            table.renderPeerTable();
            const membership = Array.from(body.rows, item => Number(item.dataset.id)).sort().join(',') === '1,2,4';
            saved = { visibleColumns: ['id', 'network', 'ping_ms'] };
            table.loadTableDisplaySettings();
            table.renderPeerTable();
            const columns = body.querySelector('tr[data-id="1"]').cells.length === 4;
            return { safe, updatedInPlace, reordered, filtered, membership, columns };
        });
        for (const [check, passed] of Object.entries(result)) {
            assert.strictEqual(passed, true, check);
        }
        await page.close();
    } finally {
        await browser.close();
    }
    console.log('Peer table DOM tests passed');
})().catch(error => { console.error(error); process.exit(1); });
