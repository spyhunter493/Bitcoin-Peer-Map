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
const get = async (path, method = 'GET') => {
    const response = await fetch(base + path, { method, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, path); return response.json();
};
async function start() {
    await docker('run', '-d', '--name', name, '--network', 'host', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '-v', `${volume}:/var/lib/bitcoin-peer-map`,
        '-e', 'BITCOIN_RPC_HOST=127.0.0.1', '-e', `BITCOIN_RPC_PORT=${rpcPort}`, '-e', 'BITCOIN_RPC_USER=test', '-e', 'BITCOIN_RPC_PASSWORD=test',
        '-e', `BPM_LISTEN_PORT=${port}`, '-e', 'BPM_LISTEN_ADDRESS=127.0.0.1', image);
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
    await docker('rm', name);
}
try {
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
    assert.equal(await docker('exec', name, 'id', '-u'), '10001');
    await docker('exec', name, 'sh', '-c', 'test -z "$(command -v python)" && test -z "$(command -v python3)" && test ! -d /app/node_modules');
    assert.equal((await get('/api/connectivity')).geo_db_only_mode, true);
    const info = await get('/api/info?include_price=false');
    assert.equal(info.connected, 1); assert.equal(info.geo_db_stats.entries, 1); assert.equal(info.geo_db_stats.auto_update, false);
    let peers;
    for (let i = 0; i < 20; i++) {
        peers = await get('/api/peers'); if (peers[0]?.location_status === 'ok') break;
        await delay(100);
    }
    assert.equal(peers[0].location, 'Auckland, NZ');
    assert.equal((await get('/api/geodb/toggle-db-only', 'POST')).geo_db_only_mode, false);
    assert.equal((await get('/api/geodb/toggle-db-only', 'POST')).geo_db_only_mode, true);
    const saved = JSON.parse(await docker('exec', name, 'cat', '/var/lib/bitcoin-peer-map/settings.json'));
    assert.deepEqual(saved, { geoip_auto_update: false, geoip_db_only: true });
    const health = JSON.parse(await docker('inspect', '--format', '{{json .Config.Healthcheck.Test}}', name));
    await docker('exec', name, 'sh', '-c', health[1]);
    await stop(); await start();
    assert.equal((await get('/api/connectivity')).geo_db_only_mode, true);
    assert.equal((await get('/api/info?include_price=false')).geo_db_stats.entries, 1);
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
