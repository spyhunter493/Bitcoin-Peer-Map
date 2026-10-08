// Exercise real Compose file-backed secrets with the production runtime identity.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmod, copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const secretPath = '/run/secrets/rpc-password';

export async function runMountedSecretsSmoke({ image, platform } = {}) {
    assert.ok(image, 'Mounted-secret smoke test requires a production image');
    assert.ok(!platform || ['linux/amd64', 'linux/arm64'].includes(platform), 'Unsupported smoke-test platform');
    const platformArgs = platform ? ['--platform', platform] : [];
    // Explicit files and an empty env file also prevent local .env/override discovery.
    const environment = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !/^(BPM_|BITCOIN_RPC_|COMPOSE_)/.test(key)));
    const password = ` mounted-${randomBytes(18).toString('hex')} `;
    const encodedCredentials = Buffer.from(`mounted-test:${password}`).toString('base64');
    const authorization = `Basic ${encodedCredentials}`;
    const sensitiveValues = [password, password.trim(), authorization, encodedCredentials];
    const redact = value => sensitiveValues.reduce((text, secret) => text.replaceAll(secret, '[secret]'), String(value));
    const assertSecretAbsent = (value, message) => assert.equal(sensitiveValues.some(secret => value.includes(secret)), false, message);
    const docker = async (...args) => {
        try {
            const result = await execute('docker', args, { env: environment, timeout: 60000, maxBuffer: 1024 * 1024 });
            // Docker preserves the application's stdout/stderr streams for `logs`.
            return (result.stdout + (args[0] === 'logs' ? result.stderr : '')).trim();
        } catch (error) {
            // Keep command failures useful without exposing a secret if the app regresses.
            throw new Error(redact(error.message));
        }
    };
    const daemon = JSON.parse(await docker('info', '--format', '{{json .}}'));
    if (process.platform !== 'linux' || daemon.OSType !== 'linux'
        || (daemon.SecurityOptions ?? []).some(option => /(?:rootless|userns)/.test(option))) {
        console.log('Mounted-secret permission smoke skipped: requires rootful Linux Docker without user namespace remapping');
        return;
    }

    const directory = await mkdtemp(join(tmpdir(), 'bpm-mounted-secrets-'));
    const project = `bpm-secret-${randomUUID()}`;
    const volume = `${project}-data`;
    const fixtures = join(directory, 'fixtures');
    const override = join(directory, 'secret-smoke.yaml');
    const composeArgs = ['compose', '--project-name', project, '--project-directory', directory,
        '--env-file', join(directory, 'empty.env'), '-f', join(directory, 'compose.yaml'), '-f', override];
    const compose = (...args) => docker(...composeArgs, ...args);
    const values = {
        getnetworkinfo: { connections: 1, subversion: '/Satoshi:30/', networks: [], localaddresses: [] },
        getblockchaininfo: { chain: 'main', blocks: 100, bestblockhash: 'block-100' },
        getblockheader: { height: 100, time: 1000 }, getindexinfo: {},
        getnettotals: { totalbytesrecv: 2048, totalbytessent: 4096 }, getmempoolinfo: { size: 5 },
        getpeerinfo: [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4', subver: '/Satoshi:30/' }],
        getnodeaddresses: [{ address: '8.8.8.8', port: 8333 }],
    };
    let rpcRequests = 0, unauthorizedRequests = 0;
    const rpc = createServer(async (request, response) => {
        rpcRequests++;
        if (request.headers.authorization !== authorization) {
            unauthorizedRequests++;
            response.writeHead(401).end();
            return;
        }
        try {
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString());
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ id: body.id, error: null, result: values[body.method] ?? null }));
        } catch { response.writeHead(400).end(); }
    });
    let composePrepared = false;
    try {
        await mkdir(fixtures, { mode: 0o755 });
        await copyFile(new URL('../../compose.yaml', import.meta.url), join(directory, 'compose.yaml'));
        await writeFile(join(directory, 'empty.env'), '');
        const operatorUid = process.getuid() === 10001 ? 10002 : process.getuid();
        const cases = [
            { name: 'owner-readable', mode: 0o600, uid: 10001, gid: 10001, readable: true },
            { name: 'group-readable', mode: 0o640, uid: operatorUid, gid: 10001, readable: true },
            { name: 'owner-unreadable', mode: 0o600, uid: 0, gid: 0, readable: false },
        ];
        for (const fixture of cases) {
            const file = join(fixtures, fixture.name);
            await writeFile(file, password + '\n', { mode: fixture.mode });
            await chmod(file, fixture.mode);
        }
        // A CI runner cannot chown arbitrary host UIDs. This fixture-only container
        // receives CHOWN and a single temporary bind; the application stays non-root.
        await docker('run', ...platformArgs, '--rm', '--network', 'none', '--read-only', '--user', '0:0',
            '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--security-opt', 'no-new-privileges',
            '--mount', `type=bind,src=${fixtures},dst=/fixtures`, image, 'node', '--input-type=module', '-e',
            `import { chownSync } from 'node:fs';
             for (const item of ${JSON.stringify(cases)}) chownSync('/fixtures/' + item.name, item.uid, item.gid);`);
        rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
        const rpcPort = rpc.address().port;
        for (const fixture of cases) {
            const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
            const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
            const file = join(fixtures, fixture.name);
            await writeFile(override, `services:
  bpm:
    image: ${JSON.stringify(image)}
${platform ? `    platform: ${JSON.stringify(platform)}\n` : ''}    network_mode: host
    ports: !reset []
    restart: "no"
    environment:
      BITCOIN_RPC_SCHEME: http
      BITCOIN_RPC_HOST: 127.0.0.1
      BITCOIN_RPC_PORT: "${rpcPort}"
      BITCOIN_RPC_USER: mounted-test
      BITCOIN_RPC_PASSWORD: ""
      BITCOIN_RPC_PASSWORD_FILE: ${secretPath}
      BITCOIN_RPC_VERIFY_TLS: "true"
      BITCOIN_RPC_TIMEOUT: "5"
      BITCOIN_NETWORK: main
      BPM_RPC_STARTUP_TIMEOUT: "5"
      BPM_LISTEN_ADDRESS: 127.0.0.1
      BPM_LISTEN_PORT: "${port}"
      BPM_ADMIN_TOKEN: ""
      BPM_VIEW_MODE: public
      BPM_OUTBOUND_ENABLED: "false"
      BPM_LOG_LEVEL: info
      BPM_GEOIP_ENABLED: "false"
      BPM_GEOIP_AUTO_UPDATE: "false"
    secrets:
      - source: rpc-password
        target: rpc-password
volumes:
  bpm-data:
    name: ${volume}
secrets:
  rpc-password:
    file: ${JSON.stringify(file)}
`);
            composePrepared = true;
            const rendered = JSON.parse(await compose('config', '--format', 'json'));
            assertSecretAbsent(JSON.stringify(rendered), 'Compose configuration must not contain the password');
            assert.equal(rendered.volumes['bpm-data'].name, volume, 'Fixture uses its own data volume');
            const requestsBefore = rpcRequests;
            await compose('up', '--detach', '--pull', 'never', '--no-build', '--no-deps', 'bpm');
            const container = await compose('ps', '--all', '--quiet', 'bpm');
            assert.match(container, /^[a-f0-9]{12,64}$/, 'Compose starts exactly one fixture container');
            const inspect = async () => JSON.parse(await docker('inspect', '--format', '{{json .}}', container));
            const details = await inspect();
            assert.equal(details.HostConfig.ReadonlyRootfs, true, 'Production root filesystem stays read-only');
            assert.deepEqual(details.HostConfig.CapDrop, ['ALL'], 'Production capabilities remain dropped');
            assert.ok(details.HostConfig.SecurityOpt.some(option => /^no-new-privileges(?::true)?$/.test(option)));
            assert.equal(details.HostConfig.RestartPolicy.Name, 'no', 'Failed fixture never restarts');
            const mounted = details.Mounts.find(mount => mount.Destination === secretPath);
            assert.ok(mounted, 'Compose mounts the file-backed secret');
            assert.equal(mounted.Type, 'bind'); assert.equal(mounted.Source, file); assert.equal(mounted.RW, false);
            const runtimeEnvironment = Object.fromEntries(details.Config.Env.map(value => {
                const split = value.indexOf('='); return [value.slice(0, split), value.slice(split + 1)];
            }));
            assert.equal(runtimeEnvironment.BITCOIN_RPC_PASSWORD, '', 'Direct password environment variable stays empty');
            assert.equal(runtimeEnvironment.BITCOIN_RPC_PASSWORD_FILE, secretPath);
            const deadline = Date.now() + 30000;
            if (fixture.readable) {
                let ready = false;
                while (Date.now() < deadline) {
                    try {
                        const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) });
                        if (response.ok && (await response.json()).status === 'ok') { ready = true; break; }
                    } catch { /* Await the production entrypoint. */ }
                    if (!(await inspect()).State.Running) break;
                    await delay(100);
                }
                assert.equal(ready, true, `${fixture.name}: mounted password permits startup`);
                const identity = JSON.parse(await docker('exec', container, 'node', '--input-type=module', '-e', `
                    import { readFileSync, statSync } from 'node:fs';
                    const file = statSync('${secretPath}');
                    console.log(JSON.stringify({uid:process.getuid(), gid:process.getgid(), arch:process.arch,
                        mode:file.mode & 0o777, fileUid:file.uid, fileGid:file.gid,
                        status:readFileSync('/proc/self/status', 'utf8')}));`));
                assert.equal(identity.uid, 10001); assert.equal(identity.gid, 10001);
                assert.equal(identity.mode, fixture.mode); assert.equal(identity.fileUid, fixture.uid); assert.equal(identity.fileGid, fixture.gid);
                assert.match(identity.status, /^NoNewPrivs:\s+1$/m);
                assert.match(identity.status, /^CapEff:\s+0+$/m);
                if (platform) assert.equal(identity.arch, platform === 'linux/amd64' ? 'x64' : 'arm64');
                const response = await fetch(`http://127.0.0.1:${port}/api/config`, { signal: AbortSignal.timeout(5000) });
                assert.equal(response.status, 200);
                const configuration = await response.text();
                assertSecretAbsent(configuration, 'Public configuration never exposes the mounted password or RPC authorization');
                const rpcConfiguration = JSON.parse(configuration).bitcoin_rpc;
                assert.equal(rpcConfiguration.password_configured, true); assert.equal(rpcConfiguration.password_file_configured, true);
                assert.ok(rpcRequests > requestsBefore, 'Production startup authenticates with the mock RPC');
                assert.equal(unauthorizedRequests, 0, 'Every RPC request uses authentication derived from the mounted file');
                await compose('stop', '--timeout', '5', 'bpm');
                assert.equal((await inspect()).State.ExitCode, 0, 'Mounted-secret service shuts down cleanly');
            } else {
                let state = (await inspect()).State;
                while (state.Running && Date.now() < deadline) { await delay(100); state = (await inspect()).State; }
                assert.equal(state.Running, false, 'Unreadable owner-only secret stops startup');
                assert.notEqual(state.ExitCode, 0, 'Unreadable secret must fail rather than silently start');
                assert.equal(rpcRequests, requestsBefore, 'Unreadable secret fails before any RPC authentication');
            }
            const logs = await docker('logs', container);
            assertSecretAbsent(logs, 'Container logs never disclose the mounted password or RPC authorization');
            if (!fixture.readable) assert.match(logs, /BITCOIN_RPC_PASSWORD_FILE is not readable: \/run\/secrets\/rpc-password/);
            await compose('down', '--volumes', '--remove-orphans', '--timeout', '5');
        }
        console.log('Mounted-secret smoke passed: both readable permission patterns, default non-root safeguards, file-derived RPC authentication, and unreadable-file startup rejection');
    } catch (error) {
        throw new Error(redact(error.message));
    } finally {
        try {
            if (composePrepared) await compose('down', '--volumes', '--remove-orphans', '--timeout', '5');
        } finally {
            rpc.closeAllConnections();
            if (rpc.listening) await new Promise(resolve => rpc.close(resolve));
            await rm(directory, { recursive: true, force: true });
        }
    }
}
