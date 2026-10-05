import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigurationError, loadSettings } from '../../src/server/settings.ts';
import { PreferenceStore } from '../../src/server/preferences.ts';
import { abbreviateConnectionType, formatBytes, formatDuration, isPrivateAddress, isPublicAddress, networkType, normalizePeerAddress, splitPeerAddress } from '../../src/server/network.ts';
import { settings, temporaryDirectory } from './helpers.ts';

test('settings preserve environment defaults and IPv6 RPC URLs', () => {
    const value = settings({ BITCOIN_RPC_HOST: '::1' });
    assert.equal(value.rpc_url, 'http://[::1]:8332');
    assert.equal(value.listen_port, 58333);
    assert.equal(value.geoip_auto_update_override, null);
    assert.equal(value.geoip_enabled, true);
    assert.equal(value.log_level, 'info');
    assert.equal(settings({ BPM_GEOIP_AUTO_UPDATE: 'FALSE' }).geoip_auto_update_override, false);
    assert.throws(() => loadSettings({}), ConfigurationError);
});
test('log levels accept supported values and normalize case and whitespace', () => {
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
        assert.equal(settings({ BPM_LOG_LEVEL: ` ${level.toUpperCase()} ` }).log_level, level);
    }
    assert.equal(settings({ BPM_LOG_LEVEL: ' ' }).log_level, 'info');
    assert.throws(() => settings({ BPM_LOG_LEVEL: 'verbose' }), /BPM_LOG_LEVEL must be debug, info, warn, or error/);
});
for (const [key, value] of Object.entries({ BITCOIN_RPC_SCHEME: 'ftp', BITCOIN_NETWORK: 'wrong', BITCOIN_RPC_PORT: '0', BITCOIN_RPC_TIMEOUT: '1.5', BPM_RPC_STARTUP_TIMEOUT: '601', BPM_LISTEN_PORT: '80', BPM_LISTEN_ADDRESS: '\n', BITCOIN_RPC_VERIFY_TLS: 'yes', BPM_GEOIP_ENABLED: 'invalid', BPM_BUILD_REVISION: '<bad>', BPM_BUILD_VERSION: '<bad>', BITCOIN_RPC_USER: 'user\nname' })) {
    test(`rejects invalid ${key}`, () => assert.throws(() => settings({ [key]: value }), ConfigurationError));
}
test('password files preserve spaces and never accept conflicting sources', t => {
    const path = join(temporaryDirectory(t), 'password');
    writeFileSync(path, ' secret with spaces \n');
    const env = { BITCOIN_RPC_PASSWORD: '', BITCOIN_RPC_PASSWORD_FILE: path };
    assert.equal(settings(env).rpc_password, ' secret with spaces ');
    assert.equal(settings(env).rpc_password_file_configured, true);
    assert.throws(() => settings({ ...env, BITCOIN_RPC_PASSWORD: 'direct' }), /only one/);
    writeFileSync(path, 'multi\nline');
    assert.throws(() => settings(env), /single line/);
    assert.throws(() => settings({ ...env, BITCOIN_RPC_PASSWORD_FILE: `${path}-missing` }), /not readable/);
});
test('build revision defaults, normalization, and validation', () => {
    assert.equal(settings().build_revision, 'unknown');
    assert.equal(settings({ BPM_BUILD_REVISION: ' ABCDEF012345\n' }).build_revision, 'abcdef012345');
    assert.equal(settings({ BPM_BUILD_REVISION: ' ' }).build_revision, 'unknown');
    assert.throws(() => settings({ BPM_BUILD_REVISION: 'invalid' }), /BPM_BUILD_REVISION/);
});
test('admin token accepts short values and rejects malformed configuration without disclosing it', () => {
    assert.equal(settings().admin_token, null);
    assert.equal(settings({ BPM_ADMIN_TOKEN: '' }).admin_token, null);
    const token = 'a1'.repeat(32);
    for (const value of ['a', 'admin', 'password', token, 'a'.repeat(256)]) {
        assert.equal(settings({ BPM_ADMIN_TOKEN: value }).admin_token, value);
    }
    for (const value of [' ', token + '\n', ' ' + token, 'a'.repeat(257), token + ':', '<' + token + '>']) {
        assert.throws(() => settings({ BPM_ADMIN_TOKEN: value }), error => {
            assert.ok(error instanceof ConfigurationError);
            assert.match(error.message, /BPM_ADMIN_TOKEN/);
            if (value.length >= 8) assert.equal(error.message.includes(value), false);
            return true;
        });
    }
});
test('build version defaults and stable release validation are independent of revision', () => {
    assert.equal(settings().build_version, 'dev');
    assert.equal(settings({ BPM_BUILD_VERSION: ' ' }).build_version, 'dev');
    const release = settings({ BPM_BUILD_VERSION: ' v1.3.0 ' });
    assert.equal(release.build_version, 'v1.3.0');
    assert.equal(release.build_revision, 'unknown');
    for (const value of ['1.3.0', 'v01.3.0', 'v1.03.0', 'v1.3.00', 'v1.3', 'v1.3.0-rc.1', 'v1.3.0+build', 'V1.3.0', `v${'1'.repeat(125)}.0.0`]) {
        assert.throws(() => settings({ BPM_BUILD_VERSION: value }), /BPM_BUILD_VERSION/);
    }
});
test('preferences survive atomic replacement with restricted permissions', t => {
    const dir = temporaryDirectory(t), path = join(dir, 'settings.json');
    const store = new PreferenceStore(path);
    assert.deepEqual(store.load(), { geoip_auto_update: true, geoip_db_only: false });
    store.save({ geoip_auto_update: false, geoip_db_only: true });
    assert.deepEqual(new PreferenceStore(path).load(), { geoip_auto_update: false, geoip_db_only: true });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir), ['settings.json']);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).geoip_db_only, true);
});
for (const raw of ['not-json', 'null', '[]', '42', 'true', '{"geoip_auto_update":"false","geoip_db_only":1}', '{"geoip_db_only":null}', '{"geoip_auto_update":0}']) {
    test(`invalid saved preferences stop startup and preserve the file: ${raw}`, t => {
        const path = join(temporaryDirectory(t), 'settings.json'); writeFileSync(path, raw);
        assert.throws(() => new PreferenceStore(path).load(), error => {
            assert.ok(error instanceof ConfigurationError);
            assert.ok(error.message.includes(path));
            assert.match(error.message, /Repair.*preserving your privacy choices/);
            return true;
        });
        assert.equal(readFileSync(path, 'utf8'), raw);
    });
}
test('unreadable saved settings are not treated as a first installation', t => {
    const path = join(temporaryDirectory(t), 'settings.json');
    mkdirSync(path);
    assert.throws(() => new PreferenceStore(path).load(), /file is not readable/);
    assert.ok(statSync(path).isDirectory());
});
test('settings errors never disclose file contents', t => {
    const path = join(temporaryDirectory(t), 'settings.json'), raw = '{SECRET-PRIVATE-CONTENTS';
    writeFileSync(path, raw);
    assert.throws(() => new PreferenceStore(path).load(), error => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(raw), false);
        return true;
    });
});
test('older saved preferences remain compatible', t => {
    const path = join(temporaryDirectory(t), 'settings.json');
    writeFileSync(path, '{"geoip_auto_update":false}');
    assert.deepEqual(new PreferenceStore(path).load(), { geoip_auto_update: false, geoip_db_only: false });
    writeFileSync(path, '{"geoip_db_only":true}');
    assert.deepEqual(new PreferenceStore(path).load(), { geoip_auto_update: true, geoip_db_only: true });
});
test('peer address parsing and normalization preserve supported networks', () => {
    for (const [input, host, port, normalized] of [
        ['8.8.8.8:8333', '8.8.8.8', '8333', '8.8.8.8:8333'],
        ['8.8.8.8', '8.8.8.8', '', '8.8.8.8:8333'],
        ['[2001:4860::1]:8333', '2001:4860::1', '8333', '[2001:4860::1]:8333'],
        ['2001:4860::1', '2001:4860::1', '', '[2001:4860::1]:8333'],
        ['example.onion', 'example.onion', '', 'example.onion:8333'],
        ['example.b32.i2p:0', 'example.b32.i2p', '0', 'example.b32.i2p:0'],
    ]) { assert.deepEqual(splitPeerAddress(input), [host, port]); assert.equal(normalizePeerAddress(input), normalized); }
    for (const bad of ['', '[bad', 'example.b32.i2p']) assert.throws(() => normalizePeerAddress(bad));
    assert.equal(networkType('[fc00::1]:8333'), 'cjdns');
    assert.equal(networkType('example.onion:8333'), 'onion');
});
test('private, reserved, and mapped IPs never reach geolocation providers', () => {
    for (const ip of ['', 'localhost', '10.0.0.1', '127.0.0.1', '100.64.0.1', '192.168.1.2', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '239.1.2.3', '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:192.168.1.1', '::ffff:224.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
    for (const ip of ['8.8.8.8', '1.1.1.1', '192.0.0.9', '2001:4860:4860::8888', '::ffff:8.8.8.8']) assert.equal(isPrivateAddress(ip), false, ip);
    assert.equal(isPublicAddress('onion', 'example.onion'), false);
    for (const host of ['example.com', 'not-an-ip', '999.1.2.3', '8.8.8.8:8333', '[2001:4860::1]']) {
        assert.equal(isPublicAddress('ipv4', host), false, host);
        assert.equal(isPublicAddress('ipv6', host), false, host);
    }
});
test('display formatting stays compatible', () => {
    assert.equal(formatBytes(2048), '2.0KB'); assert.equal(formatBytes(1024 ** 3), '1.00GB');
    assert.equal(formatDuration(90061), '1d1h'); assert.equal(formatDuration(-2), '0s');
    assert.equal(abbreviateConnectionType('outbound-full-relay'), 'OFR');
});
