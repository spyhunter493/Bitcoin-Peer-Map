import { pathToFileURL } from 'node:url';
import { loadSettings, ConfigurationError } from './settings.ts';
import { RpcAuthenticationError } from './rpc.ts';
import { AppRuntime } from './runtime.ts';
import { createApplication } from './app.ts';
import { sleep } from './tasks.ts';
import { errorMessage } from './types.ts';
import { parseBlockchainInfo } from './rpc-types.ts';

export async function waitForRpc(runtime: Pick<AppRuntime, 'settings' | 'rpc' | 'controller'>) {
    const settings = runtime.settings;
    const deadline = performance.now() + settings.rpc_startup_timeout * 1000;
    const remainingSeconds = () => Math.max(0, (deadline - performance.now()) / 1000);
    console.info(`Bitcoin Peer Map: checking Bitcoin RPC at ${settings.rpc_host}:${settings.rpc_port} (${settings.bitcoin_network})`);
    while (!runtime.controller.signal.aborted) {
        if (remainingSeconds() === 0) throw new Error('Bitcoin RPC startup timed out');
        try {
            // Both startup calls share one deadline, including time spent retrying.
            await runtime.rpc.checkConnection(Math.min(settings.rpc_timeout, remainingSeconds()));
            if (remainingSeconds() === 0) throw new Error('Bitcoin RPC startup timed out');
            const blockchain = parseBlockchainInfo(await runtime.rpc.call('getblockchaininfo', [], Math.min(settings.rpc_timeout, remainingSeconds())));
            if (blockchain?.chain !== settings.bitcoin_network) {
                throw new ConfigurationError(`BITCOIN_NETWORK does not match the node: configured ${settings.bitcoin_network}, node reports ${blockchain?.chain}`);
            }
            console.info('Bitcoin Peer Map: Bitcoin RPC is available');
            return;
        } catch (error) {
            if (error instanceof RpcAuthenticationError || error instanceof ConfigurationError || remainingSeconds() === 0) throw error;
            await sleep(Math.min(2000, remainingSeconds() * 1000), runtime.controller.signal);
        }
    }
    throw new Error('Startup cancelled');
}
export async function main() {
    const runtime = new AppRuntime(loadSettings());
    const app = createApplication(runtime.settings, runtime);
    const stop = () => {
        void app.close().catch(error => {
            console.error(errorMessage(error));
            process.exitCode = 1;
        });
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    try {
        await waitForRpc(runtime);
        await app.listen();
    } catch (error) {
        const cancelled = runtime.controller.signal.aborted;
        await app.close();
        if (!cancelled) throw error;
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(`Bitcoin Peer Map: startup failed: ${errorMessage(error)}`);
        process.exitCode = 1;
    });
}
