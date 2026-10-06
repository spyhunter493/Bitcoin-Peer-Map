import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseReleaseVersion } from './build.ts';
import { LOG_LEVELS, type LogLevel } from './logging.ts';
import { BITCOIN_NETWORKS, isBitcoinChain } from './network.ts';

export class ConfigurationError extends Error {}
type Environment = Record<string, string | undefined>;

function required(env: Environment, name: string) {
    const value = (env[name] || '').trim();
    if (!value) throw new ConfigurationError(`${name} is required`);
    if (/[\r\n]/.test(value)) throw new ConfigurationError(`${name} must be a single line`);
    return value;
}
function integer(env: Environment, name: string, fallback: number, min: number, max: number) {
    const raw = (env[name] ?? String(fallback)).trim();
    if (!/^[+-]?\d+$/.test(raw)) throw new ConfigurationError(`${name} must be an integer`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new ConfigurationError(`${name} must be between ${min} and ${max}`);
    }
    return value;
}
function boolean(env: Environment, name: string, fallback: boolean) {
    const raw = env[name]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (!['true', 'false'].includes(raw)) throw new ConfigurationError(`${name} must be true or false`);
    return raw === 'true';
}
function revision(env: Environment) {
    const value = (env.BPM_BUILD_REVISION || 'unknown').trim().toLowerCase() || 'unknown';
    if (!/^(unknown|[0-9a-f]{7,40})$/.test(value)) {
        throw new ConfigurationError('BPM_BUILD_REVISION must be a 7-40 character Git commit SHA or unknown');
    }
    return value;
}
function version(env: Environment) {
    const value = env.BPM_BUILD_VERSION?.trim() || 'dev';
    if (value !== 'dev' && !parseReleaseVersion(value)) {
        throw new ConfigurationError('BPM_BUILD_VERSION must be dev or a stable vMAJOR.MINOR.PATCH tag without leading zeros (maximum 128 characters)');
    }
    return value;
}
function password(env: Environment) {
    let direct = env.BITCOIN_RPC_PASSWORD || '';
    const file = env.BITCOIN_RPC_PASSWORD_FILE?.trim();
    if (direct && file) throw new ConfigurationError('set only one of BITCOIN_RPC_PASSWORD or BITCOIN_RPC_PASSWORD_FILE');
    if (file) {
        try { direct = readFileSync(file, 'utf8').replace(/[\r\n]+$/, ''); }
        catch { throw new ConfigurationError(`BITCOIN_RPC_PASSWORD_FILE is not readable: ${file}`); }
    }
    if (!direct) throw new ConfigurationError('BITCOIN_RPC_PASSWORD or BITCOIN_RPC_PASSWORD_FILE is required');
    if (/[\r\n]/.test(direct)) throw new ConfigurationError('Bitcoin RPC password must be a single line');
    return direct;
}

function adminToken(env: Environment) {
    const value = env.BPM_ADMIN_TOKEN || '';
    if (!value) return null;
    if (value.length > 256 || !/^[A-Za-z0-9._~+/-]+={0,2}$/.test(value)) {
        throw new ConfigurationError('BPM_ADMIN_TOKEN must contain 1-256 bearer-token characters without whitespace');
    }
    return value;
}

function logLevel(env: Environment): LogLevel {
    const value = env.BPM_LOG_LEVEL?.trim().toLowerCase() || 'info';
    if (!LOG_LEVELS.includes(value as LogLevel)) throw new ConfigurationError('BPM_LOG_LEVEL must be debug, info, warn, or error');
    return value as LogLevel;
}

export function loadSettings(env: Environment = process.env) {
    const scheme = (env.BITCOIN_RPC_SCHEME || 'http').trim().toLowerCase();
    if (!['http', 'https'].includes(scheme)) throw new ConfigurationError('BITCOIN_RPC_SCHEME must be http or https');
    const network = (env.BITCOIN_NETWORK || 'main').trim().toLowerCase();
    if (!isBitcoinChain(network)) throw new ConfigurationError(`BITCOIN_NETWORK must be ${Object.keys(BITCOIN_NETWORKS).join(', ')}`);
    const listenAddress = (env.BPM_LISTEN_ADDRESS ?? '0.0.0.0').trim();
    if (!listenAddress || /[\r\n]/.test(listenAddress)) throw new ConfigurationError('BPM_LISTEN_ADDRESS must be a single-line address');
    const host = required(env, 'BITCOIN_RPC_HOST');
    const port = integer(env, 'BITCOIN_RPC_PORT', 8332, 1, 65535);
    const dataDir = (env.BPM_DATA_DIR || '/var/lib/bitcoin-peer-map').replace(/^~(?=\/|$)/, homedir());
    return Object.freeze({
        rpc_scheme: scheme, rpc_host: host, rpc_port: port,
        rpc_url: `${scheme}://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`,
        rpc_user: required(env, 'BITCOIN_RPC_USER'), rpc_password: password(env),
        rpc_password_file_configured: Boolean(env.BITCOIN_RPC_PASSWORD_FILE?.trim()),
        rpc_verify_tls: boolean(env, 'BITCOIN_RPC_VERIFY_TLS', true),
        rpc_timeout: integer(env, 'BITCOIN_RPC_TIMEOUT', 30, 1, 300),
        rpc_startup_timeout: integer(env, 'BPM_RPC_STARTUP_TIMEOUT', 30, 1, 600),
        bitcoin_network: network, listen_address: listenAddress,
        listen_port: integer(env, 'BPM_LISTEN_PORT', 58333, 1024, 65535),
        data_dir: resolve(dataDir), geoip_enabled: boolean(env, 'BPM_GEOIP_ENABLED', true),
        geoip_auto_update_override: env.BPM_GEOIP_AUTO_UPDATE?.trim() ? boolean(env, 'BPM_GEOIP_AUTO_UPDATE', true) : null,
        build_version: version(env), build_revision: revision(env),
        admin_token: adminToken(env),
        log_level: logLevel(env),
    });
}
export type Settings = ReturnType<typeof loadSettings>;
