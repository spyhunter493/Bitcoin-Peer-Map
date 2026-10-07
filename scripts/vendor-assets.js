import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const definitions = [
    { name: 'swagger-ui-dist', version: '5.33.1', license: 'Apache-2.0', directory: 'swagger-ui', files: ['LICENSE', 'NOTICE', 'swagger-ui-bundle.js.LICENSE.txt', 'swagger-ui-bundle.js', 'swagger-ui.css'] },
    { name: '@fontsource-variable/cinzel', version: '5.3.0', license: 'OFL-1.1', directory: 'cinzel', files: ['LICENSE', 'index.css', 'files/cinzel-latin-ext-wght-normal.woff2', 'files/cinzel-latin-wght-normal.woff2'] },
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Build the expected files from exact, lockfile-verified development packages. */
export function vendorAssets() {
    const project = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(join(repository, 'package-lock.json'), 'utf8'));
    const assets = new Map();
    const packages = definitions.map(definition => {
        const source = join(repository, 'node_modules', definition.name);
        const installed = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
        const locked = lock.packages[`node_modules/${definition.name}`];
        if (project.devDependencies[definition.name] !== definition.version || installed.version !== definition.version || locked?.version !== definition.version || installed.license !== definition.license || !locked.integrity) {
            throw new Error(`Expected ${definition.name}@${definition.version} (${definition.license}) as an exact development dependency; run npm ci first`);
        }
        const files = definition.files.map(file => {
            const path = `${definition.directory}/${file}`;
            const bytes = readFileSync(join(source, file));
            assets.set(path, bytes);
            return { path, source: file, bytes: bytes.length, sha256: sha256(bytes) };
        });
        return { name: definition.name, version: definition.version, license: definition.license, npm_integrity: locked.integrity, files };
    });
    assets.set('manifest.json', Buffer.from(JSON.stringify({ schema_version: 1, packages }, null, 2) + '\n'));
    return assets;
}

function listFiles(directory, prefix = '') {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = prefix + entry.name;
        if (entry.isDirectory()) return listFiles(join(directory, entry.name), path + '/');
        if (!entry.isFile()) throw new Error(`Unexpected non-file vendor asset: ${path}`);
        return [path];
    }).sort();
}

export function checkAssets(directory = join(repository, 'src/static/vendor')) {
    const assets = vendorAssets();
    const expected = [...assets.keys()].sort();
    const actual = listFiles(directory);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Vendor asset files differ from the pinned package set; run npm run sync:assets');
    for (const [path, bytes] of assets) {
        if (!readFileSync(join(directory, path)).equals(bytes)) throw new Error(`Vendor asset differs from its pinned source: ${path}; run npm run sync:assets`);
    }
    return assets.size;
}

export function syncAssets(directory = join(repository, 'src/static/vendor')) {
    const assets = vendorAssets();
    for (const [path, bytes] of assets) {
        const target = join(directory, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
    }
    // Unexpected old files are reported instead of being removed silently.
    return checkAssets(directory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const arguments_ = process.argv.slice(2);
    if (arguments_.length && (arguments_.length !== 1 || arguments_[0] !== '--check')) throw new Error('Usage: node scripts/vendor-assets.js [--check]');
    const checking = arguments_[0] === '--check';
    const count = checking ? checkAssets() : syncAssets();
    console.log(`${checking ? 'Verified' : 'Synchronized'} ${count} pinned vendor assets, including their licenses and manifest`);
}
