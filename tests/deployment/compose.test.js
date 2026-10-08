import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const composeFiles = ['compose.yaml', 'compose.build.yaml'];
const dockerAvailable = spawnSync('docker', ['compose', 'version']).status === 0;

function checkout(t) {
    const dir = mkdtempSync(join(tmpdir(), 'bpm-compose-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'scripts'));
    for (const file of composeFiles) writeFileSync(join(dir, file), readFileSync(join(repository, file)));
    writeFileSync(join(dir, 'scripts/compose-local.sh'), readFileSync(join(repository, 'scripts/compose-local.sh')), { mode: 0o755 });
    writeFileSync(join(dir, '.env'), 'BITCOIN_RPC_USER=test\nBITCOIN_RPC_PASSWORD=test\n');
    return dir;
}

function environment(overrides = {}) {
    const env = { ...process.env };
    // Keep test deployments independent of the operator's shell configuration.
    for (const file of composeFiles) {
        for (const match of readFileSync(join(repository, file), 'utf8').matchAll(/\$\{([A-Z_]+)/g)) delete env[match[1]];
    }
    delete env.COMPOSE_FILE;
    delete env.COMPOSE_PROJECT_NAME;
    return { ...env, ...overrides };
}

function execute(command, args, cwd, env = environment()) {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr || String(result.error || 'Command failed'));
    return result.stdout;
}

function config(dir, overrides = {}, files = ['compose.yaml']) {
    return JSON.parse(execute('docker', [
        'compose', '--project-directory', dir,
        ...files.flatMap(file => ['-f', join(dir, file)]),
        'config', '--format', 'json',
    ], dir, environment(overrides)));
}

test('published deployment keeps its existing data volume and container safeguards', { skip: !dockerAvailable }, t => {
    const deployment = config(checkout(t));
    const service = deployment.services.bpm;
    assert.equal(service.image, 'ghcr.io/spyhunter493/bitcoin-peer-map:latest');
    assert.equal(service.build, undefined);
    assert.equal(service.ports[0].target, 58333);
    assert.equal(service.ports[0].published, '58333');
    assert.equal(service.ports[0].host_ip, '0.0.0.0');
    assert.equal(deployment.volumes['bpm-data'].name, 'bitcoin-peer-map-data');
    assert.equal(service.environment.BPM_DATA_DIR, service.volumes[0].target);
    assert.equal(service.environment.BPM_ADMIN_TOKEN, '');
    assert.equal(service.environment.BPM_ADMIN_TOKEN_FILE, '');
    assert.equal(service.environment.BPM_VIEW_MODE, '');
    assert.equal(service.environment.BPM_VIEW_TOKEN, '');
    assert.equal(service.environment.BPM_VIEW_TOKEN_FILE, '');
    assert.equal(service.environment.BPM_OUTBOUND_ENABLED, '');
    assert.equal(service.environment.BPM_TRUSTED_PROXIES, '');
    assert.equal(service.environment.BPM_LOG_LEVEL, 'info');
    assert.equal(service.read_only, true);
    assert.equal(service.init, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.ok(service.tmpfs[0].includes('noexec,nosuid'));
    assert.equal(service.logging.options['max-size'], '10m');
});

test('image pinning, IPv6 host binding, custom ports, and isolated volumes merge correctly', { skip: !dockerAvailable }, t => {
    const deployment = config(checkout(t), {
        BPM_IMAGE: 'ghcr.io/spyhunter493/bitcoin-peer-map:sha-abcdef0',
        BPM_HOST_BIND: '::1', BPM_HOST_PORT: '58444', BPM_LISTEN_PORT: '58555',
        BPM_DATA_VOLUME: 'bpm-second-instance-data',
        BPM_ADMIN_TOKEN: 'test-admin-token-'.padEnd(64, 'x'),
        BPM_VIEW_MODE: 'redacted',
        BPM_VIEW_TOKEN_FILE: '/run/secrets/view-token',
        BPM_OUTBOUND_ENABLED: 'false',
        BPM_TRUSTED_PROXIES: '127.0.0.1,2001:db8::/64',
        BPM_LOG_LEVEL: 'debug',
    });
    const service = deployment.services.bpm;
    assert.equal(service.image, 'ghcr.io/spyhunter493/bitcoin-peer-map:sha-abcdef0');
    assert.equal(service.ports.length, 1);
    assert.equal(service.ports[0].host_ip, '::1');
    assert.equal(service.ports[0].published, '58444');
    assert.equal(service.ports[0].target, 58555);
    assert.equal(service.environment.BPM_LISTEN_PORT, '58555');
    assert.equal(service.environment.BPM_LISTEN_ADDRESS, '0.0.0.0');
    assert.equal(service.environment.BPM_ADMIN_TOKEN, 'test-admin-token-'.padEnd(64, 'x'));
    assert.equal(service.environment.BPM_VIEW_MODE, 'redacted');
    assert.equal(service.environment.BPM_VIEW_TOKEN, '');
    assert.equal(service.environment.BPM_VIEW_TOKEN_FILE, '/run/secrets/view-token');
    assert.equal(service.environment.BPM_OUTBOUND_ENABLED, 'false');
    assert.equal(service.environment.BPM_TRUSTED_PROXIES, '127.0.0.1,2001:db8::/64');
    assert.equal(service.environment.BPM_LOG_LEVEL, 'debug');
    assert.equal(deployment.volumes['bpm-data'].name, 'bpm-second-instance-data');
});

test('password files, shared networks, and local builds preserve override precedence', { skip: !dockerAvailable }, t => {
    const dir = checkout(t);
    writeFileSync(join(dir, 'password'), 'test-secret');
    writeFileSync(join(dir, 'compose.override.yaml'), `services:
  bpm:
    environment:
      BITCOIN_RPC_HOST: knots
      BITCOIN_RPC_PASSWORD: ""
      BITCOIN_RPC_PASSWORD_FILE: /run/secrets/bitcoin_rpc_password
    secrets:
      - bitcoin_rpc_password
networks:
  default:
    external: true
    name: bitcoin-rpc
secrets:
  bitcoin_rpc_password:
    file: ./password
`);
    const deployment = config(dir, { BPM_BUILD_REVISION: 'abcdef012345', BPM_BUILD_VERSION: 'v1.3.0' }, [...composeFiles, 'compose.override.yaml']);
    const service = deployment.services.bpm;
    assert.equal(service.image, 'bitcoin-peer-map:local');
    assert.equal(service.pull_policy, 'build');
    assert.equal(service.build.context, dir);
    assert.equal(service.build.args.BPM_BUILD_REVISION, 'abcdef012345');
    assert.equal(service.build.args.BPM_BUILD_VERSION, 'v1.3.0');
    assert.equal(service.environment.BITCOIN_RPC_HOST, 'knots');
    assert.equal(service.environment.BITCOIN_RPC_PASSWORD, '');
    assert.equal(service.environment.BITCOIN_RPC_PASSWORD_FILE, '/run/secrets/bitcoin_rpc_password');
    assert.equal(deployment.networks.default.name, 'bitcoin-rpc');
    assert.equal(deployment.secrets.bitcoin_rpc_password.file, join(dir, 'password'));
});

test('local helper finds its checkout from another directory and detects untracked source', t => {
    const dir = checkout(t);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'docker'), `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), revision: process.env.BPM_BUILD_REVISION }));
`, { mode: 0o755 });
    writeFileSync(join(dir, '.gitignore'), 'bin/\n.env\ncompose.override.*\n');
    execute('git', ['init', '--quiet'], dir);
    execute('git', ['add', '.'], dir);
    execute('git', ['-c', 'user.name=Compose Test', '-c', 'user.email=compose@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture'], dir);
    const revision = execute('git', ['rev-parse', 'HEAD'], dir).trim();
    const env = environment({ PATH: `${bin}:${process.env.PATH}` });
    const run = () => JSON.parse(execute(join(dir, 'scripts/compose-local.sh'), ['config', '--quiet'], tmpdir(), env));
    assert.equal(run().cwd, dir);
    assert.equal(run().revision, revision);
    writeFileSync(join(dir, 'new-module.js'), 'export const value = 1;\n');
    assert.equal(run().revision, 'unknown', 'untracked modules cannot advertise the clean commit');
    env.BPM_BUILD_REVISION = '1234567';
    assert.equal(run().revision, '1234567', 'explicit build revisions retain precedence');
    for (const extension of ['yml', 'yaml']) {
        writeFileSync(join(dir, `compose.override.${extension}`), 'services: {}\n');
        assert.deepEqual(run().args, ['compose', '-f', 'compose.yaml', '-f', 'compose.build.yaml', '-f', `compose.override.${extension}`, 'config', '--quiet']);
    }
});
