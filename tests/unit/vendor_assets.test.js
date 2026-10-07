import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAssets, syncAssets, vendorAssets } from '../../scripts/vendor-assets.js';

test('vendored assets match their pinned sources, licenses, and reproducible manifest', () => {
    assert.equal(checkAssets(), 10);
    const assets = vendorAssets();
    const manifest = JSON.parse(assets.get('manifest.json').toString());
    assert.deepEqual(manifest.packages.map(package_ => [package_.name, package_.version, package_.license]), [
        ['swagger-ui-dist', '5.33.1', 'Apache-2.0'], ['@fontsource-variable/cinzel', '5.3.0', 'OFL-1.1'],
    ]);
    assert.ok(assets.has('swagger-ui/NOTICE'));
    assert.ok(assets.has('swagger-ui/swagger-ui-bundle.js.LICENSE.txt'));
    for (const package_ of manifest.packages) {
        assert.match(package_.npm_integrity, /^sha512-/);
        assert.ok(package_.files.some(file => file.source === 'LICENSE'));
        for (const file of package_.files) assert.match(file.sha256, /^[a-f0-9]{64}$/);
    }
});

test('vendor checks detect modified, missing, and unexpected artifacts', t => {
    const directory = mkdtempSync(join(tmpdir(), 'bpm-vendor-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    syncAssets(directory);
    const css = join(directory, 'cinzel/index.css');
    writeFileSync(css, 'modified');
    assert.throws(() => checkAssets(directory), /differs from its pinned source: cinzel\/index.css/);
    syncAssets(directory);
    rmSync(css);
    assert.throws(() => checkAssets(directory), /files differ/);
    syncAssets(directory);
    writeFileSync(join(directory, 'unexpected.txt'), 'unexpected');
    assert.throws(() => checkAssets(directory), /files differ/);
});
