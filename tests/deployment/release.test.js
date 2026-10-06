import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRegistryReader, IMAGE_REPOSITORY, publishReleaseImage, RELEASE_PLATFORMS } from '../../scripts/release-image.js';
import { REPOSITORY_URL } from '../../src/server/build.ts';

const revision = 'abcdef0123456789abcdef0123456789abcdef01';
const digest = `sha256:${'a'.repeat(64)}`;
const release = { image: 'bitcoin-peer-map:release-test', digest, version: 'v1.10.0', revision };
const published = { digest, version: release.version, revision };
const config = (version = release.version, sha = revision) => ({
    Labels: { 'org.opencontainers.image.source': REPOSITORY_URL, 'org.opencontainers.image.version': version, 'org.opencontainers.image.revision': sha },
    Env: [`BPM_BUILD_VERSION=${version}`, `BPM_BUILD_REVISION=${sha}`],
});

function publication({ current = 'v1.9.0', failSmoke, failLatest, wrongDigest, existing } = {}) {
    const commands = [], reads = [];
    const images = new Map(existing || []);
    if (current) images.set('latest', { ...published, digest: `sha256:${'b'.repeat(64)}`, version: current });
    const execute = async (command, args, options = {}) => {
        commands.push({ command, args, options });
        if (args[0] === 'image' && args[1] === 'inspect') return JSON.stringify(args.includes('--platform') ? config() : { digest, mediaType: 'application/vnd.oci.image.index.v1+json' });
        if (command === process.execPath && options.env.BPM_TEST_PLATFORM === failSmoke) throw new Error('Smoke failed');
        if (args[0] === 'image' && args[1] === 'push') images.set(release.version, { ...published, ...(wrongDigest ? { digest: `sha256:${'c'.repeat(64)}` } : {}) });
        if (args[0] === 'buildx' && args[2] === 'create') images.set(args[4].slice(IMAGE_REPOSITORY.length + 1), published);
        return 'Smoke passed';
    };
    const readImage = async reference => {
        reads.push(reference);
        if (reference === 'latest' && failLatest) throw failLatest;
        return images.get(reference) || null;
    };
    return { commands, reads, images, execute, readImage };
}

const pushes = context => context.commands.filter(({ args }) => args[0] === 'image' && args[1] === 'push');
const promotions = context => context.commands.filter(({ args }) => args[0] === 'buildx' && args.includes(`${IMAGE_REPOSITORY}:latest`));

test('both architectures are smoke-tested with baked metadata before a single upload and digest promotion', async () => {
    const context = publication();
    const result = await publishReleaseImage(release, context);
    const smoke = context.commands.filter(({ command }) => command === process.execPath);
    assert.deepEqual(smoke.map(({ options }) => options.env.BPM_TEST_PLATFORM), RELEASE_PLATFORMS);
    for (const { options } of smoke) {
        assert.equal(options.env.BPM_TEST_IMAGE, release.image);
        assert.equal(options.env.BPM_TEST_EXPECT_VERSION, release.version);
        assert.equal(options.env.BPM_TEST_EXPECT_REVISION, revision);
    }
    assert.ok(context.commands.indexOf(smoke[1]) < context.commands.indexOf(pushes(context)[0]));
    assert.equal(pushes(context).length, 1);
    assert.equal(context.commands.some(({ args }) => args.includes('build')), false, 'Publication must never rebuild the tested image');
    assert.equal(pushes(context)[0].args.includes('--platform'), false, 'Upload must preserve the multi-platform index');
    assert.equal(promotions(context)[0].args.at(-1), `${IMAGE_REPOSITORY}@${digest}`);
    assert.deepEqual(context.reads.slice(-2), ['latest', 'latest']);
    assert.equal(result.latest, 'promoted');
    assert.equal(context.images.get('latest').digest, digest);
    assert.equal(context.images.get(`sha-${revision}`).digest, digest);
});

for (const version of ['v1.10.0', 'v1.11.0', 'v2.0.0', 'v1.9007199254740993.0']) {
    test(`publishing ${release.version} cannot move latest backward or sideways from ${version}`, async () => {
        const context = publication({ current: version });
        const before = context.images.get('latest');
        const result = await publishReleaseImage(release, context);
        assert.equal(result.latest, 'skipped');
        assert.equal(pushes(context).length, 1, 'Older releases retain a versioned image');
        assert.equal(promotions(context).length, 0);
        assert.equal(context.images.get('latest'), before);
    });
}

test('a confirmed absent latest allows the first promotion', async () => {
    const context = publication({ current: null });
    const result = await publishReleaseImage(release, context);
    assert.equal(result.latest, 'promoted');
    assert.equal(promotions(context).length, 1);
});

test('failed ARM64 smoke prevents every registry mutation', async () => {
    const context = publication({ failSmoke: 'linux/arm64' });
    await assert.rejects(publishReleaseImage(release, context), /Smoke failed/);
    assert.deepEqual(context.reads, []);
    assert.equal(pushes(context).length, 0);
    assert.equal(context.commands.some(({ args }) => args.includes('tag') || args.includes('create')), false);
});

test('incorrect local build metadata prevents smoke and upload', async () => {
    const context = publication();
    context.execute = async (_command, args) => JSON.stringify(args.includes('--platform') ? config('v1.9.0') : { digest, mediaType: 'application/vnd.oci.image.index.v1+json' });
    await assert.rejects(publishReleaseImage(release, context), /Image version must match/);
    assert.equal(context.reads.length, 0);
});

test('a local image index changed during smoke cannot be published', async () => {
    const context = publication();
    const execute = context.execute;
    let checks = 0;
    context.execute = async (command, args, options) => {
        if (args.includes('{{json .Descriptor}}') && ++checks === 2) return JSON.stringify({ digest: `sha256:${'c'.repeat(64)}`, mediaType: 'application/vnd.oci.image.index.v1+json' });
        return execute(command, args, options);
    };
    await assert.rejects(publishReleaseImage(release, context), /original build digest/);
    assert.equal(pushes(context).length, 0);
    assert.equal(context.reads.length, 0);
});

test('a published digest mismatch prevents SHA and latest promotion', async () => {
    const context = publication({ wrongDigest: true });
    await assert.rejects(publishReleaseImage(release, context), /exact tested release index/);
    assert.equal(context.commands.some(({ args }) => args.includes('create')), false);
});

test('existing version or SHA tags cannot be replaced by a different digest', async () => {
    for (const reference of [release.version, `sha-${revision}`]) {
        const context = publication({ existing: [[reference, { ...published, digest: `sha256:${'b'.repeat(64)}` }]] });
        await assert.rejects(publishReleaseImage(release, context), /Refusing to replace published/);
        assert.equal(pushes(context).length, 0);
        assert.equal(context.commands.some(({ args }) => args.includes('tag') || args.includes('create')), false);
    }
});

test('registry failures leave latest unchanged even after the version image is published', async () => {
    for (const error of [new Error('HTTP 401'), new Error('HTTP 403'), new Error('HTTP 500'), new Error('Invalid metadata'), new TypeError('Network unavailable')]) {
        const context = publication({ failLatest: error });
        const before = context.images.get('latest');
        await assert.rejects(publishReleaseImage(release, context), value => value === error);
        assert.equal(promotions(context).length, 0);
        assert.equal(context.images.get('latest'), before);
    }
});

function registry({ version = release.version, architectureMismatch = false, missingArm = false, metadataMismatch = false, corruptBlob = false } = {}) {
    const bodies = new Map();
    const store = (path, value) => {
        const body = JSON.stringify(value), hash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
        bodies.set(`${path}/${hash}`, body);
        return hash;
    };
    const manifests = [];
    for (const architecture of missingArm ? ['amd64'] : ['amd64', 'arm64']) {
        const image = { os: 'linux', architecture: architectureMismatch ? 'mips' : architecture, config: config(metadataMismatch && architecture === 'arm64' ? 'v1.9.0' : version) };
        const configDigest = store('blobs', image);
        if (corruptBlob) bodies.set(`blobs/${configDigest}`, JSON.stringify({ ...image, architecture: 'corrupt' }));
        const manifestDigest = store('manifests', { schemaVersion: 2, config: { digest: configDigest } });
        manifests.push({ digest: manifestDigest, platform: { os: 'linux', architecture } });
    }
    manifests.push({ digest: `sha256:${'e'.repeat(64)}`, platform: { os: 'unknown', architecture: 'unknown' }, annotations: { 'vnd.docker.reference.type': 'attestation-manifest' } });
    const indexDigest = store('manifests', { schemaVersion: 2, manifests });
    bodies.set('manifests/latest', bodies.get(`manifests/${indexDigest}`));
    const fetcher = async url => {
        if (url.startsWith('https://ghcr.io/token?')) return Response.json({ token: 'test-token' });
        const path = url.split('/bitcoin-peer-map/')[1];
        assert.ok(bodies.has(path), `Unexpected registry request: ${url}`);
        return new Response(bodies.get(path));
    };
    return { fetcher, digest: indexDigest };
}

test('registry reads verify both architecture manifests, configs, labels, and index digest', async () => {
    const fixture = registry();
    const read = createRegistryReader({ fetcher: fixture.fetcher });
    assert.deepEqual(await read('latest'), { digest: fixture.digest, version: release.version, revision });
    assert.deepEqual(await read(fixture.digest), { digest: fixture.digest, version: release.version, revision });
});

for (const [name, options, message] of [
    ['missing ARM64', { missingArm: true }, /AMD64 and ARM64/],
    ['wrong architecture', { architectureMismatch: true }, /architecture must match/],
    ['different platform metadata', { metadataMismatch: true }, /version must match/],
    ['invalid stable version', { version: 'dev' }, /invalid release metadata/],
    ['corrupt config blob', { corruptBlob: true }, /content must match its digest/],
]) {
    test(`registry rejects ${name}`, async () => {
        const fixture = registry(options);
        await assert.rejects(createRegistryReader({ fetcher: fixture.fetcher })('latest'), message);
    });
}

test('only an explicit MANIFEST_UNKNOWN response counts as an absent tag', async () => {
    for (const [status, body, missing] of [
        [404, { errors: [{ code: 'MANIFEST_UNKNOWN' }] }, true],
        [404, { errors: [{ code: 'DENIED' }] }, false],
        [404, { errors: [] }, false],
        [401, { errors: [{ code: 'UNAUTHORIZED' }] }, false],
        [403, { errors: [{ code: 'DENIED' }] }, false],
        [500, { errors: [{ code: 'UNKNOWN' }] }, false],
    ]) {
        const fetcher = async url => url.includes('/token?') ? Response.json({ token: 'test' }) : Response.json(body, { status });
        const read = createRegistryReader({ fetcher });
        if (missing) assert.equal(await read('latest', { allowMissing: true }), null);
        else await assert.rejects(read('latest', { allowMissing: true }), /GHCR/);
        await assert.rejects(read('latest'), /GHCR/, 'A required published image can never be treated as optional');
    }
});

test('malformed registry responses and authentication failures never bootstrap latest', async () => {
    for (const fetcher of [
        async () => new Response('', { status: 403 }),
        async url => url.includes('/token?') ? Response.json({}) : Response.json({}),
        async url => url.includes('/token?') ? Response.json({ token: 'test' }) : new Response('{malformed', { status: 404 }),
        async () => { throw new TypeError('Network failed'); },
    ]) await assert.rejects(createRegistryReader({ fetcher })('latest', { allowMissing: true }));
});
