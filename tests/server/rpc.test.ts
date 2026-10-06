import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { BitcoinRpcClient, RpcAuthenticationError, RpcBusyError, RpcError, RpcTransportError, RPC_CONCURRENCY, RPC_QUEUE_LIMIT } from '../../src/server/rpc.ts';
import { settings, deferred } from './helpers.ts';
import type { TestContext } from 'node:test';
import type { RequestListener, ServerResponse } from 'node:http';
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

test('RPC limits active work, queues FIFO, and rejects overflow before dispatch', async t => {
    const responses: ServerResponse[] = [], received: number[] = [], full = deferred<void>(), next = deferred<void>();
    let drain = false;
    const rpc = await rpcServer(t, async (req, res) => {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        received.push(JSON.parse(Buffer.concat(chunks).toString()).params[0]); responses.push(res);
        if (received.length === RPC_CONCURRENCY) full.resolve();
        if (received.length === RPC_CONCURRENCY + 1) next.resolve();
        if (drain) res.end('{"result":null}');
    });
    const calls = Array.from({ length: RPC_CONCURRENCY + RPC_QUEUE_LIMIT }, (_, id) => rpc.call('read', [id]));
    await full.promise;
    await assert.rejects(rpc.call('overflow'), RpcBusyError);
    assert.equal(received.length, RPC_CONCURRENCY);
    responses[0].end('{"result":null}'); await next.promise;
    assert.equal(received.at(-1), RPC_CONCURRENCY);
    drain = true; for (const response of responses) if (!response.writableEnded) response.end('{"result":null}');
    await Promise.all(calls);
    assert.deepEqual(received, Array.from({ length: RPC_CONCURRENCY + RPC_QUEUE_LIMIT }, (_, id) => id));
});

test('queue time consumes the timeout and queued cancellations free capacity without dispatch', async t => {
    const responses: ServerResponse[] = [], received: string[] = [], full = deferred<void>();
    let drain = false;
    const rpc = await rpcServer(t, async (req, res) => {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        received.push(JSON.parse(Buffer.concat(chunks).toString()).method); responses.push(res);
        if (received.length === RPC_CONCURRENCY) full.resolve();
        if (drain) res.end('{"result":null}');
    });
    const active = Array.from({ length: RPC_CONCURRENCY }, () => rpc.call('active')); await full.promise;
    const controller = new AbortController();
    const cancelled = assert.rejects(rpc.call('cancelled', [], 30, controller.signal), RpcTransportError);
    controller.abort(); await cancelled;
    await assert.rejects(rpc.call('expired', [], 0.02), RpcTransportError);
    drain = true; for (const response of responses) response.end('{"result":null}'); await Promise.all(active);
    await rpc.call('recovered');
    assert.equal(received.includes('cancelled'), false); assert.equal(received.includes('expired'), false);
});

test('shutdown rejects both active and queued RPC calls and releases the gate', async t => {
    const full = deferred<void>(); let received = 0;
    const serverRpc = await rpcServer(t, () => { if (++received === RPC_CONCURRENCY) full.resolve(); });
    const controller = new AbortController(), rpc = new BitcoinRpcClient(serverRpc.settings, controller.signal);
    const calls = Array.from({ length: RPC_CONCURRENCY + RPC_QUEUE_LIMIT }, () => rpc.call('read').catch(error => error));
    await full.promise; controller.abort();
    assert.ok((await Promise.all(calls)).every(error => error instanceof RpcTransportError));
    assert.equal(received, RPC_CONCURRENCY);
    await assert.rejects(rpc.call('after shutdown'), RpcTransportError);
});
