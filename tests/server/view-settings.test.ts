import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigurationError, loadSettings } from '../../src/server/settings.ts';
import { settings, temporaryDirectory } from './helpers.ts';

test('implicit viewing configuration is private and fails closed without a secret', () => {
    const environment = { BITCOIN_RPC_HOST: '127.0.0.1', BITCOIN_RPC_USER: 'test', BITCOIN_RPC_PASSWORD: 'secret' };
    assert.throws(() => loadSettings(environment), /BPM_VIEW_MODE requires/);
    assert.equal(loadSettings({ ...environment, BPM_ADMIN_TOKEN: 'admin' }).view_mode, 'authenticated');
    assert.equal(loadSettings({ ...environment, BPM_VIEW_MODE: 'public' }).view_mode, 'public');
});

test('explicit private modes require a credential and preserve viewer/admin separation', () => {
    for (const mode of ['authenticated', 'redacted']) {
        assert.throws(() => settings({ BPM_VIEW_MODE: mode }), ConfigurationError);
        const viewer = settings({ BPM_VIEW_MODE: mode, BPM_VIEW_TOKEN: 'viewer-secret' });
        assert.equal(viewer.view_mode, mode);
        assert.equal(viewer.view_token, 'viewer-secret');
        assert.equal(viewer.admin_token, null);
        assert.equal(settings({ BPM_VIEW_MODE: mode, BPM_ADMIN_TOKEN: 'admin-secret' }).view_token, null);
    }
    assert.throws(() => settings({ BPM_VIEW_MODE: 'invalid' }), /BPM_VIEW_MODE/);
    assert.throws(() => settings({ BPM_VIEW_TOKEN: 'same-secret', BPM_ADMIN_TOKEN: 'same-secret' }), /must be different/);
});

for (const name of ['BPM_VIEW_TOKEN', 'BPM_ADMIN_TOKEN'] as const) {
    test(`${name} accepts mounted secrets and rejects conflicts or unreadable/invalid files safely`, t => {
        const file = join(temporaryDirectory(t), 'token');
        writeFileSync(file, 'mounted-secret\n');
        const value = settings({ [`${name}_FILE`]: file });
        const key = name === 'BPM_VIEW_TOKEN' ? 'view_token' : 'admin_token';
        assert.equal(value[key], 'mounted-secret');
        assert.equal(value[`${key}_file_configured`], true);
        assert.throws(() => settings({ [name]: 'direct', [`${name}_FILE`]: file }), /only one/);
        assert.throws(() => settings({ [`${name}_FILE`]: `${file}-missing` }), /not readable/);
        for (const contents of ['', 'secret sentinel\n', 'first\nsecond', 'x'.repeat(257)]) {
            writeFileSync(file, contents);
            assert.throws(() => settings({ [`${name}_FILE`]: file }), error => {
                assert.ok(error instanceof ConfigurationError);
                assert.equal(error.message.includes(file), false);
                if (contents) assert.equal(error.message.includes(contents), false);
                return true;
            });
        }
    });
}
