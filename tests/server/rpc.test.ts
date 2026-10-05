import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { BitcoinRpcClient, RpcAuthenticationError, RpcError, RpcTransportError } from '../../src/server/rpc.ts';
import { settings } from './helpers.ts';
import type { TestContext } from 'node:test';
import type { RequestListener } from 'node:http';
import { configureLogging } from '../../src/server/logging.ts';

async function rpcServer(t: TestContext, handler: RequestListener) {
    const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    return new BitcoinRpcClient(settings({ BITCOIN_RPC_PORT: String(address.port) }));
}
test('RPC sends authenticated JSON with parameters and unique IDs', async t => {
    const ids = new Set();
    const rpc = await rpcServer(t, async (req, res) => {
        assert.equal(req.method, 'POST'); assert.equal(req.headers.authorization, `Basic ${Buffer.from('bpm-test:secret').toString('base64')}`);
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(body.method, 'getblock'); assert.equal(body.jsonrpc, '1.0'); assert.deepEqual(body.params, ['abc', 1]);
        ids.add(body.id); res.end(JSON.stringify({ result: { hash: 'abc' }, error: null, id: body.id }));
    });
    assert.deepEqual(await rpc.call('getblock', ['abc', 1]), { hash: 'abc' });
    await rpc.call('getblock', ['abc', 1]); assert.equal(ids.size, 2);
});
test('RPC debug messages show method, status, and timing without parameters or response contents', async t => {
    const rpc = await rpcServer(t, (_req, res) => res.end('{"result":{"private":"response-only-value"},"error":null}'));
    const lines: string[] = [];
    t.mock.method(console, 'debug', (message: string) => { lines.push(message); });
    configureLogging({ level: 'debug', secrets: [rpc.settings.rpc_password] });
    t.after(() => configureLogging({ level: 'info' }));
    assert.deepEqual(await rpc.call('getblock', ['private-parameter-value']), { private: 'response-only-value' });
    assert.equal(lines.length, 2);
    assert.match(lines[0], /DEBUG \[rpc\] Calling getblock \(timeout 30s\)$/);
    assert.match(lines[1], /DEBUG \[rpc\] getblock returned HTTP 200 in \d+ms$/);
    for (const value of ['private-parameter-value', 'response-only-value', rpc.settings.rpc_password, 'Authorization']) {
        assert.equal(lines.join('\n').includes(value), false);
    }
});
for (const status of [401, 403]) test(`RPC HTTP ${status} is an authentication error`, async t => {
    const rpc = await rpcServer(t, (_req, res) => { res.writeHead(status); res.end('Unauthorized'); });
    await assert.rejects(rpc.call('test'), RpcAuthenticationError);
});
test('Bitcoin error objects on HTTP 500 preserve their useful error messages', async t => {
    const rpc = await rpcServer(t, (_req, res) => { res.writeHead(500); res.end('{"error":{"code":-8,"message":"Invalid parameter"}}'); });
    await assert.rejects(rpc.call('test'), error => error instanceof RpcError && error.message === 'Invalid parameter');
});
for (const body of ['not json', '[]', 'null']) test(`malformed RPC response is a transport error: ${body}`, async t => {
    const rpc = await rpcServer(t, (_req, res) => res.end(body));
    await assert.rejects(rpc.call('test'), RpcTransportError);
});
test('RPC requests have an absolute timeout and can be cancelled during shutdown', async t => {
    const rpc = await rpcServer(t, () => {});
    await assert.rejects(rpc.call('test', [], 0.02), RpcTransportError);
    const controller = new AbortController(), cancellable = new BitcoinRpcClient(rpc.settings, controller.signal);
    const request = cancellable.call('test'); controller.abort();
    await assert.rejects(request, RpcTransportError);
});
