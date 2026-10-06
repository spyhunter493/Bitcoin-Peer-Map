// Linux Docker smoke test of the production entrypoint and persistent volume.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { timeout: 60000 })).stdout.trim();
const image = process.env.BPM_TEST_IMAGE || 'bitcoin-peer-map:test';
const name = `bpm-runtime-test-${process.pid}`;
const volume = `${name}-data`;
const values = {
    getnetworkinfo: { connections: 1, subversion: '/Satoshi:30/', networks: [], localaddresses: [] },
    getblockchaininfo: { chain: 'main', blocks: 100, bestblockhash: 'block-100' },
    getblockheader: { height: 100, time: 1000 }, getindexinfo: {},
    getnettotals: { totalbytesrecv: 2048, totalbytessent: 4096 }, getmempoolinfo: { size: 5 },
    getpeerinfo: [{ id: 1, addr: '8.8.8.8:8333', network: 'ipv4', subver: '/Satoshi:30/' }],
    getnodeaddresses: [{ address: '8.8.8.8' }],
};
const rpc = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: body.id, error: null, result: values[body.method] ?? null }));
});
rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
const rpcPort = rpc.address().port;
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const adminToken = 'admin';
const get = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, ...(method === 'POST' ? { headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, path); return response.json();
};
async function start() {
    await docker('run', '-d', '--name', name, '--network', 'host', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '-v', `${volume}:/var/lib/bitcoin-peer-map`,
        '-e', 'BITCOIN_RPC_HOST=127.0.0.1', '-e', `BITCOIN_RPC_PORT=${rpcPort}`, '-e', 'BITCOIN_RPC_USER=test', '-e', 'BITCOIN_RPC_PASSWORD=test',
        '-e', `BPM_ADMIN_TOKEN=${adminToken}`,
        '-e', 'BPM_LOG_LEVEL=info',
        '-e', `BPM_LISTEN_PORT=${port}`, '-e', 'BPM_LISTEN_ADDRESS=127.0.0.1', '-e', 'BPM_BUILD_VERSION=dev', '-e', 'BPM_BUILD_REVISION=unknown', image);
    for (let attempt = 0; attempt < 100; attempt++) {
        try { if ((await get('/healthz')).status === 'ok') return; } catch { /* Wait for startup. */ }
        await delay(100);
    }
    throw new Error('Container did not become ready');
}
async function stop() {
    await docker('stop', '--time', '10', name);
    const state = JSON.parse(await docker('inspect', '--format', '{{json .State}}', name));
    assert.equal(state.ExitCode, 0, 'SIGTERM should shut down cleanly');
    const logs = await docker('logs', name);
    assert.match(logs, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO \[startup\] Bitcoin RPC is available/);
    assert.match(logs, /INFO \[startup\] Bitcoin Peer Map listening on/);
    assert.match(logs, /INFO \[shutdown\] Bitcoin Peer Map stopped/);
    assert.equal(logs.includes('DEBUG ['), false, 'default logging excludes routine RPC diagnostics');
    await docker('rm', name);
}
try {
    const productionNodeVersion = await docker('run', '--rm', '--network', 'none', image,
        'node', '-p', 'process.versions.node');
    assert.equal(productionNodeVersion.split('.')[0], process.versions.node.split('.')[0],
        `Production Node.js ${productionNodeVersion} must match test runner Node.js ${process.versions.node}`);
    const imageConfig = JSON.parse(await docker('image', 'inspect', '--format', '{{json .Config}}', image));
    const buildEnvironment = Object.fromEntries(imageConfig.Env.map(value => {
        const split = value.indexOf('='); return [value.slice(0, split), value.slice(split + 1)];
    }));
    assert.equal(imageConfig.Labels['org.opencontainers.image.source'], 'https://github.com/spyhunter493/Bitcoin-Peer-Map');
    assert.equal(imageConfig.Labels['org.opencontainers.image.version'], buildEnvironment.BPM_BUILD_VERSION);
    assert.equal(imageConfig.Labels['org.opencontainers.image.revision'], buildEnvironment.BPM_BUILD_REVISION);
    assert.match(buildEnvironment.BPM_BUILD_VERSION, /^(dev|v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))$/);
    // Prepare the existing on-disk formats with SQLite, without running the server.
    await docker('run', '--rm', '--network', 'none', '-v', `${volume}:/var/lib/bitcoin-peer-map`, image, 'node', '--input-type=module', '-e', `
        import { DatabaseSync } from 'node:sqlite';
        import { writeFileSync } from 'node:fs';
        import { GEO_SCHEMA } from './src/server/services/geoip-schema.ts';
        const db = new DatabaseSync('/var/lib/bitcoin-peer-map/geo.db'); db.exec(GEO_SCHEMA);
        db.prepare('INSERT INTO geo_cache (ip, city, country, countryCode, lat, lon, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?)').run('8.8.8.8', 'Auckland', 'New Zealand', 'NZ', -36.85, 174.76, 100);
        db.close(); writeFileSync('/var/lib/bitcoin-peer-map/settings.json', JSON.stringify({geoip_auto_update:false, geoip_db_only:true}), {mode:0o600});
    `);
    await start();
    const config = await get('/api/config'), build = config.build;
    assert.equal(config.server.log_level, 'info');
    assert.equal(build.version, 'dev');
    assert.equal(build.revision, 'unknown');
    assert.equal(build.updates.update_available, false);
    assert.equal(build.updates.checked_at, null);
    assert.equal(await docker('exec', name, 'id', '-u'), '10001');
    await docker('exec', name, 'sh', '-c', 'test -z "$(command -v python)" && test -z "$(command -v python3)" && test ! -d /app/node_modules');
    assert.equal((await get('/api/connectivity')).geo_db_only_mode, true);
    assert.equal((await fetch(base + '/api/geodb/db-only', { method: 'POST', body: '{"enabled":false}' })).status, 401);
    assert.equal((await get('/api/connectivity')).geo_db_only_mode, true, 'unauthenticated request cannot change saved settings');
    const info = await get('/api/info');
    assert.deepEqual(info.bitcoin_network, { chain: 'main', default_peer_port: 8333 });
    assert.equal(info.blockchain.ibd, null, 'missing IBD never reports a synced node');
    assert.equal(info.blockchain.txindex_status, 'disabled');
    assert.equal(info.blockchain.txindex_height, null);
    assert.equal(info.connected, 1); assert.equal(info.geo_db_stats.entries, 1); assert.equal(info.geo_db_stats.auto_update, false);
    let peers;
    for (let i = 0; i < 20; i++) {
        peers = await get('/api/peers'); if (peers[0]?.location_status === 'ok') break;
        await delay(100);
    }
    assert.equal(peers[0].location, 'Auckland, NZ');
    assert.equal(peers[0].ping_ms, null);
    const retired = await fetch(base + '/api/geodb/toggle-db-only', { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(retired.status, 410);
    assert.match((await retired.json()).detail, /Reload the dashboard/);
    assert.equal((await get('/api/geodb/db-only', 'POST', { enabled: false })).geo_db_only_mode, false);
    assert.equal((await get('/api/geodb/db-only', 'POST', { enabled: true })).geo_db_only_mode, true);
    assert.equal((await get('/api/geodb/db-only', 'POST', { enabled: true })).geo_db_only_mode, true);
    const saved = JSON.parse(await docker('exec', name, 'cat', '/var/lib/bitcoin-peer-map/settings.json'));
    assert.deepEqual(saved, { geoip_auto_update: false, geoip_db_only: true });
    const health = JSON.parse(await docker('inspect', '--format', '{{json .Config.Healthcheck.Test}}', name));
    await docker('exec', name, 'sh', '-c', health[1]);
    await stop(); await start();
    assert.equal((await get('/api/connectivity')).geo_db_only_mode, true);
    assert.equal((await get('/api/info')).geo_db_stats.entries, 1);
    await stop();
    console.log('Production container smoke test passed: no Python, non-root/read-only operation, existing SQLite/preferences, health check, recreation, and clean shutdown');
} catch (error) {
    console.error(await docker('logs', name).catch(() => 'Container unavailable'));
    throw error;
} finally {
    await docker('rm', '-f', name).catch(() => {});
    await docker('volume', 'rm', volume).catch(() => {});
    rpc.closeAllConnections(); await new Promise(resolve => rpc.close(resolve));
}
