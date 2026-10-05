import { pathToFileURL } from 'node:url';
import { loadSettings, ConfigurationError } from './settings.ts';
import { RpcAuthenticationError } from './rpc.ts';
import { AppRuntime } from './runtime.ts';
import { createApplication } from './app.ts';
import { sleep } from './tasks.ts';
import { errorMessage } from './types.ts';
import { parseBlockchainInfo } from './rpc-types.ts';
import { configureLogging, createLogger } from './logging.ts';

const startupLog = createLogger('startup');
const shutdownLog = createLogger('shutdown');

export async function waitForRpc(runtime: Pick<AppRuntime, 'settings' | 'rpc' | 'controller'>) {
    const settings = runtime.settings;
    const deadline = performance.now() + settings.rpc_startup_timeout * 1000;
    const remainingSeconds = () => Math.max(0, (deadline - performance.now()) / 1000);
    startupLog.info(`Checking Bitcoin RPC at ${settings.rpc_host}:${settings.rpc_port} (${settings.bitcoin_network})`);
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
            startupLog.info('Bitcoin RPC is available');
            return;
        } catch (error) {
            if (error instanceof RpcAuthenticationError || error instanceof ConfigurationError || remainingSeconds() === 0) throw error;
            startupLog.debug(`Bitcoin RPC is not ready; retrying: ${errorMessage(error)}`);
            await sleep(Math.min(2000, remainingSeconds() * 1000), runtime.controller.signal);
        }
    }
    throw new Error('Startup cancelled');
}
export async function main() {
    // Configuration failures also receive formatted logs without exposing supplied credentials.
    configureLogging({ level: 'info', secrets: [process.env.BPM_ADMIN_TOKEN, process.env.BITCOIN_RPC_PASSWORD] });
    const settings = loadSettings();
    configureLogging({ level: settings.log_level, secrets: [settings.admin_token, settings.rpc_password, Buffer.from(`${settings.rpc_user}:${settings.rpc_password}`).toString('base64')] });
    const runtime = new AppRuntime(settings);
    const app = createApplication(runtime.settings, runtime);
    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        shutdownLog.info('Stopping Bitcoin Peer Map');
        void app.close().then(() => shutdownLog.info('Bitcoin Peer Map stopped')).catch(error => {
            shutdownLog.error(`Shutdown failed: ${errorMessage(error)}`);
            process.exitCode = 1;
        });
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    try {
        await waitForRpc(runtime);
        const address = await app.listen();
        if (address && typeof address !== 'string') startupLog.info(`Bitcoin Peer Map listening on ${address.address}:${address.port}`);
    } catch (error) {
        const cancelled = runtime.controller.signal.aborted;
        await app.close();
        if (!cancelled) throw error;
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        startupLog.error(`Bitcoin Peer Map: startup failed: ${errorMessage(error)}`);
        process.exitCode = 1;
    });
}
