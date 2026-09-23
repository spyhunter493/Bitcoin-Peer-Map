import assert from 'node:assert/strict';
import { createServer } from '../scripts/benchmark-dashboard.js';

export default async function assertModules(browser) {
    const fixture = createServer();
    fixture.setPeerCount(14);
    await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`;
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const load = async revision => {
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.querySelectorAll('#peer-tbody tr').length === 14);
            const modules = await page.evaluate(() => performance.getEntriesByType('resource')
                .filter(entry => new URL(entry.name).pathname.endsWith('.js'))
                .map(entry => ({ path: new URL(entry.name).pathname, transferred: entry.transferSize })));
            assert.ok(modules.length > 20, 'the complete module graph loads');
            assert.ok(modules.every(module => module.path.startsWith(`/static/v/${revision}/`)));
            assert.deepEqual(await page.evaluate(() => Object.keys(window).filter(key => key.startsWith('BPM'))), []);
            return modules;
        };
        const cold = await load('benchmark');
        const warm = await load('benchmark');
        assert.deepEqual(warm.map(module => module.path).sort(), cold.map(module => module.path).sort());
        assert.ok(warm.every(module => module.transferred === 0), 'warm reload reuses cached module responses');
        fixture.setRevision('next-revision');
        const revised = await load('next-revision');
        assert.equal(revised.length, cold.length);
        assert.ok(revised.every(module => module.transferred > 0), 'every dependency loads under the new revision');
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
        fixture.server.closeAllConnections();
        await new Promise(resolve => fixture.server.close(resolve));
    }
}
