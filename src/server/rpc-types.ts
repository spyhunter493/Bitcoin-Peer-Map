import { object, type Data } from './types.ts';

export class RpcValidationError extends Error {}
type Parser<T> = (value: unknown, path: string) => T;
type Shape = Record<string, Parser<unknown>>;
type Parsed<S extends Shape> = { [K in keyof S]: ReturnType<S[K]> } & Data;

function invalid(path: string): never { throw new RpcValidationError(`${path} returned an unexpected response`); }
const text: Parser<string> = (value, path) => typeof value === 'string' ? value : invalid(path);
const nonempty: Parser<string> = (value, path) => typeof value === 'string' && value.trim() ? value : invalid(path);
const number: Parser<number> = (value, path) => typeof value === 'number' && Number.isFinite(value) ? value : invalid(path);
const integer: Parser<number> = (value, path) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid(path);
const boolean: Parser<boolean> = (value, path) => typeof value === 'boolean' ? value : invalid(path);
const optional = <T>(parse: Parser<T>): Parser<T | null | undefined> => (value, path) => value == null ? value : parse(value, path);
const array = <T>(parse: Parser<T>): Parser<T[]> => (value, path) => {
    if (!Array.isArray(value)) return invalid(path);
    return value.map((item: unknown, index) => parse(item, `${path}[${index}]`));
};
// Network metadata is independently optional: retain valid fields beside failures.
const nullable = <T>(parse: Parser<T>): Parser<T | null> => (value, path) => {
    if (value == null) return null;
    try { return parse(value, path); } catch (error) { if (error instanceof RpcValidationError) return null; throw error; }
};
function shape<S extends Shape>(fields: S): Parser<Parsed<S>> {
    return (value, path) => {
        if (!object(value)) return invalid(path);
        const result: Data = { ...value };
        for (const [key, parse] of Object.entries(fields)) result[key] = parse(value[key], `${path}.${key}`);
        // Every declared field has passed its parser; unknown extension fields stay unknown.
        return result as Parsed<S>;
    };
}

const peer = shape({
    id: integer, addr: nonempty,
    network: optional(nonempty), subver: optional(text),
    servicesnames: optional(array(nonempty)), permissions: optional(array(nonempty)),
    inbound: optional(boolean), bytessent: optional(integer), bytesrecv: optional(integer),
    pingtime: optional(number), minping: optional(number), conntime: optional(integer),
    version: optional(integer), connection_type: optional(text),
    lastsend: optional(integer), lastrecv: optional(integer), startingheight: optional(number),
    synced_headers: optional(number), synced_blocks: optional(number),
    addr_relay_enabled: optional(boolean), relaytxes: optional(boolean),
    minfeefilter: optional(number), mapped_as: optional(integer),
    transport_protocol_type: optional(text), session_id: optional(text), addrlocal: optional(text),
    bip152_hb_from: optional(boolean), bip152_hb_to: optional(boolean),
    last_transaction: optional(integer), last_block: optional(integer), timeoffset: optional(number),
    addr_processed: optional(integer), addr_rate_limited: optional(integer),
});
export type PeerInfo = ReturnType<typeof peer>;
export const parsePeerInfo = (value: unknown): PeerInfo[] => array(peer)(value, 'getpeerinfo');

const address = shape({ address: nonempty, port: optional(integer), score: optional(number) });
const network = shape({ name: nonempty, reachable: optional(boolean), limited: optional(boolean), proxy: optional(text) });
const networkInfo = shape({
    subversion: nullable(text), connections: nullable(integer),
    localservicesnames: nullable(array(nonempty)),
    networks: nullable(array(network)), localaddresses: nullable(array(address)),
});
export type NetworkInfo = ReturnType<typeof networkInfo>;
export const parseNetworkInfo = (value: unknown): NetworkInfo => networkInfo(value, 'getnetworkinfo');
export const parseNodeAddresses = (value: unknown) => array(shape({ address: nonempty }))(value, 'getnodeaddresses');

const blockchain = shape({
    chain: optional(nonempty), blocks: optional(integer), bestblockhash: optional(nonempty),
    size_on_disk: optional(integer), pruned: optional(boolean), initialblockdownload: optional(boolean),
});
export type BlockchainInfo = ReturnType<typeof blockchain>;
export const parseBlockchainInfo = (value: unknown): BlockchainInfo => blockchain(value, 'getblockchaininfo');
const header = shape({ height: optional(integer), time: optional(integer) });
export type BlockHeader = ReturnType<typeof header>;
export const parseBlockHeader = (value: unknown): BlockHeader => header(value, 'getblockheader');
const block = shape({
    height: optional(integer), time: optional(integer), size: optional(integer), weight: optional(integer),
    nTx: optional(integer), tx: optional(array(nonempty)), version: optional(number),
    difficulty: optional(number), previousblockhash: optional(nonempty),
});
export const parseBlock = (value: unknown) => block(value, 'getblock');
export const parseNetTotals = (value: unknown) => shape({ totalbytesrecv: integer, totalbytessent: integer })(value, 'getnettotals');
export const parseUptime = (value: unknown) => integer(value, 'uptime');
export const parseMempoolInfo = (value: unknown) => shape({ size: optional(integer) })(value, 'getmempoolinfo');
export const parseChainTips = (value: unknown) => array(shape({
    height: optional(integer), hash: optional(nonempty), branchlen: optional(integer), status: optional(nonempty),
}))(value, 'getchaintips');
