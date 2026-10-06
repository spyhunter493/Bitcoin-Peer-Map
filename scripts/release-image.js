import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { GITHUB_REPOSITORY, REPOSITORY_URL, isNewerRelease, parseReleaseVersion } from '../src/server/build.ts';

export const IMAGE_REPOSITORY = 'ghcr.io/spyhunter493/bitcoin-peer-map';
export const RELEASE_PLATFORMS = ['linux/amd64', 'linux/arm64'];
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const revisionPattern = /^[0-9a-f]{40}$/;
const execute = promisify(execFile);

async function run(command, args, options = {}) {
    const result = await execute(command, args, { timeout: 600000, maxBuffer: 4 * 1024 * 1024, ...options });
    if (result.stderr) process.stderr.write(result.stderr);
    return result.stdout.trim();
}

function buildEnvironment(config) {
    return Object.fromEntries((config.Env || []).map(value => {
        const split = value.indexOf('=');
        return [value.slice(0, split), value.slice(split + 1)];
    }));
}

function verifyLabels(config, version, revision) {
    assert.equal(config.Labels?.['org.opencontainers.image.source'], REPOSITORY_URL, 'Image source must be the BPM repository');
    assert.equal(config.Labels?.['org.opencontainers.image.version'], version, 'Image version must match the release');
    assert.equal(config.Labels?.['org.opencontainers.image.revision'], revision, 'Image revision must match the release commit');
    const environment = buildEnvironment(config);
    assert.equal(environment.BPM_BUILD_VERSION, version, 'Baked build version must match its label');
    assert.equal(environment.BPM_BUILD_REVISION, revision, 'Baked build revision must match its label');
}

// Distinguish a genuinely missing tag from authentication, network, and registry failures.
export function createRegistryReader({ fetcher = fetch, username = process.env.GITHUB_ACTOR, password = process.env.GITHUB_TOKEN } = {}) {
    let token;
    async function request(path, accept) {
        token ??= (async () => {
            const response = await fetcher(`https://ghcr.io/token?service=ghcr.io&scope=repository:${GITHUB_REPOSITORY.toLowerCase()}:pull`, {
                headers: password ? { Authorization: `Basic ${Buffer.from(`${username || 'bpm'}:${password}`).toString('base64')}` } : {},
                signal: AbortSignal.timeout(30000),
            });
            if (!response.ok) throw new Error(`GHCR authentication returned HTTP ${response.status}`);
            const value = await response.json();
            if (typeof value.token !== 'string' || !value.token) throw new Error('GHCR returned an invalid registry token');
            return value.token;
        })();
        return fetcher(`https://ghcr.io/v2/${GITHUB_REPOSITORY.toLowerCase()}/${path}`, {
            headers: { Authorization: `Bearer ${await token}`, ...(accept ? { Accept: accept } : {}) },
            signal: AbortSignal.timeout(30000),
        });
    }
    async function json(path, { allowMissing = false, digest } = {}) {
        const response = await request(path, 'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json');
        if (!response.ok) {
            if (allowMissing && response.status === 404) {
                const error = await response.json();
                if (Array.isArray(error.errors) && error.errors.length && error.errors.every(value => value.code === 'MANIFEST_UNKNOWN')) return null;
            }
            throw new Error(`GHCR ${path} returned HTTP ${response.status}`);
        }
        const body = await response.text();
        const actualDigest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
        if (digest) assert.equal(actualDigest, digest, 'Registry content must match its digest');
        return { value: JSON.parse(body), digest: actualDigest };
    }
    return async (reference, options = {}) => {
        if (!/^(latest|v[0-9]+\.[0-9]+\.[0-9]+|sha-[0-9a-f]{40}|sha256:[0-9a-f]{64})$/.test(reference)) throw new Error('Invalid release image reference');
        const index = await json(`manifests/${reference}`, { ...options, ...(digestPattern.test(reference) ? { digest: reference } : {}) });
        if (index === null) return null;
        if (!Array.isArray(index.value.manifests)) throw new Error('Release image must contain a multi-platform index');
        const descriptors = index.value.manifests.filter(value => value.platform?.os !== 'unknown');
        assert.deepEqual(descriptors.map(value => `${value.platform?.os}/${value.platform?.architecture}`).sort(), [...RELEASE_PLATFORMS].sort(), 'Release image must contain AMD64 and ARM64 exactly once');
        let version, revision;
        for (const descriptor of descriptors) {
            assert.match(descriptor.digest, digestPattern, 'Invalid platform manifest digest');
            const manifest = await json(`manifests/${descriptor.digest}`, { digest: descriptor.digest });
            assert.match(manifest.value.config?.digest, digestPattern, 'Invalid image config digest');
            const config = (await json(`blobs/${manifest.value.config.digest}`, { digest: manifest.value.config.digest })).value;
            assert.equal(config.os, descriptor.platform.os, 'Image OS must match its manifest');
            assert.equal(config.architecture, descriptor.platform.architecture, 'Image architecture must match its manifest');
            version ??= config.config?.Labels?.['org.opencontainers.image.version'];
            revision ??= config.config?.Labels?.['org.opencontainers.image.revision'];
            if (!parseReleaseVersion(version) || !revisionPattern.test(revision || '')) throw new Error('Registry image has invalid release metadata');
            verifyLabels(config.config, version, revision);
        }
        return { digest: index.digest, version, revision };
    };
}

export async function publishReleaseImage({ image, digest, version, revision }, { execute = run, readImage = createRegistryReader(), smoke = 'tests/test_container.js' } = {}) {
    if (!image || !digestPattern.test(digest || '') || !parseReleaseVersion(version) || !revisionPattern.test(revision || '')) throw new Error('A local image, index digest, stable release version, and full commit SHA are required');
    const verifyLocalIndex = async () => {
        const descriptor = JSON.parse(await execute('docker', ['image', 'inspect', '--format', '{{json .Descriptor}}', image]));
        assert.equal(descriptor?.digest, digest, 'Local image index must match the original build digest');
        assert.ok(['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'].includes(descriptor.mediaType), 'Local release image must retain its multi-platform index');
    };
    await verifyLocalIndex();
    for (const platform of RELEASE_PLATFORMS) {
        const config = JSON.parse(await execute('docker', ['image', 'inspect', '--platform', platform, '--format', '{{json .Config}}', image]));
        verifyLabels(config, version, revision);
        await execute(process.execPath, [smoke], { env: { ...process.env, BPM_TEST_IMAGE: image, BPM_TEST_PLATFORM: platform, BPM_TEST_EXPECT_VERSION: version, BPM_TEST_EXPECT_REVISION: revision } });
    }
    await verifyLocalIndex();
    const references = [version, `sha-${revision}`];
    for (const reference of references) {
        const existing = await readImage(reference, { allowMissing: true });
        if (existing && existing.digest !== digest) throw new Error(`Refusing to replace published ${reference} with a different image digest`);
    }
    await execute('docker', ['image', 'tag', image, `${IMAGE_REPOSITORY}:${version}`]);
    await execute('docker', ['image', 'push', `${IMAGE_REPOSITORY}:${version}`]);
    const published = await readImage(version);
    assert.deepEqual(published, { digest, version, revision }, 'Published image must match the exact tested release index');
    await execute('docker', ['buildx', 'imagetools', 'create', '--tag', `${IMAGE_REPOSITORY}:sha-${revision}`, `${IMAGE_REPOSITORY}@${digest}`]);
    assert.deepEqual(await readImage(`sha-${revision}`), published, 'Version and SHA tags must identify the same tested index');

    // This read happens immediately before promotion, inside the workflow's serialized job.
    const latest = await readImage('latest', { allowMissing: true });
    if (latest && !isNewerRelease(latest.version, version)) {
        return { ...published, platforms: [...RELEASE_PLATFORMS], latest: 'skipped', reason: `${version} is not newer than ${latest.version}` };
    }
    await execute('docker', ['buildx', 'imagetools', 'create', '--tag', `${IMAGE_REPOSITORY}:latest`, `${IMAGE_REPOSITORY}@${digest}`]);
    assert.deepEqual(await readImage('latest'), published, 'Latest must identify the exact tested index');
    return { ...published, platforms: [...RELEASE_PLATFORMS], latest: 'promoted', reason: latest ? `${version} is newer than ${latest.version}` : 'No latest manifest exists' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const result = await publishReleaseImage({ image: process.env.BPM_RELEASE_IMAGE, digest: process.env.BPM_RELEASE_DIGEST, version: process.env.BPM_RELEASE_VERSION, revision: process.env.BPM_RELEASE_REVISION });
        const summary = `Tested ${result.version} (${result.revision}) on ${result.platforms.join(', ')}.\nImage index: ${result.digest}\nLatest ${result.latest}: ${result.reason}\n`;
        console.log(summary);
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
