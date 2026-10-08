import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { anonymousClientIdentity, parseTrustedProxies } from '../../src/server/trusted-proxies.ts';

function request(socket: string, fields: string[] = [], otherHeaders: string[] = []) {
    return { socket: { remoteAddress: socket }, rawHeaders: [...fields.flatMap(value => ['X-Forwarded-For', value]), ...otherHeaders] } as IncomingMessage;
}
function identity(socket: string, fields: string[] = [], proxies = '127.0.0.1', otherHeaders: string[] = []) {
    return anonymousClientIdentity(request(socket, fields, otherHeaders), parseTrustedProxies(proxies));
}

test('empty trust lists ignore forwarding data without reading it', () => {
    for (const value of ['', ' ', '\t']) assert.deepEqual(parseTrustedProxies(value), []);
    const req = { socket: { remoteAddress: '::ffff:192.0.2.10' }, get rawHeaders() { return assert.fail('Untrusted sockets cannot use forwarding headers'); } } as unknown as IncomingMessage;
    assert.equal(anonymousClientIdentity(req, parseTrustedProxies()), '192.0.2.10');
    assert.equal(identity('192.0.2.10', ['198.51.100.1']), '192.0.2.10');
});

test('socket and forwarding IPv6 aliases use one canonical identity', () => {
    const aliases = ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1', '2001:db8:0:0::1'];
    for (const alias of aliases) {
        assert.equal(identity(alias, ['198.51.100.1'], ''), '2001:db8::1');
        assert.equal(identity('127.0.0.1', [alias]), '2001:db8::1');
    }
    for (const alias of ['192.0.2.1', '::ffff:192.0.2.1', '::ffff:c000:201', '0:0:0:0:0:ffff:c000:0201']) {
        assert.equal(identity(alias, [], ''), '192.0.2.1');
        assert.equal(identity('127.0.0.1', [alias]), '192.0.2.1');
        assert.equal(identity(alias, ['198.51.100.1'], '192.0.2.1'), '198.51.100.1');
        assert.equal(identity(alias, ['198.51.100.1'], '::ffff:c000:201'), '198.51.100.1');
    }
    assert.equal(identity('::'), '::');
    assert.equal(identity('0:0:0:0:0:0:0:1'), '::1');
    assert.equal(identity('2001:0:0:1:0:0:1:1'), '2001::1:0:0:1:1', 'Equal zero runs compress the first');
});

test('OS scopes on IPv6 socket peers are normalized without permitting scoped forwarding literals', () => {
    assert.equal(identity('fe80::1%eth0', ['198.51.100.1'], ''), 'fe80::1');
    assert.equal(identity('fe80:0:0:0:0:0:0:1%1', ['198.51.100.1'], 'fe80::1'), '198.51.100.1');
    assert.equal(identity('fe80::1%eth0', ['fe80::2%eth0'], 'fe80::1'), 'fe80::1');
});

test('IPv4 and IPv6 CIDR matching masks host bits and observes range boundaries', () => {
    for (const socket of ['192.0.2.0', '192.0.2.255', '::ffff:192.0.2.255']) {
        assert.equal(identity(socket, ['198.51.100.1'], '192.0.2.123/24'), '198.51.100.1');
        assert.equal(identity(socket, ['198.51.100.1'], '::ffff:192.0.2.123/120'), '198.51.100.1');
    }
    assert.equal(identity('192.0.3.0', ['198.51.100.1'], '192.0.2.123/24'), '192.0.3.0');
    assert.equal(identity('192.0.2.11', ['198.51.100.1'], '192.0.2.10/32'), '192.0.2.11');
    assert.equal(identity('192.0.2.10', ['198.51.100.1'], '192.0.2.10/32'), '198.51.100.1');
    for (const socket of ['2001:db8:abcd::', '2001:db8:abcd:0:ffff:ffff:ffff:ffff']) {
        assert.equal(identity(socket, ['198.51.100.1'], '2001:db8:abcd::123/64'), '198.51.100.1');
    }
    assert.equal(identity('2001:db8:abcd:1::', ['198.51.100.1'], '2001:db8:abcd::123/64'), '2001:db8:abcd:1::');
    assert.equal(identity('2001:db8::2', ['198.51.100.1'], '2001:db8::1/128'), '2001:db8::2');
    assert.equal(identity('2001:db8::1', ['198.51.100.1'], '2001:db8::1/128'), '198.51.100.1');
});

test('trusted traversal combines repeated XFF fields in wire order and ignores injected prefixes', () => {
    const proxies = '127.0.0.1,192.0.2.0/24,2001:db8::/64';
    assert.equal(identity('127.0.0.1', ['198.51.100.222, 203.0.113.8', '192.0.2.12, 2001:db8::1'], proxies), '203.0.113.8');
    assert.equal(identity('127.0.0.1', ['198.51.100.222', '203.0.113.8'], proxies), '203.0.113.8');
    assert.equal(identity('127.0.0.1', ['203.0.113.8,192.0.3.12,192.0.2.12'], proxies), '192.0.3.12');
    const req = { socket: { remoteAddress: '127.0.0.1' }, rawHeaders: ['x-FoRwArDeD-fOr', '203.0.113.8', 'X-Forwarded-For', '192.0.2.12'] } as IncomingMessage;
    assert.equal(anonymousClientIdentity(req, parseTrustedProxies(proxies)), '203.0.113.8');
});

test('missing, malformed and entirely trusted XFF chains fall back to the canonical socket', () => {
    for (const fields of [[], [''], [' '], ['127.0.0.1'], ['127.0.0.1,::ffff:127.0.0.1'], ['192.0.2.1,,127.0.0.1'], ['192.0.2.1,'], [',192.0.2.1'], ['bad,192.0.2.1'], ['192.0.2.1\n'], ['192.0.2.01'], ['[2001:db8::1]'], ['192.0.2.1:80'], ['[2001:db8::1]:80'], ['fe80::1%eth0'], ['unknown'], ['localhost']]) {
        assert.equal(identity('::ffff:127.0.0.1', fields), '127.0.0.1', JSON.stringify(fields));
    }
    for (const socket of ['', 'not-an-ip', '127.0.0.1%eth0', 'fe80::1%eth0%1']) {
        assert.equal(identity(socket, ['198.51.100.1']), 'unknown');
    }
});

test('forwarding limits accept exactly 32 entries and 4 KiB and reject excess', () => {
    const atLimit = ['198.51.100.1', ...Array(31).fill('127.0.0.1')].join(',');
    assert.equal(identity('127.0.0.1', [atLimit]), '198.51.100.1');
    assert.equal(identity('127.0.0.1', [atLimit + ',127.0.0.1']), '127.0.0.1');
    const address = '198.51.100.1', bytesAtLimit = ' '.repeat(4096 - address.length) + address;
    assert.equal(identity('127.0.0.1', [bytesAtLimit]), address);
    assert.equal(identity('127.0.0.1', [' ' + bytesAtLimit]), '127.0.0.1');
    const repeatedAtLimit = [' '.repeat(4096 - address.length - 1 - '127.0.0.1'.length) + address, '127.0.0.1'];
    assert.equal(identity('127.0.0.1', repeatedAtLimit), address);
    assert.equal(identity('127.0.0.1', [repeatedAtLimit[0], ' ' + repeatedAtLimit[1]]), '127.0.0.1');
});

test('other proxy headers do not provide anonymous identity or alter XFF traversal', () => {
    const headers = ['Forwarded', 'for=198.51.100.1', 'X-Real-IP', '198.51.100.1', 'X-Forwarded-Host', 'proxy.example', 'X-Forwarded-Proto', 'https'];
    assert.equal(identity('127.0.0.1', [], '127.0.0.1', headers), '127.0.0.1');
    assert.equal(identity('127.0.0.1', ['203.0.113.8'], '127.0.0.1', headers), '203.0.113.8');
});

test('trust configuration rejects hostnames, wildcard trust, malformed entries and trust-all ranges', () => {
    for (const value of ['*', 'localhost', 'proxy.example', '127.0.0.1,', ',127.0.0.1', '127.0.0.1, ,::1', '127.0.0.01', '999.0.0.1', '[::1]', '127.0.0.1:80', 'fe80::1%eth0', '127.0.0.1/0', '::/0', '127.0.0.1/33', '::1/129', '127.0.0.1/-1', '::1/+1', '::1/01', '::1/1.5', '::1/1/2', '::1/', '::ffff:192.0.2.0/96', '::ffff:192.0.2.0/64', '127.0.0.1\n', '\n']) {
        assert.throws(() => parseTrustedProxies(value), /BPM_TRUSTED_PROXIES/, value);
    }
    const config = parseTrustedProxies(' 127.0.0.1/32, 2001:db8::1/128, ::ffff:192.0.2.1/120 ');
    assert.equal(config.length, 3);
    assert.ok(Object.isFrozen(config));
    assert.ok(config.every(Object.isFrozen));
});
