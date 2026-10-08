import { BlockList, isIP } from 'node:net';

export const BITCOIN_NETWORKS = Object.freeze({
    main: Object.freeze({ default_peer_port: 8333 }),
    test: Object.freeze({ default_peer_port: 18333 }),
    testnet4: Object.freeze({ default_peer_port: 48333 }),
    signet: Object.freeze({ default_peer_port: 38333 }),
    regtest: Object.freeze({ default_peer_port: 18444 }),
});
export type BitcoinChain = keyof typeof BITCOIN_NETWORKS;
export type { BitcoinNetwork } from '../shared/api.generated.d.ts';
export function isBitcoinChain(value: string): value is BitcoinChain { return Object.hasOwn(BITCOIN_NETWORKS, value); }

const nonGlobal = new BlockList();
const exceptions = new BlockList();
for (const cidr of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4']) {
    const [host, prefix] = cidr.split('/'); nonGlobal.addSubnet(host, Number(prefix), 'ipv4');
}
for (const cidr of ['::/128', '::1/128', '64:ff9b:1::/48', '100::/64', '2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20', 'fc00::/7', 'fe80::/10', 'ff00::/8']) {
    const [host, prefix] = cidr.split('/'); nonGlobal.addSubnet(host, Number(prefix), 'ipv6');
}
for (const cidr of ['192.0.0.9/32', '192.0.0.10/32', '2001:1::1/128', '2001:1::2/128', '2001:3::/32', '2001:4:112::/48', '2001:20::/28', '2001:30::/28']) {
    const [host, prefix] = cidr.split('/'); exceptions.addSubnet(host, Number(prefix), host.includes(':') ? 'ipv6' : 'ipv4');
}
export function splitPeerAddress(address: string): [string, string] {
    if (address.startsWith('[')) {
        const end = address.indexOf(']');
        if (end < 0) return [address, ''];
        return [address.slice(1, end), address[end + 1] === ':' ? address.slice(end + 2) : ''];
    }
    const parts = address.split(':');
    return parts.length === 2 ? parts as [string, string] : [address, ''];
}
/** Exact endpoint identity: callers must supply a port, with no inferred defaults. */
export function peerEndpointKey(address: string, port?: number): string | null {
    if (typeof address !== 'string' || (port !== undefined && typeof port !== 'number')) return null;
    let host = address, suppliedPort: string | number | undefined = port;
    if (port === undefined) {
        const bracketed = /^\[([^\[\]]+)\]:([0-9]+)$/.exec(address);
        if (bracketed) {
            host = bracketed[1]; suppliedPort = bracketed[2];
            if (isIP(host) !== 6) return null;
        } else {
            const plain = /^([^:\[\]\s]+):([0-9]+)$/.exec(address);
            if (!plain) return null;
            host = plain[1]; suppliedPort = plain[2];
        }
    }
    const numericPort = Number(suppliedPort);
    if (!Number.isSafeInteger(numericPort) || numericPort < 0 || numericPort > 65535 || host.includes('%')) return null;
    const family = isIP(host);
    let normalized: string;
    if (family === 6) {
        // URL canonicalizes a validated IPv6 literal without resolving any host.
        normalized = new URL(`http://[${host}]/`).hostname;
        const mapped = /^\[::ffff:([0-9a-f]+):([0-9a-f]+)\]$/.exec(normalized);
        if (mapped) {
            const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
            normalized = [high >> 8, high & 255, low >> 8, low & 255].join('.');
        }
    } else if (family === 4) normalized = host;
    else {
        // Hostnames, including onion/I2P names, are compared literally in lowercase.
        if (/^[0-9.]+$/.test(host) || host.length > 253 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(host) || host.split('.').some(label => label.length > 63)) return null;
        normalized = host.toLowerCase();
    }
    return `${normalized}:${numericPort}`;
}
export function networkType(address: string) {
    const value = address.toLowerCase();
    if (value.includes('.onion')) return 'onion';
    if (value.includes('.i2p')) return 'i2p';
    const [host] = splitPeerAddress(address);
    if (/^f[cd]/i.test(host)) return 'cjdns';
    return host.includes(':') ? 'ipv6' : 'ipv4';
}
export function isPrivateAddress(host: string) {
    if (host === 'localhost' || !host) return true;
    const version = isIP(host);
    if (!version) return false;
    const family = version === 6 ? 'ipv6' : 'ipv4';
    return nonGlobal.check(host, family) && !exceptions.check(host, family);
}
export function isPublicAddress(network: string, host: string) {
    return ['ipv4', 'ipv6'].includes(network) && isIP(host) !== 0 && !isPrivateAddress(host);
}
export function normalizePeerAddress(address: string, port: number = BITCOIN_NETWORKS.main.default_peer_port) {
    const value = address.trim();
    if (!value) throw new Error('address is required');
    if (value.toLowerCase().includes('.b32.i2p')) {
        if (!value.endsWith(':0')) throw new Error('I2P addresses must end with :0');
        return value;
    }
    if (value.toLowerCase().includes('.onion')) return value.includes(':') ? value : `${value}:${port}`;
    if (value.startsWith('[')) {
        if (!value.includes(']')) throw new Error('IPv6 addresses must use [address] notation');
        return value.includes(']:') ? value : `${value}:${port}`;
    }
    if (value.split(':').length > 2) return `[${value}]:${port}`;
    return value.includes(':') ? value : `${value}:${port}`;
}
export function formatBytes(value: number) {
    if (value < 1024) return `${value}B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)}KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)}MB`;
    return `${(value / 1024 ** 3).toFixed(2)}GB`;
}
export function formatDuration(seconds: number) {
    let remainder = Math.max(0, Math.trunc(seconds));
    const parts: string[] = [];
    for (const [divisor, suffix] of [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']] as const) {
        const amount = Math.floor(remainder / divisor); remainder %= divisor;
        if (amount) parts.push(`${amount}${suffix}`);
        if (parts.length === 2) break;
    }
    return parts.join('') || '0s';
}
export function abbreviateConnectionType(value: string) {
    const names: Record<string, string> = { 'outbound-full-relay': 'OFR', 'block-relay-only': 'BLO', inbound: 'INB', manual: 'MAN', 'addr-fetch': 'FET', feeler: 'FEL' };
    return names[value] || value.slice(0, 3).toUpperCase() || '-';
}
