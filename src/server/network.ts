import { BlockList, isIP } from 'node:net';

const nonGlobal = new BlockList();
const exceptions = new BlockList();
for (const cidr of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '240.0.0.0/4']) {
    const [host, prefix] = cidr.split('/'); nonGlobal.addSubnet(host, Number(prefix), 'ipv4');
}
for (const cidr of ['::/128', '::1/128', '64:ff9b:1::/48', '100::/64', '2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20', 'fc00::/7', 'fe80::/10']) {
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
    return address.split(':').length === 2 ? address.split(':') as [string, string] : [address, ''];
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
    return ['ipv4', 'ipv6'].includes(network) && !isPrivateAddress(host);
}
export function normalizePeerAddress(address: string, port = 8333) {
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
