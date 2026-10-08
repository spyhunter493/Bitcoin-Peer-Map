import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

type Address = { family: 4 | 6; value: bigint; canonical: string; mapped: boolean };
export type TrustedProxy = Readonly<{ family: 4 | 6; network: bigint; prefix: number }>;
const MAX_FORWARDED_BYTES = 4096;
const MAX_FORWARDED_ADDRESSES = 32;

function ipv4Value(address: string) {
    return address.split('.').reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}
function ipv4String(value: bigint) {
    return [24n, 16n, 8n, 0n].map(shift => String((value >> shift) & 255n)).join('.');
}
function ipv6String(groups: number[]) {
    let start = -1, length = 0;
    for (let i = 0; i < groups.length;) {
        if (groups[i] !== 0) { i++; continue; }
        const first = i;
        while (i < groups.length && groups[i] === 0) i++;
        if (i - first > length && i - first >= 2) { start = first; length = i - first; }
    }
    const strings = groups.map(value => value.toString(16));
    return start < 0 ? strings.join(':') : `${strings.slice(0, start).join(':')}::${strings.slice(start + length).join(':')}`;
}
function parseAddress(address: string): Address | null {
    // net.isIP accepts IPv6 zone identifiers; neither trust entries nor XFF do.
    if (!/^[0-9a-fA-F:.]+$/.test(address)) return null;
    const family = isIP(address);
    if (family === 4) return { family, value: ipv4Value(address), canonical: address, mapped: false };
    if (family !== 6) return null;
    let expanded = address;
    if (address.includes('.')) {
        const index = address.lastIndexOf(':'), value = ipv4Value(address.slice(index + 1));
        expanded = `${address.slice(0, index + 1)}${(value >> 16n).toString(16)}:${(value & 65535n).toString(16)}`;
    }
    const [left, right] = expanded.split('::');
    const before = left ? left.split(':') : [], after = right ? right.split(':') : [];
    const groups = (right === undefined ? before : [...before, ...Array(8 - before.length - after.length).fill('0'), ...after]).map(value => Number.parseInt(value, 16));
    const value = groups.reduce((result, group) => (result << 16n) | BigInt(group), 0n);
    if (value >> 32n === 65535n) {
        const mapped = value & 0xffffffffn;
        return { family: 4, value: mapped, canonical: ipv4String(mapped), mapped: true };
    }
    return { family: 6, value, canonical: ipv6String(groups), mapped: false };
}
function mask(family: 4 | 6, prefix: number) {
    const bits = family === 4 ? 32 : 128;
    return ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
}

export function parseTrustedProxies(value = ''): readonly TrustedProxy[] {
    const invalid = () => new Error('BPM_TRUSTED_PROXIES must be a comma-separated list of literal IP addresses or nonzero CIDRs, without blank entries or trust-all ranges');
    if (/[\r\n]/.test(value)) throw invalid();
    if (!value.trim()) return Object.freeze([]);
    const entries = value.split(',').map(entry => {
        const parts = entry.trim().split('/');
        if (parts.length > 2) throw invalid();
        const address = parseAddress(parts[0]);
        if (!address) throw invalid();
        let prefix = address.family === 4 ? 32 : 128;
        if (parts.length === 2) {
            if (!/^(0|[1-9][0-9]*)$/.test(parts[1])) throw invalid();
            prefix = Number(parts[1]);
            const bits = address.mapped ? 128 : address.family === 4 ? 32 : 128;
            if (!Number.isSafeInteger(prefix) || prefix <= 0 || prefix > bits) throw invalid();
            // Mapped aliases represent IPv4 ranges only within ::ffff:0:0/96.
            if (address.mapped) { prefix -= 96; if (prefix <= 0) throw invalid(); }
        }
        return Object.freeze({ family: address.family, network: address.value & mask(address.family, prefix), prefix });
    });
    return Object.freeze(entries);
}
function isTrusted(address: Address, proxies: readonly TrustedProxy[]) {
    return proxies.some(proxy => proxy.family === address.family && (address.value & mask(proxy.family, proxy.prefix)) === proxy.network);
}

export function anonymousClientIdentity(req: IncomingMessage, proxies: readonly TrustedProxy[]) {
    const remote = req.socket.remoteAddress || '';
    // Node adds the OS interface scope to link-local socket addresses. Only the
    // actual socket peer may use it; configuration and XFF remain bare literals.
    const scope = remote.indexOf('%');
    const socket = parseAddress(scope >= 0 && isIP(remote) === 6 ? remote.slice(0, scope) : remote);
    if (!socket) return 'unknown';
    if (!isTrusted(socket, proxies)) return socket.canonical;

    const fields: string[] = [];
    let bytes = 0;
    // rawHeaders preserves repeated fields in their received order.
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i].toLowerCase() !== 'x-forwarded-for') continue;
        const value = req.rawHeaders[i + 1];
        bytes += Buffer.byteLength(value) + (fields.length ? 1 : 0);
        if (bytes > MAX_FORWARDED_BYTES) return socket.canonical;
        fields.push(value);
    }
    if (!fields.length) return socket.canonical;
    const chain = fields.join(',').split(',');
    if (chain.length > MAX_FORWARDED_ADDRESSES) return socket.canonical;
    const addresses = chain.map(value => parseAddress(value.replace(/^[ \t]+|[ \t]+$/g, '')));
    if (addresses.some(address => !address)) return socket.canonical;
    for (let i = addresses.length - 1; i >= 0; i--) {
        const address = addresses[i]!;
        if (!isTrusted(address, proxies)) return address.canonical;
    }
    return socket.canonical;
}
