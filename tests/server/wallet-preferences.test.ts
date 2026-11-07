import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { WalletPreferenceStore, DEFAULT_WALLET_PREFERENCES, parseWalletTickerPreferences } from '../../src/server/wallet-preferences.ts';
import { HttpError } from '../../src/server/http.ts';
import { temporaryDirectory } from './helpers.ts';

const preferences = (overrides = {}) => ({ selected_wallets: [], unit: 'BTC', rotation_seconds: 8, paused: false, ...overrides });

test('missing wallet settings return independent defaults without creating storage', t => {
    const path = join(temporaryDirectory(t), 'nested/wallet-ticker.json');
    const store = new WalletPreferenceStore(path, 'node-main');
    assert.deepEqual(store.response(), { preferences: DEFAULT_WALLET_PREFERENCES, revision: 0 });
    store.response().preferences.selected_wallets.push('private');
    assert.deepEqual(store.response().preferences.selected_wallets, []);
    assert.equal(fs.existsSync(path), false);
});

test('wallet settings persist exact names, shared order and revision atomically with mode0600', t => {
    const path = join(temporaryDirectory(t), 'wallet-ticker.json');
    const store = new WalletPreferenceStore(path, 'node-main');
    const committed = store.save(parseWalletTickerPreferences(preferences({ selected_wallets: ['z', '', ' a/b%?#雪 '], unit: 'sats', rotation_seconds: 15, paused: true })));
    assert.deepEqual(committed.preferences.selected_wallets, ['', ' a/b%?#雪 ', 'z']);
    assert.equal(committed.revision, 1);
    assert.equal(fs.statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(new WalletPreferenceStore(path, 'node-main').response(), committed);
    assert.equal(store.save(committed.preferences).revision, 2, 'the last complete write receives a newer shared revision');
    const saved = JSON.parse(fs.readFileSync(path, 'utf8'));
    assert.equal(saved.scope, 'node-main'); assert.equal(saved.revision, 2);
    assert.deepEqual(fs.readdirSync(join(path, '..')), ['wallet-ticker.json']);
});

test('changing node or chain never applies another scope and reads leave its file untouched', t => {
    const path = join(temporaryDirectory(t), 'wallet-ticker.json');
    new WalletPreferenceStore(path, 'node-main').save(parseWalletTickerPreferences(preferences({ selected_wallets: ['private-main'] })));
    const bytes = fs.readFileSync(path);
    const other = new WalletPreferenceStore(path, 'node-signet');
    assert.deepEqual(other.response().preferences, DEFAULT_WALLET_PREFERENCES);
    assert.deepEqual(fs.readFileSync(path), bytes);
    other.save(parseWalletTickerPreferences(preferences({ selected_wallets: ['signet'] })));
    assert.equal(JSON.parse(fs.readFileSync(path, 'utf8')).scope, 'node-signet');
});

test('invalid wallet settings fail only this feature and never echo private names or rewrite files', t => {
    const path = join(temporaryDirectory(t), 'wallet-ticker.json');
    for (const contents of ['private-name-sentinel', '[]', '{}', JSON.stringify({ version: 1, scope: 'node', revision: 1, preferences: preferences({ paused: 'private-name-sentinel' }) })]) {
        fs.writeFileSync(path, contents);
        const store = new WalletPreferenceStore(path, 'node');
        assert.throws(() => store.response(), error => error instanceof HttpError && error.status === 503 && !error.message.includes(path) && !error.message.includes('private-name-sentinel'));
        assert.throws(() => store.save(parseWalletTickerPreferences(preferences())), HttpError);
        assert.equal(fs.readFileSync(path, 'utf8'), contents);
    }
    fs.rmSync(path); fs.mkdirSync(path);
    assert.throws(() => new WalletPreferenceStore(path, 'node').response(), HttpError);
});

test('failed atomic writes preserve both the previous preferences and the original file', t => {
    const path = join(temporaryDirectory(t), 'wallet-ticker.json');
    const store = new WalletPreferenceStore(path, 'node');
    const before = store.save(parseWalletTickerPreferences(preferences({ selected_wallets: ['old'] })));
    const bytes = fs.readFileSync(path);
    t.mock.method(fs, 'renameSync', () => { throw new Error('private-path-sentinel'); });
    assert.throws(() => store.save(parseWalletTickerPreferences(preferences({ selected_wallets: ['new'] }))), error => error instanceof HttpError && error.status === 503 && !error.message.includes('private-path-sentinel'));
    assert.deepEqual(store.response(), before);
    assert.deepEqual(fs.readFileSync(path), bytes);
    assert.deepEqual(fs.readdirSync(join(path, '..')), ['wallet-ticker.json']);
});

test('wallet preference validation rejects coercions, duplicate/unsafe names and oversized selections', () => {
    for (const payload of [null, [], {}, preferences({ extra: true }), preferences({ unit: ['BTC'] }), preferences({ unit: 'btc' }),
        preferences({ paused: 'false' }), preferences({ rotation_seconds: '8' }), preferences({ rotation_seconds: 9 }),
        preferences({ selected_wallets: ['x', 'x'] }), preferences({ selected_wallets: ['line\nname'] }),
        preferences({ selected_wallets: ['\ud800'] }), preferences({ selected_wallets: ['x'.repeat(4097)] }),
        preferences({ selected_wallets: Array.from({ length: 129 }, (_, i) => String(i)) }),
        preferences({ selected_wallets: Array.from({ length: 20 }, (_, i) => `${i}${'x'.repeat(3000)}`) })]) {
        assert.throws(() => parseWalletTickerPreferences(payload), error => error instanceof HttpError && error.status === 422);
    }
    for (const rotation_seconds of [5, 8, 15, 30]) assert.equal(parseWalletTickerPreferences(preferences({ rotation_seconds })).rotation_seconds, rotation_seconds);
});
