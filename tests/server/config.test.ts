import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
    assert.equal(settings({ BPM_GEOIP_AUTO_UPDATE: 'FALSE' }).geoip_auto_update_override, false);
    assert.throws(() => loadSettings({}), ConfigurationError);
});
for (const [key, value] of Object.entries({ BITCOIN_RPC_SCHEME: 'ftp', BITCOIN_NETWORK: 'wrong', BITCOIN_RPC_PORT: '0', BITCOIN_RPC_TIMEOUT: '1.5', BPM_RPC_STARTUP_TIMEOUT: '601', BPM_LISTEN_PORT: '80', BPM_LISTEN_ADDRESS: '\n', BITCOIN_RPC_VERIFY_TLS: 'yes', BPM_GEOIP_ENABLED: 'invalid', BPM_BUILD_REVISION: '<bad>', BPM_GITHUB_REPOSITORY: 'no-slash', BITCOIN_RPC_USER: 'user\nname' })) {
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
test('build revision file fallback, normalization, validation, and precedence', t => {
    const path = join(temporaryDirectory(t), 'revision');
    const env = { BPM_BUILD_REVISION_FILE: path };
    assert.equal(settings(env).build_revision, 'unknown');
    writeFileSync(path, 'ABCDEF012345\n');
    assert.equal(settings(env).build_revision, 'abcdef012345');
    assert.equal(settings({ ...env, BPM_BUILD_REVISION: '7654321' }).build_revision, '7654321');
    writeFileSync(path, 'invalid');
    assert.throws(() => settings(env), /BPM_BUILD_REVISION_FILE/);
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
for (const raw of ['not-json', 'null', '[]', '42', '{"geoip_auto_update":"false","geoip_db_only":1}']) {
    test(`invalid saved preferences fall back safely: ${raw}`, t => {
        const path = join(temporaryDirectory(t), 'settings.json'); writeFileSync(path, raw);
        assert.deepEqual(new PreferenceStore(path).load(), { geoip_auto_update: true, geoip_db_only: false });
    });
}
test('older saved preferences remain compatible', t => {
    const path = join(temporaryDirectory(t), 'settings.json');
    writeFileSync(path, '{"geoip_auto_update":false}');
    assert.deepEqual(new PreferenceStore(path).load(), { geoip_auto_update: false, geoip_db_only: false });
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
    for (const ip of ['', 'localhost', '10.0.0.1', '127.0.0.1', '100.64.0.1', '192.168.1.2', '192.0.2.1', '198.51.100.1', '203.0.113.1', '::', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:192.168.1.1']) assert.equal(isPrivateAddress(ip), true, ip);
    for (const ip of ['8.8.8.8', '1.1.1.1', '192.0.0.9', '2001:4860:4860::8888', '::ffff:8.8.8.8']) assert.equal(isPrivateAddress(ip), false, ip);
    assert.equal(isPublicAddress('onion', 'example.onion'), false);
});
test('display formatting stays compatible', () => {
    assert.equal(formatBytes(2048), '2.0KB'); assert.equal(formatBytes(1024 ** 3), '1.00GB');
    assert.equal(formatDuration(90061), '1d1h'); assert.equal(formatDuration(-2), '0s');
    assert.equal(abbreviateConnectionType('outbound-full-relay'), 'OFR');
});
